import Combine
import ConvexMobile
import Foundation
import Observation

struct TransactionEditorSaveResult: Decodable {
    let success: Bool
    var transactionId: String?
    var convertedToScheduled: Bool?
    var scheduledTransactionId: String?
    var budgetChanges: [TransactionBudgetChange]?
}

struct TransactionImportLinkRequest {
    enum Action: Equatable {
        case approve(useImportAmount: Bool, useImportDate: Bool)
        case unlink
    }
    let workspaceID: String
    let transactionID: String
    let action: Action

    var mutationName: String {
        switch action {
        case .approve: "transactionLinking:approveTransactionLink"
        case .unlink: "transactionLinking:unlinkTransaction"
        }
    }

    var arguments: [String: ConvexEncodable?] {
        var result: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "transactionId": transactionID,
        ]
        if case .approve(let amount, let date) = action {
            result["resolutions"] =
                ["useImportAmount": amount, "useImportDate": date]
                as [String: ConvexEncodable?]
        }
        return result
    }
}

/// A minimal patch keeps untouched import metadata, movements, and review state on the server.
struct TransactionEditorSaveRequest {
    static let mutationName = "transactions:updateTransactionFromEditor"
    let workspaceID: String
    let transactionID: String
    let draft: TransactionEditorDraft
    let original: TransactionEditorDraft

    var arguments: [String: ConvexEncodable?] {
        var arguments: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID,
            "transactionId": transactionID,
            "preserveReviewStatus": true,
            "includeBudgetChanges": true,
        ]
        if draft.dateKey != original.dateKey { arguments["date"] = draft.dateKey }
        if draft.status != original.status { arguments["status"] = draft.status.rawValue }
        if draft.reviewStatus != original.reviewStatus {
            arguments["reviewStatus"] = draft.reviewStatus.rawValue
        }
        if draft.notes != original.notes {
            arguments["notes"] = draft.notes.isEmpty ? TransactionEditorNull() : draft.notes
        }
        if draft.scheduledTransactionID != original.scheduledTransactionID
            || draft.scheduledOccurrenceDate != original.scheduledOccurrenceDate
        {
            arguments["linkedScheduledTransactionId"] =
                draft.scheduledTransactionID.map { $0 as ConvexEncodable }
                ?? TransactionEditorNull()
            if draft.scheduledTransactionID != nil, let date = draft.scheduledOccurrenceDate {
                arguments["linkedScheduledOccurrenceDate"] = date
            }
        }
        if draft.recurrence != .once || draft.wantsToSchedule {
            arguments["recurrence"] = draft.recurrence.rawValue
            arguments["entryMode"] = draft.entryMode.rawValue
        }

        let changesType = draft.isTransfer != original.isTransfer
        if changesType || (draft.isTransfer && original.transferAccountID == nil) {
            arguments["type"] = draft.isTransfer ? "transfer" : "regular"
        }
        if draft.isTransfer {
            let isInflow = draft.isIncomingTransfer
            if changesType || draft.accountID != original.accountID {
                arguments[isInflow ? "toAccountId" : "fromAccountId"] = draft.accountID
            }
            if changesType || draft.transferAccountID != original.transferAccountID {
                arguments[isInflow ? "fromAccountId" : "toAccountId"] = draft.transferAccountID
            }
            if changesType || draft.signedAmount != original.signedAmount {
                let movement: [String: ConvexEncodable?] = ["amount": draft.signedAmount]
                arguments["movements"] = [movement as ConvexEncodable?]
            }
            let allocation = draft.allocations.first
            let oldAllocation = original.allocations.first
            if changesType || allocation?.categoryID != oldAllocation?.categoryID
                || allocation?.readyToAssign != oldAllocation?.readyToAssign
            {
                if let categoryID = allocation?.categoryID { arguments["categoryId"] = categoryID }
                arguments["readyToAssign"] = allocation?.readyToAssign ?? false
            }
        } else {
            if draft.useOriginalStatement {
                arguments["useOriginalStatement"] = true
            } else if draft.merchantID != original.merchantID {
                arguments["merchantId"] =
                    draft.merchantID.map { $0 as ConvexEncodable } ?? TransactionEditorNull()
            }
            if draft.accountID != original.accountID {
                arguments["bankAccountId"] = draft.accountID
            }
            if changesType || draft.allocations != original.allocations {
                arguments["movements"] = draft.allocations.map { allocation -> ConvexEncodable? in
                    var movement: [String: ConvexEncodable?] = [
                        "amount": allocation.amount, "readyToAssign": allocation.readyToAssign,
                    ]
                    if let categoryID = allocation.categoryID {
                        movement["categoryId"] = categoryID
                    }
                    if !allocation.notes.isEmpty { movement["notes"] = allocation.notes }
                    return movement
                }
            }
        }
        return arguments
    }
}

struct TransactionEditorMerchantPage: Decodable {
    let page: [TransactionEditorMerchant]
    let continueCursor: String
    let isDone: Bool
}

/// Workspace-owned live choices. Editor presentation never owns these subscriptions.
@MainActor
final class TransactionEditorChoicesStore {
    struct State {
        var choices: TransactionEditorChoices?
        var isLoading = false
        var errorMessage: String?
    }

    let workspaceID: String
    let states = CurrentValueSubject<State, Never>(State())
    private let subscribe: () -> AnyPublisher<TransactionEditorChoices, Error>
    private var subscription: AnyCancellable?
    private var deadline: Task<Void, Never>?
    private var generation = UUID()
    private var isActive = false

    init(
        workspaceID: String,
        subscribe: @escaping () -> AnyPublisher<TransactionEditorChoices, Error>
    ) {
        self.workspaceID = workspaceID
        self.subscribe = subscribe
    }

    convenience init(workspaceID: String, convexClient: ConvexClientWithAuth<String>) {
        self.init(workspaceID: workspaceID) {
            let arguments: [String: ConvexEncodable?] = ["workspaceId": workspaceID]
            return Publishers.CombineLatest4(
                Self.merchantChoices { cursor in
                    let pagination: [String: ConvexEncodable?] = [
                        "numItems": 200.0, "cursor": cursor,
                    ]
                    return convexClient.subscribe(
                        to: "merchants:listMerchantChoices",
                        with: ["workspaceId": workspaceID, "paginationOpts": pagination],
                        yielding: TransactionEditorMerchantPage.self
                    ).mapError { $0 as Error }.eraseToAnyPublisher()
                },
                convexClient.subscribe(
                    to: "categories:listCategoriesHierarchical", with: arguments,
                    yielding: [TransactionEditorCategoryHierarchy].self
                ).mapError { $0 as Error },
                convexClient.subscribe(
                    to: "bankAccounts:listBankAccounts", with: arguments,
                    yielding: [TransactionEditorAccount].self
                ).mapError { $0 as Error },
                convexClient.subscribe(
                    to: "scheduledTransactions:listScheduledTransactions",
                    with: ["workspaceId": workspaceID, "includeCompleted": true],
                    yielding: [TransactionEditorPlannedTransaction].self
                ).mapError { $0 as Error }
            )
            .map { merchants, categories, accounts, planned in
                TransactionEditorChoices(
                    merchants: merchants.filter { $0.isDeleted != true }.sorted {
                        $0.name.localizedStandardCompare($1.name) == .orderedAscending
                    },
                    categories: categories.flatMap(\.selectableCategories),
                    accounts: accounts.filter { $0.isDeleted != true && $0.isClosed != true },
                    plannedTransactions: planned)
            }
            .combineLatest(
                convexClient.subscribe(
                    to: "workspaces:getWorkspace", with: arguments,
                    yielding: TransactionEditorDefaults.self
                ).mapError { $0 as Error }
            )
            .map { choices, defaults in
                var result = choices
                result.defaults = defaults
                return result
            }
            .mapError { $0 as Error }.eraseToAnyPublisher()
        }
    }

