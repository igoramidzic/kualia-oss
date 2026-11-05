import Observation
import SwiftUI

enum HomePageMenuMetrics {
    static let launcherSize: CGFloat = 56
    static let bottomSpacing: CGFloat = 8
    static let contentPadding: CGFloat = 8
    static let rowSpacing: CGFloat = 6
    static let menuWidth: CGFloat = 208
    static let rowHeight: CGFloat = 48
    static let workspaceHeaderHeight: CGFloat = 56

    static func contentHeight(
        hasWorkspace: Bool, hasAttentionError: Bool = false,
        itemCount: Int = HomePage.menuItems.count + 1
    ) -> CGFloat {
        let count = CGFloat(itemCount)
        return count * rowHeight + (count - 1) * rowSpacing
            + (hasWorkspace ? workspaceHeaderHeight + 1 + 2 * rowSpacing : 0)
            + (hasAttentionError ? rowHeight + rowSpacing : 0)
    }
}

struct HomePageMenuGeometry: Equatable {
    var itemFrames: [HomePageMenuItem: CGRect] = [:]
    var workspaceViewport: CGRect?
    var pagesViewport: CGRect?
}

struct HomePageMenuItemFramePreferenceKey: PreferenceKey {
    static let defaultValue = HomePageMenuGeometry()

    static func reduce(value: inout HomePageMenuGeometry, nextValue: () -> HomePageMenuGeometry) {
        let next = nextValue()
        value.itemFrames.merge(next.itemFrames, uniquingKeysWith: { _, next in next })
        value.workspaceViewport = next.workspaceViewport ?? value.workspaceViewport
        value.pagesViewport = next.pagesViewport ?? value.pagesViewport
    }
}

/// Only this overlay observes presentation. Drag highlights and animated geometry
/// must not invalidate HomeView and its retained page scenes.
struct HomePageMenuOverlay: View {
    let selection: HomePage
    let state: HomePageMenuState
    let onSelect: (HomePageMenuItem) -> Void
    let workspaces: [AppWorkspace]
    let workspaceID: String?
    let workspaceName: String?
    let workspaceError: String?
    let bottomInset: CGFloat
    var attentionStore: HomeNavigationAttentionStore? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if state.isPresented {
                Color.black.opacity(0.001)
                    .contentShape(.interaction, Rectangle())
                    .onTapGesture { state.dismiss() }
                    .accessibilityHidden(true)

                HomePageMenu(
                    selection: selection, state: state, onSelect: onSelect,
                    workspaces: workspaces, workspaceID: workspaceID,
                    workspaceName: workspaceName, workspaceError: workspaceError,
                    attention: attentionStore?.summary(
                        workspaces: workspaces, selectedWorkspaceID: workspaceID) ?? .init(),
                    attentionError: attentionStore?.errorMessage,
                    onRetryAttention: { attentionStore?.retry() }
                )
                .padding(.leading, 18)
                .padding(
                    .bottom,
                    Swift.max(12, bottomInset - 14) + HomePageMenuMetrics.bottomSpacing
                )
                .transition(
                    reduceMotion
                        ? .opacity
                        : .opacity.combined(with: .scale(scale: 0.94, anchor: .bottomLeading))
                )
                .zIndex(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(
            reduceMotion ? .easeInOut(duration: 0.16) : .spring(duration: 0.26, bounce: 0.08),
            value: state.isPresented
        )
        .onPreferenceChange(HomePageMenuItemFramePreferenceKey.self) { state.geometry = $0 }
    }
}

/// The More card shares the original press-and-slide selection state and row styling.
struct HomeMoreMenuOverlay: View {
    let selection: HomePage
    let state: HomePageMenuState
    let onSelect: (HomePageMenuItem) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.homeControlDock) private var dock

    var appSession: AppSessionStore? = nil
    var badges = HomeNavigationBadges()

