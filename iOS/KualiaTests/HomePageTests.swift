import ClerkKit
import Combine
import ConvexMobile
import CoreGraphics
import Observation
import SwiftUI
import Synchronization
import Testing
import UIKit

@testable import Kualia

@MainActor
struct HomeControlDockTests {
    @Test(arguments: [CGFloat(0), 80, 360], [false, true])
    func peekResizesOnlyTheContentAndKeepsDockButtonsReachable(peekHeight: CGFloat, expanded: Bool)
        async throws
    {
        let size = expanded ? CGSize(width: 951, height: 669) : CGSize(width: 466, height: 678)
        let dock = HomeControlDockLayout(edge: .trailing, width: 84, top: 170)
        let presentation = PeekPresentation(initiallyPresented: peekHeight > 80)
        var checkedNavigation = false
        var checkedContent = false
        var checkedPeek = false
        func descendants(of view: UIView) -> [UIView] {
            view.subviews.flatMap { [$0] + descendants(of: $0) }
        }
        let image = try await HostedViewSnapshot.image(
            of: PeekContainer(
                presentation: presentation, expansionHeight: 280,
                isCompactPresented: peekHeight > 0, compactHeight: 80,
                bottomCornerRadius: 0, foregroundColor: .green, expansionColor: .orange,
                persistentSide: .init(edge: .trailing, width: dock.width)
            ) {
                HomePeekDockRegressionContent(dock: dock)
                    .environment(\.homeControlDock, dock)
            } expansion: {
                HomePeekHitProbe(identifier: "test.peek.expansion").frame(width: 100, height: 44)
            } compact: {
                HomePeekHitProbe(identifier: "test.peek.compact").frame(width: 100, height: 44)
            }
            .ignoresSafeArea(),
            size: size,
            inspect: { root in
                let views = descendants(of: root)
                if let navigation = views.compactMap({ $0 as? HomeTabBarView }).first {
                    checkedNavigation = true
                    let frame = navigation.convert(navigation.bounds, to: root)
                    #expect(
                        abs(frame.maxY - (size.height - 20)) < 1,
                        "Navigation frame: \(frame), container: \(size)")
                    #expect(frame.minX >= size.width - dock.width)
                    for button in navigation.dockTabButtons + [
                        navigation.moreButton, navigation.addButton,
                    ] {
                        let center = button.convert(
                            CGPoint(x: button.bounds.midX, y: button.bounds.midY), to: root)
                        let hit = root.hitTest(center, with: nil)
                        #expect(hit === button || hit?.isDescendant(of: button) == true)
                    }
                }
                let scrolls = views.compactMap { $0 as? UIScrollView }
                if let scroll =
                    scrolls
                    .first(where: { $0.bounds.width > dock.width })
                {
                    checkedContent = true
                    let frame = scroll.convert(
                        scroll.bounds.inset(by: scroll.adjustedContentInset), to: root)
                    #expect(
                        abs(frame.maxX - (size.width - dock.width)) < 1,
                        "Content viewport: \(frame), insets: \(scroll.adjustedContentInset)")
                    #expect(abs(frame.maxY - (size.height - peekHeight)) < 1)
                } else {
                    Issue.record(
                        "Content viewport missing; scroll frames: \(scrolls.map { $0.convert($0.bounds, to: root) })"
                    )
                }
                if peekHeight > 80,
                    let button = views.first(where: {
                        $0.accessibilityIdentifier == "test.peek.expansion"
                    })
                {
                    let frame = button.convert(button.bounds, to: root)
                    #expect(frame.maxX <= size.width - dock.width)
                    let hit = root.hitTest(CGPoint(x: frame.midX, y: frame.midY), with: nil)
                    #expect(hit === button || hit?.isDescendant(of: button) == true)
                }
                if peekHeight > 0,
                    let button = views.first(where: {
                        $0.accessibilityIdentifier == "test.peek.compact"
                    })
                {
                    checkedPeek = true
                    let frame = button.convert(button.bounds, to: root)
                    #expect(frame.maxX <= size.width - dock.width)
                    let hit = root.hitTest(CGPoint(x: frame.midX, y: frame.midY), with: nil)
                    #expect(hit === button || hit?.isDescendant(of: button) == true)
                }
            })
        #expect(checkedNavigation)
        #expect(checkedContent)
        #expect(checkedPeek == (peekHeight > 0))
        Attachment.record(
            Array(try #require(image.pngData())),
            named: "persistent-dock-\(expanded)-\(Int(peekHeight)).png")
    }

    @Test func dockNavigationRetainsActionsSelectionAndBadges() throws {
        let view = HomeTabBarView(isVertical: true)
        var destination: HomePage?
        var added = false
        var openedMore = false
        view.onSelectPage = { destination = $0 }
        view.onAddTransaction = { added = true }
        view.onMoreTap = { openedMore = true }
        view.dockTabButtons[1].sendActions(for: .primaryActionTriggered)
        #expect(destination == .transactions)
        #expect(
            view.selectedPage == .budget,
            "The session must approve navigation before selection changes.")
        view.selectedPage = .transactions
        view.updateBadges(.init(transactionCount: 12))
        #expect(view.dockTabButtons[1].accessibilityTraits.contains(.selected))
        #expect(view.dockTabButtons[1].accessibilityValue == "12")
        #expect(view.dockTabButtons.allSatisfy { $0.configuration?.title == nil })
        #expect(
            view.dockTabButtons.allSatisfy {
                $0.configuration?.image?.size == CGSize(width: 19, height: 19)
            })
        #expect(!view.dockTabButtons[0].accessibilityTraits.contains(.selected))
        view.addButton.sendActions(for: .touchUpInside)
        view.moreButton.sendActions(for: .primaryActionTriggered)
        #expect(added)
        #expect(openedMore)
        view.updateBadges(.init())
        #expect(view.dockTabButtons[1].accessibilityValue == nil)
        added = false
        view.addButton.isEnabled = false
        view.addButton.sendActions(for: .touchUpInside)
        #expect(!added)
    }

    @Test(arguments: [DynamicTypeSize.large, .accessibility3])
    func verticalFilterLabelsReserveTheirRotatedSize(typeSize: DynamicTypeSize) async throws {
        var horizontalSize = CGSize.zero
        var verticalSize = CGSize.zero
        var buttonSize = CGSize.zero
        let title = "Unkategorisierte Transaktionen"
        let image = try await HostedViewSnapshot.image(
            of: VStack(spacing: 16) {
                HomeFilterLabel(title)
                    .fixedSize()
                    .environment(\.homeFiltersAreVertical, false)
                    .onGeometryChange(for: CGSize.self) {
                        $0.size
                    } action: {
                        horizontalSize = $0
                    }
                HomeFilterLabel(title)
                    .environment(\.homeFiltersAreVertical, true)
                    .onGeometryChange(for: CGSize.self) {
                        $0.size
                    } action: {
                        verticalSize = $0
                    }
                Button {
                } label: {
                    HomeFilterLabel("All")
                        .modifier(FilterChipStyle(background: KualiaPalette.surface))
                }
                .buttonStyle(.plain)
                .environment(\.homeFiltersAreVertical, true)
                .onGeometryChange(for: CGSize.self) {
                    $0.size
                } action: {
                    buttonSize = $0
                }
            }
            .font(.footnote.weight(.semibold))
            .environment(\.dynamicTypeSize, typeSize),
            size: CGSize(width: 951, height: 1000))
        #expect(horizontalSize.width > horizontalSize.height)
        #expect(abs(verticalSize.width - horizontalSize.height) < 1)
        #expect(abs(verticalSize.height - horizontalSize.width) < 1)
        #expect(buttonSize.width >= 44)
        #expect(buttonSize.height >= 44)
        Attachment.record(
            Array(try #require(image.pngData())), named: "vertical-filters-\(typeSize).png")
    }

    @Test(arguments: [HomePage.budget, .transactions, .accounts, .reports], [false, true])
    func pagesKeepFiltersAndNavigationInTheDock(page: HomePage, expanded: Bool)
        async throws
    {
        let session = ScreenshotDemoData().makeWorkspaceSession()
        session.prepare()
        defer { session.stop() }
        let deadline = Date.now.addingTimeInterval(3)
        while session.readiness(for: page) != .ready && Date.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(session.readiness(for: page) == .ready)
        let size = expanded ? CGSize(width: 951, height: 669) : CGSize(width: 466, height: 678)
        let dock = HomeControlDockLayout(edge: .trailing, width: 84, top: 170)
        var checkedDock = false
        var checkedTabs = false
        var sample = 0
        var navigationFrameBeforeScrolling: CGRect?
        func descendants(of view: UIView) -> [UIView] {
            view.subviews.flatMap { [$0] + descendants(of: $0) }
        }
        let image = try await HostedViewSnapshot.image(
            of: HomePageContent(
                selectedPage: page, mountedPages: [page],
                transactionFeedStore: session.transactions, budgetStore: session.budget,
                accountsStore: session.accounts, reportsStore: session.reports,
                transactionScrollToTopRequest: 0,
                showsTabBar: false
            )
            .environment(\.homeControlDock, dock)
            .environment(
                \.homeDockActions,
                AnyView(
                    HomeTopBar(
                        placement: .dock, title: page.title,
                        onNewEntry: {}, onPreferences: {}, onSearch: {}, onEditBudgetPlan: {}))
            )
            .environment(\.horizontalSizeClass, expanded ? .regular : .compact)
            .environment(Clerk.shared),
            size: size, animationSampleCount: 24,
            onAnimationSample: { root in
                sample += 1
                guard sample == 8 else { return }
                let views = descendants(of: root)
                if let tabs = views.compactMap({ $0 as? HomeTabBarView }).first {
                    navigationFrameBeforeScrolling = tabs.convert(tabs.bounds, to: root)
                }
                if let scroll = views.compactMap({ $0 as? UIScrollView })
                    .first(where: { abs($0.bounds.width - dock.width) < 1 })
                {
                    let bottom =
                        scroll.contentSize.height - scroll.bounds.height
                        + scroll.adjustedContentInset.bottom
                    scroll.setContentOffset(CGPoint(x: 0, y: min(180, bottom)), animated: false)
                }
            },
            inspect: { root in
                let descendants = descendants(of: root)
                if let scroll = descendants.compactMap({ $0 as? UIScrollView })
                    .first(where: { abs($0.bounds.width - dock.width) < 1 })
                {
                    checkedDock = true
                    let frame = scroll.convert(scroll.bounds, to: root)
                    #expect(frame.minY + scroll.adjustedContentInset.top >= dock.top)
                    #expect(frame.maxX <= size.width + 1)
                    #expect(scroll.contentSize.width <= scroll.bounds.width + 1)
                }
                if let tabs = descendants.compactMap({ $0 as? HomeTabBarView }).first {
                    checkedTabs = true
                    let frame = tabs.convert(tabs.bounds, to: root)
                    #expect(abs(frame.maxX - size.width) < 1)
                    #expect(tabs.isVertical)
                    #expect(frame.width <= dock.width)
                    #expect(frame.minY >= dock.top)
                    #expect(frame.maxY <= size.height)
                    #expect(frame == navigationFrameBeforeScrolling)
                    if let scroll = descendants.compactMap({ $0 as? UIScrollView })
                        .first(where: { abs($0.bounds.width - dock.width) < 1 })
                    {
                        let scrollFrame = scroll.convert(scroll.bounds, to: root)
                        #expect(scrollFrame.maxY + 12 <= frame.minY + 1)
                    }
                    #expect(tabs.dockTabButtons.count == HomePage.tabPages.count)
                    for button in tabs.dockTabButtons + [tabs.moreButton, tabs.addButton] {
                        #expect(button.bounds.width >= 44)
                        #expect(button.bounds.height >= 44)
                    }
                }
            })
        #expect(checkedDock)
        #expect(checkedTabs)
        Attachment.record(
            Array(try #require(image.pngData())),
            named: "duo-\(page.rawValue)-\(expanded ? "expanded" : "closed").png")
    }

    @Test func centeredIslandKeepsTheStandardPhoneLayout() {
        #expect(
            HomeControlDockLayout.resolve(
                size: CGSize(width: 402, height: 874),
                occlusions: [CGRect(x: 140, y: 0, width: 122, height: 60)],
                isExpanded: false) == nil)
    }

    #if !canImport(SwiftUICore, _version: 8.0.85)
        @Test func publicSDKKeepsTheStandardPhoneLayout() async throws {
            var checkedGeometry = false
            _ = try await HostedViewSnapshot.image(
                of: GeometryReader { geometry in
                    Color.clear.onAppear {
                        #expect(
                            HomeControlDockLayout.resolve(geometry: geometry, isExpanded: false)
                                == nil)
                        #expect(
                            HomeControlDockLayout.resolve(geometry: geometry, isExpanded: true)
                                == nil)
                        checkedGeometry = true
                    }
                },
                size: CGSize(width: 402, height: 874))
            #expect(checkedGeometry)
        }
    #endif

    @Test(arguments: [false, true])
    func dockClearsEveryOcclusionOnItsSide(isLeading: Bool) throws {
        let width: CGFloat = 466
        let x: CGFloat = isLeading ? 0 : 390
        let layout = try #require(
            HomeControlDockLayout.resolve(
                size: CGSize(width: width, height: 678),
                occlusions: [
                    CGRect(x: x, y: 12, width: 76, height: 50),
                    CGRect(x: x, y: 70, width: 76, height: 88),
                ],
                isExpanded: false))
        #expect(layout.edge == (isLeading ? .leading : .trailing))
        #expect(layout.top > 158)
        #expect(layout.width >= 76)
    }

    @Test func peekKeepsThePhysicalCornersIndependent() {
        let closed = HomePeekCorners(leading: 8, trailing: 59)
        #expect(closed.leading == 0)
        #expect(closed.trailing == 52)
        let mirrored = HomePeekCorners(leading: 60, trailing: 0)
        #expect(mirrored.leading == 52)
        #expect(mirrored.trailing == 0)
        #expect(HomePeekCorners().leading == 52)
    }

    @Test(arguments: [DynamicTypeSize.large, .accessibility3])
    func actionsAndFiltersShareOneScrollAndRemainReachable(typeSize: DynamicTypeSize) async throws {
        let dock = HomeControlDockLayout(edge: .trailing, width: 112, top: 170)
        var foundScroll = false
        let image = try await HostedViewSnapshot.image(
            of: Color.gray.opacity(0.1)
                .homeDockFilters {
                    VStack(spacing: 8) {
                        ForEach(0..<12) { index in
                            HomeFilterLabel("Filter \(index)")
                                .modifier(FilterChipStyle(background: KualiaPalette.surface))
                        }
                    }
                }
                .environment(\.homeControlDock, dock)
                .modifier(
                    HomeDockSurface(
                        layout: dock,
                        actions: AnyView(
                            HomeTopBar(
                                placement: .dock, title: "Budget", onNewEntry: {},
                                onPreferences: {},
                                onEditBudgetPlan: {}, onBudgetPreferences: {})),
                        barInsets: HomePageBarInsets(
                            .init(top: 66, leading: 0, bottom: 84, trailing: 0)))
                )
                .environment(\.dynamicTypeSize, typeSize)
                .environment(Clerk.shared),
            size: CGSize(width: 466, height: 678),
            inspect: { root in
                func scrolls(in view: UIView) -> [UIScrollView] {
                    (view as? UIScrollView).map { [$0] }
                        ?? view.subviews.flatMap { scrolls(in: $0) }
                }
                let views = scrolls(in: root)
                #expect(views.count == 1, "Actions and filters must not create nested scrolling.")
                guard let scroll = views.first else { return }
                foundScroll = true
                let frame = scroll.convert(scroll.bounds, to: root)
                #expect(frame.minY + scroll.adjustedContentInset.top >= 170)
                #expect(frame.maxY - scroll.adjustedContentInset.bottom <= 678 - 84)
                let visibleHeight =
                    scroll.bounds.height - scroll.adjustedContentInset.top
                    - scroll.adjustedContentInset.bottom
                #expect(scroll.contentSize.height > visibleHeight)
                #expect(scroll.contentSize.width <= scroll.bounds.width + 1)
                if #available(iOS 26.0, *) {
                    #expect(scroll.topEdgeEffect.isHidden)
                    #expect(scroll.bottomEdgeEffect.isHidden)
                }
                let bottom =
                    scroll.contentSize.height - scroll.bounds.height
                    + scroll.adjustedContentInset.bottom
                scroll.setContentOffset(CGPoint(x: 0, y: bottom), animated: false)
                #expect(abs(scroll.contentOffset.y - bottom) < 1)
            })
        #expect(foundScroll)
        Attachment.record(Array(try #require(image.pngData())), named: "duo-dock-\(typeSize).png")
    }
}

