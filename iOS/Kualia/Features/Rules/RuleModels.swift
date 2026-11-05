import Foundation
import Observation

enum RuleTextMatch: String, Codable, CaseIterable, Identifiable {
    case contains, exactlyMatches
    var id: String { rawValue }
    var title: String { self == .contains ? "contains" : L10n.string("is exactly") }
}

enum RuleAmountOperator: String, Codable, CaseIterable, Identifiable {
    case equals, lessThan, greaterThan, between
    var id: String { rawValue }
    var title: String {
        switch self {
        case .equals: "equals"
        case .lessThan: L10n.string("is less than")
        case .greaterThan: L10n.string("is greater than")
        case .between: L10n.string("is between")
        }
    }
}

struct RuleTextCondition: Decodable, Equatable {
    var matchType: RuleTextMatch
    var value: String
}

struct RuleAmountCondition: Decodable, Equatable {
    var comparison: RuleAmountOperator
    var value: Int64
    var valueTo: Int64?

    init(comparison: RuleAmountOperator, value: Int64, valueTo: Int64? = nil) {
        self.comparison = comparison
        self.value = value
        self.valueTo = valueTo
    }

    enum CodingKeys: String, CodingKey {
        case comparison = "operator"
        case value, valueTo
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        comparison = try container.decode(RuleAmountOperator.self, forKey: .comparison)
        value = try container.decode(RuleInteger.self, forKey: .value).value
        valueTo = try container.decodeIfPresent(RuleInteger.self, forKey: .valueTo)?.value
    }
}

/// Convex int64 values are little-endian bytes, not JSON floating-point numbers.
private struct RuleInteger: Decodable {
    let value: Int64
    enum CodingKeys: String, CodingKey { case integer = "$integer" }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let encoded = try container.decode(String.self, forKey: .integer)
        guard let data = Data(base64Encoded: encoded), data.count == 8 else {
            throw DecodingError.dataCorruptedError(
                forKey: .integer, in: container, debugDescription: "Invalid Convex int64")
        }
        let bits = data.enumerated().reduce(UInt64(0)) {
            $0 | (UInt64($1.element) << ($1.offset * 8))
        }
        value = Int64(bitPattern: bits)
    }
}

struct RuleConditions: Decodable, Equatable {
    var originalStatement: [RuleTextCondition] = []
    var merchantName: [RuleTextCondition] = []
    var amount: [RuleAmountCondition] = []
    var bankAccountId: [String] = []

    var isEmpty: Bool {
        originalStatement.isEmpty && merchantName.isEmpty && amount.isEmpty && bankAccountId.isEmpty
    }

    init(
        originalStatement: [RuleTextCondition] = [], merchantName: [RuleTextCondition] = [],
        amount: [RuleAmountCondition] = [], bankAccountId: [String] = []
    ) {
        self.originalStatement = originalStatement
        self.merchantName = merchantName
        self.amount = amount
        self.bankAccountId = bankAccountId
    }

    enum CodingKeys: String, CodingKey {
        case originalStatement, merchantName, amount, bankAccountId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        originalStatement =
            try container.decodeIfPresent(
                [RuleTextCondition].self, forKey: .originalStatement) ?? []
        merchantName =
            try container.decodeIfPresent([RuleTextCondition].self, forKey: .merchantName) ?? []
        amount = try container.decodeIfPresent([RuleAmountCondition].self, forKey: .amount) ?? []
        bankAccountId = try container.decodeIfPresent([String].self, forKey: .bankAccountId) ?? []
    }
}

struct RuleActions: Decodable, Equatable {
    var setMerchantId: String?
    var setCategoryId: String?
}

struct TransactionRule: Decodable, Identifiable, Equatable {
    let id: String
    let workspaceId: String
    var name: String
    var isActive: Bool
    var priority: Double
    var conditions: RuleConditions
    var actions: RuleActions
    var usageCount: Int?
    var lastUsedAt: String?
    var isDeleted: Bool = false

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case workspaceId, name, isActive, priority, conditions, actions, usageCount, lastUsedAt,
            isDeleted
    }
}

