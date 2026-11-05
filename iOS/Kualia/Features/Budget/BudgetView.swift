import SwiftUI

struct BudgetView: View {
    @Bindable var store: BudgetStore
    let isActive: Bool
    var scrollToTopRequest = 0
    let editingCategoryID: String?
    let onEdit: (String) -> Void
    let onChangeMonth: () -> Void
    var onMoveMoney: (String) -> Void = { _ in }
    var onOpenCategory: (String) -> Void = { _ in }
    @Environment(\.budgetAssignmentFocusRegistry) private var sharedFocusRegistry
    @State private var archivedCategories: BudgetArchivedCategoriesStore?
    @State private var categoryEditor: BudgetTargetDestination?
    @State private var targetEditor: BudgetTargetDestination?
    @State private var localFocusRegistry = BudgetAssignmentFocusRegistry()

    private var focusRegistry: BudgetAssignmentFocusRegistry {
        sharedFocusRegistry ?? localFocusRegistry
    }

    var body: some View {
        content
            .homeDockFilters {
                if store.hasLoaded, !store.isSelectedMonthLocked,
                    !store.isQuickAssignPresented, store.moneyMove == nil
                {
                    BudgetCategoryFilterStrip(
                        groups: store.groups(for: store.selectedMonth),
                        selection: store.categoryFilter,
                        isEnabled: store.moneyMove == nil
                    ) { filter in
                        onChangeMonth()
                        store.categoryFilter = filter
                    }
                }
            }
            .sheet(item: $categoryEditor) { destination in
                BudgetPlanNameSheet(
                    store: store, workspaceID: destination.workspace.id,
                    editor: .init(
                        kind: .category(id: destination.category.id),
                        name: destination.category.name))
            }
            .sheet(item: $targetEditor) { destination in
                BudgetTargetView(store: store, destination: destination)
            }
            .sheet(item: $archivedCategories) { archived in
                BudgetArchivedCategoriesView(budget: store, store: archived)
            }
            .onChange(of: store.selectedMonth) { _, selected in
                store.categoryFilter = store.categoryFilter.resolved(
                    in: store.groups(for: selected))
            }
            .onChange(of: store.workspace?.id) { _, _ in
                categoryEditor = nil
                targetEditor = nil
            }
            .alert(
                L10n.string("Couldn't update target"),
                isPresented: Binding(
                    get: { store.targetSnoozeError != nil },
                    set: { if !$0 { store.targetSnoozeError = nil } }
                )
            ) {
                Button(L10n.string("OK"), role: .cancel) { store.targetSnoozeError = nil }
            } message: {
                Text(store.targetSnoozeError ?? L10n.string("Please try again."))
            }
    }

    @ViewBuilder
    private var content: some View {
        if !store.hasLoaded, let message = store.errorMessage {
            ContentUnavailableView {
                Label(L10n.string("Couldn't load your budget"), icon: .warning)
            } description: {
                Text(message)
            } actions: {
                Button(L10n.string("Try again"), action: store.retry).buttonStyle(.kualiaHaptic)
            }
        } else if !store.hasLoaded {
            ProgressView(L10n.string("Loading your budget…"))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.workspace == nil {
            ContentUnavailableView(
                L10n.string("Choose a workspace"), icon: .workspace,
                description: Text(L10n.string("Select an active workspace to see your budget."))
            )
        } else {
            ZStack {
                // Keep the native scroll view alive as month data changes.
                monthPage(store.selectedMonth)
                    .id(store.workspace?.id)
                    .opacity(store.isQuickAssignPresented ? 0 : 1)
                    .allowsHitTesting(!store.isQuickAssignPresented)
                    .accessibilityHidden(store.isQuickAssignPresented)
                if store.isQuickAssignPresented {
                    BudgetQuickAssignView(store: store)
                        .transition(.opacity)
                }
            }
        }
    }

    private func performCategoryAction(
        _ action: BudgetCategoryMenuAction, categoryID: String, month: Int
    ) {
        guard store.categoryMenuActions(categoryID: categoryID, month: month).contains(action),
            let workspace = store.workspace,
            let category = store.planGroups.flatMap(\.categories).first(where: {
                $0.id == categoryID
            })
        else { return }
        onChangeMonth()
        switch action {
        case .editCategory:
            categoryEditor = .init(workspace: workspace, category: category)
        case .editTarget, .setTarget:
            targetEditor = .init(workspace: workspace, category: category)
        case .snoozeTarget, .resumeTarget:
            let key = BudgetAssignmentKey(
                workspaceID: workspace.id, yearMonth: month, categoryID: categoryID)
            Task { await store.setTargetSnoozed(action == .snoozeTarget, key: key) }
        }
    }

    private func monthPage(_ month: Int) -> some View {
        BudgetMonthPage(
            store: store, month: month,
            isActive: isActive, scrollToTopRequest: scrollToTopRequest,
            focus: focusRegistry.focus(workspaceID: store.workspace?.id),
            editingCategoryID: month == store.selectedMonth ? editingCategoryID : nil,
            selectedFilter: $store.categoryFilter,
            isTargetSummaryExpanded: Binding(
                get: { store.isTargetSummaryExpanded },
                set: { store.setTargetSummaryExpanded($0) }),
            onEdit: onEdit, onChangeMonth: onChangeMonth, onMoveMoney: onMoveMoney,
            onOpenCategory: onOpenCategory, onCategoryAction: performCategoryAction,
            onOpenArchived: {
                onChangeMonth()
                guard let workspaceID = store.workspace?.id else { return }
                archivedCategories = BudgetArchivedCategoriesStore(
                    workspaceID: workspaceID, client: store.categoryLifecycleClient)
            })
    }
}

private struct BudgetMonthPage: View {
    let store: BudgetStore
    let month: Int
    let isActive: Bool
    var scrollToTopRequest = 0
    let focus: BudgetAssignmentFocus
    let editingCategoryID: String?
    @Binding var selectedFilter: BudgetCategoryFilter
    @Binding var isTargetSummaryExpanded: Bool
    let onEdit: (String) -> Void
    let onChangeMonth: () -> Void
    let onMoveMoney: (String) -> Void
    let onOpenCategory: (String) -> Void
    var onCategoryAction: (BudgetCategoryMenuAction, String, Int) -> Void = { _, _, _ in }
    let onOpenArchived: () -> Void
    @Environment(\.locale) private var locale

    @State private var lastUnlockedMonth: Int?

    private var unlockedMonth: Int? { store.isMonthLocked(month) ? nil : month }

