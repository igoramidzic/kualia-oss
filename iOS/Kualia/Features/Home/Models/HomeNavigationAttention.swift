import Foundation

enum HomeAttentionLevel: Equatable {
    case issue, newActivity

    var title: String {
        switch self {
        case .issue: L10n.string("Needs attention")
        case .newActivity: L10n.string("New to review")
        }
    }
}

struct HomeAttentionStatus: Equatable {
    let level: HomeAttentionLevel
    let message: String
    /// Number of active conditions at this severity, not affected transactions.
    var count = 1

    static func combined(_ statuses: [Self]) -> Self? {
        guard !statuses.isEmpty else { return nil }
        let level: HomeAttentionLevel =
            statuses.contains { $0.level == .issue } ? .issue : .newActivity
        return Self(
            level: level,
            message: statuses.map(\.message).joined(separator: ". "),
            count: statuses.filter { $0.level == level }.reduce(0) { $0 + $1.count })
    }
}

struct HomeWorkspaceAttention: Decodable, Equatable {
    let workspaceId: String
    let currentMonth: Int
    let timezone: String
    var hasOverspending = false
    var hasOverassignment = false
    var hasMissingCategory = false
    var hasMissingPayee = false
    var hasNewTransactions = false

    var budget: HomeAttentionStatus? {
        var messages: [String] = []
        if hasOverspending { messages.append(L10n.string("Overspent categories this month")) }
        if hasOverassignment { messages.append(L10n.string("Budget is overassigned")) }
        return messages.isEmpty
            ? nil
            : .init(level: .issue, message: messages.joined(separator: ". "), count: messages.count)
    }

    var transactions: HomeAttentionStatus? {
        var messages: [String] = []
        if hasMissingCategory { messages.append(L10n.string("Transactions need a category")) }
        if hasMissingPayee { messages.append(L10n.string("Transactions need a payee")) }
        if hasNewTransactions { messages.append(L10n.string("New transactions to review")) }
        guard !messages.isEmpty else { return nil }
        let issueCount = [hasMissingCategory, hasMissingPayee].filter { $0 }.count
        return .init(
            level: issueCount > 0 ? .issue : .newActivity,
            message: messages.joined(separator: ". "), count: max(1, issueCount))
    }

    var status: HomeAttentionStatus? {
        .combined([budget, transactions].compactMap { $0 })
    }

    func needsMonthRefresh(now: Date) -> Bool {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone) ?? .gmt
        let parts = calendar.dateComponents([.year, .month], from: now)
        return (parts.year ?? 0) * 100 + (parts.month ?? 0) != currentMonth
    }
}

/// Resolve page status against the displayed workspace, never a pending switch.
struct HomeNavigationAttention {
    var values: [HomeWorkspaceAttention] = []
    var accessibleWorkspaceIDs: Set<String> = []
    var selectedWorkspaceID: String?

    func workspace(_ id: String) -> HomeWorkspaceAttention? {
        guard accessibleWorkspaceIDs.contains(id) else { return nil }
        return values.first { $0.workspaceId == id }
    }

    var current: HomeWorkspaceAttention? { selectedWorkspaceID.flatMap(workspace) }

    var menu: HomeAttentionStatus? {
        .combined(accessibleValues.compactMap(\.status))
    }

    var otherWorkspaces: HomeAttentionStatus? {
        .combined(
            accessibleValues.filter { $0.workspaceId != selectedWorkspaceID }.compactMap(\.status))
    }

    var otherWorkspaceCount: Int {
        Set(
            accessibleValues.filter {
                $0.workspaceId != selectedWorkspaceID && $0.status != nil
            }.map(\.workspaceId)
        ).count
    }

    private var accessibleValues: [HomeWorkspaceAttention] {
        values.filter { accessibleWorkspaceIDs.contains($0.workspaceId) }
    }
}

/// Badges describe the displayed workspace and keep secondary-page issues on the menu.
struct HomeNavigationBadges: Equatable {
    var transactionCount = 0
    var transactionCountIsComplete = true
    var pageStatuses: [HomePage: HomeAttentionStatus] = [:]
    var settingsStatus: HomeAttentionStatus?
    var otherWorkspacesStatus: HomeAttentionStatus?
    var otherWorkspaceCount = 0
    var statusError: String?

    var budgetBadgeValue: String? {
        guard let count = pageStatuses[.budget]?.count, count > 0 else { return nil }
        return String(count)
    }

    var transactionBadgeValue: String? {
        guard transactionCount > 0 else {
            return pageStatuses[.transactions] == nil ? nil : ""
        }
        return "\(transactionCount)\(transactionCountIsComplete ? "" : "+")"
    }

    var menuBadgeCount: Int {
        [settingsStatus, pageStatuses[.reports]]
            .compactMap { $0 }.reduce(0) { $0 + $1.count }
            + (otherWorkspacesStatus?.count ?? otherWorkspaceCount)
            + (statusError == nil ? 0 : 1)
    }

    var menuBadgeValue: String? { menuBadgeCount > 0 ? String(menuBadgeCount) : nil }

    /// Count only destinations exposed by the tabs and menu. Transaction review
    /// already includes its issue rows, so do not add those conditions again.
    var appIconBadgeCount: Int {
        menuBadgeCount + max(0, pageStatuses[.budget]?.count ?? 0)
            + max(transactionCount, pageStatuses[.transactions]?.count ?? 0)
            + max(0, pageStatuses[.accounts]?.count ?? 0)
    }

    var menuStatus: HomeAttentionStatus? {
        .combined(
            [
                settingsStatus, pageStatuses[.reports], otherWorkspacesStatus,
                statusError.map { .init(level: .issue, message: $0) },
            ].compactMap { $0 })
    }
}
