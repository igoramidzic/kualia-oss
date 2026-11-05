import Foundation

enum BudgetMoneyEndpoint: Hashable {
    case category(String)
    case readyToAssign

    var id: String {
        switch self {
        case .category(let id): id
        case .readyToAssign: "ready-to-assign"
        }
    }
}

struct BudgetMoneyAccount: Identifiable, Equatable {
    let endpoint: BudgetMoneyEndpoint
    let name: String
    let groupName: String
    let assigned: Int64
    let available: Decimal
    var target: BudgetCategoryTarget? = nil
    var targetNeed: Decimal? {
        target?.targetAmount == nil ? nil : Decimal(max(0, target?.underfundedAmount ?? 0))
    }
    var fundingNeed: Decimal { max(0, targetNeed ?? 0, -available) }
    var id: String { endpoint.id }
}

/// Each selection previews one move. Partial covers continue with fresh balances
/// after that atomic batch is confirmed, retaining Undo for the last move.
struct BudgetMoneyMoveSession: Identifiable {
    enum Direction { case outgoing, incoming, cover }
    enum Phase { case choosing, saving, checking, finished, undoing, checkingUndo, undone }

    let id = UUID()
    let workspaceID: String
    let yearMonth: Int
    let anchor: BudgetMoneyEndpoint
    var accounts: [BudgetMoneyAccount]
    var direction: Direction
    var counterpart: BudgetMoneyEndpoint?
    var calculator: AmountCalculator
    var phase = Phase.choosing
    var isEditingAmount = false
    var errorMessage: String?
    var savedChanges: [BudgetQuickAssignChange] = []
    var savedAmount = Decimal.zero
    var savedSourceName = ""
    var savedDestinationName = ""
    var lastMoveID: UUID?
    var receiptExpiresAt: Date?
    var isClosingReceipt = false
    var didCoverOverspending = false

    init(
        workspaceID: String, yearMonth: Int, anchor: BudgetMoneyEndpoint,
        accounts: [BudgetMoneyAccount], minorUnit: Int
    ) {
        self.workspaceID = workspaceID
        self.yearMonth = yearMonth
        self.anchor = anchor
        self.accounts = accounts
        let available = accounts.first { $0.endpoint == anchor }?.available ?? 0
        direction = available < 0 ? .cover : available > 0 ? .outgoing : .incoming
        calculator = AmountCalculator(amount: 0, minorUnit: minorUnit)
        chooseDefaultAccount()
    }

    var isBusy: Bool {
        phase == .saving || phase == .checking || phase == .undoing || phase == .checkingUndo
    }
    var isResult: Bool { phase == .finished || phase == .undone }
    var isCovering: Bool { direction == .cover }
    var isEnteringAmount: Bool {
        phase == .choosing && !isCovering && isEditingAmount && counterpart != nil
    }
    var anchorAccount: BudgetMoneyAccount? { account(anchor) }
    var source: BudgetMoneyEndpoint? { direction == .outgoing ? anchor : counterpart }
    var destination: BudgetMoneyEndpoint? { direction == .outgoing ? counterpart : anchor }
    var amount: Decimal {
        isCovering ? min(coverNeed, sourceLimit) : Decimal(calculator.amount ?? 0)
    }
    var coverNeed: Decimal { anchorAccount?.fundingNeed ?? 0 }
    var remaining: Decimal { max(0, coverNeed - amount) }
    var sourceLimit: Decimal { max(0, source.flatMap(account)?.available ?? 0) }
    var canApply: Bool { phase == .choosing && changes != nil }

    func account(_ endpoint: BudgetMoneyEndpoint) -> BudgetMoneyAccount? {
        accounts.first { $0.endpoint == endpoint }
    }

    var choices: [BudgetMoneyAccount] {
        accounts.filter {
            $0.endpoint != anchor && (direction == .outgoing || $0.available > 0)
        }
    }

    /// Evaluated with confirmed balances before offering another move.
    var canContinueMoving: Bool {
        guard let anchorAccount, !choices.isEmpty else { return false }
        switch direction {
        case .outgoing:
            return anchorAccount.available > 0
                && (destination.flatMap(account)?.fundingNeed ?? 0) > 0
        case .incoming:
            return anchorAccount.targetNeed != nil
                ? anchorAccount.fundingNeed > 0 : anchorAccount.available <= 0
        case .cover: return coverNeed > 0
        }
    }

    mutating func chooseDefaultAccount() {
        // RTA is an automatic destination only when it needs overassignment covered.
        guard direction != .outgoing || (account(.readyToAssign)?.available ?? 0) < 0 else {
            return
        }
        choose(.readyToAssign)
    }

    mutating func choose(_ endpoint: BudgetMoneyEndpoint) {
        guard phase == .choosing, choices.contains(where: { $0.endpoint == endpoint }) else {
            return
        }
        errorMessage = nil
        counterpart = endpoint
        isEditingAmount = false
        let destinationAccount = destination.flatMap(account)
        let destinationNeed = destinationAccount?.fundingNeed ?? 0
        let suggested =
            destinationAccount?.targetNeed != nil || destinationNeed > 0
            ? min(sourceLimit, destinationNeed) : sourceLimit
        calculator = AmountCalculator(
            amount: Self.int64(suggested) ?? 0, minorUnit: calculator.minorUnit)
    }

    mutating func clearSelection() {
        counterpart = nil
        isEditingAmount = false
        calculator = AmountCalculator(amount: 0, minorUnit: calculator.minorUnit)
    }

    mutating func flipDirection() {
        guard phase == .choosing, !isCovering else { return }
        direction = direction == .outgoing ? .incoming : .outgoing
        clearSelection()
        chooseDefaultAccount()
        errorMessage = nil
    }

    /// A nil plan is never sent: self moves, missing categories, depleted sources,
    /// unfinished expressions, and overflow stay in the review UI.
    var changes: [BudgetQuickAssignChange]? {
        guard anchorAccount != nil, amount > 0,
            isCovering || calculator.amount != nil,
            let source, let destination, source != destination,
            account(destination) != nil, amount <= sourceLimit
        else { return nil }
        let deltas: [BudgetMoneyEndpoint: Decimal] = [source: -amount, destination: amount]
        var changes: [BudgetQuickAssignChange] = []
        for account in accounts {
            guard let delta = deltas[account.endpoint], delta != 0 else { continue }
            guard Self.int64(account.available + delta) != nil, Self.int64(delta) != nil else {
                return nil
            }
            if case .category(let id) = account.endpoint {
                guard let assigned = Self.int64(Decimal(account.assigned) + delta),
                    let available = Self.int64(account.available)
                else { return nil }
                changes.append(
                    .init(
                        id: id, name: account.name, groupName: account.groupName,
                        previousAssigned: account.assigned, assigned: assigned,
                        previousAvailable: available))
            }
        }
        return changes.isEmpty ? nil : changes
    }

    static func int64(_ amount: Decimal) -> Int64? {
        guard amount >= Decimal(Int64.min), amount <= Decimal(Int64.max) else { return nil }
        return NSDecimalNumber(decimal: amount).int64Value
    }
}
