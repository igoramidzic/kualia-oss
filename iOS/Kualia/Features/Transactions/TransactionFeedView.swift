import SwiftUI

struct TransactionFeedView: View {
    @Environment(\.homeControlDock) private var dock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(TransactionFeedPreferences.showsReconciledTransactionsKey)
    private var showsReconciledTransactions = true

    let store: TransactionFeedStore
    let isActive: Bool
    var scrollToTopRequest = 0
    var showsAgenda = false
    var allowsSelection = false

    @State private var isScrolling = false
    @State private var listWidth: CGFloat = 0
    @State private var listHeight: CGFloat = 0
    @State private var activeSwipeRowID: String?
    @State private var pendingEditReceipt: TransactionMutationReceipt?
    @State private var editor: TransactionEditorStore?
    @State private var pendingDuplicateEditor: TransactionEditorStore?
    @State private var categoryEditor: TransactionEditorStore?
    private var plans: PlannedStore? { showsAgenda ? store.agenda : nil }
    @State private var plannedSelection: PlannedSelection?
    @State private(set) var isPlannedExpanded = false
    @State private(set) var isCalendarExpanded = false
    @State private var calendarDaySelection: PlannedDaySelection?

    var showsPlannedSection: Bool { showsAgenda && store.filter == .all }

    var body: some View {
        ScrollViewReader { proxy in
            ZStack {
                content.transition(.opacity)
            }
            .animation(
                reduceMotion ? nil : .easeOut(duration: 0.2), value: isInitiallyLoading
            )
            .onChange(of: store.filter) { _, _ in
                activeSwipeRowID = nil
            }
            .onChange(of: store.showsReconciledTransactions) { _, _ in
                activeSwipeRowID = nil
            }
            .onChange(of: showsReconciledTransactions, initial: true) { _, showsReconciled in
                if showsAgenda { store.setShowsReconciledTransactions(showsReconciled) }
            }
            .onChange(of: scrollToTopRequest) { _, _ in
                guard isActive else { return }
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                    if showsAgenda && dock == nil {
                        proxy.scrollTo("transaction-filters", anchor: .top)
                    } else if let firstSection = store.sections.first {
                        proxy.scrollTo(firstSection.id, anchor: .top)
                    }
                }
            }

        }
        .homeDockFilters {
            if showsAgenda && !store.isSelecting { TransactionFeedFilterStrip(store: store) }
        }
        .sheet(
            isPresented: Binding(
                get: { store.showsSelectionEditor }, set: { store.showsSelectionEditor = $0 }
            ),
            onDismiss: {
                guard let duplicate = pendingDuplicateEditor else { return }
                pendingDuplicateEditor = nil
                store.endSelection()
                editor = duplicate
            }
        ) {
            if let choices = store.makeCreationEditor() {
                TransactionSelectionEditSheet(
                    feed: store, store: choices,
                    onDuplicate: {
                        guard let duplicate = store.makeSelectionDuplicateEditor() else { return }
                        pendingDuplicateEditor = duplicate
                        store.showsSelectionEditor = false
                    },
                    onAction: { action in
                        store.showsSelectionEditor = false
                        Task { await store.performSelection(action) }
                    },
                    onSave: { edit in
                        store.showsSelectionEditor = false
                        Task { await store.editSelection(edit) }
                    })
            }
        }
        .modifier(
            PlannedCalendarPresentation(
                plans: plans, feed: store, daySelection: $calendarDaySelection)
        )
        .onChange(of: store.isSelecting) { _, _ in activeSwipeRowID = nil }
        .sheet(item: $plannedSelection) { selection in
            if let plans { PlannedDetailSheet(store: plans, feed: store, selection: selection) }
        }
        .sheet(
            isPresented: Binding(
                get: { categoryEditor != nil },
                set: { if !$0 { categoryEditor = nil } }
            )
        ) {
            if let categoryEditor {
                TransactionFeedCategorySheet(
                    store: categoryEditor,
                    onSubmit: { id, declinesTransfer in
                        store.startCategorizing(
                            editor: categoryEditor, categoryID: id,
                            declinesTransfer: declinesTransfer)
                    }
                )
            }
        }
        .sheet(
            isPresented: Binding(
                get: { editor != nil },
                set: { if !$0 { editor = nil } }
            ),
            onDismiss: {
                if let receipt = pendingEditReceipt { store.publishReceipt(receipt) }
                pendingEditReceipt = nil
            }
        ) {
            if let editor {
                TransactionEditorView(store: editor, onSaved: { pendingEditReceipt = $0 })
            }
        }
        .onChange(of: store.workspace?.id) { _, _ in
            pendingEditReceipt = nil
            pendingDuplicateEditor = nil
            editor = nil
            categoryEditor = nil
            plannedSelection = nil
            isPlannedExpanded = false
            isCalendarExpanded = false
            calendarDaySelection = nil
        }
    }

    @ViewBuilder
    private var content: some View {
        if showsAgenda && plans != nil {
            ledger
        } else if isInitiallyLoading {
            if showsAgenda {
                ProgressView(L10n.string("Loading scheduled activity…"))
            } else {
                TransactionFeedLoadingView()
            }
        } else if !store.hasLoaded, store.errorMessage == nil {
            TransactionFeedLoadingView()
        } else if !store.hasLoaded, let errorMessage = store.errorMessage {
            TransactionFeedMessageView(
                icon: .refresh,
                title: L10n.string("Couldn't load transactions"),
                message: errorMessage,
                actionTitle: L10n.string("Try again"),
                action: store.retry
            )
        } else if store.workspace == nil {
            TransactionFeedMessageView(
                icon: .workspace,
                title: L10n.string("Choose a workspace"),
                message: L10n.string("Select an active workspace to see its transactions.")
            )
        } else {
            ledger
                .overlay {
                    if store.sections.isEmpty {
                        TransactionFeedMessageView(
                            icon: .checkCircle,
                            title: L10n.string("No transactions yet"),
                            message: L10n.string(
                                "New activity will appear here as soon as it arrives.")
                        )
                        .allowsHitTesting(false)
                    }
                }
        }
    }

    private var isInitiallyLoading: Bool {
        TransactionFeedLoadingState.isLoading(
            feedLoaded: store.hasLoaded, feedFailed: store.errorMessage != nil,
            showsAgenda: showsPlannedSection, hasWorkspace: store.workspace != nil,
            agendaLoaded: plans?.data != nil, agendaFailed: plans?.errorMessage != nil)
    }

    private var ledger: some View {
        List {
            if showsAgenda && dock == nil {
                TransactionFeedFilterStrip(store: store)
                    .id("transaction-filters")
                    .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 16, trailing: 0))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if let plans, showsPlannedSection {
                TransactionCalendarSection(
                    plans: plans, isExpanded: $isCalendarExpanded,
                    onSelectDay: { calendarDaySelection = .init(id: $0) })
                TransactionAgendaView(
                    plans: plans, isExpanded: $isPlannedExpanded,
                    onSelectPlan: { plannedSelection = $0 })
            }
            if showsAgenda && store.sections.isEmpty {
                Group {
                    if (!store.hasLoaded || store.isLoadingMore)
                        && store.errorMessage == nil
                    {
                        ProgressView(L10n.string("Loading transactions…"))
                    } else if store.hasLoaded && store.errorMessage == nil && !store.hasMore {
                        Text(
                            store.hasActiveFilters
                                ? L10n.string("No transactions match this filter.")
                                : L10n.string("No transactions entered yet.")
                        ).font(.subheadline)
                            .foregroundStyle(KualiaPalette.mutedInk)
                    }
                }.frame(maxWidth: .infinity).padding(.vertical, 20)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            TransactionFeedRows(
                sections: store.sections, workspace: store.workspace, listWidth: listWidth,
                activeSwipeRowID: $activeSwipeRowID,
                isSelecting: allowsSelection && store.isSelecting,
                selectedIDs: store.selectedIDs,
                onSelect: allowsSelection
                    ? { entry in
                        activeSwipeRowID = nil
                        if store.isSelecting {
                            store.toggleSelection(entry)
                        } else {
                            store.beginSelection(entry)
                        }
                    } : nil,
                onEdit: { editor = store.makeEditor(for: $0.id) },
                onAction: { action, entry in
                    if action == .categorize {
                        categoryEditor = store.makeEditor(for: entry.id)
                    } else {
                        await store.perform(action, on: entry)
                        if let pending = store.transferReviewEditor {
                            editor = pending
                            store.transferReviewEditor = nil
                        }
                    }
                },
                onAppear: { store.loadMoreIfNeeded(after: $0.id) },
                onViewPlan: plans == nil ? nil : { plannedSelection = .init(id: $0) }
            )

            TransactionFeedFooter(
                isLoadingMore: store.isLoadingMore,
                errorMessage: store.errorMessage,
                onRetry: store.retry,
                canLoadMore: store.canLoadMoreFromFooter,
                onLoadMore: { store.loadMoreIfNeeded() },
                showsReconciledTransactionsPrompt: store.showsReconciledTransactionsPrompt,
                onShowReconciled: {
                    showsReconciledTransactions = true
                    store.setShowsReconciledTransactions(true)
                },
                isActive: isActive
            )
            .frame(minHeight: 44)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            if showsAgenda {
                Color.clear
                    .frame(height: max(320, listHeight - 80))
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .accessibilityHidden(true)
            }
        }
        .onGeometryChange(for: CGSize.self) { proxy in
            proxy.size
        } action: { size in
            listWidth = size.width
            listHeight = size.height
        }
        .modifier(TransactionFeedListStyle())
        // Animate live edits/Undo only while idle. Appending a page must not
        // animate the entire list's layout in the middle of a scroll gesture.
        .animation(
            reduceMotion || isScrolling ? nil : .smooth(duration: 0.3),
            value: store.rowTransitionRevision
        )
        .modifier(HomeGlowScrollObserver())
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
        .kualiaScrollEdges(for: [.top, .bottom])
        .onScrollPhaseChange { _, phase in
            isScrolling = phase != .idle
            if phase == .interacting || phase == .decelerating { activeSwipeRowID = nil }
        }
        .accessibilityIdentifier("transaction-feed")
    }

}