    static let items: [HomePageMenuItem] = [
        .settings, .assistant, .page(.reports),
    ]

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottomTrailing) {
                if state.isPresented {
                    Color.black.opacity(0.001)
                        .contentShape(Rectangle())
                        .onTapGesture { state.dismiss() }
                        .accessibilityHidden(true)
                    HomePageMenu(
                        selection: selection, state: state, onSelect: onSelect,
                        workspaces: appSession?.workspaces ?? [],
                        workspaceID: appSession?.current?.workspace.id,
                        workspaceName: appSession?.current?.workspace.name,
                        workspaceError: appSession?.catalogError,
                        attention: appSession?.navigationAttention.summary(
                            workspaces: appSession?.workspaces ?? [],
                            selectedWorkspaceID: appSession?.current?.workspace.id) ?? .init(),
                        attentionError: badges.statusError,
                        onRetryAttention: {
                            if appSession?.catalogError != nil { appSession?.retry() }
                            appSession?.navigationAttention.retry()
                        },
                        menuItems: Self.items,
                        settingsTitle: L10n.string("Workspace settings"), menuWidth: 224,
                        maximumContentHeight: max(
                            0,
                            geometry.size.height - HomePageMenuMetrics.bottomSpacing
                                - 2 * HomePageMenuMetrics.contentPadding),
                        pageStatuses: badges.pageStatuses,
                        settingsStatus: badges.settingsStatus
                    )
                    .padding(
                        .trailing,
                        dock.map { $0.width + 8 } ?? (18 + HomeBottomBarMetrics.actionSize + 12)
                    )
                    .padding(.bottom, HomePageMenuMetrics.bottomSpacing)
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .opacity.combined(with: .scale(scale: 0.94, anchor: .bottomTrailing)))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        }
        .animation(
            reduceMotion ? .easeInOut(duration: 0.16) : .spring(duration: 0.26, bounce: 0.08),
            value: state.isPresented
        )
        .onPreferenceChange(HomePageMenuItemFramePreferenceKey.self) { state.geometry = $0 }
        .task(id: state.pendingDwell?.id) {
            guard let id = state.pendingDwell?.id else { return }
            do {
                try await Task.sleep(for: HomePageMenuState.submenuDwellDuration)
                try Task.checkCancellation()
                state.finishDwell(id: id)
            } catch { return }
        }
        .sensoryFeedback(.selection, trigger: state.panel)
        .sensoryFeedback(.selection, trigger: state.highlightedItem) { _, item in item != nil }
        .accessibilityAction(.escape) { state.dismiss() }
    }
}

