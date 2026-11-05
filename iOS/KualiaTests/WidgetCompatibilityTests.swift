import Foundation
import Testing

@testable import Kualia

@MainActor
struct WidgetCompatibilityTests {
    @Test func widgetContextDetectsFinancialChangesWithoutCatalogEdits() {
        func context(
            budgetRevision: Int = 1, accountBalance: Int64 = 10_000,
            billStatus: PlannedStatus = .upcoming
        ) -> WidgetSessionContext {
            WidgetSessionContext(
                sessionID: "session", workspaceID: "workspace", workspaceName: "Personal",
                currencyCode: "USD", timezoneIdentifier: "America/New_York",
                categories: [.init(id: "groceries", name: "Groceries", groupName: "Everyday")],
                accounts: [.init(id: "checking", name: "Checking", category: "banking")],
                budgetSnapshotRevision: budgetRevision,
                accountBalances: ["checking": accountBalance],
                plannedData: PlannedData(
                    today: "2026-09-11",
                    availableRange: .init(minYearMonth: 202609, maxYearMonth: 202612),
                    allPlannedTransactions: [],
                    plannedByMonth: [
                        "202609": [
                            PlannedOccurrence(
                                scheduledTransactionId: "rent", occurrenceDate: "2026-09-12",
                                displayDate: "2026-09-12", isTransfer: false,
                                coverage: .init(
                                    status: billStatus, expectedAmount: -5_000, paidAmount: 0,
                                    linkedTransactions: []))
                        ]
                    ]))
        }
        let original = context()
        #expect(original == context())
        #expect(original != context(budgetRevision: 2))
        #expect(original != context(accountBalance: 20_000))
        #expect(original != context(billStatus: .paid))
        #expect(original != context(billStatus: .skipped))
        #expect(original.accounts == context(accountBalance: 20_000).accounts)
        #expect(original.categories == context(budgetRevision: 2).categories)
    }

    @Test(arguments: ["kualia://new-transaction", "kualia://add-transaction?type=expense"])
    func legacyAndNewCaptureLinksOpenExpense(_ value: String) throws {
        let url = try #require(URL(string: value))
        #expect(WidgetRoute(url: url) == .capture(.expense))
    }

    @Test func widgetLinksPreserveIntentAndRejectUnrecognizedRoutes() throws {
        let routes: [(String, WidgetRoute?)] = [
            ("kualia://add-transaction?type=income", .capture(.income)),
            ("kualia://add-transaction?type=transfer", .capture(.transfer)),
            ("kualia://widget-backgrounds", .widgets),
            ("kualia://widgets", .widgets),
            ("kualia://account/checking", .account("checking")),
            ("kualia://planned/schedule", .plannedTransaction("schedule")),
            ("kualia://planned", .planned),
            ("kualia://planned/", .planned),
            ("kualia://budget", .budget),
            ("https://budget", nil),
            ("kualia://account", nil),
            ("kualia://add-transaction?type=delete", nil),
            ("kualia://delete-account", nil),
        ]
        for (raw, expected) in routes {
            #expect(WidgetRoute(url: try #require(URL(string: raw))) == expected)
        }
    }

