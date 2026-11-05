import Combine
import ConvexMobile
import Foundation
import Observation

enum BudgetCategoryAction {
    case archive, delete
    var title: String {
        self == .archive ? L10n.string("Archive category") : L10n.string("Delete category")
    }
}

/// Read the category's actual counter, not getCategoryWithStats' legacy month count.
struct BudgetCategoryDetails: Decodable {
    let _id: String
    let name: String
    let type: String
    let isDeleted: Bool
    let isArchived: Bool?
    let isSystemCategory: Bool?
    private let count: ConvexInt<Int64>?
    var transactionCount: Int64 { max(0, count?.wrappedValue ?? 0) }
    var canRemove: Bool {
        !isDeleted && isArchived != true && isSystemCategory != true && type != "credit_card"
    }

    private enum CodingKeys: String, CodingKey {
        case _id, name, type, isDeleted, isArchived, isSystemCategory
        case count = "transactionCount"
    }

    init(
        id: String, name: String, type: String = "expense", transactionCount: Int64 = 0,
        isDeleted: Bool = false, isArchived: Bool = false, isSystemCategory: Bool = false
    ) {
        _id = id
        self.name = name
        self.type = type
        count = ConvexInt(wrappedValue: transactionCount)
        self.isDeleted = isDeleted
        self.isArchived = isArchived
        self.isSystemCategory = isSystemCategory
    }
}

struct BudgetCategoryActionRequest {
    let workspaceID: String
    let categoryID: String
    let action: BudgetCategoryAction
    let destinationID: String?

    var function: String {
        action == .archive
            ? "categories:archiveCategories" : "categories:deleteCategoriesWithRecategorization"
    }
    var arguments: [String: ConvexEncodable?] {
        var args: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "categoryIds": [categoryID],
        ]
        if action == .archive {
            args["isArchived"] = true
        } else if let destinationID {
            args["newCategoryId"] = destinationID
        }
        return args
    }
}

struct BudgetCategoryActionResult: Decodable {
    let success: Bool
    var isAsync: Bool? = nil
}

struct BudgetCategoryLifecycleClient {
    var load: (String, String) async throws -> BudgetCategoryDetails
    var perform: (BudgetCategoryActionRequest) async throws -> BudgetCategoryActionResult
    var unarchive: (String, [String]) async throws -> BudgetCategoryActionResult = { _, _ in
        throw BudgetCategoryLifecycleError.unavailable
    }
    var loadGroups: (String) async throws -> [BudgetGroupDeletionDetails] = { _ in
        throw BudgetCategoryLifecycleError.unavailable
    }
    var deleteGroup: (BudgetGroupDeletionRequest) async throws -> BudgetCategoryActionResult = {
        _ in
        throw BudgetCategoryLifecycleError.unavailable
    }

    init(convexClient: ConvexClientWithAuth<String>) {
        load = { workspaceID, categoryID in
            let result = try await convexClient.subscribe(
                to: "categories:getCategory",
                with: ["workspaceId": workspaceID, "categoryId": categoryID],
                yielding: BudgetCategoryDetails.self
            ).first().timeout(.seconds(15), scheduler: DispatchQueue.main).values.first(where: {
                _ in true
            })
            guard let result else { throw BudgetCategoryLifecycleError.unavailable }
            return result
        }
        perform = { request in
            try await convexClient.mutation(request.function, with: request.arguments)
        }
        loadGroups = { workspaceID in
            // This hierarchy includes archived categories, unlike the visible budget plan.
            let result = try await convexClient.subscribe(
                to: "categories:listCategoriesHierarchical",
                with: ["workspaceId": workspaceID], yielding: [BudgetGroupDeletionDetails].self
            ).first().timeout(.seconds(15), scheduler: DispatchQueue.main).values.first(where: {
                _ in true
            })
            guard let result else { throw BudgetCategoryLifecycleError.unavailable }
            return result
        }
        unarchive = { workspaceID, categoryIDs in
            try await convexClient.mutation(
                "categories:archiveCategories",
                with: [
                    "workspaceId": workspaceID,
                    "categoryIds": categoryIDs.map { $0 as ConvexEncodable? }, "isArchived": false,
                ])
        }
        deleteGroup = { request in
            try await convexClient.mutation(request.function, with: request.arguments)
        }
    }

    init(
        load: @escaping (String, String) async throws -> BudgetCategoryDetails,
        perform: @escaping (BudgetCategoryActionRequest) async throws -> BudgetCategoryActionResult
    ) {
        self.load = load
        self.perform = perform
    }

    static var unavailable: Self {
        .init(
            load: { _, _ in throw BudgetCategoryLifecycleError.unavailable },
            perform: { _ in throw BudgetCategoryLifecycleError.unavailable })
    }
}

enum BudgetCategoryLifecycleError: Error { case unavailable }