private struct HomePeekDockRegressionContent: View {
    @Environment(\.peekContentBottomInset) private var peekBottomInset
    let dock: HomeControlDockLayout

    var body: some View {
        ScrollView {
            VStack {
                ForEach(0..<40) { index in
                    Text("Row \(index)").frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
        .background(Color.gray.opacity(0.1))
        .homeDockFilters {
            HomeFilterOptions {
                ForEach(0..<8) { index in
                    HomeFilterLabel("Filter \(index)")
                        .modifier(FilterChipStyle(background: KualiaPalette.surface))
                }
            }
        }
        .modifier(
            HomeDockSurface(
                layout: dock, actions: nil, barInsets: .init(.init()),
                navigation: AnyView(
                    HomeBottomBar(
                        isVertical: true, selectedPage: .budget, canAddTransaction: true,
                        onSelectPage: { _ in }, onAddTransaction: {})),
                peekBottomInset: peekBottomInset))
    }
}

private struct HomePeekHitProbe: UIViewRepresentable {
    let identifier: String

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle("Peek action", for: .normal)
        button.accessibilityIdentifier = identifier
        return button
    }

    func updateUIView(_ view: UIButton, context: Context) {}
}

@available(iOS 26.0, *)
@MainActor
private var expectedScrollEdgeStyle: UIScrollEdgeEffect.Style {
    if #available(iOS 27.0, *) { .automatic } else { .soft }
}

@MainActor
@Observable
private final class AccountCreationRequestProbe {
    var request = 0
}

private struct AccountCreationRegressionView: View {
    let store: AccountsStore
    let probe: AccountCreationRequestProbe
    let isActive: Bool

    var body: some View {
        AccountsView(
            store: store, onSelectAccount: { _ in }, isActive: isActive,
            creationRequest: probe.request)
    }
}

private struct HomeToolbarFrameProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.accessibilityIdentifier = "test.homeToolbarFrame"
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {}
}

@MainActor
@Observable
private final class HomeNestedScrollRegressionState {
    var showsSheet = false
}

private struct HomeNestedScrollRegressionView: View {
    @Bindable var state: HomeNestedScrollRegressionState

    var body: some View {
        NavigationStack {
            HomePageContainer(
                selectedPage: .accounts, mountedPages: [.accounts], showsTabBar: false
            ) { _ in
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        ScrollView(.horizontal) {
                            HStack {
                                ForEach(0..<8) { index in
                                    Text("Filter \(index)").frame(width: 80, height: 44)
                                }
                            }
                        }
                        .modifier(HorizontalFilterScrollEdges(horizontalInset: 18))
                        ForEach(0..<30) { index in
                            Text("Row \(index)").frame(maxWidth: .infinity, minHeight: 44)
                                .background(index.isMultiple(of: 2) ? Color.green : Color.orange)
                        }
                    }
                    .padding(.horizontal, 24)
                }
            }
            .kualiaSafeAreaBar(edge: .top, spacing: 0) {
                Text("Accounts").frame(height: 80)
            }
            .modifier(HomeScrollSurface(showsBottomToolbar: false))
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $state.showsSheet) {
                NavigationStack { Text("Transaction editor") }
            }
        }
    }
}

@MainActor
struct HomeNestedScrollTests {
    @Test(arguments: [ColorScheme.light, .dark])
    func scrolledContentRendersTheNativeHeaderEdge(colorScheme: ColorScheme) async throws {
        let state = HomeNestedScrollRegressionState()
        var sample = 0
        let image = try await HostedViewSnapshot.image(
            of: HomeNestedScrollRegressionView(state: state)
                .environment(\.colorScheme, colorScheme),
            size: CGSize(width: 402, height: 874), animationSampleCount: 50,
            onAnimationSample: { root in
                sample += 1
                guard sample == 20 else { return }
                @MainActor func findScroll(in view: UIView) -> UIScrollView? {
                    if let scroll = view as? UIScrollView { return scroll }
                    return view.subviews.lazy.compactMap { findScroll(in: $0) }.first
                }
                guard let scroll = findScroll(in: root) else {
                    Issue.record("The page must contain a scrolling surface.")
                    return
                }
                scroll.setContentOffset(CGPoint(x: 0, y: 240), animated: false)
                if #available(iOS 26.0, *) {
                    #expect(scroll.topEdgeEffect.style == expectedScrollEdgeStyle)
                    #expect(!scroll.topEdgeEffect.isHidden)
                }
            })
        Attachment.record(
            Array(try #require(image.pngData())),
            named: "home-header-scroll-edge-\(colorScheme).png")
    }

    @Test func nestedFiltersKeepTheirInsetsAndPagesKeepTheirWidthAfterSheetDismissal() async throws
    {
        let state = HomeNestedScrollRegressionState()
        var sample = 0
        var checks = 0
        _ = try await HostedViewSnapshot.image(
            of: HomeNestedScrollRegressionView(state: state),
            size: CGSize(width: 402, height: 874), animationSampleCount: 150,
            onAnimationSample: { root in
                sample += 1
                @MainActor func scrolls(in view: UIView) -> [UIScrollView] {
                    (view as? UIScrollView).map { [$0] }
                        ?? view.subviews.flatMap { scrolls(in: $0) }
                }
                if sample == 35 { state.showsSheet = true }
                if sample == 80 { state.showsSheet = false }
                guard sample == 25 || sample == 140,
                    let page = scrolls(in: root).first,
                    let filters = page.subviews.flatMap({ scrolls(in: $0) }).first
                else { return }
                checks += 1
                #expect(
                    abs(page.contentSize.width - page.bounds.width) < 1,
                    "Page geometry: content=\(page.contentSize), bounds=\(page.bounds), insets=\(page.adjustedContentInset)"
                )
                #expect(abs(page.contentOffset.x) < 1)
                #expect(abs(filters.adjustedContentInset.left - 18) < 1)
                #expect(abs(filters.contentOffset.x + filters.adjustedContentInset.left) < 1)
            })
        #expect(checks == 2)
    }
}

@MainActor
@Observable
private final class HomeContainerRegressionState {
    let navigation = HomeNavigationState()
    var peekHeight: CGFloat = 0
    var topBarHeight: CGFloat = 80
    var bottomBarHeight: CGFloat = 64
    var usesSharedTopBar = false
    var disablesAnimations = true
    var browsesPastMonth = false
    @ObservationIgnored var firstRowFrames: [HomePage: CGRect] = [:]
    @ObservationIgnored var lastRowFrames: [HomePage: CGRect] = [:]
    @ObservationIgnored var appearances: [HomePage: [UUID]] = [:]
    @ObservationIgnored var renderedPages: Set<HomePage> = []
}

private struct HomeContainerRegressionPage: View {
    let page: HomePage
    let state: HomeContainerRegressionState
    @State private var localIdentity = UUID()

    var body: some View {
        let _ = state.renderedPages.insert(page)
        List(0..<80) { row in
            Text("\(page.title) row \(row)").frame(height: 44)
                .onGeometryChange(for: CGRect?.self) { geometry in
                    row == 0 || row == 79 ? geometry.frame(in: .global) : nil
                } action: { frame in
                    guard let frame else { return }
                    if row == 0 { state.firstRowFrames[page] = frame }
                    if row == 79 { state.lastRowFrames[page] = frame }
                }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .onAppear { state.appearances[page, default: []].append(localIdentity) }
    }
}

private struct HomeContainerRegressionView: View {
    let state: HomeContainerRegressionState

    var body: some View {
        PeekContainer(
            isCompactPresented: state.peekHeight > 0, compactHeight: state.peekHeight,
            bottomCornerRadius: 0
        ) {
            HomePageContainer(
                selectedPage: state.navigation.selectedPage,
                mountedPages: state.navigation.mountedPages,
                showsTabBar: false
            ) { page in
                HomeContainerRegressionPage(page: page, state: state)
            }
            .kualiaSafeAreaBar(edge: .top, spacing: 0) {
                if state.usesSharedTopBar {
                    HomeTopBar(
                        title: state.navigation.selectedPage.title,
                        onNewEntry: {}, onPreferences: {},
                        showsDateTitle: state.navigation.selectedPage == .home,
                        onEditBudgetPlan: state.navigation.selectedPage == .budget ? {} : nil,
                        onTitleTap: state.navigation.selectedPage == .budget ? {} : nil,
                        monthBrowsingLabel: state.browsesPastMonth ? "Past month" : nil,
                        onReturnToCurrentMonth: {},
                        budgetMonth: state.navigation.selectedPage == .budget
                            ? (state.browsesPastMonth ? 202608 : 202609) : nil,
                        currentBudgetMonth: 202609
                    )
                    .background(HomeToolbarFrameProbe())
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
                    .kualiaToolbarBackground()
                } else {
                    Text("Title").frame(height: state.topBarHeight)
                }
            }
            .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                if state.bottomBarHeight > 0 { Text("Menu").frame(height: state.bottomBarHeight) }
            }
            .modifier(HomeScrollSurface(showsBottomToolbar: state.bottomBarHeight > 0))
        } compact: {
            Color.green
        }
        .ignoresSafeArea()
        .animation(
            state.disablesAnimations ? nil : .easeInOut(duration: 0.45),
            value: state.navigation.selectedPage
        )
        .transaction { if state.disablesAnimations { $0.disablesAnimations = true } }
        .environment(Clerk.shared)
    }
}

@MainActor
struct AppLoadingBirdTests {
    @Test
    func dotPatternPreservesTheBirdSilhouetteAndEye() {
        let dots = AppLoadingBirdPattern.dots
        #expect(dots.count > 150)
        #expect(dots.count < 700)
        #expect(dots.allSatisfy { $0.x > 0 && $0.x < 1 && $0.y > 0 && $0.y < 1 })
        #expect(!dots.contains { $0.x > 0.7 && $0.y < 0.09 })
        #expect(!dots.contains { hypot($0.x - 0.315, $0.y - 0.245) < 0.022 })
        #expect(dots.contains { $0.x > 0.2 && $0.x < 0.26 && $0.y > 0.55 && $0.y < 0.7 })
    }

