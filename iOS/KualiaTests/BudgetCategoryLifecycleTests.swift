import ConvexMobile
import Foundation
import Testing

@testable import Kualia

@MainActor
struct BudgetCategoryLifecycleTests {
    private let category = BudgetCategory(
        _id: "food", name: "Dining out", iconName: nil, type: "expense")

    @Test
    func readsActualTransactionCountAndTreatsMissingCounterAsEmpty() throws {
        let count = try Int64(42).convexEncode()
        let json = """
            {"_id":"food","name":"Dining out","type":"expense","isDeleted":false,"transactionCount":\(count)}
            """
        let details = try JSONDecoder().decode(BudgetCategoryDetails.self, from: Data(json.utf8))
        #expect(details.transactionCount == 42)
        #expect(details.canRemove)
        let empty = """
            {"_id":"food","name":"Dining out","type":"expense","isDeleted":false}
            """
        #expect(
            try JSONDecoder().decode(BudgetCategoryDetails.self, from: Data(empty.utf8))
                .transactionCount == 0)
    }

    @Test
    func requestUsesArchiveFlagOrAnExplicitTransactionDestination() throws {
        let archive = BudgetCategoryActionRequest(
            workspaceID: "personal", categoryID: "food", action: .archive, destinationID: nil)
        #expect(archive.function == "categories:archiveCategories")
        #expect(try archive.arguments["isArchived"]??.convexEncode() == "true")
        #expect(try archive.arguments["categoryIds"]??.convexEncode() == "[\"food\"]")
        #expect(archive.arguments.keys.contains("newCategoryId") == false)
        let delete = BudgetCategoryActionRequest(
            workspaceID: "personal", categoryID: "food", action: .delete, destinationID: "groceries"
        )
        #expect(delete.function == "categories:deleteCategoriesWithRecategorization")
        #expect(try delete.arguments["newCategoryId"]??.convexEncode() == "\"groceries\"")
        #expect(!delete.arguments.keys.contains("isArchived"))
    }

    @Test
    func emptyCategoryCanBeDeletedWithoutDestination() async {
        var requests: [BudgetCategoryActionRequest] = []
        let store = makeStore(
            count: 0,
            perform: {
                requests.append($0)
                return .init(success: true)
            })
        await store.load()
        #expect(!store.needsDestination)
        #expect(store.canConfirm)
        await store.confirm(eligibleDestinationIDs: [], currentWorkspaceID: "personal")
        #expect(store.phase == .completed)
        #expect(requests.count == 1)
        #expect(requests.first?.destinationID == nil)
    }

    @Test
    func transactionsRequireAValidDestinationBeforeDeletion() async {
        var requests: [BudgetCategoryActionRequest] = []
        let store = makeStore(
            count: 5,
            perform: {
                requests.append($0)
                return .init(success: true)
            })
        await store.load()
        #expect(store.needsDestination)
        #expect(!store.canConfirm)
        store.destinationID = "food"
        #expect(!store.canConfirm)
        store.destinationID = "groceries"
        await store.confirm(eligibleDestinationIDs: ["groceries"], currentWorkspaceID: "personal")
        #expect(requests.count == 1)
        #expect(requests.first?.destinationID == "groceries")
        #expect(store.phase == .completed)
    }

    @Test
    func archiveRetainsTransactionsWithoutRequestingADestination() async {
        var requests: [BudgetCategoryActionRequest] = []
        let store = makeStore(
            count: 50, action: .archive,
            perform: {
                requests.append($0)
                return .init(success: true)
            })
        await store.load()
        #expect(!store.needsDestination)
        #expect(store.canConfirm)
        await store.confirm(eligibleDestinationIDs: [], currentWorkspaceID: "personal")
        #expect(store.phase == .completed)
        #expect(requests.first?.action == .archive)
        #expect(requests.first?.destinationID == nil)
    }

    @Test
    func aNewTransactionAfterPreviewRequiresNewConfirmation() async {
        var count: Int64 = 0
        var writes = 0
        let store = BudgetCategoryLifecycleStore(
            workspaceID: "personal", category: category, action: .delete,
            client: .init(
                load: { _, id in .init(id: id, name: "Dining out", transactionCount: count) },
                perform: { _ in
                    writes += 1
                    return .init(success: true)
                }))
        await store.load()
        #expect(store.canConfirm)
        count = 1
        await store.confirm(eligibleDestinationIDs: ["groceries"], currentWorkspaceID: "personal")
        #expect(writes == 0)
        #expect(store.phase == .ready)
        #expect(store.needsDestination)
        #expect(store.errorMessage != nil)
    }

    @Test
    func anArchivedDestinationCannotReceiveTransactions() async {
        var writes = 0
        let store = BudgetCategoryLifecycleStore(
            workspaceID: "personal", category: category, action: .delete,
            client: .init(
                load: { _, id in
                    .init(id: id, name: id, transactionCount: 1, isArchived: id == "groceries")
                },
                perform: { _ in
                    writes += 1
                    return .init(success: true)
                }))
        await store.load()
        store.destinationID = "groceries"
        await store.confirm(eligibleDestinationIDs: ["groceries"], currentWorkspaceID: "personal")
        #expect(writes == 0)
        #expect(store.destinationID == nil)
        #expect(store.phase == .ready)
    }

    @Test
    func rejectsCreditCardSystemDeletedAndArchivedSources() async {
        let details: [BudgetCategoryDetails] = [
            .init(id: "food", name: "Food", type: "credit_card"),
            .init(id: "food", name: "Food", isDeleted: true),
            .init(id: "food", name: "Food", isArchived: true),
            .init(id: "food", name: "Food", isSystemCategory: true),
        ]
        for value in details {
            let store = BudgetCategoryLifecycleStore(
                workspaceID: "personal", category: category, action: .delete,
                client: .init(
                    load: { _, _ in value },
                    perform: { _ in
                        Issue.record("Unavailable category must not be deleted")
                        return .init(success: false)
                    }))
            await store.load()
            #expect(!store.canConfirm)
            #expect(store.errorMessage != nil)
            await store.confirm(eligibleDestinationIDs: [], currentWorkspaceID: "personal")
        }
    }

    @Test
    func failedChecksNeverBecomeAnEmptyCategoryConfirmation() async {
        let store = BudgetCategoryLifecycleStore(
            workspaceID: "personal", category: category, action: .delete, client: .unavailable)
        await store.load()
        #expect(store.phase == .failed)
        #expect(store.details == nil)
        #expect(!store.canConfirm)
    }

    @Test
    func backgroundDeletionIsShownAsProcessingRatherThanCompleted() async {
        let store = makeStore(count: 600, perform: { _ in .init(success: true, isAsync: true) })
        await store.load()
        store.destinationID = "groceries"
        await store.confirm(eligibleDestinationIDs: ["groceries"], currentWorkspaceID: "personal")
        #expect(store.phase == .processing)
        #expect(!store.canConfirm)
        await store.load()
        #expect(store.phase == .processing)
    }

    @Test
    func failedWritesKeepDestinationAndRequireARecheck() async {
        let store = makeStore(
            count: 5, perform: { _ in throw BudgetCategoryLifecycleError.unavailable })
        await store.load()
        store.destinationID = "groceries"
        await store.confirm(eligibleDestinationIDs: ["groceries"], currentWorkspaceID: "personal")
        #expect(store.phase == .failed)
        #expect(store.destinationID == "groceries")
        #expect(!store.canConfirm)
        await store.load()
        #expect(store.canConfirm)
    }

    @Test
    func workspaceChangeOrDismissalPreventsStaleWrites() async {
        var writes = 0
        var pause = false
        var continuation: CheckedContinuation<BudgetCategoryDetails, Never>?
        let store = BudgetCategoryLifecycleStore(
            workspaceID: "personal", category: category, action: .delete,
            client: .init(
                load: { _, id in
                    if pause { return await withCheckedContinuation { continuation = $0 } }
                    return .init(id: id, name: "Food")
                },
                perform: { _ in
                    writes += 1
                    return .init(success: true)
                }))
        await store.load()
        await store.confirm(eligibleDestinationIDs: [], currentWorkspaceID: "other")
        #expect(writes == 0)
        pause = true
        let task = Task {
            await store.confirm(eligibleDestinationIDs: [], currentWorkspaceID: "personal")
        }
        for _ in 0..<100 where continuation == nil { await Task.yield() }
        #expect(continuation != nil)
        store.stop()
        continuation?.resume(returning: .init(id: "food", name: "Food"))
        await task.value
        #expect(writes == 0)
    }

    private func makeStore(
        count: Int64, action: BudgetCategoryAction = .delete,
        perform: @escaping (BudgetCategoryActionRequest) async throws -> BudgetCategoryActionResult
    ) -> BudgetCategoryLifecycleStore {
        .init(
            workspaceID: "personal", category: category, action: action,
            client: .init(
                load: { _, id in .init(id: id, name: id, transactionCount: id == "food" ? count : 0)
                }, perform: perform))
    }
}