struct TransactionPreferencesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(TransactionFeedPreferences.showsReconciledTransactionsKey)
    private var showsReconciledTransactions = true

    var body: some View {
        NavigationStack {
            SettingsCanvas {
                SettingsGroup(title: L10n.string("Transactions")) {
                    Toggle(isOn: $showsReconciledTransactions) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(L10n.string("Show reconciled transactions"))
                                .font(.body.weight(.medium))
                            Text(L10n.string("Include reconciled transactions in your list."))
                                .font(.caption)
                                .foregroundStyle(KualiaPalette.mutedInk)
                        }
                    }
                    .padding(20)
                    .accessibilityIdentifier("transactions-show-reconciled")
                }
            }
            .navigationTitle(L10n.string("Transaction preferences"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }
                }
            }
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct TransactionFeedFilterStrip: View {
    let store: TransactionFeedStore
    @Environment(\.homeFiltersAreVertical) private var isVertical
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if isVertical {
            VStack(spacing: 8) { filterButtons }
        } else {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        filterButtons
                    }
                    .padding(.horizontal, 18)
                    .background(ImmediateScrollTouches())
                }
                .scrollIndicators(.hidden)
                .modifier(HorizontalFilterScrollEdges())
                .onChange(of: store.filter, initial: true) { _, filter in
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
                        proxy.scrollTo(filter, anchor: .center)
                    }
                }
            }
            .accessibilityIdentifier("transaction-filters")

        }
    }

    private var filterButtons: some View {
        ForEach(store.visibleFilters) { filter in
            Button {
                store.selectFilter(filter)
            } label: {
                (isVertical
                    ? AnyLayout(VStackLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 6))) {
                        HomeFilterLabel(filter.title)
                        if filter == .needsReview, store.filterCountsAreComplete {
                            FilterCountBadge(count: store.filterCounts.needsReview)
                        }
                    }
                    .foregroundStyle(
                        foreground(for: filter)
                    )
                    .fixedSize(horizontal: !isVertical, vertical: isVertical)
                    .modifier(FilterChipStyle(background: background(for: filter)))
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(store.isPerformingAction)
            .id(filter)
            .accessibilityAddTraits(store.filter == filter ? .isSelected : [])
            .accessibilityIdentifier("transaction-filter-\(filter.rawValue)")
        }
    }
    private func foreground(for filter: TransactionFeedFilter) -> Color {
        return store.filter == filter ? KualiaPalette.canvas : KualiaPalette.ink
    }

    private func background(for filter: TransactionFeedFilter) -> Color {
        switch filter {
        case .needsReview:
            return store.filter == filter
                ? KualiaPalette.transactionsGlow : KualiaPalette.transactionsGlow.opacity(0.18)
        default:
            return store.filter == filter ? KualiaPalette.ink : KualiaPalette.surface
        }
    }

}