    var body: some View {
        ZStack {
            // A locked-month notice must not discard or shrink the last visible budget.
            budgetList(month: unlockedMonth ?? lastUnlockedMonth ?? month)
                .environment(
                    \.budgetFundingAnimationsEnabled,
                    isActive && unlockedMonth != nil && !store.isQuickAssignPresented
                )
                .modifier(
                    HomeGlowScrollObserver(
                        isEnabled: isActive && unlockedMonth != nil
                            && !store.isQuickAssignPresented)
                )
                .environment(\.budgetAssignmentFocus, focus)
                .opacity(unlockedMonth == nil ? 0 : 1)
                .allowsHitTesting(unlockedMonth != nil)
                .accessibilityHidden(unlockedMonth == nil)
            if unlockedMonth == nil, let range = store.availableRange,
                let prerequisite = BudgetMonth.unlockingMonth(month, in: range)
            {
                ContentUnavailableView {
                    Label(L10n.string("This month is locked"), icon: .lock)
                } description: {
                    Text(
                        L10n.string(
                            "Assign money in \(BudgetMonth.title(prerequisite, locale: locale)) to unlock this month."
                        )
                    )
                } actions: {
                    Button(
                        L10n.string(
                            "Go to \(BudgetMonth.navigationTitle(prerequisite, currentMonth: store.currentMonth, locale: locale))"
                        )
                    ) {
                        onChangeMonth()
                        store.selectMonth(prerequisite)
                    }
                    .buttonStyle(.kualiaHaptic)
                }
                .accessibilityIdentifier("budget-locked-month-\(month)")
            }
        }
        .onChange(of: unlockedMonth, initial: true) { _, selected in
            if let selected { lastUnlockedMonth = selected }
        }
    }

    private func budgetList(month: Int) -> some View {
        BudgetScrollView(
            editingCategoryID: editingCategoryID,
            isActive: isActive && unlockedMonth != nil, scrollToTopRequest: scrollToTopRequest
        ) {
            BudgetMonthContent(
                store: store, month: month, isActive: isActive,
                editingCategoryID: editingCategoryID,
                selectedFilter: $selectedFilter,
                isTargetSummaryExpanded: $isTargetSummaryExpanded,
                onEdit: onEdit, onChangeMonth: onChangeMonth, onMoveMoney: onMoveMoney,
                onOpenCategory: onOpenCategory, onCategoryAction: onCategoryAction,
                onOpenArchived: onOpenArchived)
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .accessibilityIdentifier("budget-list")
    }
}

/// Page activation and the Peek viewport change independently of category data.
/// Keep those updates outside the lazy content so they don't rebuild every row.
private struct BudgetMonthContent: View {
    @Environment(\.homeControlDock) private var dock
    let store: BudgetStore
    let month: Int
    let isActive: Bool
    let editingCategoryID: String?
    @Binding var selectedFilter: BudgetCategoryFilter
    @Binding var isTargetSummaryExpanded: Bool
    let onEdit: (String) -> Void
    let onChangeMonth: () -> Void
    let onMoveMoney: (String) -> Void
    let onOpenCategory: (String) -> Void
    var onCategoryAction: (BudgetCategoryMenuAction, String, Int) -> Void = { _, _, _ in }
    @AppStorage(SettingsBudgetAppearance.showsCategoryProgressKey)
    private var showsCategoryProgress = SettingsBudgetAppearance.defaultShowsCategoryProgress
    @AppStorage(SettingsBudgetAppearance.usesCompactLayoutKey)
    private var usesCompactLayout = SettingsBudgetAppearance.defaultUsesCompactLayout
    @AppStorage(SettingsBudgetAppearance.showsCategoryStatusKey)
    private var showsCategoryStatus = SettingsBudgetAppearance.defaultShowsCategoryStatus
    let onOpenArchived: () -> Void

    private var groups: [BudgetGroupModel] { store.groups(for: month) }
    private var effectiveFilter: BudgetCategoryFilter {
        store.moneyMove != nil ? .all : selectedFilter.resolved(in: groups)
    }

    private var visibleGroups: [BudgetGroupModel] {
        effectiveFilter.applying(to: groups, keepingCategoryID: editingCategoryID)
    }

    var body: some View {
        LazyVStack(spacing: 0) {
            if let message = store.errorMessage {
                HStack(alignment: .top, spacing: 12) {
                    KualiaIconImage(icon: .wifiOff, size: 18)
                    Text(message).frame(maxWidth: .infinity, alignment: .leading)
                    Button(L10n.string("Retry"), action: store.retry).buttonStyle(.kualiaHaptic)
                }
                .font(.subheadline)
                .padding(16)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                .padding(.horizontal, 18)
                .padding(.bottom, 16)
            }

            if !groups.isEmpty {
                BudgetTargetSummaryCard(
                    summary: store.monthlyFundingSummary(for: month),
                    currencyCode: store.workspace?.currencyCode ?? "USD",
                    minorUnit: store.workspace?.minorUnit ?? 2,
                    isExpanded: $isTargetSummaryExpanded, month: month,
                    animatesDisclosure: animatesDisclosures
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 12)

                if dock == nil {
                    BudgetCategoryFilterStrip(
                        groups: groups, selection: effectiveFilter,
                        isEnabled: store.moneyMove == nil
                    ) { filter in
                        onChangeMonth()
                        selectedFilter = filter
                    }
                    .padding(.bottom, 14)
                }
            } else {
                ContentUnavailableView(
                    L10n.string("Make room for your plans"), icon: .category,
                    description: Text(
                        L10n.string(
                            "Your category groups will appear here once they're added to this workspace."
                        )
                    )
                )
            }

            BudgetCategoryFilterContent(filter: effectiveFilter) {
                LazyVStack(spacing: 0) {
                    ForEach(visibleGroups) { group in
                        BudgetCategoryGroupSection(
                            store: store, group: group, month: month,
                            showsCategoryProgress: showsCategoryProgress,
                            editingCategoryID: editingCategoryID,
                            animatesDisclosure: animatesDisclosures,
                            onEdit: onEdit, onChangeMonth: onChangeMonth, onMoveMoney: onMoveMoney,
                            onOpenCategory: onOpenCategory, onCategoryAction: onCategoryAction,
                            isCompact: usesCompactLayout, showsCategoryStatus: showsCategoryStatus
                        )
                        .padding(.horizontal, usesCompactLayout ? 0 : 12)
                        .padding(.bottom, usesCompactLayout ? 0 : 12)
                    }
                    BudgetTotalsRow(
                        totals: BudgetTotals(groups: visibleGroups),
                        currencyCode: store.workspace?.currencyCode ?? "USD",
                        minorUnit: store.workspace?.minorUnit ?? 2,
                        isCompact: usesCompactLayout
                    )
                    .padding(.horizontal, usesCompactLayout ? 0 : 12)
                    .padding(.bottom, 12)
                }
            }

            Button(action: onOpenArchived) {
                HStack(spacing: 6) {
                    Label(L10n.string("Archived categories"), icon: .archive)
                    if let count = store.archivedCategoryCount {
                        Text(count, format: .number)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(store.moneyMove != nil)
            .accessibilityIdentifier("budget-archived-categories")
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 10)
        .padding(.bottom, 24)
        .onChange(of: BudgetCategoryFilter.visible(in: groups)) { _, _ in
            normalizeFilter()
        }
        .onChange(of: editingCategoryID) { _, _ in normalizeFilter() }
        .onChange(of: store.moneyMove?.id) { _, _ in normalizeFilter() }
    }

    private var animatesDisclosures: Bool {
        BudgetDisclosureMotion.isEnabled(
            isPageActive: isActive, isSelectedMonth: month == store.selectedMonth)
    }

    private func normalizeFilter() {
        // Revisit deferred resets when editing or moving money ends, so a hidden
        // filter cannot silently reactivate when a new matching category appears.
        guard month == store.selectedMonth, editingCategoryID == nil, store.moneyMove == nil
        else { return }
        selectedFilter = selectedFilter.resolved(in: groups)
    }
}

/// Replace the filtered list as one top-aligned surface. Retaining category identities across
/// filters makes SwiftUI move surviving rows while the progress track updates in place.
struct BudgetCategoryFilterContent<Content: View>: View {
    let filter: BudgetCategoryFilter
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            content
                .id(filter)
                .transition(.opacity)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.24), value: filter)
    }
}

struct BudgetCategoryGroupSection: View {
    let store: BudgetStore
    let group: BudgetGroupModel
    let month: Int
    let showsCategoryProgress: Bool
    let editingCategoryID: String?
    let animatesDisclosure: Bool
    let onEdit: (String) -> Void
    let onChangeMonth: () -> Void
    let onMoveMoney: (String) -> Void
    let onOpenCategory: (String) -> Void
    var onCategoryAction: (BudgetCategoryMenuAction, String, Int) -> Void = { _, _, _ in }
    var isCompact = false
    var showsCategoryStatus = SettingsBudgetAppearance.defaultShowsCategoryStatus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale
    private var moneyMove: BudgetMoneyMoveSession? {
        month == store.selectedMonth ? store.moneyMove : nil
    }
    private let amountColumnWidth: CGFloat = 96