@MainActor
struct BudgetGroupDeletionTests {
    private func group(
        _ id: String, count: Int = 0, type: String = "expense",
        deleted: Bool = false, system: Bool = false, archived: Bool = false
    ) -> BudgetGroupDeletionDetails {
        .init(
            group: .init(
                _id: id, name: id, type: type, isDeleted: deleted,
                isSystemGroup: system, isArchived: archived),
            categories: (0..<count).map {
                .init(_id: "\(id)-\($0)", name: "Category", iconName: nil, type: type)
            })
    }

    private func store(
        load: @escaping (String) async throws -> [BudgetGroupDeletionDetails],
        perform: @escaping (BudgetGroupDeletionRequest) async throws -> BudgetCategoryActionResult
    ) -> BudgetGroupDeletionStore {
        var client = BudgetCategoryLifecycleClient.unavailable
        client.loadGroups = load
        client.deleteGroup = perform
        return .init(workspaceID: "personal", groupID: "source", name: "Source", client: client)
    }

    @Test func decodesArchivedCategoriesAndSystemGroupProtection() throws {
        let json = """
            [{"group":{"_id":"source","name":"Source","type":"expense","isDeleted":false,"isSystemGroup":true},
            "categories":[{"_id":"hidden","name":"Hidden","type":"expense","isArchived":true}]}]
            """
        let groups = try JSONDecoder().decode(
            [BudgetGroupDeletionDetails].self, from: Data(json.utf8))
        #expect(groups.first?.categories.count == 1)
        #expect(groups.first?.group.canRemove == false)
    }

