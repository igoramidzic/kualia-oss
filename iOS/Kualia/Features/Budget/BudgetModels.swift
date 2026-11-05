import ConvexMobile
import CoreGraphics
import Foundation

struct BudgetWorkspace: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let currencyCode: String
    let minorUnit: Int
    let timezoneIdentifier: String?
}

struct BudgetStructure: Decodable {
    let workspace: BudgetWorkspace?
    let categoryGroups: [BudgetCategoryGroup]
}

struct BudgetCategoryGroup: Decodable, Identifiable, Equatable {
    struct Details: Decodable, Equatable {
        let _id: String
        let name: String
        let type: String
        var isSystemGroup: Bool? = nil
    }

    let categoryGroup: Details
    let categories: [BudgetCategory]
    var id: String { categoryGroup._id }
}

struct BudgetCategory: Decodable, Identifiable, Equatable {
    let _id: String
    let name: String
    let iconName: String?
    let type: String
    var isArchived: Bool? = nil
    var isSystemCategory: Bool? = nil
    var id: String { _id }
}

/// Target funding comes from the same backend calculation used by the other clients.
struct BudgetCategoryTarget: Decodable, Equatable {
    let targetAmount: Int64?
    let assignmentNeeded: Int64?
    let remainingToAssign: Int64?
    let underfundedAmount: Int64
    let isSnoozed: Bool
    let overfundedByAmount: Int64
    let dueDate: String?
    let fundedRatio: Double
    let spentRatio: Double
    let cumulativeAssigned: Int64?
    let cumulativeTargetNeeded: Int64?

    var hasUnmetTarget: Bool {
        targetAmount != nil && !isSnoozed && underfundedAmount > 0
    }

    init(
        targetAmount: Int64? = nil, underfundedAmount: Int64 = 0, isSnoozed: Bool = false,
        overfundedByAmount: Int64 = 0, dueDate: String? = nil,
        assignmentNeeded: Int64? = nil, remainingToAssign: Int64? = nil,
        fundedRatio: Double = 0, spentRatio: Double = 0,
        cumulativeAssigned: Int64? = nil, cumulativeTargetNeeded: Int64? = nil
    ) {
        self.targetAmount = targetAmount
        self.assignmentNeeded = assignmentNeeded
        self.remainingToAssign = remainingToAssign
        self.underfundedAmount = underfundedAmount
        self.isSnoozed = isSnoozed
        self.overfundedByAmount = overfundedByAmount
        self.dueDate = dueDate
        self.fundedRatio = fundedRatio
        self.spentRatio = spentRatio
        self.cumulativeAssigned = cumulativeAssigned
        self.cumulativeTargetNeeded = cumulativeTargetNeeded
    }

    private enum CodingKeys: String, CodingKey {
        case targetAmount, assignmentNeeded, remainingToAssign, underfundedAmount, isSnoozed
        case overfundedByAmount, dueDate, fundedRatio, spentRatio
        case cumulativeAssigned, cumulativeTargetNeeded
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        targetAmount =
            try container.decodeIfPresent(ConvexInt.self, forKey: .targetAmount)?.wrappedValue
        assignmentNeeded =
            try container.decodeIfPresent(ConvexInt.self, forKey: .assignmentNeeded)?.wrappedValue
        remainingToAssign =
            try container.decodeIfPresent(ConvexInt.self, forKey: .remainingToAssign)?.wrappedValue
        underfundedAmount =
            try container.decodeIfPresent(ConvexInt.self, forKey: .underfundedAmount)?.wrappedValue
            ?? 0
        overfundedByAmount =
            try container.decodeIfPresent(ConvexInt.self, forKey: .overfundedByAmount)?.wrappedValue
            ?? 0
        isSnoozed = try container.decodeIfPresent(Bool.self, forKey: .isSnoozed) ?? false
        dueDate = try container.decodeIfPresent(String.self, forKey: .dueDate)
        fundedRatio = try container.decodeIfPresent(Double.self, forKey: .fundedRatio) ?? 0
        spentRatio = try container.decodeIfPresent(Double.self, forKey: .spentRatio) ?? 0
        cumulativeAssigned =
            try container.decodeIfPresent(ConvexInt.self, forKey: .cumulativeAssigned)?.wrappedValue
        cumulativeTargetNeeded =
            try container.decodeIfPresent(ConvexInt.self, forKey: .cumulativeTargetNeeded)?
            .wrappedValue
    }

    func fundingStatus(assignmentDelta: Decimal = 0) -> BudgetTargetFundingStatus {
        if isSnoozed { return .snoozed }
        guard targetAmount != nil else { return .noTarget }
        let baseline =
            underfundedAmount > 0
            ? Decimal(underfundedAmount) : -Decimal(max(0, overfundedByAmount))
        return baseline - assignmentDelta > 0 ? .underfunded : .funded
    }