    var body: some View {
        let isCollapsed = store.collapsedGroupIDs.contains(group.id)
        return VStack(spacing: 0) {
            Button {
                store.toggleGroup(group.id)
                if !isCollapsed, group.rows.contains(where: { $0.id == editingCategoryID }) {
                    onChangeMonth()
                }
            } label: {
                BudgetCategoryGroupHeader(
                    group: group, currencyCode: store.workspace?.currencyCode ?? "USD",
                    minorUnit: store.workspace?.minorUnit ?? 2, isCollapsed: isCollapsed,
                    isCompact: isCompact, amountColumnWidth: amountColumnWidth
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .highPriorityGesture(
                LongPressGesture(minimumDuration: 0.5).onEnded { _ in toggleAllGroups() }
            )
            .accessibilityAction(
                named: Text(
                    isCollapsed
                        ? L10n.string("Expand all groups") : L10n.string("Collapse all groups")
                )
            ) {
                toggleAllGroups()
            }
            .accessibilityLabel(group.name)
            .accessibilityValue(
                moneyMove != nil
                    ? L10n.string(
                        "\(isCollapsed ? L10n.string("Collapsed") : L10n.string("Expanded")), \(money(group.available)) available"
                    )
                    : L10n.string(
                        "\(isCollapsed ? L10n.string("Collapsed") : L10n.string("Expanded")), \(money(group.assigned)) assigned, \(money(group.available)) available"
                    )
            )
            .accessibilityHint(
                isCollapsed ? L10n.string("Show categories") : L10n.string("Hide categories")
            )
            .accessibilityIdentifier("budget-group-\(group.id)")

            BudgetGroupDisclosure(isExpanded: !isCollapsed) {
                // Compact sections own their top edge; disclosure owns the header/category edge.
                if isCompact { BudgetRowDivider() }
                if group.rows.isEmpty {
                    Text(L10n.string("No categories in this group yet"))
                        .font(.subheadline)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 14)
                }
                ForEach(group.rows) { row in
                    BudgetCategoryRow(
                        row: row, currencyCode: store.workspace?.currencyCode ?? "USD",
                        minorUnit: store.workspace?.minorUnit ?? 2,
                        isEditing: editingCategoryID == row.id,
                        calculator: editingCategoryID == row.id ? store.assignmentCalculator : nil,
                        canEdit: store.canEdit && store.moneyMove == nil,
                        amountColumnWidth: amountColumnWidth,
                        onEdit: { onEdit(row.id) },
                        onOpenDetails: { onOpenCategory(row.id) },
                        canMoveMoney: store.canMoveMoney,
                        onMoveMoney: { onMoveMoney(row.id) },
                        isMovingMoney: store.moneyMove?.anchor == .category(row.id)
                            && month == store.selectedMonth,
                        isInMoneyMoveMode: moneyMove != nil,
                        isSelectedForMove: moneyMove?.counterpart == .category(row.id),
                        canSelectForMove: store.canChooseMoneyMoveAccount(.category(row.id)),
                        onSelectForMove: {
                            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                                store.chooseMoneyMoveAccount(.category(row.id))
                            }
                        },
                        showsProgress: showsCategoryProgress,
                        target: store.targets.targets[row.id], month: month, isCompact: isCompact,
                        showsStatus: showsCategoryStatus
                    )
                    .id(row.id)
                    .contextMenu {
                        ForEach(store.categoryMenuActions(categoryID: row.id, month: month)) {
                            action in
                            Button(action.title, icon: menuIcon(action)) {
                                onCategoryAction(action, row.id, month)
                            }
                            .accessibilityIdentifier("budget-category-menu-\(action.id)-\(row.id)")
                        }
                    }
                    if row.id != group.rows.last?.id {
                        BudgetRowDivider(isCompact: isCompact)
                    }
                }
            }
        }
        .modifier(BudgetGroupSurface(isCompact: isCompact))
        .animation(disclosureAnimation, value: isCollapsed)
        // During a month change, actions still belong only to the selected month.
        .allowsHitTesting(month == store.selectedMonth)
        .accessibilityHidden(month != store.selectedMonth)

    }

    private func menuIcon(_ action: BudgetCategoryMenuAction) -> KualiaIcon {
        switch action {
        case .snoozeTarget: .moon
        case .resumeTarget: .sun
        case .editCategory: .pencil
        case .editTarget, .setTarget: .target
        }
    }

    private func toggleAllGroups() {
        if !store.collapsedGroupIDs.contains(group.id), editingCategoryID != nil { onChangeMonth() }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        store.toggleAllGroups(relativeTo: group.id)
    }

    private var disclosureAnimation: Animation? {
        reduceMotion || !animatesDisclosure ? nil : .smooth(duration: 0.24)
    }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: store.workspace?.currencyCode ?? "USD",
            minorUnit: store.workspace?.minorUnit ?? 2, showsPositiveSign: false,
            usesAbsoluteValue: false, locale: locale
        )
    }
}

struct BudgetCategoryGroupHeader: View {
    let group: BudgetGroupModel
    let currencyCode: String
    let minorUnit: Int
    let isCollapsed: Bool
    let isCompact: Bool
    var amountColumnWidth: CGFloat = 96
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale

    var body: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: isCompact ? 0 : 8))
        return layout {
            groupTitle(group, isCollapsed: isCollapsed)
                .padding(.horizontal, isCompact ? 14 : 0)
            groupAmounts(group)
        }
        .padding(.horizontal, isCompact ? 0 : 14)
        .padding(.vertical, isCompact ? 7 : 9)
        .frame(minHeight: 44)
        .background(KualiaPalette.border.opacity(isCompact ? 0.24 : 0.12))
        .overlay(alignment: .top) {
            if isCompact { BudgetRowDivider() }
        }
    }

    private func groupTitle(_ group: BudgetGroupModel, isCollapsed: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            KualiaIconImage(icon: .chevronRight, size: 12)
                .font(.caption.weight(.bold))
                .rotationEffect(.degrees(isCollapsed ? 0 : 90))
                .frame(width: 10)
            Text(group.name)
                .font(.subheadline.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func groupAmounts(_ group: BudgetGroupModel) -> some View {
        HStack(spacing: isCompact ? 0 : 8) {
            groupAmount(L10n.string("Assigned"), amount: group.assigned)
            groupAmount(L10n.string("Available"), amount: group.available)
        }
    }

    private func groupAmount(_ title: String, amount: Decimal) -> some View {
        VStack(alignment: .trailing, spacing: 3) {
            Text(title)
                .font(.caption2.weight(.semibold))
            Text(money(amount))
                .font(.subheadline.weight(.medium).monospacedDigit())
                .contentTransition(
                    reduceMotion
                        ? .identity
                        : .numericText(value: NSDecimalNumber(decimal: amount).doubleValue)
                )
                .animation(reduceMotion ? nil : .smooth(duration: 0.24), value: amount)
        }
        .foregroundStyle(KualiaPalette.mutedInk)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, isCompact ? 8 : 0)
        .frame(
            width: dynamicTypeSize.isAccessibilitySize ? nil : amountColumnWidth,
            alignment: .trailing
        )
        .frame(
            maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil,
            alignment: .trailing)
    }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: currencyCode, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
    }
}