struct RuleChoice: Identifiable, Equatable {
    let id: String
    let name: String
    var groupName: String?
    var logoURL: String? = nil
    var accountType: String? = nil
}

struct RuleChoices: Equatable {
    var merchants: [RuleChoice] = []
    var categories: [RuleChoice] = []
    var accounts: [RuleChoice] = []
}

struct RuleTextConditionDraft: Identifiable, Equatable {
    var id = UUID()
    var matchType: RuleTextMatch = .contains
    var value = ""
}

struct RuleAmountConditionDraft: Identifiable, Equatable {
    var id = UUID()
    var comparison: RuleAmountOperator = .equals
    var value = ""
    var valueTo = ""
}

enum RuleConditionKind: String, CaseIterable, Identifiable {
    case merchant, statement, amount
    var id: Self { self }
    var title: String {
        switch self {
        case .merchant: L10n.string("Merchant")
        case .statement: L10n.string("Statement text")
        case .amount: L10n.string("Amount")
        }
    }
}

struct RuleDraft: Equatable {
    var name = ""
    var isActive = true
    /// Blank creates a rule after the current last rule.
    var priority = ""
    var originalStatement: [RuleTextConditionDraft] = []
    var merchantName: [RuleTextConditionDraft] = []
    var amount: [RuleAmountConditionDraft] = []
    var bankAccountIDs: [String] = []
    var merchantID: String?
    var categoryID: String?
    let currency: String
    let minorUnit: Int

    init(currency: String, minorUnit: Int? = nil) {
        self.currency = currency
        self.minorUnit = minorUnit ?? RuleMoney.minorUnit(currency: currency)
    }

    init(rule: TransactionRule, currency: String, minorUnit: Int? = nil) {
        self.init(currency: currency, minorUnit: minorUnit)
        name = rule.name
        isActive = rule.isActive
        priority = RulePresentation.priority(rule.priority)
        originalStatement = rule.conditions.originalStatement.map {
            .init(matchType: $0.matchType, value: $0.value)
        }
        merchantName = rule.conditions.merchantName.map {
            .init(matchType: $0.matchType, value: $0.value)
        }
        amount = rule.conditions.amount.map {
            .init(
                comparison: $0.comparison,
                value: RuleMoney.input($0.value, minorUnit: self.minorUnit),
                valueTo: $0.valueTo.map { RuleMoney.input($0, minorUnit: self.minorUnit) } ?? "")
        }
        bankAccountIDs = rule.conditions.bankAccountId
        merchantID = rule.actions.setMerchantId
        categoryID = rule.actions.setCategoryId
    }

