import Foundation

enum SettingsBudgetAppearance {
    static let usesCompactLayoutKey = "budget.usesCompactLayout"
    static let showsCategoryProgressKey = "budget.showsCategoryProgress"
    static let showsCategoryStatusKey = "budget.showsCategoryStatus"
    static let defaultUsesCompactLayout = false
    static let defaultShowsCategoryProgress = true
    static let defaultShowsCategoryStatus = true
}

enum SettingsAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    static let defaultsKey = "kualia.appearance"
    var id: Self { self }
    var title: String {
        switch self {
        case .system: L10n.string("System")
        case .light: L10n.string("Light")
        case .dark: L10n.string("Dark")
        }
    }
    static func resolve(_ value: String?) -> Self { Self(rawValue: value ?? "") ?? .system }
}

struct SettingsProfile: Decodable, Equatable {
    var name: String?
    let email: String
    let clerkId: String
    var notificationsEnabled: Bool
    var notificationPreferences: SettingsNotificationPreferences?
    var checkIn: HomeCheckIn? = nil

    var displayName: String {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? L10n.string("Your account") : trimmed
    }
}

struct SettingsNotificationPreferences: Decodable, Equatable {
    var newTransactionsEnabled = true
    var remindersEnabled = false
    var reminderFrequency: String?

    var frequency: SettingsReminderFrequency {
        SettingsReminderFrequency(rawValue: reminderFrequency ?? "") ?? .gentle
    }
}

enum SettingsReminderFrequency: String, CaseIterable, Identifiable {
    case gentle, aggressive, relentless
    var id: Self { self }
    var title: String {
        switch self {
        case .gentle: L10n.string("Gentle")
        case .aggressive: L10n.string("Regular")
        case .relentless: L10n.string("Frequent")
        }
    }
    var hours: [Int] {
        switch self {
        case .gentle: [10, 18]
        case .aggressive: [9, 12, 15, 18, 20]
        case .relentless: [9, 11, 13, 15, 17, 18, 19, 20]
        }
    }
    var detail: String { L10n.string("\(hours.count) reminders a day, between 9 am and 8 pm.") }
}

struct SettingsSubscription: Decodable, Equatable {
    static let query = "revenuecat/queries:getUserSubscription"
    let subscriptionType: String
    let status: String
    let isActive: Bool
    let expiresAt: String?
    var isTrialing: Bool? = nil
    let periodType: String?
    let store: String?
    var purchasedAt: String? = nil
    var canceledAt: String? = nil

    var isTrial: Bool {
        isTrialing == true || periodType?.lowercased() == "trial"
            || subscriptionType.lowercased() == "trial"
    }
    var isCanceled: Bool {
        canceledAt != nil || ["canceled", "cancelled"].contains(status.lowercased())
    }
    var isLifetime: Bool { subscriptionType.lowercased() == "lifetime" }
    var isApple: Bool { store?.lowercased() == "app_store" }
    var expiration: Date? { Self.date(expiresAt) }
    var purchaseDate: Date? { Self.date(purchasedAt) }
    private static func date(_ value: String?) -> Date? {
        guard let expiresAt = value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
    }
    var planName: String {
        switch subscriptionType.lowercased() {
        case "monthly": L10n.string("Monthly membership")
        case "annual", "yearly": L10n.string("Yearly membership")
        case "lifetime": L10n.string("Lifetime membership")
        case "trial": L10n.string("Kualia trial")
        default: L10n.string("Kualia membership")
        }
    }
    func statusLabel(at now: Date) -> String {
        if !isLifetime, let expiration, expiration <= now,
            ["active", "trialing", "canceled", "cancelled"].contains(status.lowercased())
        {
            return isTrial ? L10n.string("Trial ended") : L10n.string("Expired")
        }
        return statusLabel
    }
    func dateLabel(at now: Date) -> String {
        if !isLifetime, let expiration, expiration <= now {
            return isTrial ? L10n.string("Trial ended") : L10n.string("Access ended")
        }
        return dateLabel
    }
    var statusLabel: String {
        switch status.lowercased() {
        case "billing_issue", "past_due": return L10n.string("Payment needs attention")
        case "paused": return L10n.string("Paused")
        case "expired": return L10n.string("Expired")
        case "cancelled", "canceled":
            return isActive
                ? (isTrial ? L10n.string("Trial canceled") : L10n.string("Renewal canceled"))
                : L10n.string("Expired")
        default: break
        }
        guard isActive else { return L10n.string("Inactive") }
        if isTrial { return L10n.string("Free trial") }
        return isLifetime ? L10n.string("Lifetime access") : L10n.string("Active")
    }
    var dateLabel: String {
        if isTrial {
            return isActive ? L10n.string("Trial ends") : L10n.string("Trial ended")
        }
        if !isActive { return L10n.string("Access ended") }
        // The backend supplies an expiry, not a guaranteed renewal date.
        return L10n.string("Access through")
    }
}