struct BudgetGroupSurface: ViewModifier {
    let isCompact: Bool

    func body(content: Content) -> some View {
        content
            .background(KualiaPalette.surface)
            .clipShape(RoundedRectangle(cornerRadius: isCompact ? 0 : 20, style: .continuous))
            .overlay {
                if !isCompact {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(KualiaPalette.border.opacity(0.4), lineWidth: 0.5)
                        .allowsHitTesting(false)
                }
            }
    }
}

enum BudgetDisclosureMotion {
    static func isEnabled(isPageActive: Bool, isSelectedMonth: Bool) -> Bool {
        isPageActive && isSelectedMonth
    }
}

/// Keep disclosure content mounted while the layout gives its space back to the lazy stack.
/// This avoids rebuilding a card's full subtree at the start and end of every animation.
struct BudgetDisclosure<Content: View>: View {
    let isExpanded: Bool
    @ViewBuilder let content: Content

    var body: some View {
        BudgetDisclosureLayout(expansion: isExpanded ? 1 : 0) {
            VStack(spacing: 0) { content }
        }
        .clipped()
        .allowsHitTesting(isExpanded)
        .accessibilityHidden(!isExpanded)
    }
}

/// Category disclosures additionally remove hidden assignment anchors from the scroll cache.
struct BudgetGroupDisclosure<Content: View>: View {
    let isExpanded: Bool
    @ViewBuilder let content: Content

    var body: some View {
        BudgetDisclosure(isExpanded: isExpanded) { content }
            .transformPreference(BudgetAssignmentFrames.self) { frames in
                if !isExpanded { frames.removeAll() }
            }
    }
}

/// Measure at the natural height, then reveal from the top. Cache that natural size so an
/// animation changes only the reported height instead of remeasuring every row every frame.
struct BudgetDisclosureLayout: Layout {
    var expansion: CGFloat

    struct Cache {
        var proposalWidth: CGFloat?
        var naturalSize: CGSize?
    }

    var animatableData: CGFloat {
        get { expansion }
        set { expansion = newValue }
    }

    func makeCache(subviews: Subviews) -> Cache { Cache() }

    func updateCache(_ cache: inout Cache, subviews: Subviews) {
        cache = Cache()
    }

    func sizeThatFits(
        proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache
    ) -> CGSize {
        let size = naturalSize(proposal: proposal, subviews: subviews, cache: &cache)
        return CGSize(width: size.width, height: size.height * min(1, max(0, expansion)))
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache
    ) {
        guard let content = subviews.first else { return }
        let size = naturalSize(
            proposal: ProposedViewSize(width: bounds.width, height: nil), subviews: subviews,
            cache: &cache)
        content.place(
            at: bounds.origin, anchor: .topLeading,
            proposal: ProposedViewSize(width: bounds.width, height: size.height))
    }

    private func naturalSize(
        proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache
    ) -> CGSize {
        guard let content = subviews.first else { return .zero }
        if cache.proposalWidth == proposal.width, let size = cache.naturalSize { return size }
        let size = content.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
        cache.proposalWidth = proposal.width
        cache.naturalSize = size
        return size
    }
}

/// The onboarding preview uses the budget's category rows before there are amounts to show.
struct BudgetCategoryGroupPreview: View {
    let group: BudgetGroupModel
    let currencyCode: String
    let minorUnit: Int
    @State private var isCollapsed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var rows: [BudgetCategoryRowModel] { group.rows.filter { !$0.isCreditCard } }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
                    isCollapsed.toggle()
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    KualiaIconImage(icon: .chevronRight, size: 12)
                        .rotationEffect(.degrees(isCollapsed ? 0 : 90))
                        .frame(width: 10)
                    Text(group.name).font(.subheadline.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .frame(minHeight: 48)
                .background(KualiaPalette.border.opacity(0.12))
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityLabel(group.name)
            .accessibilityValue(isCollapsed ? L10n.string("Collapsed") : L10n.string("Expanded"))
            .accessibilityHint(
                isCollapsed ? L10n.string("Show categories") : L10n.string("Hide categories"))
            if !isCollapsed {
                ForEach(rows) { row in
                    BudgetCategoryRow(
                        row: row, currencyCode: currencyCode, minorUnit: minorUnit,
                        isEditing: false, calculator: nil, canEdit: false,
                        amountColumnWidth: 0, onEdit: {}, showsAmounts: false)
                    if row.id != rows.last?.id {
                        Rectangle().fill(KualiaPalette.border.opacity(0.45))
                            .frame(height: 0.5).padding(.horizontal, 14)
                    }
                }
            }
        }
        .background(KualiaPalette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(KualiaPalette.border.opacity(0.4), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }
}

struct BudgetRowDivider: View {
    var isCompact = true

