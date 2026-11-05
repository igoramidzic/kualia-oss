import ConvexMobile
import Foundation
import Testing

@testable import Kualia

@Suite(.serialized)
@MainActor
struct AccountReconciliationStoreTests {
    private let workspace = TransactionFeedWorkspace(
        id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
        timezoneIdentifier: "America/New_York")
    private var account: AccountSnapshot {
        .init(
            id: "bank", name: "Checking", accountType: "banking_checking",
            currentBalance: 10000, pendingBalance: -2000, clearedBalance: 12000)
    }

    @Test func startsAtClearedBalanceAndChangesSuggestedBasis() {
        let store = makeStore()
        #expect(store.calculator.amount == 12000)
        #expect(!store.includesPending)
        #expect(store.difference == 0)
        #expect(store.canReconcile)
        store.setIncludesPending(true)
        #expect(store.calculator.amount == 10000)
        #expect(store.difference == 0)
        store.setIncludesPending(false)
        #expect(store.calculator.amount == 12000)
    }

    @Test func editedTargetStaysFixedAsTransactionsAndPendingOptionChange() {
        var liveAccount = account
        let store = makeStore(currentAccount: { liveAccount })
        enter(10500, in: store)
        #expect(store.difference == -1500)
        #expect(store.canReconcile)
        liveAccount = .init(
            id: "bank", name: "Checking", accountType: "banking_checking",
            currentBalance: 10500, pendingBalance: -2000, clearedBalance: 12500)
        #expect(store.calculator.amount == 10500)
        #expect(store.difference == -2000)
        #expect(store.canReconcile)
        store.setIncludesPending(true)
        #expect(store.calculator.amount == 10500)
        #expect(store.difference == 0)
    }

    @Test func finishingAndCancellingEditsKeepTheBalanceAvailableForReconciliation() {
        let store = makeStore()
        store.beginEditing()
        store.finishEditing()
        store.beginEditing()
        var cleared = store.calculator
        cleared.clear()
        store.setCalculator(cleared)
        store.cancelEditing()
        #expect(store.calculator.amount == 12000)
        #expect(store.canReconcile)
    }

    @Test func unfinishedCalculationCannotReconcile() async {
        var calls = 0
        let store = makeStore(mutate: { _ in
            calls += 1
            throw AccountStoreError.saveFailed
        })
        store.beginEditing()
        var incomplete = store.calculator
        incomplete.appendOperation(.add)
        store.setCalculator(incomplete)
        store.finishEditing()
        #expect(!store.canReconcile)
        await store.reconcile()
        #expect(calls == 0)
    }

    @Test func supportsSignedBalancesAndLegacyClearedFallback() {
        let legacy = AccountSnapshot(
            id: "bank", name: "Card", accountType: "credit_credit_card",
            currentBalance: -10000, pendingBalance: -2000)
        let store = makeStore(currentAccount: { legacy })
        #expect(store.comparisonBalance == -8000)
        #expect(store.calculator.amount == -8000)
        store.beginEditing()
        store.changeSign()
        store.finishEditing()
        #expect(store.calculator.amount == 8000)
        #expect(store.difference == 16000)
    }

