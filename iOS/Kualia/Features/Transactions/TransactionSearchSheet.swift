import SwiftUI

struct TransactionSearchSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var store: TransactionSearchStore
    let feed: TransactionFeedStore
    var focusesSearchOnAppear = true
    @FocusState private var isFocused: Bool
    @State private var picker: SearchPicker?
    @State private var showsDates = false
    @State private var listWidth: CGFloat = 0
    @State private var activeSwipeRowID: String?
    @State private var categoryEditor: TransactionEditorStore?
    @State private var editor: TransactionEditorStore?
    @State private var savedReceipt: TransactionMutationReceipt?
    @State private var pendingCategorizationID: UUID?

    private enum SearchPicker: String, Identifiable {
        case account, category
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            results
                .background(KualiaPalette.canvas.ignoresSafeArea())
                .navigationTitle(L10n.string("Search transactions"))
                .navigationBarTitleDisplayMode(.inline)
                .searchable(
                    text: $store.filters.text,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: L10n.string("Merchant, account, notes…")
                )
                .searchFocused($isFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit(of: .search) {
                    isFocused = false
                }
                .toolbar {
                    if store.filters.count > 0 {
                        ToolbarItem(placement: .topBarLeading) {
                            Button(L10n.string("Reset filters"), action: store.clearFilters)
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        KualiaCloseButton(placement: .toolbar) { dismiss() }
                    }
                }
        }
        .modifier(TransactionActionFeedback(store: feed, onUndo: { await store.refresh() }))
        .tint(KualiaPalette.accent)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(KualiaPalette.canvas)
        .task {
            store.search(immediately: true)
            store.loadChoices()
            isFocused = focusesSearchOnAppear
        }
        .onChange(of: store.filters.text) { _, value in
            if value.count > 300 { store.filters.text = String(value.prefix(300)) }
        }
        .onChange(of: store.filters) { _, _ in store.search() }
        .onChange(of: store.filters.flow) { _, flow in
            if flow == .transfer { store.filters.reportActivity = false }
        }
        .onChange(of: store.filters.status) { _, status in
            if status == .pending { store.filters.reportActivity = false }
        }
        .onChange(of: feed.mutationReceiptRevision) { _, _ in
            guard let pendingCategorizationID else { return }
            guard let receipt = feed.latestMutationReceipt, receipt.id == pendingCategorizationID
            else {
                self.pendingCategorizationID = nil
                return
            }
            if !receipt.isPending {
                self.pendingCategorizationID = nil
                Task { await store.refresh() }
            }
        }
        .onDisappear { store.stop() }
        .sheet(item: $picker) { picker in
            choiceSheet(picker)
        }
        .sheet(isPresented: $showsDates) {
            TransactionSearchDateSheet(filters: $store.filters, workspace: store.workspace)
        }
        .sheet(
            isPresented: Binding(get: { editor != nil }, set: { if !$0 { editor = nil } }),
            onDismiss: finishEditing
        ) {
            if let editor {
                TransactionEditorView(store: editor, onSaved: { savedReceipt = $0 })
            }
        }
        .sheet(
            isPresented: Binding(
                get: { categoryEditor != nil }, set: { if !$0 { categoryEditor = nil } }),
            onDismiss: finishEditing
        ) {
            if let categoryEditor {
                TransactionFeedCategorySheet(store: categoryEditor) { id, declinesTransfer in
                    let submitted = feed.startCategorizing(
                        editor: categoryEditor, categoryID: id, declinesTransfer: declinesTransfer)
                    if submitted { pendingCategorizationID = feed.latestMutationReceipt?.id }
                    return submitted
                }
            }
        }
    }

    private var filterStrip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                Button {
                    openPicker(.account)
                } label: {
                    filterLabel(
                        accountTitle, symbol: .bank,
                        isSelected: store.filters.accountID != nil)
                }
                .accessibilityLabel(L10n.string("Account filter: \(accountTitle)"))
                Button {
                    openPicker(.category)
                } label: {
                    filterLabel(
                        categoryTitle, symbol: .workspace,
                        isSelected: store.filters.categoryID != nil
                    )
                }
                .accessibilityLabel(L10n.string("Category filter: \(categoryTitle)"))
                if let group = store.filters.group {
                    Menu {
                        Button(L10n.string("All groups")) { store.filters.group = nil }
                    } label: {
                        filterLabel(group.title, symbol: .layers, isSelected: true)
                    }
                }
                if let merchant = store.filters.merchant {
                    Menu {
                        Button(L10n.string("All merchants")) { store.filters.merchant = nil }
                    } label: {
                        filterLabel(merchant.title, symbol: .shop, isSelected: true)
                    }
                }
                Button {
                    isFocused = false
                    showsDates = true
                } label: {
                    filterLabel(
                        dateTitle, symbol: .calendarFilled,
                        isSelected: store.filters.startDate != nil || store.filters.endDate != nil)
                }
                .accessibilityLabel(L10n.string("Date filter: \(dateTitle)"))
                Menu {
                    statusPicker
                } label: {
                    filterLabel(
                        store.filters.status?.title ?? L10n.string("Status"), symbol: .checkCircle,
                        isSelected: store.filters.status != nil)
                }
                Menu {
                    flowPicker
                } label: {
                    filterLabel(
                        store.filters.flow?.title ?? L10n.string("Type"), symbol: .sort,
                        isSelected: store.filters.flow != nil)
                }
                Button {
                    store.filters.hasNotes.toggle()
                } label: {
                    filterLabel(
                        L10n.string("With notes"), symbol: .note, isSelected: store.filters.hasNotes
                    )
                }
                .accessibilityAddTraits(store.filters.hasNotes ? .isSelected : [])
                if store.filters.reportActivity {
                    Button {
                        store.filters.reportActivity = false
                    } label: {
                        filterLabel(
                            L10n.string("Report activity"), symbol: .reports, isSelected: true)
                    }
                    .accessibilityHint(
                        L10n.string("Includes posted inflow and outflow. Tap to show all activity.")
                    )
                }
            }
            .buttonStyle(.kualiaHaptic)
            .padding(.horizontal, 18)
        }
        .scrollIndicators(.hidden)
        .modifier(HorizontalFilterScrollEdges())
        .accessibilityIdentifier("transaction-search-filters")
    }

    private func filterLabel(_ title: String, symbol: KualiaIcon, isSelected: Bool) -> some View {
        Label(title, icon: symbol)
            .foregroundStyle(isSelected ? KualiaPalette.canvas : KualiaPalette.ink)
            .modifier(
                FilterChipStyle(
                    background: isSelected ? KualiaPalette.ink : KualiaPalette.surface,
                    horizontalPadding: 16))
    }

    private var results: some View {
        List {
            filterStrip
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            Section {
                Text(resultTitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("transaction-search-count")
                if !store.filters.isSearching {
                    Text(
                        L10n.string(
                            "Search your full history by name, category, notes, statement, amount or date."
                        )
                    )
                    .font(.caption).foregroundStyle(.secondary)
                }
            }
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)

            TransactionFeedRows(
                sections: visibleSections, workspace: store.workspace, listWidth: listWidth,
                activeSwipeRowID: $activeSwipeRowID,
                onEdit: { entry in
                    isFocused = false
                    editor = feed.makeEditor(for: entry.id)
                },
                onAction: { action, entry in
                    isFocused = false
                    if action == .categorize {
                        categoryEditor = feed.makeEditor(for: entry.id)
                    } else {
                        await feed.perform(
                            action, on: entry, searchWorkspaceID: store.workspace.id)
                        if let pending = feed.transferReviewEditor {
                            editor = pending
                            feed.transferReviewEditor = nil
                        }
                        await store.refresh()
                    }
                })
            footer
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
        .onGeometryChange(for: CGFloat.self) {
            $0.size.width
        } action: {
            listWidth = $0
        }
        .modifier(TransactionFeedListStyle())
        .scrollDismissesKeyboard(.interactively)
        .onScrollPhaseChange { _, phase in
            if phase == .interacting || phase == .decelerating { activeSwipeRowID = nil }
        }
        .kualiaScrollEdges(for: .top)
        .refreshable { await store.refresh() }
    }

    @ViewBuilder private var footer: some View {
        if let error = store.errorMessage {
            TransactionFeedMessageView(
                icon: .wifiOff, title: L10n.string("Search interrupted"),
                message: error, actionTitle: L10n.string("Try again"), action: store.retry
            )
            .padding(.vertical, 28)
        } else if store.isLoading {
            ProgressView(
                store.resultCount == 0
                    ? L10n.string("Searching your transactions…")
                    : L10n.string("Searching older transactions…")
            )
            .font(.subheadline).frame(maxWidth: .infinity).padding(.vertical, 36)
        } else if store.hasLoaded && store.resultCount == 0 {
            TransactionFeedMessageView(
                icon: store.filters.isSearching ? .fileSearch : .category,
                title: store.filters.isSearching
                    ? L10n.string("No matching transactions") : L10n.string("No transactions yet"),
                message: store.filters.isSearching
                    ? L10n.string("Try a shorter search or widen your filters.")
                    : L10n.string("Your transactions will appear here as soon as you add them.")
            )
            .padding(.vertical, 32)
        } else if store.hasMore {
            Button(L10n.string("Load more results"), action: store.loadMore)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 54)
                .onAppear { store.loadMore() }
        } else if store.hasLoaded {
            Text(
                store.filters.isSearching
                    ? L10n.string("All matches shown") : L10n.string("All transactions shown")
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            .frame(maxWidth: .infinity).padding(.vertical, 24)
        }
    }

    private var visibleSections: [TransactionFeedSection] {
        feed.visibleSections(store.sections)
    }

    private var resultTitle: String {
        if !store.hasLoaded { return L10n.string("All history · \(store.workspace.name)") }
        let count = store.resultCount
        return
            L10n.string(
                "\(count)\(store.hasMore ? "+" : "") \(count == 1 && !store.hasMore ? L10n.string("result") : L10n.string("results")) · Newest first"
            )
    }

    private var accountTitle: String {
        store.choices.accounts.first { $0.id == store.filters.accountID }?.title
            ?? L10n.string("Account")
    }
    private var categoryTitle: String {
        if store.filters.categoryID == "uncategorized" { return L10n.string("Uncategorized") }
        if store.filters.categoryID == "ready-to-assign" { return L10n.string("Ready to Assign") }
        return store.choices.categories.first { $0.id == store.filters.categoryID }?.title
            ?? L10n.string("Category")
    }
    private var dateTitle: String {
        guard let start = store.filters.startDate, let end = store.filters.endDate else {
            return L10n.string("All dates")
        }
        return
            "\(PlannedDates.label(start, workspace: store.workspace, format: "MMM d, yy")) – \(PlannedDates.label(end, workspace: store.workspace, format: "MMM d, yy"))"
    }

    private var statusPicker: some View {
        Picker(L10n.string("Status"), selection: $store.filters.status) {
            Text(L10n.string("Any status")).tag(TransactionSearchStatus?.none)
            ForEach(TransactionSearchStatus.allCases) { Text($0.title).tag(Optional($0)) }
        }
    }

    private var flowPicker: some View {
        Picker(L10n.string("Type"), selection: $store.filters.flow) {
            Text(L10n.string("All types")).tag(TransactionSearchFlow?.none)
            ForEach(TransactionSearchFlow.allCases) { Text($0.title).tag(Optional($0)) }
        }
    }

    private func finishEditing() {
        if let savedReceipt {
            feed.publishReceipt(savedReceipt)
            Task { await store.refresh() }
        }
        savedReceipt = nil
    }

    private func openPicker(_ selection: SearchPicker) {
        isFocused = false
        picker = selection
    }

    private func choiceSheet(_ selection: SearchPicker) -> some View {
        let isAccount = selection == .account
        let all = TransactionEditorChoice(
            id: "all",
            title: isAccount ? L10n.string("All accounts") : L10n.string("All categories"),
            symbol: isAccount ? .layers : nil)
        let special = [
            TransactionEditorChoice(
                id: "uncategorized", title: L10n.string("Uncategorized"), symbol: nil),
            TransactionEditorChoice(
                id: "ready-to-assign", title: L10n.string("Ready to Assign"), symbol: nil),
        ]
        return TransactionEditorPicker(
            title: isAccount ? L10n.string("Account") : L10n.string("Category"),
            choices: [all]
                + (isAccount ? store.choices.accounts : special + store.choices.categories),
            selectedID: (isAccount ? store.filters.accountID : store.filters.categoryID) ?? "all",
            isLoading: store.isLoadingChoices,
            errorMessage: store.choicesError, onRetry: store.loadChoices,
            showsCategoryBalances: !isAccount, focusesSearchOnAppear: !isAccount
        ) { id in
            if isAccount {
                store.filters.accountID = id == "all" ? nil : id
            } else {
                store.filters.categoryID = id == "all" ? nil : id
            }
        }
    }
}