/// Keep every transaction surface flush, including short date-header rows.
struct TransactionFeedListStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listStyle(.plain)
            .listRowSpacing(0)
            .listSectionSpacing(0)
            .environment(\.defaultMinListRowHeight, 0)
            .scrollContentBackground(.hidden)
    }
}

/// Shared rows keep date labels in the scrolling content and swipe motion local to each row.
struct TransactionFeedRows: View {
    let sections: [TransactionFeedSection]
    let workspace: TransactionFeedWorkspace?
    let listWidth: CGFloat
    var categoryAmounts: [String: Decimal] = [:]
    var activeSwipeRowID: Binding<String?> = .constant(nil)
    var isSelecting = false
    var selectedIDs: Set<String> = []
    var onSelect: ((TransactionFeedEntry) -> Void)?
    let onEdit: (TransactionFeedEntry) -> Void
    let onAction: (TransactionFeedAction, TransactionFeedEntry) async -> Void
    var onAppear: (TransactionFeedEntry) -> Void = { _ in }
    var onViewPlan: ((String) -> Void)?

    var body: some View {
        ForEach(sections) { section in
            Section {
                TransactionFeedDayHeader(
                    date: section.id,
                    workspace: workspace
                )
                .modifier(TransactionFeedDayHeaderRow())
                .id(section.id)

                ForEach(section.entries) { entry in
                    TransactionSwipeRow(
                        entry: entry, workspace: workspace, width: listWidth,
                        categoryAmount: categoryAmounts[entry.id], activeRowID: activeSwipeRowID,
                        isSelecting: isSelecting, isSelected: selectedIDs.contains(entry.id),
                        onSelect: onSelect.map { select in { select(entry) } },
                        onEdit: { onEdit(entry) },
                        onAction: { action in
                            if action == .approve && entry.opensEditorForApproval {
                                onEdit(entry)
                            } else {
                                await onAction(action, entry)
                            }
                        }
                    )
                    .modifier(
                        TransactionFeedPlanMenu(
                            planID: onSelect == nil ? entry.scheduledTransactionId : nil,
                            onViewPlan: onViewPlan)
                    )
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(
                        isSelecting && selectedIDs.contains(entry.id)
                            ? KualiaPalette.ink.opacity(0.05) : Color.clear
                    )
                    .listRowSeparator(.hidden, edges: .top)
                    .listRowSeparator(
                        entry.id == section.entries.last?.id ? .hidden : .visible, edges: .bottom
                    )
                    .listRowSeparatorTint(KualiaPalette.border)
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    .alignmentGuide(.listRowSeparatorTrailing) { dimensions in dimensions.width }
                    .onAppear {
                        onAppear(entry)
                    }
                }
            }
            .listSectionSeparator(.hidden)
        }
    }

}

