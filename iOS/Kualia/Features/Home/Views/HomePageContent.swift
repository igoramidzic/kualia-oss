import SwiftUI

struct HomePageContent: View {
    @Environment(\.homeControlDock) private var dock
    @Environment(\.peekContentBottomInset) private var peekBottomInset
    let selectedPage: HomePage
    var glowScrollState: HomeGlowScrollState? = nil
    let mountedPages: Set<HomePage>
    let transactionFeedStore: TransactionFeedStore
    let budgetStore: BudgetStore
    var homeStore: HomeDashboardStore? = nil
    var onSelectPage: (HomePage) -> Void = { _ in }
    let accountsStore: AccountsStore
    var reportsStore: ReportsStore = .preview
    var onSelectAccount: (String) -> Void = { _ in }
    var onAccountCreated: (TransactionMutationReceipt) -> Void = { _ in }
    let transactionScrollToTopRequest: Int
    var budgetScrollToTopRequest = 0
    var accountsScrollToTopRequest = 0
    var accountCreationRequest = 0
    var editingBudgetCategoryID: String? = nil
    var onEditBudgetAmount: (String) -> Void = { _ in }
    var onMoveBudgetMoney: (String) -> Void = { _ in }
    var onOpenBudgetCategory: (String) -> Void = { _ in }
    var onChangeBudgetMonth: () -> Void = {}
    var showsTabBar = true
    var canAddTransaction = true
    var onAddTransaction: () -> Void = {}
    var onOpenAssistant: () -> Void = {}
    var appSession: AppSessionStore? = nil
    var onSelectWorkspace: (AppWorkspace) -> Void = { _ in }

    var body: some View {
        HomePageContainer(
            selectedPage: selectedPage, mountedPages: mountedPages,
            showsTabBar: showsTabBar, canAddTransaction: canAddTransaction,
            onSelectPage: onSelectPage, onAddTransaction: onAddTransaction,
            onOpenAssistant: onOpenAssistant,
            appSession: appSession, onSelectWorkspace: onSelectWorkspace, badges: navigationBadges
        ) { page in
            HomePageScene(
                page: page,
                isActive: selectedPage == page,
                transactionFeedStore: transactionFeedStore,
                budgetStore: budgetStore,
                homeStore: homeStore,
                onSelectPage: onSelectPage,
                accountsStore: accountsStore,
                reportsStore: reportsStore,
                onSelectAccount: onSelectAccount,
                onAccountCreated: onAccountCreated,
                transactionScrollToTopRequest: page == .transactions
                    ? transactionScrollToTopRequest : 0,
                budgetScrollToTopRequest: page == .budget ? budgetScrollToTopRequest : 0,
                accountsScrollToTopRequest: page == .accounts ? accountsScrollToTopRequest : 0,
                accountCreationRequest: page == .accounts ? accountCreationRequest : 0,
                editingBudgetCategoryID: page == .budget && selectedPage == page
                    ? editingBudgetCategoryID : nil,
                onEditBudgetAmount: onEditBudgetAmount,
                onMoveBudgetMoney: onMoveBudgetMoney,
                onOpenBudgetCategory: onOpenBudgetCategory,
                onChangeBudgetMonth: onChangeBudgetMonth
            )
            .equatable()
            .background {
                // Native tab hosts own their backgrounds. Keep the scrolling
                // glow with its page and extend it behind the shared home bars.
                HomeBackground(page: page, scrollState: glowScrollState)
                    .padding(dock?.edge == .leading ? .leading : .trailing, -(dock?.width ?? 0))
                    .padding(.bottom, -peekBottomInset)
                    .ignoresSafeArea(.container)
            }
            .environment(
                \.homeGlowScrollReporting,
                HomeGlowScrollReporting(state: glowScrollState, page: page))
        }
        .onChange(of: appIconBadgeCount, initial: true) { _, count in
            guard let count else { return }
            SettingsNotifications.shared.handler.updateBadgeCount(count)
        }
    }