    var normalizedName: String {
        let existing = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !existing.isEmpty { return existing }
        if let text = (merchantName + originalStatement).first?.value,
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        }
        if !amount.isEmpty { return L10n.string("Amount rule") }
        return bankAccountIDs.isEmpty
            ? L10n.string("All transactions") : L10n.string("Account rule")
    }
    var priorityValue: Double? { RulePresentation.parsePriority(priority) }
    var actions: RuleActions { .init(setMerchantId: merchantID, setCategoryId: categoryID) }
    var isValid: Bool { validationMessage == nil }

    var validationMessage: String? {
        if !priority.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let priorityValue, priorityValue.isFinite else {
                return L10n.string("Priority must be a valid number.")
            }
        }
        if let conditionValidationMessage { return conditionValidationMessage }
        if !hasConfiguredConditions { return L10n.string("Set up at least one condition first.") }
        if merchantID == nil && categoryID == nil {
            return L10n.string("Choose a merchant or category to set.")
        }
        return nil
    }

    var hasConfiguredConditions: Bool {
        guard let conditions else { return false }
        return !conditions.isEmpty
    }

    var conditionKinds: [RuleConditionKind] {
        RuleConditionKind.allCases.filter {
            switch $0 {
            case .merchant: !merchantName.isEmpty
            case .statement: !originalStatement.isEmpty
            case .amount: !amount.isEmpty
            }
        }
    }

    mutating func addCondition(_ kind: RuleConditionKind) {
        guard !conditionKinds.contains(kind) else { return }
        switch kind {
        case .merchant: merchantName = [.init()]
        case .statement: originalStatement = [.init()]
        case .amount: amount = [.init()]
        }
    }

    mutating func changeConditionKind(from source: RuleConditionKind, to target: RuleConditionKind)
    {
        guard source != target, conditionKinds.contains(source), !conditionKinds.contains(target)
        else { return }
        let text = source == .merchant ? merchantName : originalStatement
        switch source {
        case .merchant: merchantName = []
        case .statement: originalStatement = []
        case .amount: amount = []
        }
        switch target {
        case .merchant: merchantName = source == .amount ? [.init()] : text
        case .statement: originalStatement = source == .amount ? [.init()] : text
        case .amount: amount = [.init()]
        }
    }

    mutating func copyConditions(from draft: RuleDraft) {
        merchantName = draft.merchantName
        originalStatement = draft.originalStatement
        amount = draft.amount
        bankAccountIDs = draft.bankAccountIDs
    }

    var conditionValidationMessage: String? {
        if (originalStatement + merchantName).contains(where: {
            $0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }) {
            return L10n.string("Enter text for each condition, or remove the empty condition.")
        }
        for condition in amount {
            guard let value = RuleMoney.parse(condition.value, minorUnit: minorUnit) else {
                return L10n.string("Enter a valid amount with up to \(minorUnit) decimal places.")
            }
            if condition.comparison == .between {
                guard let upper = RuleMoney.parse(condition.valueTo, minorUnit: minorUnit) else {
                    return L10n.string("Enter both ends of the amount range.")
                }
                if value > upper {
                    return L10n.string("The first amount must be less than or equal to the second.")
                }
            }
        }
        return nil
    }

    var conditions: RuleConditions? {
        guard conditionValidationMessage == nil else { return nil }
        return .init(
            originalStatement: originalStatement.map {
                .init(matchType: $0.matchType, value: $0.value)
            },
            merchantName: merchantName.map { .init(matchType: $0.matchType, value: $0.value) },
            amount: amount.compactMap { condition in
                guard let value = RuleMoney.parse(condition.value, minorUnit: minorUnit) else {
                    return nil
                }
                return .init(
                    comparison: condition.comparison, value: value,
                    valueTo: condition.comparison == .between
                        ? RuleMoney.parse(condition.valueTo, minorUnit: minorUnit) : nil)
            },
            bankAccountId: bankAccountIDs)
    }
}

enum RuleMoney {
    static func minorUnit(currency: String) -> Int {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        return formatter.maximumFractionDigits
    }

