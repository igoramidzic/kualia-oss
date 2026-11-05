import ConvexMobile
import Foundation
import Observation

/// Missing, null, and a URL have different meanings in the existing logo APIs.
enum EntityLogoState: Equatable {
    case automatic
    case custom
    case removed

    init(rawURL: String?, hasRawValue: Bool) {
        self = rawURL != nil ? .custom : (hasRawValue ? .removed : .automatic)
    }
}

enum EntityLogoChoice: Equatable {
    case unchanged
    case custom(String)
    case remove
    case reset

    var argument: (any ConvexEncodable)? {
        switch self {
        case .unchanged: nil
        case .custom(let url): url
        case .remove: EntityLogoNull()
        case .reset: "UNSET"
        }
    }

    func previewURL(current: String?, defaultURL: String?) -> String? {
        switch self {
        case .unchanged: current
        case .custom(let url): url
        case .remove: nil
        case .reset: defaultURL
        }
    }

    func state(original: EntityLogoState) -> EntityLogoState {
        switch self {
        case .unchanged: original
        case .custom: .custom
        case .remove: .removed
        case .reset: .automatic
        }
    }
}

private struct EntityLogoNull: ConvexEncodable {
    func convexEncode() throws -> String { "null" }
}

struct EntityLogoUpdateRequest {
    let workspaceID: String
    let entityID: String
    let entityType: String
    let choice: EntityLogoChoice

    var function: String {
        entityType == "merchant" ? "merchants:updateMerchant" : "bankAccounts:updateBankAccount"
    }

    var arguments: [String: ConvexEncodable?] {
        var arguments: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID,
            entityType == "merchant" ? "merchantId" : "bankAccountId": entityID,
        ]
        if let value = choice.argument { arguments["logoUrl"] = value }
        return arguments
    }
}

@MainActor
@Observable
final class EntityLogoSaveStore {
    private(set) var isSaving = false
    private(set) var error: String?
    @ObservationIgnored private let persist: (EntityLogoChoice) async throws -> Void

    init(save: @escaping (EntityLogoChoice) async throws -> Void) { persist = save }

    func save(_ choice: EntityLogoChoice) async -> Bool {
        guard !isSaving, choice != .unchanged else { return false }
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            try await persist(choice)
            try Task.checkCancellation()
            return true
        } catch {
            self.error = L10n.string("Couldn't save the logo. Please try again.")
            return false
        }
    }
}

struct EntityLogoSearchResult: Decodable, Identifiable, Equatable {
    let name: String
    let domain: String
    let logoUrl: String
    var id: String { domain }
}

@MainActor
@Observable
final class EntityLogoSearchStore {
    typealias Search = (String) async throws -> [EntityLogoSearchResult]
    private(set) var results: [EntityLogoSearchResult] = []
    private(set) var isSearching = false
    private(set) var error: String?
    @ObservationIgnored private let search: Search
    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private var generation = UUID()

    init(debounce: Duration = .milliseconds(350), search: @escaping Search) {
        self.debounce = debounce
        self.search = search
    }

    func load(_ text: String) async {
        let request = UUID()
        generation = request
        results = []
        error = nil
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        isSearching = query.count >= 2
        guard isSearching else { return }
        defer { if generation == request { isSearching = false } }
        do {
            try await Task.sleep(for: debounce)
            try Task.checkCancellation()
            let values = try await search(query)
            guard generation == request, !Task.isCancelled else { return }
            var domains = Set<String>()
            results = values.filter {
                URL(string: $0.logoUrl)?.scheme?.lowercased() == "https"
                    && URL(string: $0.logoUrl)?.host != nil
                    && domains.insert($0.domain).inserted
            }
        } catch {
            guard generation == request, !Task.isCancelled else { return }
            self.error = L10n.string("Couldn't search logos. Please try again.")
        }
    }
}

/// Stage a logo until its account exists, retaining completed uploads across retries.
@MainActor
@Observable
final class EntityLogoDraft {
    private(set) var choice: EntityLogoChoice = .unchanged
    private(set) var photoData: Data?
    private var photoReference: String?
    private var uploadedURL: String?

    var hasSelection: Bool { choice != .unchanged }
    var previewURL: String? {
        guard photoData == nil else { return nil }
        return choice.previewURL(current: nil, defaultURL: nil)
    }

    func stagePhoto(_ data: Data) -> String {
        let reference = "draft-logo://\(UUID().uuidString)"
        photoData = data
        photoReference = reference
        uploadedURL = nil
        return reference
    }

    func select(_ selection: EntityLogoChoice) {
        choice = selection
        if selection != photoReference.map(EntityLogoChoice.custom) {
            photoData = nil
            photoReference = nil
            uploadedURL = nil
        }
    }

    func persist(using client: EntityLogoClient) async throws {
        guard hasSelection else { return }
        var persistedChoice = choice
        if let photoData {
            if uploadedURL == nil { uploadedURL = try await client.upload(photoData) }
            guard let uploadedURL else { return }
            persistedChoice = .custom(uploadedURL)
        }
        try await client.save(persistedChoice)
    }
}
