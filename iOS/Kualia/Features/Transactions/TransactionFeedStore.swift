import Combine
import ConvexMobile
import Foundation
import OSLog
import Observation

struct TransactionFeedSubscriptionRequest: Equatable {
    let numItems: Int
    let cursor: String?
    let endCursor: String?
    let paginationID: Int
    let workspaceID: String?
    var bankAccountID: String? = nil
    var filter: TransactionFeedFilter = .all

    var arguments: [String: ConvexEncodable?] {
        let paginationOptions: [String: ConvexEncodable?] = [
            "numItems": Double(numItems),
            "cursor": cursor,
            "endCursor": endCursor,
            "id": Double(paginationID),
            "maximumRowsRead": 200.0,
            "maximumBytesRead": 1_000_000.0,
        ]
        var arguments: [String: ConvexEncodable?] = [
            "paginationOpts": paginationOptions,
            "includeFilterCounts": cursor == nil && filter == .all,
            "includeFilterTransactions": cursor == nil && filter == .all,
        ]
        if let workspaceID { arguments["workspaceId"] = workspaceID }
        if let bankAccountID { arguments["bankAccountId"] = bankAccountID }
        if let flow = filter.searchFlow {
            let search: [String: ConvexEncodable?] = ["text": "", "flow": flow.rawValue]
            arguments["search"] = search
        } else if filter != .all {
            arguments["filter"] = filter.rawValue
        }
        return arguments
    }
}

@MainActor
@Observable
final class TransactionFeedStore {
    private var detailStoreFactory: ((String) -> TransactionEditorStore?)?
    private var creationStoreFactory: (() -> TransactionEditorStore)?
    private var searchStoreFactory: ((TransactionSearchFilters, Bool) -> TransactionSearchStore)?
    private var categoryHistoryFactory: ((String) -> BudgetCategoryHistoryStore)?
    typealias SubscriptionFactory =
        (TransactionFeedSubscriptionRequest) -> AnyPublisher<TransactionFeedResponse, Error>

    typealias MutationHandler = (String, [String], TransactionFeedAction) async throws ->
        [TransactionBudgetChange]

    typealias SelectionEditHandler = (String, [String], TransactionSelectionEdit) async throws ->
        Void

    private(set) var filter: TransactionFeedFilter = .all
    private(set) var showsReconciledTransactions = true

    var hasActiveFilters: Bool { filter != .all || !showsReconciledTransactions }

    var showsReconciledTransactionsPrompt: Bool {
        !showsReconciledTransactions && hasLoaded && workspace != nil && !isLoading
            && !isLoadingMore
            && !hasMore && errorMessage == nil
    }

    var canLoadMoreFromFooter: Bool {
        hasLoaded && hasMore && !isLoadingMore && errorMessage == nil
    }

    func setShowsReconciledTransactions(_ showsReconciledTransactions: Bool) {
        guard self.showsReconciledTransactions != showsReconciledTransactions else { return }
        self.showsReconciledTransactions = showsReconciledTransactions
        endSelection()
        rebuildPresentation(animateMembershipChanges: false)
    }

    private func matchesFilters(_ item: TransactionFeedItem) -> Bool {
        filter.matchesFlow(of: item) && (showsReconciledTransactions || item.status != .reconciled)
    }

    private var keepsEmptyFilter = false
    private(set) var filterCounts = TransactionFeedFilterCounts()
    private(set) var filterCountsAreComplete = true
    var visibleFilters: [TransactionFeedFilter] {
        TransactionFeedFilter.allCases.filter {
            $0 == .all || (keepsEmptyFilter && $0 == filter)
                || !filterCountsAreComplete || (filterCounts.count(for: $0).map { $0 > 0 } ?? true)
        }
    }
    var transferReviewEditor: TransactionEditorStore?

    func selectFilter(_ filter: TransactionFeedFilter) {
        selectFilter(filter, keepEmpty: false)
    }

    func selectFilter(_ filter: TransactionFeedFilter, keepEmpty: Bool) {
        keepsEmptyFilter = keepEmpty
        guard self.filter != filter else { return }
        self.filter = filter
        endSelection()
        // Small queues arrive with All. Large queues retain their own live pages
        // so switching filters never discards previously loaded history.
        guard firstPageResponse != nil else { return }
        startSelectedFilterIfNeeded()
        rebuildPresentation(animateMembershipChanges: false)
    }

    private(set) var isSelecting = false
    private(set) var selectedIDs: Set<String> = []
    private(set) var isSavingSelection = false
    private(set) var isRestoringSelection = false
    private(set) var selectionSaveRevision = 0
    private(set) var selectionConfirmationMessage: String?
    var showsSelectionEditor = false
    @ObservationIgnored private var selectionStatusOverrides: [String: TransactionFeedStatus] = [:]
    @ObservationIgnored private var selectionEditHandler: SelectionEditHandler = { _, _, _ in
        throw FeedError.mutationsUnavailable
    }

    var selectionSummary: TransactionSelectionSummary {
        .init(entries: sections.flatMap(\.entries).filter { selectedIDs.contains($0.id) })
    }

    func beginSelection(_ entry: TransactionFeedEntry) {
        guard !isPerformingAction,
            sections.flatMap(\.entries).contains(where: { $0.id == entry.id })
        else { return }
        isSelecting = true
        selectedIDs.insert(entry.id)
    }

    func toggleSelection(_ entry: TransactionFeedEntry) {
        guard isSelecting, !isPerformingAction else { return }
        if selectedIDs.contains(entry.id) {
            selectedIDs.remove(entry.id)
        } else {
            selectedIDs.insert(entry.id)
        }
    }

    func presentSelectionEditor() {
        guard isSelecting, !isPerformingAction, selectionSummary.count > 0 else { return }
        showsSelectionEditor = true
    }

    func dismissSelectionConfirmation(revision: Int) {
        guard revision == selectionSaveRevision, !isSavingSelection, actionErrorMessage == nil
        else { return }
        selectionConfirmationMessage = nil
        selectionDeletionUndo = nil
    }

    func endSelection() {
        selectionDeletionUndo = nil
        selectionConfirmationMessage = nil
        isSelecting = false
        selectedIDs = []
        showsSelectionEditor = false
    }

    var hasSelectionDeletionUndo: Bool {
        isSelecting && selectionDeletionUndo != nil && selectionConfirmationMessage != nil
    }

    func undoSelectionDeletion() async {
        guard hasSelectionDeletionUndo, !isPerformingAction,
            let undo = selectionDeletionUndo, let workspace
        else { return }
        let generation = actionGeneration
        selectionConfirmationMessage = nil
        isPerformingAction = true
        isSavingSelection = true
        isRestoringSelection = true
        actionErrorMessage = nil
        defer {
            if generation == actionGeneration {
                isPerformingAction = false
                isSavingSelection = false
                isRestoringSelection = false
            }
        }
        do {
            _ = try await mutationHandler(workspace.id, undo.transactionIDs, .restore)
            guard generation == actionGeneration else { return }
            for (groupID, original) in undo.snapshots {
                var snapshot = original
                snapshot.isRestoring = true
                deletionSnapshots[groupID] = snapshot
                restoredDeletionGroupIDs.insert(groupID)
                hiddenDeletionGroupIDs.remove(groupID)
            }
            rebuildPresentation()
            selectionDeletionUndo = nil
            if isSelecting {
                selectedIDs.formUnion(
                    Set(undo.transactionIDs).intersection(
                        sections.flatMap { $0.entries.map(\.id) }))
                selectionConfirmationMessage = L10n.string("Transactions restored")
            }
            selectionSaveRevision += 1
        } catch {
            guard generation == actionGeneration else { return }
            if isSelecting {
                selectionDeletionUndo = undo
                selectionConfirmationMessage = L10n.string("Transactions deleted")
            }
            actionErrorMessage = L10n.string("Couldn't restore the transactions. Please try again.")
            selectionSaveRevision += 1
        }
    }