@MainActor
@Observable
final class BudgetCategoryLifecycleStore: Identifiable {
    enum Phase { case loading, ready, saving, processing, completed, failed }
    let id = UUID()
    let workspaceID: String
    let category: BudgetCategory
    let action: BudgetCategoryAction
    private(set) var phase = Phase.loading
    private(set) var details: BudgetCategoryDetails?
    var destinationID: String?
    private(set) var errorMessage: String?
    @ObservationIgnored private let client: BudgetCategoryLifecycleClient
    @ObservationIgnored private var generation = UUID()

    init(
        workspaceID: String, category: BudgetCategory, action: BudgetCategoryAction,
        client: BudgetCategoryLifecycleClient
    ) {
        self.workspaceID = workspaceID
        self.category = category
        self.action = action
        self.client = client
    }

    var isBusy: Bool { phase == .loading || phase == .saving }
    var needsDestination: Bool { action == .delete && (details?.transactionCount ?? 0) > 0 }
    var canConfirm: Bool {
        phase == .ready && details?.canRemove == true
            && (!needsDestination || (destinationID != nil && destinationID != category.id))
    }

    func load() async {
        guard phase != .saving && phase != .processing && phase != .completed else { return }
        let generation = generation
        phase = .loading
        errorMessage = nil
        do {
            let details = try await client.load(workspaceID, category.id)
            guard self.generation == generation else { return }
            guard details._id == category.id else { throw BudgetCategoryLifecycleError.unavailable }
            self.details = details
            phase = .ready
            if !details.canRemove {
                errorMessage = L10n.string("This category is no longer available for this action.")
            }
        } catch {
            guard self.generation == generation else { return }
            phase = .failed
            errorMessage = L10n.string("Couldn't check this category. Please try again.")
        }
    }

    /// Recheck immediately before writing; the mutation checks its counter again atomically.
    func confirm(eligibleDestinationIDs: Set<String>, currentWorkspaceID: String?) async {
        guard canConfirm, currentWorkspaceID == workspaceID else { return }
        let generation = generation
        let destinationID = destinationID
        phase = .saving
        errorMessage = nil
        do {
            let fresh = try await client.load(workspaceID, category.id)
            guard self.generation == generation else { return }
            guard fresh._id == category.id, fresh.canRemove else {
                throw BudgetCategoryLifecycleError.unavailable
            }
            details = fresh
            if needsDestination {
                guard let destinationID, destinationID != category.id,
                    eligibleDestinationIDs.contains(destinationID)
                else {
                    phase = .ready
                    errorMessage =
                        L10n.string(
                            "This category has transactions. Choose where to move them before deleting."
                        )
                    return
                }
                let destination = try await client.load(workspaceID, destinationID)
                guard self.generation == generation else { return }
                guard destination._id == destinationID, destination.canRemove else {
                    self.destinationID = nil
                    phase = .ready
                    errorMessage =
                        L10n.string(
                            "That destination is no longer available. Choose another category.")
                    return
                }
            }
            let result = try await client.perform(
                .init(
                    workspaceID: workspaceID, categoryID: category.id, action: action,
                    destinationID: needsDestination ? destinationID : nil))
            guard self.generation == generation else { return }
            guard result.success else { throw BudgetCategoryLifecycleError.unavailable }
            phase = result.isAsync == true ? .processing : .completed
        } catch {
            guard self.generation == generation else { return }
            phase = .failed
            errorMessage = L10n.string(
                "Couldn't confirm this change. Check the category again before retrying.")
        }
    }

    func stop() { generation = UUID() }
}

struct BudgetGroupDeletionDetails: Decodable, Identifiable {
    struct Group: Decodable {
        let _id: String
        let name: String
        let type: String
        let isDeleted: Bool
        var isSystemGroup: Bool? = nil
        var isArchived: Bool? = nil

        var canRemove: Bool {
            !isDeleted && isSystemGroup != true && isArchived != true && type != "credit_card"
        }
    }

    let group: Group
    let categories: [BudgetCategory]
    var id: String { group._id }
}

struct BudgetGroupDeletionRequest {
    let workspaceID: String
    let groupID: String
    let destinationID: String?

    var function: String { "categoryGroups:deleteCategoryGroupWithMove" }
    var arguments: [String: ConvexEncodable?] {
        var args: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "categoryGroupId": groupID,
        ]
        if let destinationID { args["newCategoryGroupId"] = destinationID }
        return args
    }
}

@MainActor
@Observable
final class BudgetGroupDeletionStore: Identifiable {
    enum Phase { case loading, ready, saving, completed, failed }
    let id = UUID()
    let workspaceID: String
    let groupID: String
    let name: String
    private(set) var phase = Phase.loading
    private(set) var groups: [BudgetGroupDeletionDetails] = []
    private(set) var errorMessage: String?
    var destinationID: String?
    @ObservationIgnored private let client: BudgetCategoryLifecycleClient
    @ObservationIgnored private var generation = UUID()

    init(workspaceID: String, groupID: String, name: String, client: BudgetCategoryLifecycleClient)
    {
        self.workspaceID = workspaceID
        self.groupID = groupID
        self.name = name
        self.client = client
    }