    /// Project only this month's contribution against the backend's monthly requirement.
    /// Extra assignment must be removed before a fully funded target needs more money.
    func remainingFunding(assigned: Int64, assignmentDelta: Decimal) -> Decimal? {
        guard !isSnoozed, targetAmount != nil,
            let assignmentNeeded, assignmentNeeded > 0, let remainingToAssign
        else { return nil }
        let baseline =
            remainingToAssign > 0
            ? Decimal(remainingToAssign) : min(0, Decimal(assignmentNeeded) - Decimal(assigned))
        return max(0, baseline - assignmentDelta)
    }

    func fundingSummary(assigned: Int64, assignmentDelta: Decimal = 0)
        -> BudgetTargetFundingSummary?
    {
        guard !isSnoozed, targetAmount != nil, let assignmentNeeded,
            let remainingToAssign, assignmentNeeded >= 0
        else { return nil }
        let total = Decimal(assignmentNeeded)
        let remaining =
            remainingFunding(assigned: assigned, assignmentDelta: assignmentDelta)
            ?? max(0, Decimal(remainingToAssign))
        return .init(funded: total - remaining, remaining: remaining, total: total)
    }
}

/// Server amounts remain authoritative; the extra inputs let assignment previews stay local.
struct BudgetCategoryAmounts: Decodable, Equatable {
    let assignedAmount: Int64
    let available: Int64
    let activity: Int64
    let target: BudgetCategoryTarget?
    let carryoverFromPrevious: Int64?
    let totalSpent: Int64?
    let outflowAmount: Int64?
    let fundedSpending: Int64?

    init(
        assignedAmount: Int64 = 0, available: Int64 = 0, activity: Int64 = 0,
        target: BudgetCategoryTarget? = nil, carryoverFromPrevious: Int64? = nil,
        totalSpent: Int64? = nil, outflowAmount: Int64? = nil, fundedSpending: Int64? = nil
    ) {
        self.assignedAmount = assignedAmount
        self.available = available
        self.activity = activity
        self.target = target
        self.carryoverFromPrevious = carryoverFromPrevious
        self.totalSpent = totalSpent
        self.outflowAmount = outflowAmount
        self.fundedSpending = fundedSpending
    }

    private enum CodingKeys: String, CodingKey {
        case assignedAmount, available, activity, target
        case carryoverFromPrevious, totalSpent, outflowAmount, fundedSpending
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        assignedAmount = try container.decode(ConvexInt.self, forKey: .assignedAmount).wrappedValue
        available = try container.decode(ConvexInt.self, forKey: .available).wrappedValue
        activity =
            try container.decodeIfPresent(ConvexInt.self, forKey: .activity)?.wrappedValue ?? 0
        target = try container.decodeIfPresent(BudgetCategoryTarget.self, forKey: .target)
        carryoverFromPrevious =
            try container.decodeIfPresent(ConvexInt.self, forKey: .carryoverFromPrevious)?
            .wrappedValue
        totalSpent = try container.decodeIfPresent(ConvexInt.self, forKey: .totalSpent)?
            .wrappedValue
        outflowAmount = try container.decodeIfPresent(ConvexInt.self, forKey: .outflowAmount)?
            .wrappedValue
        fundedSpending = try container.decodeIfPresent(ConvexInt.self, forKey: .fundedSpending)?
            .wrappedValue
    }
}

/// The label and write share the same exact amount, including overspending without a target.
struct BudgetCategoryAssignment {
    enum Purpose { case target, spending, setTarget }
    let amount: Decimal
    let purpose: Purpose

    var isEnabled: Bool { purpose == .setTarget || amount > 0 }

    init(amounts: BudgetCategoryAmounts) {
        let hasTarget = amounts.target?.targetAmount != nil
        let targetNeed = hasTarget ? Decimal(max(0, amounts.target?.underfundedAmount ?? 0)) : 0
        let spendingNeed = max(0, -Decimal(amounts.available))
        amount = max(targetNeed, spendingNeed)
        // The reported target shortfall can include overspending after the target is met.
        purpose =
            spendingNeed > 0 && spendingNeed >= targetNeed
            ? .spending : hasTarget ? .target : .setTarget
    }

    @MainActor
    func title(currencyCode: String, minorUnit: Int, locale: Locale = L10n.locale) -> String {
        guard purpose != .setTarget else { return L10n.string("Set a target") }
        guard amount > 0 else { return L10n.string("Fully funded") }
        let formatted = MoneyAmountFormatter.string(
            decimalMinorUnits: amount, currencyCode: currencyCode, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
        return purpose == .spending
            ? L10n.string("Assign \(formatted) to cover overspending")
            : L10n.string("Assign \(formatted) to hit target")
    }
}

struct BudgetMonthSnapshot: Decodable {
    let yearMonth: Int
    let budgetData: [String: BudgetCategoryAmounts]
    var summary: BudgetPlanSummary? = nil
}

/// Convex totals the monthly target requirements, independently of money already assigned.
struct BudgetPlanSummary: Decodable {
    @ConvexInt var totalTargetAmount: Int64
    let totalFunded: Int64?
    let totalRemainingToFund: Int64?