struct SettingsAppAccess: Decodable, Equatable {
    let hasAppAccess: Bool
    let accessSource: String?
    let familyAccess: Family?
    var ownSubscription: SettingsSubscription? = nil

    struct Family: Decodable, Equatable {
        let role: String
        let owner: SettingsOwner
        let ownerHasValidSubscription: Bool
    }
    var usesFamilySubscription: Bool {
        // The server can prefer an own subscription even when family coverage is valid.
        hasAppAccess
            && (accessSource == "family_owner_subscription"
                || (familyAccess?.role == "member"
                    && familyAccess?.ownerHasValidSubscription == true))
    }
}

struct SettingsOwner: Decodable, Equatable {
    let name: String?
    let email: String?
    var displayName: String {
        let name = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? (email ?? L10n.string("the workspace owner")) : name
    }
}

struct SettingsWorkspace: Decodable, Equatable {
    let _id: String
    var name: String
    var currency: String
    var timezone: String?
    let canManage: Bool
    let owner: SettingsOwner?
    var transactionDefaultPendingStatus: Bool?
    var transactionDefaultAccountId: String?
}

struct SettingsWorkspaceValues: Equatable {
    var name: String
    var currency: String
    var pending: Bool
    var defaultAccountID: String?
    init(_ workspace: SettingsWorkspace) {
        name = workspace.name
        currency = workspace.currency
        pending = workspace.transactionDefaultPendingStatus ?? false
        defaultAccountID = workspace.transactionDefaultAccountId
    }
}

struct SettingsResult: Decodable { let success: Bool }

struct SettingsUserJotLinks: Decodable {
    let featureRequestsUrl: String
    let changelogUrl: String

    func url(for destination: SettingsFeedbackDestination) -> URL? {
        let value = destination == .features ? featureRequestsUrl : changelogUrl
        guard let url = URL(string: value), url.scheme == "https",
            url.host == "feedback.kualia.com"
        else { return nil }
        return url
    }
}

enum SettingsFeedbackDestination { case features, updates }

struct SettingsBrowserDestination: Identifiable {
    enum Content {
        case website(URL)
        case feedback(SettingsFeedbackDestination)
    }
    let id = UUID()
    let content: Content
    init(url: URL) { content = .website(url) }
    init(feedback: SettingsFeedbackDestination) { content = .feedback(feedback) }
}

struct SettingsWorkspaceSummary: Decodable, Equatable, Identifiable {
    let _id: String
    let name: String
    let isArchived: Bool
    let canManage: Bool
    let accessKind: String
    let owner: SettingsOwner?
    var id: String { _id }
    var isShared: Bool { accessKind == "family" }
}

struct SettingsDefaultAccount: Decodable, Identifiable {
    let _id: String
    let name: String
    let accountType: String
    let isClosed: Bool?
    var resolvedLogoUrl: String? = nil
    var id: String { _id }
    var isEligible: Bool {
        isClosed != true && (accountType.hasPrefix("banking_") || accountType.hasPrefix("credit_"))
    }
}

struct SettingsWorkspaceDraft: Equatable {
    var name = ""
    var currency = Locale.current.currency?.identifier ?? "USD"
    var timezone = TimeZone.current.identifier
    var sourceWorkspaceID: String?
    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isValid: Bool {
        !trimmedName.isEmpty && Locale.commonISOCurrencyCodes.contains(currency)
            && TimeZone(identifier: timezone) != nil
    }
}