    @Test func pendingLegacyPlannedLinkRetainsItsScheduleWhileWaitingForData() throws {
        let navigation = WidgetNavigationStore()
        navigation.open(try #require(URL(string: "kualia://planned/rent-schedule")))
        let requestID = try #require(navigation.pending?.id)
        #expect(navigation.pending?.route == .plannedTransaction("rent-schedule"))
        // An unrelated callback must not erase a pending cold-launch destination.
        navigation.open(try #require(URL(string: "https://kualia.com")))
        #expect(navigation.pending?.id == requestID)
        #expect(navigation.pending?.route == .plannedTransaction("rent-schedule"))
    }

    @Test func legacyUpcomingResponseDecodesWithoutNewIncomeField() throws {
        let json =
            #"{"transactions":[{"recurringTransactionId":"rent","merchantName":"Rent","amount":120000,"dueDate":"2026-09-01","isOverdue":true}],"currencyCode":"USD"}"#
        let response = try JSONDecoder().decode(
            UpcomingTransactionsResponse.self, from: Data(json.utf8))
        #expect(response.transactions.first?.isIncome == nil)
        #expect(response.transactions.first?.amount == 120000)
    }

    @Test func budgetPulsePreservesSignedMinorUnitsAndWorkspaceDay() throws {
        let json =
            #"{"workspaceName":"Personal","currencyCode":"JPY","month":"2026-09","today":"2026-09-30","daysRemaining":1,"totalAvailable":-120,"totalAssigned":100,"totalActivity":-220,"overspentCount":1,"overspentAmount":120}"#
        let response = try JSONDecoder().decode(BudgetPulseResponse.self, from: Data(json.utf8))
        #expect(response.totalAvailable == -120)
        #expect(response.totalActivity == -220)
        #expect(response.daysRemaining == 1)
        #expect(response.currencyCode == "JPY")
    }

    @Test func lockScreenBalancesOnlyUseTheVisibleSelection() {
        let layout = WidgetBalanceLayout.accessory
        let choices: [String?] = ["credit", "savings", "checking"]
        let ids = WidgetBalanceSelection.selectedIDs(choices, layout: layout)
        #expect(ids == ["credit"])
        #expect(
            WidgetBalanceSelection.selectedIDs([nil, "savings"], layout: layout)
                .isEmpty)
        #expect(
            WidgetBalanceSelection.selectedIDs(["", "savings"], layout: layout)
                .isEmpty)

        let response = AccountBalancesResponse(
            groups: [
                AccountGroup(
                    category: "credit",
                    accounts: [
                        AccountBalance(
                            accountId: "credit", name: "Credit", accountType: "credit_credit_card",
                            balance: -4500),
                        AccountBalance(
                            accountId: "savings", name: "Savings", accountType: "banking_savings",
                            balance: 20000),
                    ], subtotal: 15500)
            ],
            totalAssets: 20000, totalLiabilities: -4500, netWorth: 15500, currencyCode: "USD")
        #expect(
            WidgetBalanceSelection.accounts(in: response, selectedIDs: ids).map(\.balance) == [
                -4500
            ])
        let missing = WidgetBalanceSelection.selectedIDs(
            ["removed", "savings"], layout: layout)
        #expect(WidgetBalanceSelection.accounts(in: response, selectedIDs: missing).isEmpty)
    }

    @Test func balanceSelectionUsesTheFirstChoicesForEachSize() {
        let choices: [String?] = [
            nil, "savings", "savings", "", "credit", "checking", "loan", "cash", "investment",
            "extra",
        ]
        #expect(
            WidgetBalanceSelection.selectedIDs(
                choices, layout: WidgetBalanceLayout.small)
                == ["savings"])
        #expect(
            WidgetBalanceSelection.selectedIDs(
                choices, layout: WidgetBalanceLayout.medium)
                == ["savings", "credit", "checking"])
        #expect(
            WidgetBalanceSelection.selectedIDs(
                choices, layout: WidgetBalanceLayout.large)
                == ["savings", "credit", "checking", "loan", "cash", "investment"])
        #expect(WidgetBalanceSelection.uniqueIDs([nil, ""], limit: 6).isEmpty)
    }

    @Test func selectedBalancesKeepOrderAcrossAccountGroupsAndNeverUseTotals() throws {
        let json =
            #"{"groups":[{"category":"banking","accounts":[{"accountId":"checking","name":"Checking","accountType":"banking_checking","balance":12345},{"accountId":"savings","name":"Savings","accountType":"banking_savings","balance":98765}],"subtotal":111110},{"category":"credit","accounts":[{"accountId":"credit","name":"Credit","accountType":"credit_credit_card","balance":-4500}],"subtotal":-4500}],"totalAssets":111110,"totalLiabilities":-4500,"netWorth":106610,"currencyCode":"USD"}"#
        let response = try JSONDecoder().decode(AccountBalancesResponse.self, from: Data(json.utf8))
        let selected = WidgetBalanceSelection.accounts(
            in: response, selectedIDs: ["credit", "savings", "checking"])
        #expect(selected.map(\.id) == ["credit", "savings", "checking"])
        #expect(selected.map(\.balance) == [-4500, 98765, 12345])
        let smallIDs = WidgetBalanceSelection.uniqueIDs(
            ["credit", "savings", "checking"], limit: WidgetBalanceLayout.small.capacity)
        #expect(
            WidgetBalanceSelection.accounts(in: response, selectedIDs: smallIDs).map(\.balance) == [
                -4500
            ])
        #expect(WidgetBalanceSelection.accounts(in: response, selectedIDs: []).isEmpty)
        #expect(WidgetBalanceSelection.accounts(in: response, selectedIDs: ["removed"]).isEmpty)
        #expect(
            WidgetBalanceSelection.accounts(in: response, selectedIDs: ["savings", "savings"]).count
                == 1)
    }

    @Test func categoryBalancesPreserveAvailableAmountsIncludingZeroAndOverspending() throws {
        let json =
            #"{"categories":[{"categoryName":"Food","available":-1500,"assigned":5000,"activity":-6500,"hasUnmetTarget":false},{"categoryName":"Food","available":0,"assigned":1000,"activity":-1000,"hasUnmetTarget":true},{"categoryName":"Travel","available":9999,"assigned":12000,"activity":-2001,"hasUnmetTarget":false}],"currencyCode":"JPY","month":"2026-09"}"#
        let response = try JSONDecoder().decode(
            CategoryAvailableResponse.self, from: Data(json.utf8))
        #expect(response.balanceRows.map(\.amount) == [-1500, 0, 9999])
        #expect(response.balanceRows.map(\.title) == ["Food", "Food", "Travel"])
        #expect(Set(response.balanceRows.map(\.id)).count == 3)
        #expect(response.currencyCode == "JPY")
    }

    @Test func shortcutAmountRejectsNonfiniteAndOverflowValues() {
        func amount(_ value: Double, places: Int = 2) -> Int64? {
            TransactionShortcutDraft(
                amount: value, direction: nil, payee: nil, account: nil,
                category: nil, date: nil, notes: nil
            )
            .minorUnitAmount(decimalPlaces: places)
        }
        #expect(amount(12.34) == 1234)
        #expect(amount(1.005) == 101)
        #expect(amount(1, places: -1) == nil)
        #expect(amount(12, places: 0) == 12)
        #expect(amount(1.234, places: 3) == 1234)
        #expect(amount(-1) == nil)
        #expect(amount(0.001) == nil)
        #expect(amount(.infinity) == nil)
        #expect(amount(.nan) == nil)
        #expect(amount(Double(Int64.max), places: 0) == nil)
    }

    @Test func controlActionIsConsumedOnceAndClearsOldDraft() throws {
        let suite = "kualia-widget-compatibility-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let draft = TransactionShortcutDraft(
            amount: 45, direction: .outflow, payee: "Groceries",
            account: nil, category: nil, date: nil, notes: nil)
        PendingAppActionStore.enqueueNewTransaction(draft: draft, defaults: defaults)
        #expect(PendingAppActionStore.consume(defaults: defaults) == .newTransaction(draft))
        #expect(PendingAppActionStore.consume(defaults: defaults) == nil)
        PendingAppActionStore.enqueueNewTransaction(draft: draft, defaults: defaults)
        PendingAppActionStore.enqueueNewTransaction(draft: nil, defaults: defaults)
        #expect(PendingAppActionStore.consume(defaults: defaults) == .newTransaction(nil))
    }
    @Test func shortcutPayloadRetainsTransferScheduleAndWorkspace() throws {
        let draft = TransactionShortcutDraft(
            amount: 50, direction: .transfer, payee: nil, account: "Checking",
            category: "Bills / Rent", date: Date(timeIntervalSince1970: 1_788_559_200),
            notes: "Monthly transfer", transferAccount: "Savings", recurrence: .monthly,
            workspaceID: "personal", workspaceName: "Personal")
        let roundTrip = try JSONDecoder().decode(
            TransactionShortcutDraft.self, from: JSONEncoder().encode(draft))
        #expect(roundTrip == draft)
        #expect(roundTrip.matchesWorkspace(id: "personal", name: "Personal"))
        #expect(!roundTrip.matchesWorkspace(id: "family", name: "Personal"))
        #expect(!roundTrip.matchesWorkspace(id: "personal", name: "Family"))
        let legacy = try JSONDecoder().decode(
            TransactionShortcutDraft.self, from: Data(#"{"amount":10,"direction":"outflow"}"#.utf8))
        #expect(legacy.recurrence == nil)
        #expect(legacy.matchesWorkspace(id: "personal", name: "Personal"))
    }

    @Test func managementActionClearsAnEarlierDraftAndConsumesOnce() throws {
        let suite = "kualia-shortcut-management-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        PendingAppActionStore.enqueueNewTransaction(
            draft: TransactionShortcutDraft(
                amount: 50, direction: .outflow, payee: nil, account: nil,
                category: nil, date: nil, notes: nil), defaults: defaults)
        PendingAppActionStore.enqueueTransactions(filter: .needsReview, defaults: defaults)
        #expect(defaults.data(forKey: PendingAppActionStore.transactionDraftKey) == nil)
        #expect(PendingAppActionStore.consume(defaults: defaults) == .transactions(.needsReview))
        #expect(PendingAppActionStore.consume(defaults: defaults) == nil)
    }

    @Test func foregroundActionsPreserveTheirRouteAndAreNotReplayed() throws {
        let suite = "kualia-foreground-shortcuts-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let navigation = WidgetNavigationStore()
        PendingAppActionStore.enqueueNewTransaction(
            draft: TransactionShortcutDraft(
                amount: 25, direction: .transfer, payee: nil, account: "Checking",
                category: nil, date: nil, notes: nil, transferAccount: "Savings"),
            defaults: defaults)
        navigation.consumeControlAction(defaults: defaults)
        #expect(navigation.pending?.route == .capture(.transfer))
        #expect(navigation.pending?.draft?.transferAccount == "Savings")
        let requestID = navigation.pending?.id
        navigation.consumeControlAction(defaults: defaults)
        #expect(navigation.pending?.id == requestID)
        navigation.pending = nil
        PendingAppActionStore.enqueueTransactions(filter: .pending, defaults: defaults)
        navigation.consumeControlAction(defaults: defaults)
        #expect(navigation.pending?.route == .filteredTransactions(.pending))
        #expect(navigation.pending?.draft == nil)
    }

}