    func performSelection(_ action: TransactionFeedAction) async {
        guard
            action == .delete || action == selectionSummary.statusAction
                || action == selectionSummary.approvalAction
        else { return }
        await saveSelection(action: action, edit: nil)
    }

    func editSelection(_ edit: TransactionSelectionEdit) async {
        guard edit.field != .merchant || selectionSummary.canEditMerchant,
            edit.field != .account || selectionSummary.canEditAccount
        else { return }
        await saveSelection(action: nil, edit: edit)
    }

    private func saveSelection(action: TransactionFeedAction?, edit: TransactionSelectionEdit?)
        async
    {
        let entries = selectionSummary.entries.filter {
            action != .approve || $0.reviewStatus == .needsReview
        }
        guard isSelecting, !isPerformingAction, !entries.isEmpty, let workspace else { return }
        let generation = actionGeneration
        let ids = entries.map(\.id)
        let items = action == .delete ? presentedItems() : []
        let deletion =
            action == .delete
            ? SelectionDeletionUndo(
                transactionIDs: ids,
                snapshots: Dictionary(
                    uniqueKeysWithValues: Set(entries.map(\.deletionGroupID)).map { groupID in
                        (
                            groupID,
                            DeletionSnapshot(
                                items: items.filter { ($0.transferGroupId ?? $0.id) == groupID },
                                originalOrder: items.map(\.id))
                        )
                    })) : nil
        selectionDeletionUndo = nil
        showsSelectionEditor = false
        selectionConfirmationMessage = nil
        isPerformingAction = true
        isSavingSelection = true
        actionErrorMessage = nil
        defer {
            if generation == actionGeneration {
                isPerformingAction = false
                isSavingSelection = false
            }
        }
        do {
            if let edit {
                try await selectionEditHandler(workspace.id, ids, edit)
            } else if let action {
                _ = try await mutationHandler(workspace.id, ids, action)
            }
            guard generation == actionGeneration else { return }
            if action == .delete {
                if isSelecting { selectionDeletionUndo = deletion }
                let groups = Set(entries.map(\.deletionGroupID))
                hiddenDeletionGroupIDs.formUnion(groups)
                selectedIDs.subtract(ids)
            } else if case .setStatus(let status) = action {
                let groups = Set(entries.filter { $0.status != .reconciled }.map(\.deletionGroupID))
                for item in loadedItems
                where item.status != .reconciled
                    && groups.contains(item.transferGroupId ?? item.id)
                {
                    selectionStatusOverrides[item.id] = item.status == status ? nil : status
                }
            }
            rebuildPresentation()
            // Refresh widget data without replacing the persistent selection peek.
            selectionSaveRevision += 1
            if isSelecting {
                selectionConfirmationMessage =
                    action == .delete
                    ? L10n.string("Transactions deleted") : L10n.string("Edits saved")
            }
        } catch {
            guard generation == actionGeneration else { return }
            actionErrorMessage = L10n.string(
                "Couldn't update the selected transactions. Please try again.")
        }
    }

    private(set) var latestMutationReceipt: TransactionMutationReceipt?
    private(set) var mutationReceiptRevision = 0
    private(set) var isPerformingAction = false
    var actionErrorMessage: String?
    private(set) var deletedEntries: [TransactionFeedEntry] = []
    @ObservationIgnored private var actionGeneration = UUID()
    @ObservationIgnored private var categorizationTask: Task<Void, Never>?
    @ObservationIgnored private var hiddenDeletionGroupIDs: Set<String> = []
    private struct DeletionSnapshot {
        let items: [TransactionFeedItem]
        let originalOrder: [String]
        var budgetChanges: [TransactionBudgetChange] = []
        var isRestoring = false
        var confirmedRestoredIDs: Set<String> = []
    }
    private struct SelectionDeletionUndo {
        let transactionIDs: [String]
        let snapshots: [String: DeletionSnapshot]
    }
    private var selectionDeletionUndo: SelectionDeletionUndo?
    @ObservationIgnored private var deletionSnapshots: [String: DeletionSnapshot] = [:]
    @ObservationIgnored private var restoredDeletionGroupIDs: Set<String> = []
    @ObservationIgnored private var activeDeletionGroupID: String?
    @ObservationIgnored private var queuedUndoReceipt: TransactionMutationReceipt?

    var canUndoDeletion: Bool {
        guard let entry = deletedEntries.last,
            deletionSnapshots[entry.deletionGroupID]?.isRestoring != true
        else { return false }
        return !isPerformingAction || activeDeletionGroupID == entry.deletionGroupID
    }

    @ObservationIgnored private let mutationHandler: MutationHandler
    @ObservationIgnored private var choicesStore: TransactionEditorChoicesStore?
    @ObservationIgnored private var editorClient: ConvexClientWithAuth<String>?
    @ObservationIgnored private var plannedStoreFactory:
        ((TransactionFeedWorkspace) -> PlannedStore)?
    private(set) var agenda: PlannedStore?
    @ObservationIgnored private let undoDisplayDuration: Duration
    @ObservationIgnored private var undoDismissalTask: Task<Void, Never>?

    @ObservationIgnored private var bankAccountID: String?

    private static let pageSize = 50
    private static var paginationSequence = 0

    private(set) var workspace: TransactionFeedWorkspace? {
        didSet {
            guard workspace != oldValue else { return }
            agenda?.stop()
            agenda = nil
        }
    }
    private(set) var sections: [TransactionFeedSection] = []
    private(set) var rowTransitionRevision = 0
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var hasMore = false
    private(set) var errorMessage: String?