    private var appIconBadgeCount: Int? {
        guard let appSession, appSession.current?.transactions === transactionFeedStore,
            appSession.navigationAttention.hasLoaded, transactionFeedStore.hasLoaded
        else { return nil }
        return navigationBadges.appIconBadgeCount
    }

    private var navigationBadges: HomeNavigationBadges {
        let attention =
            appSession?.navigationAttention.summary(
                workspaces: appSession?.workspaces ?? [],
                selectedWorkspaceID: transactionFeedStore.workspace?.id) ?? .init()
        func issue(_ message: String?) -> HomeAttentionStatus? {
            message.map { .init(level: .issue, message: $0) }
        }
        let connectionNotices =
            homeStore?.connections.compactMap {
                HomeNotice.bankConnection(
                    id: $0.id, provider: $0.provider, name: $0.displayName, status: $0.status,
                    hasLinkedAccounts: $0.hasLinkedAccounts, canManage: $0.canManageConnection)
            } ?? []
        var statuses: [HomePage: HomeAttentionStatus] = [:]
        statuses[.budget] = .combined(
            [
                attention.current?.budget, issue(budgetStore.errorMessage),
            ].compactMap { $0 })
        statuses[.transactions] = .combined(
            [
                attention.current?.transactions, issue(transactionFeedStore.errorMessage),
            ].compactMap { $0 })
        statuses[.accounts] = issue(accountsStore.errorMessage)
        statuses[.reports] = issue(reportsStore.errorMessage)
        return .init(
            transactionCount: transactionFeedStore.filterCounts.needsReview,
            transactionCountIsComplete: transactionFeedStore.filterCountsAreComplete,
            pageStatuses: statuses,
            settingsStatus: .combined(
                [issue(homeStore?.connectionsError)].compactMap { $0 }
                    + connectionNotices.map { .init(level: .issue, message: $0.title) }),
            otherWorkspacesStatus: attention.otherWorkspaces,
            otherWorkspaceCount: attention.otherWorkspaceCount,
            statusError: appSession?.catalogError ?? appSession?.navigationAttention.errorMessage)
    }

}

private struct HomePageScene: View, Equatable {
    let page: HomePage
    let isActive: Bool
    let transactionFeedStore: TransactionFeedStore
    let budgetStore: BudgetStore
    var homeStore: HomeDashboardStore? = nil
    var onSelectPage: (HomePage) -> Void = { _ in }
    let accountsStore: AccountsStore
    var reportsStore: ReportsStore = .preview
    var onSelectAccount: (String) -> Void = { _ in }
    var onAccountCreated: (TransactionMutationReceipt) -> Void = { _ in }
    let transactionScrollToTopRequest: Int
    var budgetScrollToTopRequest = 0
    var accountsScrollToTopRequest = 0
    var accountCreationRequest = 0
    let editingBudgetCategoryID: String?
    let onEditBudgetAmount: (String) -> Void
    let onMoveBudgetMoney: (String) -> Void
    let onOpenBudgetCategory: (String) -> Void
    let onChangeBudgetMonth: () -> Void

