import CryptoKit
import Foundation

enum HomeInboxContentState {
    case loading, briefing, empty

    init(isLoading: Bool, visibleCount: Int) {
        // Cached or partial notices must never appear before all sources settle.
        self = isLoading ? .loading : (visibleCount == 0 ? .empty : .briefing)
    }
}

/// A notice is a prompt to look at something, never a financial mutation.
struct HomeNotice: Identifiable, Equatable {
    enum Kind: String {
        case overspent, allocation, connection, balance, review, category, overdue, upcoming,
            unavailable
    }
    enum Destination { case budget, accounts, transactions, planned, connections, refresh }

    let id: String
    let kind: Kind
    let eyebrow: String
    let title: String
    let message: String
    var amount: String? = nil
    let actionTitle: String
    let destination: Destination
    /// Only meaningful source changes undo a dismissal, not formatting or unrelated updates.
    let revision: String
    var isDismissible = true
    var budgetFilter = BudgetCategoryFilter.all

    var transactionFilter: TransactionFeedFilter {
        switch kind {
        case .review: .needsReview
        case .category: .needsReview
        default: .all
        }
    }

    var isUpcoming: Bool { kind == .upcoming }
    var fingerprint: String {
        SHA256.hash(data: Data(revision.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Keep only today's acknowledgements. A resolved issue is removed so a recurrence is visible again.
struct HomeInboxState: Codable, Equatable {
    private(set) var day = ""
    private(set) var dismissed: [String: String] = [:]

    func visible(in notices: [HomeNotice]) -> [HomeNotice] {
        notices.filter { !isDismissed($0) }
    }

    func isDismissed(_ notice: HomeNotice) -> Bool {
        guard notice.isDismissible, let fingerprint = dismissed[notice.id] else { return false }
        return fingerprint == notice.fingerprint
    }

    mutating func prepare(day: String) {
        guard !day.isEmpty else { return }
        if self.day != day {
            self.day = day
            dismissed = [:]
        }
    }

    mutating func reconcile(notices: [HomeNotice], day: String) {
        prepare(day: day)
        guard !dismissed.isEmpty else { return }
        let current = Dictionary(
            notices.filter { dismissed[$0.id] != nil }.map { ($0.id, $0.fingerprint) },
            uniquingKeysWith: { _, last in last })
        dismissed = dismissed.filter { current[$0.key] == $0.value }
    }

    mutating func dismiss(_ notice: HomeNotice) {
        guard notice.isDismissible else { return }
        dismissed[notice.id] = notice.fingerprint
    }

    mutating func restore(_ notice: HomeNotice) { dismissed[notice.id] = nil }
    mutating func restoreAll() { dismissed = [:] }
}

enum HomeDashboardScenario: String, CaseIterable, Identifiable {
    case needsAttention, quietDay, allSet
    var id: Self { self }
    var title: String {
        switch self {
        case .needsAttention: L10n.string("A few things to check")
        case .quietDay: L10n.string("Just tomorrow's payment")
        case .allSet: L10n.string("All done")
        }
    }

    /// Preview data uses the same presentation and dismissal behavior as the live inbox.
    var notices: [HomeNotice] {
        let payment = HomeNotice(
            id: "sample-payment", kind: .upcoming, eyebrow: "TOMORROW",
            title: L10n.string("Spotify"),
            message: L10n.string("Scheduled from Checking."), amount: "$12.99",
            actionTitle: L10n.string("View planned"), destination: .planned,
            revision: "spotify:1299")
        switch self {
        case .needsAttention:
            return [
                HomeNotice(
                    id: "sample-budget", kind: .overspent,
                    eyebrow: L10n.string("BUDGET · THIS MONTH"),
                    title: L10n.string("Dining out is overspent"),
                    message: L10n.string("Move a little money into this envelope."),
                    amount: "$42.80", actionTitle: L10n.string("Open budget"), destination: .budget,
                    revision: "dining:4280"),
                HomeNotice(
                    id: "sample-bank", kind: .connection, eyebrow: L10n.string("BANK CONNECTION"),
                    title: L10n.string("Chase needs a check-in"),
                    message: L10n.string(
                        "Your connection needs attention. New activity may be delayed."),
                    actionTitle: L10n.string("View connections"), destination: .connections,
                    revision: "chase:needs_attention"),
                payment,
            ]
        case .quietDay: return [payment]
        case .allSet: return []
        }
    }
}

enum HomeDashboardDate {
    static func title(
        for date: Date, locale: Locale = L10n.locale,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> String {
        date.formatted(
            Date.FormatStyle(locale: locale, timeZone: timeZone)
                .weekday(.abbreviated).month(.abbreviated).day())
    }
}
