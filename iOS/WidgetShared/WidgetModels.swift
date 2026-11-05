import Foundation

/// Response from /widget/category-available endpoint
nonisolated struct CategoryAvailableResponse: Codable {
    let categories: [CategoryAvailableItem]
    let currencyCode: String
    let month: String
}

nonisolated struct CategoryAvailableItem: Codable {
    let categoryName: String
    let available: Int
    let assigned: Int
    let activity: Int
    let hasUnmetTarget: Bool
}

/// Response from /widget/upcoming-transactions endpoint
nonisolated struct UpcomingTransactionsResponse: Codable {
    let transactions: [UpcomingTransaction]
    let currencyCode: String
}

nonisolated struct UpcomingTransaction: Codable, Identifiable {
    let recurringTransactionId: String
    let merchantName: String
    let amount: Int
    let dueDate: String
    let isOverdue: Bool
    var isIncome: Bool? = nil

    var id: String { "\(recurringTransactionId)_\(dueDate)" }
}

/// Error response from widget endpoints
nonisolated struct WidgetErrorResponse: Codable {
    let error: String
}

// MARK: - Account Balances Widget

/// Response from /widget/account-balances endpoint
nonisolated struct AccountBalancesResponse: Codable {
    let groups: [AccountGroup]
    let totalAssets: Int
    let totalLiabilities: Int
    let netWorth: Int
    let currencyCode: String
}

nonisolated struct AccountGroup: Codable, Identifiable {
    let category: String
    let accounts: [AccountBalance]
    let subtotal: Int

    var id: String { category }

    var displayName: String {
        switch category {
        case "banking": return WidgetL10n.string("Cash")
        case "credit": return WidgetL10n.string("Credit")
        case "investment": return WidgetL10n.string("Investment")
        case "loan": return WidgetL10n.string("Loan")
        default: return category.capitalized
        }
    }
}

nonisolated struct AccountBalance: Codable, Identifiable {
    let accountId: String
    let name: String
    let accountType: String
    let balance: Int

    var id: String { accountId }
}
nonisolated struct BudgetPulseResponse: Codable {
    let workspaceName: String
    let currencyCode: String
    let month: String
    let today: String
    let daysRemaining: Int
    let totalAvailable: Int
    let totalAssigned: Int
    let totalActivity: Int
    let overspentCount: Int
    let overspentAmount: Int
}

nonisolated enum WidgetBalanceLayout: CaseIterable {
    case small, medium, large, accessory

    var capacity: Int {
        switch self {
        case .small, .accessory: 1
        case .medium: 3
        case .large: 6
        }
    }
}

nonisolated struct WidgetBalanceRow: Identifiable {
    let id: String
    let title: String
    let amount: Int
}

nonisolated enum WidgetBalanceSelection {
    static func selectedIDs(_ selections: [String?], layout: WidgetBalanceLayout) -> [String] {
        // Lock Screen configuration exposes only the first slot. Hidden choices from
        // a previous Home Screen placement must never substitute for that selection.
        let visibleSelections = layout == .accessory ? Array(selections.prefix(1)) : selections
        return uniqueIDs(visibleSelections, limit: layout.capacity)
    }

    /// Empty slots and duplicate choices do not displace the next selected item.
    static func uniqueIDs(_ selections: [String?], limit: Int) -> [String] {
        var seen = Set<String>()
        return Array(
            selections.compactMap { $0 }.filter {
                !$0.isEmpty && seen.insert($0).inserted
            }.prefix(max(0, limit)))
    }

    /// The API groups accounts by type, so restore the user's selection order.
    /// A missing selection stays missing; never substitute an aggregate or another account.
    static func accounts(in response: AccountBalancesResponse, selectedIDs: [String])
        -> [AccountBalance]
    {
        let accounts = response.groups.flatMap(\.accounts)
        return uniqueIDs(selectedIDs, limit: selectedIDs.count).compactMap { id in
            accounts.first { $0.id == id }
        }
    }
}

extension CategoryAvailableResponse {
    nonisolated var balanceRows: [WidgetBalanceRow] {
        categories.enumerated().map { index, category in
            WidgetBalanceRow(
                id: String(index), title: category.categoryName, amount: category.available)
        }
    }
}
