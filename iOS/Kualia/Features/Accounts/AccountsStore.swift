import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class AccountsStore {
    private let connectionStoreFactory: ((AccountConnectionPurpose) -> AccountConnectionStore)?
    private let transactionStoreFactory: ((String) -> TransactionFeedStore)?

    typealias AccountsSubscription = (String) -> AnyPublisher<[AccountSnapshot], Error>
    typealias OrderingSubscription = (String) -> AnyPublisher<AccountOrdering?, Error>
    typealias HistorySubscription = (String, Int64) -> AnyPublisher<AccountHistoryReport, Error>
    typealias MutationHandler = (AccountMutationRequest) async throws -> String?
    typealias TransactionsChecker = (String, String) async throws -> Bool
    typealias WorkspaceLoader = () async throws -> BudgetWorkspace?

    private(set) var workspace: TransactionFeedWorkspace?
    private(set) var accounts: [AccountSnapshot] = []
    private(set) var history: [AccountHistoryMonth] = []
    private var historyCurrentMonth: String?
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    private(set) var isLoadingHistory = false
    private(set) var errorMessage: String?
    private(set) var historyErrorMessage: String?
    private(set) var isSaving = false
    private(set) var lastCreatedAccountID: String?
    private(set) var latestCreationReceipt: TransactionMutationReceipt?
    private(set) var latestLifecycleReceipt: TransactionMutationReceipt?
    private(set) var collapsedCategoryIDs: Set<String> = []
    var actionErrorMessage: String?

    private var savedOrdering = AccountOrdering()
    private var lastOrderingRevision: UUID?
    private var orderDraft: AccountOrdering?
    private var orderBaseline: AccountOrdering?
    private(set) var isSavingOrder = false
    var orderingError: String?
    var accountOrdering: AccountOrdering { savedOrdering }
    var reorderGroups: [BudgetCategoryGroup] {
        (orderDraft ?? savedOrdering).reorderGroups(accounts: accounts)
    }
    var hasAccountOrderChanges: Bool {
        guard let orderDraft, let orderBaseline else { return false }
        return orderDraft.normalized(accounts: accounts)
            != orderBaseline.normalized(accounts: accounts)
    }
    var canReorderAccounts: Bool {
        hasLoaded && workspace != nil && errorMessage == nil && !isSaving && !isSavingOrder
            && !activeAccounts.isEmpty
    }
    private var orderedAccounts: [AccountSnapshot] {
        accountOrdering.sections(accounts: accounts).flatMap(\.accounts)
    }
    var activeAccounts: [AccountSnapshot] { orderedAccounts.filter { !$0.isClosed } }
    var closedAccounts: [AccountSnapshot] { orderedAccounts.filter(\.isClosed) }
    var availableCategories: [AccountCategory] {
        accountOrdering.sections(accounts: activeAccounts).map(\.category)
    }
    var totalBalance: Decimal { activeAccounts.reduce(.zero) { $0 + Decimal($1.currentBalance) } }

    @ObservationIgnored private let subscribeToAccounts: AccountsSubscription
    @ObservationIgnored private let subscribeToOrdering: OrderingSubscription
    @ObservationIgnored private let subscribeToHistory: HistorySubscription
    @ObservationIgnored private let performMutation: MutationHandler
    @ObservationIgnored private let checkTransactions: TransactionsChecker
    @ObservationIgnored private let requestedWorkspaceID: String?
    @ObservationIgnored private let loadWorkspace: WorkspaceLoader?
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private let responseTimeout: Duration
    @ObservationIgnored private var client: ConvexClientWithAuth<String>?
    @ObservationIgnored private var accountsSubscription: AnyCancellable?
    @ObservationIgnored private var historySubscription: AnyCancellable?
    @ObservationIgnored private var accountsDeadline: Task<Void, Never>?
    @ObservationIgnored private var historyDeadline: Task<Void, Never>?
    @ObservationIgnored private var workspaceLoadTask: Task<Void, Never>?
    @ObservationIgnored private var subscriptionGeneration = UUID()
    @ObservationIgnored private var workspaceGeneration = UUID()
    @ObservationIgnored private var subscribedHistoryMonth: Int64?
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var hasReceivedHistory = false

    @ObservationIgnored private var choicesStore: TransactionEditorChoicesStore?

    convenience init(
        convexClient: ConvexClientWithAuth<String>, workspaceID: String? = nil,
        choicesStore: TransactionEditorChoicesStore? = nil
    ) {
        self.init(
            workspaceID: workspaceID,
            workspaceLoader: {
                let result = try await TransactionEditorQuery<AccountsWorkspaceResponse>().read(
                    convexClient.subscribe(
                        to: "categoryBudgets:listBudgetStructure",
                        with: workspaceID.map { ["workspaceId": $0 as ConvexEncodable?] } ?? [:],
                        yielding: AccountsWorkspaceResponse.self
                    ).mapError { $0 as Error }.eraseToAnyPublisher())
                return result.workspace
            },
            accountsSubscription: { workspaceID in
                convexClient.subscribe(
                    to: "bankAccounts:listBankAccounts", with: ["workspaceId": workspaceID],
                    yielding: [AccountSnapshot].self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            historySubscription: { workspaceID, yearMonth in
                convexClient.subscribe(
                    to: "reports:getNetWorthReport",
                    with: [
                        "workspaceId": workspaceID, "currentYearMonth": yearMonth,
                    ],
                    yielding: AccountHistoryReport.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            orderingSubscription: { workspaceID in
                convexClient.subscribe(
                    to: "workspaces:getWorkspace", with: ["workspaceId": workspaceID],
                    yielding: AccountOrderingWorkspace.self
                ).map(\.bankAccountOrdering).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            mutationHandler: { request in
                if case .create = request.operation {
                    let id: String = try await convexClient.mutation(
                        request.mutationName, with: request.arguments)
                    return id
                }
                let result: AccountMutationResult = try await convexClient.mutation(
                    request.mutationName, with: request.arguments)
                guard result.success else { throw AccountStoreError.saveFailed }
                return nil
            },
            transactionsChecker: { workspaceID, accountID in
                try await TransactionEditorQuery<Bool>().read(
                    convexClient.subscribe(
                        to: "bankAccounts:hasTransactions",
                        with: ["workspaceId": workspaceID, "bankAccountId": accountID],
                        yielding: Bool.self
                    ).mapError { $0 as Error }.eraseToAnyPublisher()
                )
            }
        )
        self.choicesStore = choicesStore
        client = convexClient
    }

    init(
        now: @escaping () -> Date = Date.init,
        defaults: UserDefaults? = .standard,
        responseTimeout: Duration = .seconds(15),
        workspaceID: String? = nil,
        transactionStoreFactory: ((String) -> TransactionFeedStore)? = nil,
        connectionStoreFactory: ((AccountConnectionPurpose) -> AccountConnectionStore)? = nil,
        workspaceLoader: WorkspaceLoader? = nil,
        accountsSubscription: @escaping AccountsSubscription,
        historySubscription: @escaping HistorySubscription,
        orderingSubscription: @escaping OrderingSubscription = { _ in
            Just(nil).setFailureType(to: Error.self).eraseToAnyPublisher()
        },
        mutationHandler: @escaping MutationHandler = { _ in throw AccountStoreError.saveFailed },
        transactionsChecker: @escaping TransactionsChecker = { _, _ in
            throw AccountStoreError.loadFailed
        }
    ) {
        self.transactionStoreFactory = transactionStoreFactory
        self.connectionStoreFactory = connectionStoreFactory
        self.requestedWorkspaceID = workspaceID
        self.now = now
        self.defaults = defaults
        self.responseTimeout = responseTimeout
        loadWorkspace = workspaceLoader
        subscribeToAccounts = accountsSubscription
        subscribeToHistory = historySubscription
        subscribeToOrdering = orderingSubscription
        performMutation = mutationHandler
        checkTransactions = transactionsChecker
    }

    func prepareForBudgetWorkspace(_ workspace: BudgetWorkspace?) {
        prepare(
            workspace: workspace.map {
                TransactionFeedWorkspace(
                    id: $0.id, name: $0.name, currencyCode: $0.currencyCode,
                    minorUnit: $0.minorUnit, timezoneIdentifier: $0.timezoneIdentifier)
            })
    }

    func prepare(workspace next: TransactionFeedWorkspace?) {
        if let requestedWorkspaceID, next?.id != requestedWorkspaceID { return }
        guard workspace != next else { return }
        let shouldResume = isActive
        if workspace?.id != next?.id {
            reset()
        } else {
            stop()
        }
        workspace = next
        collapsedCategoryIDs = Set(
            next.flatMap { defaults?.stringArray(forKey: collapseKey($0.id)) } ?? [])
        if shouldResume { start() }
    }

    func start() {
        guard !isActive else { return }
        isActive = true
        watch()
    }

    func stop() {
        isActive = false
        subscriptionGeneration = UUID()
        workspaceLoadTask?.cancel()
        workspaceLoadTask = nil
        accountsSubscription?.cancel()
        historySubscription?.cancel()
        accountsSubscription = nil
        historySubscription = nil
        accountsDeadline?.cancel()
        historyDeadline?.cancel()
        accountsDeadline = nil
        historyDeadline = nil
        isLoading = false
        isLoadingHistory = false
    }

    func reset() {
        stop()
        workspaceGeneration = UUID()
        workspace = nil
        accounts = []
        history = []
        historyCurrentMonth = nil
        hasLoaded = false
        hasReceivedHistory = false
        errorMessage = nil
        historyErrorMessage = nil
        actionErrorMessage = nil
        isSaving = false
        lastCreatedAccountID = nil
        latestCreationReceipt = nil
        latestLifecycleReceipt = nil
        collapsedCategoryIDs = []
        savedOrdering = AccountOrdering()
        lastOrderingRevision = nil
        orderDraft = nil
        orderBaseline = nil
        isSavingOrder = false
        orderingError = nil
    }

    func beginAccountReordering(workspaceID: String) {
        guard canReorderAccounts, workspace?.id == workspaceID else { return }
        orderBaseline = savedOrdering.normalized(accounts: accounts)
        orderDraft = orderBaseline
        orderingError = nil
    }

    @discardableResult
    func moveAccount(_ move: BudgetPlanOrdering.Move, workspaceID: String) -> Bool {
        guard canReorderAccounts, workspace?.id == workspaceID,
            let updated = orderDraft?.applying(move, accounts: accounts)
        else { return false }
        orderDraft = updated
        orderingError = nil
        return true
    }

    func discardAccountReordering() {
        guard !isSavingOrder else { return }
        orderDraft = nil
        orderBaseline = nil
        orderingError = nil
    }

    /// Persist the final draft only on Save. Each API receives one final order,
    /// and an unchanged group retains any concurrent ordering from another client.
    func saveAccountOrder(workspaceID: String) async -> Bool {
        guard !isSavingOrder, !isSaving, workspace?.id == workspaceID,
            let orderDraft, let orderBaseline
        else { return false }
        let draft = orderDraft.normalized(accounts: accounts)
        let baseline = orderBaseline.normalized(accounts: accounts)
        var target = savedOrdering.normalized(accounts: accounts)
        if draft.groupOrder != baseline.groupOrder { target.groupOrder = draft.groupOrder }
        let changedGroups = AccountCategory.allCases.map(\.orderingKey).filter {
            draft.accountOrderByGroup[$0] != baseline.accountOrderByGroup[$0]
        }
        for key in changedGroups {
            target.accountOrderByGroup[key] = draft.accountOrderByGroup[key]
        }
        let generation = workspaceGeneration
        isSavingOrder = true
        orderingError = nil
        defer { if generation == workspaceGeneration { isSavingOrder = false } }
        do {
            if !changedGroups.isEmpty {
                _ = try await performMutation(
                    .init(
                        workspaceID: workspaceID,
                        operation: .reorderAccounts(target.accountOrderByGroup)))
                guard generation == workspaceGeneration else { return false }
                savedOrdering.accountOrderByGroup = target.accountOrderByGroup
                // If saving the other part fails, retry only the unsaved part.
                self.orderBaseline?.accountOrderByGroup = draft.accountOrderByGroup
            }
            if draft.groupOrder != baseline.groupOrder {
                _ = try await performMutation(
                    .init(
                        workspaceID: workspaceID, operation: .reorderGroups(target.groupOrder)))
                guard generation == workspaceGeneration else { return false }
                savedOrdering.groupOrder = target.groupOrder
            }
            self.orderDraft = nil
            self.orderBaseline = nil
            return true
        } catch {
            guard generation == workspaceGeneration else { return false }
            orderingError = L10n.string("Couldn't save this order. Please try again.")
            retry()
            return false
        }
    }

    func toggleAccountGroup(_ category: AccountCategory) {
        guard let workspace, availableCategories.contains(category) else { return }
        if !collapsedCategoryIDs.insert(category.id).inserted {
            collapsedCategoryIDs.remove(category.id)
        }
        defaults?.set(
            Array(collapsedCategoryIDs).sorted(), forKey: collapseKey(workspace.id))
    }

    func retry() {
        guard isActive else { return }
        stop()
        start()
    }

    func refreshCurrentMonth() {
        guard isActive, let workspace else { return }
        let month = Int64(
            BudgetMonth.current(
                now: now(), timezoneIdentifier: workspace.timezoneIdentifier))
        guard month != subscribedHistoryMonth else { return }
        retry()
    }

    func account(id: String) -> AccountSnapshot? { accounts.first { $0.id == id && !$0.isDeleted } }

    func balanceHistory(
        accountIDs: Set<String>, timelineAccountIDs: Set<String>? = nil
    ) -> [AccountBalancePoint] {
        let selectedAccounts = accounts.filter { accountIDs.contains($0.id) && !$0.isDeleted }
        let timelineIDs = timelineAccountIDs ?? accountIDs
        let timelineAccounts = accounts.filter { timelineIDs.contains($0.id) && !$0.isDeleted }
        guard let firstMonth = timelineAccounts.compactMap(\.firstBalanceYearMonth).min() else {
            return []
        }
        return AccountBalancePoint.build(
            months: history.filter { $0.yearMonth >= firstMonth },
            accountIDs: Set(selectedAccounts.map(\.id)),
            currentMonth: historyCurrentMonth,
            currentBalance: selectedAccounts.reduce(Decimal.zero) {
                $0 + Decimal($1.currentBalance)
            })
    }

    func makeTransactionStore(accountID: String) -> TransactionFeedStore? {
        if let transactionStoreFactory { return transactionStoreFactory(accountID) }
        guard let client, let workspace,
            account(id: accountID) != nil || lastCreatedAccountID == accountID
        else { return nil }
        return TransactionFeedStore(
            convexClient: client, bankAccountID: accountID, workspace: workspace,
            choicesStore: choicesStore)
    }

    func makeReconciliationStore(accountID: String) -> AccountReconciliationStore? {
        guard let client, let workspace, let account = account(id: accountID),
            !account.isClosed && !account.isDeleted
        else { return nil }
        let generation = workspaceGeneration
        return AccountReconciliationStore(
            account: account, workspace: workspace,
            currentAccount: { [weak self] in self?.account(id: accountID) },
            isAvailable: { [weak self] in self?.workspaceGeneration == generation },
            now: now,
            mutate: { request in
                try await client.mutation(
                    "bankAccounts:reconcileBankAccount", with: request.arguments)
            })
    }

    func makeConnectionStore(purpose: AccountConnectionPurpose = .addAccounts)
        -> AccountConnectionStore?
    {
        if let connectionStoreFactory { return connectionStoreFactory(purpose) }
        guard let client, let workspace else { return nil }
        return AccountConnectionStore(
            client: client, workspace: workspace, purpose: purpose,
            currentAccounts: { [weak self] in self?.accounts ?? [] },
            isWorkspaceCurrent: { [weak self] in self?.workspace?.id == workspace.id })
    }

    func makeLogoClient(accountID: String) -> EntityLogoClient? {
        guard let client, let workspace,
            account(id: accountID) != nil || lastCreatedAccountID == accountID
        else { return nil }
        let generation = workspaceGeneration
        return .live(
            client, workspaceID: workspace.id, entityID: accountID, entityType: "bankAccount",
            isAvailable: { [weak self] in
                self?.workspaceGeneration == generation
                    && (self?.account(id: accountID) != nil
                        || self?.lastCreatedAccountID == accountID)
            })
    }

    func makeDraftLogoClient(draft: EntityLogoDraft) -> EntityLogoClient? {
        guard let client, workspace != nil else { return nil }
        let generation = workspaceGeneration
        return EntityLogoClient(
            search: { [weak self] query in
                guard self?.workspaceGeneration == generation else { throw CancellationError() }
                let results: [EntityLogoSearchResult] = try await client.action(
                    "logoDev:searchLogos", with: ["query": query])
                guard self?.workspaceGeneration == generation else { throw CancellationError() }
                return results
            },
            upload: { [weak self] data in
                guard self?.workspaceGeneration == generation else { throw CancellationError() }
                return draft.stagePhoto(try EntityLogoClient.prepareImage(data))
            },
            save: { [weak self] _ in
                guard self?.workspaceGeneration == generation else { throw CancellationError() }
            })
    }

    func validationMessage(for draft: AccountDraft, account: AccountSnapshot? = nil) -> String? {
        guard let workspace else { return L10n.string("Select a workspace to add an account.") }
        if draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return L10n.string("Give this account a name.")
        }
        guard AccountTypeOption.all.contains(where: { $0.rawValue == draft.accountType }) else {
            return L10n.string("Choose an account type.")
        }
        if let account {
            if AccountCategory.from(draft.accountType) != account.category {
                return L10n.string("Choose a type in the same account group.")
            }
        } else {
            if !draft.notes.isEmpty || !draft.logoUrl.isEmpty || draft.logoChoice != .unchanged {
                return L10n.string("You can add notes and a logo after creating the account.")
            }
            if draft.initialBalance != 0 {
                guard
                    TransactionEditorDate.date(from: draft.initialBalanceDate, workspace: workspace)
                        != nil
                else {
                    return L10n.string("Choose a valid starting balance date.")
                }
                if draft.initialBalanceDate
                    > TransactionEditorDate.today(workspace: workspace, now: now())
                {
                    return L10n.string("The starting balance date cannot be in the future.")
                }
            }
        }
        if case .custom(let url) = draft.logoChoice,
            URL(string: url)?.scheme?.lowercased() != "https" || URL(string: url)?.host == nil
        {
            return L10n.string("Choose a valid logo or upload a photo.")
        }
        if draft.logoChoice == .unchanged, !draft.logoUrl.isEmpty,
            draft.logoUrl != account.map({ AccountDraft(account: $0).logoUrl }),
            URL(string: draft.logoUrl)?.scheme?.lowercased() != "https"
                || URL(string: draft.logoUrl)?.host == nil
        {
            return L10n.string("Use a secure https:// link for the logo.")
        }
        return nil
    }

    func save(draft: AccountDraft, account: AccountSnapshot? = nil) async -> Bool {
        if let message = validationMessage(for: draft, account: account) {
            actionErrorMessage = message
            return false
        }
        if let account, self.account(id: account.id) == nil {
            actionErrorMessage = L10n.string("This account is no longer available.")
            return false
        }
        return await perform(account.map { .update($0, draft) } ?? .create(draft))
    }

    func close(account: AccountSnapshot) async -> Bool {
        guard let current = self.account(id: account.id), !current.isClosed else { return false }
        return await perform(.close(account.id))
    }

    func reopen(account: AccountSnapshot) async -> Bool {
        guard let current = self.account(id: account.id), current.isClosed else { return false }
        return await perform(.reopen(account.id))
    }

    func hasTransactions(accountID: String) async throws -> Bool {
        guard let workspace, account(id: accountID) != nil else {
            throw AccountStoreError.unavailable
        }
        let generation = workspaceGeneration
        let result = try await checkTransactions(workspace.id, accountID)
        guard generation == workspaceGeneration else { throw CancellationError() }
        return result
    }

    func delete(account: AccountSnapshot) async -> Bool {
        await perform(.delete(account.id))
    }

    func undoLifecycleChange(receiptID: UUID) async -> TransactionMutationReceipt? {
        guard let receipt = latestLifecycleReceipt, receipt.id == receiptID,
            receipt.workspace.id == workspace?.id, receipt.canUndoAccountChange,
            let change = receipt.accountLifecycle, !isSaving
        else { return nil }
        let operation: AccountMutationRequest.Operation =
            receipt.kind == .accountClosed
            ? .reopen(change.accountID) : .restore(change.accountID)
        guard await perform(operation), latestLifecycleReceipt?.id == receiptID,
            workspace?.id == receipt.workspace.id
        else { return nil }
        let result = TransactionMutationReceipt(
            workspace: receipt.workspace, dateKey: receipt.dateKey,
            kind: receipt.kind == .accountClosed ? .accountReopened : .accountRestored,
            budgetChanges: [], accountLifecycle: change)
        latestLifecycleReceipt = result
        return result
    }

    private func perform(_ operation: AccountMutationRequest.Operation) async -> Bool {
        guard !isSaving, let workspace else { return false }
        isSaving = true
        actionErrorMessage = nil
        let generation = workspaceGeneration
        let changedAccount: AccountSnapshot?
        switch operation {
        case .close(let id), .delete(let id): changedAccount = account(id: id)
        default: changedAccount = nil
        }
        defer { if generation == workspaceGeneration { isSaving = false } }
        do {
            if case .delete(let id) = operation {
                guard account(id: id) != nil else { throw AccountStoreError.unavailable }
                if try await hasTransactions(accountID: id) {
                    throw AccountStoreError.hasTransactions
                }
            }
            guard generation == workspaceGeneration else { return false }
            let id = try await performMutation(
                AccountMutationRequest(workspaceID: workspace.id, operation: operation))
            guard generation == workspaceGeneration else { return false }
            if case .create(let draft) = operation {
                lastCreatedAccountID = id
                latestCreationReceipt = nil
                if let id {
                    latestCreationReceipt = TransactionMutationReceipt(
                        workspace: workspace, dateKey: draft.initialBalanceDate,
                        kind: .accountCreated, budgetChanges: [],
                        accountCreation: AccountCreationSummary(
                            accountID: id,
                            name: draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
                            accountType: draft.accountType, startingBalance: draft.initialBalance))
                }
            }
            if let changedAccount {
                let kind: TransactionMutationKind
                if case .close = operation { kind = .accountClosed } else { kind = .accountDeleted }
                latestLifecycleReceipt = TransactionMutationReceipt(
                    workspace: workspace,
                    dateKey: TransactionEditorDate.today(workspace: workspace),
                    kind: kind, budgetChanges: [],
                    accountLifecycle: AccountLifecycleSummary(
                        accountID: changedAccount.id, name: changedAccount.name,
                        wasLinked: changedAccount.isLinked))
            }
            return true
        } catch {
            guard generation == workspaceGeneration else { return false }
            actionErrorMessage = error.localizedDescription
            return false
        }
    }

    private func watch() {
        guard let workspace else {
            bootstrapWorkspace()
            return
        }
        subscriptionGeneration = UUID()
        let generation = subscriptionGeneration
        errorMessage = nil
        historyErrorMessage = nil
        isLoading = !hasLoaded
        isLoadingHistory = !hasReceivedHistory
        accountsDeadline = deadline(generation: generation, history: false)
        historyDeadline = deadline(generation: generation, history: true)
        accountsSubscription = subscribeToAccounts(workspace.id)
            .combineLatest(
                subscribeToOrdering(workspace.id).map { (revision: UUID(), value: $0) }
            )
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.subscriptionGeneration == generation else { return }
                    if case .failure = completion {
                        self.failAccounts()
                    } else if !self.hasLoaded {
                        self.failAccounts()
                    }
                },
                receiveValue: { [weak self] accounts, ordering in
                    guard let self, self.subscriptionGeneration == generation else { return }
                    self.accountsDeadline?.cancel()
                    self.accounts = accounts.filter { !$0.isDeleted }
                    // Account and workspace subscriptions can emit separately.
                    // An account-only update must not replay old ordering over
                    // the confirmed result of a completed move.
                    if self.lastOrderingRevision != ordering.revision {
                        self.savedOrdering = ordering.value ?? AccountOrdering()
                        self.lastOrderingRevision = ordering.revision
                    }
                    self.hasLoaded = true
                    self.isLoading = false
                    self.errorMessage = nil
                }
            )
        let month = Int64(
            BudgetMonth.current(now: now(), timezoneIdentifier: workspace.timezoneIdentifier))
        subscribedHistoryMonth = month
        historySubscription = subscribeToHistory(workspace.id, month).receive(
            on: DispatchQueue.main
        ).sink(
            receiveCompletion: { [weak self] completion in
                guard let self, self.subscriptionGeneration == generation else { return }
                if case .failure = completion {
                    self.failHistory()
                } else if !self.hasReceivedHistory {
                    self.failHistory()
                }
            },
            receiveValue: { [weak self] report in
                guard let self, self.subscriptionGeneration == generation else { return }
                self.historyDeadline?.cancel()
                self.history = report.months
                self.historyCurrentMonth = report.currentMonth
                self.hasReceivedHistory = true
                self.isLoadingHistory = false
                self.historyErrorMessage = nil
            }
        )
    }

    private func bootstrapWorkspace() {
        guard let loadWorkspace else {
            hasLoaded = true
            isLoading = false
            return
        }
        let generation = subscriptionGeneration
        isLoading = true
        errorMessage = nil
        workspaceLoadTask = Task { [weak self] in
            do {
                let result = try await loadWorkspace()
                guard let self, !Task.isCancelled, self.isActive,
                    self.subscriptionGeneration == generation, self.workspace == nil
                else { return }
                guard self.requestedWorkspaceID == nil || result?.id == self.requestedWorkspaceID
                else {
                    throw AccountStoreError.unavailable
                }
                self.workspaceLoadTask = nil
                if let result {
                    self.prepareForBudgetWorkspace(result)
                } else {
                    self.hasLoaded = true
                    self.isLoading = false
                }
            } catch {
                guard let self, !Task.isCancelled, self.isActive,
                    self.subscriptionGeneration == generation
                else { return }
                self.workspaceLoadTask = nil
                self.isLoading = false
                self.errorMessage = L10n.string(
                    "We couldn't load your workspace. Please try again.")
            }
        }
    }

    private func deadline(generation: UUID, history: Bool) -> Task<Void, Never> {
        Task { [weak self, responseTimeout] in
            do { try await Task.sleep(for: responseTimeout) } catch { return }
            guard let self, self.subscriptionGeneration == generation else { return }
            if history { self.failHistory() } else { self.failAccounts() }
        }
    }

    private func failAccounts() {
        accountsDeadline?.cancel()
        isLoading = false
        errorMessage = L10n.string("We couldn't refresh your accounts. Please try again.")
    }

    private func failHistory() {
        historyDeadline?.cancel()
        isLoadingHistory = false
        historyErrorMessage = L10n.string("Balance history couldn't load. Please try again.")
    }

    private func collapseKey(_ workspaceID: String) -> String {
        "accounts.collapsedGroups.\(workspaceID)"
    }

    static var preview: AccountsStore {
        let accounts = [
            AccountSnapshot(
                id: "checking", name: L10n.string("Everyday checking"),
                accountType: "banking_checking",
                currentBalance: 425_840, firstBalanceYearMonth: "2025-10"),
            AccountSnapshot(
                id: "savings", name: L10n.string("Rainy day"), accountType: "banking_savings",
                currentBalance: 1_280_000, firstBalanceYearMonth: "2025-10"),
            AccountSnapshot(
                id: "card", name: L10n.string("Travel card"), accountType: "credit_credit_card",
                currentBalance: -84_250, firstBalanceYearMonth: "2025-10"),
            AccountSnapshot(
                id: "brokerage", name: L10n.string("Future me"),
                accountType: "investment_brokerage",
                currentBalance: 2_468_900, firstBalanceYearMonth: "2025-10"),
        ]
        let months = (0..<12).map { offset in
            let month = BudgetMonth.offset(202609, by: offset - 11)
            return AccountHistoryMonth(
                yearMonth: String(format: "%04d-%02d", month / 100, month % 100),
                accounts: accounts.map { account in
                    AccountHistoryBalance(
                        accountId: account.id,
                        balance: account.currentBalance
                            - Int64(
                                (11 - offset) * (account.category.isLiability ? -2_000 : 18_000)))
                })
        }
        let store = AccountsStore(
            accountsSubscription: { _ in
                Just(accounts).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in
                Just(AccountHistoryReport(months: months, currentMonth: "2026-09"))
                    .setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        store.workspace = TransactionFeedWorkspace(
            id: "preview", name: L10n.string("Personal"), currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "America/New_York")
        store.accounts = accounts
        store.history = months
        store.historyCurrentMonth = "2026-09"
        store.hasLoaded = true
        store.hasReceivedHistory = true
        return store
    }
}

private struct AccountOrderingWorkspace: Decodable { let bankAccountOrdering: AccountOrdering? }
private struct AccountMutationResult: Decodable { let success: Bool }
private struct AccountsWorkspaceResponse: Decodable { let workspace: BudgetWorkspace? }

enum AccountStoreError: LocalizedError {
    case saveFailed, loadFailed, unavailable, hasTransactions

    var errorDescription: String? {
        switch self {
        case .saveFailed: L10n.string("We couldn't save this account. Please try again.")
        case .loadFailed: L10n.string("We couldn't check this account. Please try again.")
        case .unavailable: L10n.string("This account is no longer available.")
        case .hasTransactions:
            L10n.string("This account has transactions. Close it to keep its history.")
        }
    }
}