enum SettingsLinks {
    static let discord = URL(string: "https://discord.gg/9wZkfjAqca")!
    static let documentation = URL(string: "https://docs.kualia.com")!
    static let billing = URL(string: "https://app.kualia.com/settings/billing")!
    static let appleSubscriptions = URL(string: "https://apps.apple.com/account/subscriptions")!
    static let privacy = URL(string: "https://kualia.com/privacy")!
    static let terms = URL(string: "https://kualia.com/terms-of-service")!
    static let supportEmail = "support@kualia.com"

    static func supportMail(version: String) -> URL? {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = supportEmail
        components.queryItems = [
            .init(name: "subject", value: L10n.string("Kualia for iOS support")),
            .init(name: "body", value: L10n.string("Hi Kualia,\n\n\n\nApp version: \(version)")),
        ]
        return components.url
    }

    static func version(bundle: Bundle = .main) -> String {
        let version =
            bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }
}

struct SettingsCreatedWorkspace {
    let id: String
    var warning: String? = nil
}

/// Display-only interpretation. App admission always uses the real server access decision.
struct SettingsMembershipPresentation {
    enum Tone { case green, gold, rose, neutral }
    let title: String
    let status: String
    let message: String
    let footnote: String
    let tone: Tone

    init(subscription: SettingsSubscription?, access: SettingsAppAccess?, now: Date) {
        if access?.usesFamilySubscription == true {
            title = L10n.string("Better, together.")
            status = L10n.string("Family membership")
            message = L10n.string("A little more peace of mind, shared.")
            footnote = L10n.string(
                "Managed by \(access?.familyAccess?.owner.displayName ?? L10n.string("your family"))"
            )
            tone = .green
            return
        }
        guard let subscription else {
            title = L10n.string("Your next chapter.")
            status =
                access?.familyAccess?.role == "member"
                ? L10n.string("Family access paused") : L10n.string("No membership")
            message = L10n.string("A little clarity goes a long way.")
            footnote = L10n.string("Explore your membership options")
            tone = .neutral
            return
        }
        let expired = !subscription.isLifetime && subscription.expiration.map { $0 <= now } == true
        let active = subscription.isActive && !expired
        let date = subscription.expiration?.formatted(
            Date.FormatStyle(date: .abbreviated, time: .omitted, locale: L10n.locale))
        if ["billing_issue", "past_due"].contains(subscription.status.lowercased()) {
            title = L10n.string("A quick check-in.")
            status = L10n.string("Payment needs attention")
            message = L10n.string("Review your payment details to keep things going.")
            footnote = L10n.string("Check with your billing provider")
            tone = .rose
        } else if subscription.status.lowercased() == "paused" {
            title = L10n.string("On a little pause.")
            status = L10n.string("Membership paused")
            message = L10n.string("Your next chapter can start when you're ready.")
            footnote = L10n.string("Review your membership details")
            tone = .neutral
        } else if !active {
            title = L10n.string("More room ahead.")
            status =
                subscription.isTrial ? L10n.string("Trial ended") : L10n.string("Membership ended")
            message = L10n.string("Pick up where you left off.")
            footnote =
                date.map { L10n.string("Access ended \($0)") }
                ?? L10n.string("Review your membership options")
            tone = .neutral
        } else if subscription.isTrial {
            let days = subscription.expiration.map {
                max(1, Int(ceil($0.timeIntervalSince(now) / 86_400)))
            }
            title =
                subscription.isCanceled
                ? L10n.string("Enjoy the time left.") : L10n.string("Room to grow.")
            status =
                subscription.isCanceled ? L10n.string("Trial canceled") : L10n.string("Free trial")
            if subscription.isCanceled {
                message = L10n.string("Renewal is off. Your trial is still yours to enjoy.")
            } else if let days {
                message =
                    days == 1
                    ? L10n.string("Less than a day to make yourself at home.")
                    : L10n.string("\(days) days left to make yourself at home.")
            } else {
                message = L10n.string("Make yourself at home with Kualia.")
            }
            footnote =
                date.map { L10n.string("Trial ends \($0)") }
                ?? L10n.string("Trial end date is being confirmed")
            tone = subscription.isCanceled || (days.map { $0 <= 3 } ?? false) ? .gold : .green
        } else if subscription.isLifetime {
            title = L10n.string("Yours for the long run.")
            status = L10n.string("Lifetime membership")
            message = L10n.string("More clarity. For all the chapters ahead.")
            footnote = L10n.string("Lifetime access · No renewal")
            tone = .green
        } else {
            title =
                subscription.isCanceled
                ? L10n.string("Still here for you.") : L10n.string("Good things add up.")
            status = subscription.planName
            message =
                subscription.isCanceled
                ? L10n.string("Renewal is off. Enjoy your remaining access.")
                : L10n.string("Your everyday space for a little more clarity.")
            footnote =
                date.map { L10n.string("Access through \($0)") }
                ?? L10n.string("Membership is active")
            tone = subscription.isCanceled ? .gold : .green
        }
    }
}