struct HomePageMenu: View {
    let selection: HomePage
    let state: HomePageMenuState
    let onSelect: (HomePageMenuItem) -> Void
    var workspaces: [AppWorkspace] = []
    var workspaceID: String? = nil
    var workspaceName: String? = nil
    var workspaceError: String? = nil
    var attention = HomeNavigationAttention()
    var attentionError: String? = nil
    var onRetryAttention: () -> Void = {}
    var menuItems: [HomePageMenuItem] = [.settings] + HomePage.menuItems.map(HomePageMenuItem.page)
    var settingsTitle: String = L10n.string("Settings")
    var menuWidth: CGFloat = HomePageMenuMetrics.menuWidth
    var maximumContentHeight: CGFloat = .infinity
    var pageStatuses: [HomePage: HomeAttentionStatus] = [:]
    var settingsStatus: HomeAttentionStatus?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var availableWorkspaces: [AppWorkspace] { workspaces.filter { !$0.isArchived } }
    var showsWorkspacePicker: Bool { availableWorkspaces.count >= 2 }
    private var contentHeight: CGFloat {
        HomePageMenuMetrics.contentHeight(
            hasWorkspace: showsWorkspacePicker, hasAttentionError: attentionError != nil,
            itemCount: menuItems.count)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if state.panel == .pages || !showsWorkspacePicker {
                Group {
                    if contentHeight > maximumContentHeight {
                        ScrollView { pages }
                            .scrollIndicators(.hidden)
                    } else {
                        pages
                    }
                }
                .background {
                    GeometryReader { geometry in
                        Color.clear.preference(
                            key: HomePageMenuItemFramePreferenceKey.self,
                            value: .init(pagesViewport: geometry.frame(in: .global)))
                    }
                }
                .compositingGroup()
                .transition(panelTransition(offset: -16))
            } else {
                workspacePicker
                    .compositingGroup()
                    .transition(panelTransition(offset: 16))
            }
        }
        // Constrain the whole panel, including dividers and scroll views. Keeping
        // both panels the same size also keeps the switcher under a dragging finger.
        .frame(
            width: menuWidth,
            height: min(contentHeight, maximumContentHeight),
            alignment: .top
        )
        .clipped()
        .padding(HomePageMenuMetrics.contentPadding)
        .kualiaControlGlass(in: RoundedRectangle(cornerRadius: 24))
        .shadow(color: .black.opacity(0.16), radius: 20, y: 10)
        .animation(
            reduceMotion ? .easeInOut(duration: 0.16) : .smooth(duration: 0.22),
            value: state.panel
        )
        .onChange(of: !showsWorkspacePicker && state.panel == .workspaces, initial: true) {
            _, shouldReturn in
            if shouldReturn { _ = state.activate(.back) }
        }
    }

    private var pages: some View {
        VStack(spacing: HomePageMenuMetrics.rowSpacing) {
            if showsWorkspacePicker {
                menuButton(.workspaces) {
                    HStack(spacing: 12) {
                        KualiaIconImage(icon: .workspace, size: 22)
                            .foregroundStyle(KualiaPalette.menuOptionAccent)
                            .frame(width: 32, height: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("WORKSPACE")
                                .font(.system(size: 9, weight: .semibold))
                                .tracking(1)
                                .foregroundStyle(KualiaPalette.mutedInk)
                            Text(workspaceName ?? L10n.string("Choose workspace"))
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        if let status = attention.otherWorkspaces {
                            HomeAttentionDot(status: status)
                        }
                        KualiaIconImage(icon: .chevronRight, size: 11)
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(KualiaPalette.ink)
                    .padding(.horizontal, 9)
                    .frame(height: HomePageMenuMetrics.workspaceHeaderHeight)
                    .background(rowHighlight(.workspaces), in: RoundedRectangle(cornerRadius: 16))
                    .contentShape(.interaction, RoundedRectangle(cornerRadius: 16))
                }
                .accessibilityLabel(L10n.string("Switch workspace"))
                .accessibilityValue(
                    [
                        workspaceName,
                        attention.otherWorkspaces.map {
                            L10n.string("Other workspaces: \($0.message)")
                        },
                    ]
                    .compactMap { $0 }.joined(separator: ". ")
                )
                .accessibilityHint(
                    L10n.string("Opens workspaces. Choose one and stay on \(selection.title)")
                )
                .accessibilityIdentifier("home.workspacePicker")
                Divider().padding(.horizontal, 10)
            }
            ForEach(menuItems, id: \.self) { item in
                let page: HomePage? = if case .page(let page) = item { page } else { nil }
                let title = item.title(settingsTitle: settingsTitle)
                let pageStatus =
                    item == .settings
                    ? settingsStatus : page.flatMap { status(for: $0) }
                menuButton(item) {
                    HomePageMenuRow(
                        title: title,
                        icon: item.icon,
                        isSelected: page == selection,
                        isHighlighted: state.highlightedItem == item,
                        status: pageStatus)
                }
                .accessibilityLabel(title)
                .accessibilityValue(pageStatus?.message ?? "")
                .accessibilityIdentifier(item.accessibilityIdentifier)
                .accessibilityAddTraits(page == selection ? .isSelected : [])
            }
            if let attentionError {
                Button(action: onRetryAttention) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(attentionError).font(.system(size: 10))
                        Text(L10n.string("Retry status")).font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(KualiaPalette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 9)
                    .frame(height: HomePageMenuMetrics.rowHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityIdentifier("home.attention.retry")
            }
        }
    }

    private var workspacePicker: some View {
        VStack(spacing: HomePageMenuMetrics.rowSpacing) {
            menuButton(.back) {
                HStack(spacing: 12) {
                    KualiaIconImage(icon: .chevronLeft, size: 14)
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 32, height: 32)
                    Text(L10n.string("Workspaces"))
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                    Spacer(minLength: 4)
                }
                .foregroundStyle(KualiaPalette.ink)
                .padding(.horizontal, 9)
                .frame(height: HomePageMenuMetrics.workspaceHeaderHeight)
                .background(rowHighlight(.back), in: RoundedRectangle(cornerRadius: 16))
                .contentShape(.interaction, RoundedRectangle(cornerRadius: 16))
            }
            .accessibilityLabel(L10n.string("Back to pages"))
            .accessibilityIdentifier("home.workspacePicker.back")
            Divider().padding(.horizontal, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: HomePageMenuMetrics.rowSpacing) {
                    if let workspaceError {
                        Text(workspaceError)
                            .font(.caption)
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .padding(.horizontal, 9)
                        menuButton(.retryWorkspaces) {
                            Text(L10n.string("Try again"))
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .foregroundStyle(KualiaPalette.ink)
                                .frame(
                                    maxWidth: .infinity, minHeight: HomePageMenuMetrics.rowHeight
                                )
                                .background(
                                    rowHighlight(.retryWorkspaces),
                                    in: RoundedRectangle(cornerRadius: 16)
                                )
                                .contentShape(.interaction, RoundedRectangle(cornerRadius: 16))
                        }
                    }
                    workspaceSection(L10n.string("Your workspaces"), shared: false)
                    workspaceSection(L10n.string("Shared with you"), shared: true)
                    if availableWorkspaces.isEmpty, workspaceError == nil {
                        Text(L10n.string("No workspaces available"))
                            .font(.caption)
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .padding(9)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: HomePageMenuItemFramePreferenceKey.self,
                        value: .init(workspaceViewport: geometry.frame(in: .global)))
                }
            }
        }
    }

    @ViewBuilder
    private func workspaceSection(_ title: String, shared: Bool) -> some View {
        let choices = availableWorkspaces.filter { $0.isShared == shared }
        if !choices.isEmpty {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(KualiaPalette.mutedInk)
                .padding(.horizontal, 9)
                .padding(.top, 6)
            ForEach(choices) { workspace in
                menuButton(.workspace(workspace.id)) {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(workspace.name)
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .lineLimit(1)
                            if let status = attention.workspace(workspace.id)?.status,
                                status.level == .newActivity
                            {
                                Text(status.level.title)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(KualiaPalette.mutedInk)
                            }
                        }
                        Spacer(minLength: 4)
                        if let status = attention.workspace(workspace.id)?.status {
                            HomeAttentionDot(status: status)
                        }
                        if workspace.id == workspaceID {
                            KualiaIconImage(icon: .check, size: 13)
                                .font(.system(size: 13, weight: .semibold))
                        }
                    }
                    .foregroundStyle(KualiaPalette.ink)
                    .padding(.horizontal, 12)
                    .frame(height: HomePageMenuMetrics.rowHeight)
                    .background(
                        rowHighlight(
                            .workspace(workspace.id), selected: workspace.id == workspaceID),
                        in: RoundedRectangle(cornerRadius: 16)
                    )
                    .contentShape(.interaction, RoundedRectangle(cornerRadius: 16))
                }
                .accessibilityLabel(workspace.name)
                .accessibilityValue(attention.workspace(workspace.id)?.status?.message ?? "")
                .accessibilityAddTraits(workspace.id == workspaceID ? .isSelected : [])
                .accessibilityIdentifier("home.workspace.\(workspace.id)")
            }
        }
    }

    private func menuButton<Label: View>(
        _ item: HomePageMenuItem, @ViewBuilder label: () -> Label
    ) -> some View {
        Button {
            if let selection = state.activate(item) { onSelect(selection) }
        } label: {
            label()
        }
        .buttonStyle(.kualiaHaptic)
        .background {
            GeometryReader { geometry in
                Color.clear.preference(
                    key: HomePageMenuItemFramePreferenceKey.self,
                    value: .init(itemFrames: [item: geometry.frame(in: .global)]))
            }
        }
    }

    private func rowHighlight(_ item: HomePageMenuItem, selected: Bool = false) -> Color {
        KualiaPalette.menuOptionHighlight.opacity(
            state.highlightedItem == item ? 1 : selected ? 0.68 : 0)
    }

    private func panelTransition(offset: CGFloat) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .offset(x: offset))
    }

    private func status(for page: HomePage) -> HomeAttentionStatus? {
        if let status = pageStatuses[page] { return status }
        return switch page {
        case .budget: attention.current?.budget
        case .transactions: attention.current?.transactions
        default: nil
        }
    }
}