    /// Keep every bounded page live. When a cursor changes, replace its tail so
    /// inserts/deletes cannot leave stale or missing choices in the catalog.
    static func merchantChoices(
        cursor: String? = nil,
        subscribe: @escaping (String?) -> AnyPublisher<TransactionEditorMerchantPage, Error>
    ) -> AnyPublisher<[TransactionEditorMerchant], Error> {
        // Replay a cached first result to both branches, including synchronous
        // publishers, while owning just one subscription for this page.
        // This catalog remains live until cancellation. Keep finite cached
        // sources open too, so both branches can consume their final page.
        let pages: AnyPublisher<TransactionEditorMerchantPage, Error> = subscribe(cursor)
            .append(Empty<TransactionEditorMerchantPage, Error>(completeImmediately: false))
            .map(Optional.some)
            .multicast(subject: CurrentValueSubject<TransactionEditorMerchantPage?, Error>(nil))
            .autoconnect().compactMap { $0 }.eraseToAnyPublisher()
        let cursors = pages.map { ($0.continueCursor, $0.isDone) }
            .removeDuplicates { $0.0 == $1.0 && $0.1 == $1.1 }
            .eraseToAnyPublisher()
        let tails: AnyPublisher<MerchantChoicesTail, Error> =
            cursors
            .map { next -> AnyPublisher<MerchantChoicesTail, Error> in
                let nextCursor = next.0
                let isDone = next.1
                let values: AnyPublisher<[TransactionEditorMerchant], Error>
                if isDone {
                    values = Just([TransactionEditorMerchant]()).setFailureType(to: Error.self)
                        .eraseToAnyPublisher()
                } else {
                    values = merchantChoices(cursor: nextCursor, subscribe: subscribe)
                }
                return values.map { merchants -> MerchantChoicesTail in
                    MerchantChoicesTail(cursor: nextCursor, isDone: isDone, merchants: merchants)
                }.eraseToAnyPublisher()
            }.switchToLatest().eraseToAnyPublisher()
        return pages.combineLatest(tails)
            .filter { $0.continueCursor == $1.cursor && $0.isDone == $1.isDone }
            .map { $0.page + $1.merchants }
            .removeDuplicates().eraseToAnyPublisher()
    }

    private struct MerchantChoicesTail {
        let cursor: String
        let isDone: Bool
        let merchants: [TransactionEditorMerchant]
    }

    func start() {
        guard !isActive else { return }
        isActive = true
        let token = UUID()
        generation = token
        states.send(State(choices: states.value.choices, isLoading: true))
        deadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.generation == token else { return }
            self.fail()
        }
        subscription = subscribe().receive(on: DispatchQueue.main).sink { [weak self] completion in
            guard let self, self.generation == token else { return }
            if case .failure = completion { self.fail() }
        } receiveValue: { [weak self] choices in
            guard let self, self.generation == token else { return }
            self.deadline?.cancel()
            self.deadline = nil
            self.states.send(State(choices: choices))
        }
    }

    func retry() {
        guard states.value.errorMessage != nil else {
            start()
            return
        }
        subscription?.cancel()
        subscription = nil
        isActive = false
        start()
    }

    func stop() {
        generation = UUID()
        isActive = false
        deadline?.cancel()
        deadline = nil
        subscription?.cancel()
        subscription = nil
        states.send(State())
    }

    private func fail() {
        deadline?.cancel()
        deadline = nil
        states.send(
            State(
                choices: states.value.choices,
                errorMessage: L10n.string(
                    "We couldn't load your merchants, accounts, and categories. Please try again."))
        )
    }
}

@MainActor
@Observable
final class TransactionEditorStore {
    typealias DetailLoader = (String, String) async throws -> TransactionEditorDetail?
    typealias ChoicesLoader = (String) async throws -> TransactionEditorChoices
    typealias SaveHandler = (TransactionEditorSaveRequest) async throws ->
        TransactionEditorSaveResult
    typealias CreationHandler = (TransactionCreationRequest) async throws ->
        TransactionCreationResult
    typealias TransferHistoryLoader = (String, String) async throws -> [TransactionEditorDetail]
    typealias MerchantCreator = (String, String) async throws -> String

    let workspace: TransactionFeedWorkspace
    let transactionID: String?
    private(set) var duplicationSourceID: String?
    private(set) var plannedSchedule: PlannedSchedule?
    var isEditingPlan: Bool { plannedSchedule != nil }
    var isCreating: Bool { transactionID == nil && !isEditingPlan }
    @ObservationIgnored private var plannedSaveHandler: (PlannedSaveRequest) async throws -> Bool =
        { _ in
            throw TransactionEditorError.saveFailed
        }
    private(set) var savedReceipt: TransactionMutationReceipt?
    var draft: TransactionEditorDraft?
    private(set) var detail: TransactionEditorDetail?
    private(set) var choices = TransactionEditorChoices()
    private(set) var isLoading = false
    private(set) var isLoadingChoices = false
    private(set) var isSaving = false
    private(set) var loadErrorMessage: String?
    private(set) var choicesErrorMessage: String?
    private(set) var saveErrorMessage: String?
    @ObservationIgnored private var didApplyImportedSuggestion = false
    @ObservationIgnored private var openingSuggestionDraft: TransactionEditorDraft?
    @ObservationIgnored private var regularDraftBeforeTransfer: TransactionEditorDraft?
    @ObservationIgnored private var matchedSuggestionAccountID: String?
    private(set) var didConvertToScheduled = false
    private(set) var shortcutNotice: String?
    @ObservationIgnored private var pendingShortcutChoices:
        (TransactionShortcutDraft, TransactionEditorDraft)?
    private enum ShortcutField: Hashable { case merchant, category, account, transferAccount }
    @ObservationIgnored private var editedShortcutFields: Set<ShortcutField> = []

    @ObservationIgnored private var originalDraft: TransactionEditorDraft?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private let detailLoader: DetailLoader
    @ObservationIgnored private let choicesLoader: ChoicesLoader
    @ObservationIgnored private let saveHandler: SaveHandler
    @ObservationIgnored private let importLinkHandler:
        (TransactionImportLinkRequest) async throws -> TransactionEditorSaveResult
    @ObservationIgnored private let deletionHandler:
        (String, String) async throws -> TransactionEditorSaveResult
    @ObservationIgnored private let creationHandler: CreationHandler
    @ObservationIgnored private let merchantCreator: MerchantCreator
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var sharedChoices: TransactionEditorChoicesStore?
    @ObservationIgnored private var ownsChoices = false
    @ObservationIgnored private var choicesSubscription: AnyCancellable?
    @ObservationIgnored private var hasLoadedChoices = false
    private var hasEditedAmount = false
    @ObservationIgnored private var categoryManuallySelected = false
    @ObservationIgnored private var accountManuallySelected = false
    @ObservationIgnored private var statusManuallySelected = false
    @ObservationIgnored private var hasAppliedCreationDefaults = false
    @ObservationIgnored private var appliedDefaultAccountID: String?
    @ObservationIgnored private let transferHistoryLoader: TransferHistoryLoader
    @ObservationIgnored private var transferHistory: [String: [TransactionEditorDetail]] = [:]
    @ObservationIgnored private var suggestionTask: Task<Void, Never>?
    @ObservationIgnored private var suggestionGeneration = UUID()