    /// Parse digits directly so large signed int64 values never pass through Double.
    static func parse(_ text: String, minorUnit: Int) -> Int64? {
        guard (0...6).contains(minorUnit) else { return nil }
        var text = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "−", with: "-")
        let negative = text.hasPrefix("-")
        if negative || text.hasPrefix("+") { text.removeFirst() }
        let decimalSeparator = Locale.current.decimalSeparator ?? "."
        if decimalSeparator != "." {
            text = text.replacingOccurrences(of: decimalSeparator, with: ".")
        }
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), !text.isEmpty,
            parts.contains(where: { !$0.isEmpty }),
            parts.allSatisfy({ $0.allSatisfy { $0 >= "0" && $0 <= "9" } })
        else { return nil }
        let fraction = parts.count == 2 ? String(parts[1]) : ""
        guard fraction.count <= minorUnit else { return nil }
        let digits =
            String(parts[0]) + fraction + String(repeating: "0", count: minorUnit - fraction.count)
        return Int64((negative ? "-" : "") + digits)
    }

    static func input(_ value: Int64, minorUnit: Int) -> String {
        var digits = String(value.magnitude)
        if minorUnit > 0 {
            while digits.count <= minorUnit { digits.insert("0", at: digits.startIndex) }
            digits.insert(".", at: digits.index(digits.endIndex, offsetBy: -minorUnit))
        }
        return (value < 0 ? "-" : "") + digits
    }

    static func label(_ value: Int64, currency: String, minorUnit: Int? = nil) -> String {
        let precision = minorUnit ?? self.minorUnit(currency: currency)
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.minimumFractionDigits = precision
        formatter.maximumFractionDigits = precision
        let decimal =
            Decimal(
                string: input(value, minorUnit: precision),
                locale: Locale(identifier: "en_US_POSIX")) ?? 0
        return formatter.string(from: NSDecimalNumber(decimal: decimal))
            ?? input(value, minorUnit: precision)
    }
}

enum RulePresentation {
    static func parsePriority(_ text: String, locale: Locale = L10n.locale) -> Double? {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: locale.decimalSeparator ?? ".", with: ".")
        return Double(normalized)
    }

    static func priority(_ value: Double) -> String {
        value.formatted(
            .number.grouping(.never).precision(.fractionLength(0...16)).locale(
                Locale(identifier: "en_US_POSIX")))
    }

    static func conditionLines(
        _ rule: TransactionRule, choices: RuleChoices, currency: String, minorUnit: Int? = nil
    ) -> [String] {
        var lines: [String] = []
        for (title, conditions) in [
            (L10n.string("Statement"), rule.conditions.originalStatement),
            (L10n.string("Merchant"), rule.conditions.merchantName),
        ] where !conditions.isEmpty {
            lines.append(
                conditions.map { "\(title) \($0.matchType.title) “\($0.value)”" }.joined(
                    separator: " or "))
        }
        if !rule.conditions.amount.isEmpty {
            lines.append(
                rule.conditions.amount.map { condition in
                    let amount = RuleMoney.label(
                        condition.value, currency: currency, minorUnit: minorUnit)
                    if condition.comparison == .between, let upper = condition.valueTo {
                        return
                            L10n.string(
                                "Amount is between \(amount) and \(RuleMoney.label(upper, currency: currency, minorUnit: minorUnit)), inclusive"
                            )
                    }
                    return L10n.string("Amount \(condition.comparison.title) \(amount)")
                }.joined(separator: " or "))
        }
        if !rule.conditions.bankAccountId.isEmpty {
            let names = rule.conditions.bankAccountId.map { id in
                choices.accounts.first { $0.id == id }?.name ?? L10n.string("Unavailable account")
            }
            lines.append(L10n.string("Account is ") + names.joined(separator: " or "))
        }
        return lines.isEmpty ? [L10n.string("Every transaction")] : lines
    }

    static func actionLines(_ rule: TransactionRule, choices: RuleChoices) -> [String] {
        var lines: [String] = []
        if let id = rule.actions.setMerchantId {
            lines.append(
                L10n.string("Set merchant to ")
                    + (choices.merchants.first { $0.id == id }?.name
                        ?? L10n.string("Unavailable merchant")))
        }
        if let id = rule.actions.setCategoryId {
            lines.append(
                L10n.string("Set category to ")
                    + (choices.categories.first { $0.id == id }?.name
                        ?? L10n.string("Unavailable category")))
        }
        return lines.isEmpty ? [L10n.string("No changes configured")] : lines
    }
}

/// A saved ID survives a failed apply step so Retry never creates a second rule.
@MainActor
@Observable
final class RuleEditorSubmission {
    var ruleID: String?
    var savedDraft: RuleDraft?
    var applyExisting: Bool

    init(ruleID: String? = nil) {
        self.ruleID = ruleID
        applyExisting = ruleID == nil
    }
}