    @Test func deletionUsesOneAtomicMoveRequest() throws {
        let move = BudgetGroupDeletionRequest(
            workspaceID: "personal", groupID: "source", destinationID: "destination")
        #expect(move.function == "categoryGroups:deleteCategoryGroupWithMove")
        #expect(try move.arguments["categoryGroupId"]??.convexEncode() == "\"source\"")
        #expect(try move.arguments["newCategoryGroupId"]??.convexEncode() == "\"destination\"")
        #expect(try move.arguments["workspaceId"]??.convexEncode() == "\"personal\"")
        let empty = BudgetGroupDeletionRequest(
            workspaceID: "personal", groupID: "source", destinationID: nil)
        #expect(!empty.arguments.keys.contains("newCategoryGroupId"))
    }

    @Test func emptyGroupNeedsNoDestination() async {
        var requests: [BudgetGroupDeletionRequest] = []
        let store = store(
            load: { _ in [group("source")] },
            perform: {
                requests.append($0)
                return .init(success: true)
            })
        await store.load()
        #expect(store.canConfirm)
        #expect(!store.needsDestination)
        await store.confirm(currentWorkspaceID: "personal")
        #expect(store.phase == .completed)
        #expect(requests.count == 1)
        #expect(requests.first?.destinationID == nil)
    }