    @Test(arguments: [ColorScheme.light, .dark])
    func rendersTheStillMutedDotBird(colorScheme: ColorScheme) async throws {
        let image = try await HostedViewSnapshot.image(
            of: AppLoadingView()
                .environment(\.colorScheme, colorScheme),
            size: CGSize(width: 320, height: 328), minimumChannelRange: 5)
        Attachment.record(
            Array(try #require(image.pngData())), named: "loading-dot-bird-\(colorScheme).png")
    }
}

@MainActor
struct HomeNativeTabTests {
    @Test func nativeBarContainsThreeDestinationsAndSeparateActionButtons() {
        let view = HomeTabBarView()
        #expect(HomePage.tabPages == [.budget, .transactions, .accounts])
        #expect(view.tabBar.items?.map(\.title) == HomePage.tabPages.map { Optional($0.title) })
        #expect(view.tabBar.items?.count == 3)
        #expect(view.moreButton.isDescendant(of: view))
        #expect(!view.moreButton.isDescendant(of: view.tabBar))
        #expect(!view.moreButton.showsMenuAsPrimaryAction)
        #expect(view.moreButton.menu == nil)
        #expect(view.moreButton.configuration?.title == nil)
        #expect(view.moreButton.configuration?.image != nil)
        #expect(view.moreButton.accessibilityLabel == L10n.string("More"))
        #expect(
            HomeMoreMenuOverlay.items == [
                .settings, .assistant, .page(.reports),
            ])
        #expect(view.addButton.isDescendant(of: view))
        #expect(!view.addButton.isDescendant(of: view.tabBar))
        #expect(view.addButton.accessibilityLabel == L10n.string("Add transaction"))
    }

    @Test(arguments: [UIUserInterfaceStyle.light, .dark])
    func navigationUsesAdaptiveMonochromeColors(style: UIUserInterfaceStyle) {
        let view = HomeTabBarView()
        let traits = UITraitCollection(userInterfaceStyle: style)
        #expect(
            view.moreButton.configuration?.baseForegroundColor?.resolvedColor(with: traits)
                == UIColor.label.resolvedColor(with: traits))
        #expect(
            view.tabBar.tintColor.resolvedColor(with: traits)
                == UIColor.label.resolvedColor(with: traits))
        #expect(
            view.tabBar.unselectedItemTintColor?.resolvedColor(with: traits)
                == UIColor.secondaryLabel.resolvedColor(with: traits))
        #expect(
            view.addButton.configuration?.baseForegroundColor?.resolvedColor(with: traits)
                == UIColor.label.resolvedColor(with: traits))
    }

    @Test func addTransactionOpensTheSheetWithoutChangingSelectionAndCanBeRepeated() {
        let view = HomeTabBarView()
        view.selectedPage = .reports
        var sheetIsPresented = false
        var openings = 0
        var navigations = 0
        view.onAddTransaction = {
            sheetIsPresented = true
            openings += 1
        }
        view.onSelectPage = { _ in navigations += 1 }
        for _ in 0..<2 {
            view.addButton.sendActions(for: .touchUpInside)
            #expect(sheetIsPresented)
            #expect(view.selectedPage == .reports)
            #expect(view.tabBar.selectedItem == nil)
            sheetIsPresented = false
        }
        #expect(openings == 2)
        #expect(navigations == 0)
    }

    @Test func moreCardSupportsTapAndDragSelectionWithoutCreatingATab() {
        let state = HomePageMenuState()
        let frames = Dictionary(
            uniqueKeysWithValues: HomeMoreMenuOverlay.items.enumerated().map {
                ($0.element, CGRect(x: 20, y: 100 + $0.offset * 54, width: 224, height: 48))
            })
        let geometry = HomePageMenuGeometry(itemFrames: frames)
        let launcher = CGPoint(x: 230, y: 100 + CGFloat(HomeMoreMenuOverlay.items.count) * 54)
        state.dragChanged(at: launcher, geometry: geometry)
        #expect(state.endDrag(at: launcher, translation: .zero, geometry: geometry) == nil)
        #expect(state.isPresented)
        state.dismiss()
        for item in HomeMoreMenuOverlay.items {
            let frame = frames[item]!
            let target = CGPoint(x: frame.midX, y: frame.midY)
            state.dragChanged(at: launcher, geometry: geometry)
            state.dragChanged(at: target, geometry: geometry)
            #expect(state.highlightedItem == item)
            #expect(
                state.endDrag(
                    at: target, translation: CGSize(width: 0, height: -100), geometry: geometry)
                    == item)
            #expect(!state.isPresented)
        }
        state.dragChanged(at: launcher, geometry: geometry)
        #expect(
            state.endDrag(
                at: CGPoint(x: 0, y: 0), translation: CGSize(width: -230, height: -310),
                geometry: geometry) == nil)
        #expect(!state.isPresented)
    }

    @Test(arguments: [(0, 3, false), (1, 2, false), (2, 0, true), (2, 3, true)])
    func moreCardOnlyOffersSwitchingForMultipleActiveWorkspaces(
        activeCount: Int, archivedCount: Int, expected: Bool
    ) async throws {
        let workspaces =
            (0..<activeCount).map {
                AppWorkspace(_id: "active-\($0)", name: "Workspace \($0)")
            }
            + (0..<archivedCount).map {
                AppWorkspace(_id: "archived-\($0)", name: "Archived \($0)", isArchived: true)
            }
        for panel in [HomePageMenuPanel.pages, .workspaces] {
            let state = HomePageMenuState()
            state.toggle()
            if panel == .workspaces { _ = state.activate(.workspaces) }
            let frames = Mutex<HomePageMenuGeometry>(.init())
            let image = try await HostedViewSnapshot.image(
                of: HomePageMenu(
                    selection: .reports, state: state, onSelect: { _ in },
                    workspaces: workspaces, workspaceID: "active-0", workspaceName: "Workspace 0",
                    menuItems: HomeMoreMenuOverlay.items,
                    settingsTitle: L10n.string("Workspace settings"), menuWidth: 224
                )
                .onPreferenceChange(HomePageMenuItemFramePreferenceKey.self) { geometry in
                    frames.withLock { $0 = geometry }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(KualiaPalette.canvas),
                size: CGSize(width: 375, height: 740))
            if activeCount == 2 && archivedCount == 0 {
                Attachment.record(
                    Array(try #require(image.pngData())), named: "more-card-\(panel).png")
            }
            let geometry = frames.withLock { $0 }
            if expected && panel == .workspaces {
                #expect(geometry.itemFrames[.back] != nil)
                #expect(geometry.itemFrames[.workspace("active-0")] != nil)
                #expect(geometry.itemFrames[.workspace("active-1")] != nil)
                #expect(geometry.itemFrames[.workspace("archived-0")] == nil)
            } else {
                #expect((geometry.itemFrames[.workspaces] != nil) == expected)
                #expect(
                    Set(geometry.itemFrames.keys)
                        == Set(HomeMoreMenuOverlay.items + (expected ? [.workspaces] : [])))
            }
        }
    }

    @Test func nativeBadgesShowReviewCountsAndClearWithoutChangingSelection() {
        let view = HomeTabBarView()
        view.selectedPage = .transactions
        let issue = HomeAttentionStatus(level: .issue, message: "Needs attention")
        view.updateBadges(
            .init(transactionCount: 12, pageStatuses: [.budget: issue, .reports: issue]))
        #expect(view.tabBar.items?[1].title == L10n.string("Spending"))
        #expect(view.tabBar.items?[1].badgeValue == "12")
        #expect(view.tabBar.items?[1].accessibilityValue == "12")
        #expect(view.tabBar.items?[1].badgeColor == .systemRed)
        #expect(view.tabBar.items?[0].badgeValue == "1")
        #expect(view.tabBar.items?[0].accessibilityValue == "1. \(issue.message)")
        #expect(view.menuBadgeValue == "1")
        #expect(view.menuBadgeImageFrame != nil)
        #expect(view.moreButton.configuration?.image?.renderingMode == .alwaysOriginal)
        #expect(view.moreButton.accessibilityValue == "1. \(issue.message)")
        let budgetIssues = HomeAttentionStatus(level: .issue, message: "Budget issues", count: 2)
        view.updateBadges(.init(pageStatuses: [.budget: budgetIssues]))
        #expect(view.tabBar.items?[0].badgeValue == "2")
        #expect(view.tabBar.items?[0].accessibilityValue == "2. \(budgetIssues.message)")
        #expect(view.selectedPage == .transactions)
        view.updateBadges(.init(transactionCount: 30, transactionCountIsComplete: false))
        #expect(view.tabBar.items?[0].badgeValue == nil)
        #expect(view.tabBar.items?[0].accessibilityValue == nil)
        #expect(view.tabBar.items?[1].badgeValue == "30+")
        #expect(view.menuBadgeValue == nil)
        #expect(view.menuBadgeImageFrame == nil)
        #expect(view.moreButton.configuration?.image?.size == CGSize(width: 25, height: 25))
        view.updateBadges(.init())
        #expect(view.tabBar.items?.allSatisfy { $0.badgeValue == nil } == true)
        #expect(view.moreButton.accessibilityValue == nil)
        #expect(view.selectedPage == .transactions)
        #expect(view.tabBar.selectedItem?.tag == 1)
    }

    @Test(arguments: [ColorScheme.light, .dark], [CGFloat(375), CGFloat(390), CGFloat(430)])
    func navigationBadgesShareTheNativeBadgeRow(colorScheme: ColorScheme, width: CGFloat)
        async throws
    {
        let issue = HomeAttentionStatus(level: .issue, message: "Needs attention")
        let image = try await HostedViewSnapshot.image(
            of: Color.gray.opacity(0.1).kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                HomeBottomBar(
                    selectedPage: .budget, canAddTransaction: true,
                    onSelectPage: { _ in }, onAddTransaction: {},
                    badges: .init(transactionCount: 12, pageStatuses: [.reports: issue]))
            }
            .environment(\.colorScheme, colorScheme),
            size: CGSize(width: width, height: 180),
            inspect: { root in
                @MainActor func descendants(of view: UIView) -> [UIView] {
                    view.subviews.flatMap { [$0] + descendants(of: $0) }
                }
                guard let bar = descendants(of: root).compactMap({ $0 as? HomeTabBarView }).first,
                    let badgeLabel = descendants(of: bar.tabBar).compactMap({ $0 as? UILabel })
                        .first(where: { $0.text == "12" }),
                    let nativeBadge = badgeLabel.superview
                else {
                    Issue.record("Native and menu badges must both be present")
                    return
                }
                let nativeFrame = nativeBadge.convert(nativeBadge.bounds, to: bar)
                guard let imageView = bar.moreButton.imageView,
                    let badgeFrame = bar.menuBadgeImageFrame,
                    let imageSize = imageView.image?.size
                else {
                    Issue.record("Menu badge must be part of the button image")
                    return
                }
                #expect(imageView.bounds.size == imageSize)
                let menuFrame = imageView.convert(badgeFrame, to: bar)
                #expect(
                    abs(nativeFrame.midY - menuFrame.midY) < 1,
                    "Menu badge must share the native badge center: \(nativeFrame), \(menuFrame)")
                #expect(abs(nativeFrame.height - menuFrame.height) < 1)
            })
        Attachment.record(
            Array(try #require(image.pngData())),
            named: "navigation-badges-\(colorScheme)-\(Int(width)).png")
    }

    @Test func disabledCreationDoesNotOpenTheEditor() {
        let view = HomeTabBarView()
        view.addButton.isEnabled = false
        var opened = false
        view.onAddTransaction = { opened = true }
        view.addButton.sendActions(for: .touchUpInside)
        #expect(!opened)
    }

    @Test(arguments: [CGFloat(375), CGFloat(390), CGFloat(430)], [CGFloat(0), CGFloat(34)])
    func nativeTabsKeepIconsAboveLabelsAndPlusSeparate(width: CGFloat, bottomInset: CGFloat)
        async throws
    {
        _ = try await HostedViewSnapshot.image(
            of: Color.clear
                .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                    HomeBottomBar(
                        selectedPage: .budget, canAddTransaction: true,
                        onSelectPage: { _ in }, onAddTransaction: {}
                    )
                }
                .safeAreaPadding(.bottom, bottomInset),
            size: CGSize(width: width, height: 740),
            inspect: { root in
                @MainActor func descendants(of view: UIView) -> [UIView] {
                    view.subviews.flatMap { [$0] + descendants(of: $0) }
                }
                guard let view = descendants(of: root).compactMap({ $0 as? HomeTabBarView }).first
                else {
                    Issue.record("Native bottom bar is missing")
                    return
                }
                let barFrame = view.convert(view.bounds, to: root)
                #expect(
                    abs(barFrame.maxY - (root.bounds.maxY - bottomInset)) < 1,
                    "The toolbar must not add padding below the native tab bar")
                let requiredHeight = view.tabBar.sizeThatFits(view.tabBar.bounds.size).height
                #expect(view.tabBar.bounds.height >= requiredHeight)
                #expect(view.tabBar.items?.count == 3)
                let labels = descendants(of: view.tabBar).compactMap { $0 as? UILabel }
                    .filter { HomePage.tabPages.map(\.title).contains($0.text ?? "") }
                #expect(Set(labels.compactMap(\.text)) == Set(HomePage.tabPages.map(\.title)))
                let buttonFrame = view.addButton.convert(view.addButton.bounds, to: view)
                let moreFrame = view.moreButton.convert(view.moreButton.bounds, to: view)
                #expect(moreFrame.width == 62)
                #expect(moreFrame.height == 62)
                #expect(moreFrame.maxX + 12 <= buttonFrame.minX)
                #expect(buttonFrame.width == 62)
                #expect(buttonFrame.height == 62)
                #expect(buttonFrame.maxX <= view.bounds.width)
                for label in labels {
                    var container = label.superview
                    while let candidate = container, candidate !== view.tabBar,
                        descendants(of: candidate).compactMap({ $0 as? UIImageView }).isEmpty
                    {
                        container = candidate.superview
                    }
                    guard let item = container, item !== view.tabBar,
                        let image = descendants(of: item).compactMap({ $0 as? UIImageView }).first
                    else {
                        Issue.record("A native tab label has no icon")
                        continue
                    }
                    #expect(image.bounds.width >= 25)
                    #expect(
                        image.convert(image.bounds, to: view).maxY + 1
                            <= label.convert(label.bounds, to: view).minY,
                        "Native tab icons and labels must not overlap")
                    let itemFrame = item.convert(item.bounds, to: view)
                    #expect(itemFrame.height >= 44)
                    if let platter = item.superview {
                        let platterFrame = platter.convert(platter.bounds, to: view)
                        #expect(abs(platterFrame.height - moreFrame.height) <= 1)
                        #expect(abs(platterFrame.minY - moreFrame.minY) <= 1)
                        #expect(abs(platterFrame.height - buttonFrame.height) <= 1)
                        #expect(abs(platterFrame.minY - buttonFrame.minY) <= 1)
                    } else {
                        Issue.record("Native tab platter is missing")
                    }
                    #expect(
                        itemFrame.maxX + 8 <= moreFrame.minX,
                        "The More button must be separate from every tab")
                }
            })
    }

    @Test func nativeSelectionUsesExistingNavigationAndReselection() throws {
        let navigation = HomeNavigationState()
        let view = HomeTabBarView()
        view.onSelectPage = { page in
            navigation.select(page)
            view.selectedPage = navigation.selectedPage
        }
        let transactions = try #require(view.tabBar.items?[1])
        view.tabBar(view.tabBar, didSelect: transactions)
        #expect(navigation.selectedPage == .transactions)
        #expect(navigation.mountedPages == [.budget, .transactions])
        view.tabBar(view.tabBar, didSelect: transactions)
        #expect(navigation.transactionScrollToTopRequest == 1)
    }
}