    var source: BudgetGroupDeletionDetails? { groups.first { $0.id == groupID } }
    var destinations: [BudgetGroupDeletionDetails] {
        groups.filter { $0.id != groupID && $0.group.canRemove }
    }
    var needsDestination: Bool { source?.categories.isEmpty == false }
    var hasValidDestination: Bool { destinations.contains { $0.id == destinationID } }
    var canConfirm: Bool {
        phase == .ready && source?.group.canRemove == true
            && (!needsDestination || hasValidDestination)
    }

    func load() async {
        guard phase != .saving && phase != .completed else { return }
        let generation = UUID()
        self.generation = generation
        phase = .loading
        errorMessage = nil
        do {
            let groups = try await client.loadGroups(workspaceID)
            guard self.generation == generation else { return }
            self.groups = groups
            if !hasValidDestination { destinationID = nil }
            phase = .ready
            if source?.group.canRemove != true {
                errorMessage = L10n.string("This group is no longer available for deletion.")
            }
        } catch {
            guard self.generation == generation else { return }
            phase = .failed
            errorMessage = L10n.string("Couldn't check this group. Please try again.")
        }
    }

    func confirm(currentWorkspaceID: String?) async {
        guard canConfirm, currentWorkspaceID == workspaceID else { return }
        let generation = generation
        let selectedDestination = destinationID
        phase = .saving
        errorMessage = nil
        do {
            let groups = try await client.loadGroups(workspaceID)
            guard self.generation == generation else { return }
            self.groups = groups
            guard source?.group.canRemove == true else {
                throw BudgetCategoryLifecycleError.unavailable
            }
            if needsDestination && !destinations.contains(where: { $0.id == selectedDestination }) {
                destinationID = nil
                phase = .ready
                errorMessage = L10n.string("Choose a group for the categories before deleting.")
                return
            }
            let result = try await client.deleteGroup(
                .init(
                    workspaceID: workspaceID, groupID: groupID,
                    destinationID: needsDestination ? selectedDestination : nil))
            guard self.generation == generation else { return }
            guard result.success else { throw BudgetCategoryLifecycleError.unavailable }
            phase = .completed
        } catch {
            guard self.generation == generation else { return }
            phase = .failed
            errorMessage = L10n.string(
                "Couldn't delete this group. Check it again before retrying.")
        }
    }

    func stop() { generation = UUID() }
}

@MainActor
@Observable
final class BudgetArchivedCategoriesStore: Identifiable {
    let id = UUID()
    let workspaceID: String
    private(set) var groups: [BudgetGroupDeletionDetails] = []
    private(set) var isLoading = true
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    var selectedIDs: Set<String> = []
    @ObservationIgnored private let client: BudgetCategoryLifecycleClient
    @ObservationIgnored private var generation = UUID()

    init(workspaceID: String, client: BudgetCategoryLifecycleClient) {
        self.workspaceID = workspaceID
        self.client = client
    }

    var categoryIDs: Set<String> { Set(groups.flatMap(\.categories).map(\.id)) }
    var canUnarchive: Bool {
        !isLoading && !isSaving && !selectedIDs.intersection(categoryIDs).isEmpty
    }

    static func archivedGroups(in groups: [BudgetGroupDeletionDetails])
        -> [BudgetGroupDeletionDetails]
    {
        groups.compactMap { group in
            guard group.group.canRemove else { return nil }
            let archived = group.categories.filter {
                $0.isArchived == true && $0.isSystemCategory != true && $0.type != "credit_card"
            }
            return archived.isEmpty ? nil : .init(group: group.group, categories: archived)
        }
    }

    func load() async {
        guard !isSaving else { return }
        let generation = UUID()
        self.generation = generation
        isLoading = true
        errorMessage = nil
        defer { if self.generation == generation { isLoading = false } }
        do {
            let loaded = try await client.loadGroups(workspaceID)
            guard self.generation == generation else { return }
            groups = Self.archivedGroups(in: loaded)
            selectedIDs.formIntersection(categoryIDs)
        } catch {
            guard self.generation == generation else { return }
            errorMessage = L10n.string("Couldn't load archived categories. Please try again.")
        }
    }

    func unarchive(currentWorkspaceID: String?) async {
        guard canUnarchive, currentWorkspaceID == workspaceID else { return }
        let generation = generation
        let selected = selectedIDs.intersection(categoryIDs)
        isSaving = true
        errorMessage = nil
        defer { if self.generation == generation { isSaving = false } }
        do {
            let result = try await client.unarchive(workspaceID, selected.sorted())
            guard self.generation == generation else { return }
            guard result.success else { throw BudgetCategoryLifecycleError.unavailable }
            groups = groups.compactMap { group in
                let remaining = group.categories.filter { !selected.contains($0.id) }
                return remaining.isEmpty ? nil : .init(group: group.group, categories: remaining)
            }
            selectedIDs.subtract(selected)
        } catch {
            guard self.generation == generation else { return }
            errorMessage = L10n.string("Couldn't unarchive these categories. Please try again.")
        }
    }

    func stop() { generation = UUID() }
}