    init(
        totalTargetAmount: Int64, totalFunded: Int64? = nil,
        totalRemainingToFund: Int64? = nil
    ) {
        _totalTargetAmount = ConvexInt(wrappedValue: totalTargetAmount)
        self.totalFunded = totalFunded
        self.totalRemainingToFund = totalRemainingToFund
    }

    private enum CodingKeys: String, CodingKey {
        case totalTargetAmount, totalFunded, totalRemainingToFund
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        _totalTargetAmount = try container.decode(ConvexInt.self, forKey: .totalTargetAmount)
        totalFunded =
            try container.decodeIfPresent(ConvexInt.self, forKey: .totalFunded)?.wrappedValue
        totalRemainingToFund =
            try container.decodeIfPresent(ConvexInt.self, forKey: .totalRemainingToFund)?
            .wrappedValue
    }
}

struct BudgetTargetFundingSummary: Equatable {
    let funded: Decimal
    let remaining: Decimal
    let total: Decimal

    var isFullyFunded: Bool { total > 0 && remaining == 0 }

    var progress: Double {
        guard total > 0 else { return 1 }
        return min(1, max(0, NSDecimalNumber(decimal: funded / total).doubleValue))
    }

    var percentage: Int {
        guard total > 0 else { return 100 }
        var scaled = min(100, max(0, funded * 100 / total))
        var rounded = Decimal.zero
        NSDecimalRound(&rounded, &scaled, 0, .down)
        return NSDecimalNumber(decimal: rounded).intValue
    }
}

/// Spending beyond a category's monthly target is tracked separately, even after it is covered.
struct BudgetMonthlyFundingSummary: Equatable {
    let targets: BudgetTargetFundingSummary
    var extraFunded: Decimal = 0
    var extraRemaining: Decimal = 0

    var extraTotal: Decimal { extraFunded + extraRemaining }
    var funded: Decimal { targets.funded + extraFunded }
    var remaining: Decimal { targets.remaining + extraRemaining }
    var total: Decimal { targets.total + extraTotal }
    var isFullyFunded: Bool { total > 0 && remaining == 0 }
    var percentage: Int {
        BudgetTargetFundingSummary(funded: funded, remaining: remaining, total: total).percentage
    }

    var progress: Double {
        guard total > 0 else { return 0 }
        return BudgetTargetFundingSummary(
            funded: funded, remaining: remaining, total: total
        ).progress
    }

    mutating func includeSpending(
        assigned: Decimal, available: Decimal, target: BudgetTargetFundingSummary?
    ) {
        // Target contributions also cover overspending in the same category. Count only the excess.
        let remaining = max(0, -available - (target?.remaining ?? 0))
        // Assigned minus available is spending net of carryover, stable while money is assigned.
        let total = max(remaining, assigned - available - (target?.total ?? 0))
        extraRemaining += remaining
        extraFunded += max(0, total - remaining)
    }
}

struct BudgetMonthRange: Decodable, Equatable {
    let minYearMonth: Int
    let maxYearMonth: Int
}

struct BudgetSnapshot: Decodable {
    let months: [BudgetMonthSnapshot]
    let availableRange: BudgetMonthRange
    @ConvexInt var readyToAssign: Int64

    init(months: [BudgetMonthSnapshot], availableRange: BudgetMonthRange, readyToAssign: Int64) {
        self.months = months
        self.availableRange = availableRange
        _readyToAssign = ConvexInt(wrappedValue: readyToAssign)
    }
}

struct BudgetAssignmentKey: Hashable {
    let workspaceID: String
    let yearMonth: Int
    let categoryID: String
}

struct BudgetAssignmentEditor: Identifiable {
    let id = UUID()
    let key: BudgetAssignmentKey
    let categoryName: String
    let assignedAmount: Int64
    let currencyCode: String
    let minorUnit: Int
}

struct BudgetAssignmentRequest {
    let key: BudgetAssignmentKey
    let assignedAmount: Int64

    var arguments: [String: ConvexEncodable?] {
        [
            "workspaceId": key.workspaceID,
            "categoryId": key.categoryID,
            "yearMonth": Int64(key.yearMonth),
            "assignedAmount": assignedAmount,
        ]
    }
}

struct BudgetAssignmentResult: Decodable {
    let success: Bool
}

struct BudgetTargetSnoozeRequest {
    let key: BudgetAssignmentKey
    let snoozed: Bool

    var arguments: [String: ConvexEncodable?] {
        [
            "workspaceId": key.workspaceID, "categoryId": key.categoryID,
            "yearMonth": Double(key.yearMonth), "snoozed": snoozed,
        ]
    }
}

enum BudgetCategoryMenuAction: String, Identifiable {
    case snoozeTarget, resumeTarget, editCategory, editTarget, setTarget

    var id: String { rawValue }
    var title: String {
        switch self {
        case .snoozeTarget: L10n.string("Snooze target for this month")
        case .resumeTarget: L10n.string("Resume target for this month")
        case .editCategory: L10n.string("Edit category")
        case .editTarget: L10n.string("Edit target")
        case .setTarget: L10n.string("Set target")
        }
    }
}

struct BudgetQuickAssignRequest {
    let workspaceID: String
    let yearMonth: Int
    let changes: [BudgetQuickAssignChange]