@MainActor
struct HomePageTests {
    @Test
    func reopeningTransactionSheetKeepsEachPresentationsEditor() throws {
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "America/New_York")
        let firstEditor = TransactionEditorStore(workspace: workspace)
        let nextEditor = TransactionEditorStore(workspace: workspace)
        var presentedSheet: HomeSheetDestination? = .init(content: .newEntry(firstEditor))
        let dismissingContent = HomeSheetContent(
            destination: try #require(presentedSheet), transactionFeedStore: .preview)

        // SwiftUI clears the binding before the dismissal animation finishes.
        presentedSheet = nil
        presentedSheet = .init(content: .newEntry(nextEditor))
        let reopenedContent = HomeSheetContent(
            destination: try #require(presentedSheet), transactionFeedStore: .preview)

        #expect(dismissingContent.destination.id != reopenedContent.destination.id)
        #expect(dismissingContent.destination.transactionEditor === firstEditor)
        #expect(reopenedContent.destination.transactionEditor === nextEditor)

        // Clearing presentation state cannot strip an already-created sheet of its content.
        presentedSheet = nil
        #expect(reopenedContent.destination.transactionEditor === nextEditor)
    }

    @Test(arguments: [320.0, 390.0], [DynamicTypeSize.large, .accessibility3])
    func accountDetailsStayWithinTheVerticalScrollViewport(width: Double, size: DynamicTypeSize)
        async throws
    {
        let account = AccountSnapshot(
            id: "wide-account", name: "Everyday checking with a long account name",
            accountType: "banking_checking", currentBalance: 123_456_789_012,
            pendingBalance: -123_456_789,
            notes: String(repeating: "Account details and notes. ", count: 30))
        var eligibilityChecks = 0
        var connectionLoads = 0
        let store = AccountsStore(
            defaults: nil,
            connectionStoreFactory: { purpose in
                #expect(purpose == .accountDetails)
                return AccountConnectionStore(
                    workspace: .init(
                        id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
                        timezoneIdentifier: "America/New_York"),
                    purpose: purpose,
                    subscription: { _ in
                        connectionLoads += 1
                        return Just([]).setFailureType(to: Error.self).eraseToAnyPublisher()
                    },
                    createToken: { throw CancellationError() },
                    authorize: { _ in throw CancellationError() },
                    exchange: { _, _, _ in throw CancellationError() },
                    save: { _ in throw CancellationError() })
            },
            accountsSubscription: { _ in
                Just([account]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in
                Just(AccountHistoryReport(months: [], currentMonth: "2026-09"))
                    .setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            transactionsChecker: { _, _ in
                eligibilityChecks += 1
                return false
            })
        store.prepare(
            workspace: .init(
                id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "America/New_York"))
        store.start()
        defer { store.stop() }
        for _ in 0..<1_000 where !store.hasLoaded { await Task.yield() }
        try #require(store.hasLoaded)
        var scrollCount = 0
        _ = try await HostedViewSnapshot.image(
            of: NavigationStack {
                AccountDetailView(store: store, accountID: account.id)
            }.environment(\.dynamicTypeSize, size),
            size: CGSize(width: width, height: 740),
            inspect: { root in
                func inspect(_ view: UIView) {
                    if let scroll = view as? UIScrollView, scroll.bounds.height > 250 {
                        scrollCount += 1
                        #expect(scroll.contentSize.width <= scroll.bounds.width + 1)
                        #expect(scroll.contentSize.height > scroll.bounds.height)
                        #expect(abs(scroll.contentOffset.x) <= 1)
                    }
                    for child in view.subviews { inspect(child) }
                }
                inspect(root)
            })
        #expect(scrollCount == 1)
        #expect(eligibilityChecks == 0)
        #expect(connectionLoads == 0)
        _ = try await HostedViewSnapshot.image(
            of: AccountEditorView(store: store, account: account)
                .environment(\.dynamicTypeSize, size),
            size: CGSize(width: width, height: 740))
        #expect(eligibilityChecks == 1)
        #expect(connectionLoads == 1)
    }

    @Test(arguments: [false, true])
    func accountCreationRequestOnlyPresentsFromTheActivePage(isActive: Bool) async throws {
        let store = AccountsStore.preview
        defer { store.stop() }
        let probe = AccountCreationRequestProbe()
        var sample = 0
        var checkedPresentation = false
        _ = try await HostedViewSnapshot.image(
            of: AccountCreationRegressionView(store: store, probe: probe, isActive: isActive),
            size: CGSize(width: 390, height: 740), animationSampleCount: 70,
            onAnimationSample: { root in
                sample += 1
                if sample == 10 { probe.request += 1 }
                if sample == 65 {
                    let controller = root.window?.rootViewController
                    #expect((controller?.presentedViewController != nil) == isActive)
                    checkedPresentation = true
                }
            })
        #expect(checkedPresentation)
    }

    @Test func accountBackdropStopsUpdatingOnceTheGlowHasScrolledAway() {
        let state = AccountDetailScrollState()
        state.updateOffset(AccountBrandHalo.height)
        let invalidations = Mutex(0)
        withObservationTracking {
            _ = state.backgroundOffset
        } onChange: {
            invalidations.withLock { $0 += 1 }
        }
        for offset in 400...1_000 { state.updateOffset(CGFloat(offset)) }
        #expect(state.backgroundOffset == AccountBrandHalo.height)
        #expect(invalidations.withLock { $0 } == 0)
        state.updateOffset(-20)
        #expect(state.backgroundOffset == 0)
        #expect(invalidations.withLock { $0 } == 1)
    }

    @Test(arguments: [DynamicTypeSize.large, .accessibility3])
    func accountIdentityStaysInTheToolbarWithoutChangingInsets(size: DynamicTypeSize)
        async throws
    {
        let account = AccountSnapshot(
            id: "cash", name: "Everyday checking", accountType: "banking_checking",
            currentBalance: 10_000, notes: String(repeating: "Account notes. ", count: 200),
            firstBalanceYearMonth: "2026-08")
        let store = AccountsStore(
            defaults: nil,
            accountsSubscription: { _ in
                Just([account]).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            historySubscription: { _, _ in
                Just(
                    AccountHistoryReport(
                        months: [
                            .init(
                                yearMonth: "2026-08",
                                accounts: [.init(accountId: "cash", balance: 8_000)]),
                            .init(
                                yearMonth: "2026-09",
                                accounts: [.init(accountId: "cash", balance: 10_000)]),
                        ], currentMonth: "2026-09")
                )
                .setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        store.prepare(
            workspace: .init(
                id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "America/New_York"))
        store.start()
        defer { store.stop() }
        for _ in 0..<1_000 where !store.hasLoaded { await Task.yield() }
        try #require(store.hasLoaded)
        var sample = 0
        var checks = 0
        var initialInset: CGFloat?
        _ = try await HostedViewSnapshot.image(
            of: NavigationStack {
                AccountDetailView(store: store, accountID: account.id)
            }.environment(\.dynamicTypeSize, size),
            size: CGSize(width: 390, height: 740), animationSampleCount: 65,
            onAnimationSample: { root in
                sample += 1
                guard [10, 35, 60].contains(sample) else { return }
                func descendants(_ view: UIView) -> [UIView] {
                    [view] + view.subviews.flatMap(descendants)
                }
                let views = descendants(root)
                guard let bar = views.compactMap({ $0 as? UINavigationBar }).first,
                    let scroll = views.compactMap({ $0 as? UIScrollView }).first(where: {
                        $0.bounds.height > 250 && $0.contentSize.height > $0.bounds.height
                    })
                else {
                    Issue.record(
                        "Account details must contain a navigation bar and vertical scroll view")
                    return
                }
                // The clipped peek foreground must still reach behind the native bar.
                let scrollFrame = scroll.convert(scroll.bounds, to: root)
                let barFrame = bar.convert(bar.bounds, to: root)
                #expect(scrollFrame.minY <= barFrame.minY + 1)
                #expect(scroll.contentSize.width <= scroll.bounds.width + 1)
                if #available(iOS 26.0, *) {
                    #expect(!scroll.topEdgeEffect.isHidden)
                }
                switch sample {
                case 10:
                    #expect(bar.topItem?.title == account.name)
                    initialInset = scroll.adjustedContentInset.top
                    scroll.setContentOffset(
                        CGPoint(x: 0, y: 500 - scroll.adjustedContentInset.top), animated: false)
                case 35:
                    #expect(bar.topItem?.title == account.name)
                    #expect(scroll.adjustedContentInset.top == initialInset)
                    scroll.setContentOffset(
                        CGPoint(x: 0, y: -scroll.adjustedContentInset.top), animated: false)
                default:
                    #expect(bar.topItem?.title == account.name)
                    #expect(scroll.adjustedContentInset.top == initialInset)
                }
                checks += 1
            })
        #expect(checks == 3)
    }

    @Test(arguments: [DynamicTypeSize.large, .accessibility3])
    func filterCountsWidenWithoutMakingTheChipTaller(size: DynamicTypeSize) {
        let counts = [1, 12, 123, 123_456]
        let badgeSizes = counts.map { count in
            UIHostingController(
                rootView: FilterCountBadge(count: count)
                    .environment(\.dynamicTypeSize, size)
            ).sizeThatFits(in: CGSize(width: 1_000, height: 300))
        }
        #expect(abs(badgeSizes[0].width - badgeSizes[0].height) < 0.5)
        #expect(badgeSizes[3].width > badgeSizes[3].height)
        #expect(badgeSizes.allSatisfy { abs($0.height - badgeSizes[0].height) < 0.5 })
        if size == .large { #expect(abs(badgeSizes[0].height - 20) < 0.5) }

        let chipSizes = counts.map { count in
            UIHostingController(
                rootView: HStack(spacing: 6) {
                    Text("Needs review")
                    FilterCountBadge(count: count)
                }
                .modifier(FilterChipStyle(background: .gray))
                .environment(\.dynamicTypeSize, size)
            ).sizeThatFits(in: CGSize(width: 1_000, height: 300))
        }
        #expect(chipSizes.allSatisfy { $0.height >= 44 })
        #expect(chipSizes.allSatisfy { abs($0.height - chipSizes[0].height) < 0.5 })
    }

    @Test(
        .enabled(if: ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26),
        arguments: [ColorScheme.light, .dark]
    )
    func legacyPageToolbarSeparatesContentAcrossItsFullWidth(
        colorScheme: ColorScheme
    ) async throws {
        let reduceTransparency = UIAccessibility.isReduceTransparencyEnabled
        for title in ["Budget", "Accounts", "Reports"] {
            let image = try await HostedViewSnapshot.image(
                of: Color.red.overlay(alignment: .top) {
                    HomeTopBar(
                        title: title, onNewEntry: {}, onPreferences: {}, showsActions: false
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 54)
                    .padding(.bottom, 8)
                    .kualiaToolbarBackground()
                }
                .environment(\.colorScheme, colorScheme),
                size: CGSize(width: 320, height: 300), scale: 1
            )
            let cgImage = try #require(image.cgImage)
            // Check both padded edges, including the status-bar region, where
            // scrolling content would otherwise remain fully visible.
            for point in [CGPoint(x: 2, y: 10), CGPoint(x: 318, y: 60)] {
                let sample = try #require(
                    cgImage.cropping(to: CGRect(origin: point, size: CGSize(width: 1, height: 1))))
                var channels = [UInt8](repeating: 0, count: 4)
                try channels.withUnsafeMutableBytes { buffer in
                    let context = try #require(
                        CGContext(
                            data: buffer.baseAddress, width: 1, height: 1,
                            bitsPerComponent: 8, bytesPerRow: 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                                | CGBitmapInfo.byteOrder32Big.rawValue
                        ))
                    context.draw(sample, in: CGRect(x: 0, y: 0, width: 1, height: 1))
                }
                let spread = Int(channels.prefix(3).max() ?? 0) - Int(channels.prefix(3).min() ?? 0)
                #expect(spread < (reduceTransparency ? 10 : 230))
                #expect(channels[3] == 255)
            }
        }
    }

    @Test func calendarDoesNotDimWhileItsRetainedDataRefreshes() async throws {
        let subject = PassthroughSubject<PlannedData, Error>()
        let workspace = TransactionFeedWorkspace(
            id: "agenda", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        let plans = PlannedStore(
            workspace: workspace,
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        plans.start()
        defer { plans.stop() }
        subject.send(
            PlannedData(
                today: plans.today,
                availableRange: .init(minYearMonth: 190001, maxYearMonth: 210012),
                allPlannedTransactions: [], plannedByMonth: [:]))
        for _ in 0..<100 where plans.data == nil { await Task.yield() }
        try #require(plans.data != nil)
        let calendar = PlannedCalendarPager(store: plans, onSelectDay: { _ in })
            .background(KualiaPalette.canvas)
        let loaded = try await HostedViewSnapshot.image(
            of: calendar, size: CGSize(width: 390, height: 420))
        plans.stop()
        plans.start()
        #expect(plans.isLoading)
        let refreshing = try await HostedViewSnapshot.image(
            of: calendar, size: CGSize(width: 390, height: 420))
        #expect(loaded.pngData() == refreshing.pngData(), "Refreshing must not dim calendar days.")
    }

    @Test func plannedSectionKeepsHistoryNearTheTopDuringLoadingAndRefresh() async throws {
        let subject = PassthroughSubject<PlannedData, Error>()
        let plans = PlannedStore(
            workspace: .init(
                id: "agenda", name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "UTC"),
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        plans.start()
        defer { plans.stop() }
        var historyPositions: [CGFloat] = []
        let content = List {
            TransactionAgendaView(
                plans: plans, isExpanded: .constant(true),
                onSelectPlan: { _ in })
            Text("Recorded history")
                .onGeometryChange(for: CGFloat.self) {
                    $0.frame(in: .global).minY
                } action: {
                    historyPositions.append($0)
                }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(KualiaPalette.canvas)
        var sample = 0
        _ = try await HostedViewSnapshot.image(
            of: content, size: CGSize(width: 390, height: 1_000), animationSampleCount: 100,
            onAnimationSample: { _ in
                sample += 1
                if sample == 20 {
                    subject.send(
                        PlannedData(
                            today: plans.today,
                            availableRange: .init(minYearMonth: 190001, maxYearMonth: 210012),
                            allPlannedTransactions: [], plannedByMonth: [:]))
                }
                if sample == 60 {
                    plans.stop()
                    plans.start()
                }
            })
        try #require(plans.data != nil)
        #expect(plans.isLoading)
        let first = try #require(historyPositions.first)
        #expect(
            first < 300, "The Planned section must not reserve the old inline calendar's height.")
        #expect(historyPositions.allSatisfy { abs($0 - first) < 1 })
    }

    @Test(arguments: [CGFloat(320), CGFloat(430)], [DynamicTypeSize.large, .accessibility3])
    func homeBudgetSwitchKeepsTheSharedBarAndVisibleScrollInsetStable(
        width: CGFloat, typeSize: DynamicTypeSize
    ) async throws {
        let state = HomeContainerRegressionState()
        state.navigation.restore(.home)
        state.usesSharedTopBar = true
        state.disablesAnimations = false
        var initialToolbarFrame: CGRect?
        var sample = 0
        var checkedSamples = 0
        var checkedPages: Set<HomePage> = []

        _ = try await HostedViewSnapshot.image(
            of: HomeContainerRegressionView(state: state).dynamicTypeSize(typeSize),
            size: CGSize(width: width, height: 740), animationSampleCount: 140,
            onAnimationSample: { root in
                sample += 1
                guard sample > 10 else { return }
                func findToolbar(in view: UIView) -> UIView? {
                    if view.accessibilityIdentifier == "test.homeToolbarFrame" { return view }
                    return view.subviews.lazy.compactMap { findToolbar(in: $0) }.first
                }
                guard let toolbar = findToolbar(in: root), toolbar.bounds.height > 0 else {
                    Issue.record("The shared toolbar must stay mounted during tab selection.")
                    return
                }
                let layer = toolbar.layer.presentation() ?? toolbar.layer
                let rootLayer = root.layer.presentation() ?? root.layer
                let frame = layer.convert(layer.bounds, to: rootLayer)
                if initialToolbarFrame == nil { initialToolbarFrame = frame }
                if let initialToolbarFrame {
                    #expect(abs(frame.minY - initialToolbarFrame.minY) < 1)
                    #expect(abs(frame.height - initialToolbarFrame.height) < 1)
                    // Check outgoing as well as incoming scroll views on every
                    // sampled frame, not just after the tab transition settles.
                    for scroll in visiblePageScrolls(in: root) {
                        let top = scroll.convert(
                            CGPoint(x: 0, y: scroll.bounds.minY + scroll.adjustedContentInset.top),
                            to: root
                        ).y
                        #expect(abs(top - (initialToolbarFrame.maxY + 8)) < 1)
                        checkedSamples += 1
                        checkedPages.insert(state.navigation.selectedPage)
                    }
                }

                // Both directions, a repeated visit, and the month-browsing row
                // must keep the same geometry even under an inherited animation.
                switch sample {
                case 30, 90: state.navigation.select(.budget)
                case 60, 120: state.navigation.select(.home)
                case 80: state.browsesPastMonth = true
                default: break
                }
            })
        #expect(checkedSamples > 90)
        #expect(checkedPages == [.home, .budget])
        for page in [HomePage.home, .budget] {
            let appearances = try #require(state.appearances[page])
            #expect(appearances.count >= 2)
            #expect(Set(appearances).count == 1, "Tab selection must preserve local page state.")
        }
    }

    @Test func horizontalFilterFadesStaySmallAndDoNotGrowWithScrollDistance() {
        for offset: CGFloat in [2, 10, 40, 200, 298] {
            let fade = HorizontalFilterFade(offset: offset, contentWidth: 600, viewportWidth: 300)
            #expect(fade.leading == 12)
            #expect(fade.trailing == 12)
        }
        let start = HorizontalFilterFade(offset: 0, contentWidth: 600, viewportWidth: 300)
        #expect(start.leading == 0)
        #expect(start.trailing == 12)
        let end = HorizontalFilterFade(offset: 300, contentWidth: 600, viewportWidth: 300)
        #expect(end.leading == 12)
        #expect(end.trailing == 0)
        let fits = HorizontalFilterFade(
            contentWidth: 260, viewportWidth: 300, leadingInset: 20, trailingInset: 20)
        #expect(fits.leading == 0 && fits.trailing == 0)
        let insetStart = HorizontalFilterFade(
            offset: -24, contentWidth: 600, viewportWidth: 300, leadingInset: 24, trailingInset: 24)
        #expect(insetStart.leading == 0 && insetStart.trailing == 12)
        let insetEnd = HorizontalFilterFade(
            offset: 324, contentWidth: 600, viewportWidth: 300, leadingInset: 24, trailingInset: 24)
        #expect(insetEnd.leading == 12 && insetEnd.trailing == 0)
    }

    @Test func pageBarInsetsPreserveBothToolbarHeights() {
        let bars = HomePageBarInsets(.init(top: 126, leading: 0, bottom: 84, trailing: 0))
        #expect(bars.top == 126)
        #expect(bars.bottom == 84)
        let keypad = HomePageBarInsets(.init(top: 126, leading: 0, bottom: 0, trailing: 0))
        #expect(keypad.top == 126)
        #expect(keypad.bottom == 0)
    }

    @Test(arguments: [CGFloat(-10), .nan, .infinity, -.infinity])
    func transientBarInsetsDoNotCreateInvalidFrames(value: CGFloat) {
        let top = HomePageBarInsets(.init(top: value, leading: 0, bottom: 64, trailing: 0))
        #expect(top.top == 0)
        #expect(top.bottom == 64)
        let bottom = HomePageBarInsets(.init(top: 126, leading: 0, bottom: value, trailing: 0))
        #expect(bottom.top == 126)
        #expect(bottom.bottom == 0)
    }

    @Test func budgetMonthTitleFitsZeroNarrowAndNormalLayoutProposals() {
        for width: CGFloat in [-10, 0, 8, 16, .nan, .infinity, -.infinity] {
            #expect(BudgetSlidingMonthTitle.titleWidth(in: width, fadeWidth: 8) == 0)
        }
        #expect(BudgetSlidingMonthTitle.titleWidth(in: 120, fadeWidth: 8) == 104)
        #expect(BudgetSlidingMonthTitle.titleWidth(in: 240, fadeWidth: 8) == 224)
    }

    @Test(arguments: [Color.green, Color.red])
    func rtaNavigationKeepsItsColorUntilTheCloseAnimationFinishes(background: Color) throws {
        var navigation = HomeBudgetPeekNavigation()
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: true)
        navigation.finish(id: try #require(navigation.request?.id))
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: false)
        let id = try #require(navigation.request?.id)
        navigation.finish(id: id, closingBackground: background)
        #expect(!navigation.isActive(workspaceID: "workspace"))
        #expect(navigation.closingBackground(workspaceID: "workspace") == background)
        navigation.finishClosing(id: UUID())
        #expect(navigation.closingBackground(workspaceID: "workspace") == background)
        navigation.finishClosing(id: id)
        #expect(navigation.closingBackground(workspaceID: "workspace") == nil)
    }

    @Test func interruptedRtaClosesCannotResetANewPeekOrLeakItsColorAcrossWorkspaces() throws {
        var navigation = HomeBudgetPeekNavigation()
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: true)
        navigation.finish(id: try #require(navigation.request?.id))
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: false)
        let oldClosing = try #require(navigation.request?.id)
        navigation.finish(id: oldClosing, closingBackground: .green)
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: true)
        #expect(navigation.isActive(workspaceID: "workspace"))
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: false)
        let newClosing = try #require(navigation.request?.id)
        navigation.finish(id: newClosing, closingBackground: .red)
        navigation.finishClosing(id: oldClosing)
        #expect(navigation.closingBackground(workspaceID: "workspace") == .red)
        #expect(navigation.closingBackground(workspaceID: "other") == nil)
        navigation.navigate(workspaceID: "other", isBudgetSelected: true)
        navigation.finishClosing(id: newClosing)
        #expect(navigation.closingBackground(workspaceID: "other") == nil)
        #expect(!navigation.isActive(workspaceID: "other"))
    }

    @Test func rtaWaitsForNavigationToSettleBeforeOpeningAndClosing() throws {
        var navigation = HomeBudgetPeekNavigation()
        var peek = BudgetPeekPresentation()
        func context() -> BudgetPeekPresentation.Context {
            .init(
                workspaceID: "workspace", readyToAssign: 8_000, isEditing: false,
                isActive: navigation.isActive(workspaceID: "workspace"))
        }
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: true)
        let openingID = try #require(navigation.request?.id)
        #expect(!peek.isVisible(in: context()))
        navigation.finish(id: openingID)
        peek.update(context())
        #expect(peek.isVisible)
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: false)
        let closingID = try #require(navigation.request?.id)
        #expect(peek.isVisible(in: context()))
        navigation.finish(id: closingID)
        #expect(!peek.isVisible(in: context()))
    }

    @Test func rapidPageChangesCancelPendingRtaOpeningAndClosing() throws {
        var navigation = HomeBudgetPeekNavigation()
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: true)
        let cancelledOpening = try #require(navigation.request?.id)
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: false)
        navigation.finish(id: cancelledOpening)
        #expect(!navigation.isActive(workspaceID: "workspace"))
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: true)
        navigation.finish(id: try #require(navigation.request?.id))
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: false)
        let cancelledClosing = try #require(navigation.request?.id)
        navigation.navigate(workspaceID: "workspace", isBudgetSelected: true)
        navigation.finish(id: cancelledClosing)
        #expect(navigation.isActive(workspaceID: "workspace"))
        #expect(navigation.request == nil)
    }

    @Test func rtaNavigationDoesNotCarryTheOldWorkspacePeekIntoANewWorkspace() throws {
        var navigation = HomeBudgetPeekNavigation()
        navigation.navigate(workspaceID: "old", isBudgetSelected: true)
        navigation.finish(id: try #require(navigation.request?.id))
        navigation.navigate(workspaceID: "old", isBudgetSelected: false)
        let oldClosing = try #require(navigation.request?.id)
        #expect(!navigation.isActive(workspaceID: "new"))
        navigation.navigate(workspaceID: "new", isBudgetSelected: true)
        let newOpening = try #require(navigation.request?.id)
        navigation.finish(id: oldClosing)
        #expect(!navigation.isActive(workspaceID: "new"))
        navigation.finish(id: newOpening)
        #expect(navigation.isActive(workspaceID: "new"))
        navigation.navigate(workspaceID: nil, isBudgetSelected: true)
        #expect(navigation.request == nil)
        #expect(!navigation.isActive(workspaceID: nil))
    }

    @Test(arguments: [CGFloat(80), CGFloat(126)])
    func nativePagesRetainLocalStateAndScrollWhilePeekResizesOnlyTheVisiblePage(
        topBarHeight: CGFloat
    )
        async throws
    {
        let state = HomeContainerRegressionState()
        state.navigation.restore(.home)
        state.topBarHeight = topBarHeight
        var stage = 0
        var sample = 0
        var settleAfter = 8
        var originalBudgetHeight: CGFloat = 0
        var restoredOffset: CGFloat?

        _ = try await HostedViewSnapshot.image(
            of: HomeContainerRegressionView(state: state),
            size: CGSize(width: 390, height: 740), animationSampleCount: 190,
            onAnimationSample: { root in
                sample += 1
                guard sample >= settleAfter, stage < 12 else { return }
                let scrolls = visiblePageScrolls(in: root)
                guard state.appearances[state.navigation.selectedPage] != nil,
                    let scroll = scrolls.first
                else { return }
                #expect(scrolls.count == 1, "Inactive tabs must leave the visible page hierarchy.")
                if #available(iOS 26.0, *) {
                    #expect(scroll.topEdgeEffect.style == expectedScrollEdgeStyle)
                    #expect(scroll.bottomEdgeEffect.style == expectedScrollEdgeStyle)
                    #expect(!scroll.topEdgeEffect.isHidden)
                    #expect(scroll.bottomEdgeEffect.isHidden == (state.bottomBarHeight == 0))
                }

                let top = scroll.convert(
                    CGPoint(x: 0, y: scroll.bounds.minY + scroll.adjustedContentInset.top),
                    to: root
                ).y
                let bottom = scroll.convert(
                    CGPoint(x: 0, y: scroll.bounds.maxY - scroll.adjustedContentInset.bottom),
                    to: root
                ).y
                #expect(abs(top - topBarHeight) < 1, "Reserve the top bar exactly once.")
                #expect(abs(bottom - (740 - state.peekHeight - state.bottomBarHeight)) < 1)

                switch stage {
                case 0:
                    #expect(Set(state.appearances.keys) == [.home])
                    #expect(state.renderedPages == [.home])
                    if let first = state.firstRowFrames[.home] {
                        #expect(first.minY >= topBarHeight)
                        #expect(first.minY < topBarHeight + 20, "No second header-sized gap.")
                    } else {
                        Issue.record("The first row must be laid out below the header.")
                    }
                    state.navigation.select(.transactions)
                case 1:
                    scroll.setContentOffset(
                        CGPoint(
                            x: scroll.contentOffset.x, y: 620 - scroll.adjustedContentInset.top),
                        animated: false)
                case 2:
                    #expect(abs(scroll.contentOffset.y + scroll.adjustedContentInset.top - 620) < 1)
                    state.navigation.select(.budget)
                case 3:
                    originalBudgetHeight = bottom - top
                    state.peekHeight = 68
                case 4:
                    #expect(abs((bottom - top) - (originalBudgetHeight - 68)) < 1)
                    state.peekHeight = 200
                case 5:
                    #expect(abs((bottom - top) - (originalBudgetHeight - 200)) < 1)
                    state.peekHeight = 0
                    state.navigation.select(.transactions)
                case 6:
                    restoredOffset = scroll.contentOffset.y + scroll.adjustedContentInset.top
                    state.navigation.select(.accounts)
                case 7:
                    scroll.setContentOffset(
                        CGPoint(
                            x: 0,
                            y: scroll.contentSize.height - scroll.bounds.height
                                + scroll.adjustedContentInset.bottom), animated: false)
                case 8:
                    if let last = state.lastRowFrames[.accounts] {
                        #expect(last.maxY <= bottom + 1, "The last row must clear the toolbar.")
                        #expect(last.minY >= top)
                    } else {
                        Issue.record("Scrolling to the end must reveal the last row.")
                    }
                    state.navigation.select(.reports)
                case 9:
                    state.bottomBarHeight = 0
                case 10:
                    state.bottomBarHeight = 64
                    state.navigation.select(.home)
                default:
                    break
                }
                stage += 1
                settleAfter = sample + 12
            })

        try #require(stage == 12, "Every native page transition and Peek resize must finish.")
        let finalOffset = try #require(restoredOffset)
        #expect(abs(finalOffset - 620) < 1)
        let transactionAppearances = try #require(state.appearances[.transactions])
        #expect(transactionAppearances.count >= 2)
        #expect(Set(transactionAppearances).count == 1, "Page-local State must survive navigation.")
        #expect(Set(state.appearances.keys) == Set(HomePage.navigationPages))
        #expect(state.renderedPages == Set(HomePage.navigationPages))
    }

    private func visiblePageScrolls(in root: UIView) -> [UIScrollView] {
        func collect(in view: UIView) -> [UIScrollView] {
            guard !view.isHidden, view.alpha > 0.01 else { return [] }
            if let scroll = view as? UIScrollView,
                scroll.contentSize.height > scroll.bounds.height,
                root.bounds.intersects(scroll.convert(scroll.bounds, to: root))
            {
                return [scroll]
            }
            return view.subviews.flatMap { collect(in: $0) }
        }
        return collect(in: root)
    }

    @Test func addAndMoreButtonsUseMatchingIconSizes() throws {
        let view = HomeTabBarView()
        let addImage = try #require(view.addButton.configuration?.image)
        let moreImage = try #require(view.moreButton.configuration?.image)
        #expect(addImage.size == CGSize(width: 25, height: 25))
        #expect(addImage.size == moreImage.size)
    }

    @Test func assistantMenuActionClosesTheMenu() {
        let menu = HomePageMenuState()
        menu.toggle()
        #expect(HomeMoreMenuOverlay.items.contains(.assistant))
        #expect(HomePageMenuItem.assistant.panel == .pages)
        #expect(menu.activate(.assistant) == .assistant)
        #expect(!menu.isPresented)
    }

    @Test func assistantIsPresentedOutsideThePageNavigation() {
        #expect(HomePage(rawValue: "assistant") == nil)
        #expect(!HomePage.menuItems.contains(where: { $0.title == "Assistant" }))
    }

    @Test func savedPlannedNavigationOpensTheCombinedTransactionsPage() {
        let navigation = HomeNavigationState()
        navigation.restore(.planned)
        #expect(navigation.selectedPage == .transactions)
        #expect(navigation.mountedPages == [.transactions])
        #expect(!HomePage.menuItems.contains(.planned))
        navigation.select(.home)
        navigation.select(.planned)
        #expect(navigation.selectedPage == .transactions)
        #expect(!navigation.mountedPages.contains(.planned))
    }

    @Test
    func homeDashboardKeepsItsScrollContentWithinTheViewport() async throws {
        for scenario in HomeDashboardScenario.allCases {
            for (width, typeSize): (CGFloat, DynamicTypeSize) in [
                (320, .large), (390, .large), (320, .accessibility3),
            ] {
                _ = try await HostedViewSnapshot.image(
                    of: HomeDashboardView(scenario: scenario)
                        .environment(\.dynamicTypeSize, typeSize)
                        .kualiaSafeAreaBar(edge: .top, spacing: 0) { Color.clear.frame(height: 80) }
                        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                            Color.clear.frame(height: 64)
                        }
                        .modifier(HomeScrollSurface(showsBottomToolbar: true)),
                    size: CGSize(width: width, height: 740),
                    inspect: { view in
                        var scrolls: [UIScrollView] = []
                        func collect(in view: UIView) {
                            if let scroll = view as? UIScrollView { scrolls.append(scroll) }
                            for child in view.subviews { collect(in: child) }
                        }
                        collect(in: view)
                        #expect(scrolls.count == 1)
                        for scroll in scrolls {
                            #expect(scroll.isScrollEnabled)
                            #expect(scroll.bounces)
                            #expect(scroll.alwaysBounceVertical)
                            #expect(!scroll.alwaysBounceHorizontal)
                            #expect(
                                scroll.contentSize.width + scroll.adjustedContentInset.left
                                    + scroll.adjustedContentInset.right <= scroll.bounds.width + 1)
                            if scenario == .needsAttention {
                                #expect(scroll.contentSize.height > scroll.bounds.height)
                            }
                        }
                    })
            }
        }
    }

    @Test
    func accountCreationPeekAddsHalfASecondToBothSteps() {
        #expect(TransactionPeekTiming.beforeHold(for: .accountCreated) == .milliseconds(1_500))
        #expect(TransactionPeekTiming.resultHold(for: .accountCreated) == .milliseconds(3_500))
        #expect(TransactionPeekTiming.beforeHold(for: .created) == .seconds(1))
        #expect(TransactionPeekTiming.resultHold(for: .created) == .seconds(3))
        #expect(TransactionPeekTiming.resultHold(for: .restored) == .milliseconds(2_500))
    }

    @Test
    func accountCreationPeekShowsConfirmationBeforeItsBalanceEffect() throws {
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        let receipt = TransactionMutationReceipt(
            workspace: workspace, dateKey: "2026-09-05", kind: .accountCreated,
            budgetChanges: [],
            accountCreation: AccountCreationSummary(
                accountID: "created", name: "Savings", accountType: "banking_savings",
                startingBalance: 50_000))
        var presentation = TransactionPeekPresentation()
        presentation.present(receipt)
        #expect(!presentation.showsFinalAmount)
        #expect(!presentation.showsUndo)
        #expect(!presentation.reveal.isPresented)
        presentation.revealContent(receiptID: receipt.id)
        #expect(presentation.reveal.isPresented)
        presentation.applyChange(receiptID: UUID())
        #expect(!presentation.showsFinalAmount)
        presentation.applyChange(receiptID: receipt.id)
        #expect(presentation.showsFinalAmount)
        #expect(presentation.receipt?.accountCreation?.readyToAssignDelta == 50_000)
        let session = try #require(presentation.reveal.sessionID)
        presentation.beginClosing(receiptID: receipt.id)
        let finished = presentation.finishClosing(receiptID: receipt.id, sessionID: session)
        #expect(finished)
        #expect(presentation.receipt == nil)
    }

    @Test
    func pageGlowsTrackIndependentScrollPositionsWithoutTitleClamping() {
        let state = HomeGlowScrollState()
        #expect(state.offset(for: .accounts) == 0)
        state.update(480, for: .transactions)
        state.update(125, for: .budget)
        state.update(-40, for: .accounts)
        #expect(state.offset(for: .transactions) == 480)
        #expect(state.offset(for: .budget) == 125)
        #expect(state.offset(for: .accounts) == 0)
        state.update(0, for: .transactions)
        #expect(state.offset(for: .transactions) == 0)
        #expect(state.offset(for: .budget) == 125)
    }

    @Test
    func peekScrollSurfaceKeepsNestedContentUnclippedAndHidesOnlyTheKeypadEdge() async throws {
        // Cover the full page, summary peek, and keypad viewport sizes. The
        // horizontal pager must also allow its vertical children beneath the bars.
        for (height, showsToolbar): (CGFloat, Bool) in [(800, true), (680, true), (440, false)] {
            var inspectedScrollViews = 0
            _ = try await HostedViewSnapshot.image(
                of: ScrollView(.horizontal) {
                    HStack(spacing: 0) {
                        ScrollView {
                            VStack {
                                ForEach(0..<40) { row in Text("Category \(row)").frame(height: 44) }
                            }
                        }
                        .frame(width: 390)
                    }
                }
                .kualiaSafeAreaBar(edge: .top, spacing: 0) { Color.clear.frame(height: 80) }
                .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                    if showsToolbar { Color.clear.frame(height: 64) }
                }
                .modifier(HomeScrollSurface(showsBottomToolbar: showsToolbar))
                .clipShape(RoundedRectangle(cornerRadius: 52)),
                size: CGSize(width: 390, height: height),
                inspect: { view in
                    @MainActor func inspectScrollViews(in view: UIView) {
                        if let scroll = view as? UIScrollView {
                            inspectedScrollViews += 1
                            #expect(!scroll.clipsToBounds)
                            if #available(iOS 26.0, *) {
                                #expect(!scroll.topEdgeEffect.isHidden)
                                #expect(scroll.bottomEdgeEffect.isHidden == !showsToolbar)
                                #expect(scroll.topEdgeEffect.style == expectedScrollEdgeStyle)
                                #expect(scroll.bottomEdgeEffect.style == expectedScrollEdgeStyle)
                            }
                        }
                        for child in view.subviews { inspectScrollViews(in: child) }
                    }
                    inspectScrollViews(in: view)
                })
            #expect(inspectedScrollViews == 2)
        }
    }

    @Test
    func readyToAssignUsesRedForNegativeAndGreenForPositiveAmounts() {
        #expect(
            KualiaPalette.budgetInputBackground(readyToAssign: -1)
                == KualiaPalette.peekDangerBackground)
        #expect(
            KualiaPalette.budgetInputBackground(readyToAssign: 1)
                == KualiaPalette.peekPositiveBackground)
        #expect(
            KualiaPalette.budgetInputBackground(readyToAssign: 0) == KualiaPalette.peekBackground)
        #expect(
            KualiaPalette.budgetInputBackground(readyToAssign: 0, showsCompletion: true)
                == KualiaPalette.peekPositiveBackground)
    }

    @Test
    func eachPageHasItsOwnColoredGlow() throws {
        #expect(Set(HomePage.allCases.map(\.glow)).count == HomePage.allCases.count)
        for page in HomePage.allCases {
            var red: CGFloat = 0
            var green: CGFloat = 0
            var blue: CGFloat = 0
            var alpha: CGFloat = 0
            try #require(UIColor(page.glow).getRed(&red, green: &green, blue: &blue, alpha: &alpha))
            #expect(max(red, green, blue) - min(red, green, blue) > 0.2)
        }
    }

    @Test
    func allPagesShareANeutralBackgroundInLightAndDarkMode() throws {
        for style in [UIUserInterfaceStyle.light, .dark] {
            let traits = UITraitCollection(userInterfaceStyle: style)
            let expected = UIColor(KualiaPalette.canvas).resolvedColor(with: traits)
            for page in HomePage.allCases {
                let color = UIColor(page.background).resolvedColor(with: traits)
                #expect(color == expected)
                var red: CGFloat = 0
                var green: CGFloat = 0
                var blue: CGFloat = 0
                var alpha: CGFloat = 0
                try #require(color.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
                #expect(abs(red - green) < 0.001)
                #expect(abs(green - blue) < 0.001)
                #expect(alpha == 1)
            }
        }
    }

    @Test
    func lightCanvasGivesSharedCardSurfacesSlightlyMoreContrast() throws {
        let lightTraits = UITraitCollection(userInterfaceStyle: .light)
        let darkTraits = UITraitCollection(userInterfaceStyle: .dark)
        let lightCanvas = UIColor(KualiaPalette.canvas).resolvedColor(with: lightTraits)
        let lightSurface = UIColor(KualiaPalette.surface).resolvedColor(with: lightTraits)
        let darkCanvas = UIColor(KualiaPalette.canvas).resolvedColor(with: darkTraits)
        let darkSurface = UIColor(KualiaPalette.surface).resolvedColor(with: darkTraits)

        var lightCanvasWhite: CGFloat = 0
        var lightSurfaceWhite: CGFloat = 0
        var darkCanvasWhite: CGFloat = 0
        var darkSurfaceWhite: CGFloat = 0
        var alpha: CGFloat = 0
        try #require(lightCanvas.getWhite(&lightCanvasWhite, alpha: &alpha))
        try #require(lightSurface.getWhite(&lightSurfaceWhite, alpha: &alpha))
        try #require(darkCanvas.getWhite(&darkCanvasWhite, alpha: &alpha))
        try #require(darkSurface.getWhite(&darkSurfaceWhite, alpha: &alpha))

        #expect(lightSurfaceWhite - lightCanvasWhite >= 0.059)
        #expect(lightSurfaceWhite - lightCanvasWhite <= 0.061)
        #expect(darkSurfaceWhite - darkCanvasWhite >= 0.054)
        #expect(darkSurfaceWhite - darkCanvasWhite <= 0.056)
    }

    @Test
    func peekKeepsItsContentAndUndoUntilCoveredAndIgnoresStaleCloseCompletions() throws {
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        let deleted = TransactionMutationReceipt(
            workspace: workspace, dateKey: "2026-09-05", kind: .deleted, budgetChanges: [])
        var presentation = TransactionPeekPresentation()
        presentation.present(deleted, showsUndo: true)
        let oldSession = try #require(presentation.reveal.sessionID)
        #expect(!presentation.reveal.isPresented)
        #expect(presentation.showsUndo)
        presentation.revealContent(receiptID: deleted.id)
        #expect(presentation.reveal.isPresented)

        presentation.beginClosing(receiptID: deleted.id)
        #expect(!presentation.reveal.isPresented)
        #expect(presentation.receipt?.id == deleted.id)
        #expect(presentation.showsUndo)
        presentation.revealContent(receiptID: deleted.id)
        #expect(!presentation.reveal.isPresented)

        let next = TransactionMutationReceipt(
            workspace: workspace, dateKey: deleted.dateKey, kind: .updated, budgetChanges: [])
        presentation.present(next)
        let currentSession = try #require(presentation.reveal.sessionID)
        let staleCloseFinished = presentation.finishClosing(
            receiptID: deleted.id, sessionID: oldSession)
        #expect(!staleCloseFinished)
        #expect(presentation.receipt?.id == next.id)
        presentation.revealContent(receiptID: deleted.id)
        #expect(!presentation.reveal.isPresented)
        presentation.revealContent(receiptID: next.id)
        #expect(presentation.reveal.isPresented)
        presentation.beginClosing(receiptID: next.id)
        let currentCloseFinished = presentation.finishClosing(
            receiptID: next.id, sessionID: currentSession)
        #expect(currentCloseFinished)
        #expect(presentation.receipt == nil)
        #expect(presentation.reveal.sessionID == nil)
        #expect(!presentation.showsUndo)
    }

    @Test
    func pendingTransactionPeekAnimatesWithoutAcknowledgementAndDoesNotReplayOnConfirmation() throws
    {
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        let values: [String: ConvexEncodable?] = [
            "categoryId": "dining", "name": "Dining out", "before": Int64(2_000),
            "after": Int64(3_000),
        ]
        let change = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
        var deleted = TransactionMutationReceipt(
            workspace: workspace, dateKey: "2026-09-06", kind: .deleted,
            budgetChanges: [change], isPending: true)
        var presentation = TransactionPeekPresentation()
        presentation.present(deleted, showsUndo: true)
        presentation.revealContent(receiptID: deleted.id)
        let session = try #require(presentation.reveal.sessionID)
        #expect(presentation.animationID == deleted.id)
        #expect(presentation.showsUndo)
        presentation.applyChange(receiptID: deleted.id)
        #expect(presentation.amount(for: change) == 3_000)
        deleted.isPending = false
        presentation.present(deleted, showsUndo: true)
        #expect(presentation.reveal.sessionID == session)
        #expect(presentation.showsFinalAmount)
        #expect(presentation.amount(for: change) == 3_000)

        var reversed = change
        reversed.before = change.after
        reversed.after = change.before
        var restored = TransactionMutationReceipt(
            workspace: workspace, dateKey: deleted.dateKey, kind: .restored,
            budgetChanges: [reversed], isPending: true)
        presentation.present(restored)
        #expect(presentation.animationID == restored.id)
        #expect(TransactionPeekTiming.beforeHold(for: .restored) == .zero)
        presentation.applyChange(receiptID: restored.id)
        #expect(presentation.amount(for: reversed) == 2_000)
        // Finishing before the server responds must not cause another peek later.
        let restoreSession = try #require(presentation.reveal.sessionID)
        presentation.beginClosing(receiptID: restored.id)
        let finished = presentation.finishClosing(receiptID: restored.id, sessionID: restoreSession)
        #expect(finished)
        restored.isPending = false
        presentation.present(restored)
        #expect(presentation.receipt == nil)
        #expect(presentation.animationID == nil)
    }

    @Test
    func earlyUndoStartsFromTheAmountCurrentlyOnScreen() throws {
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        let values: [String: ConvexEncodable?] = [
            "categoryId": "dining", "name": "Dining out", "before": Int64(2_000),
            "after": Int64(3_000),
        ]
        let change = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
        let deleted = TransactionMutationReceipt(
            workspace: workspace, dateKey: "2026-09-06", kind: .deleted,
            budgetChanges: [change], isPending: true)
        var presentation = TransactionPeekPresentation()
        presentation.present(deleted, showsUndo: true)
        presentation.revealContent(receiptID: deleted.id)
        var reversed = change
        reversed.before = change.after
        reversed.after = change.before
        let restored = TransactionMutationReceipt(
            workspace: workspace, dateKey: deleted.dateKey, kind: .restored,
            budgetChanges: [reversed], isPending: true)
        presentation.present(restored)
        #expect(presentation.receipt?.budgetChanges.first?.before == 2_000)
        #expect(presentation.receipt?.budgetChanges.first?.after == 2_000)
    }

    @Test
    func peekAppliesBothCategoryBalancesTogetherAndRejectsStaleUpdates() throws {
        let values: [String: ConvexEncodable?] = [
            "categoryId": "dining", "name": "Dining out", "before": Int64(2_000),
            "after": Int64(-500),
        ]
        let change = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
        let returningValues: [String: ConvexEncodable?] = [
            "categoryId": "groceries", "name": "Groceries", "before": Int64(1_000),
            "after": Int64(3_500),
        ]
        let returning = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(returningValues.convexEncode().utf8))
        let receipt = TransactionMutationReceipt(
            workspace: TransactionFeedWorkspace(
                id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "UTC"),
            dateKey: "2026-09-05",
            kind: .updated, budgetChanges: [returning, change], transactionID: "edited")
        var presentation = TransactionPeekPresentation()
        #expect(presentation.receipt == nil)
        presentation.present(receipt)
        #expect(presentation.categoryTitle(for: change) == "Dining out")
        #expect(presentation.amount(for: change) == 2_000)
        #expect(presentation.amount(for: returning) == 1_000)
        #expect(!presentation.showsFinalAmount)
        #expect(!presentation.isOverspent)
        presentation.applyChange(receiptID: receipt.id)
        #expect(presentation.amount(for: change) == -500)
        #expect(presentation.amount(for: returning) == 3_500)
        #expect(presentation.isOverspent)
        #expect(presentation.backgroundColor == KualiaPalette.peekDangerBackground)
        presentation.dismiss()
        presentation.applyChange(receiptID: receipt.id)
        #expect(presentation.receipt == nil)

        let next = TransactionMutationReceipt(
            workspace: receipt.workspace, dateKey: receipt.dateKey,
            budgetChanges: receipt.budgetChanges)
        presentation.present(next)
        presentation.applyChange(receiptID: receipt.id)
        #expect(presentation.amount(for: change) == 2_000)
        #expect(presentation.amount(for: returning) == 1_000)
        #expect(!presentation.showsFinalAmount)
    }

    @Test
    func peekTurnsGreenWhenMoneyArrivesButKeepsOverspendingRed() throws {
        let cases: [(before: Int64, after: Int64, color: Color)] = [
            (1_000, 1_500, KualiaPalette.peekPositiveBackground),
            (-500, 200, KualiaPalette.peekPositiveBackground),
            (-500, -200, KualiaPalette.peekDangerBackground),
            (1_000, 500, KualiaPalette.peekBackground),
        ]
        for scenario in cases {
            let values: [String: ConvexEncodable?] = [
                "categoryId": "dining", "name": "Dining out",
                "before": scenario.before, "after": scenario.after,
            ]
            let change = try JSONDecoder().decode(
                TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
            let receipt = TransactionMutationReceipt(
                workspace: TransactionFeedWorkspace(
                    id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
                    timezoneIdentifier: "UTC"),
                dateKey: "2026-09-05", budgetChanges: [change])
            var presentation = TransactionPeekPresentation()
            presentation.present(receipt)
            #expect(
                presentation.backgroundColor
                    == (scenario.before < 0 && scenario.after < 0
                        ? KualiaPalette.peekDangerBackground : KualiaPalette.peekBackground))
            presentation.applyChange(receiptID: receipt.id)
            #expect(presentation.backgroundColor == scenario.color)
            presentation.dismiss()
            #expect(presentation.backgroundColor == KualiaPalette.peekBackground)
        }
    }

    @Test
    func overspentLabelsFollowBothDisplayedBalancesDuringRecategorization() throws {
        let values: [[String: ConvexEncodable?]] = [
            [
                "categoryId": "dining", "name": "Dining out", "before": Int64(-500),
                "after": Int64(500),
            ],
            [
                "categoryId": "groceries", "name": "Groceries", "before": Int64(500),
                "after": Int64(-500),
            ],
        ]
        let changes = try values.map {
            try JSONDecoder().decode(
                TransactionBudgetChange.self, from: Data($0.convexEncode().utf8))
        }
        let receipt = TransactionMutationReceipt(
            workspace: TransactionFeedWorkspace(
                id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "UTC"),
            dateKey: "2026-09-05", kind: .updated, budgetChanges: changes)
        var presentation = TransactionPeekPresentation()
        presentation.present(receipt)
        #expect(presentation.isOverspent(for: changes[0]))
        #expect(!presentation.isOverspent(for: changes[1]))
        #expect(presentation.backgroundColor == KualiaPalette.peekBackground)
        presentation.applyChange(receiptID: receipt.id)
        #expect(!presentation.isOverspent(for: changes[0]))
        #expect(presentation.isOverspent(for: changes[1]))
        #expect(presentation.backgroundColor == KualiaPalette.peekDangerBackground)
    }

    @Test
    func peekStartsRedOnlyWhenAllAffectedCategoriesStayUnderfunded() throws {
        let scenarios: [(before: [Int64], after: [Int64], initialColor: Color)] = [
            ([-500, -100], [-200, -400], KualiaPalette.peekDangerBackground),
            ([-500, 500], [-200, 200], KualiaPalette.peekBackground),
            ([-500, -100], [200, -800], KualiaPalette.peekBackground),
        ]
        for scenario in scenarios {
            let changes = try scenario.before.indices.map { index in
                let values: [String: ConvexEncodable?] = [
                    "categoryId": "category-\(index)", "name": "Category \(index)",
                    "before": scenario.before[index], "after": scenario.after[index],
                ]
                return try JSONDecoder().decode(
                    TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
            }
            let receipt = TransactionMutationReceipt(
                workspace: TransactionFeedWorkspace(
                    id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
                    timezoneIdentifier: "UTC"),
                dateKey: "2026-09-05", kind: .updated, budgetChanges: changes)
            var presentation = TransactionPeekPresentation()
            presentation.present(receipt)
            #expect(presentation.backgroundColor == scenario.initialColor)
            presentation.applyChange(receiptID: receipt.id)
            #expect(presentation.backgroundColor == KualiaPalette.peekDangerBackground)
        }
    }

    @Test
    func peekOnlyLabelsMonthsWhenAnEditMovesMoneyBetweenMonthsOfTheSameCategory() throws {
        let values: [String: ConvexEncodable?] = [
            "categoryId": "dining", "name": "Dining out", "before": Int64(2_000),
            "after": Int64(3_000),
        ]
        var august = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
        august.yearMonth = 202608
        var september = august
        september.yearMonth = 202609
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        var presentation = TransactionPeekPresentation()
        presentation.present(
            TransactionMutationReceipt(
                workspace: workspace, dateKey: "2026-09-05", kind: .updated,
                budgetChanges: [september]))
        #expect(presentation.categoryTitle(for: september) == "Dining out")

        let dateEdit = TransactionMutationReceipt(
            workspace: workspace, dateKey: "2026-09-05", kind: .updated,
            budgetChanges: [august, september])
        presentation.present(dateEdit)
        #expect(
            presentation.categoryTitle(for: august) == "Dining out · \(BudgetMonth.title(202608))")
        #expect(
            presentation.categoryTitle(for: september)
                == "Dining out · \(BudgetMonth.title(202609))")
    }

    @Test
    func budgetChangeUsesExactDecimalDifferencesAcrossInt64Range() throws {
        let values: [String: ConvexEncodable?] = [
            "name": "Ready to Assign", "before": Int64.min, "after": Int64.max,
        ]
        let change = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
        #expect(change.delta == Decimal(Int64.max) - Decimal(Int64.min))
        #expect(!change.isOverspent)
    }

    @Test
    func accentsUseTheSystemDefault() {
        #expect(KualiaPalette.accent == Color.accentColor)
        for page in HomePage.allCases {
            #expect(page.accent == Color.accentColor)
        }
    }

    @Test
    func everyPageHasUniqueNavigationMetadata() {
        let pages = HomePage.allCases

        #expect(Set(pages.map(\.title)).count == pages.count)
        #expect(Set(pages.map(\.icon)).count == pages.count)
    }

    @Test
    func everyKualiaIconHasAnAvailableImage() {
        for icon in KualiaIcon.allCases {
            #expect(UIImage(named: icon.rawValue) != nil, "Missing Nucleo asset: \(icon.rawValue)")
        }
    }

    @Test
    func menuPlacesBudgetNearestTheLauncherAndCalendarAboveReports() {
        #expect(HomePage.menuItems == [.home, .reports, .accounts, .transactions, .budget])
        #expect(HomePage.home.title == L10n.string("Calendar"))
        #expect(HomePage.home.icon == .calendarClock)
    }

    @Test
    func workspaceSettingsOpensOneSheetWithoutChangingTheSelectedPage() {
        let item = HomePageMenuItem.settings
        let navigation = HomeNavigationState()
        navigation.restore(.budget)
        let menu = HomePageMenuState()
        menu.toggle()
        let action = menu.activate(item)
        #expect(action == item)
        #expect(!menu.isPresented)
        #expect(item.panel == .pages)
        #expect(
            WorkspaceSettingsSection.allCases == [.general, .merchants, .rules, .bankConnections])
        #expect(
            HomeMoreMenuOverlay.items == [.settings, .assistant, .page(.reports)])
        #expect(
            Set(HomeMoreMenuOverlay.items.map(\.accessibilityIdentifier)).count
                == HomeMoreMenuOverlay.items.count)
        #expect(navigation.selectedPage == .budget)
        #expect(navigation.mountedPages == [.budget])
        #expect(HomePage(rawValue: "settings") == nil)
        #expect(HomePage.navigationPages.count == 5)
    }

    @Test
    func scrollingTheMoreMenuOnlyAllowsVisibleDestinationsToBeSelected() {
        let geometry = HomePageMenuGeometry(
            itemFrames: [
                .settings: CGRect(x: 0, y: -54, width: 224, height: 48),
                .assistant: CGRect(x: 0, y: 0, width: 224, height: 48),
                .page(.reports): CGRect(x: 0, y: 54, width: 224, height: 48),
                .page(.home): CGRect(x: 0, y: 108, width: 224, height: 48),
            ],
            pagesViewport: CGRect(x: 0, y: 20, width: 224, height: 80))
        for y in [CGFloat(-30), 10, 105, 130] {
            #expect(
                HomePageMenuSelection.item(
                    at: CGPoint(x: 100, y: y), panel: .pages, geometry: geometry) == nil)
        }
        #expect(
            HomePageMenuSelection.item(
                at: CGPoint(x: 100, y: 30), panel: .pages, geometry: geometry) == .assistant)
        #expect(
            HomePageMenuSelection.item(
                at: CGPoint(x: 100, y: 80), panel: .pages, geometry: geometry) == .page(.reports))
    }

    @Test
    func draggingOntoSettingsReturnsTheModalActionAndClosesTheMenu() {
        let menu = HomePageMenuState()
        let geometry = HomePageMenuGeometry(itemFrames: [
            .settings: CGRect(x: 0, y: 0, width: 208, height: 48),
            .page(.reports): CGRect(x: 0, y: 54, width: 208, height: 48),
        ])
        let location = CGPoint(x: 100, y: 24)
        menu.dragChanged(at: location, geometry: geometry)
        #expect(menu.highlightedItem == .settings)
        let action = menu.endDrag(
            at: location, translation: CGSize(width: 0, height: -200), geometry: geometry)
        #expect(action == .settings)
        #expect(!menu.isPresented)
        #expect(menu.highlightedItem == nil)
    }

    @Test
    func launchOpensAndMountsOnlyBudget() {
        let state = HomeNavigationState()
        #expect(HomePage.allCases.first == .budget)
        #expect(state.selectedPage == .budget)
        #expect(state.mountedPages == [.budget])
        #expect(state.transactionScrollToTopRequest == 0)
    }

    @Test
    func backgroundScrollDoesNotInvalidateNavigationObservers() {
        let state = HomeNavigationState()
        let feedStore = TransactionFeedStore.preview
        let budgetStore = BudgetStore.preview
        let navigationUpdates = Mutex(0)
        let glow = HomeGlowScrollState()
        withObservationTracking {
            _ = HomePageContent(
                selectedPage: state.selectedPage, glowScrollState: glow,
                mountedPages: state.mountedPages,
                transactionFeedStore: feedStore,
                budgetStore: budgetStore,
                accountsStore: .preview,
                transactionScrollToTopRequest: state.transactionScrollToTopRequest
            )
        } onChange: {
            navigationUpdates.withLock { $0 += 1 }
        }

        for offset in 0..<240 { glow.update(CGFloat(offset), for: .transactions) }
        #expect(navigationUpdates.withLock { $0 } == 0)
        state.select(.transactions)
        #expect(navigationUpdates.withLock { $0 } == 1)
    }

    @Test
    func navigationRetainsEveryVisitedPage() {
        let state = HomeNavigationState()

        state.select(.budget)
        state.select(.transactions)

        #expect(state.selectedPage == .transactions)
        #expect(state.mountedPages == [.budget, .transactions])
    }

    @Test
    func revisitingPagesDoesNotInvalidateTheMountedPageTree() {
        let state = HomeNavigationState()
        state.select(.transactions)
        state.select(.accounts)
        let mountedUpdates = Mutex(0)
        withObservationTracking {
            _ = state.mountedPages
        } onChange: {
            mountedUpdates.withLock { $0 += 1 }
        }

        for _ in 0..<10 {
            state.select(.transactions)
            state.select(.accounts)
        }
        #expect(mountedUpdates.withLock { $0 } == 0)
        #expect(state.selectedPage == .accounts)

        state.select(.home)
        #expect(mountedUpdates.withLock { $0 } == 1)
        #expect(state.mountedPages == [.home, .transactions, .accounts, .budget])
    }

    @Test
    func reselectingTransactionsOnlyPublishesTheScrollRequest() {
        let state = HomeNavigationState()
        state.select(.transactions)
        let selectionUpdates = Mutex(0)
        let scrollRequests = Mutex(0)
        withObservationTracking {
            _ = state.selectedPage
            _ = state.mountedPages
        } onChange: {
            selectionUpdates.withLock { $0 += 1 }
        }
        withObservationTracking {
            _ = state.transactionScrollToTopRequest
        } onChange: {
            scrollRequests.withLock { $0 += 1 }
        }

        state.select(.transactions)
        #expect(selectionUpdates.withLock { $0 } == 0)
        #expect(scrollRequests.withLock { $0 } == 1)
        #expect(state.transactionScrollToTopRequest == 1)
    }

    @Test
    func scrollReportingIdentityIsStableAndRoutesToItsOwnPage() {
        let state = HomeGlowScrollState()
        let transactions = HomeGlowScrollReporting(state: state, page: .transactions)
        let recreated = HomeGlowScrollReporting(state: state, page: .transactions)
        let accounts = HomeGlowScrollReporting(state: state, page: .accounts)
        #expect(transactions == recreated)
        #expect(transactions != accounts)
        #expect(
            transactions
                != HomeGlowScrollReporting(state: HomeGlowScrollState(), page: .transactions))

        transactions.report(140)
        accounts.report(60)
        #expect(state.offset(for: .transactions) == 140)
        #expect(state.offset(for: .accounts) == 60)
        recreated.report(80)
        #expect(state.offset(for: .transactions) == 80)
        #expect(state.offset(for: .accounts) == 60)
    }

    @Test
    func unchangedScrollReportsDoNotInvalidateBackgrounds() {
        let state = HomeGlowScrollState()
        state.update(120, for: .transactions)
        let updates = Mutex(0)
        withObservationTracking {
            _ = state.offset(for: .transactions)
            _ = state.offset(for: .accounts)
        } onChange: {
            updates.withLock { $0 += 1 }
        }

        for _ in 0..<10 {
            state.update(120, for: .transactions)
            state.update(0, for: .accounts)
            state.update(-30, for: .accounts)
        }
        #expect(updates.withLock { $0 } == 0)
        state.update(121, for: .transactions)
        #expect(updates.withLock { $0 } == 1)
    }

    @Test(arguments: HomePage.tabPages)
    func reselectingATabOnlyScrollsThatPageAndReturningPreservesItsPosition(page: HomePage) {
        let state = HomeNavigationState()
        state.restore(page)
        let selectionUpdates = Mutex(0)
        withObservationTracking {
            _ = state.selectedPage
            _ = state.mountedPages
        } onChange: {
            selectionUpdates.withLock { $0 += 1 }
        }

        for count in 1...2 {
            state.select(page)
            #expect(state.budgetScrollToTopRequest == (page == .budget ? count : 0))
            #expect(state.accountsScrollToTopRequest == (page == .accounts ? count : 0))
            #expect(state.transactionScrollToTopRequest == (page == .transactions ? count : 0))
            #expect(selectionUpdates.withLock { $0 } == 0)
        }

        state.select(.reports)
        state.select(page)
        #expect(state.budgetScrollToTopRequest == (page == .budget ? 2 : 0))
        #expect(state.accountsScrollToTopRequest == (page == .accounts ? 2 : 0))
        #expect(state.transactionScrollToTopRequest == (page == .transactions ? 2 : 0))

        state.restore(page)
        #expect(state.budgetScrollToTopRequest == 0)
        #expect(state.accountsScrollToTopRequest == 0)
        #expect(state.transactionScrollToTopRequest == 0)
    }

    @Test
    func returningToTransactionsDoesNotRequestAScrollReset() {
        let state = HomeNavigationState()
        state.select(.transactions)

        state.select(.accounts)

        state.select(.transactions)

        #expect(state.transactionScrollToTopRequest == 0)
    }

    @Test
    func reselectingTransactionsRequestsAnotherScrollToTopEachTime() {
        let state = HomeNavigationState()
        state.select(.transactions)

        state.select(.transactions)

        #expect(state.transactionScrollToTopRequest == 1)
        #expect(state.selectedPage == .transactions)
        #expect(state.mountedPages == [.budget, .transactions])

        state.select(.transactions)

        #expect(state.transactionScrollToTopRequest == 2)
    }

    @Test
    func reselectingAnotherPageDoesNotRequestTransactionScrolling() {
        let state = HomeNavigationState()
        state.select(.budget)
        state.select(.budget)

        #expect(state.transactionScrollToTopRequest == 0)
    }

    @Test(arguments: [
        (0, 0, false), (0, 3, false), (1, 0, false), (1, 2, false),
        (2, 0, true), (2, 3, true), (3, 0, true),
    ])
    func workspacePickerRequiresMultipleUnarchivedWorkspaces(
        activeCount: Int, archivedCount: Int, expected: Bool
    ) {
        let active = (0..<activeCount).map {
            AppWorkspace(_id: "active-\($0)", name: "Workspace \($0)")
        }
        let archived = (0..<archivedCount).map {
            AppWorkspace(_id: "archived-\($0)", name: "Archived \($0)", isArchived: true)
        }
        let menu = HomePageMenu(
            selection: .budget, state: HomePageMenuState(), onSelect: { _ in },
            workspaces: active + archived, workspaceName: "Current workspace")
        #expect(menu.showsWorkspacePicker == expected)
    }

    @Test(arguments: [1, 2])
    func menuKeepsBothPanelsCompactWithLongWorkspaceNames(activeCount: Int) async throws {
        let workspaces = Array(
            [
                AppWorkspace(_id: "personal", name: String(repeating: "Long workspace ", count: 8)),
                AppWorkspace(_id: "shared", name: "Household", accessKind: "family"),
            ].prefix(activeCount))
        let showsPicker = activeCount == 2
        for panel in [HomePageMenuPanel.pages, .workspaces] {
            let menu = HomePageMenuState()
            menu.toggle()
            if panel == .workspaces { _ = menu.activate(.workspaces) }
            let measured = Mutex<CGSize?>(nil)
            let frames = Mutex<HomePageMenuGeometry>(.init())
            _ = try await HostedViewSnapshot.image(
                of: HomePageMenu(
                    selection: .budget, state: menu, onSelect: { _ in },
                    workspaces: workspaces, workspaceID: "personal",
                    workspaceName: workspaces[0].name
                )
                .onGeometryChange(for: CGSize.self) {
                    $0.size
                } action: { size in
                    measured.withLock { $0 = size }
                }
                .onPreferenceChange(HomePageMenuItemFramePreferenceKey.self) { geometry in
                    frames.withLock { $0 = geometry }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                .background(KualiaPalette.canvas),
                size: CGSize(width: 390, height: 844))
            let size = try #require(measured.withLock { $0 })
            #expect(
                size.width == HomePageMenuMetrics.menuWidth + 2 * HomePageMenuMetrics.contentPadding
            )
            #expect(
                size.height == HomePageMenuMetrics.contentHeight(hasWorkspace: showsPicker) + 2
                    * HomePageMenuMetrics.contentPadding)
            if !showsPicker || panel == .pages {
                let geometry = frames.withLock { $0 }
                let expectedOrder: [HomePageMenuItem] = [
                    .settings, .page(.home), .page(.reports), .page(.accounts),
                    .page(.transactions), .page(.budget),
                ]
                for (upper, lower) in zip(expectedOrder, expectedOrder.dropFirst()) {
                    let upperRow = try #require(geometry.itemFrames[upper])
                    let lowerRow = try #require(geometry.itemFrames[lower])
                    #expect(upperRow.maxY < lowerRow.minY)
                }
            }
            if !showsPicker {
                let geometry = frames.withLock { $0 }
                #expect(geometry.itemFrames[.workspaces] == nil)
                #expect(geometry.itemFrames[.back] == nil)
                #expect(geometry.itemFrames[.settings] != nil)
                #expect(geometry.itemFrames.count == HomePage.menuItems.count + 1)
            } else if panel == .pages {
                let geometry = frames.withLock { $0 }
                let switcher = try #require(geometry.itemFrames[.workspaces])
                for page in HomePage.menuItems {
                    let row = try #require(geometry.itemFrames[.page(page)])
                    #expect(switcher.maxY < row.minY)
                }
            }
        }
    }
}

