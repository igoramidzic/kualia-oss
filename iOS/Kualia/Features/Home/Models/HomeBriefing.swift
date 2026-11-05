import Foundation

/// Home only needs connection health and whether a bank has accounts in this workspace.
struct HomeBankConnection: Decodable, Equatable, Identifiable {
    struct Account: Decodable, Equatable {
        struct LinkedAccount: Decodable, Equatable { let _id: String }
        let isLinked: Bool
        let linkedToBankAccount: LinkedAccount?
    }
    let id: String
    let provider: String
    let displayName: String
    let status: String
    let canManageConnection: Bool
    let accounts: [Account]
    var hasLinkedAccounts: Bool {
        accounts.contains { $0.isLinked || $0.linkedToBankAccount != nil }
    }
}

struct HomeBriefing: Decodable, Equatable {
    struct Workspace: Decodable, Equatable {
        let id: String
        let name: String
        let currencyCode: String
        let minorUnit: Int
        let timezoneIdentifier: String
    }
    struct Entry: Decodable, Equatable, Identifiable {
        let id: String
        let name: String
        let accountName: String
        let date: String
        let amount: String
    }
    struct Attention: Decodable, Equatable {
        let count: Int
        let hasMore: Bool
        let items: [Entry]
        var countLabel: String { "\(count)\(hasMore ? "+" : "")" }
    }
    struct Occurrence: Decodable, Equatable, Identifiable {
        let logoUrl: String?
        let id: String
        let name: String
        let accountName: String
        let date: String
        let day: Int
        let amount: String
        let isTransfer: Bool
        let transferToAccountName: String?
        var timing: String {
            day == 0 ? L10n.string("Today") : day == 1 ? L10n.string("Tomorrow") : date
        }
    }
    struct Account: Decodable, Equatable, Identifiable {
        struct Point: Decodable, Equatable, Identifiable {
            let day: Int
            let amount: String
            var id: Int { day }
        }
        let id: String
        let name: String
        let currentBalance: String
        let points: [Point]
        let lowestDay: Int
        let lowestBalance: String
        let hasUpcoming: Bool
    }
    struct Spending: Decodable, Equatable {
        let current: String
        let previous: String
        let currentStart: String
        let previousStart: String
    }
    let workspace: Workspace
    let today: String
    let throughDate: String
    let isPartial: Bool
    let reviews: Attention
    let uncategorized: Attention
    let accounts: [Account]
    let upcoming: [Occurrence]
    let upcomingCount: Int
    let overdue: [Occurrence]
    let overdueCount: Int
    let incoming: String
    let outgoing: String
    let spending: Spending?

    var atRisk: [Account] { accounts.filter { (Decimal(string: $0.lowestBalance) ?? 0) < 0 } }
    func amount(_ minorUnits: String) -> Decimal {
        (Decimal(string: minorUnits, locale: Locale(identifier: "en_US_POSIX")) ?? 0)
            / pow(Decimal(10), workspace.minorUnit)
    }
    func money(_ minorUnits: String) -> String {
        amount(minorUnits).formatted(.currency(code: workspace.currencyCode).locale(L10n.locale))
    }
}