    var arguments: [String: ConvexEncodable?] {
        [
            "workspaceId": workspaceID,
            "yearMonth": Double(yearMonth),
            "updates": changes.map { change -> ConvexEncodable? in
                ["categoryId": change.id, "assignedAmount": change.assigned]
                    as [String: ConvexEncodable?]
            },
        ]
    }
}

struct BudgetCategoryRowModel: Identifiable, Equatable {
    let id: String
    let name: String
    let isCreditCard: Bool
    let assigned: Int64
    let available: Decimal
    let activity: Int64
    let isPending: Bool
    var hasUnmetTarget = false
    var targetFundingStatus = BudgetTargetFundingStatus.noTarget
    var progress = BudgetCategoryProgress()
    var funding = BudgetCategoryFunding()
    var extraFunded: Decimal = 0

    var hasTarget: Bool { targetFundingStatus != .noTarget }
    var isTargetSnoozed: Bool { targetFundingStatus == .snoozed }

    var availabilityStatus: BudgetAvailabilityStatus {
        if available < 0 { return .overspent }
        if hasUnmetTarget { return .underfunded }
        if available > 0 { return .available }
        return .empty
    }
}

/// Keep the server snapshot so captions follow committed assignments, including rollback.
/// Target settings are resolved by the row because they load independently of budget amounts.
struct BudgetCategoryFunding: Equatable {
    enum Status: Equatable {
        case overspent(Decimal)
        case extraFunded(Decimal)
        case fullyFunded(Decimal)
        case onTrack, snoozed
        case needed(Decimal)
        case neededThisMonth(Decimal)
        case neededBy(Decimal, Date)

        @MainActor
        func title(currencyCode: String, minorUnit: Int, locale: Locale = L10n.locale) -> String {
            func money(_ amount: Decimal) -> String {
                MoneyAmountFormatter.string(
                    decimalMinorUnits: amount, currencyCode: currencyCode, minorUnit: minorUnit,
                    showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
            }
            switch self {
            case .overspent(let amount): return L10n.string("Overspent by \(money(amount))")
            case .extraFunded(let amount): return L10n.string("\(money(amount)) extra funded")
            case .fullyFunded(let spent):
                guard spent > 0 else { return L10n.string("Fully funded") }
                return L10n.string("\(money(spent)) spent")
            case .onTrack: return L10n.string("On track")
            case .snoozed: return L10n.string("Target snoozed")
            case .needed(let amount): return L10n.string("\(money(amount)) needed")
            case .neededThisMonth(let amount):
                return L10n.string("\(money(amount)) more needed this month")
            case .neededBy(let amount, let date):
                let deadline = date.formatted(
                    Date.FormatStyle(locale: locale, timeZone: .gmt).month(.abbreviated).day())
                return L10n.string("\(money(amount)) more needed by \(deadline)")
            }
        }
    }

    let amounts: BudgetCategoryAmounts
    let assigned: Int64
    let isFutureMonth: Bool

    init(
        amounts: BudgetCategoryAmounts = .init(), assigned: Int64? = nil,
        isFutureMonth: Bool = false
    ) {
        self.amounts = amounts
        self.assigned = assigned ?? amounts.assignedAmount
        self.isFutureMonth = isFutureMonth
    }

    func status(target settings: BudgetTarget?, month: Int) -> Status? {
        let delta = Decimal(assigned) - Decimal(amounts.assignedAmount)
        let available = Decimal(amounts.available) + delta
        let overspentStatus: Status? = available < 0 ? .overspent(-available) : nil
        guard let target = amounts.target else { return overspentStatus }
        if target.isSnoozed { return overspentStatus ?? .snoozed }
        guard let targetAmount = target.targetAmount, targetAmount > 0 else {
            return overspentStatus
        }

        let baselineRemaining = Decimal(target.remainingToAssign ?? target.underfundedAmount)
        let remaining =
            target.remainingFunding(
                assigned: amounts.assignedAmount, assignmentDelta: delta)
            ?? max(
                0,
                target.assignmentNeeded.map { Decimal($0) - Decimal(assigned) }
                    ?? (baselineRemaining - Decimal(target.overfundedByAmount) - delta))
        let extra = extraFunded(targetKind: settings?.targetType)
        if extra > 0 { return .extraFunded(extra) }
        if remaining <= 0 {
            if let overspentStatus { return overspentStatus }
            if settings?.targetType == .oneTime || settings?.targetType == .maintainBalance,
                available < Decimal(targetAmount)
            {
                return .onTrack
            }
            return .fullyFunded(max(0, -Decimal(amounts.totalSpent ?? amounts.activity)))
        }

        if settings?.targetType == .oneTime
            || settings?.frequency == .daily || settings?.frequency == .weekly
        {
            return .needed(remaining)
        }
        if settings?.targetType?.repeats == true,
            settings?.frequency == .monthly || settings?.frequency == .yearly,
            (settings?.dueDay ?? 0) > 0,
            let dueDate = target.dueDate, BudgetTargetDraft.isDateKey(dueDate),
            BudgetMonth.fromDateKey(dueDate) == month, let day = Int(dueDate.suffix(2))
        {
            return .neededBy(
                remaining, BudgetMonth.date(month).addingTimeInterval(Double(day - 1) * 86_400))
        }
        return .neededThisMonth(remaining)
    }

