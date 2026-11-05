import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
struct MerchantsClient {
    let watch: (String) -> AnyPublisher<[SettingsMerchant], Error>
    let update: ([String: ConvexEncodable?]) async throws -> Void
    let isAvailable: () -> Bool
    var delete: (String, String) async throws -> Void = { _, _ in
        throw MerchantSaveError.failed
    }
    var merge: (String, String, String) async throws -> Void = { _, _, _ in
        throw MerchantSaveError.failed
    }
}

@MainActor
@Observable
final class MerchantsStore {
    private static let subscriptionQueue = DispatchQueue(
        label: "com.kualia.merchants.subscription", qos: .userInitiated)

    let workspaceID: String
    let currency: String
    let minorUnit: Int
    private(set) var merchants: [SettingsMerchant] = []
    private(set) var hasLoaded = false
    private(set) var loadError: String?
    private(set) var isSaving = false
    private(set) var completedRemovalIDs: Set<String> = []
    var actionError: String?
    var overview: MerchantOverview { MerchantOverview(merchants: merchants) }

    @ObservationIgnored private let client: MerchantsClient
    @ObservationIgnored private let makeLogoClient: (String) -> EntityLogoClient?
    @ObservationIgnored private var viewers = Set<UUID>()
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()

    convenience init(
        workspaceID: String, currency: String, minorUnit: Int? = nil,
        convexClient: ConvexClientWithAuth<String>, isAvailable: @escaping () -> Bool
    ) {
        self.init(
            workspaceID: workspaceID, currency: currency, minorUnit: minorUnit,
            client: MerchantsClient(
                watch: { workspaceID in
                    // Convex starts work eagerly and cancels its native handle
                    // synchronously. Neither should block a navigation transition.
                    Deferred {
                        convexClient.subscribe(
                            to: "merchants:listMerchants", with: ["workspaceId": workspaceID],
                            yielding: [SettingsMerchant].self
                        ).mapError { $0 as Error }
                    }
                    .subscribe(on: Self.subscriptionQueue)
                    .receive(on: DispatchQueue.main)
                    .eraseToAnyPublisher()
                },
                update: { arguments in
                    let result: MerchantUpdateResult = try await convexClient.mutation(
                        "merchants:updateMerchant", with: arguments)
                    guard result.success else { throw MerchantSaveError.failed }
                },
                isAvailable: isAvailable,
                delete: { workspaceID, merchantID in
                    let result: MerchantUpdateResult = try await convexClient.mutation(
                        "merchants:deleteMerchant",
                        with: ["workspaceId": workspaceID, "merchantId": merchantID])
                    guard result.success else { throw MerchantSaveError.failed }
                },
                merge: { workspaceID, sourceID, targetID in
                    let _: MerchantMergeResult = try await convexClient.mutation(
                        "merchants:mergeMerchants",
                        with: [
                            "workspaceId": workspaceID, "sourceMerchantId": sourceID,
                            "targetMerchantId": targetID,
                        ])
                }),
            makeLogoClient: { merchantID in
                .live(
                    convexClient, workspaceID: workspaceID, entityID: merchantID,
                    entityType: "merchant", isAvailable: isAvailable)
            })
    }

    init(
        workspaceID: String, currency: String, minorUnit: Int? = nil, client: MerchantsClient,
        makeLogoClient: @escaping (String) -> EntityLogoClient? = { _ in nil }
    ) {
        self.workspaceID = workspaceID
        self.currency = currency
        self.minorUnit = minorUnit ?? RuleMoney.minorUnit(currency: currency)
        self.client = client
        self.makeLogoClient = makeLogoClient
    }

    // Keep one live subscription while either the list or its pushed detail is visible.
    func appear(_ viewer: UUID) {
        guard client.isAvailable() else { return }
        viewers.insert(viewer)
        if subscription == nil { reload() }
    }

    func disappear(_ viewer: UUID) {
        viewers.remove(viewer)
        guard viewers.isEmpty else { return }
        generation = UUID()
        subscription = nil
        deadline?.cancel()
        deadline = nil
    }