    @ObservationIgnored private let subscriptionFactory: SubscriptionFactory
    @ObservationIgnored private let firstResponseTimeout: Duration
    @ObservationIgnored private let requestedWorkspaceID: String?
    @ObservationIgnored private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "Kualia",
        category: "TransactionFeed"
    )
    @ObservationIgnored private var subscriptions: [Int: AnyCancellable] = [:]
    @ObservationIgnored private var responseDeadlines: [Int: Task<Void, Never>] = [:]
    @ObservationIgnored private var subscriptionAttempts: [Int: UUID] = [:]
    @ObservationIgnored private var pageRequests: [TransactionFeedSubscriptionRequest] = []
    @ObservationIgnored private var pageResponses: [Int: TransactionFeedResponse] = [:]
    private struct PendingSplit {
        var range: Range<Int>
        let response: TransactionFeedResponse?
    }
    @ObservationIgnored private var pendingSplits: [PendingSplit] = []
    @ObservationIgnored private var pageErrors: [Int: Error] = [:]
    @ObservationIgnored private var failedPageIndex: Int?
    @ObservationIgnored private var subscriptionGeneration = 0
    @ObservationIgnored private var isActive = false

    init(
        convexClient: ConvexClientWithAuth<String>, workspaceID: String? = nil,
        bankAccountID: String? = nil, workspace: TransactionFeedWorkspace? = nil,
        choicesStore: TransactionEditorChoicesStore? = nil
    ) {
        self.requestedWorkspaceID = workspaceID ?? workspace?.id
        self.bankAccountID = bankAccountID
        self.workspace = workspace
        self.editorClient = convexClient
        self.choicesStore = choicesStore
        self.undoDisplayDuration = .seconds(6)
        self.mutationHandler = { workspaceID, transactionIDs, action in
            guard let mutationName = action.mutationName else { throw FeedError.mutationFailed }
            var arguments: [String: ConvexEncodable?] = [
                "workspaceId": workspaceID,
                "transactionIds": transactionIDs.map { $0 as ConvexEncodable? },
            ]
            if case .setStatus(let status) = action {
                arguments["status"] = status.rawValue
            }
            if action == .delete || action == .restore { arguments["includeBudgetChanges"] = true }
            let result: FeedMutationResult = try await convexClient.mutation(
                mutationName, with: arguments
            )
            guard result.success else { throw FeedError.mutationFailed }
            return result.budgetChanges ?? []
        }
        self.selectionEditHandler = { workspaceID, ids, edit in
            let result: FeedMutationResult = try await convexClient.mutation(
                "transactions:updateTransactions",
                with: edit.arguments(workspaceID: workspaceID, transactionIDs: ids))
            guard result.success else { throw FeedError.mutationFailed }
        }
        self.firstResponseTimeout = .seconds(15)
        self.subscriptionFactory = { request in
            convexClient
                .subscribe(
                    to: "transactions:listTransactionFeed",
                    with: request.arguments,
                    yielding: TransactionFeedResponse.self
                )
                .mapError { $0 as Error }
                .eraseToAnyPublisher()
        }
    }

    /// The launch page already knows the workspace. Shared creation actions should
    /// work before the transaction list has ever been mounted or subscribed.
    func prepareForBudgetWorkspace(_ budgetWorkspace: BudgetWorkspace?) {
        let next = budgetWorkspace.map {
            TransactionFeedWorkspace(
                id: $0.id, name: $0.name, currencyCode: $0.currencyCode,
                minorUnit: $0.minorUnit, timezoneIdentifier: $0.timezoneIdentifier)
        }
        guard workspace != next else { return }
        if let requestedWorkspaceID {
            guard next?.id == requestedWorkspaceID else { return }
            // Metadata can arrive before the already-scoped first transaction page.
            // Do not restart that in-flight subscription or discard its pagination.
            workspace = next
            return
        }
        if workspace?.id != next?.id {
            let shouldRestart = isActive
            reset()
            workspace = next
            if shouldRestart { start() }
        } else {
            workspace = next
        }
    }

    var canSearchTransactions: Bool {
        workspace != nil && (editorClient != nil || searchStoreFactory != nil)
    }
    var canCreateTransaction: Bool {
        workspace != nil && (editorClient != nil || creationStoreFactory != nil)
    }

    private func makePlannedStore() -> PlannedStore? {
        guard let workspace else { return nil }
        if let plannedStoreFactory { return plannedStoreFactory(workspace) }
        guard let editorClient else { return nil }
        return PlannedStore(
            workspace: workspace, convexClient: editorClient, choicesStore: choicesStore)
    }

    /// Prepared by the workspace session as metadata arrives, never by a page.
    func prepareAgenda() {
        if agenda == nil { agenda = makePlannedStore() }
        if isActive { agenda?.start() }
    }

    func makeCreationEditor(date: String? = nil) -> TransactionEditorStore? {
        guard let workspace else { return nil }
        let editor: TransactionEditorStore
        if let creationStoreFactory {
            editor = creationStoreFactory()
        } else if let editorClient {
            editor = TransactionEditorStore(
                workspace: workspace, convexClient: editorClient, choicesStore: choicesStore)
        } else {
            return nil
        }
        if let date { editor.preselectDate(date) }
        return editor
    }

    var canDuplicateSelection: Bool {
        isSelecting && !isPerformingAction && selectionSummary.count == 1 && canCreateTransaction
    }

    func makeSelectionDuplicateEditor() -> TransactionEditorStore? {
        guard canDuplicateSelection, let entry = selectionSummary.entries.first,
            let editor = makeCreationEditor()
        else { return nil }
        editor.prepareDuplication(of: entry.id)
        return editor
    }

    func makeEditor(for transactionID: String) -> TransactionEditorStore? {
        if let detailStoreFactory { return detailStoreFactory(transactionID) }
        guard let workspace, let editorClient else { return nil }
        return TransactionEditorStore(
            workspace: workspace, transactionID: transactionID, convexClient: editorClient,
            choicesStore: choicesStore
        )
    }

    func makeCategoryHistoryStore(categoryID: String, now: Date = Date())
        -> BudgetCategoryHistoryStore?
    {
        if let categoryHistoryFactory { return categoryHistoryFactory(categoryID) }
        guard let workspace, let client = editorClient else { return nil }
        let month = BudgetMonth.current(now: now, timezoneIdentifier: workspace.timezoneIdentifier)
        let filters = BudgetCategoryMonth.historyFilters(
            categoryID: categoryID, workspace: workspace, now: now)
        guard let start = filters.startDate, let end = filters.endDate else { return nil }
        let range = ReportRange(start: start, end: end)
        let request = ReportSummaryRequest(
            workspaceID: workspace.id, range: range, comparison: range, kind: .spending,
            filters: .init(categoryIDs: [categoryID], includesPending: true))
        return BudgetCategoryHistoryStore(month: month) {
            var arguments = request.arguments
            arguments["comparison"] = ["start": start, "end": end] as [String: ConvexEncodable?]
            let analysis: ReportAnalysis = try await client.action(
                "reports:getExplorerSummary", with: arguments)
            return analysis.buckets.compactMap { bucket in
                guard
                    let id = Int(
                        bucket.range.start.prefix(7).replacingOccurrences(of: "-", with: ""))
                else { return nil }
                return .init(id: id, spent: bucket.totals.outflow)
            }
        }
    }

    func makeSearchStore(
        filters: TransactionSearchFilters = .init(), loadsAllPages: Bool = false
    ) -> TransactionSearchStore? {
        if let searchStoreFactory { return searchStoreFactory(filters, loadsAllPages) }
        guard let workspace, let client = editorClient else { return nil }
        return TransactionSearchStore(
            workspace: workspace, filters: filters, loadsAllPages: loadsAllPages,
            pageLoader: { request in
                let filters = request.filters
                var search: [String: ConvexEncodable?] = ["text": filters.text]
                if let id = filters.categoryID { search["categoryId"] = id }
                if let group = filters.group { search["groupId"] = group.id }
                if let merchant = filters.merchant {
                    if merchant.id.hasPrefix("unlinked:") {
                        search["unlinkedMerchantName"] = String(
                            merchant.id.dropFirst("unlinked:".count))
                    } else {
                        search["merchantId"] = merchant.id
                    }
                }
                if filters.reportActivity { search["reportActivity"] = true }
                if let status = filters.status { search["status"] = status.rawValue }
                if let flow = filters.flow { search["flow"] = flow.rawValue }
                if filters.hasNotes { search["hasNotes"] = true }
                var arguments: [String: ConvexEncodable?] = [
                    "workspaceId": workspace.id,
                    "includeDeletionPreviews": false,
                    "search": search,
                    "paginationOpts": [
                        "numItems": 100.0,
                        "cursor": request.cursor,
                        "maximumRowsRead": 5_000.0,
                        "maximumBytesRead": 4_000_000.0,
                    ] as [String: ConvexEncodable?],
                ]
                if let id = filters.accountID { arguments["bankAccountId"] = id }
                if let date = filters.startDate { arguments["startDate"] = date }
                if let date = filters.endDate { arguments["endDate"] = date }
                return try await TransactionEditorQuery<TransactionFeedResponse>().read(
                    client.subscribe(
                        to: "transactions:listTransactionFeed", with: arguments,
                        yielding: TransactionFeedResponse.self
                    ).mapError { $0 as Error }.eraseToAnyPublisher())
            },
            choicesLoader: {
                let arguments: [String: ConvexEncodable?] = ["workspaceId": workspace.id]
                async let accounts = TransactionEditorQuery<[TransactionEditorAccount]>().read(
                    client.subscribe(
                        to: "bankAccounts:listBankAccounts", with: arguments,
                        yielding: [TransactionEditorAccount].self
                    ).mapError { $0 as Error }.eraseToAnyPublisher())
                async let groups = TransactionEditorQuery<[TransactionEditorCategoryHierarchy]>()
                    .read(
                        client.subscribe(
                            to: "categories:listCategoriesHierarchical", with: arguments,
                            yielding: [TransactionEditorCategoryHierarchy].self
                        ).mapError { $0 as Error }.eraseToAnyPublisher())
                return try await TransactionSearchChoices(
                    accounts: accounts.filter { $0.isDeleted != true }.map { account in
                        var choice = account.pickerChoice
                        if account.isClosed == true {
                            choice.subtitle = L10n.string("Closed account")
                        }
                        return choice
                    },
                    categories: groups.flatMap { group in
                        group.categories.filter { $0.isDeleted != true }.map {
                            TransactionEditorChoice(
                                id: $0.id, title: $0.name,
                                subtitle: $0.isArchived == true
                                    ? L10n.string("Archived category") : nil,
                                symbol: nil, groupID: group.group._id,
                                groupTitle: group.group.name)
                        }
                    })
            })
    }

    init(
        bankAccountID: String? = nil,
        workspace: TransactionFeedWorkspace? = nil,
        firstResponseTimeout: Duration = .seconds(15),
        undoDisplayDuration: Duration = .seconds(6),
        workspaceID: String? = nil,
        mutationHandler: @escaping MutationHandler = { _, _, _ in
            throw FeedError.mutationsUnavailable
        },
        selectionEditHandler: @escaping SelectionEditHandler = { _, _, _ in
            throw FeedError.mutationsUnavailable
        },
        detailStoreFactory: ((String) -> TransactionEditorStore?)? = nil,
        creationStoreFactory: (() -> TransactionEditorStore)? = nil,
        searchStoreFactory: ((TransactionSearchFilters, Bool) -> TransactionSearchStore)? = nil,
        categoryHistoryFactory: ((String) -> BudgetCategoryHistoryStore)? = nil,
        plannedStoreFactory: ((TransactionFeedWorkspace) -> PlannedStore)? = nil,
        subscriptionFactory: @escaping SubscriptionFactory
    ) {
        self.detailStoreFactory = detailStoreFactory
        self.creationStoreFactory = creationStoreFactory
        self.searchStoreFactory = searchStoreFactory
        self.categoryHistoryFactory = categoryHistoryFactory
        self.requestedWorkspaceID = workspaceID ?? workspace?.id
        self.bankAccountID = bankAccountID
        self.workspace = workspace
        self.undoDisplayDuration = undoDisplayDuration
        self.mutationHandler = mutationHandler
        self.firstResponseTimeout = firstResponseTimeout
        self.subscriptionFactory = subscriptionFactory
        self.plannedStoreFactory = plannedStoreFactory
        self.selectionEditHandler = selectionEditHandler
    }

    init(previewResponse: TransactionFeedResponse) {
        self.requestedWorkspaceID = nil
        self.undoDisplayDuration = .seconds(6)
        self.mutationHandler = { _, _, _ in [] }
        self.firstResponseTimeout = .seconds(15)
        self.subscriptionFactory = { _ in
            Just(previewResponse)
                .setFailureType(to: Error.self)
                .eraseToAnyPublisher()
        }
        pageRequests = [
            TransactionFeedSubscriptionRequest(
                numItems: Self.pageSize,
                cursor: nil,
                endCursor: nil,
                paginationID: Self.nextPaginationID(),
                workspaceID: previewResponse.workspace?.id
            )
        ]
        pageResponses = [0: previewResponse]
        workspace = previewResponse.workspace
        sections = TransactionFeedPresentation.sections(from: previewResponse.transactions.page)
        hasMore = !previewResponse.transactions.isDone
        hasLoaded = true
    }

    func perform(
        _ action: TransactionFeedAction, on entry: TransactionFeedEntry,
        searchWorkspaceID: String? = nil
    ) async {
        // Search can find transactions outside this feed's loaded pages. Keep its
        // mutations and Undo in the same coordinator, scoped to the active workspace.
        guard searchWorkspaceID == nil || searchWorkspaceID == workspace?.id else { return }
        if action == .restore, canUndoDeletion, isPerformingAction,
            activeDeletionGroupID == entry.deletionGroupID
        {
            queuedUndoReceipt = beginOptimisticRestore(entry)
            return
        }
        guard action != .categorize, !isPerformingAction, let workspaceID = workspace?.id else {
            return
        }
        if action == .restore {
            guard deletedEntries.contains(where: { $0.id == entry.id }) else { return }
        } else {
            guard
                searchWorkspaceID == workspaceID
                    || sections.contains(where: { $0.entries.contains(entry) }),
                action == .delete || action == entry.swipeAction
            else { return }
        }
        undoDismissalTask?.cancel()
        isPerformingAction = true
        actionErrorMessage = nil
        let generation = actionGeneration
        var rollbackReceipt = latestMutationReceipt
        var serverAction = action
        var pendingReceipt: TransactionMutationReceipt?
        if action == .delete {
            let items = presentedItems()
            deletionSnapshots[entry.deletionGroupID] = DeletionSnapshot(
                items: items.filter { ($0.transferGroupId ?? $0.id) == entry.deletionGroupID },
                originalOrder: items.map(\.id),
                budgetChanges: items.first(where: { $0.id == entry.id })?.deletionBudgetChanges
                    ?? [])
            activeDeletionGroupID = entry.deletionGroupID
            restoredDeletionGroupIDs.remove(entry.deletionGroupID)
            hiddenDeletionGroupIDs.insert(entry.deletionGroupID)
            deletedEntries.append(entry)
        }
        if action == .restore {
            pendingReceipt = beginOptimisticRestore(entry)
        } else if action == .delete, let workspace {
            pendingReceipt = TransactionMutationReceipt(
                workspace: workspace, dateKey: entry.date, kind: .deleted,
                budgetChanges: deletionSnapshots[entry.deletionGroupID]?.budgetChanges ?? [],
                isPending: true)
            if let pendingReceipt { publishReceipt(pendingReceipt) }
            rebuildPresentation()
        }
        do {
            var budgetChanges: [TransactionBudgetChange]
            if action == .approve && entry.hasTransferSuggestion {
                guard let editor = makeEditor(for: entry.id) else {
                    throw FeedError.mutationsUnavailable
                }
                await editor.load()
                guard generation == actionGeneration else {
                    editor.stop()
                    return
                }
                if !editor.canSave || editor.draft?.isTransfer != true {
                    transferReviewEditor = editor
                    isPerformingAction = false
                    return
                }
                let saved = await editor.save()
                if !saved {
                    transferReviewEditor = editor
                    isPerformingAction = false
                    return
                }
                budgetChanges = editor.savedReceipt?.budgetChanges ?? []
                if let receipt = editor.savedReceipt { publishReceipt(receipt) }
                editor.stop()
            } else {
                budgetChanges = try await mutationHandler(workspaceID, entry.transactionIDs, action)
            }
            guard generation == actionGeneration else { return }
            if action == .delete {
                deletionSnapshots[entry.deletionGroupID]?.budgetChanges = budgetChanges
                if let queuedUndoReceipt {
                    // Undo has already restored the UI. Serialize only the server writes.
                    var confirmedDeletion = pendingReceipt
                    confirmedDeletion?.budgetChanges = budgetChanges
                    confirmedDeletion?.isPending = false
                    rollbackReceipt = confirmedDeletion
                    pendingReceipt = queuedUndoReceipt
                    self.queuedUndoReceipt = nil
                    serverAction = .restore
                    // Snapshots received before this write can still describe the
                    // original row; they cannot confirm the queued restoration.
                    deletionSnapshots[entry.deletionGroupID]?.confirmedRestoredIDs = []
                    budgetChanges = try await mutationHandler(
                        workspaceID, entry.transactionIDs, .restore)
                    guard generation == actionGeneration else { return }
                }
            }
            if serverAction == .restore {
                deletedEntries.removeAll { $0.id == entry.id }
            }
            if var receipt = pendingReceipt, latestMutationReceipt?.id == receipt.id {
                receipt.budgetChanges = budgetChanges
                receipt.isPending = false
                publishReceipt(receipt)
            }
        } catch let error as Error {
            guard generation == actionGeneration else { return }
            if serverAction == .delete {
                hiddenDeletionGroupIDs.remove(entry.deletionGroupID)
                restoredDeletionGroupIDs.insert(entry.deletionGroupID)
                deletedEntries.removeAll { $0.id == entry.id }
                // The delete failed, so an early Undo needs no compensating write.
                if let queuedUndoReceipt { pendingReceipt = queuedUndoReceipt }
            } else if serverAction == .restore {
                deletionSnapshots[entry.deletionGroupID]?.isRestoring = false
                restoredDeletionGroupIDs.remove(entry.deletionGroupID)
                hiddenDeletionGroupIDs.insert(entry.deletionGroupID)
            }
            if let pendingReceipt, latestMutationReceipt?.id == pendingReceipt.id {
                latestMutationReceipt = rollbackReceipt
                mutationReceiptRevision += 1
            }
            logger.error("Transaction action failed: \(error.localizedDescription)")
            actionErrorMessage = serverAction.failureMessage
        }
        guard generation == actionGeneration else { return }
        isPerformingAction = false
        activeDeletionGroupID = nil
        queuedUndoReceipt = nil
        rebuildPresentation()
        scheduleUndoDismissal()
    }

    private func beginOptimisticRestore(_ entry: TransactionFeedEntry)
        -> TransactionMutationReceipt?
    {
        guard let workspace else { return nil }
        undoDismissalTask?.cancel()
        deletionSnapshots[entry.deletionGroupID]?.isRestoring = true
        deletionSnapshots[entry.deletionGroupID]?.confirmedRestoredIDs = []
        hiddenDeletionGroupIDs.remove(entry.deletionGroupID)
        restoredDeletionGroupIDs.insert(entry.deletionGroupID)
        let changes = (deletionSnapshots[entry.deletionGroupID]?.budgetChanges ?? []).map {
            change in
            var reversed = change
            reversed.before = change.after
            reversed.after = change.before
            return reversed
        }
        let receipt = TransactionMutationReceipt(
            workspace: workspace, dateKey: entry.date, kind: .restored,
            budgetChanges: changes, isPending: true)
        publishReceipt(receipt)
        rebuildPresentation()
        return receipt
    }

    /// The feed owns the save after the category picker hands off and dismisses.
    @discardableResult
    func startCategorizing(
        editor: TransactionEditorStore, categoryID: String, declinesTransfer: Bool = false
    ) -> Bool {
        guard !isPerformingAction, editor.workspace.id == workspace?.id,
            editor.prepareCategorization(
                categoryID, acknowledgesTransferSuggestionRejection: declinesTransfer),
            let draft = editor.draft
        else { return false }
        let generation = actionGeneration
        var pending = TransactionMutationReceipt(
            workspace: editor.workspace, dateKey: draft.dateKey, kind: .updated,
            budgetChanges: [], isPending: true, transactionID: editor.transactionID)
        isPerformingAction = true
        actionErrorMessage = nil
        publishReceipt(pending)
        categorizationTask = Task { [weak self] in
            defer { editor.stop() }
            guard let self, !Task.isCancelled, generation == self.actionGeneration else { return }
            let saved = await editor.save()
            guard generation == actionGeneration, !Task.isCancelled else { return }
            isPerformingAction = false
            categorizationTask = nil
            if saved, let receipt = editor.savedReceipt {
                pending.budgetChanges = receipt.budgetChanges
                pending.isPending = false
                pending.isScheduledOnly = receipt.isScheduledOnly
                if latestMutationReceipt?.id == pending.id { publishReceipt(pending) }
            } else {
                if latestMutationReceipt?.id == pending.id {
                    latestMutationReceipt = nil
                    mutationReceiptRevision += 1
                }
                actionErrorMessage =
                    editor.saveErrorMessage ?? TransactionFeedAction.categorize.failureMessage
            }
        }
        return true
    }

    // Nested sheets share mutations and Undo; only the visible surface presents feedback.
    private(set) var receiptPresentationOwners: [UUID] = []
    var receiptPresentationOwner: UUID? { receiptPresentationOwners.last }

    func registerReceiptPresentation(_ id: UUID) {
        guard !receiptPresentationOwners.contains(id) else { return }
        receiptPresentationOwners.append(id)
    }

    func unregisterReceiptPresentation(_ id: UUID) {
        receiptPresentationOwners.removeAll { $0 == id }
    }

    func visibleSections(_ sections: [TransactionFeedSection]) -> [TransactionFeedSection] {
        let deletedGroups = Set(deletedEntries.map(\.deletionGroupID))
        return sections.compactMap { section in
            let entries = section.entries.filter { !deletedGroups.contains($0.deletionGroupID) }
            return entries.isEmpty ? nil : TransactionFeedSection(id: section.id, entries: entries)
        }
    }

    func publishReceipt(_ receipt: TransactionMutationReceipt) {
        guard receipt.workspace.id == workspace?.id else { return }
        latestMutationReceipt = receipt
        mutationReceiptRevision += 1
    }

    func finishBudgetPeek(receiptID: UUID) {
        guard let receipt = latestMutationReceipt, receipt.id == receiptID,
            receipt.kind == .deleted
        else { return }
        dismissUndo()
    }

    func undoLastDeletion() async {
        guard let entry = deletedEntries.last else { return }
        await perform(.restore, on: entry)
    }

    func dismissUndo() {
        guard !isPerformingAction else { return }
        undoDismissalTask?.cancel()
        undoDismissalTask = nil
        deletedEntries = []
    }

    private func scheduleUndoDismissal() {
        undoDismissalTask?.cancel()
        undoDismissalTask = nil
        guard !deletedEntries.isEmpty, !isPerformingAction else { return }

        undoDismissalTask = Task { [weak self, undoDisplayDuration] in
            do {
                try await Task.sleep(for: undoDisplayDuration)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            self?.dismissUndo()
        }
    }

    private func clearActionState() {
        transferReviewEditor?.stop()
        transferReviewEditor = nil
        endSelection()
        isSavingSelection = false
        isRestoringSelection = false
        selectionStatusOverrides = [:]
        categorizationTask?.cancel()
        categorizationTask = nil
        latestMutationReceipt = nil
        undoDismissalTask?.cancel()
        undoDismissalTask = nil
        actionGeneration = UUID()
        isPerformingAction = false
        actionErrorMessage = nil
        deletedEntries = []
        hiddenDeletionGroupIDs = []
        deletionSnapshots = [:]
        restoredDeletionGroupIDs = []
        activeDeletionGroupID = nil
        queuedUndoReceipt = nil
    }

    func start() {
        guard !isActive else { return }
        isActive = true
        agenda?.start()
        subscriptionGeneration += 1

        if pageRequests.isEmpty {
            startInitialPage()
        } else {
            isLoading = pageResponses[0] == nil && !hasLoaded
            isLoadingMore = pageRequests.count > 1 && pageResponses.count < pageRequests.count
            resubscribeToLoadedPages()
        }
    }

    func stop() {
        agenda?.stop()
        guard isActive || !subscriptions.isEmpty else { return }
        isActive = false
        subscriptionGeneration += 1
        cancelSubscriptions()
        isLoading = false
        isLoadingMore = false
    }

    func reset() {
        stop()
        agenda = nil
        clearActionState()
        latestMutationReceipt = nil
        workspace = nil
        filterCounts = TransactionFeedFilterCounts()
        filterCountsAreComplete = true
        filter = .all
        keepsEmptyFilter = false
        sections = []
        pageRequests = []
        pageResponses = [:]
        pendingSplits = []
        pageErrors = [:]
        failedPageIndex = nil
        hasLoaded = false
        hasMore = false
        errorMessage = nil
    }

    func retry() {
        guard isActive, let failedPageIndex, pageRequests.indices.contains(failedPageIndex) else {
            return
        }

        errorMessage = nil
        pageErrors.removeValue(forKey: failedPageIndex)
        self.failedPageIndex = nil
        if failedPageIndex == 0, !hasLoaded {
            isLoading = true
        } else {
            isLoadingMore = true
        }
        subscribe(to: pageRequests[failedPageIndex], at: failedPageIndex)
    }

    // A filtered page can contain no matches while older history still exists.
    // Stop at that boundary until the user explicitly asks to continue.
    var needsManualPagination: Bool {
        hasMore
            && (sections.isEmpty
                || activePageIndices.last.flatMap { pageResponses[$0] }?.transactions.page
                    .contains(where: matchesFilters) == false)
    }

    func loadMoreIfNeeded(after entryID: String? = nil) {
        guard isActive,
            !usesPreloadedFilter,
            hasLoaded,
            hasMore,
            !isLoadingMore,
            entryID == nil
                || (!needsManualPagination && entryID == sections.last?.entries.last?.id),
            activePageIndices.allSatisfy({ pageResponses[$0] != nil }),
            let lastIndex = activePageIndices.last,
            let lastResponse = pageResponses[lastIndex]
        else {
            return
        }

        let request = TransactionFeedSubscriptionRequest(
            numItems: Self.pageSize,
            cursor: lastResponse.transactions.continueCursor,
            endCursor: nil,
            paginationID: pageRequests[lastIndex].paginationID,
            workspaceID: workspace?.id,
            bankAccountID: bankAccountID, filter: filter
        )
        let pageIndex = pageRequests.count
        pageRequests.append(request)
        isLoadingMore = true
        errorMessage = nil
        failedPageIndex = nil
        subscribe(to: request, at: pageIndex)
    }

    private var firstPageResponse: TransactionFeedResponse? {
        pendingSplits.first(where: { $0.range.contains(0) })?.response ?? pageResponses[0]
    }

    private var usesPreloadedFilter: Bool {
        filter != .all && filter.searchFlow == nil && filterCountsAreComplete
    }

    private var activePageIndices: [Int] {
        pageRequests.indices.filter { pageRequests[$0].filter == filter }
    }

    private func startSelectedFilterIfNeeded() {
        guard isActive, filter != .all, !usesPreloadedFilter, activePageIndices.isEmpty else {
            return
        }
        let request = TransactionFeedSubscriptionRequest(
            numItems: Self.pageSize, cursor: nil, endCursor: nil,
            paginationID: Self.nextPaginationID(),
            workspaceID: requestedWorkspaceID ?? workspace?.id,
            bankAccountID: bankAccountID, filter: filter)
        let index = pageRequests.count
        pageRequests.append(request)
        subscribe(to: request, at: index)
    }

    private func startInitialPage() {
        let request = TransactionFeedSubscriptionRequest(
            numItems: Self.pageSize,
            cursor: nil,
            endCursor: nil,
            paginationID: Self.nextPaginationID(),
            workspaceID: requestedWorkspaceID ?? workspace?.id,
            bankAccountID: bankAccountID, filter: .all
        )
        pageRequests = [request]
        pageResponses = [:]
        pendingSplits = []
        pageErrors = [:]
        failedPageIndex = nil
        errorMessage = nil
        hasMore = false
        isLoading = !hasLoaded
        isLoadingMore = false
        subscribe(to: request, at: 0)
    }

    private func resubscribeToLoadedPages() {
        cancelSubscriptions()
        for (index, request) in pageRequests.enumerated() {
            subscribe(to: request, at: index)
        }
    }

    private func subscribe(
        to request: TransactionFeedSubscriptionRequest,
        at pageIndex: Int
    ) {
        let generation = subscriptionGeneration
        let attempt = UUID()
        subscriptionAttempts[pageIndex] = attempt

        subscriptions[pageIndex]?.cancel()
        responseDeadlines[pageIndex]?.cancel()
        responseDeadlines[pageIndex] = Task { [weak self, firstResponseTimeout] in
            do {
                try await Task.sleep(for: firstResponseTimeout)
            } catch {
                return
            }
            guard let self,
                self.isCurrent(request, at: pageIndex, generation: generation),
                self.subscriptionAttempts[pageIndex] == attempt
            else { return }
            self.handle(FeedError.connectionTimedOut, at: pageIndex)
        }
        subscriptions[pageIndex] = subscriptionFactory(request)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self,
                        self.isCurrent(request, at: pageIndex, generation: generation),
                        self.subscriptionAttempts[pageIndex] == attempt
                    else {
                        return
                    }
                    self.responseDeadlines.removeValue(forKey: pageIndex)?.cancel()
                    switch completion {
                    case .failure(let error):
                        self.handle(error, at: pageIndex)
                    case .finished:
                        if self.pageResponses[pageIndex] == nil {
                            self.handle(FeedError.endedWithoutResponse, at: pageIndex)
                        }
                    }
                },
                receiveValue: { [weak self] response in
                    guard let self,
                        self.isCurrent(request, at: pageIndex, generation: generation),
                        self.subscriptionAttempts[pageIndex] == attempt
                    else {
                        return
                    }
                    self.responseDeadlines.removeValue(forKey: pageIndex)?.cancel()
                    self.handle(response, for: request, at: pageIndex)
                }
            )
    }

    private func handle(
        _ response: TransactionFeedResponse,
        for request: TransactionFeedSubscriptionRequest,
        at pageIndex: Int
    ) {
        guard requestedWorkspaceID == nil || response.workspace?.id == requestedWorkspaceID else {
            handle(FeedError.workspaceMismatch, at: pageIndex)
            return
        }
        if pageIndex == 0 {
            filterCountsAreComplete = response.filterSetsComplete ?? true
            if let counts = response.filterCounts {
                filterCounts = counts
                if !keepsEmptyFilter, filterCountsAreComplete,
                    filter != .all, counts.count(for: filter) == 0
                {
                    filter = .all
                    endSelection()
                }
            }
        }
        if pageIndex == 0 {
            let workspaceChanged = hasLoaded && workspace?.id != response.workspace?.id
            if workspaceChanged {
                clearActionState()
                retainOnlyFirstPage(request: request)
            }
        } else if response.workspace?.id != workspace?.id {
            return
        }

        // A required split is incomplete. Keep the previous complete snapshot
        // visible until both replacement ranges have arrived.
        if response.transactions.pageStatus == .splitRequired {
            if workspace == nil { workspace = response.workspace }
            splitPage(response, request: request, at: pageIndex)
            return
        }

        let previousResponse = pageResponses[pageIndex]
        let replacesLoadedPage = previousResponse != nil
        pageResponses[pageIndex] = response
        pageErrors.removeValue(forKey: pageIndex)
        let completedSplit = pendingSplits.contains { split in
            split.range.allSatisfy { pageResponses[$0] != nil }
        }
        pendingSplits.removeAll { split in split.range.allSatisfy { pageResponses[$0] != nil } }
        startSelectedFilterIfNeeded()
        // Overrides only bridge a confirmed write to the next live snapshot.
        // The server may coalesce another device's edit into that snapshot.
        var retiredStatusOverride = false
        let refreshedItems =
            response.transactions.page + (response.filterTransactions?.items(for: filter) ?? [])
        for item in refreshedItems {
            if selectionStatusOverrides.removeValue(forKey: item.id) != nil {
                retiredStatusOverride = true
            }
        }
        let responseIDs = Set(refreshedItems.map(\.id))
        for groupID in restoredDeletionGroupIDs {
            deletionSnapshots[groupID]?.confirmedRestoredIDs.formUnion(responseIDs)
        }
        if failedPageIndex == pageIndex {
            failedPageIndex = nil
            errorMessage = nil
        }
        // Reconnecting a paginated feed delivers one snapshot per loaded page.
        // Compare only that page before regrouping the entire ledger. Keep the
        // fresh raw response above: deletion previews and cursors can change
        // without changing a rendered row.
        if let previousResponse,
            !retiredStatusOverride, !completedSplit, pendingSplits.isEmpty,
            previousResponse.filterSetsComplete == response.filterSetsComplete,
            previousResponse.filterTransactions == response.filterTransactions,
            previousResponse.filterCounts == response.filterCounts,
            workspace == response.workspace,
            hiddenDeletionGroupIDs.isEmpty, restoredDeletionGroupIDs.isEmpty,
            TransactionFeedPresentation.entries(from: previousResponse.transactions.page)
                == TransactionFeedPresentation.entries(from: response.transactions.page)
        {
            updatePaginationState()
            return
        }
        rebuildPresentation(animateMembershipChanges: replacesLoadedPage)
    }

    private func handle(_ error: Error, at pageIndex: Int) {
        logger.error("Transaction feed subscription failed: \(error.localizedDescription)")
        pageErrors[pageIndex] = error
        updatePaginationState()
    }

    private func splitPage(
        _ response: TransactionFeedResponse,
        request: TransactionFeedSubscriptionRequest,
        at index: Int
    ) {
        let endCursor = request.endCursor ?? response.transactions.continueCursor
        guard let splitCursor = response.transactions.splitCursor,
            !splitCursor.isEmpty, splitCursor != request.cursor, splitCursor != endCursor
        else {
            handle(FeedError.paginationSplitRequired, at: index)
            return
        }
        let first = TransactionFeedSubscriptionRequest(
            numItems: request.numItems, cursor: request.cursor, endCursor: splitCursor,
            paginationID: request.paginationID, workspaceID: request.workspaceID,
            bankAccountID: request.bankAccountID, filter: request.filter)
        let second = TransactionFeedSubscriptionRequest(
            numItems: request.numItems, cursor: splitCursor, endCursor: endCursor,
            paginationID: request.paginationID, workspaceID: request.workspaceID,
            bankAccountID: request.bankAccountID, filter: request.filter)
        subscriptionGeneration += 1
        cancelSubscriptions()
        for offset in pendingSplits.indices {
            let range = pendingSplits[offset].range
            let lowerBound = range.lowerBound > index ? range.lowerBound + 1 : range.lowerBound
            let upperBound = range.upperBound > index ? range.upperBound + 1 : range.upperBound
            pendingSplits[offset].range = lowerBound..<upperBound
        }
        pendingSplits.append(.init(range: index..<(index + 2), response: pageResponses[index]))
        pageResponses = Dictionary(
            uniqueKeysWithValues: pageResponses.compactMap { key, value in
                key == index ? nil : (key > index ? key + 1 : key, value)
            })
        pageErrors = Dictionary(
            uniqueKeysWithValues: pageErrors.compactMap { key, value in
                key == index ? nil : (key > index ? key + 1 : key, value)
            })
        pageRequests.replaceSubrange(index...index, with: [first, second])
        if let failed = failedPageIndex { failedPageIndex = failed > index ? failed + 1 : failed }
        if failedPageIndex == index {
            failedPageIndex = nil
            errorMessage = nil
        }
        resubscribeToLoadedPages()
        updatePaginationState()
    }

    private var loadedItems: [TransactionFeedItem] {
        if usesPreloadedFilter {
            return firstPageResponse?.filterTransactions?.items(for: filter) ?? []
        }
        var items: [TransactionFeedItem] = []
        var covered: Set<Int> = []
        for index in activePageIndices where !covered.contains(index) {
            if let split = pendingSplits.first(where: { $0.range.contains(index) }) {
                items += split.response?.transactions.page ?? []
                covered.formUnion(split.range)
            } else {
                items += pageResponses[index]?.transactions.page ?? []
            }
        }
        return items
    }

    private func presentedItems(from loadedItems: [TransactionFeedItem]? = nil)
        -> [TransactionFeedItem]
    {
        var items = loadedItems ?? self.loadedItems
        var visibleIDs = Set(items.map(\.id))
        for groupID in restoredDeletionGroupIDs.sorted() {
            guard let snapshot = deletionSnapshots[groupID] else { continue }
            for item in snapshot.items where !visibleIDs.contains(item.id) {
                // Reinsert before the next surviving row, retaining both transfer
                // sides and their original position while the subscription catches up.
                let followingIDs = Set(
                    snapshot.originalOrder.drop {
                        $0 != item.id
                    }.dropFirst())
                let index =
                    items.firstIndex { $0.date == item.date && followingIDs.contains($0.id) }
                    ?? items.lastIndex(where: { $0.date == item.date }).map { $0 + 1 }
                    ?? items.firstIndex(where: { $0.date < item.date }) ?? items.endIndex
                items.insert(item, at: index)
                visibleIDs.insert(item.id)
            }
        }
        return items.map { item in
            guard let status = selectionStatusOverrides[item.id] else { return item }
            var updated = item
            updated.status = status
            return updated
        }
    }

    private func rebuildPresentation(animateMembershipChanges: Bool = true) {
        let loadedItems = loadedItems

        if !isPerformingAction {
            // Stop masking a deletion once the subscription has caught up, so a
            // transaction restored on another device can appear again.
            hiddenDeletionGroupIDs.formIntersection(loadedItems.map { $0.transferGroupId ?? $0.id })
            let loadedIDs = Set(loadedItems.map(\.id))
            restoredDeletionGroupIDs = restoredDeletionGroupIDs.filter { groupID in
                guard let snapshot = deletionSnapshots[groupID] else { return false }
                // Only a new snapshot containing these rows confirms a restore.
                // Cached rows or an update to another page cannot retire the overlay.
                let confirmedIDs = snapshot.isRestoring ? snapshot.confirmedRestoredIDs : loadedIDs
                return snapshot.items.contains { !confirmedIDs.contains($0.id) }
            }
            let retainedGroups = restoredDeletionGroupIDs.union(
                deletedEntries.map(\.deletionGroupID))
            deletionSnapshots = deletionSnapshots.filter { retainedGroups.contains($0.key) }
        }
        let nextWorkspace: TransactionFeedWorkspace?
        if let response = firstPageResponse {
            nextWorkspace = response.workspace
        } else {
            nextWorkspace = workspace
        }
        if workspace != nextWorkspace { workspace = nextWorkspace }
        let nextSections = TransactionFeedPresentation.sections(
            from: presentedItems(from: loadedItems).filter {
                !hiddenDeletionGroupIDs.contains($0.transferGroupId ?? $0.id)
                    && matchesFilters($0)
            })
        if sections != nextSections {
            if hasLoaded, animateMembershipChanges,
                sections.map({ $0.entries.map(\.id) })
                    != nextSections.map({ $0.entries.map(\.id) })
            {
                rowTransitionRevision += 1
            }
            sections = nextSections
        }
        selectedIDs.formIntersection(nextSections.flatMap { $0.entries.map(\.id) })
        updatePaginationState()
    }

    private func updatePaginationState() {
        let relevantIndices = usesPreloadedFilter ? [0] : activePageIndices
        failedPageIndex = relevantIndices.first { pageErrors[$0] != nil }
        if let error = failedPageIndex.flatMap({ pageErrors[$0] }) {
            errorMessage =
                error is FeedError
                ? L10n.string(
                    "We couldn't connect to your transactions. Check your connection and try again."
                )
                : sections.isEmpty
                    ? L10n.string("We couldn't load your transactions.")
                    : L10n.string("We couldn't refresh the rest of your transactions.")
        } else {
            errorMessage = nil
        }
        if usesPreloadedFilter {
            hasLoaded = firstPageResponse != nil
            isLoading = !hasLoaded && failedPageIndex == nil
            isLoadingMore = false
            hasMore = false
            return
        }
        let indices = activePageIndices
        let hasResponse = indices.contains { index in
            if let split = pendingSplits.first(where: { $0.range.contains(index) }) {
                return split.response != nil
            }
            return pageResponses[index] != nil
        }
        let splitting = pendingSplits.contains { split in
            indices.contains { split.range.contains($0) }
        }
        hasLoaded = hasResponse || !sections.isEmpty
        isLoading = !hasLoaded && failedPageIndex == nil
        isLoadingMore =
            hasLoaded && failedPageIndex == nil
            && (splitting || indices.contains { pageResponses[$0] == nil })
        hasMore =
            !splitting && indices.allSatisfy { pageResponses[$0] != nil }
            && indices.last.flatMap { pageResponses[$0] }.map { !$0.transactions.isDone } == true
    }

    private func retainOnlyFirstPage(request: TransactionFeedSubscriptionRequest) {
        for (pageIndex, subscription) in subscriptions where pageIndex != 0 {
            subscription.cancel()
            responseDeadlines.removeValue(forKey: pageIndex)?.cancel()
            subscriptionAttempts.removeValue(forKey: pageIndex)
        }
        let firstSubscription = subscriptions[0]
        subscriptions = firstSubscription.map { [0: $0] } ?? [:]
        pageRequests = [request]
        pageResponses = [:]
        pendingSplits = []
        pageErrors = [:]
        failedPageIndex = nil
    }

    private func restartPagination() {
        subscriptionGeneration += 1
        cancelSubscriptions()
        pageRequests = []
        pageResponses = [:]
        pendingSplits = []
        pageErrors = [:]
        failedPageIndex = nil
        hasMore = false
        isLoadingMore = false

        guard isActive else { return }
        startInitialPage()
    }

    private func isCurrent(
        _ request: TransactionFeedSubscriptionRequest,
        at pageIndex: Int,
        generation: Int
    ) -> Bool {
        isActive
            && subscriptionGeneration == generation
            && pageRequests.indices.contains(pageIndex)
            && pageRequests[pageIndex] == request
    }

    private func cancelSubscriptions() {
        for subscription in subscriptions.values {
            subscription.cancel()
        }
        subscriptions = [:]
        for deadline in responseDeadlines.values {
            deadline.cancel()
        }
        responseDeadlines = [:]
        subscriptionAttempts = [:]
    }

    private static func nextPaginationID() -> Int {
        paginationSequence += 1
        return paginationSequence
    }

    enum FeedError: Error {
        case mutationsUnavailable
        case mutationFailed
        case connectionTimedOut
        case endedWithoutResponse
        case paginationSplitRequired
        case workspaceMismatch
    }
}