    /// Use the same spendable excess for the caption and filter, including pending saves.
    func extraFunded(targetKind: BudgetTargetKind?) -> Decimal {
        let delta = Decimal(assigned) - Decimal(amounts.assignedAmount)
        let available = Decimal(amounts.available) + delta
        guard available > 0, let target = amounts.target, !target.isSnoozed,
            let targetAmount = target.targetAmount, targetAmount > 0
        else { return 0 }
        if delta == 0 { return min(available, max(0, Decimal(target.overfundedByAmount))) }

        // Assignment needed already includes any overspending the target must cover.
        let fromAssignment =
            target.assignmentNeeded.map { Decimal(assigned) - Decimal($0) }
            ?? (Decimal(target.overfundedByAmount) + delta
                - Decimal(target.remainingToAssign ?? target.underfundedAmount))
        let projected: Decimal
        switch targetKind {
        case .maintainBalance:
            projected =
                isFutureMonth
                ? 0
                : available + abs(Decimal(amounts.totalSpent ?? 0)) - Decimal(targetAmount)
        case .spending:
            let needed = target.assignmentNeeded ?? 0
            projected =
                isFutureMonth || (needed > 0 && needed < targetAmount)
                ? fromAssignment : max(fromAssignment, available - Decimal(targetAmount))
        default:
            projected = fromAssignment
        }
        return min(available, max(0, projected))
    }
}

/// Keep target funding separate from how that money has been used.
/// Overspending fills the track; only the covered share of spending is striped.
struct BudgetCategoryProgress: Equatable {
    enum State {
        case noTarget, underfunded, fullyFunded, overspent

        var title: String {
            switch self {
            case .noTarget: L10n.string("No target")
            case .underfunded: L10n.string("Underfunded")
            case .fullyFunded: L10n.string("Fully funded")
            case .overspent: L10n.string("Overspent")
            }
        }
    }

    let state: State
    let funded: Double
    let spent: Double
    var available: Double { funded - spent }
    var overspent: Double { state == .overspent ? 1 - funded : 0 }
    var unfunded: Double { state == .overspent ? 0 : 1 - funded }
    var filled: Double { funded + overspent }
    var spentOfFunded: Double { funded > 0 ? spent / funded : 0 }
    var spentOfFilled: Double { filled > 0 ? spent / filled : 0 }

    init(
        target: BudgetCategoryTarget? = nil, available: Decimal = 0,
        fundedRatio: Double? = nil, spentRatio: Double? = nil, remainingToAssign: Decimal? = nil
    ) {
        if available < 0 {
            state = .overspent
        } else if (target?.targetAmount ?? 0) > 0 {
            state =
                (remainingToAssign ?? Decimal(target?.remainingToAssign ?? 0)) > 0
                ? .underfunded : .fullyFunded
        } else {
            state = .noTarget
        }
        let fundedRatio = fundedRatio ?? target?.fundedRatio ?? 0
        let spentRatio = spentRatio ?? target?.spentRatio ?? 0
        funded = fundedRatio.isFinite ? min(1, max(0, fundedRatio)) : 0
        spent =
            state == .overspent
            ? funded
            : spentRatio.isFinite ? min(funded, max(0, spentRatio)) : 0
    }