private struct HomePageMenuRow: View {
    let title: String
    let icon: KualiaIcon
    let isSelected: Bool
    let isHighlighted: Bool
    var status: HomeAttentionStatus? = nil

    var body: some View {
        HStack(spacing: 12) {
            KualiaIconImage(icon: icon, size: 22)
                .foregroundStyle(KualiaPalette.menuOptionAccent)
                .frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(KualiaPalette.ink)
                if let status, status.level == .newActivity {
                    Text(status.level.title)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            Spacer(minLength: 8)
            if let status { HomeAttentionDot(status: status) }
        }
        .padding(.horizontal, 9)
        .frame(height: HomePageMenuMetrics.rowHeight)
        .background(
            KualiaPalette.menuOptionHighlight.opacity(isHighlighted ? 1 : isSelected ? 0.68 : 0),
            in: RoundedRectangle(cornerRadius: 16)
        )
        .contentShape(.interaction, RoundedRectangle(cornerRadius: 16))
    }
}

struct HomePagePicker: View {
    let selection: HomePage
    let state: HomePageMenuState
    let onSelect: (HomePageMenuItem) -> Void
    var attentionStatus: HomeAttentionStatus? = nil
    var attentionError: String? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        KualiaIconImage(icon: selection.icon, size: 24)
            .frame(
                width: HomePageMenuMetrics.launcherSize,
                height: HomePageMenuMetrics.launcherSize
            )
            .foregroundStyle(KualiaPalette.ink)
            .kualiaControlGlass(in: Circle())
            .kualiaGlassIdentityTransition()
            .overlay(alignment: .topTrailing) {
                if let attentionStatus {
                    HomeAttentionDot(status: attentionStatus)
                        .padding(5)
                }
            }
            .contentShape(.interaction, Circle())
            .gesture(pageSelectionGesture)
            .task(id: state.pendingDwell?.id) {
                guard let id = state.pendingDwell?.id else { return }
                do {
                    try await Task.sleep(for: HomePageMenuState.submenuDwellDuration)
                    try Task.checkCancellation()
                    withAnimation(menuAnimation) { state.finishDwell(id: id) }
                } catch { return }
            }
            .sensoryFeedback(
                .impact(weight: .medium, intensity: 0.8), trigger: state.isPresented
            ) { wasPresented, isPresented in !wasPresented && isPresented }
            .sensoryFeedback(.selection, trigger: state.highlightedItem) { _, item in item != nil }
            .sensoryFeedback(.selection, trigger: state.panel)
            .accessibilityElement()
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(L10n.string("Choose page or workspace"))
            .accessibilityValue(
                [selection.title, attentionStatus?.message, attentionError]
                    .compactMap { $0 }.joined(separator: ". ")
            )
            .accessibilityHint(L10n.string("Tap to open, or press and slide up to select"))
            .accessibilityAction {
                withAnimation(menuAnimation) { state.toggle() }
            }
    }