    var body: some View {
        Rectangle()
            .fill(KualiaPalette.border.opacity(isCompact ? 1 : 0.45))
            .frame(height: isCompact ? 1 : 0.5)
            .padding(.horizontal, isCompact ? 0 : 14)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

struct BudgetCategoryRow: View {
    let row: BudgetCategoryRowModel
    let currencyCode: String
    let minorUnit: Int
    let isEditing: Bool
    let calculator: AmountCalculator?
    let canEdit: Bool
    let amountColumnWidth: CGFloat
    let onEdit: () -> Void
    var onOpenDetails: (() -> Void)?
    var canMoveMoney = false
    var onMoveMoney: () -> Void = {}
    var isMovingMoney = false
    var isInMoneyMoveMode = false
    var isSelectedForMove = false
    var canSelectForMove = false
    var onSelectForMove: () -> Void = {}
    var showsProgress = false
    var showsAmounts = true
    var emphasizesAssignment = false
    var showsAssignmentEditIcon = false
    var target: BudgetTarget?
    var month = BudgetMonth.current()
    var isCompact = false
    var showsStatus = SettingsBudgetAppearance.defaultShowsCategoryStatus
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var categoryNameSize = 15
    @ScaledMetric(relativeTo: .subheadline) private var amountCellHeight = 44
    @ScaledMetric(relativeTo: .subheadline) private var assignmentButtonHeight = 38
    @ScaledMetric(relativeTo: .caption) private var snoozeIconSize = 10

    var body: some View {
        VStack(spacing: 0) {
            if !showsAmounts {
                categoryLabel
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 14)
            } else if isInMoneyMoveMode {
                movementRow
            } else {
                amountRow
            }
            if showsAmounts, showsProgress {
                VStack(alignment: .leading, spacing: 5) {
                    if showsProgress {
                        BudgetCategoryProgressBar(
                            progress: row.progress, categoryName: row.name, isCompact: isCompact
                        )
                        .accessibilityIdentifier("budget-category-progress-\(row.id)")
                    }
                    if !isCompact, showsStatus { fundingCaption }
                }
                .padding(.horizontal, isCompact ? 0 : 14)
                .padding(.bottom, isCompact ? 0 : 10)
                .allowsHitTesting(false)
            }
        }
        .background {
            if showsAmounts, !isInMoneyMoveMode, let onOpenDetails {
                // A sibling behind the content fills the row's whitespace without
                // nesting buttons or competing with Assign/Available gestures.
                Button(action: onOpenDetails) {
                    Color.clear.contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityLabel(L10n.string("Details for \(row.name)"))
                .accessibilityHint(L10n.string("View spending and transactions"))
                .accessibilityIdentifier("budget-category-details-\(row.id)")
            }
        }
        .background(
            isMoneyMoveHighlighted
                ? KualiaPalette.budgetPositive.opacity(0.2)
                : isEditing ? KualiaPalette.budgetSelection : Color.clear
        )
        .overlay(alignment: .leading) {
            if isMoneyMoveHighlighted {
                RoundedRectangle(cornerRadius: 2)
                    .fill(KualiaPalette.budgetPositive)
                    .frame(width: 3)
                    .padding(.vertical, 8)
                    .allowsHitTesting(false)
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var amountRow: some View {
        if isCompact { compactAmountRow } else { regularAmountRow }
    }

    @ViewBuilder
    private var compactAmountRow: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) {
                categoryContent
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                HStack(alignment: .top, spacing: 0) {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(L10n.string("Assigned")).font(.caption).foregroundStyle(
                            KualiaPalette.mutedInk
                        )
                        .padding(.horizontal, 8)
                        assignmentValue
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(L10n.string("Available")).font(.caption).foregroundStyle(
                            KualiaPalette.mutedInk
                        )
                        .padding(.horizontal, 8)
                        availableAmount
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        } else {
            HStack(spacing: 0) {
                categoryContent
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                assignmentValue
                availableAmount
            }
        }
    }

    @ViewBuilder
    private var regularAmountRow: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                categoryContent
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(L10n.string("Assigned")).font(.caption).foregroundStyle(
                            KualiaPalette.mutedInk)
                        assignmentValue
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(L10n.string("Available")).font(.caption).foregroundStyle(
                            KualiaPalette.mutedInk)
                        availableAmount.frame(minHeight: 44)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
        } else {
            HStack(spacing: 8) {
                categoryContent.frame(maxWidth: .infinity, alignment: .leading)
                assignmentValue.fixedSize(horizontal: true, vertical: false)
                availableAmount.frame(width: amountColumnWidth, alignment: .trailing)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 14)
        }
    }

    private var amountColumnDivider: some View {
        Rectangle().fill(KualiaPalette.border)
            .frame(width: 1)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var isMoneyMoveHighlighted: Bool {
        isInMoneyMoveMode && (isMovingMoney || isSelectedForMove)
    }

    private var movementContent: some View {
        amountRow
            .allowsHitTesting(false)
            .foregroundStyle(KualiaPalette.ink)
            .contentShape(Rectangle())
            .opacity(canSelectForMove || isMoneyMoveHighlighted ? 1 : 0.4)
    }

    private var movementRow: some View {
        Group {
            if canSelectForMove {
                Button(action: onSelectForMove) {
                    movementContent
                }
                .buttonStyle(.kualiaHaptic)
            } else {
                // Fixed/selected rows stay fully legible without disabled-button dimming.
                movementContent
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.string("\(row.name), \(money(row.available)) available"))
        .accessibilityValue(
            isMovingMoney
                ? L10n.string("Fixed category") : isSelectedForMove ? L10n.string("Selected") : ""
        )
        .accessibilityHint(
            isMovingMoney
                ? L10n.string("This category is fixed for this move")
                : canSelectForMove
                    ? L10n.string("Select this category for the money move")
                    : L10n.string("Unavailable for this move")
        )
        .accessibilityAddTraits(isMoneyMoveHighlighted ? .isSelected : [])
        .accessibilityIdentifier("budget-move-choice-\(row.id)")
    }

    private var categoryContent: some View {
        VStack(alignment: .leading, spacing: 2) {
            categoryLabel
            if showsStatus, isCompact || !showsProgress { fundingCaption }
        }
        .allowsHitTesting(false)
    }

    private var fundingStatus: BudgetCategoryFunding.Status? {
        row.funding.status(target: target, month: month)
    }

    @ViewBuilder
    private var fundingCaption: some View {
        if let status = fundingStatus {
            Text(
                status.title(currencyCode: currencyCode, minorUnit: minorUnit, locale: locale)
            )
            .font(.caption2)
            .foregroundStyle(KualiaPalette.mutedInk)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .truncationMode(.tail)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("budget-category-funding-status-\(row.id)")
        }
    }

    private var categoryLabel: some View {
        HStack(spacing: 6) {
            if row.isCreditCard {
                KualiaIconImage(icon: .creditCard, size: 18).accessibilityHidden(true)
            }
            Text(row.name)
                .lineLimit(showsAmounts ? 1 : nil)
                .truncationMode(.tail)
        }
        .font(.system(size: categoryNameSize, weight: isMoneyMoveHighlighted ? .semibold : .medium))
        .allowsHitTesting(false)
        .accessibilityHidden(onOpenDetails != nil && !isInMoneyMoveMode)
    }

    @ViewBuilder
    private var assignmentValue: some View {
        if isInMoneyMoveMode {
            assignmentContent
        } else {
            assignmentButton
        }
    }

    @ViewBuilder
    private var availableAmount: some View {
        if isInMoneyMoveMode {
            availableBadge
        } else {
            availableValue
        }
    }

    private var assignmentContent: some View {
        VStack(alignment: .trailing, spacing: 2) {
            HStack(spacing: 5) {
                Text(
                    calculator != nil && calculator?.hasOperations == false
                        && calculator?.previewAmount == nil
                        ? "—" : money(Decimal(row.assigned))
                )
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                if showsAssignmentEditIcon {
                    KualiaIconImage(icon: .newEntry, size: 14)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .accessibilityHidden(true)
                }
            }
            if let calculator {
                AmountCalculationCaption(
                    calculator: calculator, accessibilityIdentifierPrefix: "budget",
                    compactCurrencyCode: currencyCode
                )
            }
        }
        .padding(.horizontal, 8)
        .frame(
            width: isCompact && !dynamicTypeSize.isAccessibilitySize ? amountColumnWidth : nil,
            alignment: .trailing
        )
        .frame(
            maxWidth: isCompact && dynamicTypeSize.isAccessibilitySize ? .infinity : nil,
            alignment: .trailing
        )
        .frame(minWidth: isCompact ? nil : 52)
        .frame(height: isCompact ? max(44, amountCellHeight) : assignmentButtonHeight)
        .foregroundStyle(KualiaPalette.ink)
        .background {
            if isCompact || !isInMoneyMoveMode {
                RoundedRectangle(cornerRadius: isCompact ? 0 : 8)
                    .fill(
                        isEditing
                            ? (isCompact ? KualiaPalette.budgetSelection : KualiaPalette.surface)
                            : KualiaPalette.border.opacity(0.2))
            }
        }
        .overlay(alignment: .leading) {
            if isCompact { amountColumnDivider }
        }
        .overlay {
            RoundedRectangle(cornerRadius: isCompact ? 0 : 8)
                .strokeBorder(
                    isEditing ? KualiaPalette.ink.opacity(0.45) : Color.clear, lineWidth: 1
                )
                .allowsHitTesting(false)
        }
        .overlay {
            if emphasizesAssignment {
                assignmentPrompt
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .overlay {
            if row.isPending {
                savingIndicator
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var assignmentButton: some View {
        Button(action: onEdit) {
            assignmentContent
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(!canEdit || row.isPending)
        .background {
            BudgetAssignmentAnchor(categoryID: row.id)
        }
        .accessibilityLabel(L10n.string("Assigned to \(row.name)"))
        .accessibilityValue(money(Decimal(row.assigned)))
        .accessibilityHint(
            row.isPending
                ? L10n.string("Saving assignment")
                : emphasizesAssignment
                    ? L10n.string("Tap to assign money to this category")
                    : L10n.string("Edit with calculator")
        )
        .accessibilityIdentifier("budget-assigned-\(row.id)")
    }

    private var assignmentPrompt: some View {
        let outline = RoundedRectangle(cornerRadius: isCompact ? 0 : 8)
            .strokeBorder(KualiaPalette.budgetPositive, lineWidth: 2)
        return Group {
            if reduceMotion {
                outline
            } else {
                outline.phaseAnimator([false, true]) { content, isBright in
                    content.opacity(isBright ? 1 : 0.3)
                } animation: { _ in
                    .easeInOut(duration: 0.9)
                }
            }
        }
    }

    private var savingIndicator: some View {
        let outline = RoundedRectangle(cornerRadius: isCompact ? 0 : 8)
            .strokeBorder(KualiaPalette.ink, lineWidth: 1)
        return Group {
            if reduceMotion {
                outline.opacity(0.45)
            } else {
                outline.phaseAnimator([false, true]) { content, isBright in
                    content.opacity(isBright ? 0.65 : 0.18)
                } animation: { _ in
                    .easeInOut(duration: 0.8)
                }
            }
        }
    }

    private var availableValue: some View {
        Button(action: onMoveMoney) {
            availableBadge
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(!canMoveMoney)
        .accessibilityLabel(L10n.string("Available in \(row.name)"))
        .accessibilityValue(availableAccessibilityValue)
        .accessibilityHint(
            row.available < 0
                ? L10n.string("Cover overspending from other categories")
                : L10n.string("Move money between categories")
        )
        .accessibilityIdentifier("budget-available-\(row.id)")
    }

    private var availableBadge: some View {
        Text(money(row.available))
            .font(.subheadline.weight(.semibold).monospacedDigit())
            .foregroundStyle(KualiaPalette.ink)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .smooth(duration: 0.24), value: row.available)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .padding(.horizontal, 8)
            .padding(.vertical, isCompact ? 0 : 6)
            .frame(
                width: isCompact && !dynamicTypeSize.isAccessibilitySize ? amountColumnWidth : nil,
                alignment: .trailing
            )
            .frame(
                maxWidth: isCompact && dynamicTypeSize.isAccessibilitySize ? .infinity : nil,
                alignment: .trailing
            )
            .frame(height: isCompact ? max(44, amountCellHeight) : nil)
            .background(
                row.availabilityStatus == .empty
                    ? KualiaPalette.border.opacity(0.28) : availableColor.opacity(0.15),
                in: RoundedRectangle(cornerRadius: isCompact ? 0 : 100)
            )
            .overlay(alignment: .leading) {
                if isCompact { amountColumnDivider }
            }
            .overlay(alignment: .bottomTrailing) {
                if row.isTargetSnoozed {
                    KualiaIconImage(icon: .moon, size: min(snoozeIconSize, 14))
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .padding(isCompact ? 4 : 3)
                        .background(isCompact ? Color.clear : KualiaPalette.surface, in: Circle())
                        .overlay {
                            if !isCompact {
                                Circle().strokeBorder(KualiaPalette.border, lineWidth: 1)
                            }
                        }
                        .offset(
                            x: isCompact ? 0 : min(snoozeIconSize, 14) / 2 + 3,
                            y: isCompact ? 0 : min(snoozeIconSize, 14) / 2 + 3
                        )
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                        .accessibilityIdentifier("budget-category-snoozed-\(row.id)")
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }

    var availableAccessibilityValue: String {
        var parts = [money(row.available), row.availabilityStatus.accessibilityDescription]
        if row.isTargetSnoozed { parts.append(L10n.string("Target snoozed")) }
        return parts.joined(separator: ", ")
    }

    private var availableColor: Color {
        switch row.availabilityStatus {
        case .available: KualiaPalette.budgetPositive
        case .underfunded: KualiaPalette.budgetUnderfunded
        case .overspent: KualiaPalette.budgetNegative
        case .empty: KualiaPalette.mutedInk
        }
    }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: currencyCode, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale
        )
    }
}

struct BudgetCategoryProgressBar: View {
    let progress: BudgetCategoryProgress
    let categoryName: String
    var isCompact = false
    @State private var hasAppeared = false
    @Environment(\.locale) private var locale
    @Environment(\.budgetFundingAnimationsEnabled) private var animationsEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            let filled = progress.filled
            let filledWidth =
                filled > 0
                ? min(geometry.size.width, max(4, geometry.size.width * filled)) : 0
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: isCompact ? 0 : 3)
                    .fill(KualiaPalette.border.opacity(0.55))
                HStack(spacing: 0) {
                    color.opacity(0.28)
                        .overlay {
                            BudgetCategorySpentStripes()
                                .stroke(color.opacity(0.45), lineWidth: 1)
                        }
                        .frame(width: filledWidth * progress.spentOfFilled)
                        .clipped()
                    color
                }
                .frame(width: filledWidth)
                .clipShape(RoundedRectangle(cornerRadius: isCompact ? 0 : 3))
            }
            .modifier(
                BudgetFundingAnimation(
                    progress: progress,
                    isEnabled: hasAppeared && animationsEnabled && !reduceMotion))
        }
        .frame(height: 6)
        .transaction { $0.animation = nil }
        .onAppear { hasAppeared = true }
        .onDisappear { hasAppeared = false }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.string("Progress for \(categoryName)"))
        .accessibilityValue(accessibilityValue)
    }

    var accessibilityValue: String {
        if progress.state == .overspent {
            return L10n.string(
                "Overspent, \(percent(progress.spent)) of spending covered, \(percent(progress.overspent)) uncovered"
            )
        }
        return L10n.string(
            "\(progress.state.title), \(percent(progress.spent)) spent, \(percent(progress.available)) available, \(percent(progress.unfunded)) unfunded"
        )
    }

    private var color: Color {
        switch progress.state {
        case .overspent: KualiaPalette.budgetNegative
        case .underfunded: KualiaPalette.budgetFundingProgress
        case .fullyFunded, .noTarget: KualiaPalette.budgetAvailableProgress
        }
    }

    private func percent(_ value: Double) -> String {
        value.formatted(.percent.precision(.fractionLength(0)).locale(locale))
    }
}

private struct BudgetCategorySpentStripes: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            for x in stride(from: -rect.height, through: rect.width, by: 4) {
                path.move(to: CGPoint(x: x, y: rect.maxY))
                path.addLine(to: CGPoint(x: x + rect.height, y: rect.minY))
            }
        }
    }
}

/// Persistent budget status below the page; the same title and amount survive quick assign.
struct BudgetReadyToAssignPeek: View {
    let readyToAssign: Decimal
    let currencyCode: String
    let minorUnit: Int
    var isAmountPadPresented = false
    var showsCompletion = false
    var usesFullContrast = false
    var onQuickAssign: (() -> Void)?
    var onUndo: (() -> Void)?
    var canUndo = true
    var isUndoing = false
    var quickAssign: BudgetQuickAssignSession?
    var showsQuickAssignCompletion = false
    var onApplyQuickAssign: (() -> Void)?
    var canApplyQuickAssign = false
    var onMoveMoney: (() -> Void)?
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title2) private var amountLineHeight: CGFloat = 28

    var body: some View {
        status
            .fixedSize(horizontal: false, vertical: true)
            .fontDesign(.rounded)
            .foregroundStyle(KualiaPalette.peekInk)
            .animation(previewAnimation, value: quickAssign?.id)
            .animation(previewAnimation, value: primaryAmount)
            .animation(previewAnimation, value: quickAssign?.plan.readyToAssignAfter)
            .animation(previewAnimation, value: quickAssign?.isChoosingOption)
            .animation(.easeInOut(duration: 0.18), value: usesMutedZeroStyle)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("budget-ready-to-assign")
            .sensoryFeedback(.success, trigger: hasFinished) { _, finished in finished }
    }

    private var status: some View {
        VStack(alignment: .leading, spacing: 10) {
            let layout =
                dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                : AnyLayout(HStackLayout(spacing: 12))
            layout {
                ZStack(alignment: .leading) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L10n.string("Ready to Assign"))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(labelInk)
                        Group {
                            if let onMoveMoney {
                                Button(action: onMoveMoney) { amountLabel }
                                    .buttonStyle(.kualiaHaptic)
                                    .disabled(quickAssign != nil || isAmountPadPresented)
                                    .accessibilityHint(
                                        readyToAssign < 0
                                            ? L10n.string("Choose categories to fix overassignment")
                                            : L10n.string("Move money to a category")
                                    )
                            } else {
                                amountLabel
                            }
                        }
                        .accessibilityLabel(L10n.string("Ready to Assign, \(money(primaryAmount))"))
                        .accessibilityIdentifier("budget-peek-primary-amount")
                        .font(.title2.weight(.bold).monospacedDigit())
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                        .frame(height: amountLineHeight)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(isAllAssigned ? 0 : 1)
                    .offset(y: reduceMotion ? 0 : isAllAssigned ? -5 : 0)
                    .blur(radius: !reduceMotion && isAllAssigned ? 3 : 0)
                    .accessibilityHidden(isAllAssigned)

                    Label(L10n.string("All assigned. Nice work!"), icon: .checkCircle)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .opacity(isAllAssigned ? 1 : 0)
                        .offset(y: reduceMotion ? 0 : isAllAssigned ? 0 : 7)
                        .blur(radius: !reduceMotion && !isAllAssigned ? 3 : 0)
                        .accessibilityHidden(!isAllAssigned)
                        .accessibilityIdentifier("budget-assignment-complete")
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if let quickAssign, quickAssign.phase != .finished,
                    let onApplyQuickAssign
                {
                    Button(action: onApplyQuickAssign) {
                        HStack(spacing: 6) {
                            if quickAssign.isBusy {
                                ProgressView().tint(KualiaPalette.peekBackground)
                                    .controlSize(.small)
                            }
                            Text(quickAssign.isBusy ? L10n.string("Saving") : L10n.string("Apply"))
                                .font(.subheadline.weight(.bold))
                        }
                        .fixedSize(horizontal: true, vertical: false)
                        .padding(.horizontal, 22)
                        .frame(minHeight: 48)
                        .foregroundStyle(KualiaPalette.peekBackground)
                        .background(KualiaPalette.peekInk, in: Capsule())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(!canApplyQuickAssign)
                    .opacity(canApplyQuickAssign || quickAssign.isBusy ? 1 : 0.4)
                    .accessibilityLabel(
                        quickAssign.isBusy
                            ? L10n.string("Saving assignments") : L10n.string("Apply")
                    )
                    .accessibilityIdentifier("budget-quick-apply")
                }

                if quickAssign == nil, let action = onUndo ?? onQuickAssign {
                    Button(action: action) {
                        ZStack {
                            HStack(spacing: 6) {
                                if isUndoing {
                                    ProgressView().tint(actionInk)
                                        .frame(width: 20, height: 20)
                                } else {
                                    KualiaIconImage(icon: onUndo == nil ? .bolt : .undo, size: 20)
                                }
                                Text(
                                    isUndoing
                                        ? L10n.string("Undoing…")
                                        : onUndo == nil
                                            ? L10n.string("Quick assign") : L10n.string("Undo")
                                )
                                .font(.subheadline.weight(.semibold))
                                .contentTransition(.opacity)
                            }
                            .foregroundStyle(actionInk)
                            .id(onUndo != nil)
                            .transition(
                                reduceMotion
                                    ? .opacity
                                    : .asymmetric(
                                        insertion: .opacity.combined(with: .move(edge: .top)),
                                        removal: .opacity.combined(with: .move(edge: .bottom))))
                        }
                        .fixedSize(horizontal: true, vertical: false)
                        .padding(.horizontal, 10)
                        .frame(minHeight: 48)
                        .clipped()
                        .background(actionSurface, in: Capsule())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(onUndo != nil && !canUndo)
                    .opacity(onUndo == nil || canUndo || isUndoing ? 1 : 0.45)
                    .opacity(isActionVisible ? 1 : 0)
                    .offset(y: reduceMotion ? 0 : isActionVisible ? 0 : 7)
                    .blur(radius: !reduceMotion && !isActionVisible ? 3 : 0)
                    .allowsHitTesting(isActionVisible)
                    .accessibilityHidden(!isActionVisible)
                    .accessibilityLabel(
                        onUndo == nil
                            ? L10n.string("Quick assign") : L10n.string("Undo Quick Assign")
                    )
                    .accessibilityHint(
                        onUndo == nil
                            ? L10n.string("Preview ways to assign your available money")
                            : L10n.string("Restore the assignments from before Quick Assign")
                    )
                    .accessibilityIdentifier(
                        onUndo == nil ? "budget-start-quick-assign" : "budget-undo-quick-assign"
                    )
                    .transition(.opacity.animation(.easeOut(duration: 0.14)))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var showsAssignmentPreview: Bool {
        quickAssign != nil
    }
    var isActionVisible: Bool {
        guard quickAssign == nil else { return false }
        return onUndo == nil || readyToAssign != 0 || showsCompletion || isUndoing
    }
    private var hasFinished: Bool {
        quickAssign == nil ? showsCompletion : showsQuickAssignCompletion
    }
    private var isAllAssigned: Bool {
        quickAssign == nil
            ? showsCompletion
            : quickAssign?.phase == .finished && showsQuickAssignCompletion && readyToAssign == 0
    }
    var primaryAmount: Decimal {
        guard let quickAssign else { return readyToAssign }
        return quickAssign.isChoosingOption
            ? quickAssign.plan.readyToAssignBefore : quickAssign.plan.readyToAssignAfter
    }

    private var amountLabel: some View {
        Text(money(primaryAmount))
            .contentTransition(
                reduceMotion
                    ? .opacity
                    : .numericText(value: NSDecimalNumber(decimal: primaryAmount).doubleValue)
            )
            .foregroundStyle(actionInk)
    }

    var labelInk: Color {
        if usesFullContrast { return KualiaPalette.peekInk }
        return usesMutedZeroStyle
            ? KualiaPalette.peekMutedInk.opacity(0.62) : KualiaPalette.peekMutedInk
    }

    var usesMutedZeroStyle: Bool {
        !usesFullContrast && readyToAssign == 0 && !isAmountPadPresented && quickAssign == nil
            && !showsCompletion && onUndo == nil && !isUndoing
    }

    private var actionInk: Color {
        usesMutedZeroStyle ? KualiaPalette.peekInk.opacity(0.62) : KualiaPalette.peekInk
    }

    private var actionSurface: Color {
        usesMutedZeroStyle
            ? KualiaPalette.peekControlSurface.opacity(0.5)
            : KualiaPalette.peekControlSurface
    }

    private var previewAnimation: Animation {
        reduceMotion ? .easeInOut(duration: 0.18) : .smooth(duration: 0.3)
    }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: currencyCode, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
    }
}

/// A compact calendar sheet shared by the budget and Quick Assign headers.
struct BudgetMonthPicker: View {
    let store: BudgetStore
    let onSelect: (Int) -> Void

    var body: some View {
        MonthPicker(
            selectedMonth: store.selectedMonth, currentMonth: store.currentMonth,
            availableRange: store.availableRange, canChangeMonth: store.canChangeMonth,
            workspaceID: store.workspace?.id, onSelect: onSelect)
    }
}

struct MonthPicker: View {
    let selectedMonth: Int
    let currentMonth: Int
    let availableRange: BudgetMonthRange?
    let canChangeMonth: Bool
    let workspaceID: String?
    var identifier = "budget-month-picker"
    let onSelect: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var year: Int

    init(
        selectedMonth: Int, currentMonth: Int, availableRange: BudgetMonthRange?,
        canChangeMonth: Bool = true, workspaceID: String?,
        identifier: String = "budget-month-picker", onSelect: @escaping (Int) -> Void
    ) {
        self.selectedMonth = selectedMonth
        self.currentMonth = currentMonth
        self.availableRange = availableRange
        self.canChangeMonth = canChangeMonth
        self.workspaceID = workspaceID
        self.identifier = identifier
        self.onSelect = onSelect
        _year = State(initialValue: selectedMonth / 100)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L10n.string("Your monthly plan"))
                            .font(.title2.weight(.bold))
                        Text(L10n.string("A little space to look ahead."))
                            .font(.subheadline)
                            .foregroundStyle(KualiaPalette.mutedInk)
                    }
                    Spacer(minLength: 8)
                    KualiaCloseButton(label: L10n.string("Close month picker")) { dismiss() }
                }

                HStack {
                    Text(String(year))
                        .font(.title.weight(.bold).monospacedDigit())
                        .contentTransition(.numericText())
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    yearButton(-1, symbol: .chevronLeft, label: L10n.string("Previous year"))
                    yearButton(1, symbol: .chevronRight, label: L10n.string("Next year"))
                }

                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.flexible(), spacing: 8),
                        count: dynamicTypeSize.isAccessibilitySize ? 2 : 3), spacing: 8
                ) {
                    ForEach(1...12, id: \.self) { month in
                        monthButton(year * 100 + month)
                    }
                }

            }
            .padding(24)
            .padding(.top, 12)
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(32)
        .presentationBackground(KualiaPalette.budgetPage)
        .accessibilityIdentifier(identifier)
        .onChange(of: workspaceID) { _, _ in dismiss() }
    }

    private func isEnabled(_ month: Int) -> Bool {
        guard canChangeMonth, let range = availableRange else { return false }
        return month >= range.minYearMonth && month <= range.maxYearMonth
    }

    private func yearButton(_ direction: Int, symbol: KualiaIcon, label: String) -> some View {
        let nextYear = year + direction
        let range = availableRange
        let enabled =
            range.map {
                nextYear * 100 + 1 <= $0.maxYearMonth && nextYear * 100 + 12 >= $0.minYearMonth
            } ?? false
        return Button {
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) { year = nextYear }
        } label: {
            KualiaIconImage(icon: symbol, size: 15)
                .font(.subheadline.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(KualiaPalette.surface, in: Circle())
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.3)
        .accessibilityLabel(label)
    }

    private func monthButton(_ month: Int) -> some View {
        let selected = month == selectedMonth
        let current = month == currentMonth
        return Button {
            select(month)
        } label: {
            VStack(spacing: 6) {
                Text(BudgetMonth.abbreviatedTitle(month, locale: locale))
                    .font(.subheadline.weight(selected ? .bold : .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if current {
                    Text(L10n.string("(today)"))
                        .font(.caption2)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 58, alignment: .center)
            .padding(.horizontal, 4)
            .foregroundStyle(selected ? KualiaPalette.surface : KualiaPalette.ink)
            .background(
                selected ? KualiaPalette.ink : KualiaPalette.surface,
                in: RoundedRectangle(cornerRadius: 18)
            )
            .contentShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(!isEnabled(month))
        .opacity(isEnabled(month) ? 1 : 0.3)
        .accessibilityLabel(BudgetMonth.title(month, locale: locale))
        .accessibilityValue(current ? L10n.string("Current month") : "")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("budget-month-\(month)")
    }

    private func select(_ month: Int) {
        guard isEnabled(month) else { return }
        onSelect(month)
        dismiss()
    }
}

struct BudgetTotalsRow: View {
    let totals: BudgetTotals
    let currencyCode: String
    let minorUnit: Int
    var isCompact = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.locale) private var locale

    var body: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: isCompact ? 0 : 8))
        layout {
            Text(L10n.string("Total"))
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, isCompact ? 14 : 0)
            HStack(spacing: isCompact ? 0 : 8) {
                amount(L10n.string("Assigned"), value: totals.assigned)
                amount(L10n.string("Available"), value: totals.available)
            }
        }
        .padding(.horizontal, isCompact ? 0 : 14)
        .padding(.vertical, 9)
        .frame(minHeight: 44)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: isCompact ? 0 : 20))
        .overlay(alignment: .top) {
            if isCompact { BudgetRowDivider() }
        }
        .overlay(alignment: .bottom) {
            if isCompact { BudgetRowDivider() }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("budget-totals")
    }

    private func amount(_ title: String, value: Decimal) -> some View {
        VStack(alignment: .trailing, spacing: 3) {
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(KualiaPalette.mutedInk)
            Text(
                MoneyAmountFormatter.string(
                    decimalMinorUnits: value, currencyCode: currencyCode, minorUnit: minorUnit,
                    showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
            )
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(KualiaPalette.ink)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, isCompact ? 8 : 0)
        .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : 96, alignment: .trailing)
        .frame(
            maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil, alignment: .trailing)
    }
}