    /// Project an absolute assignment from the latest snapshot, never from a previous preview.
    /// Keep the server's target-specific basis: balance, cumulative contributions, or monthly need.
    init(
        amounts: BudgetCategoryAmounts, assigned: Int64, targetKind: BudgetTargetKind?,
        isFutureMonth: Bool
    ) {
        let delta = Decimal(assigned) - Decimal(amounts.assignedAmount)
        let target = amounts.target
        let available = Decimal(amounts.available) + delta
        let carryover =
            amounts.carryoverFromPrevious.map(Decimal.init)
            ?? (Decimal(amounts.available) - Decimal(amounts.assignedAmount)
                - Decimal(amounts.activity))
        let spending =
            max(
                0,
                amounts.fundedSpending.map(Decimal.init)
                    ?? amounts.outflowAmount.map(Decimal.init) ?? max(0, -Decimal(amounts.activity))
            )
            + max(0, -carryover)
        if available < 0 {
            // The whole track represents spending. Its uncovered share stays solid red.
            let coveredShare = Self.ratio(max(0, spending + available), spending)
            self.init(target: target, available: available, fundedRatio: coveredShare)
            return
        }
        let targetAmount = Decimal(target?.targetAmount ?? 0)
        let monthlyNeed =
            targetAmount > 0
            ? Decimal(target?.assignmentNeeded ?? target?.targetAmount ?? 0)
            : max(0, -available)
        let remaining =
            target?.remainingFunding(assigned: amounts.assignedAmount, assignmentDelta: delta)
            ?? (monthlyNeed > 0 ? max(0, monthlyNeed - Decimal(assigned)) : 0)
        let effectiveBalance = available + max(0, -Decimal(amounts.totalSpent ?? amounts.activity))
        let funded: Double
        if delta == 0 {
            funded = target?.fundedRatio ?? 0
        } else if targetAmount > 0, targetKind == .maintainBalance || targetKind == .spending {
            funded =
                targetKind == .spending && isFutureMonth && monthlyNeed > 0
                ? Self.ratio(Decimal(assigned), monthlyNeed)
                : Self.ratio(effectiveBalance, targetAmount)
        } else if let cumulativeNeed = target?.cumulativeTargetNeeded, cumulativeNeed > 0 {
            funded = Self.ratio(
                Decimal(target?.cumulativeAssigned ?? amounts.assignedAmount) + delta,
                Decimal(cumulativeNeed))
        } else if monthlyNeed > 0 {
            funded = Self.ratio(Decimal(assigned), monthlyNeed)
        } else if targetAmount <= 0 {
            funded = assigned > 0 || carryover > 0 ? 1 : 0
        } else {
            funded = remaining == 0 || assigned > 0 ? 1 : 0
        }
        let boundedFunding = funded.isFinite ? min(1, max(0, funded)) : 0
        let spentShare = Self.ratio(spending, spending + available)
        self.init(
            target: target, available: available, fundedRatio: boundedFunding,
            spentRatio: boundedFunding * spentShare,
            remainingToAssign: delta == 0 ? nil : remaining)
    }

    private static func ratio(_ amount: Decimal, _ total: Decimal) -> Double {
        guard total > 0 else { return 0 }
        return NSDecimalNumber(decimal: min(1, max(0, amount / total))).doubleValue
    }
}

enum BudgetTargetFundingStatus {
    case noTarget, snoozed, underfunded, funded
}

enum BudgetCategoryFilter: String, CaseIterable, Identifiable {
    case all, overspent, available, underfunded, funded, extraFunded, noTarget

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: L10n.string("All")
        case .overspent: L10n.string("Overspent")
        case .available: L10n.string("Available")
        case .underfunded: L10n.string("Underfunded")
        case .funded: L10n.string("Funded")
        case .extraFunded: L10n.string("Extra funded")
        case .noTarget: L10n.string("No target")
        }
    }

    func matches(_ row: BudgetCategoryRowModel) -> Bool {
        switch self {
        case .all: true
        case .overspent: row.available < 0
        case .available: row.available > 0
        case .underfunded: row.targetFundingStatus == .underfunded
        case .funded: row.targetFundingStatus == .funded
        case .extraFunded: row.extraFunded > 0
        case .noTarget: !row.isCreditCard && row.targetFundingStatus == .noTarget
        }
    }

    func count(in groups: [BudgetGroupModel]) -> Int {
        groups.reduce(0) { count, group in count + group.rows.count(where: matches) }
    }

    static func visible(in groups: [BudgetGroupModel]) -> [Self] {
        allCases.filter { $0 == .all || $0.count(in: groups) > 0 }
    }

    func resolved(in groups: [BudgetGroupModel]) -> Self {
        self == .all || count(in: groups) > 0 ? self : .all
    }

    func applying(to groups: [BudgetGroupModel], keepingCategoryID: String? = nil)
        -> [BudgetGroupModel]
    {
        guard self != .all else { return groups }
        return groups.compactMap { group in
            let rows = group.rows.filter { matches($0) || $0.id == keepingCategoryID }
            guard !rows.isEmpty else { return nil }
            return BudgetGroupModel(
                id: group.id, name: group.name, rows: rows,
                assigned: rows.reduce(Decimal.zero) { $0 + Decimal($1.assigned) },
                available: rows.reduce(Decimal.zero) { $0 + $1.available })
        }
    }
}

enum BudgetAvailabilityStatus {
    case available, underfunded, overspent, empty

    var accessibilityDescription: String {
        switch self {
        case .available: L10n.string("Available")
        case .underfunded: L10n.string("Underfunded")
        case .overspent: L10n.string("Overspent")
        case .empty: L10n.string("No available funds")
        }
    }
}

struct BudgetGroupModel: Identifiable, Equatable {
    let id: String
    let name: String
    let rows: [BudgetCategoryRowModel]
    let assigned: Decimal
    let available: Decimal
}

struct BudgetTotals: Equatable {
    let assigned: Decimal
    let available: Decimal

    init(groups: [BudgetGroupModel]) {
        assigned = groups.reduce(.zero) { $0 + $1.assigned }
        available = groups.reduce(.zero) { $0 + $1.available }
    }
}

enum BudgetMonth {
    /// Transaction dates are calendar keys; converting through a device timezone can shift months.
    static func fromDateKey(_ key: String) -> Int? {
        let parts = key.split(separator: "-")
        guard key.count == 10, parts.count == 3,
            let year = Int(parts[0]), let month = Int(parts[1]), (1...12).contains(month)
        else { return nil }
        return year * 100 + month
    }