@MainActor
struct HomePageMenuInteractionTests {
    private var launcher: CGPoint { CGPoint(x: 28, y: 460) }
    private var switcher: CGPoint { CGPoint(x: 100, y: 24) }
    private var geometry: HomePageMenuGeometry {
        .init(
            itemFrames: [
                .workspaces: CGRect(x: 0, y: 0, width: 208, height: 56),
                .page(.accounts): CGRect(x: 0, y: 68, width: 208, height: 48),
                .page(.reports): CGRect(x: 0, y: 122, width: 208, height: 48),
                .back: CGRect(x: 0, y: 0, width: 208, height: 56),
                .workspace("personal"): CGRect(x: 0, y: 92, width: 208, height: 48),
                .workspace("shared"): CGRect(x: 0, y: 146, width: 208, height: 48),
            ],
            workspaceViewport: CGRect(x: 0, y: 68, width: 208, height: 260))
    }

    private func finishDwell(_ menu: HomePageMenuState) {
        #expect(menu.pendingDwell != nil)
        if let id = menu.pendingDwell?.id { menu.finishDwell(id: id) }
    }

    @Test
    func dwellingOnBackReturnsDuringTheSamePressWithoutBouncing() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: switcher, geometry: geometry)
        finishDwell(menu)
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.pendingDwell == nil)
        menu.dragChanged(at: CGPoint(x: 100, y: 168), geometry: geometry)
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.panel == .workspaces)
        #expect(menu.highlightedItem == .back)
        finishDwell(menu)
        #expect(menu.panel == .pages)
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.pendingDwell == nil)
        #expect(menu.isPresented)
    }

    @Test
    func leavingOrReleasingBeforeDwellCancelsNavigation() throws {
        let menu = HomePageMenuState()
        menu.dragChanged(at: switcher, geometry: geometry)
        let oldID = try #require(menu.pendingDwell?.id)
        menu.dragChanged(at: CGPoint(x: 100, y: 140), geometry: geometry)
        menu.finishDwell(id: oldID)
        #expect(menu.panel == .pages)
        menu.dragChanged(at: switcher, geometry: geometry)
        let newID = try #require(menu.pendingDwell?.id)
        #expect(newID != oldID)
        menu.finishDwell(id: oldID)
        #expect(menu.panel == .pages)
        _ = menu.endDrag(
            at: switcher, translation: .init(width: 0, height: -200), geometry: geometry)
        menu.finishDwell(id: newID)
        #expect(menu.panel == .pages)
        #expect(menu.pendingDwell == nil)
        #expect(menu.isPresented)
    }

    @Test
    func dismissalCancelsDwellAndJitterDoesNotRestartIt() throws {
        let menu = HomePageMenuState()
        menu.dragChanged(at: switcher, geometry: geometry)
        let id = try #require(menu.pendingDwell?.id)
        menu.dragChanged(at: CGPoint(x: 102, y: 26), geometry: geometry)
        #expect(menu.pendingDwell?.id == id)
        menu.dismiss()
        menu.toggle()
        menu.finishDwell(id: id)
        #expect(menu.panel == .pages)
        #expect(menu.pendingDwell == nil)
    }

    @Test
    func dragHighlightsDoNotInvalidatePresentationOrRepeatWithinARow() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: geometry)
        menu.dragChanged(at: CGPoint(x: 100, y: 80), geometry: geometry)
        let presentationChanges = Mutex(0)
        let highlightChanges = Mutex(0)
        withObservationTracking {
            _ = menu.isPresented
        } onChange: {
            presentationChanges.withLock { $0 += 1 }
        }
        withObservationTracking {
            _ = menu.highlightedItem
        } onChange: {
            highlightChanges.withLock { $0 += 1 }
        }

        menu.dragChanged(at: CGPoint(x: 110, y: 90), geometry: geometry)
        menu.geometry = geometry
        #expect(highlightChanges.withLock { $0 } == 0)
        #expect(presentationChanges.withLock { $0 } == 0)

        menu.dragChanged(at: CGPoint(x: 100, y: 140), geometry: geometry)
        #expect(menu.highlightedItem == .page(.reports))
        #expect(highlightChanges.withLock { $0 } == 1)
        #expect(presentationChanges.withLock { $0 } == 0)
    }

    @Test
    func tappingTheLauncherOpensAndClosesWithoutSelecting() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: .init())
        let first = menu.endDrag(at: launcher, translation: .zero, geometry: geometry)
        #expect(first == nil)
        #expect(menu.isPresented)
        menu.dragChanged(at: launcher, geometry: geometry)
        let second = menu.endDrag(at: launcher, translation: .zero, geometry: geometry)
        #expect(second == nil)
        #expect(!menu.isPresented)
    }

    @Test
    func slidingToAPageStillSelectsOnRelease() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: .init())
        let location = CGPoint(x: 100, y: 140)
        menu.dragChanged(at: location, geometry: geometry)
        #expect(menu.highlightedItem == .page(.reports))
        let selected = menu.endDrag(
            at: location, translation: CGSize(width: 72, height: -320), geometry: geometry)
        #expect(selected == .page(.reports))
        #expect(!menu.isPresented)
    }

    @Test
    func draggingToTheSwitcherWaitsForDwellBeforeOpening() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: .init())
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.panel == .pages)
        finishDwell(menu)
        #expect(menu.isPresented)
        #expect(menu.panel == .workspaces)
        #expect(menu.highlightedItem == nil)
        // Back now occupies the exact position where the switcher was.
        menu.dragChanged(at: switcher, geometry: geometry)
        let selected = menu.endDrag(
            at: switcher, translation: CGSize(width: 72, height: -436), geometry: geometry)
        #expect(selected == nil)
        #expect(menu.isPresented)
        #expect(menu.panel == .workspaces)
    }

    @Test
    func movingWithinTheSwitcherBeforeLiftingDoesNotActivateBack() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: .init())
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.panel == .pages)
        finishDwell(menu)
        let location = CGPoint(x: switcher.x, y: switcher.y + 20)
        menu.dragChanged(at: location, geometry: geometry)
        let selected = menu.endDrag(
            at: location, translation: CGSize(width: 72, height: -416), geometry: geometry)
        #expect(selected == nil)
        #expect(menu.isPresented)
        #expect(menu.panel == .workspaces)
    }

    @Test
    func theSamePressCanContinueIntoAWorkspaceAndSelectIt() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: .init())
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.panel == .pages)
        finishDwell(menu)
        let location = CGPoint(x: 100, y: 168)
        menu.dragChanged(at: location, geometry: geometry)
        #expect(menu.highlightedItem == .workspace("shared"))
        let selected = menu.endDrag(
            at: location, translation: CGSize(width: 72, height: -292), geometry: geometry)
        #expect(selected == .workspace("shared"))
        #expect(!menu.isPresented)
        #expect(menu.panel == .pages)
    }

    @Test
    func incomingWorkspaceRowsCannotSelectThemselvesUnderAStationaryFinger() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: .init())
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.panel == .pages)
        finishDwell(menu)
        let incoming = HomePageMenuGeometry(
            itemFrames: [.workspace("personal"): CGRect(x: 0, y: 0, width: 208, height: 48)],
            workspaceViewport: CGRect(x: 0, y: 0, width: 208, height: 300))
        let jitter = CGPoint(x: switcher.x + 2, y: switcher.y + 3)
        menu.dragChanged(at: jitter, geometry: incoming)
        let selected = menu.endDrag(
            at: jitter, translation: CGSize(width: 74, height: -433), geometry: incoming)
        #expect(selected == nil)
        #expect(menu.isPresented)
        #expect(menu.highlightedItem == nil)
    }

    @Test
    func leavingTheMenuCancelsTheDragAndReopeningStartsWithPages() {
        let menu = HomePageMenuState()
        menu.dragChanged(at: launcher, geometry: .init())
        menu.dragChanged(at: switcher, geometry: geometry)
        #expect(menu.panel == .pages)
        finishDwell(menu)
        let location = CGPoint(x: 280, y: 168)
        menu.dragChanged(at: location, geometry: geometry)
        let selected = menu.endDrag(
            at: location, translation: CGSize(width: 252, height: -292), geometry: geometry)
        #expect(selected == nil)
        #expect(!menu.isPresented)
        menu.toggle()
        #expect(menu.panel == .pages)
    }

    @Test
    func backAndRetryKeepTheMenuOpen() {
        let menu = HomePageMenuState()
        menu.toggle()
        _ = menu.activate(.workspaces)
        let retry = menu.activate(.retryWorkspaces)
        #expect(retry == .retryWorkspaces)
        #expect(menu.isPresented)
        #expect(menu.panel == .workspaces)
        let back = menu.activate(.back)
        #expect(back == nil)
        #expect(menu.isPresented)
        #expect(menu.panel == .pages)
    }

    @Test
    func outgoingPanelFramesNeverSelectAPageFromTheWorkspacePanel() {
        let pagesOnly = HomePageMenuGeometry(itemFrames: [
            .page(.reports): geometry.itemFrames[.page(.reports)]!
        ])
        #expect(
            HomePageMenuSelection.item(
                at: CGPoint(x: 100, y: 140), panel: .workspaces, geometry: pagesOnly) == nil)
        #expect(
            HomePageMenuSelection.item(
                at: CGPoint(x: 100, y: 140), panel: .pages, geometry: geometry) == .page(.reports))
    }

    @Test
    func scrolledOffscreenWorkspacesAreNotDragTargets() {
        let clipped = HomePageMenuGeometry(
            itemFrames: [
                .workspace("above"): CGRect(x: 0, y: 0, width: 208, height: 48),
                .workspace("partial"): CGRect(x: 0, y: 54, width: 208, height: 48),
                .workspace("below"): CGRect(x: 0, y: 400, width: 208, height: 48),
            ],
            workspaceViewport: CGRect(x: 0, y: 68, width: 208, height: 260))
        for y in [20.0, 60.0, 410.0] {
            #expect(
                HomePageMenuSelection.item(
                    at: CGPoint(x: 100, y: y), panel: .workspaces, geometry: clipped) == nil)
        }
        #expect(
            HomePageMenuSelection.item(
                at: CGPoint(x: 100, y: 80), panel: .workspaces, geometry: clipped)
                == .workspace("partial"))
    }

    @Test
    func menuSelectionHasNoDeadZoneBetweenRows() {
        let frames = HomePageMenuGeometry(itemFrames: [
            .page(.accounts): CGRect(x: 0, y: 0, width: 208, height: 48),
            .page(.reports): CGRect(x: 0, y: 54, width: 208, height: 48),
        ])
        for y in stride(from: 0.0, to: 102.0, by: 0.5) {
            #expect(
                HomePageMenuSelection.item(
                    at: CGPoint(x: 100, y: y), panel: .pages, geometry: frames) != nil)
        }
        #expect(
            HomePageMenuSelection.item(at: CGPoint(x: 100, y: 50), panel: .pages, geometry: frames)
                == .page(.accounts))
        #expect(
            HomePageMenuSelection.item(at: CGPoint(x: 100, y: 51), panel: .pages, geometry: frames)
                == .page(.reports))
    }

    @Test(arguments: [-4_500, 0, 12_000])
    func workspaceSwitchRestoresThePreparedRTAWithoutAnOldCompletion(amount: Int) {
        var peek = BudgetPeekPresentation()
        peek.finishQuickAssign(
            context: .init(workspaceID: "old", readyToAssign: 0, isEditing: false, isActive: true),
            celebratesZero: true)
        peek.update(.init(workspaceID: "old", readyToAssign: 0, isEditing: false, isActive: false))
        #expect(!peek.isVisible)
        // The existing presentation receives the new context; no separate session
        // callback may replace it with an empty presentation after this update.
        peek.update(
            .init(
                workspaceID: "new", readyToAssign: Decimal(amount), isEditing: false, isActive: true
            ))
        #expect(peek.isVisible)
        #expect(peek.displayedReadyToAssign == Decimal(amount))
        #expect(peek.tone == BudgetPeekPresentation.Tone(readyToAssign: Decimal(amount)))
        #expect(peek.completionID == nil)
        #expect(!peek.isQuickAssignCompletion)
    }
}