    // Callbacks use the same HomeView state storage for this workspace. Compare
    // the actual page inputs so a keypad binding/menu update cannot rebuild all
    // retained pages. Store observations inside each page still update normally.
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.page == rhs.page && lhs.isActive == rhs.isActive
            && lhs.transactionFeedStore === rhs.transactionFeedStore
            && lhs.budgetStore === rhs.budgetStore && lhs.homeStore === rhs.homeStore
            && lhs.accountsStore === rhs.accountsStore && lhs.reportsStore === rhs.reportsStore
            && lhs.transactionScrollToTopRequest == rhs.transactionScrollToTopRequest
            && lhs.budgetScrollToTopRequest == rhs.budgetScrollToTopRequest
            && lhs.accountsScrollToTopRequest == rhs.accountsScrollToTopRequest
            && lhs.accountCreationRequest == rhs.accountCreationRequest
            && lhs.editingBudgetCategoryID == rhs.editingBudgetCategoryID
    }

    @ViewBuilder
    var body: some View {
        switch page {
        case .home:
            if let homeStore {
                HomeLiveDashboardView(
                    store: homeStore, budgetStore: budgetStore, accountsStore: accountsStore,
                    transactionFeedStore: transactionFeedStore,
                    isActive: isActive, onSelectPage: onSelectPage,
                    onSelectTransactionFilter: transactionFeedStore.selectFilter)
            } else {
                HomeDashboardView(isActive: isActive, feed: transactionFeedStore)
            }
        case .transactions, .planned:
            TransactionFeedView(
                store: transactionFeedStore,
                isActive: isActive,
                scrollToTopRequest: transactionScrollToTopRequest,
                showsAgenda: true, allowsSelection: true
            )
        case .budget:
            BudgetView(
                store: budgetStore, isActive: isActive,
                scrollToTopRequest: budgetScrollToTopRequest,
                editingCategoryID: editingBudgetCategoryID,
                onEdit: onEditBudgetAmount, onChangeMonth: onChangeBudgetMonth,
                onMoveMoney: onMoveBudgetMoney, onOpenCategory: onOpenBudgetCategory
            )
        case .accounts:
            AccountsView(
                store: accountsStore, onSelectAccount: onSelectAccount,
                onAccountCreated: onAccountCreated,
                isActive: isActive, scrollToTopRequest: accountsScrollToTopRequest,
                creationRequest: accountCreationRequest)
        case .reports:
            ReportsView(store: reportsStore, feed: transactionFeedStore, isActive: isActive)
        }
    }
}