    private var pageSelectionGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { value in
                withAnimation(menuAnimation) {
                    state.dragChanged(at: value.location, geometry: state.geometry)
                }
            }
            .onEnded { value in
                let item = state.endDrag(
                    at: value.location, translation: value.translation, geometry: state.geometry)
                if let item { onSelect(item) }
            }
    }

    private var menuAnimation: Animation {
        reduceMotion ? .easeInOut(duration: 0.16) : .spring(duration: 0.26, bounce: 0.08)
    }
}

/// Small, static indicators preserve the launcher's hit target and drag gesture.
private struct HomeAttentionDot: View {
    let status: HomeAttentionStatus

    var body: some View {
        Group {
            if status.level == .issue {
                Text(status.count, format: .number.grouping(.never))
                    .font(.system(size: 13).monospacedDigit())
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(.horizontal, 3)
                    .frame(minWidth: 18, minHeight: 18)
                    .background(Color(uiColor: .systemRed), in: Capsule())
            } else {
                Circle().fill(Color(uiColor: .systemRed)).frame(width: 9, height: 9)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

enum HomePageMenuPanel { case pages, workspaces }

enum HomePageMenuItem: Hashable {
    case page(HomePage)
    case settings
    case assistant
    case workspaces
    case back
    case workspace(String)
    case retryWorkspaces

    var panel: HomePageMenuPanel {
        switch self {
        case .page, .settings, .assistant, .workspaces: .pages
        case .back, .workspace, .retryWorkspaces: .workspaces
        }
    }

    func title(settingsTitle: String) -> String {
        switch self {
        case .page(let page): page.title
        case .assistant: L10n.string("AI Assistant")
        case .settings: settingsTitle
        default: settingsTitle
        }
    }

    var icon: KualiaIcon {
        switch self {
        case .page(let page): page.icon
        case .assistant: .assistant
        default: .preferences
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .page(let page): "home.more.\(page.rawValue)"
        case .assistant: "home.more.assistant"
        default: "home.workspaceSettings"
        }
    }
}

/// The launcher and both panels share a gesture session, so entering workspaces
/// does not end the original press or accidentally activate the new row underneath it.
@Observable
final class HomePageMenuState {
    static let submenuDwellDuration: Duration = .milliseconds(350)

    struct Dwell {
        let id = UUID()
        let item: HomePageMenuItem
        let entryFrame: CGRect?
    }

    private(set) var pendingDwell: Dwell?
    // Geometry is read by gesture callbacks, never by the home render tree.
    @ObservationIgnored var geometry = HomePageMenuGeometry()
    private(set) var isPresented = false
    private(set) var panel = HomePageMenuPanel.pages
    private(set) var highlightedItem: HomePageMenuItem?
    @ObservationIgnored private var isTrackingPress = false
    @ObservationIgnored private var wasPresentedWhenPressBegan = false
    @ObservationIgnored private var panelEntryFrame: CGRect?

    func toggle() {
        if isPresented { dismiss() } else { isPresented = true }
    }

    func dismiss() {
        pendingDwell = nil
        isPresented = false
        panel = .pages
        highlightedItem = nil
        isTrackingPress = false
        wasPresentedWhenPressBegan = false
        panelEntryFrame = nil
    }

    func activate(_ item: HomePageMenuItem) -> HomePageMenuItem? {
        guard isPresented, item.panel == panel else { return nil }
        pendingDwell = nil
        highlightedItem = nil
        switch item {
        case .workspaces:
            panel = .workspaces
            return nil
        case .back:
            panel = .pages
            return nil
        case .retryWorkspaces:
            return item
        case .page, .settings, .assistant, .workspace:
            dismiss()
            return item
        }
    }

    func dragChanged(at location: CGPoint, geometry: HomePageMenuGeometry) {
        if !isTrackingPress {
            isTrackingPress = true
            wasPresentedWhenPressBegan = isPresented
            isPresented = true
        }
        guard hasMovedIntoPanel(at: location) else { return }
        let item = HomePageMenuSelection.item(at: location, panel: panel, geometry: geometry)
        if highlightedItem != item { highlightedItem = item }
        if item == .workspaces || item == .back {
            if pendingDwell?.item != item, let item {
                pendingDwell = Dwell(
                    item: item, entryFrame: geometry.itemFrames[item]?.insetBy(dx: -8, dy: -8))
            }
        } else {
            pendingDwell = nil
        }
    }

    func finishDwell(id: UUID) {
        guard isPresented, isTrackingPress, let dwell = pendingDwell,
            dwell.id == id, dwell.item == highlightedItem, dwell.item.panel == panel
        else { return }
        _ = activate(dwell.item)
        // Require leaving this row before it can target the incoming Back/switcher.
        panelEntryFrame = dwell.entryFrame
    }

    func endDrag(
        at location: CGPoint, translation: CGSize, geometry: HomePageMenuGeometry
    ) -> HomePageMenuItem? {
        defer {
            pendingDwell = nil
            isTrackingPress = false
            wasPresentedWhenPressBegan = false
            panelEntryFrame = nil
            highlightedItem = nil
        }
        // Releasing on the switcher leaves its panel open; a stationary finger
        // must not activate Back or a workspace as the incoming panel is laid out.
        guard hasMovedIntoPanel(at: location) else { return nil }
        if let item = HomePageMenuSelection.item(at: location, panel: panel, geometry: geometry) {
            if item == .workspaces || item == .back { return nil }
            return activate(item)
        }
        let wasTap = abs(translation.width) < 10 && abs(translation.height) < 10
        if !wasTap || wasPresentedWhenPressBegan { dismiss() }
        return nil
    }

    private func hasMovedIntoPanel(at location: CGPoint) -> Bool {
        guard let frame = panelEntryFrame else { return true }
        guard !frame.contains(location) else { return false }
        panelEntryFrame = nil
        return true
    }
}

enum HomePageMenuSelection {
    static func item(
        at location: CGPoint, panel: HomePageMenuPanel, geometry: HomePageMenuGeometry
    ) -> HomePageMenuItem? {
        let rows = geometry.itemFrames.compactMap { item, frame -> (HomePageMenuItem, CGRect)? in
            guard item.panel == panel else { return nil }
            var visibleFrame = frame
            switch item {
            case .workspace, .retryWorkspaces:
                guard let viewport = geometry.workspaceViewport else { return nil }
                visibleFrame = frame.intersection(viewport)
            case .page, .settings, .assistant, .workspaces:
                if let viewport = geometry.pagesViewport {
                    visibleFrame = frame.intersection(viewport)
                }
            case .back: break
            }
            guard !visibleFrame.isNull, !visibleFrame.isEmpty else { return nil }
            return (item, visibleFrame)
        }.sorted { $0.1.minY < $1.1.minY }

        for (index, row) in rows.enumerated() {
            let previousFrame = index > rows.startIndex ? rows[index - 1].1 : nil
            let nextFrame = index < rows.index(before: rows.endIndex) ? rows[index + 1].1 : nil
            let minimumY = previousFrame.map { midpoint($0.maxY, row.1.minY) } ?? row.1.minY
            let maximumY = nextFrame.map { midpoint(row.1.maxY, $0.minY) } ?? row.1.maxY
            var hitFrame = CGRect(
                x: row.1.minX, y: minimumY, width: row.1.width, height: maximumY - minimumY)
            switch row.0 {
            case .workspace, .retryWorkspaces:
                if let viewport = geometry.workspaceViewport {
                    hitFrame = hitFrame.intersection(viewport)
                }
            case .page, .settings, .assistant, .workspaces:
                if let viewport = geometry.pagesViewport {
                    hitFrame = hitFrame.intersection(viewport)
                }
            case .back: break
            }
            if hitFrame.contains(location) { return row.0 }
        }
        return nil
    }

    private static func midpoint(_ first: CGFloat, _ second: CGFloat) -> CGFloat {
        first + ((second - first) / 2)
    }
}