    @Test func populatedGroupRequiresAnotherEligibleGroup() async {
        var requests: [BudgetGroupDeletionRequest] = []
        let store = store(
            load: { _ in
                [
                    group("source", count: 2), group("destination"),
                    group("credit", type: "credit_card"), group("system", system: true),
                    group("deleted", deleted: true), group("archived", archived: true),
                ]
            },
            perform: {
                requests.append($0)
                return .init(success: true)
            })
        await store.load()
        #expect(store.destinations.map(\.id) == ["destination"])
        for invalid: String? in [nil, "source", "credit", "system", "deleted", "archived"] {
            store.destinationID = invalid
            #expect(!store.canConfirm)
            await store.confirm(currentWorkspaceID: "personal")
        }
        #expect(requests.isEmpty)
        store.destinationID = "destination"
        await store.confirm(currentWorkspaceID: "personal")
        #expect(store.phase == .completed)
        #expect(requests.count == 1)
        #expect(requests.first?.destinationID == "destination")
    }

    @Test func freshCategoriesOrRemovedDestinationRequireAnotherReview() async {
        for initiallyEmpty in [true, false] {
            var fresh = false
            var writes = 0
            let store = store(
                load: { _ in
                    [group("source", count: initiallyEmpty && !fresh ? 0 : 1)]
                        + (fresh ? [] : [group("destination")])
                },
                perform: { _ in
                    writes += 1
                    return .init(success: true)
                })
            await store.load()
            if !initiallyEmpty { store.destinationID = "destination" }
            #expect(store.canConfirm)
            fresh = true
            await store.confirm(currentWorkspaceID: "personal")
            #expect(writes == 0)
            #expect(store.phase == .ready)
            #expect(store.needsDestination)
            #expect(store.destinationID == nil)
            #expect(store.errorMessage != nil)
        }
    }

    @Test func protectedSourceOrDifferentWorkspaceCannotBeDeleted() async {
        for source in [
            group("source", type: "credit_card"), group("source", system: true),
            group("source", deleted: true), group("source", archived: true),
        ] {
            var writes = 0
            let store = store(
                load: { _ in [source] },
                perform: { _ in
                    writes += 1
                    return .init(success: true)
                })
            await store.load()
            #expect(!store.canConfirm)
            await store.confirm(currentWorkspaceID: "personal")
            #expect(writes == 0)
        }
        let store = store(
            load: { _ in [group("source")] },
            perform: { _ in
                Issue.record("Must not write to a different workspace")
                return .init(success: true)
            })
        await store.load()
        await store.confirm(currentWorkspaceID: "family")
        #expect(store.phase == .ready)
    }

    @Test func stoppingDuringRecheckPreventsTheMutation() async {
        var recheck: CheckedContinuation<[BudgetGroupDeletionDetails], Never>?
        var reads = 0
        var writes = 0
        let store = store(
            load: { _ in
                reads += 1
                if reads == 1 { return [group("source")] }
                return await withCheckedContinuation { recheck = $0 }
            },
            perform: { _ in
                writes += 1
                return .init(success: true)
            })
        await store.load()
        let task = Task { await store.confirm(currentWorkspaceID: "personal") }
        while recheck == nil { await Task.yield() }
        store.stop()
        recheck?.resume(returning: [group("source")])
        await task.value
        #expect(writes == 0)
    }

    @Test func unsuccessfulMutationRequiresReloadBeforeRetry() async {
        let store = store(
            load: { _ in [group("source")] },
            perform: { _ in
                .init(success: false)
            })
        await store.load()
        await store.confirm(currentWorkspaceID: "personal")
        #expect(store.phase == .failed)
        #expect(!store.canConfirm)
        #expect(store.errorMessage != nil)
        await store.load()
        #expect(store.canConfirm)
    }
}

