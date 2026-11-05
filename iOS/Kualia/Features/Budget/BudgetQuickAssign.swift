import Foundation

/// The eight existing budget strategies, presented independently of either legacy client.
enum BudgetQuickAssignOption: String, CaseIterable, Identifiable {
    case underfunded, reduceOverfunding, assignedLastMonth, spentLastMonth
    case averageAssigned, averageSpent, zeroAssigned, zeroAvailable

    var id: String { rawValue }

    var title: String {
        switch self {
        case .underfunded: L10n.string("Cover underfunded")
        case .reduceOverfunding: L10n.string("Reduce overfunding")
        case .assignedLastMonth: L10n.string("Assigned last month")
        case .spentLastMonth: L10n.string("Spent last month")
        case .averageAssigned: L10n.string("Average assigned")
        case .averageSpent: L10n.string("Average spent")
        case .zeroAssigned: L10n.string("Set assigned to zero")
        case .zeroAvailable: L10n.string("Set available to zero")
        }
    }

    var detail: String {
        switch self {
        case .underfunded: L10n.string("Fill target gaps and cover overspending.")
        case .reduceOverfunding: L10n.string("Bring extra target funding back to Ready to Assign.")
        case .assignedLastMonth: L10n.string("Match what you assigned in the last completed month.")
        case .spentLastMonth: L10n.string("Use spending from the last completed month.")
        case .averageAssigned: L10n.string("Match your average across completed months.")
        case .averageSpent: L10n.string("Use your average spending across completed months.")
        case .zeroAssigned: L10n.string("Clear this month's assignments.")
        case .zeroAvailable: L10n.string("Move available balances to or from Ready to Assign.")
        }
    }
}

enum BudgetUnderfundedOrder: String, CaseIterable, Identifiable {
    case dueDate, smallestAmount

    static let defaultsKey = "budget.quickAssign.underfundedOrder"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .dueDate: L10n.string("Earliest due date")
        case .smallestAmount: L10n.string("Smallest First")
        }
    }
    var detail: String {
        switch self {
        case .dueDate: L10n.string("Fund targets due soonest, then categories without a due date.")
        case .smallestAmount:
            L10n.string("Fill the smallest remaining gaps to fully fund more categories.")
        }
    }
}

struct BudgetQuickAssignCategory: Equatable {
    let id: String
    let name: String
    let groupName: String
    let assigned: Int64
    let available: Int64
    let underfunded: Int64
    let overfunded: Int64
    var history: [Int: History] = [:]
    var dueDate: String?

    struct History: Equatable {
        let assigned: Int64
        let activity: Int64
    }
}

struct BudgetQuickAssignChange: Identifiable, Equatable {
    let id: String
    let name: String
    let groupName: String
    let previousAssigned: Int64
    let assigned: Int64
    let previousAvailable: Int64

    var delta: Decimal { Decimal(assigned) - Decimal(previousAssigned) }
    var available: Decimal { Decimal(previousAvailable) + delta }
}

struct BudgetQuickAssignPlan: Equatable {
    let changes: [BudgetQuickAssignChange]
    let readyToAssignBefore: Decimal
    let unfilledAmount: Decimal
    let errorMessage: String?
    var previewChanges: [BudgetQuickAssignChange] = []

    var assignedAmount: Decimal { changes.reduce(0) { $0 + max(0, $1.delta) } }
    var returnedAmount: Decimal { changes.reduce(0) { $0 + max(0, -$1.delta) } }
    var readyToAssignAfter: Decimal { readyToAssignBefore - assignedAmount + returnedAmount }
    var canApply: Bool { !changes.isEmpty && errorMessage == nil }

