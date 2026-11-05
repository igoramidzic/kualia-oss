import Observation
import SwiftUI

/// Coordinate page selection with showing or hiding RTA. Keep the current Peek
/// during a same-workspace handoff and reject completions from older navigation.
nonisolated struct HomeBudgetPeekNavigation {
    struct Request {
        let id = UUID()
        let isBudgetSelected: Bool
    }

    private struct Closing {
        let id: UUID
        let background: Color
    }

    private(set) var request: Request?
    private var isBudgetPresented = false
    private var workspaceID: String?
    private var closing: Closing?

    func isActive(workspaceID: String?) -> Bool {
        isBudgetPresented && workspaceID != nil && self.workspaceID == workspaceID
    }

    func closingBackground(workspaceID: String?) -> Color? {
        guard workspaceID != nil, self.workspaceID == workspaceID else { return nil }
        return closing?.background
    }

    mutating func navigate(workspaceID: String?, isBudgetSelected: Bool) {
        if self.workspaceID != workspaceID {
            isBudgetPresented = false
            closing = nil
        } else if isBudgetSelected, closing != nil {
            // Reverse an in-flight close immediately when returning to Budget.
            isBudgetPresented = true
            closing = nil
        }
        self.workspaceID = workspaceID
        request =
            workspaceID != nil && isBudgetPresented != isBudgetSelected
            ? Request(isBudgetSelected: isBudgetSelected) : nil
    }

    mutating func finish(id: UUID, closingBackground: Color? = nil) {
        guard let request, request.id == id else { return }
        if isBudgetPresented, !request.isBudgetSelected, let closingBackground {
            closing = Closing(id: id, background: closingBackground)
        }
        isBudgetPresented = request.isBudgetSelected
        self.request = nil
    }

    mutating func finishClosing(id: UUID) {
        guard closing?.id == id else { return }
        closing = nil
    }
}

enum HomePage: String, CaseIterable, Identifiable {
    case budget
    case transactions
    case accounts
    case planned
    case reports
    case home

    var id: Self { self }

    static let tabPages: [HomePage] = [.budget, .transactions, .accounts]

    // Planned lives inside Transactions. Settings opens as a modal from the menu.
    static var navigationPages: [HomePage] {
        allCases.filter { $0 != .planned }
    }

    // The menu grows upward from the launcher, with Budget nearest the button.
    static var menuItems: [HomePage] {
        navigationPages.reversed()
    }

    var title: String {
        switch self {
        case .home: L10n.string("Calendar")
        case .transactions: L10n.string("Spending")
        case .budget: L10n.string("Budget")
        case .accounts: L10n.string("Accounts")
        case .planned: L10n.string("Planned")
        case .reports: L10n.string("Reports")
        }
    }

    var icon: KualiaIcon {
        switch self {
        case .home: .calendarClock
        case .transactions: .transactions
        case .budget: .email
        case .accounts: .bank
        case .planned: .calendarFilled
        case .reports: .reports
        }
    }

    var background: Color {
        switch self {
        case .home: KualiaPalette.canvas
        case .transactions: KualiaPalette.transactionsPage
        case .budget: KualiaPalette.budgetPage
        case .accounts: KualiaPalette.accountsPage
        case .planned: KualiaPalette.plannedPage
        case .reports: KualiaPalette.reportsPage
        }
    }

    var accent: Color {
        .accentColor
    }

    var glow: Color {
        switch self {
        case .home: KualiaPalette.homeGlow
        case .budget: KualiaPalette.budgetGlow
        case .transactions: KualiaPalette.transactionsGlow
        case .accounts: KualiaPalette.accountsGlow
        case .planned: KualiaPalette.plannedGlow
        case .reports: KualiaPalette.reportsGlow
        }
    }
}

@MainActor
@Observable
final class HomeNavigationState {
    private(set) var selectedPage: HomePage = .budget
    private(set) var mountedPages: Set<HomePage> = [.budget]
    private(set) var transactionScrollToTopRequest = 0
    private(set) var budgetScrollToTopRequest = 0
    private(set) var accountsScrollToTopRequest = 0

    func restore(_ page: HomePage) {
        selectedPage = page == .planned ? .transactions : page
        mountedPages = [selectedPage]
        transactionScrollToTopRequest = 0
        budgetScrollToTopRequest = 0
        accountsScrollToTopRequest = 0
    }

    func select(_ page: HomePage) {
        let page = page == .planned ? .transactions : page
        if page == selectedPage {
            switch page {
            case .transactions: transactionScrollToTopRequest += 1
            case .budget: budgetScrollToTopRequest += 1
            case .accounts: accountsScrollToTopRequest += 1
            default: break
            }
        }
        // An Observable Set's modify accessor invalidates its readers even
        // when insert finds an existing member. Only mount on the first visit.
        if !mountedPages.contains(page) { mountedPages.insert(page) }
        if selectedPage != page { selectedPage = page }
    }
}

/// Data readiness and visible presentation are separate. A newly prepared
/// workspace remains hidden until its own view tree reports a completed layout.
struct HomeContentPresentation {
    private(set) var laidOutSessionID: UUID?

    func isVisible(sessionID: UUID?, isTransitioning: Bool) -> Bool {
        !isTransitioning && sessionID == laidOutSessionID
    }

    mutating func didLayout(sessionID: UUID, currentSessionID: UUID?) {
        guard sessionID == currentSessionID else { return }
        laidOutSessionID = sessionID
    }
}