    static func index(_ month: Int) -> Int { (month / 100) * 12 + month % 100 - 1 }

    static func fromIndex(_ index: Int) -> Int { (index / 12) * 100 + index % 12 + 1 }

    static func browsableMonths(in range: BudgetMonthRange) -> [Int] {
        ((index(range.minYearMonth) - 1)...(index(range.maxYearMonth) + 1)).map(fromIndex)
    }

    static func unlockingMonth(_ month: Int, in range: BudgetMonthRange) -> Int? {
        if month < range.minYearMonth { return range.minYearMonth }
        if month > range.maxYearMonth { return range.maxYearMonth }
        return nil
    }

    static func current(now: Date = Date(), timezoneIdentifier: String? = nil) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current
        let components = calendar.dateComponents([.year, .month], from: now)
        return (components.year ?? 2000) * 100 + (components.month ?? 1)
    }

    static func offset(_ month: Int, by delta: Int) -> Int {
        let index = (month / 100) * 12 + month % 100 - 1 + delta
        return (index / 12) * 100 + index % 12 + 1
    }

    static func date(_ month: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar.date(from: DateComponents(year: month / 100, month: month % 100, day: 1))
            ?? Date(timeIntervalSince1970: 0)
    }

    static func browsingLabel(_ month: Int, currentMonth: Int) -> String? {
        guard month != currentMonth else { return nil }
        return month < currentMonth ? L10n.string("Past month") : L10n.string("Future month")
    }

    static func navigationTitle(_ month: Int, currentMonth: Int, locale: Locale = L10n.locale)
        -> String
    {
        let format = Date.FormatStyle(
            date: .omitted, time: .omitted, locale: locale,
            calendar: Calendar(identifier: .gregorian), timeZone: TimeZone(secondsFromGMT: 0)!
        )
        return month / 100 == currentMonth / 100
            ? format.month(.wide).format(date(month))
            : format.month(.abbreviated).year().format(date(month))
    }

    static func abbreviatedTitle(_ month: Int, locale: Locale = L10n.locale) -> String {
        let format = Date.FormatStyle(
            date: .omitted, time: .omitted, locale: locale,
            calendar: Calendar(identifier: .gregorian), timeZone: TimeZone(secondsFromGMT: 0)!
        ).month(.abbreviated)
        return format.format(date(month))
    }

    static func title(_ month: Int, locale: Locale = L10n.locale) -> String {
        let format = Date.FormatStyle(
            date: .omitted, time: .omitted, locale: locale,
            calendar: Calendar(identifier: .gregorian), timeZone: TimeZone(secondsFromGMT: 0)!
        ).month(.wide).year()
        // A budget month is not an instant. Preformat so SwiftUI's environment
        // timezone cannot turn midnight on its first day into the previous month.
        return format.format(date(month))
    }
}

/// Returns the smallest scroll needed to expose the assignment and its breathing room.
/// All rectangles use the native scroll view's content coordinates.
enum BudgetAssignmentVisibility {
    static func offset(
        target: CGRect, viewport: CGRect, contentHeight: CGFloat, clearance: CGFloat = 34
    ) -> CGFloat? {
        guard target.height > 0, viewport.height > 0, contentHeight > 0 else { return nil }
        // Add half a compact row (22pt) to the original 12pt gap so assignments
        // clear the foreground's curved bottom edge, including barely visible rows.
        let gap = min(clearance, max(0, (viewport.height - target.height) / 2))
        let visibleTarget = target.insetBy(dx: 0, dy: -gap)
        let proposed: CGFloat
        if visibleTarget.height > viewport.height {
            // At extreme text sizes, prioritize the top of the actual amount button.
            proposed = target.minY
        } else if visibleTarget.maxY > viewport.maxY + 0.5 {
            proposed = visibleTarget.maxY - viewport.height
        } else {
            return nil
        }
        let offset = min(max(0, proposed), max(0, contentHeight - viewport.height))
        return offset > viewport.minY + 0.5 ? offset : nil
    }
}

enum BudgetCompletionTiming {
    static let amountAnimation = 0.24
    static let zeroHold: Duration = .milliseconds(600)
    static let beforeMessage = Duration.seconds(amountAnimation) + zeroHold
    static let messageTransition = 0.32
}

/// Shows RTA while assigning, including zero, and keeps a newly balanced budget visible
/// through its completion. Each completion has an identity so interrupted timers are harmless.
struct BudgetPeekPresentation {
    enum Tone {
        case neutral, positive, negative

        init(readyToAssign: Decimal) {
            self = readyToAssign < 0 ? .negative : readyToAssign > 0 ? .positive : .neutral
        }
    }

    struct Context: Equatable {
        let workspaceID: String?
        let readyToAssign: Decimal
        let isEditing: Bool
        let isActive: Bool
        var isClosing = false
        var hasUndo = false
        var hasMoneyMove = false
        var requiresNonzeroBalance = false
    }