@MainActor
struct HomeContentPresentationTests {
    @Test
    func firstContentWaitsForItsOwnLayout() {
        var presentation = HomeContentPresentation()
        let session = UUID()
        #expect(!presentation.isVisible(sessionID: session, isTransitioning: false))
        presentation.didLayout(sessionID: session, currentSessionID: session)
        #expect(presentation.isVisible(sessionID: session, isTransitioning: false))
    }

    @Test
    func newDataCannotRevealThePreviouslyRenderedWorkspace() {
        var presentation = HomeContentPresentation()
        let original = UUID()
        let next = UUID()
        presentation.didLayout(sessionID: original, currentSessionID: original)
        #expect(!presentation.isVisible(sessionID: original, isTransitioning: true))
        #expect(!presentation.isVisible(sessionID: next, isTransitioning: false))
        presentation.didLayout(sessionID: next, currentSessionID: next)
        #expect(presentation.isVisible(sessionID: next, isTransitioning: false))
    }

    @Test
    func oldLayoutCallbacksCannotRevealOrHideAnotherWorkspace() {
        var presentation = HomeContentPresentation()
        let original = UUID()
        let next = UUID()
        presentation.didLayout(sessionID: original, currentSessionID: next)
        #expect(!presentation.isVisible(sessionID: next, isTransitioning: false))
        presentation.didLayout(sessionID: next, currentSessionID: next)
        presentation.didLayout(sessionID: original, currentSessionID: next)
        #expect(presentation.isVisible(sessionID: next, isTransitioning: false))
        presentation.didLayout(sessionID: original, currentSessionID: nil)
        #expect(presentation.laidOutSessionID == next)
    }