    func reload() {
        guard !viewers.isEmpty, client.isAvailable() else { return }
        subscription = nil
        generation = UUID()
        let request = generation
        loadError = nil
        deadline?.cancel()
        deadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.generation == request else { return }
            self.loadError = L10n.string("Merchants are taking longer to load. Try again.")
        }
        subscription = client.watch(workspaceID).sink { [weak self] completion in
            guard let self, self.generation == request, self.client.isAvailable() else { return }
            if case .failure = completion {
                self.deadline?.cancel()
                self.loadError = L10n.string("Couldn't load merchants. Please try again.")
            }
        } receiveValue: { [weak self] values in
            guard let self, self.generation == request, self.client.isAvailable() else { return }
            self.deadline?.cancel()
            self.merchants = values.filter {
                $0.workspaceId == self.workspaceID && !$0.isDeleted
                    && !self.completedRemovalIDs.contains($0.id)
            }
            self.hasLoaded = true
            self.loadError = nil
        }
    }

    func merchant(id: String) -> SettingsMerchant? { merchants.first { $0.id == id } }

    func acceptSavedLogo(_ choice: EntityLogoChoice, merchantID: String) {
        guard let index = merchants.firstIndex(where: { $0.id == merchantID }) else { return }
        // A subscription may already have delivered the resolved, authenticated default URL.
        if choice == .reset, merchants[index].logoState == .automatic { return }
        merchants[index].logoUrl = choice.previewURL(
            current: merchants[index].logoUrl, defaultURL: merchants[index].globalMerchantLogoUrl)
        merchants[index].logoState = choice.state(original: merchants[index].logoState)
    }

    func logoClient(for merchantID: String) -> EntityLogoClient? {
        guard merchant(id: merchantID) != nil, client.isAvailable() else { return nil }
        return makeLogoClient(merchantID)
    }

    func save(_ draft: MerchantDraft, original: SettingsMerchant) async -> Bool {
        guard !isSaving, client.isAvailable(), merchant(id: original.id) != nil else {
            return false
        }
        actionError = nil
        guard !draft.trimmedName.isEmpty else {
            actionError = L10n.string("Give this merchant a name.")
            return false
        }
        if merchants.contains(where: {
            $0.id != original.id
                && $0.name.caseInsensitiveCompare(draft.trimmedName) == .orderedSame
        }) {
            actionError = L10n.string("A merchant with this name already exists.")
            return false
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try await client.update(draft.arguments(workspaceID: workspaceID, merchant: original))
            guard client.isAvailable(), !Task.isCancelled else { return false }
            return true
        } catch {
            guard client.isAvailable(), !Task.isCancelled else { return false }
            actionError = L10n.string(
                "Couldn't save this merchant. Your changes are here to try again.")
            return false
        }
    }

    func amount(_ amount: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: amount, currencyCode: currency, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: true)
    }

    /// Each source is an atomic backend operation. Keep acknowledged progress so a
    /// retry after a later failure never submits an already removed source again.
    func remove(_ sourceIDs: [String], mergingInto targetID: String? = nil) async -> Bool {
        guard !isSaving, client.isAvailable(), !sourceIDs.isEmpty,
            Set(sourceIDs).count == sourceIDs.count,
            targetID.map({ !sourceIDs.contains($0) && merchant(id: $0) != nil }) ?? true
        else { return false }
        actionError = nil
        let remaining = sourceIDs.filter { !completedRemovalIDs.contains($0) }
        guard remaining.allSatisfy({ merchant(id: $0) != nil }) else {
            actionError = L10n.string(
                "A merchant is no longer available. Go back and select again.")
            return false
        }
        if targetID == nil, remaining.contains(where: { merchant(id: $0)?.requiresMerge == true }) {
            actionError = L10n.string("Choose a merchant to move these transactions to.")
            return false
        }
        isSaving = true
        defer { isSaving = false }
        do {
            for sourceID in remaining {
                guard client.isAvailable(), !Task.isCancelled else { return false }
                if let targetID {
                    try await client.merge(workspaceID, sourceID, targetID)
                } else {
                    try await client.delete(workspaceID, sourceID)
                }
                guard client.isAvailable(), !Task.isCancelled else { return false }
                completedRemovalIDs.insert(sourceID)
                merchants.removeAll { $0.id == sourceID }
            }
            return true
        } catch {
            guard client.isAvailable(), !Task.isCancelled else { return false }
            actionError = L10n.string(
                "Couldn't finish. Completed merchants are saved. Try again to finish the rest.")
            return false
        }
    }
}

private struct MerchantUpdateResult: Decodable { let success: Bool }
private struct MerchantMergeResult: Decodable {
    let mergedTransactionCount: Int
    let updatedRecurringTransactions: Int
}
private enum MerchantSaveError: Error { case failed }
