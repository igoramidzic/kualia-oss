import ConvexMobile
import Foundation
import Observation

struct AccountReconciliationRequest {
    let workspaceID: String
    let accountID: String
    let reportedBalance: Int64
    let expectedBalance: Int64
    let includePending: Bool
    let allowsAdjustment: Bool
    let date: String

    var arguments: [String: ConvexEncodable?] {
        [
            "workspaceId": workspaceID, "bankAccountId": accountID,
            "reportedBalance": reportedBalance, "expectedBalance": expectedBalance,
            "includePending": includePending, "allowBalanceAdjustment": allowsAdjustment,
            "reconciliationDate": date,
        ]
    }
}

struct AccountReconciliationResult: Decodable {
    let success: Bool
    let adjustmentCreated: Bool
    @ConvexInt var balanceAdjustmentAmount: Int64
    let reconciledAt: String
}

@MainActor
@Observable
final class AccountReconciliationStore {
    typealias Mutation = (AccountReconciliationRequest) async throws -> AccountReconciliationResult

    let workspace: TransactionFeedWorkspace
    let accountID: String
    private(set) var calculator: AmountCalculator
    private(set) var includesPending = false
    private(set) var isSaving = false
    private(set) var result: AccountReconciliationResult?
    var errorMessage: String?
    @ObservationIgnored private let currentAccount: () -> AccountSnapshot?
    @ObservationIgnored private let isAvailable: () -> Bool
    @ObservationIgnored private let mutate: Mutation
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var editingSnapshot: EditingSnapshot?
    private var hasEnteredBalance = false

    private struct EditingSnapshot {
        let calculator: AmountCalculator
        let hasEnteredBalance: Bool
    }

    init(
        account: AccountSnapshot, workspace: TransactionFeedWorkspace,
        currentAccount: @escaping () -> AccountSnapshot?, isAvailable: @escaping () -> Bool,
        now: @escaping () -> Date = Date.init, mutate: @escaping Mutation
    ) {
        accountID = account.id
        self.workspace = workspace
        self.currentAccount = currentAccount
        self.isAvailable = isAvailable
        self.now = now
        self.mutate = mutate
        calculator = AmountCalculator(
            amount: Self.exactAmount(account.resolvedClearedBalance) ?? account.currentBalance,
            minorUnit: workspace.minorUnit,
            allowsNegativeAmounts: true)
    }

    var account: AccountSnapshot? { isAvailable() ? currentAccount() : nil }
    var canUseAccount: Bool {
        guard let account else { return false }
        return !account.isDeleted && !account.isClosed
    }
    var comparisonBalance: Decimal? {
        guard let account else { return nil }
        if includesPending { return Decimal(account.currentBalance) }
        return account.resolvedClearedBalance
    }
    var difference: Decimal? {
        guard let amount = calculator.amount, let comparisonBalance else { return nil }
        return Decimal(amount) - comparisonBalance
    }
    var canReconcile: Bool {
        guard canUseAccount, !isSaving, result == nil, let difference else { return false }
        return Self.exactAmount(difference) != nil
            && comparisonBalance.flatMap(Self.exactAmount) != nil
    }

    func setIncludesPending(_ value: Bool) {
        guard !isSaving, result == nil else { return }
        includesPending = value
        updateSuggestedBalance()
        errorMessage = nil
    }

    private func updateSuggestedBalance() {
        // Before entering a bank balance, changing its basis updates the suggested value.
        // Once entered, the bank's target stays fixed as transactions and settings change.
        if !hasEnteredBalance, let balance = comparisonBalance.flatMap(Self.exactAmount) {
            calculator = AmountCalculator(
                amount: balance, minorUnit: workspace.minorUnit, allowsNegativeAmounts: true)
        }
    }

    func setCalculator(_ value: AmountCalculator) {
        guard !isSaving, result == nil else { return }
        if value.expression != calculator.expression { hasEnteredBalance = true }
        calculator = value
        errorMessage = nil
    }

    func beginEditing() {
        editingSnapshot = EditingSnapshot(
            calculator: calculator, hasEnteredBalance: hasEnteredBalance)
    }
    func cancelEditing() {
        if let editingSnapshot {
            calculator = editingSnapshot.calculator
            hasEnteredBalance = editingSnapshot.hasEnteredBalance
        }
        updateSuggestedBalance()
        editingSnapshot = nil
        errorMessage = nil
    }
    func finishEditing() {
        guard calculator.amount != nil else { return }
        calculator.resolve()
        editingSnapshot = nil
        errorMessage = nil
    }
    func changeSign() {
        guard let amount = calculator.amount, amount != Int64.min else { return }
        setCalculator(
            AmountCalculator(
                amount: -amount, minorUnit: workspace.minorUnit, allowsNegativeAmounts: true))
    }

    func reconcile() async {
        guard canReconcile,
            let reportedBalance = calculator.amount,
            let expectedBalance = comparisonBalance.flatMap(Self.exactAmount)
        else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let response = try await mutate(
                .init(
                    workspaceID: workspace.id, accountID: accountID,
                    reportedBalance: reportedBalance, expectedBalance: expectedBalance,
                    includePending: includesPending,
                    allowsAdjustment: reportedBalance != expectedBalance,
                    date: TransactionEditorDate.today(workspace: workspace, now: now())))
            guard isAvailable() else { return }
            guard response.success else { throw AccountStoreError.saveFailed }
            result = response
        } catch {
            guard isAvailable() else { return }
            errorMessage = L10n.string(
                "Reconciliation couldn't finish. Check the latest balance and try again.")
        }
    }

    private static func exactAmount(_ value: Decimal) -> Int64? {
        guard value >= Decimal(Int64.min), value <= Decimal(Int64.max) else { return nil }
        return NSDecimalNumber(decimal: value).int64Value
    }
}