    @Test
    func layoutDuringLoadingDoesNotRevealContentAndCancellationRetainsIt() {
        var presentation = HomeContentPresentation()
        let session = UUID()
        presentation.didLayout(sessionID: session, currentSessionID: session)
        #expect(!presentation.isVisible(sessionID: session, isTransitioning: true))
        #expect(presentation.isVisible(sessionID: session, isTransitioning: false))
    }

    @Test
    func previewsRemainVisibleWithoutAnAppSession() {
        #expect(HomeContentPresentation().isVisible(sessionID: nil, isTransitioning: false))
    }
}

@MainActor
@Observable
private final class HomeAccountNavigationRegressionState {
    var selection: HomeAccountDestination?
}

private struct HomeAccountNavigationRegressionView: View {
    @Bindable var state: HomeAccountNavigationRegressionState
    let store: AccountsStore

    var body: some View {
        NavigationStack {
            Text("Accounts")
                .modifier(HomeAccountNavigation(selection: $state.selection, store: store))
        }
        .transaction { $0.disablesAnimations = true }
    }
}

@MainActor
struct HomeAccountNavigationTests {
    @Test
    func accountSelectionPresentsAndDismissesASheetWithoutPushingTheShellStack() async throws {
        let state = HomeAccountNavigationRegressionState()
        var sample = 0
        func navigationControllers(in controller: UIViewController) -> [UINavigationController] {
            let current = (controller as? UINavigationController).map { [$0] } ?? []
            return current + controller.children.flatMap { navigationControllers(in: $0) }
        }
        _ = try await HostedViewSnapshot.image(
            of: HomeAccountNavigationRegressionView(state: state, store: .preview),
            size: CGSize(width: 390, height: 844), animationSampleCount: 120,
            onAnimationSample: { root in
                sample += 1
                guard let controller = root.window?.rootViewController else {
                    Issue.record("The account navigation must be hosted in a window.")
                    return
                }
                switch sample {
                case 10:
                    state.selection = HomeAccountDestination(id: "checking")
                case 40:
                    let stacks = navigationControllers(in: controller)
                    #expect(stacks.count == 1)
                    #expect(stacks.first?.viewControllers.count == 1)
                    let sheet = controller.presentedViewController
                    #expect(sheet != nil)
                    #expect(sheet.map { navigationControllers(in: $0).count } == 1)
                    state.selection = nil
                case 65:
                    #expect(state.selection == nil)
                    #expect(controller.presentedViewController == nil)
                    #expect(navigationControllers(in: controller).first?.viewControllers.count == 1)
                    state.selection = HomeAccountDestination(id: "savings")
                case 95:
                    #expect(navigationControllers(in: controller).first?.viewControllers.count == 1)
                    #expect(controller.presentedViewController != nil)
                    state.selection = nil
                case 115:
                    #expect(controller.presentedViewController == nil)
                    #expect(navigationControllers(in: controller).first?.viewControllers.count == 1)
                default:
                    break
                }
            })
        #expect(state.selection == nil)
    }
}