    init(
        workspace: TransactionFeedWorkspace, transactionID: String? = nil,
        convexClient: ConvexClientWithAuth<String>,
        choicesStore: TransactionEditorChoicesStore? = nil
    ) {
        if let choicesStore { precondition(choicesStore.workspaceID == workspace.id) }
        self.workspace = workspace
        self.transactionID = transactionID
        self.now = Date.init
        self.detailLoader = { workspaceID, transactionID in
            try await TransactionEditorQuery<TransactionEditorDetail?>().read(
                convexClient.subscribe(
                    to: "transactions:getTransaction",
                    with: ["workspaceId": workspaceID, "transactionId": transactionID],
                    yielding: TransactionEditorDetail?.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            )
        }
        self.sharedChoices =
            choicesStore
            ?? TransactionEditorChoicesStore(
                workspaceID: workspace.id, convexClient: convexClient)
        self.ownsChoices = choicesStore == nil
        self.choicesLoader = { _ in TransactionEditorChoices() }
        self.transferHistoryLoader = { workspaceID, accountID in
            struct Page: Decodable { let page: [TransactionEditorDetail] }
            let page = try await TransactionEditorQuery<Page>().read(
                convexClient.subscribe(
                    to: "transactions:listTransactions",
                    with: [
                        "workspaceId": workspaceID, "bankAccountId": accountID,
                        "paginationOpts": ["numItems": 50, "cursor": nil]
                            as [String: ConvexEncodable?],
                    ], yielding: Page.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            )
            return page.page
        }
        self.saveHandler = { request in
            try await convexClient.mutation(
                TransactionEditorSaveRequest.mutationName, with: request.arguments)
        }
        self.importLinkHandler = { request in
            try await convexClient.mutation(request.mutationName, with: request.arguments)
        }
        self.deletionHandler = { workspaceID, transactionID in
            try await convexClient.mutation(
                "transactions:deleteTransactions",
                with: [
                    "workspaceId": workspaceID,
                    "transactionIds": [transactionID as ConvexEncodable?],
                    "includeBudgetChanges": true,
                ])
        }
        self.creationHandler = { request in
            try await convexClient.mutation(
                request.mutationName, with: request.arguments)
        }
        self.merchantCreator = { workspaceID, name in
            try await convexClient.mutation(
                "merchants:createMerchant", with: ["workspaceId": workspaceID, "name": name])
        }
        self.plannedSaveHandler = { request in
            struct Result: Decodable {
                let scheduledTransactionId: String
                let entered: Bool
            }
            let result: Result = try await convexClient.mutation(
                "scheduledTransactions:updateScheduledTransaction", with: request.arguments)
            guard result.scheduledTransactionId == request.schedule.id else {
                throw TransactionEditorError.saveFailed
            }
            return result.entered
        }
        prepareCreationDraft()
        if let state = sharedChoices?.states.value { applyChoices(state, refresh: false) }
    }

    init(
        workspace: TransactionFeedWorkspace,
        transactionID: String? = nil,
        now: @escaping () -> Date = Date.init,
        detailLoader: @escaping DetailLoader = { _, _ in nil },
        choicesLoader: @escaping ChoicesLoader = { _ in TransactionEditorChoices() },
        choicesStore: TransactionEditorChoicesStore? = nil,
        transferHistoryLoader: @escaping TransferHistoryLoader = { _, _ in [] },
        merchantCreator: @escaping MerchantCreator = { _, _ in
            throw TransactionEditorError.saveFailed
        },
        creationHandler: @escaping CreationHandler = { _ in throw TransactionEditorError.saveFailed
        },
        saveHandler: @escaping SaveHandler = { _ in throw TransactionEditorError.saveFailed },
        importLinkHandler:
            @escaping (TransactionImportLinkRequest) async throws -> TransactionEditorSaveResult = {
                _ in
                throw TransactionEditorError.saveFailed
            },
        deletionHandler: @escaping (String, String) async throws -> TransactionEditorSaveResult = {
            _, _ in
            throw TransactionEditorError.saveFailed
        },
        plannedSaveHandler: @escaping (PlannedSaveRequest) async throws -> Bool = { _ in
            throw TransactionEditorError.saveFailed
        }
    ) {
        if let choicesStore { precondition(choicesStore.workspaceID == workspace.id) }
        self.workspace = workspace
        self.transactionID = transactionID
        self.now = now
        self.detailLoader = detailLoader
        self.choicesLoader = choicesLoader
        self.sharedChoices = choicesStore
        self.merchantCreator = merchantCreator
        self.transferHistoryLoader = transferHistoryLoader
        self.importLinkHandler = importLinkHandler
        self.deletionHandler = deletionHandler
        self.saveHandler = saveHandler
        self.creationHandler = creationHandler
        self.plannedSaveHandler = plannedSaveHandler
        prepareCreationDraft()
        if let state = sharedChoices?.states.value { applyChoices(state, refresh: false) }
    }

    func preparePlannedEdit(_ schedule: PlannedSchedule) {
        guard isCreating, !isDirty, schedule.workspaceId == workspace.id else { return }
        plannedSchedule = schedule
        do {
            let initial = try schedule.editorDraft(workspace: workspace)
            draft = initial
            originalDraft = initial
        } catch {
            draft = nil
            loadErrorMessage = TransactionEditorError.amountOutOfRange.errorDescription
        }
    }

    /// Shortcuts prepare an unsaved draft; only the normal editor can persist it.
    func preselectWidgetCapture(_ type: WidgetCaptureType, shortcut: TransactionShortcutDraft?) {
        guard isCreating, !isDirty, var initial = draft else { return }
        initial.setFlow(type == .income ? .inflow : .outflow)
        initial.setCreatesTransfer(type == .transfer)
        guard let shortcut else {
            draft = initial
            originalDraft = initial
            return
        }
        guard shortcut.matchesWorkspace(id: workspace.id, name: workspace.name) else {
            shortcutNotice = L10n.string(
                "Switch to the shortcut's workspace and run it again. No details were applied.")
            return
        }
        if shortcut.amount != nil {
            if let minorAmount = shortcut.minorUnitAmount(decimalPlaces: workspace.minorUnit) {
                initial.setAmount(minorAmount)
            } else {
                shortcutNotice = L10n.string("Enter an amount greater than zero.")
            }
        }
        if let notes = shortcut.notes { initial.notes = notes }
        if let date = shortcut.date {
            initial.dateKey = TransactionEditorDate.key(from: date, workspace: workspace)
            initial.wantsToSchedule =
                initial.dateKey > TransactionEditorDate.today(workspace: workspace, now: now())
        }
        if let recurrence = shortcut.recurrence {
            initial.recurrence = TransactionEditorRecurrence(rawValue: recurrence.rawValue) ?? .once
            initial.wantsToSchedule = initial.wantsToSchedule || recurrence != .once
        }
        draft = initial
        // Keep the blank original so a complete shortcut can be saved immediately.
        // Lock supplied fields against merchant/history suggestions, including while loading.
        accountManuallySelected = shortcut.account?.isEmpty == false
        categoryManuallySelected = shortcut.category?.isEmpty == false
        pendingShortcutChoices = (shortcut, initial)
        applyPendingShortcutChoices()
        refreshSuggestions()
    }

    private func applyPendingShortcutChoices() {
        guard hasLoadedChoices, let (shortcut, initial) = pendingShortcutChoices,
            var current = draft, !isSaving
        else { return }
        pendingShortcutChoices = nil
        guard current.isTransfer == initial.isTransfer else { return }
        var unresolved = false
        if !editedShortcutFields.contains(.account), let account = shortcut.account,
            !account.isEmpty, current.accountID == initial.accountID
        {
            let matches = choices.accounts.filter {
                $0.isClosed != true && $0.isDeleted != true
                    && $0.name.localizedCaseInsensitiveCompare(account) == .orderedSame
            }
            if matches.count == 1 { current.accountID = matches[0].id } else { unresolved = true }
        }
        if !editedShortcutFields.contains(.category), let category = shortcut.category,
            !category.isEmpty,
            current.allocations.map(\.categoryID) == initial.allocations.map(\.categoryID),
            current.allocations.map(\.readyToAssign) == initial.allocations.map(\.readyToAssign)
        {
            let matches = choices.categories.filter {
                $0.isSelectable
                    && ($0.name.localizedCaseInsensitiveCompare(category) == .orderedSame
                        || "\($0.groupName ?? "") / \($0.name)".localizedCaseInsensitiveCompare(
                            category)
                            == .orderedSame)
            }
            if matches.count == 1 { current.setCategory(matches[0].id) } else { unresolved = true }
        }
        if !editedShortcutFields.contains(.transferAccount), current.isTransfer,
            let account = shortcut.transferAccount, !account.isEmpty,
            current.transferAccountID == initial.transferAccountID
        {
            let matches = choices.accounts.filter {
                $0.isClosed != true && $0.isDeleted != true
                    && $0.name.localizedCaseInsensitiveCompare(account) == .orderedSame
            }
            if matches.count == 1 {
                current.transferAccountID = matches[0].id
            } else {
                unresolved = true
            }
        }
        if !editedShortcutFields.contains(.merchant), !current.isTransfer,
            let payee = shortcut.payee, !payee.isEmpty,
            current.merchantID == initial.merchantID,
            current.pendingMerchantName == initial.pendingMerchantName
        {
            let matches = choices.merchants.filter {
                $0.isDeleted != true
                    && $0.name.localizedCaseInsensitiveCompare(payee) == .orderedSame
            }
            if matches.count == 1 {
                current.merchantID = matches[0].id
            } else if matches.isEmpty {
                current.pendingMerchantName = payee
            } else {
                unresolved = true
            }
        }
        if unresolved {
            shortcutNotice = L10n.string(
                "Some shortcut choices are missing or match more than one item. Review the account, category, and merchant before saving."
            )
        }
        draft = current
    }

    func preselectDate(_ date: String) {
        guard isCreating, !isDirty, var initial = draft,
            TransactionEditorDate.date(from: date, workspace: workspace) != nil
        else { return }
        initial.dateKey = date
        initial.wantsToSchedule =
            date > TransactionEditorDate.today(workspace: workspace, now: now())
        draft = initial
        originalDraft = initial
    }

    func preselectPlannedDate(_ date: String, recurrence: TransactionEditorRecurrence? = nil) {
        guard isCreating, !isDirty, var initial = draft else { return }
        initial.dateKey = date
        if let recurrence { initial.recurrence = recurrence }
        initial.wantsToSchedule = true
        draft = initial
        originalDraft = initial
    }

    var canLinkPlannedTransaction: Bool {
        !isEditingPlan && (isCreating || detail?.type == .regular || detail?.type == .transfer)
    }

    func selectPlannedTransaction(_ id: String?) {
        draft?.scheduledTransactionID = id
        draft?.scheduledOccurrenceDate = choices.plannedTransactions.first { $0.id == id }?.nextDate
    }

    var linkablePlannedTransactions: [TransactionEditorPlannedTransaction] {
        guard let draft else { return [] }
        let plans = choices.plannedTransactions.filter { $0.isLinkable && $0.matches(draft) }
        // Preserve the existing order within both groups and retain every eligible plan.
        return plans.filter { $0.isSuggested(for: draft) }
            + plans.filter { !$0.isSuggested(for: draft) }
    }

    var isPlanned: Bool {
        isEditingPlan
            || draft.map {
                $0.recurrence != .once
                    || $0.dateKey > TransactionEditorDate.today(workspace: workspace, now: now())
            } == true
    }

    var scheduleSummary: String {
        guard let draft else { return "" }
        let isFuture = draft.dateKey > TransactionEditorDate.today(workspace: workspace, now: now())
        if isEditingPlan {
            if requiresScheduleConfirmation {
                return
                    L10n.string(
                        "This date records an entry now and advances the plan. You'll confirm before saving."
                    )
            }
            return
                L10n.string(
                    "Updates this plan and future occurrences. Previously recorded transactions keep their details."
                )
        }
        if isFuture {
            let start =
                isCreating
                ? L10n.string("Saved to Planned.")
                : L10n.string(
                    "Moves this entry to Planned and reverses its current balance impact.")
            return start
                + (draft.entryMode == .automatic
                    ? L10n.string(" Kualia adds it to your transactions on the due date.")
                    : L10n.string(" Add it to your transactions when you're ready."))
        }
        if draft.recurrence != .once {
            return isCreating
                ? L10n.string(
                    "Records this entry now and creates a repeating plan for the next dates.")
                : L10n.string(
                    "Keeps this recorded entry and creates a repeating plan for the next dates.")
        }
        return isCreating
            ? L10n.string("Adds a transaction to your account now.")
            : L10n.string("Updates this recorded transaction.")
    }

    var editorTitle: String {
        isEditingPlan
            ? L10n.string("Edit scheduled transaction")
            : isCreating ? L10n.string("New transaction") : L10n.string("Edit transaction")
    }

    var isDirty: Bool { draft != nil && draft != (openingSuggestionDraft ?? originalDraft) }

    /// Context supplied by an account page is the initial state, not an unsaved user edit.
    func preselectAccount(_ accountID: String) {
        guard isCreating, !isDirty, !isSaving, savedReceipt == nil,
            loadTask == nil,
            !accountID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            var initial = draft,
            initial.accountID.isEmpty || initial.accountID == appliedDefaultAccountID
        else { return }
        initial.accountID = accountID
        appliedDefaultAccountID = nil
        accountManuallySelected = true
        draft = initial
        originalDraft = initial
    }

    func selectStatus(_ status: TransactionFeedStatus) {
        statusManuallySelected = true
        draft?.status = status
    }

    func selectMerchant(_ id: String) {
        editedShortcutFields.insert(.merchant)
        draft?.merchantID = id == "none" || id == "original" ? nil : id
        draft?.useOriginalStatement = id == "original"
        draft?.pendingMerchantName = nil
        refreshSuggestions()
    }

    func selectCategory(_ id: String) {
        editedShortcutFields.insert(.category)
        categoryManuallySelected = true
        draft?.setCategory(id == "none" || id == "rta" ? nil : id, readyToAssign: id == "rta")
    }

    func selectFlow(_ flow: TransactionEditorFlow) {
        guard !isSaving else { return }
        draft?.setFlow(flow)
        if flow == .inflow, isCreating, draft?.isTransfer == false,
            supportsCategories, needsCategorySelection
        {
            // Protect the income default from later merchant-history suggestions.
            selectCategory("rta")
        }
        refreshSuggestions()
    }

    func didApplySplits() {
        editedShortcutFields.insert(.category)
        categoryManuallySelected = true
    }

    func selectAccount(_ id: String) {
        editedShortcutFields.insert(.account)
        appliedDefaultAccountID = nil
        accountManuallySelected = true
        draft?.accountID = id
        refreshSuggestions()
    }

    func selectTransferAccount(_ id: String) {
        editedShortcutFields.insert(.transferAccount)
        draft?.transferAccountID = id
        refreshSuggestions()
    }

    func refreshSuggestions() {
        suggestionTask?.cancel()
        suggestionGeneration = UUID()
        guard isCreating, let draft, !isSaving, savedReceipt == nil,
            !categoryManuallySelected || !accountManuallySelected
        else { return }
        if !draft.isTransfer {
            guard let merchant = choices.merchants.first(where: { $0.id == draft.merchantID }),
                merchant.isDeleted != true, draft.pendingMerchantName == nil,
                !draft.useOriginalStatement
            else { return }
            applySuggestions(
                accountID: merchant.suggestedBankAccountId,
                categoryIDs: merchant.suggestedCategoryIds ?? [])
            return
        }
        guard let accountID = draft.transferAccountID else { return }
        let current = suggestionGeneration
        let inflow = draft.isIncomingTransfer
        suggestionTask = Task { [weak self] in
            guard let self else { return }
            do {
                let history: [TransactionEditorDetail]
                if let cached = transferHistory[accountID] {
                    history = cached
                } else {
                    history = try await transferHistoryLoader(workspace.id, accountID)
                }
                guard current == suggestionGeneration, !Task.isCancelled else { return }
                transferHistory[accountID] = history
                guard self.draft?.isTransfer == true,
                    self.draft?.transferAccountID == accountID,
                    self.draft?.isIncomingTransfer == inflow,
                    !isSaving, savedReceipt == nil
                else { return }
                // History is for the other side, so its sign is opposite the draft's.
                guard
                    let previous = history.first(where: { transaction in
                        transaction.workspaceId == self.workspace.id && !transaction.isDeleted
                            && transaction.type == .transfer
                            && transaction.bankAccountId == accountID
                            && transaction.reviewStatus == .reviewed
                            && transaction.totalAmount != 0
                            && (transaction.totalAmount < 0) == inflow
                            && transaction.transferPairBankAccountId != accountID
                            && self.choices.accounts.contains(where: { account in
                                account.id == transaction.transferPairBankAccountId
                                    && account.isDeleted != true && account.isClosed != true
                            })
                            && (!self.accountManuallySelected
                                || transaction.transferPairBankAccountId == self.draft?.accountID)
                    })
                else { return }
                var movements = previous.movements
                if let pairID = previous.transferPairId,
                    choices.accounts.first(where: { $0.id == accountID })?.isOnBudget == false,
                    let pair = try? await detailLoader(workspace.id, pairID),
                    pair.workspaceId == workspace.id, !pair.isDeleted, pair.type == .transfer,
                    pair.bankAccountId == previous.transferPairBankAccountId
                {
                    movements = pair.movements
                }
                guard current == suggestionGeneration, !Task.isCancelled,
                    self.draft?.isTransfer == true, self.draft?.isIncomingTransfer == inflow,
                    !isSaving, savedReceipt == nil
                else { return }
                applySuggestions(
                    accountID: previous.transferPairBankAccountId,
                    categoryIDs: movements.compactMap(\.categoryId),
                    readyToAssign: movements.first?.readyToAssign == true)
            } catch {
                // Suggestions are optional; keep the user's draft usable if history is unavailable.
            }
        }
    }

    private func applySuggestions(
        accountID: String?, categoryIDs: [String], readyToAssign: Bool = false
    ) {
        guard isCreating else { return }
        if !accountManuallySelected, appliedDefaultAccountID == nil, let accountID,
            choices.accounts.contains(where: {
                $0.id == accountID && $0.isDeleted != true && $0.isClosed != true
            }), draft?.isTransfer != true || accountID != draft?.transferAccountID
        {
            draft?.accountID = accountID
        }
        guard !categoryManuallySelected, supportsCategories,
            (draft?.allocations.count ?? 0) <= 1
        else { return }
        if readyToAssign {
            draft?.setCategory(nil, readyToAssign: true)
        } else if let categoryID = categoryIDs.first(where: { id in
            choices.categories.contains { $0.id == id && $0.isSelectable }
        }) {
            draft?.setCategory(categoryID)
        }
    }

    var needsApproval: Bool {
        !isCreating && !isEditingPlan && detail?.reviewStatus == .needsReview
    }

    var hasLinkedImport: Bool {
        detail?.linkedRawTransactionId != nil && detail?.importDetails != nil
            && detail?.type == .regular && !isCreating && !isEditingPlan
    }

    var canResolveImportLink: Bool {
        hasLinkedImport && !isDirty && !isSaving && !isLoading && savedReceipt == nil
    }

    func resolveImportLink(_ action: TransactionImportLinkRequest.Action) async -> Bool {
        guard canResolveImportLink, let transactionID, let detail else { return false }
        let current = generation
        isSaving = true
        saveErrorMessage = nil
        defer { isSaving = false }
        do {
            let result = try await importLinkHandler(
                .init(workspaceID: workspace.id, transactionID: transactionID, action: action))
            guard result.success else { throw TransactionEditorError.saveFailed }
            guard current == generation, !Task.isCancelled else { return false }
            let date: String
            if case .approve(_, true) = action {
                date = detail.importDetails?.date ?? detail.date
            } else {
                date = detail.date
            }
            savedReceipt = TransactionMutationReceipt(
                workspace: workspace, dateKey: date, kind: .updated,
                budgetChanges: result.budgetChanges ?? [], transactionID: transactionID)
            return true
        } catch {
            guard current == generation else { return false }
            saveErrorMessage = L10n.string("Couldn't update the bank match. Please try again.")
            return false
        }
    }

    var supportsTransferToggle: Bool {
        isCreating || isEditingPlan || detail?.type == .regular || detail?.type == .transfer
    }

    func setTransfer(_ enabled: Bool) {
        if enabled && draft?.isTransfer == false { regularDraftBeforeTransfer = draft }
        if draft?.isTransfer != enabled { draft?.scheduledTransactionID = nil }
        draft?.setCreatesTransfer(enabled)
        if !enabled, let regular = regularDraftBeforeTransfer {
            draft?.scheduledTransactionID = regular.scheduledTransactionID
            draft?.scheduledOccurrenceDate = regular.scheduledOccurrenceDate
            draft?.allocations = regular.allocations
            if draft?.allocations.count == 1, let amount = draft?.signedAmount {
                draft?.allocations[0].amount = amount
            }
        }
        draft?.acknowledgesTransferSuggestionRejection =
            !enabled && detail?.suggestedTransfer?.isActionable == true
        refreshSuggestions()
    }

    var canSave: Bool {
        (isDirty || needsApproval) && !isSaving && savedReceipt == nil && validationMessage == nil
    }
    var requiresScheduleConfirmation: Bool {
        guard let draft, let originalDraft else { return false }
        if isEditingPlan {
            return draft.dateKey != originalDraft.dateKey
                && draft.dateKey <= TransactionEditorDate.today(workspace: workspace, now: now())
                && !draft.wantsToSchedule
        }
        return draft.dateKey != originalDraft.dateKey
            && draft.dateKey > TransactionEditorDate.today(workspace: workspace, now: now())
            && !draft.wantsToSchedule
    }
    var canSaveAfterScheduleConfirmation: Bool {
        guard isDirty, !isSaving, var confirmedDraft = draft else { return false }
        confirmedDraft.wantsToSchedule = true
        return validationMessage(for: confirmedDraft) == nil
    }

    var supportsCategories: Bool {
        guard let draft,
            isCreating || isEditingPlan || detail?.type == .regular || detail?.type == .transfer
        else {
            return false
        }
        let account = choices.accounts.first { $0.id == draft.accountID } ?? detail?.bankAccount
        if draft.isTransfer {
            guard let account else { return detail?.isCrossBudgetTransfer == true }
            guard let other = choices.accounts.first(where: { $0.id == draft.transferAccountID })
            else {
                return detail?.isCrossBudgetTransfer == true
            }
            return account.isOnBudget != other.isOnBudget
        }
        return account?.isOnBudget ?? true
    }

    var categoryEditingAvailable: Bool { supportsCategories }

    /// Status and other untouched fields should not validate a blank opening amount.
    var inlineValidationMessage: String? {
        guard isDirty else { return nil }
        if isCreating, draft?.amount == 0, !hasEditedAmount { return nil }
        return validationMessage
    }

    func setAmount(from calculator: AmountCalculator) {
        hasEditedAmount = true
        draft?.setAmount(from: calculator)
    }

    var validationMessage: String? {
        guard let draft else { return nil }
        return validationMessage(for: draft)
    }

    private func validationMessage(for draft: TransactionEditorDraft) -> String? {
        guard let originalDraft else { return nil }
        guard draft.amount > 0 else { return L10n.string("Enter an amount greater than zero.") }
        guard !draft.accountID.isEmpty else { return L10n.string("Choose an account.") }
        if isCreating && !choices.accounts.contains(where: { $0.id == draft.accountID }) {
            return L10n.string("Choose an available account.")
        }
        guard TransactionEditorDate.date(from: draft.dateKey, workspace: workspace) != nil else {
            return L10n.string("Choose a valid date.")
        }
        if detail?.suggestedTransfer?.isActionable == true
            && !draft.isTransfer && !draft.acknowledgesTransferSuggestionRejection
        {
            return L10n.string(
                "Confirm declining the suggested transfer before saving these edits.")
        }
        if draft.isTransfer {
            guard let other = draft.transferAccountID, !other.isEmpty else {
                return L10n.string("Choose the other account.")
            }
            if (isCreating || !originalDraft.isTransfer || other != originalDraft.transferAccountID)
                && !choices.accounts.contains(where: {
                    $0.id == other && $0.isClosed != true && $0.isDeleted != true
                })
            {
                return L10n.string("Choose an available destination account.")
            }
            guard other != draft.accountID else {
                return L10n.string("Choose two different accounts for the transfer.")
            }
        } else {
            guard !draft.allocations.isEmpty else {
                return L10n.string("Add at least one category line.")
            }
            guard draft.allocations.allSatisfy({ $0.amount != 0 }) else {
                return L10n.string("Every split needs an amount greater than zero.")
            }
            guard draft.allocatedAmount == draft.signedAmount else {
                return L10n.string("Your splits need to add up to the transaction amount.")
            }
        }
        if let plan = plannedSchedule {
            if plan.status == "completed", draft.dateKey == originalDraft.dateKey {
                return L10n.string("Choose a new date to restart this completed plan.")
            }
            if draft.dateKey != originalDraft.dateKey,
                draft.dateKey <= TransactionEditorDate.today(workspace: workspace, now: now()),
                !draft.wantsToSchedule
            {
                return
                    L10n.string(
                        "Confirm recording this occurrence before saving a date that is today or earlier."
                    )
            }
            return nil
        }
        let hasFutureDateChange =
            draft.dateKey != originalDraft.dateKey
            && draft.dateKey > TransactionEditorDate.today(workspace: workspace, now: now())
        let changesPlannedLink =
            draft.scheduledTransactionID != originalDraft.scheduledTransactionID
            || draft.scheduledOccurrenceDate != originalDraft.scheduledOccurrenceDate
        if changesPlannedLink
            && (draft.recurrence != .once || hasFutureDateChange
                || (isCreating
                    && draft.dateKey > TransactionEditorDate.today(workspace: workspace, now: now())))
        {
            return L10n.string("Choose either an existing planned transaction or a new schedule.")
        }
        if let plannedID = draft.scheduledTransactionID,
            changesPlannedLink,
            hasLoadedChoices,
            !choices.plannedTransactions.contains(where: {
                $0.id == plannedID && $0.isLinkable && $0.matches(draft)
            }
            )
        {
            return L10n.string(
                "Choose an available planned transaction for these accounts, or remove the link.")
        }
        if hasFutureDateChange {
            if !isCreating && detail?.type != .regular && detail?.type != .transfer {
                return L10n.string("Balance entries can't be scheduled for a future date.")
            }
            if !draft.wantsToSchedule {
                return L10n.string(
                    "Confirm moving this transaction to Planned before saving a future date.")
            }
        }
        if (draft.recurrence != .once || draft.wantsToSchedule) && !isCreating
            && detail?.type != .regular
            && detail?.type != .transfer
        {
            return L10n.string("Balance entries can't repeat.")
        }
        return nil
    }

    private func applyChoices(_ state: TransactionEditorChoicesStore.State, refresh: Bool = true) {
        if let loaded = state.choices { choices = loaded }
        hasLoadedChoices = state.choices != nil
        isLoadingChoices = state.isLoading
        choicesErrorMessage = state.errorMessage
        applyCreationDefaults()
        applyPendingShortcutChoices()
        if refresh {
            applyImportedTransferSuggestion()
            refreshSuggestions()
        }
    }

    private func observeSharedChoices() {
        guard let sharedChoices, choicesSubscription == nil else { return }
        if ownsChoices { sharedChoices.start() }
        choicesSubscription = sharedChoices.states.sink { [weak self] state in
            self?.applyChoices(state)
        }
    }

    func load() async {
        observeSharedChoices()
        if let loadTask {
            await loadTask.value
            return
        }
        let current = generation
        let task = Task { [weak self] in
            guard let self else { return }
            async let transaction: Void = self.loadDetailIfNeeded()
            async let options: Void = self.reloadChoicesIfNeeded()
            _ = await (transaction, options)
            self.applyImportedTransferSuggestion()
        }
        loadTask = task
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        if current == generation { loadTask = nil }
    }

    func reloadChoices() async {
        if let sharedChoices {
            observeSharedChoices()
            sharedChoices.retry()
            return
        }
        guard !isLoadingChoices else { return }
        let current = generation
        isLoadingChoices = true
        choicesErrorMessage = nil
        defer { if current == generation { isLoadingChoices = false } }
        do {
            let loaded = try await choicesLoader(workspace.id)
            guard current == generation, !Task.isCancelled else { return }
            choices = loaded
            hasLoadedChoices = true
            applyCreationDefaults()
            applyPendingShortcutChoices()
            applyImportedTransferSuggestion()
            refreshSuggestions()
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            choicesErrorMessage =
                L10n.string(
                    "We couldn't load your merchants, accounts, and categories. Please try again.")
        }
    }

    func stop() {
        choicesSubscription?.cancel()
        choicesSubscription = nil
        if ownsChoices { sharedChoices?.stop() }
        suggestionTask?.cancel()
        suggestionGeneration = UUID()
        generation = UUID()
        loadTask?.cancel()
        loadTask = nil
        isLoading = false
        isLoadingChoices = false
    }

    var needsCategorySelection: Bool {
        isCreating && !categoryManuallySelected && draft?.allocations.count == 1
            && draft?.allocations.first?.categoryID == nil
            && draft?.allocations.first?.readyToAssign != true
    }

    var categoryPickerChoices: [TransactionEditorChoice] {
        [
            TransactionEditorChoice(id: "none", title: L10n.string("Uncategorized"), symbol: nil),
            TransactionEditorChoice(id: "rta", title: L10n.string("Ready to Assign"), symbol: nil),
        ]
            + choices.categories.map {
                TransactionEditorChoice(
                    id: $0.id, title: $0.name, symbol: nil,
                    groupID: $0.categoryGroupId ?? "ungrouped",
                    groupTitle: $0.groupName ?? L10n.string("Other categories"))
            }
    }

    func categorizeAndApprove(
        _ categoryID: String, acknowledgesTransferSuggestionRejection: Bool = false
    ) async -> Bool {
        guard
            prepareCategorization(
                categoryID,
                acknowledgesTransferSuggestionRejection: acknowledgesTransferSuggestionRejection)
        else { return false }
        return await save()
    }

    func prepareCategorization(
        _ categoryID: String, acknowledgesTransferSuggestionRejection: Bool = false
    ) -> Bool {
        guard !isCreating, !isEditingPlan, !isSaving, savedReceipt == nil, hasLoadedChoices,
            supportsCategories
                || (detail?.type == .regular && detail?.bankAccount?.isOnBudget != false),
            categoryID != "none", categoryPickerChoices.contains(where: { $0.id == categoryID }),
            var categorizing = originalDraft
        else { return false }
        let indices = categorizing.allocations.indices.filter {
            categorizing.allocations[$0].categoryID == nil
                && !categorizing.allocations[$0].readyToAssign
        }
        guard !indices.isEmpty else {
            saveErrorMessage = L10n.string("This transaction is already categorized.")
            return false
        }
        for index in indices {
            categorizing.allocations[index].categoryID = categoryID == "rta" ? nil : categoryID
            categorizing.allocations[index].readyToAssign = categoryID == "rta"
        }
        categorizing.reviewStatus = .reviewed
        categorizing.acknowledgesTransferSuggestionRejection =
            acknowledgesTransferSuggestionRejection
        draft = categorizing
        if let validationMessage {
            saveErrorMessage = validationMessage
            return false
        }
        return true
    }

    var canDelete: Bool {
        transactionID != nil && !isEditingPlan && detail != nil && !isLoading
            && !isSaving && savedReceipt == nil
    }

    func delete() async -> Bool {
        guard canDelete, let transactionID, let originalDraft else { return false }
        let current = generation
        isSaving = true
        saveErrorMessage = nil
        defer { isSaving = false }
        do {
            let result = try await deletionHandler(workspace.id, transactionID)
            guard result.success else { throw TransactionEditorError.saveFailed }
            guard current == generation, !Task.isCancelled else { return false }
            savedReceipt = TransactionMutationReceipt(
                workspace: workspace, dateKey: originalDraft.dateKey, kind: .deleted,
                budgetChanges: result.budgetChanges ?? [], transactionID: transactionID)
            return true
        } catch {
            guard current == generation else { return false }
            saveErrorMessage = TransactionFeedAction.delete.failureMessage
            return false
        }
    }

    func save() async -> Bool {
        guard canSave, var savingDraft = draft, let originalDraft else { return false }
        if needsApproval { savingDraft.reviewStatus = .reviewed }
        let current = generation
        isSaving = true
        saveErrorMessage = nil
        defer { isSaving = false }
        do {
            if !savingDraft.isTransfer,
                let proposed = savingDraft.pendingMerchantName?.trimmingCharacters(
                    in: .whitespacesAndNewlines), !proposed.isEmpty
            {
                let existing = choices.merchants.first {
                    $0.name.compare(proposed, options: [.caseInsensitive, .diacriticInsensitive])
                        == .orderedSame
                }
                let merchantID: String
                if let existing {
                    merchantID = existing.id
                } else {
                    merchantID = try await merchantCreator(workspace.id, proposed)
                    guard current == generation, !Task.isCancelled else { return false }
                    choices.merchants.append(
                        TransactionEditorMerchant(id: merchantID, name: proposed))
                }
                savingDraft.merchantID = merchantID
                savingDraft.pendingMerchantName = nil
                savingDraft.useOriginalStatement = false
                // Keep the created identity on retry if the transaction mutation fails.
                draft = savingDraft
            }
            guard current == generation, !Task.isCancelled else { return false }
            if let plan = plannedSchedule {
                let entered = try await plannedSaveHandler(
                    PlannedSaveRequest(
                        workspaceID: workspace.id, schedule: plan, draft: savingDraft,
                        original: originalDraft))
                guard current == generation, !Task.isCancelled else { return false }
                self.originalDraft = savingDraft
                savedReceipt = TransactionMutationReceipt(
                    workspace: workspace, dateKey: savingDraft.dateKey, kind: .updated,
                    budgetChanges: [], isScheduledOnly: !entered)
                return true
            }
            if isCreating {
                let result = try await creationHandler(
                    TransactionCreationRequest(
                        workspaceID: workspace.id, draft: savingDraft,
                        includesCategories: supportsCategories))
                guard result.transactionId != nil || result.scheduledTransactionId != nil else {
                    throw TransactionEditorError.saveFailed
                }
                guard current == generation, !Task.isCancelled else { return false }
                self.originalDraft = savingDraft
                savedReceipt = TransactionMutationReceipt(
                    workspace: workspace, dateKey: savingDraft.dateKey,
                    budgetChanges: result.budgetChanges, isScheduledOnly: result.isScheduledOnly,
                    transactionID: result.transactionId)
                return true
            }
            guard let transactionID else { return false }
            let result = try await saveHandler(
                TransactionEditorSaveRequest(
                    workspaceID: workspace.id, transactionID: transactionID,
                    draft: savingDraft, original: originalDraft
                ))
            guard result.success else { throw TransactionEditorError.saveFailed }
            guard current == generation, !Task.isCancelled else { return false }
            self.originalDraft = savingDraft
            didConvertToScheduled = result.convertedToScheduled == true
            savedReceipt = TransactionMutationReceipt(
                workspace: workspace, dateKey: savingDraft.dateKey, kind: .updated,
                budgetChanges: result.budgetChanges ?? [], isScheduledOnly: didConvertToScheduled,
                transactionID: result.transactionId ?? transactionID)
            return true
        } catch {
            guard current == generation else { return false }
            saveErrorMessage =
                (error as? TransactionEditorError)?.errorDescription
                ?? L10n.string(
                    "We couldn't save your changes. Your edits are still here. Please try again.")
            return false
        }
    }

    private func applyImportedTransferSuggestion() {
        guard let detail, detail.reviewStatus == .needsReview,
            detail.suggestedTransfer?.isActionable == true,
            draft == originalDraft, hasLoadedChoices, !didApplyImportedSuggestion
        else { return }
        didApplyImportedSuggestion = true
        setTransfer(true)
        let suggestion = detail.suggestedTransfer
        if let id = matchedSuggestionAccountID ?? suggestion?.reliableAccountID,
            id != draft?.accountID,
            choices.accounts.contains(where: {
                $0.id == id && $0.isClosed != true && $0.isDeleted != true
            })
        {
            draft?.transferAccountID = id
        }
        openingSuggestionDraft = draft
    }

    func prepareDuplication(of transactionID: String) {
        guard isCreating, !isDirty, !isSaving, loadTask == nil else { return }
        duplicationSourceID = transactionID
        draft = nil
        // Copied choices must survive merchant and transfer-history suggestions.
        categoryManuallySelected = true
        accountManuallySelected = true
    }

    /// Defaults seed a new draft once, including when choices arrive after the
    /// sheet opens. Page context and explicit user selections take precedence.
    private func applyCreationDefaults() {
        guard hasLoadedChoices, !hasAppliedCreationDefaults, isCreating,
            duplicationSourceID == nil, !isSaving, savedReceipt == nil,
            var current = draft
        else { return }
        hasAppliedCreationDefaults = true
        if !accountManuallySelected, current.accountID.isEmpty,
            let id = choices.defaults.transactionDefaultAccountId,
            choices.accounts.contains(where: {
                $0.id == id && $0.isClosed != true && $0.isDeleted != true
            })
        {
            current.accountID = id
            originalDraft?.accountID = id
            appliedDefaultAccountID = id
        }
        if !statusManuallySelected, current.status == originalDraft?.status {
            let status: TransactionFeedStatus =
                choices.defaults.transactionDefaultPendingStatus == true ? .pending : .cleared
            current.status = status
            originalDraft?.status = status
        }
        draft = current
    }

    private func prepareCreationDraft() {
        guard isCreating else { return }
        let initial = TransactionEditorDraft(workspace: workspace, now: now())
        draft = initial
        originalDraft = initial
    }

    private func reloadChoicesIfNeeded() async {
        if let sharedChoices {
            // Keep load()'s readiness contract for widget capture presets. This
            // observes the existing subscription; it does not start another query.
            _ = try? await TransactionEditorQuery<TransactionEditorChoicesStore.State>().read(
                sharedChoices.states.filter { !$0.isLoading }
                    .setFailureType(to: Error.self).eraseToAnyPublisher())
        } else if !hasLoadedChoices {
            await reloadChoices()
        }
    }

    private func loadDetailIfNeeded() async {
        guard draft == nil, let transactionID = duplicationSourceID ?? transactionID else { return }
        let current = generation
        isLoading = true
        loadErrorMessage = nil
        defer { if current == generation { isLoading = false } }
        do {
            guard let loaded = try await detailLoader(workspace.id, transactionID),
                !loaded.isDeleted
            else {
                throw TransactionEditorError.notFound
            }
            guard loaded.workspaceId == workspace.id else { throw TransactionEditorError.notFound }
            var loadedDraft = try TransactionEditorDraft(detail: loaded)
            // An off-budget transfer side has no budget category. Edit the category
            // attached to the on-budget side while retaining this side's amount sign.
            if loaded.isCrossBudgetTransfer == true, loaded.bankAccount?.isOnBudget == false,
                let pairID = loaded.transferPairId,
                let pair = try await detailLoader(workspace.id, pairID),
                !pair.isDeleted, pair.workspaceId == workspace.id,
                let pairAllocation = pair.movements.first, !loadedDraft.allocations.isEmpty
            {
                loadedDraft.allocations[0].categoryID = pairAllocation.categoryId
                loadedDraft.allocations[0].readyToAssign = pairAllocation.readyToAssign
            }
            if duplicationSourceID == nil,
                loaded.suggestedTransfer?.status == "linked_pending_approval",
                let pairID = loaded.suggestedTransfer?.matchedTransactionId,
                let pair = try? await detailLoader(workspace.id, pairID),
                !pair.isDeleted, pair.workspaceId == workspace.id, pair.type == .regular,
                pair.bankAccountId != loaded.bankAccountId,
                pair.totalAmount == -loaded.totalAmount,
                pair.suggestedTransfer?.matchedTransactionId == loaded.id,
                pair.suggestedTransfer?.status == "linked_pending_approval"
            {
                guard current == generation, !Task.isCancelled else { return }
                matchedSuggestionAccountID = pair.bankAccountId
            }
            guard current == generation, !Task.isCancelled else { return }
            if duplicationSourceID != nil {
                loadedDraft.scheduledTransactionID = nil
                loadedDraft.reviewStatus = .reviewed
                if loadedDraft.status == .reconciled { loadedDraft.status = .cleared }
                if !loadedDraft.isTransfer, loadedDraft.merchantID == nil {
                    loadedDraft.pendingMerchantName =
                        loaded.merchantName ?? loaded.importDetails?.merchantName
                        ?? loaded.importDetails?.originalStatement
                }
                // Keep the blank original draft so the copy can be saved immediately
                // and dismissing it offers the usual unsaved-changes protection.
                draft = loadedDraft
            } else {
                detail = loaded
                draft = loadedDraft
                originalDraft = loadedDraft
            }
        } catch {
            guard current == generation, !Task.isCancelled else { return }
            loadErrorMessage =
                (error as? TransactionEditorError)?.errorDescription
                ?? L10n.string("We couldn't load this transaction. Please try again.")
        }
    }
}

struct TransactionEditorNull: ConvexEncodable {
    func convexEncode() throws -> String { "null" }
}

/// A one-value subscription with a deadline and cancellation, independent of the form lifecycle.
@MainActor
final class TransactionEditorQuery<Value> {
    private var subscription: AnyCancellable?
    private var deadline: Task<Void, Never>?
    private var continuation: CheckedContinuation<Value, Error>?

    // Swift 6.3.3 crashes in EarlyPerfInliner on the synthesized generic deinit
    // during Release builds. Keep automatic property cleanup without optimizing it.
    @_optimize(none)
    deinit {}

    func read(_ publisher: AnyPublisher<Value, Error>, timeout: Duration = .seconds(15))
        async throws -> Value
    {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                subscription = publisher.receive(on: DispatchQueue.main).first().sink(
                    receiveCompletion: { [weak self] completion in
                        switch completion {
                        case .failure(let error): self?.finish(.failure(error))
                        case .finished:
                            self?.finish(.failure(TransactionEditorError.endedWithoutResponse))
                        }
                    },
                    receiveValue: { [weak self] value in self?.finish(.success(value)) }
                )
                deadline = Task { [weak self] in
                    do { try await Task.sleep(for: timeout) } catch { return }
                    self?.finish(.failure(TransactionEditorError.connectionTimedOut))
                }
            }
        } onCancel: {
            Task { @MainActor in self.finish(.failure(CancellationError())) }
        }
    }

    private func finish(_ result: Result<Value, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        subscription?.cancel()
        subscription = nil
        deadline?.cancel()
        deadline = nil
        continuation.resume(with: result)
    }
}