    /// Release money first, then fund in the selected priority order. Decimal intermediates
    /// preserve cents and prevent Int64 overflow; only validated integers reach the API.
    static func make(
        option: BudgetQuickAssignOption, categories: [BudgetQuickAssignCategory],
        currentMonth: Int, readyToAssign: Decimal, allowsNegativeRTA: Bool,
        underfundedOrder: BudgetUnderfundedOrder = .dueDate,
        excludedCategoryIDs: Set<String> = []
    ) -> Self {
        let previousMonth = currentMonth % 100 == 1 ? currentMonth - 89 : currentMonth - 1
        let desired = categories.map { category -> Decimal in
            let history = category.history.filter { $0.key < currentMonth }.map(\.value)
            switch option {
            case .underfunded:
                return Decimal(category.assigned)
                    + max(0, Decimal(category.underfunded), -Decimal(category.available))
            case .reduceOverfunding:
                return Decimal(category.assigned)
                    - min(max(0, Decimal(category.overfunded)), max(0, Decimal(category.available)))
            case .assignedLastMonth:
                return Decimal(category.history[previousMonth]?.assigned ?? category.assigned)
            case .spentLastMonth:
                guard let previous = category.history[previousMonth] else {
                    return Decimal(category.assigned)
                }
                return max(0, -Decimal(previous.activity))
            case .averageAssigned, .averageSpent:
                guard !history.isEmpty else { return Decimal(category.assigned) }
                let total = history.reduce(Decimal.zero) { total, month in
                    total
                        + (option == .averageAssigned
                            ? Decimal(month.assigned) : max(0, -Decimal(month.activity)))
                }
                var average = total / Decimal(history.count)
                var rounded = Decimal.zero
                NSDecimalRound(&rounded, &average, 0, average < 0 ? .up : .down)
                return rounded
            case .zeroAssigned: return 0
            case .zeroAvailable: return Decimal(category.assigned) - Decimal(category.available)
            }
        }
        let released = zip(categories, desired).reduce(Decimal.zero) { total, pair in
            total
                + (excludedCategoryIDs.contains(pair.0.id)
                    ? 0 : max(0, Decimal(pair.0.assigned) - pair.1))
        }
        var remaining = readyToAssign + released
        var unfilled = Decimal.zero
        var changes: [BudgetQuickAssignChange] = []
        var previewChanges: [BudgetQuickAssignChange] = []
        let fundingOrder = categories.indices.sorted { left, right in
            guard option == .underfunded else { return left < right }
            switch underfundedOrder {
            case .dueDate:
                let leftDate = categories[left].dueDate
                let rightDate = categories[right].dueDate
                if leftDate != rightDate {
                    guard let leftDate else { return false }
                    guard let rightDate else { return true }
                    return leftDate < rightDate
                }
            case .smallestAmount:
                let leftGap = desired[left] - Decimal(categories[left].assigned)
                let rightGap = desired[right] - Decimal(categories[right].assigned)
                if leftGap != rightGap { return leftGap < rightGap }
            }
            // Keep the user's category order when due dates or gaps are equal.
            return left < right
        }
        for index in fundingOrder {
            let category = categories[index]
            let delta = desired[index] - Decimal(category.assigned)
            let appliedDelta: Decimal
            if excludedCategoryIDs.contains(category.id) {
                appliedDelta = 0
            } else if delta > 0, !allowsNegativeRTA {
                appliedDelta = min(delta, max(0, remaining))
                unfilled += delta - appliedDelta
            } else {
                appliedDelta = delta
            }
            if appliedDelta > 0 { remaining -= appliedDelta }
            let amount = Decimal(category.assigned) + appliedDelta
            guard amount >= Decimal(Int64.min), amount <= Decimal(Int64.max),
                appliedDelta >= Decimal(Int64.min), appliedDelta <= Decimal(Int64.max)
            else { return invalid(readyToAssign) }
            let change = BudgetQuickAssignChange(
                id: category.id, name: category.name, groupName: category.groupName,
                previousAssigned: category.assigned,
                assigned: NSDecimalNumber(decimal: amount).int64Value,
                previousAvailable: category.available)
            if delta != 0 { previewChanges.append(change) }
            if appliedDelta != 0 { changes.append(change) }
        }
        let plan = Self(
            changes: changes, readyToAssignBefore: readyToAssign,
            unfilledAmount: unfilled, errorMessage: nil, previewChanges: previewChanges)
        guard plan.readyToAssignAfter >= Decimal(Int64.min),
            plan.readyToAssignAfter <= Decimal(Int64.max)
        else { return invalid(readyToAssign) }
        return plan
    }

    private static func invalid(_ readyToAssign: Decimal) -> Self {
        .init(
            changes: [], readyToAssignBefore: readyToAssign, unfilledAmount: 0,
            errorMessage: L10n.string("These changes would exceed the supported budget amount."))
    }
}

/// One completed batch can be reversed briefly after returning to the budget.
struct BudgetQuickAssignUndo: Identifiable {
    enum Phase { case available, saving, checking }
    let id = UUID()
    let workspaceID: String
    let yearMonth: Int
    let changes: [BudgetQuickAssignChange]
    let expiresAt: Date
    var phase = Phase.available

    var isBusy: Bool { phase != .available }
}

struct BudgetQuickAssignSession: Identifiable {
    enum Phase { case reviewing, saving, checking, finished }
    let id = UUID()
    let workspaceID: String
    let yearMonth: Int
    var option: BudgetQuickAssignOption
    var plan: BudgetQuickAssignPlan
    var isChoosingOption = true
    var allowsNegativeRTA = false
    var excludedCategoryIDs: Set<String> = []
    var phase = Phase.reviewing
    var errorMessage: String?

    var isBusy: Bool { phase == .saving || phase == .checking }
}
