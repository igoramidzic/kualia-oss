import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class BudgetTargetStore {
    typealias Subscription = (String) -> AnyPublisher<[BudgetTarget], Error>
    typealias SaveHandler = (BudgetTargetRequest) async throws -> String

    private(set) var workspaceID: String?
    private(set) var targets: [String: BudgetTarget] = [:]
    private(set) var hasLoaded = false
    private(set) var isSaving = false
    private(set) var loadError: String?
    var saveError: String?
    var canEdit: Bool { hasLoaded && loadError == nil && !isSaving }

    @ObservationIgnored private let subscribe: Subscription
    @ObservationIgnored private let persist: SaveHandler
    @ObservationIgnored private let responseTimeout: Duration
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var subscriptionID = UUID()

    convenience init(convexClient: ConvexClientWithAuth<String>) {
        self.init(
            subscription: { workspaceID in
                convexClient.subscribe(
                    to: "categoryTargets:listCategoryTargets", with: ["workspaceId": workspaceID],
                    yielding: [BudgetTarget].self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            save: { request in
                if request.isDeleting {
                    let result: BudgetTargetDeleteResult = try await convexClient.mutation(
                        request.function, with: request.arguments)
                    guard result.success else { throw BudgetTargetSaveError.unavailable }
                    return request.target.categoryId
                }
                return try await convexClient.mutation(request.function, with: request.arguments)
            })
    }

    init(
        subscription: @escaping Subscription = { _ in
            Just([]).setFailureType(to: Error.self).eraseToAnyPublisher()
        },
        save: @escaping SaveHandler = { _ in throw BudgetTargetSaveError.unavailable },
        responseTimeout: Duration = .seconds(15)
    ) {
        subscribe = subscription
        persist = save
        self.responseTimeout = responseTimeout
    }

    func start(workspaceID: String) {
        guard self.workspaceID != workspaceID || subscription == nil else { return }
        stop()
        self.workspaceID = workspaceID
        retry()
    }

    func stop() {
        generation = UUID()
        subscriptionID = UUID()
        subscription?.cancel()
        subscription = nil
        deadline?.cancel()
        deadline = nil
        workspaceID = nil
        targets = [:]
        hasLoaded = false
        isSaving = false
        loadError = nil
        saveError = nil
    }

    func retry() {
        guard let workspaceID else { return }
        subscriptionID = UUID()
        let id = subscriptionID
        loadError = nil
        hasLoaded = false
        subscription?.cancel()
        deadline?.cancel()
        deadline = Task { [weak self, responseTimeout] in
            do { try await Task.sleep(for: responseTimeout) } catch { return }
            guard let self, self.subscriptionID == id else { return }
            self.loadError = L10n.string("Targets are taking longer to load. Please try again.")
        }
        subscription = subscribe(workspaceID).receive(on: DispatchQueue.main).sink(
            receiveCompletion: { [weak self] completion in
                guard let self, self.subscriptionID == id else { return }
                if case .failure = completion {
                    self.deadline?.cancel()
                    self.loadError = L10n.string(
                        "Couldn't load targets. Check your connection and try again.")
                }
            },
            receiveValue: { [weak self] targets in
                guard let self, self.subscriptionID == id else { return }
                self.deadline?.cancel()
                self.targets = Dictionary(
                    targets.map { ($0.categoryId, $0) }, uniquingKeysWith: { _, latest in latest })
                self.hasLoaded = true
                self.loadError = nil
            })
    }

    func delete(categoryID: String, workspaceID: String, expected: BudgetTarget) async -> Bool {
        guard canEdit, self.workspaceID == workspaceID else { return false }
        guard targets[categoryID] == expected else {
            saveError = L10n.string(
                "This target changed. Reopen it to see the latest settings before deleting.")
            return false
        }
        let generation = generation
        isSaving = true
        saveError = nil
        defer { if self.generation == generation { isSaving = false } }
        do {
            let deletedID = try await persist(
                .init(
                    workspaceID: workspaceID, target: expected, isCreating: false, isDeleting: true)
            )
            guard self.generation == generation, self.workspaceID == workspaceID else {
                return false
            }
            guard deletedID == categoryID else { throw BudgetTargetSaveError.unavailable }
            if targets[categoryID] == expected { targets.removeValue(forKey: categoryID) }
            return true
        } catch {
            guard self.generation == generation else { return false }
            saveError = L10n.string(
                "Couldn't confirm the deletion. Check your connection and try again.")
            retry()
            return false
        }
    }

    func save(
        draft: BudgetTargetDraft, categoryID: String, workspaceID: String,
        expected: BudgetTarget?, today: String
    ) async -> Bool {
        guard canEdit, self.workspaceID == workspaceID else { return false }
        guard targets[categoryID] == expected else {
            saveError =
                L10n.string(
                    "This target changed while you were editing. Reopen it to see the latest settings."
                )
            return false
        }
        if let message = draft.validationMessage(today: today, existing: expected) {
            saveError = message
            return false
        }
        let generation = generation
        let target = draft.target(categoryID: categoryID)
        isSaving = true
        saveError = nil
        defer { if self.generation == generation { isSaving = false } }
        do {
            let savedID = try await persist(
                .init(workspaceID: workspaceID, target: target, isCreating: expected == nil))
            guard self.generation == generation, self.workspaceID == workspaceID else {
                return false
            }
            guard savedID == categoryID else { throw BudgetTargetSaveError.unavailable }
            // A subscription can arrive before the mutation receipt. Preserve newer edits.
            if targets[categoryID] == expected { targets[categoryID] = target }
            return true
        } catch {
            guard self.generation == generation else { return false }
            if let clientError = error as? ClientError, case .ConvexError = clientError {
                saveError = L10n.string(
                    "Couldn't save this target. Refresh its settings and try again.")
            } else {
                saveError =
                    L10n.string(
                        "Couldn't confirm the save. Your settings are still here. Check your connection before trying again."
                    )
            }
            retry()
            return false
        }
    }
}

enum BudgetTargetSaveError: Error { case unavailable }

private struct BudgetTargetDeleteResult: Decodable { let success: Bool }