/// Keep each visited page in a stable native tab host. UIKit owns tab layout and
/// selection gestures; HomeView continues to own workspace readiness and Peek.
struct HomePageContainer<Content: View>: View {
    @Environment(\.openWorkspaceSettings) private var openWorkspaceSettings
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.homeControlDock) private var dock
    @Environment(\.peekContentBottomInset) private var peekBottomInset
    @State private var moreMenu = HomePageMenuState()
    let selectedPage: HomePage
    let mountedPages: Set<HomePage>
    var showsTabBar = true
    var canAddTransaction = true
    var onSelectPage: (HomePage) -> Void = { _ in }
    var onAddTransaction: () -> Void = {}
    var onOpenAssistant: () -> Void = {}
    var appSession: AppSessionStore? = nil
    var onSelectWorkspace: (AppWorkspace) -> Void = { _ in }
    var badges = HomeNavigationBadges()
    @ViewBuilder var content: (HomePage) -> Content

    var body: some View {
        GeometryReader { container in
            HomeNativePages(
                selectedPage: selectedPage, mountedPages: mountedPages,
                barInsets: HomePageBarInsets(container.safeAreaInsets),
                content: content
            )
            .environment(
                \.homeDockNavigation,
                dock != nil ? AnyView(navigationBar(isVertical: true)) : nil
            )
            .ignoresSafeArea(.container, edges: .vertical)
        }
        .overlay(alignment: .bottomTrailing) {
            HomeMoreMenuOverlay(
                selection: selectedPage, state: moreMenu,
                onSelect: selectMoreItem, appSession: appSession, badges: badges
            )
            .padding(.bottom, peekBottomInset)
        }
        .onChange(of: showsTabBar) { _, visible in
            if !visible { moreMenu.dismiss() }
        }
        .onChange(of: selectedPage) { _, _ in moreMenu.dismiss() }
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
            if showsTabBar && dock == nil {
                navigationBar(isVertical: false)
                    .frame(maxWidth: horizontalSizeClass == .regular ? 500 : .infinity)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    private func navigationBar(isVertical: Bool) -> some View {
        HomeBottomBar(
            isVertical: isVertical,
            selectedPage: selectedPage, canAddTransaction: canAddTransaction,
            onSelectPage: { page in
                moreMenu.dismiss()
                onSelectPage(page)
            },
            onAddTransaction: {
                moreMenu.dismiss()
                onAddTransaction()
            },
            onMoreTap: { moreMenu.toggle() },
            onMoreDragChanged: { location in
                moreMenu.dragChanged(at: location, geometry: moreMenu.geometry)
            },
            onMoreDragEnded: { location, translation in
                if let item = moreMenu.endDrag(
                    at: location, translation: translation, geometry: moreMenu.geometry)
                {
                    selectMoreItem(item)
                }
            },
            onMoreDragCancelled: { moreMenu.dismiss() }, badges: badges
        )
    }
    private func selectMoreItem(_ item: HomePageMenuItem) {
        switch item {
        case .page(let page):
            moreMenu.dismiss()
            onSelectPage(page)
        case .assistant:
            moreMenu.dismiss()
            onOpenAssistant()
        case .settings:
            moreMenu.dismiss()
            openWorkspaceSettings()
        case .workspace(let id):
            guard
                let workspace = appSession?.workspaces.first(where: {
                    $0.id == id && !$0.isArchived
                })
            else { return }
            moreMenu.dismiss()
            onSelectWorkspace(workspace)
        case .retryWorkspaces: appSession?.retry()
        default: break
        }
    }
}

/// Geometry comes from the full home surface, before the Peek changes its height.
/// Side occlusions include the camera and status UI; a centered island does not
/// opt an ordinary phone into the side dock.
nonisolated struct HomeControlDockLayout: Equatable {
    let edge: HorizontalEdge
    let width: CGFloat
    let top: CGFloat

    static func resolve(size: CGSize, occlusions: [CGRect], isExpanded: Bool) -> Self? {
        let sideRegions = occlusions.filter {
            !$0.isEmpty && $0.minY < size.height / 2 && $0.height > 0
                && ($0.midX < size.width * 0.2 || $0.midX > size.width * 0.8)
        }
        guard let region = sideRegions.max(by: { $0.height < $1.height }) else { return nil }
        let edge: HorizontalEdge = region.midX < size.width / 2 ? .leading : .trailing
        let width: CGFloat = max(72, region.width)
        let rail = CGRect(
            x: edge == .leading ? 0 : size.width - width, y: 0,
            width: width, height: size.height)
        let top = occlusions.filter { $0.intersects(rail) }.map(\.maxY).max() ?? 0
        return Self(edge: edge, width: width, top: max(0, top) + 12)
    }

    @MainActor
    static func resolve(geometry: GeometryProxy, isExpanded: Bool) -> Self? {
        // The iOS 27.1 SDK adds reservedRegions in SwiftUICore 8.0.85.
        // Runtime availability alone does not let the public 27.0 SDK compile it.
        #if canImport(SwiftUICore, _version: 8.0.85)
            guard #available(iOS 27.1, *) else { return nil }
            return resolve(
                size: geometry.size,
                occlusions: geometry.reservedRegions(kind: .occlusion).map { region in
                    CGRect(
                        x: region.frame.minX - region.margins.leading,
                        y: region.frame.minY - region.margins.top,
                        width: region.frame.width + region.margins.leading
                            + region.margins.trailing,
                        height: region.frame.height + region.margins.top + region.margins.bottom)
                }, isExpanded: isExpanded)
        #else
            return nil
        #endif
    }
}

nonisolated struct HomePeekCorners {
    let leading: CGFloat
    let trailing: CGFloat

    init(leading: CGFloat? = nil, trailing: CGFloat? = nil) {
        // Near-square hardware corners (including the Duo's 8-point hinge edge)
        // need no minimum at the inset Peek boundary. Large curves retain 52.
        self.leading = leading.map { $0 <= 12 ? 0 : 52 } ?? 52
        self.trailing = trailing.map { $0 <= 12 ? 0 : 52 } ?? 52
    }

    @MainActor
    static func resolve(geometry: GeometryProxy) -> Self {
        if #available(iOS 27.0, *), let radii = geometry.concentricCornerRadii {
            return Self(leading: radii.bottomLeading, trailing: radii.bottomTrailing)
        }
        return Self()
    }
}

