import Foundation
import Observation

nonisolated enum WidgetCaptureType: String { case expense, income, transfer }
nonisolated enum WidgetRoute: Equatable {
    case budget, accounts, planned, transactions, widgets
    case account(String)
    case plannedTransaction(String)
    case capture(WidgetCaptureType)
    case filteredTransactions(ShortcutTransactionFilter)

    init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == "kualia"
        else { return nil }
        switch components.host {
        case "budget": self = .budget
        case "accounts": self = .accounts
        case "account":
            guard let id = url.pathComponents.dropFirst().first, !id.isEmpty else { return nil }
            self = .account(id)
        case "planned":
            if let id = url.pathComponents.dropFirst().first, !id.isEmpty {
                self = .plannedTransaction(id)
            } else {
                self = .planned
            }
        case "transactions": self = .transactions
        case "widgets", "widget-backgrounds": self = .widgets
        case "new-transaction", "add-transaction":
            let type = components.queryItems?.first { $0.name == "type" }?.value ?? "expense"
            guard let capture = WidgetCaptureType(rawValue: type) else { return nil }
            self = .capture(capture)
        default: return nil
        }
    }
}

@MainActor
@Observable
final class WidgetNavigationStore {
    struct Request: Identifiable {
        enum WorkspaceResolution: Equatable {
            case ready
            case switchWorkspace(String)
            case unavailable
        }

        let id = UUID()
        let route: WidgetRoute
        var draft: TransactionShortcutDraft? = nil
        var workspaceID: String? = nil

        func resolveWorkspace(currentID: String?, accessibleIDs: [String]) -> WorkspaceResolution {
            guard let workspaceID else { return .ready }
            guard accessibleIDs.contains(workspaceID) else { return .unavailable }
            return workspaceID == currentID ? .ready : .switchWorkspace(workspaceID)
        }
    }
    var pending: Request?

    func openTransactionNotification(workspaceID: String?) {
        pending = Request(route: .filteredTransactions(.needsReview), workspaceID: workspaceID)
    }

    func open(_ url: URL) {
        guard let route = WidgetRoute(url: url) else { return }
        pending = Request(route: route)
    }

    func consumeControlAction(
        defaults: UserDefaults? = UserDefaults(suiteName: PendingAppActionStore.appGroupSuiteName)
    ) {
        guard let action = PendingAppActionStore.consume(defaults: defaults) else { return }
        switch action {
        case .newTransaction(let draft):
            let type: WidgetCaptureType =
                switch draft?.direction {
                case .transfer: .transfer
                case .inflow: .income
                default: .expense
                }
            pending = Request(route: .capture(type), draft: draft)
        case .transactions(let filter):
            pending = Request(route: .filteredTransactions(filter))
        }
    }
}
