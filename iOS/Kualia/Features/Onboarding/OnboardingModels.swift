import ConvexMobile
import Foundation

enum OnboardingStep: String, Codable, CaseIterable {
    case priorities, housing, transport, household, categories, accounts, readyToAssign
    case target, assign, celebration

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        // Map retired pages without discarding a user's answers or money steps.
        switch value {
        case "intro", "envelopes":
            self = .priorities
            return
        case "lifestyle":
            self = .housing
            return
        case "currency":
            self = .household
            return
        default: break
        }
        guard let step = Self(rawValue: value) else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Unknown onboarding step")
        }
        self = step
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }
    var progress: Double { Double(index + 1) / Double(Self.allCases.count) }

    var nextQuestion: Self? {
        switch self {
        case .priorities: .housing
        case .housing: .transport
        case .transport: .household
        default: nil
        }
    }

}

struct OnboardingAnswers: Codable, Equatable {
    var housing = "rent"
    var transportation: Set<String> = ["car"]
    var household: Set<String> = ["just_me"]
    var financialGoals: Set<String> = ["emergency"]

    var arguments: [String: ConvexEncodable?] {
        [
            "housing": housing,
            "transportation": transportation.sorted().map { $0 as ConvexEncodable? },
            "household": household.sorted().map { $0 as ConvexEncodable? },
            "financialGoals": financialGoals.sorted().map { $0 as ConvexEncodable? },
        ]
    }
}

/// Only the lesson position and input drafts live locally. Money, envelopes,
/// targets, and the completed flag always come from the authenticated backend.
struct OnboardingCheckpoint: Codable, Equatable {
    var step: OnboardingStep = .priorities
    var answers = OnboardingAnswers()
    var currencyCode = Locale.current.currency?.identifier ?? "USD"
    var workspaceID: String?
    var selectedCategoryID: String?
    var targetAmountText = "100"
    var targetSaved = false
    var didAssignMoney = false
    var didPractice = false

    static func key(userID: String) -> String { "onboarding.v1.\(userID)" }

    mutating func reconcile(workspaceID serverWorkspaceID: String?) {
        if workspaceID != serverWorkspaceID {
            selectedCategoryID = nil
            targetSaved = false
            didAssignMoney = false
            didPractice = false
            step = serverWorkspaceID == nil ? .priorities : .accounts
        }
        workspaceID = serverWorkspaceID
        if serverWorkspaceID == nil, step.index >= OnboardingStep.categories.index {
            step = .household
        } else if serverWorkspaceID != nil, step.index < OnboardingStep.categories.index {
            step = .categories
        }
        if didPractice {
            didPractice = false
            if !didAssignMoney { step = .accounts }
        }
        if !targetSaved, step.index > OnboardingStep.target.index { step = .target }
        if step == .celebration, !didAssignMoney && !didPractice { step = .assign }
    }
}

enum OnboardingAmount {
    static func text(minorUnits: Int64, minorUnit: Int, locale: Locale = L10n.locale) -> String {
        var scale = Decimal(1)
        for _ in 0..<max(0, minorUnit) { scale *= 10 }
        return NSDecimalNumber(decimal: Decimal(minorUnits) / scale).stringValue
            .replacingOccurrences(of: ".", with: locale.decimalSeparator ?? ".")
    }

    /// Reject excess precision and unsafe number-encoded backend amounts; never
    /// silently round a user's first target or accept a partly parsed string.
    static func minorUnits(_ text: String, minorUnit: Int, locale: Locale = L10n.locale) -> Int64? {
        guard (0...6).contains(minorUnit) else { return nil }
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: locale.decimalSeparator ?? ".", with: ".")
        let pieces = normalized.split(separator: ".", omittingEmptySubsequences: false)
        guard !normalized.isEmpty, pieces.count <= 2,
            pieces.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
            pieces.contains(where: { !$0.isEmpty }),
            pieces.count == 1 || pieces[1].count <= minorUnit,
            let major = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX"))
        else { return nil }
        var multiplier = Decimal(1)
        for _ in 0..<minorUnit { multiplier *= 10 }
        let amount = major * multiplier
        guard amount > 0, amount <= Decimal(9_007_199_254_740_991 as Int64) else { return nil }
        return NSDecimalNumber(decimal: amount).int64Value
    }
}

/// Live balances keep arriving under the account sheet. Reveal their latest value
/// only after dismissal, including snapshots that arrive after the sheet closes.
struct OnboardingBalanceReveal {
    private(set) var amount: Decimal = .zero
    private(set) var isHolding = false
    private(set) var canContinue = false

    func isVisible(hasAccounts: Bool, isEditing: Bool) -> Bool {
        hasAccounts && (amount != 0 || isEditing)
    }

    mutating func beginAccountSetup() { isHolding = true }

    mutating func update(_ balance: Decimal, canContinue: Bool) {
        guard !isHolding else { return }
        amount = balance
        self.canContinue = canContinue
    }

    mutating func finishAccountSetup(balance: Decimal, canContinue: Bool) {
        isHolding = false
        update(balance, canContinue: canContinue)
    }
}

enum OnboardingFunding {
    static func isFundedBankingAccount(type: String, balance: Int64) -> Bool {
        type.hasPrefix("banking_") && balance > 0
    }

    static func canContinue(hasLoaded: Bool, hasFundedBankingAccount: Bool, readyToAssign: Decimal)
        -> Bool
    {
        hasLoaded && hasFundedBankingAccount && readyToAssign > 0
    }
}

enum OnboardingAssignment {
    static func canContinue(
        assigned: Int64, isPending: Bool, isEditing: Bool, hasError: Bool, readyToAssign: Decimal
    ) -> Bool {
        assigned > 0 && !isPending && !isEditing && !hasError && readyToAssign >= 0
    }
}

struct OnboardingProfile: Decodable {
    let activeWorkspaceId: String?
    let onboardingCompleted: Bool
}

struct OnboardingWorkspaceResult: Decodable { let workspaceId: String }
struct OnboardingTargetResult: Decodable { let categoryId: String }
struct OnboardingCompletionResult: Decodable { let success: Bool }
struct OnboardingProfileBootstrap: Decodable { let profileId: String }

struct OnboardingExistingTarget: Decodable {
    let categoryId: String
    let amount: Int64?

    private enum CodingKeys: String, CodingKey { case categoryId, amount }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        categoryId = try values.decode(String.self, forKey: .categoryId)
        amount = try values.decodeIfPresent(ConvexInt.self, forKey: .amount)?.wrappedValue
    }
}