extension EnvironmentValues {
    @Entry var homeControlDock: HomeControlDockLayout? = nil
    @Entry var homeDockActions: AnyView? = nil
    @Entry var homeDockNavigation: AnyView? = nil
    @Entry var homeFiltersAreVertical = false
}

struct HomeDockFiltersPreference: PreferenceKey {
    static var defaultValue: [AnyView] { [] }
    static func reduce(value: inout [AnyView], nextValue: () -> [AnyView]) {
        value += nextValue()
    }
}

extension View {
    func homeDockFilters<Filters: View>(@ViewBuilder _ filters: () -> Filters) -> some View {
        modifier(HomeDockFilters(filters: filters()))
    }
}

private struct HomeDockFilters<Filters: View>: ViewModifier {
    @Environment(\.homeControlDock) private var dock
    let filters: Filters

    func body(content: Content) -> some View {
        content.preference(
            key: HomeDockFiltersPreference.self,
            value: dock == nil ? [] : [AnyView(filters.environment(\.homeFiltersAreVertical, true))]
        )
    }
}

/// Keep the controls in their page's hosting tree so filters retain their local
/// state and presentations. Actions and filters share a single vertical scroll.
struct HomeDockSurface: ViewModifier {
    let layout: HomeControlDockLayout?
    let actions: AnyView?
    let barInsets: HomePageBarInsets
    var navigation: AnyView? = nil
    var peekBottomInset: CGFloat = 0

    func body(content: Content) -> some View {
        if let layout {
            content
                .padding(.bottom, peekBottomInset)
                .padding(layout.edge == .leading ? .leading : .trailing, layout.width)
                .overlayPreferenceValue(HomeDockFiltersPreference.self) { filters in
                    HStack(spacing: 0) {
                        if layout.edge == .trailing { Spacer(minLength: 0) }
                        VStack(spacing: 12) {
                            ScrollView(.vertical) {
                                VStack(spacing: 16) {
                                    actions
                                    if !filters.isEmpty {
                                        Divider().padding(.horizontal, 12)
                                        ForEach(filters.indices, id: \.self) { filters[$0] }
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 16)
                            }
                            .scrollIndicators(.automatic)
                            .scrollBounceBehavior(.basedOnSize)
                            .modifier(VerticalFilterScrollEdges())
                            if let navigation {
                                navigation.fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(width: layout.width)
                        .padding(.top, max(layout.top, barInsets.top))
                        .padding(.bottom, max(navigation == nil ? 8 : 20, barInsets.bottom))
                        .accessibilityIdentifier("home.control-dock")
                        if layout.edge == .leading { Spacer(minLength: 0) }
                    }
                }
                .ignoresSafeArea(.container, edges: .horizontal)
        } else {
            content
        }
    }
}

nonisolated struct HomePageBarInsets {
    let top: CGFloat
    let bottom: CGFloat

    init(_ insets: EdgeInsets) {
        top = insets.top.isFinite ? max(0, insets.top) : 0
        bottom = insets.bottom.isFinite ? max(0, insets.bottom) : 0
    }
}

/// The rounded foreground sheet owns clipping while a peek resizes it. Let all
/// nested scroll views draw beneath the bars instead of animating their own clips.
struct HomeScrollSurface: ViewModifier {
    let showsBottomToolbar: Bool

    func body(content: Content) -> some View {
        content
            .scrollClipDisabled()
            .kualiaScrollEdges(for: [.top, .bottom])
            .kualiaScrollEdgeEffectHidden(!showsBottomToolbar, for: .bottom)
    }
}
