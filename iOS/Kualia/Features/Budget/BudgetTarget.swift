import ConvexMobile
import Foundation

enum BudgetTargetKind: String, Decodable, CaseIterable, Identifiable {
    case setAside = "recurring"
    case spending = "recurring_rollover"
    case oneTime = "one_time"
    case maintainBalance = "maintain_balance"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .setAside: L10n.string("Set aside")
        case .spending: L10n.string("Set for spending")
        case .oneTime: L10n.string("One-time")
        case .maintainBalance: L10n.string("Maintain balance")
        }
    }
    var explanation: String {
        switch self {
        case .setAside:
            L10n.string("Add this amount each period. Leftover money keeps building up.")
        case .spending:
            L10n.string(
                "Have this much ready to spend each period. Leftovers reduce what you need to add.")
        case .oneTime:
            L10n.string(
                "Build up to this amount by a date. Spread the saving across the months ahead.")
        case .maintainBalance:
            L10n.string(
                "Keep a cushion in this category. Add a monthly contribution until you reach it.")
        }
    }
    var repeats: Bool { self == .setAside || self == .spending }
}

enum BudgetTargetFrequency: String, Decodable, CaseIterable, Identifiable {
    case daily, weekly, monthly, yearly
    var id: String { rawValue }
    var title: String {
        switch self {
        case .daily: L10n.string("Daily")
        case .weekly: L10n.string("Weekly")
        case .monthly: L10n.string("Monthly")
        case .yearly: L10n.string("Yearly")
        }
    }
    var unit: String {
        switch self {
        case .daily: L10n.string("day")
        case .weekly: L10n.string("week")
        case .monthly: L10n.string("month")
        case .yearly: L10n.string("year")
        }
    }
    func title(interval: Int) -> String {
        guard interval != 1 else { return title }
        switch self {
        case .daily: return L10n.string("Every \(interval) days")
        case .weekly: return L10n.string("Every \(interval) weeks")
        case .monthly: return L10n.string("Every \(interval) months")
        case .yearly: return L10n.string("Every \(interval) years")
        }
    }
}

/// Saved settings, separate from the calculated monthly funding requirement.
struct BudgetTarget: Decodable, Equatable {
    let categoryId: String
    var targetType: BudgetTargetKind?
    var amount: Int64?
    var frequency: BudgetTargetFrequency?
    var frequencyInterval: Int?
    var dayOfWeek: Int?
    var dueDay: Int?
    var firstDueDate: String?
    var targetDate: String?
    var monthlyContribution: Int64?
    var targetBalance: Int64?

    var displayAmount: Int64? {
        targetType == .maintainBalance ? targetBalance ?? amount : amount
    }
    var cadence: String {
        switch targetType {
        case .oneTime: L10n.string("One-time")
        case .maintainBalance: L10n.string("Balance target")
        default: (frequency ?? .monthly).title(interval: frequencyInterval ?? 1)
        }
    }

    init(
        categoryId: String, targetType: BudgetTargetKind? = nil, amount: Int64? = nil,
        frequency: BudgetTargetFrequency? = nil, frequencyInterval: Int? = nil,
        dayOfWeek: Int? = nil, dueDay: Int? = nil, firstDueDate: String? = nil,
        targetDate: String? = nil, monthlyContribution: Int64? = nil, targetBalance: Int64? = nil
    ) {
        self.categoryId = categoryId
        self.targetType = targetType
        self.amount = amount
        self.frequency = frequency
        self.frequencyInterval = frequencyInterval
        self.dayOfWeek = dayOfWeek
        self.dueDay = dueDay
        self.firstDueDate = firstDueDate
        self.targetDate = targetDate
        self.monthlyContribution = monthlyContribution
        self.targetBalance = targetBalance
    }

    private enum CodingKeys: String, CodingKey {
        case categoryId, targetType, amount, frequency, frequencyInterval, dayOfWeek, dueDay
        case firstDueDate, targetDate, monthlyContribution, targetBalance
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        categoryId = try values.decode(String.self, forKey: .categoryId)
        targetType = try values.decodeIfPresent(BudgetTargetKind.self, forKey: .targetType)
        amount = try values.decodeIfPresent(ConvexInt.self, forKey: .amount)?.wrappedValue
        frequency = try values.decodeIfPresent(BudgetTargetFrequency.self, forKey: .frequency)
        frequencyInterval = try values.decodeIfPresent(Int.self, forKey: .frequencyInterval)
        dayOfWeek = try values.decodeIfPresent(Int.self, forKey: .dayOfWeek)
        dueDay = try values.decodeIfPresent(Int.self, forKey: .dueDay)
        firstDueDate = try values.decodeIfPresent(String.self, forKey: .firstDueDate)
        targetDate = try values.decodeIfPresent(String.self, forKey: .targetDate)
        monthlyContribution = try values.decodeIfPresent(
            ConvexInt.self, forKey: .monthlyContribution)?.wrappedValue
        targetBalance = try values.decodeIfPresent(ConvexInt.self, forKey: .targetBalance)?
            .wrappedValue
    }
}