struct TransactionFeedCategorySheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: TransactionEditorStore
    let onSubmit: (String, Bool) -> Bool
    @State private var pendingCategoryID: String?
    @State private var didHandOffSave = false

    var body: some View {
        TransactionEditorPicker(
            title: L10n.string("Categories"),
            choices: store.draft == nil || !store.supportsCategories
                ? [] : store.categoryPickerChoices.filter { $0.id != "none" },
            selectedID: nil,
            isLoading: !didHandOffSave && (store.isLoading || store.isLoadingChoices),
            dismissesOnSelection: false,
            errorMessage: didHandOffSave
                ? nil
                : store.loadErrorMessage ?? store.choicesErrorMessage
                    ?? store.saveErrorMessage
                    ?? (store.draft != nil && !store.supportsCategories
                        ? L10n.string("Categories aren't available for this transaction.") : nil),
            onRetry: store.loadErrorMessage != nil || store.choicesErrorMessage != nil
                ? { Task { await store.load() } } : nil,
            showsCategoryBalances: true, categoryDateKey: store.draft?.dateKey,
            focusesSearchOnAppear: true,
            onSelect: { id in
                if store.detail?.suggestedTransfer?.isActionable == true {
                    pendingCategoryID = id
                } else {
                    save(id)
                }
            }
        )
        .allowsHitTesting(!didHandOffSave)
        .alert(
            L10n.string("Save as a regular transaction?"),
            isPresented: Binding(
                get: { pendingCategoryID != nil },
                set: { if !$0 { pendingCategoryID = nil } }
            ),
            presenting: pendingCategoryID
        ) { id in
            Button(L10n.string("Cancel"), role: .cancel) { pendingCategoryID = nil }
            Button(L10n.string("Categorize and approve")) { save(id, declinesTransfer: true) }
        } message: { _ in
            Text(L10n.string("Categorizing this entry dismisses its transfer suggestion."))
        }
        .task { await store.load() }
        .onDisappear { if !didHandOffSave { store.stop() } }
    }

    private func save(_ id: String, declinesTransfer: Bool = false) {
        guard !didHandOffSave else { return }
        if onSubmit(id, declinesTransfer) {
            didHandOffSave = true
            dismiss()
        }
    }
}

private struct TransactionFeedPlanMenu: ViewModifier {
    @Environment(\.transactionScheduleStore) private var schedules
    let planID: String?
    let onViewPlan: ((String) -> Void)?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let planID, let onViewPlan {
            content.contextMenu {
                Button(
                    L10n.string("View plan"),
                    icon: schedules?.schedule(planID)?.recurrence.calendarIcon ?? .calendarFilled
                ) { onViewPlan(planID) }
            }
        } else {
            content
        }
    }
}

struct TransactionFeedRowButton: View {
    let entry: TransactionFeedEntry
    let workspace: TransactionFeedWorkspace?
    var categoryAmount: Decimal? = nil
    var isSelecting = false
    var isSelected = false
    let onEdit: () -> Void
    @State private var tapFeedback = 0

    var body: some View {
        Button {
            tapFeedback &+= 1
            onEdit()
        } label: {
            HStack(spacing: 14) {
                if isSelecting {
                    KualiaIconImage(icon: isSelected ? .checkCircle : .circleOutline, size: 22)
                        .foregroundStyle(isSelected ? KualiaPalette.ink : KualiaPalette.mutedInk)
                        .frame(width: 26)
                        .accessibilityHidden(true)
                }
                TransactionFeedRow(
                    entry: entry, workspace: workspace, categoryAmount: categoryAmount
                ).equatable()
            }
        }
        // Starting a swipe also presses the button. Only fire tap feedback
        // after an actual activation, without rebuilding the label on press changes.
        .buttonStyle(.plain)
        .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: tapFeedback)
        .accessibilityHint(
            isSelecting
                ? L10n.string("Toggle transaction selection") : L10n.string("Edit transaction")
        )
        .accessibilityAddTraits(isSelecting && isSelected ? .isSelected : [])
    }
}

struct TransactionFeedDayHeader: View {
    let date: String
    let workspace: TransactionFeedWorkspace?

    var body: some View {
        Text(
            TransactionDateLabel.title(
                for: date,
                timezoneIdentifier: workspace?.timezoneIdentifier
            )
        )
        .font(.system(size: 13, weight: .bold, design: .rounded))
        .foregroundStyle(KualiaPalette.ink)
        .textCase(.uppercase)
        .tracking(0.7)
        .accessibilityAddTraits(.isHeader)
    }
}

struct TransactionRowDivider: View {
    var body: some View {
        Rectangle()
            .fill(PlannedStyle.transactionSeparator, style: FillStyle(antialiased: false))
            .frame(height: 1)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

struct TransactionFeedDayHeaderRow: ViewModifier {
    var background: Color = .clear

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(EdgeInsets(top: 16, leading: 18, bottom: 10, trailing: 18))
            .overlay(alignment: .top) { TransactionRowDivider() }
            .overlay(alignment: .bottom) { TransactionRowDivider() }
            .listRowInsets(EdgeInsets())
            .listRowBackground(background)
            .listRowSeparator(.hidden)
    }
}

struct TransactionFeedRow: View, Equatable {
    @Environment(\.transactionScheduleStore) private var schedules
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.layoutDirection) private var layoutDirection