    private(set) var context: Context?
    private(set) var displayedReadyToAssign = Decimal.zero
    private(set) var tone = Tone.neutral
    private(set) var completionID: UUID?
    private(set) var showsCompletion = false
    private(set) var isQuickAssignCompletion = false
    private(set) var closingCompletionID: UUID?
    private var closingKeypadID: UUID?
    private var closingWithoutChanges = false

    var isVisible: Bool {
        guard let context, context.isActive else { return false }
        if context.requiresNonzeroBalance { return context.readyToAssign != 0 }
        // An unchanged/cancelled edit needs no result hold. Hide a zero peek in
        // the same transaction that starts closing the keypad, not its completion.
        if closingWithoutChanges {
            return context.readyToAssign != 0 || context.hasUndo
        }
        return displayedReadyToAssign != 0 || context.isEditing || context.isClosing
            || closingKeypadID != nil
            || (completionID != nil && closingCompletionID == nil) || context.hasUndo
    }

    /// Resolve incoming data before SwiftUI's onChange synchronizes the presentation.
    /// This preserves the loading handoff without borrowing a previous workspace's result.
    func isVisible(in next: Context) -> Bool {
        var presentation = self
        presentation.update(next)
        return presentation.isVisible
    }

    var completionTaskID: UUID? {
        closingKeypadID == nil && closingCompletionID == nil
            && context?.isEditing == false && context?.isClosing == false ? completionID : nil
    }

    mutating func beginKeypadEditing() {
        closingKeypadID = nil
        closingWithoutChanges = false
        if closingCompletionID != nil || isQuickAssignCompletion { clearCompletion() }
    }

    /// Called before saving or cancelling can publish a new balance. Freezing is
    /// synchronous; it cannot depend on the order of SwiftUI onChange callbacks.
    mutating func beginKeypadClosing(id: UUID, hasChanges: Bool) {
        closingKeypadID = id
        closingWithoutChanges = !hasChanges
        if closingWithoutChanges { clearCompletion() }
    }

    mutating func finishKeypadClosing(id: UUID, context next: Context) {
        guard closingKeypadID == id else { return }
        let clearsCompletion = closingWithoutChanges
        closingKeypadID = nil
        closingWithoutChanges = false
        update(next)
        if clearsCompletion {
            clearCompletion()
        }
    }

    mutating func update(_ next: Context) {
        let previous = context
        context = next
        guard next.isActive, previous?.workspaceID == next.workspaceID else {
            beginKeypadEditing()
            clearCompletion()
            displayedReadyToAssign = next.readyToAssign
            tone = Tone(readyToAssign: next.readyToAssign)
            return
        }
        // Persistence and subscriptions can advance while the keypad is closing.
        // Keep the visible amount, color, and completion unchanged until it is fully covered.
        guard closingKeypadID == nil, !next.isClosing else { return }
        let reachedZero =
            previous?.isActive == true && displayedReadyToAssign != 0 && next.readyToAssign == 0
        let resumedEditing = next.isEditing && previous?.isEditing == false
        if resumedEditing && isQuickAssignCompletion { clearCompletion() }
        displayedReadyToAssign = next.readyToAssign
        guard next.readyToAssign == 0 else {
            clearCompletion()
            tone = Tone(readyToAssign: next.readyToAssign)
            return
        }
        // Money moves own their result and Undo. Never queue an assignment
        // celebration underneath that receipt or reveal it as the receipt closes.
        if next.hasMoneyMove {
            clearCompletion()
            return
        }
        if reachedZero || (resumedEditing && completionID != nil) {
            completionID = UUID()
            closingCompletionID = nil
            showsCompletion = false
        }
        if completionID != nil {
            tone = .positive
        } else if resumedEditing || previous?.isActive != true {
            tone = .neutral
        }
    }

    mutating func showCompletion(id: UUID) {
        guard completionTaskID == id else { return }
        showsCompletion = true
    }

    mutating func beginCompletionClosing(id: UUID) {
        guard completionTaskID == id, showsCompletion else { return }
        // Close its viewport now, retaining the green message until fully covered.
        closingCompletionID = id
    }

    mutating func finishCompletionClosing(id: UUID) {
        guard closingCompletionID == id else { return }
        clearCompletion()
    }

    /// Celebrate a successful zero balance on the regular budget, alongside Undo.
    mutating func finishQuickAssign(context: Context, celebratesZero: Bool = false) {
        update(context)
        clearCompletion()
        if celebratesZero, context.isActive, context.readyToAssign == 0 {
            completionID = UUID()
            isQuickAssignCompletion = true
            tone = .positive
        }
    }

    mutating func beginQuickAssignCompletionClosing(id: UUID) {
        guard isQuickAssignCompletion, completionID == id else { return }
        // Expiry or a newer edit can dismiss this result even before the message appears.
        closingCompletionID = id
    }

    private mutating func clearCompletion() {
        isQuickAssignCompletion = false
        completionID = nil
        closingCompletionID = nil
        showsCompletion = false
        tone = Tone(readyToAssign: displayedReadyToAssign)
    }
}
