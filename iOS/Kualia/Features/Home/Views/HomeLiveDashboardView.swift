import SwiftUI

struct HomeLiveDashboardView: View {
    let store: HomeDashboardStore
    let budgetStore: BudgetStore
    let accountsStore: AccountsStore
    let transactionFeedStore: TransactionFeedStore
    var isActive: Bool
    let onSelectPage: (HomePage) -> Void
    var onSelectTransactionFilter: (TransactionFeedFilter) -> Void = { _ in }
    @State private var showsConnections = false
    @State private var showsPlanned = false

    private var budgetIsReady: Bool {
        budgetStore.workspace?.id == store.workspaceID && budgetStore.hasLoaded
            && !budgetStore.isRefreshing && budgetStore.errorMessage == nil
    }
    private var isLoading: Bool {
        store.isLoading(budget: budgetStore)
    }
    private var canReconcile: Bool {
        !isLoading && store.snapshot != nil && budgetIsReady
            && store.errorMessage == nil && store.connectionsError == nil
    }

    private var notices: [HomeNotice] {
        var result: [HomeNotice] = []
        if store.errorMessage != nil {
            result.append(
                unavailable(
                    id: "briefing", title: L10n.string("Your calendar couldn't update"),
                    message: L10n.string(
                        "Try again to check your upcoming payments and transactions.")))
        }
        if budgetStore.errorMessage != nil {
            result.append(
                unavailable(
                    id: "budget", title: L10n.string("Your budget couldn't be checked"),
                    message: L10n.string("Try again to see whether any envelopes need attention.")))
        } else if budgetIsReady, let data = store.snapshot {
            result += budgetStore.currentMonthOverspent
                .sorted {
                    $0.available == $1.available ? $0.id < $1.id : $0.available < $1.available
                }
                .compactMap { row in
                    HomeNotice.overspending(
                        id: row.id, name: row.name, available: row.available,
                        formattedAmount: data.money(
                            NSDecimalNumber(decimal: -row.available).stringValue),
                        month: budgetStore.currentMonth)
                }
            if let assignment = HomeNotice.readyToAssign(
                budgetStore.readyToAssign,
                formattedAmount: data.money(
                    NSDecimalNumber(decimal: budgetStore.readyToAssign).stringValue),
                month: budgetStore.currentMonth)
            {
                result.append(assignment)
            }
        }
        if store.connectionsError != nil {
            result.append(
                unavailable(
                    id: "connections", title: L10n.string("Your banks couldn't be checked"),
                    message: L10n.string("Try again to check the health of your bank connections."))
            )
        } else {
            result += store.connections.sorted { $0.id < $1.id }.compactMap { connection in
                HomeNotice.bankConnection(
                    id: connection.id, provider: connection.provider, name: connection.displayName,
                    status: connection.status, hasLinkedAccounts: connection.hasLinkedAccounts,
                    canManage: connection.canManageConnection)
            }
        }
        return result + (store.snapshot?.notices ?? [])
    }

    var body: some View {
        let notices = notices
        HomeInboxView(
            notices: notices, day: store.snapshot?.today ?? "",
            inbox: Binding(get: { store.inbox }, set: { store.updateInbox($0) }),
            isActive: isActive, isLoading: isLoading, canReconcile: canReconcile,
            feed: transactionFeedStore,
            onOpen: open, onRefresh: refresh
        )
        .sheet(isPresented: $showsConnections) {
            AccountSetupView(store: accountsStore, startsWithConnections: true)
        }
        .sheet(isPresented: $showsPlanned) {
            if let plans = transactionFeedStore.agenda {
                TransactionUpcomingPlansSheet(plans: plans, feed: transactionFeedStore)
            }
        }
    }

    private func open(_ notice: HomeNotice) {
        switch notice.destination {
        case .budget:
            budgetStore.selectCurrentMonth(filter: notice.budgetFilter)
            onSelectPage(.budget)
        case .accounts: onSelectPage(.accounts)
        case .transactions:
            onSelectTransactionFilter(notice.transactionFilter)
            onSelectPage(.transactions)
        case .planned: showsPlanned = true
        case .connections: showsConnections = true
        case .refresh: refresh()
        }
    }

    private func refresh() {
        store.retry()
        budgetStore.retry()
    }

    private func unavailable(id: String, title: String, message: String) -> HomeNotice {
        HomeNotice(
            id: "unavailable:\(id)", kind: .unavailable, eyebrow: L10n.string("COULDN'T CHECK"),
            title: title, message: message, actionTitle: L10n.string("Try again"),
            destination: .refresh,
            revision: id, isDismissible: false)
    }
}