extension HomeBriefing {
    var notices: [HomeNotice] {
        var result: [HomeNotice] = []
        if isPartial {
            result.append(
                HomeNotice(
                    id: "briefing-partial", kind: .unavailable,
                    eyebrow: L10n.string("UNABLE TO CHECK EVERYTHING"),
                    title: L10n.string("Some information is missing"),
                    message:
                        L10n.string(
                            "Review Accounts and Planned. Your full payment outlook isn't available yet."
                        ),
                    actionTitle: L10n.string("Open planned"), destination: .planned,
                    revision: "partial",
                    isDismissible: false))
        }
        result += atRisk.map { account in
            let timing =
                account.lowestDay == 0
                ? L10n.string("today") : L10n.string("in \(account.lowestDay) days")
            return HomeNotice(
                id: "balance:\(account.id)", kind: .balance,
                eyebrow: L10n.string("ACCOUNT OUTLOOK"),
                title: account.lowestDay == 0 && amount(account.currentBalance) < 0
                    ? L10n.string("\(account.name) is below zero")
                    : L10n.string("\(account.name) could dip below zero"),
                message:
                    L10n.string(
                        "Possible low \(timing), based on recurring payments. Other spending isn't included."
                    ),
                amount: money(account.lowestBalance), actionTitle: L10n.string("Open accounts"),
                destination: .accounts,
                revision: "\(account.currentBalance):\(account.lowestBalance):\(account.lowestDay)")
        }
        if overdueCount > 0 {
            result.append(
                HomeNotice(
                    id: "overdue", kind: .overdue, eyebrow: L10n.string("PLANNED PAYMENTS"),
                    title:
                        L10n.string(
                            "\(overdueCount) \(overdueCount == 1 ? L10n.string("payment needs") : L10n.string("payments need")) a check"
                        ),
                    message: L10n.string(
                        "These dates have passed. Check whether the payments happened."),
                    actionTitle: L10n.string("Review planned"), destination: .planned,
                    revision: "\(overdueCount):"
                        + overdue.map { "\($0.id):\($0.amount)" }.sorted().joined(separator: ",")))
        }
        if reviews.count > 0 {
            result.append(
                HomeNotice(
                    id: "reviews", kind: .review, eyebrow: "TRANSACTIONS",
                    title: L10n.string("\(reviews.countLabel) ready for a review"),
                    message: L10n.string(
                        "Check the amounts and categories on your imported transactions."),
                    actionTitle: L10n.string("Review transactions"), destination: .transactions,
                    revision: attentionRevision(reviews)))
        }
        if uncategorized.count > 0 {
            result.append(
                HomeNotice(
                    id: "uncategorized", kind: .category, eyebrow: L10n.string("YOUR ENVELOPES"),
                    title: L10n.string("\(uncategorized.countLabel) need a category"),
                    message: L10n.string("Give these transactions a place in your budget."),
                    actionTitle: L10n.string("Add categories"), destination: .transactions,
                    revision: attentionRevision(uncategorized)))
        }
        result += upcoming.filter { (0...1).contains($0.day) }.map { item in
            let direction =
                item.isTransfer
                ? "\(item.accountName) → \(item.transferToAccountName ?? L10n.string("Account"))"
                : L10n.string(
                    "Scheduled \(amount(item.amount) > 0 ? L10n.string("into") : L10n.string("from")) \(item.accountName)."
                )
            return HomeNotice(
                id: "upcoming:\(item.id)", kind: .upcoming, eyebrow: item.timing.uppercased(),
                title: item.name, message: direction, amount: money(item.amount),
                actionTitle: L10n.string("View planned"), destination: .planned,
                revision:
                    "\(item.id):\(item.amount):\(item.accountName):\(item.transferToAccountName ?? "")"
            )
        }
        // The server bounds the list. Keep an honest prompt when near-term occurrences can be omitted.
        if upcomingCount > upcoming.count, let last = upcoming.last, last.day <= 1 {
            result.append(
                HomeNotice(
                    id: "upcoming-more", kind: .upcoming, eyebrow: L10n.string("COMING UP"),
                    title: L10n.string("More payments are planned"),
                    message:
                        L10n.string(
                            "Open Planned to see all \(upcomingCount) payments in the next 7 days."),
                    actionTitle: L10n.string("View all planned"), destination: .planned,
                    revision: "\(upcomingCount):\(today)"))
        }
        return result
    }

    private func attentionRevision(_ group: Attention) -> String {
        "\(group.countLabel):"
            + group.items.map { "\($0.id):\($0.amount):\($0.date)" }.sorted().joined(separator: ",")
    }
}

extension HomeNotice {
    static func readyToAssign(_ amount: Decimal, formattedAmount: String, month: Int) -> Self? {
        guard amount != 0 else { return nil }
        return Self(
            id: "budget:ready-to-assign", kind: amount > 0 ? .allocation : .overspent,
            eyebrow: "BUDGET",
            title: amount > 0
                ? L10n.string("Money ready to assign") : L10n.string("Your budget is overassigned"),
            message: amount > 0
                ? L10n.string("Give this money a place in your envelopes.")
                : L10n.string("Move money out of envelopes to bring your budget back in balance."),
            amount: formattedAmount, actionTitle: L10n.string("Open budget"), destination: .budget,
            revision: "\(month):\(amount)", budgetFilter: amount > 0 ? .underfunded : .all)
    }

    static func overspending(
        id: String, name: String, available: Decimal, formattedAmount: String, month: Int
    ) -> Self? {
        guard available < 0 else { return nil }
        return Self(
            id: "budget:\(id)", kind: .overspent, eyebrow: L10n.string("BUDGET · THIS MONTH"),
            title: L10n.string("\(name) is overspent"),
            message: L10n.string("Move money into this envelope to cover the difference."),
            amount: formattedAmount, actionTitle: L10n.string("Open budget"), destination: .budget,
            revision: "\(month):\(available)", budgetFilter: .overspent)
    }

    static func bankConnection(
        id: String, provider: String, name: String, status: String,
        hasLinkedAccounts: Bool, canManage: Bool
    ) -> Self? {
        guard hasLinkedAccounts, status != "connected", status != "pending" else { return nil }
        return Self(
            id: "connection:\(provider):\(id)", kind: .connection,
            eyebrow: L10n.string("BANK CONNECTION"),
            title: status == "disconnected"
                ? L10n.string("\(name) is disconnected") : L10n.string("\(name) needs a check-in"),
            message: canManage
                ? L10n.string("New activity may be delayed. Check your connection.")
                : L10n.string(
                    "The connection owner needs to check this bank. New activity may be delayed."),
            actionTitle: L10n.string("View connections"), destination: .connections,
            revision: "\(status):\(canManage)")
    }
}
