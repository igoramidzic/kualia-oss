import Combine
import ConvexMobile
import Foundation
import Testing

@testable import Kualia

@Suite(.serialized)
@MainActor
struct AccountsStoreTests {
    @Test func clearedBalanceUsesTheReportedValueOrDerivesItFromPending() {
        let reported = AccountSnapshot(
            id: "bank", name: "Checking", accountType: "banking_checking",
            currentBalance: 10000, pendingBalance: -2000, clearedBalance: 12500)
        #expect(reported.resolvedClearedBalance == 12500)

        let cases: [(total: Int64, pending: Int64?, cleared: Decimal)] = [
            (10000, -2000, 12000),
            (10000, 2000, 8000),
            (-10000, -2000, -8000),
            (10000, 0, 10000),
            (10000, nil, 10000),
            (.max, -1, Decimal(Int64.max) + 1),
        ]
        for item in cases {
            let account = AccountSnapshot(
                id: "bank", name: "Account", accountType: "banking_checking",
                currentBalance: item.total, pendingBalance: item.pending)
            #expect(account.resolvedClearedBalance == item.cleared)
        }
    }

    @Test func accountCategoryFiltersSupportSingleAndMultipleSelection() {
        var filter = AccountCategoryFilter()
        #expect(filter.isSelected(nil))
        #expect(AccountCategory.allCases.allSatisfy(filter.includes))
        filter.select(.banking)
        filter.select(.credit)
        #expect(filter.categories == [.credit])
        #expect(!filter.isSelectingMultiple)

        filter.beginMultipleSelection(with: .banking)
        #expect(filter.isSelectingMultiple)
        #expect(filter.categories == [.credit, .banking])
        #expect(!filter.includes(.investment))
        filter.select(.loan)
        filter.select(.credit)
        #expect(filter.categories == [.banking, .loan])
        #expect(!filter.isSelected(nil))

        filter.select(nil)
        #expect(filter.isSelected(nil))
        #expect(!filter.isSelectingMultiple)
        filter.select(.investment)
        filter.select(.loan)
        #expect(filter.categories == [.loan])
    }

    @Test func accountCategoryFiltersRecoverWhenSelectionIsClearedOrAccountsDisappear() {
        var filter = AccountCategoryFilter()
        filter.beginMultipleSelection(with: .banking)
        #expect(filter.categories == [.banking])
        filter.select(.banking)
        #expect(filter.isSelected(nil))
        #expect(!filter.isSelectingMultiple)

        filter.beginMultipleSelection(with: .credit)
        filter.select(.loan)
        filter.reconcile(availableCategories: [.banking, .loan])
        #expect(filter.categories == [.loan])
        #expect(filter.isSelectingMultiple)
        filter.reconcile(availableCategories: [.banking])
        #expect(filter.isSelected(nil))
        #expect(!filter.isSelectingMultiple)
    }

    @Test
    func accountOrderingRestoresStableKeysAndAppendsNewAccounts() throws {
        let ordering = try JSONDecoder().decode(
            AccountOrdering.self,
            from: Data(
                #"{"groupOrder":["Credit","Banking","Credit","Unknown"],"accountOrderByGroup":{"Banking":["missing","savings","savings","card"]}}"#
                    .utf8))
        let sections = ordering.sections(accounts: Self.orderingAccounts)
        #expect(sections.map(\.category) == [.credit, .banking, .loan])
        #expect(sections[1].accounts.map(\.id) == ["savings", "cash"])
        #expect(ordering.categories == [.credit, .banking, .investment, .loan])
    }