    let entry: TransactionFeedEntry
    let workspace: TransactionFeedWorkspace?
    var planStatus: PlannedStatus? = nil
    var recurrence: TransactionEditorRecurrence? = nil
    var showsPlannedDate = true
    var categoryAmount: Decimal? = nil
    var isPausedPlan = false
    var background: Color = KualiaPalette.surface

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.entry == rhs.entry && lhs.workspace == rhs.workspace && lhs.planStatus == rhs.planStatus
            && lhs.showsPlannedDate == rhs.showsPlannedDate && lhs.recurrence == rhs.recurrence
            && lhs.categoryAmount == rhs.categoryAmount
            && lhs.isPausedPlan == rhs.isPausedPlan && lhs.background == rhs.background
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            TransactionMerchantMark(entry: entry, size: 44)
                .overlay(alignment: .topTrailing) {
                    if entry.needsAttention {
                        Group {
                            if entry.reviewStatus == .needsReview {
                                KualiaIconImage(icon: .badgeCheck, size: 18)
                                    .foregroundStyle(KualiaPalette.accent)
                            } else {
                                KualiaIconImage(icon: .warning, size: 15)
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(TransactionFeedColors.attention)
                            }
                        }
                        .padding(2)
                        .background(background, in: Circle())
                        .offset(x: 3, y: -3)
                    }
                }

            VStack(alignment: .leading, spacing: 6) {
                heading
                TransactionMetadataLayout(layoutDirection: layoutDirection) {
                    if entry.hasTransferSuggestion {
                        TransactionMetadataChip(
                            title: L10n.string("Suggested transfer"), icon: .transfer,
                            tint: KualiaPalette.accent)
                        if let label = entry.suggestedAccountLabel {
                            TransactionMetadataChip(title: label, icon: .bank, tint: metadataTint)
                        }
                    }
                    ForEach(entry.hasTransferSuggestion ? [] : entry.categoryLabels, id: \.self) {
                        category in
                        TransactionMetadataChip(
                            title: category,
                            icon: .category,
                            tint: category == L10n.string("Uncategorized")
                                ? TransactionFeedColors.attention : metadataTint
                        )
                    }

                    if entry.isCreditCardPayment {
                        TransactionMetadataChip(
                            title: L10n.string("Payment"), icon: .accounts, tint: .purple)
                    }
                    if let account = entry.accountSummary {
                        TransactionMetadataChip(
                            title: account, icon: entry.bankAccountIcon, tint: metadataTint)
                    }
                    if !plannedTimingTitle.isEmpty {
                        TransactionMetadataChip(
                            title: plannedTimingTitle, icon: scheduleIcon, tint: planTint)
                    }
                }
                if let notes = entry.notes {
                    Label {
                        Text(notes)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        KualiaIconImage(icon: .note, size: 18)
                    }
                    .font(.caption)
                    .foregroundStyle(KualiaPalette.mutedInk)
                }
            }
        }
        .padding(.vertical, 10)
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 68)
        .background(background)
        // Keep artwork and text inside the row while its contents translate.
        .clipped()
        .contentShape(.interaction, Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.title)
        .accessibilityValue(accessibilityValue)
    }

    @ViewBuilder
    private var heading: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                title
                amount.frame(maxWidth: .infinity, alignment: .trailing)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                title.frame(maxWidth: .infinity, alignment: .leading)
                amount.layoutPriority(1)
            }
        }
    }

    private var title: some View {
        Text(entry.title)
            .font(.system(.subheadline, design: .rounded, weight: .semibold))
            .foregroundStyle(KualiaPalette.ink)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var amount: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if planStatus == nil && !isPausedPlan && entry.status == .pending {
                KualiaIconImage(icon: .clock, size: 18)
                    .font(.system(.caption2, weight: .semibold))
                    .foregroundStyle(TransactionFeedColors.pending)
            }

            Text(formattedAmount)
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(amountColor)
                .lineLimit(1)
                .minimumScaleFactor(0.78)
        }
    }

    private var detail: String {
        [entry.categoryLabels.joined(separator: ", "), entry.accountSummary]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    private var formattedAmount: String {
        if let categoryAmount {
            return MoneyAmountFormatter.string(
                decimalMinorUnits: categoryAmount, currencyCode: workspace?.currencyCode ?? "USD",
                minorUnit: workspace?.minorUnit ?? 2, showsPositiveSign: true,
                usesAbsoluteValue: false)
        }
        return TransactionAmountFormatter.string(
            minorUnits: entry.amount,
            currencyCode: workspace?.currencyCode ?? "USD",
            minorUnit: workspace?.minorUnit ?? 2,
            showsPositiveSign: true,
            usesAbsoluteValue: false
        )
    }

    var scheduleIcon: KualiaIcon {
        if let recurrence { return recurrence.calendarIcon }
        return entry.scheduledTransactionId.flatMap {
            schedules?.schedule($0)?.recurrence.calendarIcon
        }
            ?? .calendarFilled
    }

    private var planTint: Color {
        planStatus == .overdue ? KualiaPalette.budgetNegative : KualiaPalette.ink
    }

    private var metadataTint: Color? {
        planStatus != nil || isPausedPlan ? KualiaPalette.ink : nil
    }

    var plannedDateTitle: String {
        let date: String
        if let workspace {
            date = PlannedDates.dueLabel(
                entry.date, today: TransactionEditorDate.today(workspace: workspace),
                workspace: workspace)
        } else {
            date = entry.date
        }
        return planStatus == .overdue ? L10n.string("Overdue · \(date)") : date
    }

    var plannedTimingTitle: String {
        let status: String? =
            isPausedPlan
            ? L10n.string("Paused")
            : planStatus != nil && showsPlannedDate ? plannedDateTitle : nil
        let frequency = recurrence == .once ? nil : recurrence?.plannedBadgeTitle
        return [status, frequency].compactMap { $0 }.joined(separator: " · ")
    }

    private var amountColor: Color {
        if entry.hasTransferSuggestion { return KualiaPalette.ink }
        return (categoryAmount ?? Decimal(entry.amount)) > 0
            ? TransactionFeedColors.inflow : KualiaPalette.ink
    }

    var accessibilityValue: String {
        var values = [detail, formattedAmount]
        if let notes = entry.notes { values.append(L10n.string("Notes: \(notes)")) }
        if entry.scheduledTransactionId != nil {
            values.append(
                isPausedPlan
                    ? L10n.string("Paused")
                    : planStatus == .overdue
                        ? L10n.string("Past due")
                        : planStatus != nil ? L10n.string("Planned") : L10n.string("From plan"))
            if let recurrence {
                values.append(recurrence.title)
            } else if scheduleIcon == .calendarRepeating {
                values.append(L10n.string("Repeating"))
            }
        }
        if planStatus != nil && showsPlannedDate && !isPausedPlan {
            values.append(plannedDateTitle)
        }
        if entry.hasTransferSuggestion {
            values.append(L10n.string("Suggested transfer"))
            if let label = entry.suggestedAccountLabel { values.append(label) }
        }
        if entry.isCreditCardPayment { values.append(L10n.string("Credit card payment")) }
        if entry.reviewStatus == .needsReview {
            values.append(L10n.string("Needs review"))
        }
        if planStatus == nil && !isPausedPlan && entry.status == .pending {
            values.append(L10n.string("Pending"))
        }
        if !entry.hasTransferSuggestion && (entry.hasUncategorized || entry.hasMissingPayee) {
            values.append(L10n.string("Details needed"))
        }
        return values.joined(separator: ", ")
    }
}