extension TransactionFeedStore {
    static var preview: TransactionFeedStore {
        TransactionFeedStore(
            previewResponse: TransactionFeedResponse(
                workspace: TransactionFeedWorkspace(
                    id: "workspace-preview",
                    name: L10n.string("Personal"),
                    currencyCode: "USD",
                    minorUnit: 2,
                    timezoneIdentifier: "America/New_York"
                ),
                transactions: TransactionFeedPage(
                    page: [
                        TransactionFeedItem(
                            id: "groceries",
                            date: "2026-09-04",
                            type: .regular,
                            amount: -8_420,
                            merchantName: L10n.string("Trader Joe's"),
                            bankAccountName: L10n.string("Checking"),
                            categoryNames: [L10n.string("Groceries")]
                        ),
                        TransactionFeedItem(
                            id: "paycheck",
                            date: "2026-09-04",
                            type: .regular,
                            status: .pending,
                            amount: 342_000,
                            merchantName: L10n.string("Payroll"),
                            bankAccountName: L10n.string("Checking"),
                            categoryNames: [L10n.string("Ready to Assign")]
                        ),
                        TransactionFeedItem(
                            id: "transfer-out",
                            transferGroupId: "transfer-group",
                            date: "2026-09-03",
                            type: .transfer,
                            amount: -20_000,
                            bankAccountName: L10n.string("Checking"),
                            transferPairAccountName: L10n.string("Emergency Fund")
                        ),
                    ],
                    continueCursor: "",
                    isDone: true
                )
            )
        )
    }
}

private struct FeedMutationResult: Decodable {
    let success: Bool
    var budgetChanges: [TransactionBudgetChange]?
}