    @Test
    func accountMovesRejectOtherGroupsAndPreserveClosedAccounts() throws {
        let ordering = AccountOrdering()
        let invalid = BudgetPlanOrdering.Move(
            item: .category("cash"), destination: .category(groupID: "credit", beforeID: nil))
        #expect(ordering.applying(invalid, accounts: Self.orderingAccounts) == nil)
        let move = BudgetPlanOrdering.Move(
            item: .category("savings"), destination: .category(groupID: "banking", beforeID: "cash")
        )
        let updated = try #require(ordering.applying(move, accounts: Self.orderingAccounts))
        #expect(
            updated.accountOrderByGroup == [
                "Banking": ["savings", "cash"], "Credit": ["card"], "Loan": ["old-loan"],
            ])
        #expect(updated.applying(move, accounts: Self.orderingAccounts) == nil)
        let request = AccountMutationRequest(
            workspaceID: "workspace", operation: .reorderAccounts(updated.accountOrderByGroup))
        #expect(request.mutationName == "workspaces:updateBankAccountOrderAllGroups")
        #expect(request.arguments["accountType"] == nil)
        #expect(request.arguments["accountOrderByGroup"] != nil)
    }

    @Test
    func groupMovesPreserveHiddenGroupsAndAccountMembership() throws {
        let ordering = AccountOrdering()
        let move = BudgetPlanOrdering.Move(
            item: .group("credit"), destination: .beforeGroup("banking"))
        let updated = try #require(ordering.applying(move, accounts: Self.orderingAccounts))
        #expect(updated.groupOrder == ["Credit", "Banking", "Investment", "Loan"])
        #expect(updated.accountOrderByGroup == ordering.accountOrderByGroup)
        #expect(
            updated.reorderGroups(accounts: Self.orderingAccounts).map(\.id) == [
                "credit", "banking",
            ])
        let request = AccountMutationRequest(
            workspaceID: "workspace", operation: .reorderGroups(updated.groupOrder))
        #expect(request.mutationName == "workspaces:updateBankAccountGroupOrder")
        #expect(request.arguments["groupOrder"] != nil)
    }

    @Test
    func draftAccountMovesStayLocalAndDiscardOrUndoNeedsNoSave() async {
        var requests = 0
        let store = Self.orderingStore { _ in
            requests += 1
            return nil
        }
        store.start()
        await waitUntil { store.hasLoaded }
        store.beginAccountReordering(workspaceID: "workspace")
        let move = Self.moveSavings
        #expect(store.moveAccount(move, workspaceID: "workspace"))
        #expect(store.hasAccountOrderChanges)
        #expect(store.reorderGroups.first?.categories.map(\.id) == ["savings", "cash"])
        #expect(store.activeAccounts.map(\.id) == ["cash", "savings", "card"])
        await settle()
        #expect(requests == 0 && !store.isSavingOrder)
        #expect(
            store.moveAccount(
                .init(
                    item: .category("cash"),
                    destination: .category(groupID: "banking", beforeID: "savings")),
                workspaceID: "workspace"))
        #expect(!store.hasAccountOrderChanges)
        #expect(store.moveAccount(move, workspaceID: "workspace"))
        store.discardAccountReordering()
        #expect(!store.hasAccountOrderChanges)
        #expect(store.reorderGroups.first?.categories.map(\.id) == ["cash", "savings"])
        #expect(requests == 0)
        store.stop()
    }

    @Test
    func savePersistsOnlyTheFinalOrdersAndBlocksFurtherEditsUntilFinished() async {
        var requests: [AccountMutationRequest] = []
        var pending: [CheckedContinuation<String?, Error>] = []
        let store = Self.orderingStore { request in
            requests.append(request)
            return try await withCheckedThrowingContinuation { pending.append($0) }
        }
        store.start()
        await waitUntil { store.hasLoaded }
        store.beginAccountReordering(workspaceID: "workspace")
        #expect(store.moveAccount(Self.moveSavings, workspaceID: "workspace"))
        #expect(store.moveAccount(Self.moveCredit, workspaceID: "workspace"))
        #expect(requests.isEmpty)
        let save = Task { await store.saveAccountOrder(workspaceID: "workspace") }
        await waitUntil { pending.count == 1 }
        #expect(!store.moveAccount(Self.moveCredit, workspaceID: "workspace"))
        #expect(!(await store.saveAccountOrder(workspaceID: "workspace")))
        store.discardAccountReordering()
        #expect(store.hasAccountOrderChanges)
        pending[0].resume(returning: nil)
        await waitUntil { pending.count == 2 }
        pending[1].resume(returning: nil)
        #expect(await save.value)
        #expect(
            requests.map(\.mutationName) == [
                "workspaces:updateBankAccountOrderAllGroups",
                "workspaces:updateBankAccountGroupOrder",
            ])
        #expect(!store.hasAccountOrderChanges && !store.isSavingOrder)
        #expect(store.availableCategories == [.credit, .banking])
        #expect(store.activeAccounts.map(\.id) == ["card", "savings", "cash"])
        store.stop()
    }

    @Test
    func failedSaveKeepsDraftForRetryAndWorkspaceChangeInvalidatesCompletion() async {
        var pending: CheckedContinuation<String?, Error>?
        let store = Self.orderingStore { _ in
            try await withCheckedThrowingContinuation { pending = $0 }
        }
        store.start()
        await waitUntil { store.hasLoaded }
        store.beginAccountReordering(workspaceID: "workspace")
        #expect(!store.moveAccount(Self.moveCredit, workspaceID: "other"))
        #expect(store.moveAccount(Self.moveCredit, workspaceID: "workspace"))
        let first = Task { await store.saveAccountOrder(workspaceID: "workspace") }
        await waitUntil { pending != nil }
        pending?.resume(throwing: AccountStoreError.saveFailed)
        pending = nil
        #expect(!(await first.value))
        #expect(store.hasAccountOrderChanges && store.orderingError != nil)
        #expect(store.availableCategories == [.banking, .credit])
        #expect(store.reorderGroups.map(\.id) == ["credit", "banking"])
        let second = Task { await store.saveAccountOrder(workspaceID: "workspace") }
        await waitUntil { pending != nil }
        store.prepare(workspace: Self.workspace("other"))
        pending?.resume(returning: nil)
        #expect(!(await second.value))
        await waitUntil { store.hasLoaded }
        #expect(store.availableCategories == [.banking, .credit])
        #expect(!store.hasAccountOrderChanges && !store.isSavingOrder && store.orderingError == nil)
        store.stop()
    }

    @Test
    func partialSaveRetriesOnlyTheUnsavedOrder() async {
        let ordering = CurrentValueSubject<AccountOrdering?, Error>(AccountOrdering())
        var requests: [String] = []
        let store = Self.orderingStore(ordering: ordering) { request in
            requests.append(request.mutationName)
            if requests.count == 1 {
                ordering.send(
                    AccountOrdering().applying(Self.moveSavings, accounts: Self.orderingAccounts))
            }
            if requests.count == 2 { throw AccountStoreError.saveFailed }
            return nil
        }
        store.start()
        await waitUntil { store.hasLoaded }
        store.beginAccountReordering(workspaceID: "workspace")
        #expect(store.moveAccount(Self.moveSavings, workspaceID: "workspace"))
        #expect(store.moveAccount(Self.moveCredit, workspaceID: "workspace"))
        #expect(!(await store.saveAccountOrder(workspaceID: "workspace")))
        #expect(store.hasAccountOrderChanges)
        await waitUntil { store.activeAccounts.first?.id == "savings" }
        #expect(await store.saveAccountOrder(workspaceID: "workspace"))
        #expect(
            requests == [
                "workspaces:updateBankAccountOrderAllGroups",
                "workspaces:updateBankAccountGroupOrder", "workspaces:updateBankAccountGroupOrder",
            ])
        #expect(!store.hasAccountOrderChanges)
        #expect(store.activeAccounts.map(\.id) == ["card", "savings", "cash"])
        store.stop()
    }

    @Test
    func savingAnAccountDraftPreservesConcurrentGroupOrderChanges() async throws {
        let ordering = CurrentValueSubject<AccountOrdering?, Error>(AccountOrdering())
        var requests: [String] = []
        let store = Self.orderingStore(ordering: ordering) { request in
            requests.append(request.mutationName)
            return nil
        }
        store.start()
        await waitUntil { store.hasLoaded }
        store.beginAccountReordering(workspaceID: "workspace")
        #expect(store.moveAccount(Self.moveSavings, workspaceID: "workspace"))
        let remote = try #require(
            AccountOrdering().applying(Self.moveCredit, accounts: Self.orderingAccounts))
        ordering.send(remote)
        await waitUntil { store.availableCategories == [.credit, .banking] }
        #expect(await store.saveAccountOrder(workspaceID: "workspace"))
        #expect(requests == ["workspaces:updateBankAccountOrderAllGroups"])
        #expect(store.availableCategories == [.credit, .banking])
        #expect(store.activeAccounts.map(\.id) == ["card", "savings", "cash"])
        store.stop()
    }

    @Test
    func workspaceUpdatesRemainAuthoritativeAfterSaving() async {
        let ordering = CurrentValueSubject<AccountOrdering?, Error>(AccountOrdering())
        let store = Self.orderingStore(ordering: ordering) { _ in nil }
        store.start()
        await waitUntil { store.hasLoaded }
        store.beginAccountReordering(workspaceID: "workspace")
        #expect(store.moveAccount(Self.moveCredit, workspaceID: "workspace"))
        #expect(await store.saveAccountOrder(workspaceID: "workspace"))
        #expect(store.availableCategories == [.credit, .banking])
        ordering.send(AccountOrdering())
        await waitUntil { store.availableCategories == [.banking, .credit] }
        store.stop()
    }

    private static var moveSavings: BudgetPlanOrdering.Move {
        .init(
            item: .category("savings"), destination: .category(groupID: "banking", beforeID: "cash")
        )
    }
    private static var moveCredit: BudgetPlanOrdering.Move {
        .init(item: .group("credit"), destination: .beforeGroup("banking"))
    }
    private static func orderingStore(
        ordering: CurrentValueSubject<AccountOrdering?, Error> = .init(AccountOrdering()),
        mutationHandler: @escaping AccountsStore.MutationHandler
    ) -> AccountsStore {
        let store = AccountsStore(
            defaults: nil,
            accountsSubscription: { _ in
                Just(Self.orderingAccounts).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() },
            orderingSubscription: { _ in ordering.eraseToAnyPublisher() },
            mutationHandler: mutationHandler)
        store.prepare(workspace: workspace())
        return store
    }

    private static let orderingAccounts: [AccountSnapshot] = [
        .init(id: "cash", name: "Cash", accountType: "banking_checking"),
        .init(id: "savings", name: "Savings", accountType: "banking_savings"),
        .init(id: "card", name: "Card", accountType: "credit_credit_card"),
        .init(id: "old-loan", name: "Old loan", accountType: "loan_mortgage", isClosed: true),
    ]

    @Test
    func automaticMonthRefreshKeepsQueriesUntilTheWorkspaceMonthChanges() async {
        var now = ISO8601DateFormatter().date(from: "2026-09-30T12:00:00Z")!
        var accountRequests = 0
        var months: [Int64] = []
        let store = AccountsStore(
            now: { now },
            accountsSubscription: { _ in
                accountRequests += 1
                return Just([Self.cash]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, month in
                months.append(month)
                return Self.historyPublisher()
            })
        store.prepare(workspace: Self.workspace())
        store.start()
        await waitUntil { store.hasLoaded }
        for _ in 0..<5 { store.refreshCurrentMonth() }
        #expect(accountRequests == 1)
        #expect(months == [202609])
        now = now.addingTimeInterval(24 * 3600)
        store.refreshCurrentMonth()
        store.refreshCurrentMonth()
        #expect(accountRequests == 2)
        #expect(months == [202609, 202610])
        store.stop()
        now = now.addingTimeInterval(31 * 24 * 3600)
        store.refreshCurrentMonth()
        #expect(accountRequests == 2)
    }

    @Test
    func availableFiltersFollowOnlyActiveAccounts() async {
        let accounts = CurrentValueSubject<[AccountSnapshot], Error>([
            Self.cash,
            .init(id: "card", name: "Card", accountType: "credit_credit_card"),
            .init(id: "old", name: "Old loan", accountType: "loan_mortgage", isClosed: true),
            .init(
                id: "deleted", name: "Deleted IRA", accountType: "investment_ira", isDeleted: true),
        ])
        let store = AccountsStore(
            accountsSubscription: { _ in accounts.eraseToAnyPublisher() },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.prepare(workspace: Self.workspace())
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(store.availableCategories == [.banking, .credit])
        accounts.send([Self.closed])
        await waitUntil { store.activeAccounts.isEmpty }
        #expect(store.availableCategories.isEmpty)
        accounts.send([Self.cash])
        await waitUntil { store.availableCategories == [.banking] }
        store.stop()
    }

    @Test(arguments: [false, true])
    func lifecycleUndoUsesTheOriginalAccountAndPublishesConfirmation(deleting: Bool) async throws {
        var operations: [String] = []
        let store = Self.store(mutationHandler: { request in
            operations.append(request.mutationName)
            return nil
        })
        store.start()
        await waitUntil { store.hasLoaded }
        let changed =
            deleting
            ? await store.delete(account: Self.cash) : await store.close(account: Self.cash)
        #expect(changed)
        let receipt = try #require(store.latestLifecycleReceipt)
        #expect(receipt.canUndoAccountChange)
        #expect(receipt.accountLifecycle?.accountID == Self.cash.id)
        let result = try #require(await store.undoLifecycleChange(receiptID: receipt.id))
        #expect(!result.canUndoAccountChange)
        #expect(result.kind == (deleting ? .accountRestored : .accountReopened))
        #expect(
            operations
                == (deleting
                    ? ["bankAccounts:deleteBankAccount", "bankAccounts:restoreBankAccount"]
                    : ["bankAccounts:closeBankAccount", "bankAccounts:reopenBankAccount"]))
        #expect(await store.undoLifecycleChange(receiptID: receipt.id) == nil)
        store.stop()
    }

    @Test
    func failedUndoKeepsTheReceiptForRetryAndWorkspaceResetInvalidatesIt() async throws {
        var shouldFail = false
        let store = Self.store(mutationHandler: { _ in
            if shouldFail { throw AccountStoreError.saveFailed }
            return nil
        })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.delete(account: Self.cash))
        let receipt = try #require(store.latestLifecycleReceipt)
        shouldFail = true
        #expect(await store.undoLifecycleChange(receiptID: receipt.id) == nil)
        #expect(store.latestLifecycleReceipt?.id == receipt.id)
        #expect(store.actionErrorMessage != nil)
        store.prepare(workspace: Self.workspace("other"))
        #expect(store.latestLifecycleReceipt == nil)
        #expect(await store.undoLifecycleChange(receiptID: receipt.id) == nil)
        store.stop()
    }

    @Test
    func chartIncludesAllHistoryBeyondTwoYearsAndSelectsMonths() {
        let months = (2023...2025).flatMap { year in
            (1...12).map { month in
                AccountHistoryMonth(
                    yearMonth: String(format: "%04d-%02d", year, month), accounts: [])
            }
        }
        let points = AccountBalancePoint.build(months: months, accountIDs: ["cash"])
        #expect(points.count == 36)
        #expect(points.first?.yearMonth == "2023-01")
        #expect(points.last?.yearMonth == "2025-12")
        #expect(AccountBalancePoint.selected(in: points, month: nil) == nil)
        #expect(AccountBalancePoint.selected(in: points, month: "2023-01") == points.first)
        #expect(AccountBalancePoint.selected(in: points, month: "missing") == nil)
        #expect(AccountBalancePoint.selected(in: [], month: nil) == nil)
        #expect(AccountBalancePoint.selected(in: [points[0]], month: nil) == nil)
    }

    @Test
    func tappingSelectedChartMonthClearsSelectionAndAllowsReselection() throws {
        let points = AccountBalancePoint.build(
            months: [
                .init(yearMonth: "2026-01", accounts: [.init(accountId: "cash", balance: 100)]),
                .init(yearMonth: "2026-02", accounts: [.init(accountId: "cash", balance: 250)]),
            ], accountIDs: ["cash"])
        let january = try #require(points.first)
        let february = try #require(points.last)
        var selectedMonth = january.toggledSelection(from: nil)
        #expect(AccountBalancePoint.selected(in: points, month: selectedMonth)?.balance == 100)

        selectedMonth = january.toggledSelection(from: selectedMonth)
        #expect(selectedMonth == nil)
        #expect(AccountBalancePoint.selected(in: points, month: selectedMonth) == nil)

        selectedMonth = january.toggledSelection(from: selectedMonth)
        #expect(selectedMonth == "2026-01")
        selectedMonth = february.toggledSelection(from: selectedMonth)
        #expect(selectedMonth == "2026-02")
        selectedMonth = february.toggledSelection(from: selectedMonth)
        #expect(selectedMonth == nil)
        #expect(AccountBalancePoint.selected(in: points, month: selectedMonth) == nil)
    }

    @Test
    func tappedChartMonthSurvivesBalanceRefreshesAndNewHistory() throws {
        let months = ["2025-12", "2026-01", "2026-02"].map { month in
            AccountHistoryMonth(
                yearMonth: month, accounts: [.init(accountId: "cash", balance: 100)])
        }
        let points = AccountBalancePoint.build(months: months, accountIDs: ["cash"])
        let tappedMonth = try #require(points.first?.yearMonth)
        let refreshed = AccountBalancePoint.build(
            months: months + [
                .init(yearMonth: "2026-03", accounts: [.init(accountId: "cash", balance: 500)])
            ], accountIDs: ["cash"])
        #expect(
            AccountBalancePoint.selected(in: refreshed, month: tappedMonth)?.yearMonth == "2025-12")
        #expect(AccountBalancePoint.selected(in: refreshed, month: nil) == nil)
        #expect(refreshed.map(\.yearMonth) == ["2025-12", "2026-01", "2026-02", "2026-03"])
    }

    @Test
    func currentMonthUsesLiveBalanceAndRecalculatesTheMonthlyChange() throws {
        let months = [
            AccountHistoryMonth(
                yearMonth: "2026-08", accounts: [.init(accountId: "cash", balance: 46_000_000)]),
            AccountHistoryMonth(
                yearMonth: "2026-09", accounts: [.init(accountId: "cash", balance: 45_791_700)]),
        ]
        let liveBalance = Decimal(44_684_000)
        let points = AccountBalancePoint.build(
            months: months, accountIDs: ["cash"], currentMonth: "2026-09",
            currentBalance: liveBalance)
        let september = try #require(AccountBalancePoint.selected(in: points, month: "2026-09"))
        #expect(september.balance == liveBalance)
        #expect(september.changeFromPreviousMonth(in: points) == liveBalance - 46_000_000)
        #expect(points.first?.balance == 46_000_000)
    }

    @Test
    func liveBalanceNeverReplacesTheLastHistoricalMonthWhenCurrentMonthIsMissing() {
        let months = [
            AccountHistoryMonth(
                yearMonth: "2026-08", accounts: [.init(accountId: "cash", balance: 10_000)])
        ]
        let points = AccountBalancePoint.build(
            months: months, accountIDs: ["cash"], currentMonth: "2026-09", currentBalance: 50_000)
        #expect(points.map(\.balance) == [10_000])
        #expect(points.map(\.yearMonth) == ["2026-08"])
        #expect(
            AccountBalancePoint.build(
                months: months, accountIDs: [], currentMonth: "2026-08", currentBalance: 50_000
            ).isEmpty)
    }

    @Test
    func accountFiltersKeepTheSameTimelineAndSelectedMonth() async {
        let accounts = [
            AccountSnapshot(
                id: "cash", name: "Cash", accountType: "banking_checking", currentBalance: 1000,
                firstBalanceYearMonth: "2025-12"),
            AccountSnapshot(
                id: "card", name: "Card", accountType: "credit_credit_card", currentBalance: -500,
                firstBalanceYearMonth: "2026-02"),
            AccountSnapshot(id: "empty", name: "Empty", accountType: "investment_brokerage"),
        ]
        let months = ["2025-12", "2026-01", "2026-02"].map { month in
            AccountHistoryMonth(
                yearMonth: month,
                accounts: [
                    .init(accountId: "cash", balance: 1000),
                    .init(accountId: "card", balance: month < "2026-02" ? 0 : -500),
                    .init(accountId: "empty", balance: 0),
                ])
        }
        let store = AccountsStore(
            accountsSubscription: { _ in
                Just(accounts).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in
                Just(AccountHistoryReport(months: months, currentMonth: "2026-02"))
                    .setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        store.prepare(workspace: Self.workspace())
        store.start()
        defer { store.stop() }
        await waitUntil { store.hasLoaded && !store.isLoadingHistory }
        let timelineIDs = Set(accounts.map(\.id))
        let all = store.balanceHistory(accountIDs: timelineIDs, timelineAccountIDs: timelineIDs)
        for accountID in ["cash", "card", "empty"] {
            let filtered = store.balanceHistory(
                accountIDs: [accountID], timelineAccountIDs: timelineIDs)
            #expect(filtered.map(\.yearMonth) == all.map(\.yearMonth))
            #expect(
                AccountBalancePoint.selected(in: filtered, month: "2026-01")?.yearMonth == "2026-01"
            )
        }
        let card = store.balanceHistory(accountIDs: ["card"], timelineAccountIDs: timelineIDs)
        #expect(card.map(\.balance) == [0, 0, -500])
        #expect(store.balanceHistory(accountIDs: ["card"]).map(\.yearMonth) == ["2026-02"])
    }

    @Test
    func currentMonthTracksFilteredAccountUpdatesWithoutWaitingForHistory() async {
        let cash = AccountSnapshot(
            id: "cash", name: "Cash", accountType: "banking_checking", currentBalance: 10_000,
            firstBalanceYearMonth: "2026-08")
        let card = AccountSnapshot(
            id: "card", name: "Card", accountType: "credit_credit_card", currentBalance: -2_000,
            firstBalanceYearMonth: "2026-08")
        let closed = AccountSnapshot(
            id: "closed", name: "Closed", accountType: "banking_savings", currentBalance: 90_000,
            isClosed: true, firstBalanceYearMonth: "2026-08")
        let updates = CurrentValueSubject<[AccountSnapshot], Error>([cash, card, closed])
        let months = ["2026-08", "2026-09"].map { month in
            AccountHistoryMonth(
                yearMonth: month,
                accounts: [
                    .init(accountId: "cash", balance: 20_000),
                    .init(accountId: "card", balance: -1_000),
                    .init(accountId: "closed", balance: 90_000),
                ])
        }
        let store = AccountsStore(
            defaults: nil,
            accountsSubscription: { _ in updates.eraseToAnyPublisher() },
            historySubscription: { _, _ in
                Just(AccountHistoryReport(months: months, currentMonth: "2026-09"))
                    .setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        store.prepare(workspace: Self.workspace())
        store.start()
        defer { store.stop() }
        await waitUntil { store.hasLoaded && !store.isLoadingHistory }
        let activeIDs = Set(store.activeAccounts.map(\.id))
        #expect(store.balanceHistory(accountIDs: activeIDs).map(\.balance) == [19_000, 8_000])
        #expect(store.balanceHistory(accountIDs: ["card"]).last?.balance == -2_000)
        #expect(store.balanceHistory(accountIDs: activeIDs).last?.balance == store.totalBalance)

        let updatedCash = AccountSnapshot(
            id: "cash", name: "Cash", accountType: "banking_checking", currentBalance: 12_000,
            firstBalanceYearMonth: "2026-08")
        updates.send([updatedCash, card, closed])
        await waitUntil { store.totalBalance == 10_000 }
        #expect(store.balanceHistory(accountIDs: activeIDs).map(\.balance) == [19_000, 10_000])
        #expect(store.balanceHistory(accountIDs: ["cash"]).last?.balance == 12_000)
    }

    @Test
    func monthlyBalanceChangeUsesPreviousBalanceAndZeroBeforeHistoryStarts() {
        let points = AccountBalancePoint.build(
            months: [
                .init(yearMonth: "2025-12", accounts: [.init(accountId: "cash", balance: 1000)]),
                .init(yearMonth: "2026-01", accounts: [.init(accountId: "cash", balance: 1500)]),
                .init(yearMonth: "2026-02", accounts: [.init(accountId: "cash", balance: 900)]),
                .init(yearMonth: "2026-03", accounts: [.init(accountId: "cash", balance: 900)]),
            ], accountIDs: ["cash"])
        #expect(points.map { $0.changeFromPreviousMonth(in: points) } == [1000, 500, -600, 0])
        #expect(points[1].changeFromPreviousMonth(in: Array(points.reversed())) == 500)
        let debt = AccountBalancePoint.build(
            months: [
                .init(yearMonth: "2026-01", accounts: [.init(accountId: "card", balance: -1000)]),
                .init(yearMonth: "2026-02", accounts: [.init(accountId: "card", balance: -500)]),
            ], accountIDs: ["card"])
        #expect(debt.map { $0.changeFromPreviousMonth(in: debt) } == [-1000, 500])
    }

    @Test
    func successfulCreationCapturesAReceiptAndFailedCreationDoesNotPublishOne() async throws {
        var shouldFail = true
        let store = Self.store(mutationHandler: { _ in
            if shouldFail { throw AccountStoreError.saveFailed }
            return "created-account"
        })
        let draft = AccountDraft(
            name: "  Savings  ", accountType: "banking_savings", initialBalance: 25_000,
            initialBalanceDate: TransactionEditorDate.today(workspace: Self.workspace()))
        #expect(await store.save(draft: draft) == false)
        #expect(store.latestCreationReceipt == nil)
        shouldFail = false
        #expect(await store.save(draft: draft))
        let receipt = try #require(store.latestCreationReceipt)
        #expect(receipt.kind == .accountCreated)
        #expect(receipt.workspace.id == "workspace")
        #expect(receipt.accountCreation?.accountID == "created-account")
        #expect(receipt.accountCreation?.name == "Savings")
        #expect(receipt.accountCreation?.readyToAssignDelta == 25_000)
        #expect(receipt.budgetChanges.isEmpty)
        store.reset()
        #expect(store.latestCreationReceipt == nil)
    }

    @Test
    func accountSectionsGroupTypesPreservingAccountOrderAndOmittingEmptyGroups() {
        let accounts = [
            AccountSnapshot(
                id: "card", name: "Card", accountType: "credit_credit_card",
                currentBalance: -2_500),
            AccountSnapshot(
                id: "savings", name: "Savings", accountType: "banking_savings",
                currentBalance: 12_000),
            AccountSnapshot(
                id: "loan", name: "Loan", accountType: "loan_mortgage",
                currentBalance: -80_000),
            AccountSnapshot(
                id: "cash", name: "Cash", accountType: "banking_cash", currentBalance: 3_000),
            AccountSnapshot(
                id: "ira", name: "IRA", accountType: "investment_ira",
                currentBalance: 25_000),
        ]
        let sections = AccountListSection.build(accounts: accounts)
        #expect(sections.map(\.category) == [.banking, .credit, .investment, .loan])
        #expect(
            sections.map { $0.accounts.map(\.id) } == [
                ["savings", "cash"], ["card"], ["ira"], ["loan"],
            ])
        #expect(sections.map(\.totalBalance) == [15_000, -2_500, 25_000, -80_000])
        #expect(AccountListSection.build(accounts: []).isEmpty)
        let filtered = AccountListSection.build(
            accounts: accounts.filter { $0.category == .credit })
        #expect(filtered.map(\.category) == [.credit])
        #expect(filtered.first?.accounts.map(\.id) == ["card"])
    }

    @Test
    func collapsedAccountGroupsPersistSeparatelyForEachWorkspace() async throws {
        let suiteName = "AccountsStoreTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let accounts = [
            Self.cash,
            AccountSnapshot(id: "card", name: "Card", accountType: "credit_credit_card"),
        ]
        let store = AccountsStore(
            defaults: defaults,
            accountsSubscription: { _ in
                Just(accounts).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.prepare(workspace: Self.workspace())
        store.start()
        await waitUntil { store.hasLoaded }

        store.toggleAccountGroup(.credit)
        #expect(store.collapsedCategoryIDs == [AccountCategory.credit.id])
        #expect(
            defaults.stringArray(forKey: "accounts.collapsedGroups.workspace") == ["credit"])

        store.prepare(workspace: Self.workspace("other"))
        await waitUntil { store.hasLoaded }
        #expect(store.collapsedCategoryIDs.isEmpty)
        store.toggleAccountGroup(.banking)
        #expect(store.collapsedCategoryIDs == [AccountCategory.banking.id])

        store.prepare(workspace: Self.workspace())
        await waitUntil { store.hasLoaded }
        #expect(store.collapsedCategoryIDs == [AccountCategory.credit.id])
        store.stop()
    }

    @Test
    func explicitlyScopedAccountsRejectAnotherWorkspacesBootstrap() async {
        let store = AccountsStore(
            workspaceID: "selected",
            workspaceLoader: {
                BudgetWorkspace(
                    id: "other", name: "Other", currencyCode: "USD", minorUnit: 2,
                    timezoneIdentifier: "UTC")
            },
            accountsSubscription: { _ in
                Issue.record("Wrong workspace must not load accounts")
                return Empty().eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Empty().eraseToAnyPublisher() })
        store.start()
        await waitUntil { store.errorMessage != nil }
        #expect(store.workspace == nil)
        #expect(!store.hasLoaded)
        store.reset()
    }

    @Test
    func explicitlyScopedAccountsIgnoreUnrelatedBudgetMetadata() {
        let store = AccountsStore(
            workspaceID: "selected", accountsSubscription: { _ in Empty().eraseToAnyPublisher() },
            historySubscription: { _, _ in Empty().eraseToAnyPublisher() })
        store.prepare(workspace: Self.workspace("selected"))
        store.prepare(workspace: Self.workspace("other"))
        store.prepare(workspace: nil)
        #expect(store.workspace?.id == "selected")
        store.reset()
        #expect(store.workspace == nil)
    }

    @Test
    func accountPayloadDecodesBigintsAndInstitutionIdentity() throws {
        let balance = try Int64(-42_050).convexEncode()
        let pending = try Int64(-50).convexEncode()
        let data = Data(
            """
            {"_id":"card","name":"Everyday","accountType":"credit_credit_card",
             "currentBalance":\(balance),"pendingBalance":\(pending),"isClosed":false,
             "resolvedLogoUrl":"https://example.com/logo.png","bankLinkAccountId":"linked",
             "bankLinkAccount":{"accountNumberMask":"1234","bankLink":{"institution":{
               "name":"Example Bank","primaryColor":"#123456"}}}}
            """.utf8)
        let account = try JSONDecoder().decode(AccountSnapshot.self, from: data)
        #expect(account.currentBalance == -42_050)
        #expect(account.pendingBalance == -50)
        #expect(account.clearedBalance == nil)
        #expect(account.institutionPrimaryColor == "#123456")
        #expect(account.institutionName == "Example Bank")
        #expect(account.accountNumberMask == "1234")
        #expect(account.category == .credit)
        #expect(account.isLinked)
    }

    @Test
    func manualAccountPayloadAcceptsMissingOptionalFields() throws {
        let zero = try Int64(0).convexEncode()
        let data = Data(
            """
            {"_id":"cash","name":"Cash","accountType":"banking_cash","currentBalance":\(zero)}
            """.utf8)
        let account = try JSONDecoder().decode(AccountSnapshot.self, from: data)
        #expect(account.currentBalance == 0)
        #expect(!account.isLinked)
        #expect(!account.isClosed)
        #expect(account.resolvedLogoUrl == nil)
    }

    @Test
    func chartUsesOnlySelectedAccountsAndPreservesSignedDebtWithoutOverflow() {
        let months = [
            AccountHistoryMonth(
                yearMonth: "2026-08",
                accounts: [
                    .init(accountId: "cash", balance: 5_000),
                    .init(accountId: "card", balance: -1_000),
                    .init(accountId: "closed", balance: 90_000),
                ]),
            AccountHistoryMonth(
                yearMonth: "2026-09",
                accounts: [
                    .init(accountId: "cash", balance: Int64.max),
                    .init(accountId: "card", balance: Int64.max),
                ]),
        ]
        let points = AccountBalancePoint.build(months: months, accountIDs: ["cash", "card"])
        #expect(points.map(\.yearMonth) == ["2026-08", "2026-09"])
        #expect(points[0].balance == 4_000)
        #expect(points[1].balance == Decimal(Int64.max) * 2)
        #expect(AccountBalancePoint.build(months: [], accountIDs: ["cash"]).isEmpty)
        #expect(AccountBalancePoint.build(months: months, accountIDs: []).isEmpty)
        #expect(
            AccountBalancePoint.build(months: months, accountIDs: ["card"])[0].balance == -1_000)
    }

    @Test
    func chartMonthRemainsSeptemberInAmericanTimezones() throws {
        let point = try #require(
            AccountBalancePoint.build(
                months: [
                    .init(yearMonth: "2026-09", accounts: [.init(accountId: "cash", balance: 100)])
                ],
                accountIDs: ["cash"]
            ).first)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let components = calendar.dateComponents([.year, .month, .day], from: point.date)
        #expect(components.year == 2026)
        #expect(components.month == 9)
        #expect(components.day == 1)
    }

    @Test
    func accountHistoryTrimsInventedPastAndPreservesBackdatedBalances() async throws {
        let balance = try Int64(100).convexEncode()
        let backdated = try JSONDecoder().decode(
            AccountSnapshot.self,
            from: Data(
                """
                {"_id":"backdated","name":"Backdated","accountType":"banking_savings",
                 "currentBalance":\(balance),"createdAt":"2026-09-05T12:00:00.000Z",
                 "firstBalanceYearMonth":"2026-01"}
                """.utf8))
        let recent = AccountSnapshot(
            id: "recent", name: "Recent", accountType: "banking_checking", currentBalance: 200,
            firstBalanceYearMonth: "2026-08")
        let empty = AccountSnapshot(id: "empty", name: "Empty", accountType: "banking_cash")
        let months = ["2025-12", "2026-01", "2026-07", "2026-08", "2026-09"].map { month in
            AccountHistoryMonth(
                yearMonth: month,
                accounts: [
                    .init(accountId: "backdated", balance: month >= "2026-01" ? 100 : 0),
                    .init(accountId: "recent", balance: month >= "2026-08" ? 200 : 0),
                    .init(accountId: "empty", balance: 0),
                ])
        }
        let store = AccountsStore(
            accountsSubscription: { _ in
                Just([backdated, recent, empty]).setFailureType(to: Error.self)
                    .eraseToAnyPublisher()
            },
            historySubscription: { _, _ in
                Just(AccountHistoryReport(months: months, currentMonth: "2026-09"))
                    .setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        store.prepare(workspace: Self.workspace())
        store.start()
        await waitUntil { store.hasLoaded && !store.isLoadingHistory }
        #expect(store.balanceHistory(accountIDs: ["empty"]).isEmpty)
        #expect(store.balanceHistory(accountIDs: ["unknown"]).isEmpty)
        #expect(
            store.balanceHistory(accountIDs: ["recent"]).map(\.yearMonth) == ["2026-08", "2026-09"])
        #expect(store.balanceHistory(accountIDs: ["backdated"]).first?.yearMonth == "2026-01")
        let mixed = store.balanceHistory(accountIDs: ["backdated", "recent", "empty"])
        #expect(mixed.map(\.yearMonth) == ["2026-01", "2026-07", "2026-08", "2026-09"])
        #expect(mixed.map(\.balance) == [100, 100, 300, 300])
        store.stop()
    }

    @Test
    func zeroBalanceCreationDoesNotCreateAnOpeningTransaction() throws {
        let request = AccountMutationRequest(
            workspaceID: "workspace", operation: .create(AccountDraft(name: "  Pocket cash  ")))
        #expect(request.mutationName == "bankAccounts:createBankAccount")
        #expect(try request.arguments["name"]??.convexEncode() == "\"Pocket cash\"")
        #expect(!request.arguments.keys.contains("initialBalance"))
        #expect(!request.arguments.keys.contains("initialBalanceDate"))
        #expect(!request.arguments.keys.contains("bankLinkAccountId"))
        #expect(!request.arguments.keys.contains("financeKitAccountId"))
    }

    @Test
    func manualCreationEncodesSignedMinorUnitsAndDate() throws {
        let request = AccountMutationRequest(
            workspaceID: "workspace",
            operation: .create(
                AccountDraft(
                    name: "Card", accountType: "credit_credit_card", initialBalance: -20_500,
                    initialBalanceDate: "2026-09-01")))
        #expect(
            try request.arguments["initialBalance"]??.convexEncode()
                == Int64(-20_500).convexEncode())
        #expect(try request.arguments["initialBalanceDate"]??.convexEncode() == "\"2026-09-01\"")
    }

    @Test
    func editingPreservesUntouchedLogoAndBalanceAndCanClearNotesAndLogo() throws {
        let account = AccountSnapshot(
            id: "cash", name: "Cash", accountType: "banking_checking", currentBalance: 10_000,
            notes: "Old notes", resolvedLogoUrl: "https://example.com/default.png")
        var draft = AccountDraft(account: account)
        draft.name = "Renamed"
        var request = AccountMutationRequest(
            workspaceID: "workspace", operation: .update(account, draft))
        #expect(Set(request.arguments.keys) == ["workspaceId", "bankAccountId", "name"])
        draft.notes = ""
        draft.logoUrl = ""
        request = AccountMutationRequest(
            workspaceID: "workspace", operation: .update(account, draft))
        #expect(try request.arguments["notes"]??.convexEncode() == "\"\"")
        #expect(try request.arguments["logoUrl"]??.convexEncode() == "null")
        #expect(!request.arguments.keys.contains("currentBalance"))
        #expect(!request.arguments.keys.contains("initialBalance"))
    }

    @Test
    func listAndHistoryStopWithoutClearingAndResetOnWorkspaceChange() async {
        let first = PassthroughSubject<[AccountSnapshot], Error>()
        let second = PassthroughSubject<[AccountSnapshot], Error>()
        var subscriptionCount = 0
        let store = AccountsStore(
            accountsSubscription: { id in
                subscriptionCount += 1
                return (id == "first" ? first : second).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.prepare(workspace: Self.workspace("first"))
        store.start()
        store.start()
        #expect(subscriptionCount == 1)
        first.send([Self.cash, Self.closed])
        await waitUntil { store.hasLoaded }
        #expect(store.activeAccounts.map(\.id) == ["cash"])
        #expect(store.closedAccounts.map(\.id) == ["closed"])
        #expect(store.totalBalance == 5_000)
        store.stop()
        #expect(store.accounts.count == 2)
        first.send([])
        await settle()
        #expect(store.accounts.count == 2)
        store.start()
        #expect(subscriptionCount == 2)
        store.prepare(workspace: Self.workspace("second"))
        #expect(store.accounts.isEmpty)
        #expect(!store.hasLoaded)
        first.send([Self.cash])
        second.send([Self.closed])
        await waitUntil { store.hasLoaded }
        #expect(store.accounts.map(\.id) == ["closed"])
        store.reset()
        #expect(store.workspace == nil)
        #expect(store.accounts.isEmpty)
    }

    @Test
    func failedOrSilentSubscriptionsHaveRetryableErrors() async {
        let subject = PassthroughSubject<[AccountSnapshot], Error>()
        var requests = 0
        let store = AccountsStore(
            responseTimeout: .milliseconds(15),
            accountsSubscription: { _ in
                requests += 1
                return subject.eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.prepare(workspace: Self.workspace())
        store.start()
        await waitUntil { store.errorMessage != nil }
        #expect(!store.isLoading)
        #expect(!store.hasLoaded)
        store.retry()
        #expect(requests == 2)
        subject.send([Self.cash])
        await waitUntil { store.hasLoaded }
        #expect(store.errorMessage == nil)
        store.stop()
    }

    @Test
    func earlyAccountsNavigationBootstrapsWorkspaceBeforeSubscribingOnce() async {
        var continuation: CheckedContinuation<BudgetWorkspace?, Error>?
        var accountRequests: [String] = []
        let store = AccountsStore(
            workspaceLoader: {
                try await withCheckedThrowingContinuation { continuation = $0 }
            },
            accountsSubscription: { workspaceID in
                accountRequests.append(workspaceID)
                return Just([Self.cash]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.start()
        await waitUntil { continuation != nil }
        #expect(store.isLoading)
        #expect(!store.hasLoaded)
        #expect(accountRequests.isEmpty)
        continuation?.resume(returning: Self.budgetWorkspace())
        await waitUntil { store.hasLoaded }
        #expect(store.workspace?.id == "workspace")
        #expect(accountRequests == ["workspace"])
        store.prepareForBudgetWorkspace(Self.budgetWorkspace())
        #expect(accountRequests == ["workspace"])
        store.stop()
    }

    @Test
    func workspaceBootstrapFailureCanRetryAndLoadAccounts() async {
        var attempts = 0
        let store = AccountsStore(
            workspaceLoader: {
                attempts += 1
                if attempts == 1 { throw AccountStoreError.loadFailed }
                return Self.budgetWorkspace()
            },
            accountsSubscription: { _ in
                Just([Self.cash]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.start()
        await waitUntil { store.errorMessage != nil }
        #expect(!store.isLoading)
        #expect(!store.hasLoaded)
        store.retry()
        await waitUntil { store.hasLoaded }
        #expect(attempts == 2)
        #expect(store.errorMessage == nil)
        #expect(store.accounts.map(\.id) == ["cash"])
        store.stop()
    }

    @Test
    func workspaceBootstrapDistinguishesNoWorkspaceFromLoading() async {
        var accountRequests = 0
        let store = AccountsStore(
            workspaceLoader: { nil },
            accountsSubscription: { _ in
                accountRequests += 1
                return Just([Self.cash]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(store.workspace == nil)
        #expect(!store.isLoading)
        #expect(store.errorMessage == nil)
        #expect(accountRequests == 0)
        store.stop()
    }

    @Test
    func staleWorkspaceBootstrapCannotReplaceExternallySelectedWorkspace() async {
        var continuation: CheckedContinuation<BudgetWorkspace?, Error>?
        var accountRequests: [String] = []
        let store = AccountsStore(
            workspaceLoader: {
                try await withCheckedThrowingContinuation { continuation = $0 }
            },
            accountsSubscription: { id in
                accountRequests.append(id)
                return Just([Self.cash]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.start()
        await waitUntil { continuation != nil }
        store.prepare(workspace: Self.workspace("selected"))
        continuation?.resume(returning: Self.budgetWorkspace())
        await waitUntil { store.hasLoaded }
        await settle()
        #expect(store.workspace?.id == "selected")
        #expect(accountRequests == ["selected"])
        store.stop()
    }

    @Test(arguments: [false, true])
    func stoppedOrResetWorkspaceBootstrapCannotResubscribe(reset: Bool) async {
        var continuation: CheckedContinuation<BudgetWorkspace?, Error>?
        var accountRequests = 0
        let store = AccountsStore(
            workspaceLoader: {
                try await withCheckedThrowingContinuation { continuation = $0 }
            },
            accountsSubscription: { _ in
                accountRequests += 1
                return Just([Self.cash]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in Self.historyPublisher() })
        store.start()
        await waitUntil { continuation != nil }
        if reset { store.reset() } else { store.stop() }
        continuation?.resume(returning: Self.budgetWorkspace())
        await settle()
        #expect(store.workspace == nil)
        #expect(accountRequests == 0)
        #expect(!store.isLoading)
        #expect(!store.hasLoaded)
    }

    @Test
    func deleteChecksTransactionsAndDoesNotMutateWhenIneligible() async {
        var hasTransactions = true
        var operations: [String] = []
        let store = Self.store(
            mutationHandler: { request in
                operations.append(request.mutationName)
                return nil
            },
            transactionsChecker: { _, _ in hasTransactions })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.delete(account: Self.cash) == false)
        #expect(operations.isEmpty)
        #expect(store.actionErrorMessage?.contains("Close it") == true)
        hasTransactions = false
        #expect(await store.delete(account: Self.cash))
        #expect(operations == ["bankAccounts:deleteBankAccount"])
        store.stop()
    }

    @Test
    func lifecycleUsesCurrentStateAndNeverChangesConnectionArguments() async {
        var operations: [AccountMutationRequest] = []
        let store = Self.store(mutationHandler: { request in
            operations.append(request)
            return nil
        })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.close(account: Self.cash))
        #expect(await store.close(account: Self.closed) == false)
        #expect(await store.reopen(account: Self.closed))
        #expect(
            operations.map(\.mutationName) == [
                "bankAccounts:closeBankAccount", "bankAccounts:reopenBankAccount",
            ])
        #expect(
            operations.allSatisfy { Set($0.arguments.keys) == ["workspaceId", "bankAccountId"] })
        store.stop()
    }

    @Test
    func workspaceSwitchDiscardsPendingMutationCompletion() async {
        var continuation: CheckedContinuation<String?, Error>?
        let store = Self.store(mutationHandler: { _ in
            try await withCheckedThrowingContinuation { continuation = $0 }
        })
        let save = Task { await store.save(draft: AccountDraft(name: "Cash")) }
        await waitUntil { continuation != nil }
        #expect(store.isSaving)
        store.prepare(workspace: Self.workspace("different"))
        continuation?.resume(returning: "new-account")
        #expect(await save.value == false)
        #expect(!store.isSaving)
        #expect(store.lastCreatedAccountID == nil)
        #expect(store.latestCreationReceipt == nil)
        #expect(store.actionErrorMessage == nil)
        store.stop()
    }

    @Test
    func validationUsesWorkspaceDateAndAllowsOnlySameCategoryEdits() {
        let store = Self.store()
        #expect(store.validationMessage(for: AccountDraft(name: "  ")) != nil)
        var draft = AccountDraft(account: Self.cash)
        draft.accountType = "investment_brokerage"
        #expect(store.validationMessage(for: draft, account: Self.cash) != nil)
        draft.accountType = "banking_savings"
        #expect(store.validationMessage(for: draft, account: Self.cash) == nil)
        draft.logoUrl = "http://example.com/logo.png"
        #expect(store.validationMessage(for: draft, account: Self.cash) != nil)
        draft.logoUrl = "https://example.com/logo.png"
        #expect(store.validationMessage(for: draft, account: Self.cash) == nil)
        #expect(
            store.validationMessage(
                for: AccountDraft(
                    name: "Cash", initialBalance: 100, initialBalanceDate: "2026-02-30")) != nil)
        #expect(
            store.validationMessage(
                for: AccountDraft(
                    name: "Cash", initialBalance: 100, initialBalanceDate: "2999-01-01")) != nil)
    }

    private static let cash = AccountSnapshot(
        id: "cash", name: "Cash", accountType: "banking_checking", currentBalance: 5_000)
    private static let closed = AccountSnapshot(
        id: "closed", name: "Old savings", accountType: "banking_savings",
        currentBalance: 10_000, isClosed: true)

    private static func workspace(_ id: String = "workspace") -> TransactionFeedWorkspace {
        .init(
            id: id, name: id, currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "America/New_York")
    }

    private static func budgetWorkspace() -> BudgetWorkspace {
        .init(
            id: "workspace", name: "workspace", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "America/New_York")
    }

    private static func historyPublisher() -> AnyPublisher<AccountHistoryReport, Error> {
        Just(AccountHistoryReport(months: [], currentMonth: "2026-09"))
            .setFailureType(to: Error.self).eraseToAnyPublisher()
    }

    private static func store(
        mutationHandler: @escaping AccountsStore.MutationHandler = { _ in nil },
        transactionsChecker: @escaping AccountsStore.TransactionsChecker = { _, _ in false }
    ) -> AccountsStore {
        let store = AccountsStore(
            accountsSubscription: { _ in
                Just([cash, closed]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in historyPublisher() },
            mutationHandler: mutationHandler,
            transactionsChecker: transactionsChecker)
        store.prepare(workspace: workspace())
        return store
    }

    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<100 {
            if condition() { return }
            await settle()
        }
        #expect(condition())
    }

    private func settle() async { try? await Task.sleep(for: .milliseconds(5)) }
}

struct AccountBalanceChartScaleTests {
    @Test
    func balanceBarsKeepZeroBaselineForAssetsDebtAndMixedBalances() {
        let assets = AccountBalanceChartScale.barDomain(
            balances: [100_000, 102_000], visibleIndices: 0..<2, minorUnit: 2)
        #expect(assets.lowerBound == 0)
        #expect(assets.upperBound > 1020)

        let debt = AccountBalanceChartScale.barDomain(
            balances: [-100_000, -102_000], visibleIndices: 0..<2, minorUnit: 2)
        #expect(debt.upperBound == 0)
        #expect(debt.lowerBound < -1020)

        let mixed = AccountBalanceChartScale.barDomain(
            balances: [-100_000, 102_000], visibleIndices: 0..<2, minorUnit: 2)
        #expect(mixed.lowerBound < -1000)
        #expect(mixed.upperBound > 1020)
    }

    @Test
    func balanceBarsScaleToVisibleMonthsAndCurrencyPrecision() {
        let balances: [Decimal] = [10_000_000, 100_000, 100_000]
        let recent = AccountBalanceChartScale.barDomain(
            balances: balances, visibleIndices: 1..<3, minorUnit: 2)
        #expect(recent == 0...1050)
        let historical = AccountBalanceChartScale.barDomain(
            balances: balances, visibleIndices: 0..<2, minorUnit: 2)
        #expect(historical.upperBound > 100_000)

        for minorUnit in [0, 2, 3] {
            let domain = AccountBalanceChartScale.barDomain(
                balances: [100_000], visibleIndices: 0..<1, minorUnit: minorUnit)
            #expect(domain.lowerBound == 0)
            #expect(domain.upperBound == 105_000 / pow(10, Double(minorUnit)))
        }
    }

    @Test
    func emptyAndZeroBalanceBarsHaveANonzeroRange() {
        for balances: [Decimal] in [[], [0], [0, 0]] {
            let domain = AccountBalanceChartScale.barDomain(
                balances: balances, visibleIndices: balances.indices, minorUnit: 2)
            #expect(domain.contains(0))
            #expect(domain.upperBound > domain.lowerBound)
        }
    }

    @Test(arguments: [1, 5, 9, 12, 120])
    func initialLayoutPlacesLatestMonthAtTrailingInset(monthCount: Int) {
        let layout = AccountBalanceChartLayout(
            monthCount: monthCount, monthWidth: 36, viewportWidth: 402)
        let chartLeadingSpace = layout.horizontalInset + layout.contentWidth - layout.chartWidth
        let finalMonthCenter =
            chartLeadingSpace + layout.chartWidth - layout.monthWidth / 2 - layout.trailingOffset
        #expect(finalMonthCenter == 402 - 24 - 18)
        #expect(chartLeadingSpace - layout.trailingOffset == layout.initialChartMinX)
        #expect(layout.scrollContentWidth >= layout.viewportWidth)
    }

    @Test
    func initialOffsetRecalculatesWhenNavigationViewportSettles() {
        let initial = AccountBalanceChartLayout(
            monthCount: 12, monthWidth: 36, viewportWidth: 200)
        let settled = AccountBalanceChartLayout(
            monthCount: 12, monthWidth: 36, viewportWidth: 402)
        #expect(initial != settled)
        #expect(initial.trailingOffset == 280)
        #expect(settled.trailingOffset == 78)
        #expect(initial.trailingOffset - settled.trailingOffset == 202)
    }

    @Test
    func shortHistoryUsesOneViewportWithoutPositiveScrollOffset() {
        let layout = AccountBalanceChartLayout(
            monthCount: 5, monthWidth: 36, viewportWidth: 402)
        #expect(layout.chartWidth == 180)
        #expect(layout.contentWidth == 354)
        #expect(layout.trailingOffset == 0)
        #expect(layout.initialChartMinX == 198)
    }

    @Test(arguments: [1, 5, 12, 120])
    func programmaticMonthScrollingStaysWithinPaddedContent(monthCount: Int) {
        let layout = AccountBalanceChartLayout(
            monthCount: monthCount, monthWidth: 36, viewportWidth: 402)
        for index in 0..<monthCount {
            #expect((0...layout.trailingOffset).contains(layout.scrollOffset(forMonthAt: index)))
        }
        #expect(layout.scrollOffset(forMonthAt: monthCount - 1) == layout.trailingOffset)
        if monthCount > 10 {
            #expect(layout.scrollOffset(forMonthAt: 0) == 0)
        } else {
            #expect(layout.trailingOffset == 0)
        }
    }

    @Test
    func newHistoryAndLargerMonthLabelsRecalculateTrailingPosition() {
        let initial = AccountBalanceChartLayout(
            monthCount: 12, monthWidth: 36, viewportWidth: 402)
        let refreshed = AccountBalanceChartLayout(
            monthCount: 13, monthWidth: 36, viewportWidth: 402)
        let largerText = AccountBalanceChartLayout(
            monthCount: 12, monthWidth: 72, viewportWidth: 402)
        #expect(refreshed.trailingOffset - initial.trailingOffset == 36)
        #expect(largerText.trailingOffset - initial.trailingOffset == 432)
    }

    @Test(arguments: [Decimal(1_000_000), Decimal(-1_000_000)])
    func offscreenAnomalyDoesNotFlattenRecentMonths(anomaly: Decimal) {
        let balances = [anomaly] + Array(repeating: Decimal(100_000), count: 11)
        let recent = AccountBalanceChartScale.domain(
            balances: balances, visibleIndices: 4..<12, minorUnit: 2)
        #expect(recent == 950...1050)

        let historical = AccountBalanceChartScale.domain(
            balances: balances, visibleIndices: 0..<8, minorUnit: 2)
        #expect(historical.contains(NSDecimalNumber(decimal: anomaly).doubleValue / 100))
        #expect(historical.upperBound - historical.lowerBound > 9_000)
    }

    @Test
    func scrollingPastAnomalyRestoresLocalScale() {
        let balances: [Decimal] = [1_000_000, 100_000, 102_000, 98_000, 105_000, 99_000]
        let before = AccountBalanceChartScale.visibleIndices(
            count: 6, monthWidth: 36, chartMinX: -35, viewportWidth: 144)
        let after = AccountBalanceChartScale.visibleIndices(
            count: 6, monthWidth: 36, chartMinX: -36, viewportWidth: 144)
        #expect(before == 0..<5)
        #expect(after == 1..<5)
        #expect(
            AccountBalanceChartScale.domain(
                balances: balances, visibleIndices: before, minorUnit: 2
            ).contains(10_000))
        let recent = AccountBalanceChartScale.domain(
            balances: balances, visibleIndices: after, minorUnit: 2)
        #expect(recent.lowerBound > 900)
        #expect(recent.upperBound < 1_200)
    }

    @Test
    func latestWindowAccountsForTrailingMarginAndLongHistories() {
        let visible = AccountBalanceChartScale.visibleIndices(
            count: 120, monthWidth: 36, chartMinX: 390 - 24 - 120 * 36,
            viewportWidth: 390)
        #expect(visible == 109..<120)
    }

    @Test
    func resizingAndDynamicTypeUseActualMonthWidth() {
        #expect(
            AccountBalanceChartScale.visibleIndices(
                count: 24, monthWidth: 36, chartMinX: -180, viewportWidth: 180) == 5..<10)
        #expect(
            AccountBalanceChartScale.visibleIndices(
                count: 24, monthWidth: 72, chartMinX: -360, viewportWidth: 180) == 5..<8)
        #expect(
            AccountBalanceChartScale.visibleIndices(
                count: 24, monthWidth: 36, chartMinX: -180, viewportWidth: 360) == 5..<15)
    }

    @Test
    func shortHistoryAndOverscrollKeepValidIndices() {
        #expect(
            AccountBalanceChartScale.visibleIndices(
                count: 2, monthWidth: 36, chartMinX: 294, viewportWidth: 390) == 0..<2)
        #expect(
            AccountBalanceChartScale.visibleIndices(
                count: 12, monthWidth: 36, chartMinX: 500, viewportWidth: 390) == 0..<1)
        #expect(
            AccountBalanceChartScale.visibleIndices(
                count: 12, monthWidth: 36, chartMinX: -500, viewportWidth: 390) == 11..<12)
        #expect(
            AccountBalanceChartScale.visibleIndices(
                count: 0, monthWidth: 36, chartMinX: 0, viewportWidth: 390
            ).isEmpty)
    }

    @Test(arguments: [Decimal(0), Decimal(100_000), Decimal(-100_000)])
    func flatAndSingleMonthHistoriesHaveNonzeroSpan(balance: Decimal) {
        let single = AccountBalanceChartScale.domain(
            balances: [balance], visibleIndices: 0..<1, minorUnit: 2)
        let flat = AccountBalanceChartScale.domain(
            balances: Array(repeating: balance, count: 6), visibleIndices: 0..<6, minorUnit: 2)
        #expect(single == flat)
        #expect(single.lowerBound < single.upperBound)
        #expect(single.contains(NSDecimalNumber(decimal: balance).doubleValue / 100))
    }

    @Test
    func debtAndZeroCrossingsPreserveSigns() {
        let debt = AccountBalanceChartScale.domain(
            balances: [-120_000, -100_000, -90_000], visibleIndices: 0..<3, minorUnit: 2)
        #expect(debt.lowerBound < -1_200)
        #expect(debt.upperBound > -900)
        #expect(debt.upperBound < 0)
        let mixed = AccountBalanceChartScale.domain(
            balances: [-10_000, 0, 20_000], visibleIndices: 0..<3, minorUnit: 2)
        #expect(mixed.contains(-100))
        #expect(mixed.contains(0))
        #expect(mixed.contains(200))
    }

    @Test(arguments: [0, 2, 3])
    func currencyMinorUnitsAreRespected(minorUnit: Int) {
        let balance = Decimal(1_000) * pow(10, minorUnit)
        #expect(
            AccountBalanceChartScale.domain(
                balances: [balance], visibleIndices: 0..<1, minorUnit: minorUnit) == 950...1050)
    }

    @Test
    func visibleSpikesAndSustainedGrowthRemainFullyRepresented() {
        let balances: [Decimal] = [100_000, 200_000, 500_000, 1_000_000]
        let domain = AccountBalanceChartScale.domain(
            balances: balances, visibleIndices: 0..<4, minorUnit: 2)
        #expect(domain.contains(1_000))
        #expect(domain.contains(10_000))
    }

    @Test
    func emptyAndStaleRangesAreSafe() {
        #expect(
            AccountBalanceChartScale.domain(
                balances: [], visibleIndices: 0..<0, minorUnit: 2) == 0...1)
        #expect(
            AccountBalanceChartScale.domain(
                balances: [100_000], visibleIndices: 0..<12, minorUnit: 2) == 950...1050)
        #expect(
            AccountBalanceChartScale.domain(
                balances: [100_000], visibleIndices: 10..<12, minorUnit: 2) == 0...1)
    }
}