struct SettingsMembershipLoadState {
    private(set) var hasSubscriptionSnapshot = false
    private(set) var hasAccessSnapshot = false
    private var subscriptionRefreshed = false
    private var accessRefreshed = false
    var subscriptionError: String?
    var accessError: String?
    var hasSnapshot: Bool { hasSubscriptionSnapshot || hasAccessSnapshot }
    var error: String? { subscriptionError ?? accessError }

    mutating func beginRefresh() {
        subscriptionRefreshed = false
        accessRefreshed = false
        subscriptionError = nil
        accessError = nil
    }
    mutating func receivedSubscription() {
        hasSubscriptionSnapshot = true
        subscriptionRefreshed = true
        subscriptionError = nil
    }
    mutating func receivedAccess() {
        hasAccessSnapshot = true
        accessRefreshed = true
        accessError = nil
    }
    mutating func timedOut() {
        if !subscriptionRefreshed {
            subscriptionError =
                subscriptionError
                ?? L10n.string("Membership details are taking longer to refresh. Try again.")
        }
        if !accessRefreshed {
            accessError =
                accessError ?? L10n.string("Family access is taking longer to refresh. Try again.")
        }
    }
}

struct SettingsMembershipCountdown {
    let label: String
    let remaining: String
    let date: Date
    /// Fraction of the original trial remaining. Missing dates never invent a trial duration.
    let trialFractionRemaining: Double?

    init?(subscription: SettingsSubscription?, access: SettingsAppAccess?, now: Date) {
        guard access?.usesFamilySubscription != true, let subscription,
            subscription.isActive, !subscription.isLifetime,
            ["active", "trialing", "canceled", "cancelled"].contains(
                subscription.status.lowercased()),
            let end = subscription.expiration, end > now
        else { return nil }
        date = end
        let seconds = end.timeIntervalSince(now)
        let days = Int(ceil(seconds / 86_400))
        remaining =
            seconds < 86_400
            ? L10n.string("Less than a day")
            : days == 1 ? L10n.string("1 day") : L10n.string("\(days) days")
        if subscription.isTrial {
            label = L10n.string("Trial remaining")
            if let start = subscription.purchaseDate, start < end, start <= now {
                trialFractionRemaining = min(1, max(0, seconds / end.timeIntervalSince(start)))
            } else {
                trialFractionRemaining = nil
            }
        } else {
            let recurringStore = ["app_store", "play_store", "stripe", "rc_billing"].contains(
                subscription.store?.lowercased() ?? "")
            let recurringPlan = ["monthly", "yearly", "annual"].contains(
                subscription.subscriptionType.lowercased())
            let nonRenewingPeriod = ["promotional", "prepaid"].contains(
                subscription.periodType?.lowercased() ?? "")
            label =
                !subscription.isCanceled && recurringStore && recurringPlan && !nonRenewingPeriod
                ? L10n.string("Next charge expected in") : L10n.string("Access remaining")
            trialFractionRemaining = nil
        }
    }
}

enum SettingsPickerOptions {
    static let popularCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR"]
    static let popularTimezones = [
        "America/New_York", "America/Chicago",
        "America/Denver", "America/Los_Angeles",
        "Europe/London", "Europe/Paris", "Asia/Tokyo",
        "Asia/Singapore", "Australia/Sydney",
    ]

    static func currencySymbol(_ code: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = L10n.locale
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        return formatter.currencySymbol ?? code
    }

    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}