struct BudgetTargetDraft: Equatable {
    var kind: BudgetTargetKind
    var amount: Int64?
    var frequency: BudgetTargetFrequency
    var interval: Int
    var dayOfWeek: Int
    var dueDay: Int?
    var firstDueDate: String
    var targetDate: String
    var monthlyContribution: Int64?

    init(target: BudgetTarget?, today: String) {
        kind = target?.targetType ?? .setAside
        amount = target?.displayAmount ?? 0
        frequency = target?.frequency ?? .monthly
        interval = target?.frequencyInterval ?? 1
        dayOfWeek = target?.dayOfWeek ?? 1
        dueDay = target == nil ? -1 : target?.dueDay
        firstDueDate =
            target?.firstDueDate.flatMap { $0.isEmpty ? nil : $0 } ?? "\(today.prefix(7))-01"
        targetDate =
            target?.targetDate
            ?? "\((Int(today.prefix(4)) ?? 2000) + 1)\(today.dropFirst(4).prefix(3))-01"
        monthlyContribution = target?.monthlyContribution ?? 0
    }

    // The mutation accepts JavaScript numbers containing integer minor units.
    static let maximumAmount: Int64 = 9_007_199_254_740_991

    func validationMessage(today: String, existing: BudgetTarget?) -> String? {
        guard let amount, amount > 0 else {
            return L10n.string("Enter a target amount greater than zero.")
        }
        guard amount <= Self.maximumAmount else {
            return L10n.string("This target amount is too large.")
        }
        if kind == .oneTime {
            guard Self.isDateKey(targetDate) else { return L10n.string("Choose a target date.") }
            if targetDate <= today, targetDate != existing?.targetDate {
                return L10n.string("Choose a target date after today.")
            }
        } else if kind.repeats {
            guard interval > 0, interval <= 999 else {
                return L10n.string("Choose a repeat interval from 1 to 999.")
            }
            guard Self.isDateKey(firstDueDate) else {
                return L10n.string("Choose the first due date.")
            }
            guard (0...6).contains(dayOfWeek),
                dueDay == nil || dueDay == -1 || (1...31).contains(dueDay ?? 0)
            else {
                return L10n.string("Choose a valid due day.")
            }
        } else {
            guard let monthlyContribution, monthlyContribution > 0,
                monthlyContribution <= Self.maximumAmount
            else {
                return
                    L10n.string("Enter a monthly contribution greater than zero.")
            }
        }
        return nil
    }

    static func isDateKey(_ key: String) -> Bool {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter.date(from: key).map { formatter.string(from: $0) == key } ?? false
    }

    func target(categoryID: String) -> BudgetTarget {
        BudgetTarget(
            categoryId: categoryID, targetType: kind, amount: amount,
            frequency: kind == .oneTime ? nil : kind == .maintainBalance ? .monthly : frequency,
            frequencyInterval: kind == .maintainBalance ? 1 : kind == .oneTime ? nil : interval,
            dayOfWeek: kind.repeats && frequency == .weekly ? dayOfWeek : nil,
            dueDay: kind.repeats && frequency == .monthly ? dueDay : nil,
            firstDueDate: kind.repeats ? firstDueDate : nil,
            targetDate: kind == .oneTime ? targetDate : nil,
            monthlyContribution: kind == .maintainBalance ? monthlyContribution : nil,
            targetBalance: kind == .maintainBalance ? amount : nil)
    }
}

struct BudgetTargetRequest {
    let workspaceID: String
    let target: BudgetTarget
    let isCreating: Bool
    var isDeleting = false

    var function: String {
        if isDeleting { return "categoryTargets:deleteCategoryTarget" }
        return isCreating
            ? "categoryTargets:createCategoryTarget" : "categoryTargets:updateCategoryTarget"
    }

    var arguments: [String: ConvexEncodable?] {
        if isDeleting { return ["workspaceId": workspaceID, "categoryId": target.categoryId] }
        var args: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "categoryId": target.categoryId,
            "targetType": target.targetType?.rawValue,
            "amount": target.amount.map(Double.init),
        ]
        // Omitted creation options must stay omitted; update nulls clear settings
        // from the previous target type, including deadlines and contributions.
        if let frequency = target.frequency { args["frequency"] = frequency.rawValue }
        if let interval = target.frequencyInterval { args["frequencyInterval"] = Double(interval) }
        if let date = target.firstDueDate { args["firstDueDate"] = date }
        let optional: [String: ConvexEncodable?] = [
            "dayOfWeek": target.dayOfWeek.map(Double.init),
            "dueDay": target.dueDay.map(Double.init),
            "targetDate": target.targetDate,
            "monthlyContribution": target.monthlyContribution.map(Double.init),
            "targetBalance": target.targetBalance.map(Double.init),
        ]
        for (key, value) in optional where value != nil || !isCreating {
            args.updateValue(value, forKey: key)
        }
        return args
    }
}

struct BudgetTargetDestination: Identifiable {
    let id = UUID()
    let workspace: BudgetWorkspace
    let category: BudgetCategory
    var assignmentEditorID: UUID? = nil
}