    @Test func confirmsExactBalanceWithWorkspaceDateAndExplicitNoAdjustment() async throws {
        var request: AccountReconciliationRequest?
        let store = makeStore(mutate: {
            request = $0
            return Self.success()
        })
        await store.reconcile()
        let sent = try #require(request)
        #expect(sent.reportedBalance == 12000)
        #expect(sent.expectedBalance == 12000)
        #expect(!sent.includePending)
        #expect(!sent.allowsAdjustment)
        #expect(sent.date == "2026-09-10")
        #expect(sent.accountID == "bank")
        #expect(sent.workspaceID == workspace.id)
        #expect(store.result?.success == true)
        #expect(!store.canReconcile)
        #expect(
            try sent.arguments["reportedBalance"]??.convexEncode() == Int64(12000).convexEncode())
    }

    @Test func reconcileUsesTheDisplayedAdjustmentAndSelectedBalanceBasis() async throws {
        var requests: [AccountReconciliationRequest] = []
        let store = makeStore(mutate: {
            requests.append($0)
            return Self.success()
        })
        store.setIncludesPending(true)
        enter(10500, in: store)
        await store.reconcile()
        let sent = try #require(requests.first)
        #expect(sent.allowsAdjustment)
        #expect(sent.includePending)
        #expect(sent.expectedBalance == 10000)
        #expect(sent.reportedBalance == 10500)
    }

    @Test func failuresKeepTheDraftAndPermitRetry() async {
        var attempts = 0
        let store = makeStore(mutate: { _ in
            attempts += 1
            if attempts == 1 { throw AccountStoreError.saveFailed }
            return Self.success()
        })
        enter(10500, in: store)
        await store.reconcile()
        #expect(store.result == nil)
        #expect(store.errorMessage != nil)
        #expect(store.calculator.amount == 10500)
        await store.reconcile()
        #expect(store.result?.success == true)
        #expect(store.errorMessage == nil)
    }

    @Test func duplicateSubmitAndStaleWorkspaceCompletionAreIgnored() async throws {
        var available = true
        var calls = 0
        var continuation: CheckedContinuation<AccountReconciliationResult, Error>?
        let store = makeStore(
            isAvailable: { available },
            mutate: { _ in
                calls += 1
                return try await withCheckedThrowingContinuation { continuation = $0 }
            })
        let save = Task { await store.reconcile() }
        for _ in 0..<100 where continuation == nil { await Task.yield() }
        let pending = try #require(continuation)
        #expect(store.isSaving)
        await store.reconcile()
        #expect(calls == 1)
        available = false
        pending.resume(returning: Self.success())
        await save.value
        #expect(store.result == nil)
        #expect(!store.canReconcile)
        #expect(!store.isSaving)
    }

    @Test func closedAndRemovedAccountsCannotReconcile() async {
        var live: AccountSnapshot? = account
        let store = makeStore(currentAccount: { live })
        live?.isClosed = true
        #expect(!store.canReconcile)
        live = nil
        #expect(!store.canUseAccount)
    }

    @Test func overflowingDifferenceDoesNotTrapOrAllowAdjustment() {
        let extreme = AccountSnapshot(
            id: "bank", name: "Account", accountType: "banking_checking", currentBalance: .min)
        let store = makeStore(currentAccount: { extreme })
        enter(.max, in: store)
        #expect(store.difference == Decimal(Int64.max) - Decimal(Int64.min))
        #expect(!store.canReconcile)
    }

    @Test func pendingTogglePreservesAnAmountStillBeingEntered() {
        let store = makeStore()
        store.beginEditing()
        var input = store.calculator
        input.appendDigit(5)
        store.setCalculator(input)
        store.setIncludesPending(true)
        #expect(store.calculator.amount == 5)
        #expect(store.difference == -9995)
        #expect(store.canReconcile)
        store.setIncludesPending(false)
        #expect(store.calculator.amount == 5)
        #expect(store.difference == -11995)
    }

    @Test func pendingToggleDoesNotDiscardAnUnfinishedCalculation() {
        let store = makeStore()
        store.beginEditing()
        var input = store.calculator
        input.appendOperation(.add)
        store.setCalculator(input)
        store.setIncludesPending(true)
        #expect(store.calculator.expression == input.expression)
        #expect(store.difference == nil)
        #expect(!store.canReconcile)
    }

    @Test func cancellingUntouchedInputUsesTheSelectedPendingBasis() {
        let store = makeStore()
        store.beginEditing()
        store.setIncludesPending(true)
        store.cancelEditing()
        #expect(store.includesPending)
        #expect(store.calculator.amount == 10000)
        #expect(store.difference == 0)
    }

    @Test func doneDoesNotReconcileAndThePeekCanSubmitWhileTheNumpadIsOpen() async throws {
        var requests: [AccountReconciliationRequest] = []
        let store = makeStore(mutate: {
            requests.append($0)
            return Self.success()
        })
        enter(10500, in: store)
        #expect(requests.isEmpty)
        #expect(store.canReconcile)
        store.beginEditing()
        store.setCalculator(
            AmountCalculator(amount: 11000, minorUnit: 2, allowsNegativeAmounts: true))
        // Reconcile is independent of the numpad's Done action.
        await store.reconcile()
        #expect(requests.count == 1)
        let sent = try #require(requests.first)
        #expect(sent.reportedBalance == 11000)
        #expect(sent.allowsAdjustment)
    }

    private func enter(_ amount: Int64, in store: AccountReconciliationStore) {
        store.beginEditing()
        store.setCalculator(
            AmountCalculator(
                amount: amount, minorUnit: 2, allowsNegativeAmounts: true))
        store.finishEditing()
    }
    private static func success() -> AccountReconciliationResult {
        .init(
            success: true, adjustmentCreated: false, balanceAdjustmentAmount: 0,
            reconciledAt: "2026-09-11T01:00:00.000Z")
    }
    private func makeStore(
        currentAccount: (() -> AccountSnapshot?)? = nil,
        isAvailable: @escaping () -> Bool = { true },
        mutate: @escaping AccountReconciliationStore.Mutation = { _ in Self.success() }
    ) -> AccountReconciliationStore {
        let currentAccount = currentAccount ?? { account }
        return AccountReconciliationStore(
            account: currentAccount() ?? account, workspace: workspace,
            currentAccount: currentAccount, isAvailable: isAvailable,
            now: { ISO8601DateFormatter().date(from: "2026-09-11T01:00:00Z")! }, mutate: mutate)
    }
}