@MainActor
struct BudgetArchivedCategoriesTests {
    private func group(_ id: String, categories: [BudgetCategory]) -> BudgetGroupDeletionDetails {
        .init(
            group: .init(_id: id, name: id, type: "expense", isDeleted: false),
            categories: categories)
    }

    private func category(_ id: String, archived: Bool = true) -> BudgetCategory {
        .init(_id: id, name: id, iconName: nil, type: "expense", isArchived: archived)
    }

    @Test func onlyOffersArchivedCategoriesAndRestoresTheSelection() async {
        var client = BudgetCategoryLifecycleClient.unavailable
        client.loadGroups = { _ in
            [
                group(
                    "day-to-day",
                    categories: [category("archived"), category("active", archived: false)]),
                group("savings", categories: [category("other")]),
            ]
        }
        var submitted: [String] = []
        client.unarchive = { workspaceID, ids in
            #expect(workspaceID == "personal")
            submitted = ids
            return .init(success: true)
        }
        let store = BudgetArchivedCategoriesStore(workspaceID: "personal", client: client)
        await store.load()
        #expect(store.categoryIDs == ["archived", "other"])
        #expect(!store.canUnarchive)
        store.selectedIDs = ["archived", "active", "stale"]
        await store.unarchive(currentWorkspaceID: "personal")
        #expect(submitted == ["archived"])
        #expect(store.categoryIDs == ["other"])
        #expect(!store.canUnarchive)
    }

    @Test func failedUnarchiveKeepsSelectionForRetry() async {
        var client = BudgetCategoryLifecycleClient.unavailable
        client.loadGroups = { _ in [group("group", categories: [category("archived")])] }
        client.unarchive = { _, _ in throw BudgetCategoryLifecycleError.unavailable }
        let store = BudgetArchivedCategoriesStore(workspaceID: "personal", client: client)
        await store.load()
        store.selectedIDs = ["archived"]
        await store.unarchive(currentWorkspaceID: "personal")
        #expect(store.selectedIDs == ["archived"])
        #expect(store.categoryIDs == ["archived"])
        #expect(store.errorMessage != nil)
        #expect(store.canUnarchive)
    }

    @Test func workspaceSwitchAndDoubleSubmissionCannotRestoreCategories() async {
        var client = BudgetCategoryLifecycleClient.unavailable
        client.loadGroups = { _ in [group("group", categories: [category("archived")])] }
        var continuation: CheckedContinuation<BudgetCategoryActionResult, Never>?
        var calls = 0
        client.unarchive = { _, _ in
            calls += 1
            return await withCheckedContinuation { continuation = $0 }
        }
        let store = BudgetArchivedCategoriesStore(workspaceID: "personal", client: client)
        await store.load()
        store.selectedIDs = ["archived"]
        await store.unarchive(currentWorkspaceID: "other")
        #expect(calls == 0)
        let request = Task { await store.unarchive(currentWorkspaceID: "personal") }
        for _ in 0..<100 where continuation == nil { await Task.yield() }
        #expect(store.isSaving)
        await store.unarchive(currentWorkspaceID: "personal")
        #expect(calls == 1)
        store.stop()
        continuation?.resume(returning: .init(success: true))
        await request.value
        #expect(store.categoryIDs == ["archived"])
    }

    @Test func failedLoadCanBeRetriedAndRemovesStaleSelections() async {
        var client = BudgetCategoryLifecycleClient.unavailable
        var attempts = 0
        client.loadGroups = { _ in
            attempts += 1
            if attempts == 1 { throw BudgetCategoryLifecycleError.unavailable }
            return []
        }
        let store = BudgetArchivedCategoriesStore(workspaceID: "personal", client: client)
        await store.load()
        #expect(!store.isLoading)
        #expect(store.errorMessage != nil)
        store.selectedIDs = ["gone"]
        await store.load()
        #expect(store.groups.isEmpty)
        #expect(store.selectedIDs.isEmpty)
        #expect(store.errorMessage == nil)
    }
}