struct TransactionMerchantMark: View {
    let entry: TransactionFeedEntry
    var size: CGFloat = 34

    var body: some View {
        Group {
            if let url = entry.displayLogoUrl.flatMap(URL.init(string:)) {
                TransactionMerchantLogo(url: url) { fallback }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var fallback: some View {
        if entry.type == .transfer {
            KualiaIconImage(icon: entry.transferAccountIcon, size: size / 2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: .tertiarySystemFill))
        } else if entry.type == .regular,
            entry.merchantVisualIdentityMode == "icon",
            let initial = entry.merchantName?.first
        {
            Text(String(initial).uppercased())
                .font(.system(size: size / 2, weight: .bold, design: .rounded))
                .foregroundStyle(
                    TransactionFeedColors.identityForeground(entry.merchantIconColorId)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(TransactionFeedColors.identityBackground(entry.merchantIconColorId))
        } else {
            KualiaIconImage(icon: entry.fallbackIcon, size: size / 2)
                .font(.system(size: size / 2, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: .tertiarySystemFill))
        }
    }
}

struct TransactionMerchantLogo<Placeholder: View>: View {
    let url: URL
    var cache: TransactionMerchantLogoCache = .shared
    @ViewBuilder let placeholder: () -> Placeholder

    @State private var loadedURL: URL?
    @State private var loadedImage: Image?

    var body: some View {
        Group {
            if let image = cache.image(for: url) {
                logo(image)
            } else if loadedURL == url {
                if let loadedImage {
                    logo(loadedImage)
                } else {
                    placeholder()
                }
            } else {
                Color(uiColor: .tertiarySystemFill)
            }
        }
        .task(id: url) {
            let image = await cache.load(url)
            guard !Task.isCancelled else { return }
            loadedImage = image
            loadedURL = url
        }
    }

    private func logo(_ image: Image) -> some View {
        image
            .resizable()
            .scaledToFill()
            .background(Color.white)
    }
}

@MainActor
final class TransactionMerchantLogoCache {
    static let shared = TransactionMerchantLogoCache()

    private let images = NSCache<NSURL, CachedImage>()

    private var pending: [URL: Task<Image?, Never>] = [:]
    private let fetchImage: @MainActor (URL) async -> Image?

    init(
        fetchImage: @escaping @MainActor (URL) async -> Image? = { url in
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                guard let response = response as? HTTPURLResponse,
                    (200..<300).contains(response.statusCode),
                    let image = await TransactionMerchantImageDecoder.decode(data)
                else { return nil }
                return Image(decorative: image, scale: 3)
            } catch {
                return nil
            }
        }
    ) {
        self.fetchImage = fetchImage
        images.countLimit = 200
    }

    func load(_ url: URL) async -> Image? {
        #if DEBUG
            if let local = ScreenshotDemoLogo.image(url) {
                let image = Image(uiImage: local)
                insert(image, for: url)
                return image
            }
        #endif
        if let image = image(for: url) { return image }
        if let task = pending[url] { return await task.value }

        // A disappearing row must not cancel a request shared by other rows.
        let task = Task { await fetchImage(url) }
        pending[url] = task
        let image = await task.value
        if let image { insert(image, for: url) }
        pending[url] = nil
        return image
    }

    func image(for url: URL) -> Image? {
        images.object(forKey: url as NSURL)?.image
    }

    func insert(_ image: Image, for url: URL) {
        images.setObject(CachedImage(image), forKey: url as NSURL)
    }

    private final class CachedImage {
        let image: Image

        init(_ image: Image) {
            self.image = image
        }
    }
}

struct TransactionMetadataChip: View {
    @ScaledMetric(relativeTo: .caption) private var iconSize: CGFloat = 13

    let title: String
    let icon: KualiaIcon
    var tint: Color?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            KualiaIconImage(icon: icon, size: iconSize)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - iconSize * 0.15 }
            Text(title)
                .font(.system(.caption, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(tint ?? KualiaPalette.ink)
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(
            tint?.opacity(0.12) ?? KualiaPalette.border.opacity(0.36),
            in: RoundedRectangle(cornerRadius: 7)
        )
    }
}

// A row-local layout keeps measurement out of view state. Cache the natural chip
// sizes and the last arrangement, and only remeasure chips wider than the row.
struct TransactionMetadataLayout: Layout {
    var layoutDirection: LayoutDirection = .leftToRight
    var spacing: CGFloat = 5

    struct Cache {
        var idealSizes: [CGSize]
        var width: CGFloat?
        var frames: [CGRect] = []
        var size: CGSize = .zero
    }

    func makeCache(subviews: Subviews) -> Cache {
        Cache(idealSizes: subviews.map { $0.sizeThatFits(.unspecified) })
    }

    func updateCache(_ cache: inout Cache, subviews: Subviews) {
        cache = makeCache(subviews: subviews)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize
    {
        arrange(width: proposal.width, subviews: subviews, cache: &cache)
        return cache.size
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache
    ) {
        arrange(width: bounds.width, subviews: subviews, cache: &cache)
        for (index, subview) in subviews.enumerated() {
            let frame = cache.frames[index]
            let x =
                layoutDirection == .rightToLeft
                ? bounds.maxX - frame.maxX : bounds.minX + frame.minX
            subview.place(
                at: CGPoint(x: x, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(width: CGFloat?, subviews: Subviews, cache: inout Cache) {
        let availableWidth = max(0, width ?? .infinity)
        guard cache.width != availableWidth else { return }

        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var usedWidth: CGFloat = 0
        cache.frames.removeAll(keepingCapacity: true)

        for (index, subview) in subviews.enumerated() {
            let idealSize = cache.idealSizes[index]
            let size =
                idealSize.width > availableWidth
                ? subview.sizeThatFits(ProposedViewSize(width: availableWidth, height: nil))
                : idealSize
            if x > 0, x + size.width > availableWidth {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            cache.frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            usedWidth = max(usedWidth, x + size.width)
            lineHeight = max(lineHeight, size.height)
            x += size.width + spacing
        }

        cache.width = availableWidth
        cache.size = CGSize(
            width: availableWidth.isFinite ? availableWidth : usedWidth,
            height: y + lineHeight
        )
    }
}

struct TransactionFeedFooter: View {
    let isLoadingMore: Bool
    let errorMessage: String?
    let onRetry: () -> Void
    var canLoadMore = false
    var onLoadMore: () -> Void = {}
    var showsReconciledTransactionsPrompt = false
    var onShowReconciled: () -> Void = {}
    var isActive = true
    @State private var isVisible = false

    private var shouldLoadMore: Bool {
        isActive && isVisible && canLoadMore && !isLoadingMore && errorMessage == nil
    }

    var body: some View {
        Group {
            if isLoadingMore {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .accessibilityLabel(L10n.string("Loading more transactions"))
            } else if let errorMessage {
                VStack(spacing: 8) {
                    Text(errorMessage)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(KualiaPalette.mutedInk)

                    Button(L10n.string("Try again"), action: onRetry)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .buttonStyle(.borderless)
                }
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
                .padding(.vertical, 4)
            } else if showsReconciledTransactionsPrompt {
                VStack(spacing: 12) {
                    Text(L10n.string("Reconciled transactions are hidden."))
                        .font(.subheadline)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("transaction-filtered-results-notice")
                    Button(L10n.string("Show reconciled transactions"), action: onShowReconciled)
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("transaction-show-reconciled")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            } else {
                Color.clear
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 44)
        .onScrollVisibilityChange { isVisible = $0 }
        .onDisappear { isVisible = false }
        .task(id: shouldLoadMore) {
            if shouldLoadMore { onLoadMore() }
        }
    }
}

private struct TransactionFeedLoadingView: View {
    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
                .controlSize(.large)

            Text(L10n.string("Loading your ledger…"))
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(KualiaPalette.mutedInk)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

struct TransactionFeedMessageView: View {
    let icon: KualiaIcon
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            KualiaIconImage(icon: icon, size: 24)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 58, height: 58)
                .background(
                    Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 19)
                )

            VStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(KualiaPalette.ink)

                Text(message)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(KualiaPalette.mutedInk)
            }

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private enum TransactionFeedColors {
    static let inflow = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.40, green: 0.80, blue: 0.55, alpha: 1)
                : UIColor(red: 0.12, green: 0.48, blue: 0.30, alpha: 1)
        }
    )
    static let pending = Color(red: 0.69, green: 0.40, blue: 0.08)
    static let attention = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.98, green: 0.48, blue: 0.42, alpha: 1)
                : UIColor(red: 0.76, green: 0.28, blue: 0.22, alpha: 1)
        }
    )

    static func identityForeground(_ colorID: String?) -> Color {
        switch colorID {
        case "red", "rose", "pink": Color(red: 0.70, green: 0.15, blue: 0.25)
        case "orange", "amber", "yellow": Color(red: 0.66, green: 0.34, blue: 0.06)
        case "lime", "green", "emerald": Color(red: 0.08, green: 0.43, blue: 0.24)
        case "teal", "cyan", "sky": Color(red: 0.04, green: 0.42, blue: 0.52)
        case "violet", "purple", "fuchsia": Color(red: 0.45, green: 0.19, blue: 0.68)
        case "slate", "stone", "zinc": KualiaPalette.mutedInk
        default: .secondary
        }
    }

    static func identityBackground(_ colorID: String?) -> Color {
        identityForeground(colorID).opacity(0.13)
    }
}

extension TransactionFeedAction {
    var tint: Color {
        switch self {
        case .delete: .red
        case .setStatus(.pending): TransactionFeedColors.pending
        case .categorize, .approve, .restore, .setStatus: TransactionFeedColors.inflow
        }
    }
}

private struct TransactionFeedPreview: View {
    var body: some View {
        TransactionFeedView(
            store: .preview,
            isActive: true
        )
        .background(KualiaPalette.transactionsPage)
    }
}

#Preview {
    TransactionFeedPreview()
}

/// One full-height sheet owns the action list, pickers, and notes navigation.
struct TransactionSelectionEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    let feed: TransactionFeedStore
    @State var store: TransactionEditorStore
    let onDuplicate: () -> Void
    let onAction: (TransactionFeedAction) -> Void
    let onSave: (TransactionSelectionEdit) -> Void
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 0) {
                        if let action = feed.selectionSummary.approvalAction {
                            Button {
                                onAction(action)
                            } label: {
                                optionRow(action.title, icon: action.icon)
                            }
                            .accessibilityIdentifier("transaction-selection-approve")
                            optionDivider
                        }
                        if let action = feed.selectionSummary.statusAction {
                            Button {
                                onAction(action)
                            } label: {
                                optionRow(action.title, icon: action.icon)
                            }
                            optionDivider
                        }
                        ForEach(TransactionSelectionField.allCases) { field in
                            NavigationLink(value: field) {
                                optionRow(field.title, icon: field.icon, opensPicker: true)
                            }
                            .disabled(!canEdit(field))
                            .opacity(canEdit(field) ? 1 : 0.4)
                            .accessibilityIdentifier("transaction-selection-\(field.rawValue)")
                            optionDivider
                        }
                        Button(action: onDuplicate) {
                            optionRow(L10n.string("Duplicate"), icon: .copy)
                        }
                        .disabled(!feed.canDuplicateSelection)
                        .opacity(feed.canDuplicateSelection ? 1 : 0.4)
                        .accessibilityHint(L10n.string("Select one transaction to duplicate."))
                        .accessibilityIdentifier("transaction-selection-duplicate")
                    }
                    .background(
                        KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                    Button(role: .destructive) {
                        onAction(.delete)
                    } label: {
                        optionRow(L10n.string("Delete"), icon: .trash, isDestructive: true)
                    }
                    .background(
                        KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20)
                    )
                    .accessibilityIdentifier("transaction-selection-delete")
                }
                .buttonStyle(.kualiaHaptic)
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .fontDesign(.rounded)
            .foregroundStyle(KualiaPalette.ink)
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Edit transactions"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }
                }
            }
            .navigationDestination(for: TransactionSelectionField.self) { field in
                destination(field)
            }
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { await store.reloadChoices() }
        .onDisappear { store.stop() }
        .accessibilityIdentifier("transaction-selection-editor")
    }

    private var optionDivider: some View {
        Rectangle().fill(KualiaPalette.border.opacity(0.45))
            .frame(height: 0.5).padding(.leading, 56)
    }

    private func optionRow(
        _ title: String, icon: KualiaIcon, opensPicker: Bool = false,
        isDestructive: Bool = false
    ) -> some View {
        HStack(spacing: 14) {
            KualiaIconImage(icon: icon, size: 22)
                .foregroundStyle(isDestructive ? KualiaPalette.budgetNegative : KualiaPalette.ink)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            if opensPicker {
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func destination(_ field: TransactionSelectionField) -> some View {
        if field == .notes {
            Form {
                TextField(
                    L10n.string("Notes for all selected transactions"), text: $notes,
                    axis: .vertical
                ).lineLimit(3...8)
            }
            .navigationTitle(field.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Save")) { onSave(.init(field: field, value: notes)) }
                }
            }
        } else {
            TransactionEditorPicker(
                title: field.title, choices: choices(for: field), selectedID: nil,
                isEmbedded: true, isLoading: store.isLoadingChoices,
                errorMessage: store.choicesErrorMessage,
                onRetry: { Task { await store.reloadChoices() } },
                showsCategoryBalances: field == .category,
                focusesSearchOnAppear: field == .merchant || field == .category,
                onSelect: { onSave(.init(field: field, value: $0)) })
        }
    }

    private func canEdit(_ field: TransactionSelectionField) -> Bool {
        switch field {
        case .merchant: feed.selectionSummary.canEditMerchant
        case .account: feed.selectionSummary.canEditAccount
        case .category, .notes: true
        }
    }

    private func choices(for field: TransactionSelectionField) -> [TransactionEditorChoice] {
        switch field {
        case .category: store.categoryPickerChoices
        case .account: store.choices.accounts.map(\.pickerChoice)
        case .merchant: TransactionEditorMerchant.pickerChoices(store.choices.merchants)
        case .notes: []
        }
    }
}
