import SwiftUI

struct BudgetCategoryDetailsSheet: View {
    let budget: BudgetStore
    let feed: TransactionFeedStore
    let destination: BudgetCategoryDetailsDestination
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.scenePhase) private var scenePhase
    @State private var nameEditor: BudgetPlanNameEditor?
    @State private var targetEditor: BudgetTargetDestination?
    @State private var transactionEditor: TransactionEditorStore?
    @State private var categoryEditor: TransactionEditorStore?
    @State private var pendingCategorizationID: UUID?
    @State private var activeSwipeRowID: String?
    @State private var listWidth: CGFloat = 0
    @State private var savedReceipt: TransactionMutationReceipt?
    @State private var allTransactions: TransactionSearchStore?
    @State private var selectedMonth: String?
    @State private var didEnterBackground = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title2) private var amountSize = 26.0

    private var transactions: TransactionSearchStore { destination.transactions }
    private var history: BudgetCategoryHistoryStore { destination.history }
    private var workspace: BudgetWorkspace { destination.workspace }
    private var category: BudgetCategory? {
        budget.planGroups.flatMap(\.categories).first { $0.id == destination.categoryID }
    }
    private var row: BudgetCategoryRowModel? {
        budget.groups(for: destination.month).flatMap(\.rows).first {
            $0.id == destination.categoryID
        }
    }
    private var spending: BudgetCategorySpending? {
        transactions.completedItems.flatMap {
            .init(items: $0, month: destination.month, isComplete: true)
        }
    }
    private var monthTitle: String {
        BudgetCategoryMonth.title(
            destination.month,
            currentMonth: BudgetMonth.current(timezoneIdentifier: workspace.timezoneIdentifier),
            locale: locale)
    }

    var body: some View {
        NavigationStack {
            List {
                VStack(alignment: .leading, spacing: 20) {
                    spendingChart
                    fundingCard
                }
                .padding(.horizontal, 24)
                .padding(.top, 10)
                .padding(.bottom, 30)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                transactionList
            }
            .modifier(TransactionFeedListStyle())
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                listWidth = $0
            }
            .onScrollPhaseChange { _, phase in
                if phase == .interacting || phase == .decelerating { activeSwipeRowID = nil }
            }
            .background(KualiaPalette.budgetPage.ignoresSafeArea())
            .scrollIndicators(.hidden)
            .navigationTitle(category?.name ?? L10n.string("Category"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(.automatic, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(category?.name ?? L10n.string("Category"))
                        .font(.headline)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("category-detail-toolbar-identity")
                }
                ToolbarItem(placement: .topBarLeading) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    editCategoryButton
                }
            }
        }
        .modifier(
            TransactionActionFeedback(
                store: feed, background: KualiaPalette.budgetPage,
                onUndo: { await reloadTransactions() })
        )
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.budgetPage)
        .task {
            async let initialTransactions: Void = loadTransactionsIfNeeded()
            async let initialHistory: Void = loadHistoryIfNeeded()
            _ = await (initialTransactions, initialHistory)
        }
        .onChange(of: feed.mutationReceiptRevision) { _, _ in
            guard let pendingCategorizationID,
                let receipt = feed.latestMutationReceipt, receipt.id == pendingCategorizationID
            else { return }
            if !receipt.isPending {
                self.pendingCategorizationID = nil
                refreshTransactions()
            }
        }
        .onDisappear {
            transactions.stop()
            history.stop()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { didEnterBackground = true }
            if phase == .active, didEnterBackground {
                didEnterBackground = false
                Task {
                    async let refreshTransactions: Void = transactions.refreshIfIdle()
                    async let refreshHistory: Void = loadHistoryIfIdle()
                    _ = await (refreshTransactions, refreshHistory)
                }
            }
        }
        .onChange(of: budget.workspace?.id) { _, id in
            if id != workspace.id { dismiss() }
        }
        .onChange(of: category?.id) { _, id in
            if id == nil { dismiss() }
        }
        .sheet(item: $nameEditor) { editor in
            BudgetPlanNameSheet(store: budget, workspaceID: workspace.id, editor: editor)
        }
        .sheet(item: $targetEditor) { destination in
            BudgetTargetView(store: budget, destination: destination)
        }
        .sheet(
            isPresented: Binding(
                get: { transactionEditor != nil },
                set: { if !$0 { transactionEditor = nil } }),
            onDismiss: finishEditing
        ) {
            if let transactionEditor {
                TransactionEditorView(store: transactionEditor) { savedReceipt = $0 }
            }
        }
        .sheet(
            isPresented: Binding(
                get: { categoryEditor != nil }, set: { if !$0 { categoryEditor = nil } })
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
        .sheet(item: $allTransactions, onDismiss: refreshTransactions) { store in
            TransactionSearchSheet(store: store, feed: feed, focusesSearchOnAppear: false)
        }
        .accessibilityIdentifier("budget-category-details")
    }

    private var fundingCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let category, category.type != "credit_card" {
                HStack {
                    Label(L10n.string("Target funding"), icon: .target)
                        .font(.subheadline.weight(.bold))
                    Spacer(minLength: 8)
                    Button {
                        targetEditor = .init(workspace: workspace, category: category)
                    } label: {
                        Text(
                            budget.targets.targets[category.id] == nil
                                ? L10n.string("Set target") : L10n.string("Edit target")
                        )
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(!budget.canEditPlan || !budget.targets.canEdit)
                    .accessibilityIdentifier("category-edit-target")
                }
                if let summary = budget.categoryFundingSummary(
                    categoryID: category.id, month: destination.month)
                {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(
                            L10n.string(
                                "\(money(summary.funded)) of \(money(summary.total)) funded")
                        )
                        .font(.title3.weight(.bold)).monospacedDigit()
                        BudgetFundingTrack(progress: summary.total > 0 ? summary.progress : 0)
                            .frame(height: 24)
                            .accessibilityLabel(L10n.string("Target funding"))
                            .accessibilityValue(L10n.string("\(summary.percentage)% funded"))
                        Text(
                            summary.total == 0
                                ? L10n.string("No target funding needed in \(monthTitle)")
                                : summary.remaining == 0
                                    ? L10n.string("Fully funded")
                                    : L10n.string("\(money(summary.remaining)) left to fund")
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }
                } else {
                    Text(
                        row?.isTargetSnoozed == true
                            ? L10n.string("Target snoozed in \(monthTitle)")
                            : budget.targets.targets[category.id] != nil
                                ? L10n.string(
                                    "Target funding isn't available for \(monthTitle) yet.")
                                : budget.targets.hasLoaded
                                    ? L10n.string(
                                        "Give this category a target to track its funding.")
                                    : L10n.string("Loading target…")
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                }
                if let target = budget.targets.targets[category.id] {
                    Text(target.cadence).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
                if let error = budget.targets.loadError {
                    Text(error).font(.footnote).foregroundStyle(KualiaPalette.budgetNegative)
                    Button(L10n.string("Retry targets"), action: budget.targets.retry)
                        .buttonStyle(.kualiaHaptic)
                }
                Divider()
            }
            if let row {
                let layout =
                    dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
                    : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
                layout {
                    fundingMetric(
                        L10n.string("Assigned in \(monthTitle)"), amount: Decimal(row.assigned))
                    fundingMetric(
                        row.isCreditCard
                            ? L10n.string("Available for payment") : L10n.string("Available"),
                        amount: row.available,
                        color: row.available < 0
                            ? KualiaPalette.budgetNegative : KualiaPalette.budgetPositive)
                }
            }
        }
        .padding(16)
        .background(
            KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(KualiaPalette.border.opacity(0.4), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityIdentifier("category-funding-card")
    }

    private func fundingMetric(_ title: String, amount: Decimal, color: Color = KualiaPalette.ink)
        -> some View
    {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            Text(money(amount)).font(.title3.weight(.bold)).monospacedDigit()
                .foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var editCategoryButton: some View {
        if let category {
            Button {
                nameEditor = .init(kind: .category(id: category.id), name: category.name)
            } label: {
                Label(L10n.string("Edit category"), icon: .pencil)
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(!budget.canEditPlan)
            .accessibilityIdentifier("category-edit-category")
        }
    }

    private var spendingChart: some View {
        Group {
            if let spending, let months = history.months {
                chart(spending, months: months)
            } else if let placeholder = BudgetCategorySpending(
                items: [], month: destination.month, isComplete: true)
            {
                chart(
                    placeholder,
                    months: BudgetCategorySpendingMonth.window(ending: history.month),
                    isPlaceholder: true
                )
                .redacted(reason: .placeholder)
                .allowsHitTesting(false)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(L10n.string("Loading spending for \(monthTitle)…"))
                .overlay {
                    if transactions.errorMessage != nil || history.errorMessage != nil
                        || (transactions.completedItems != nil && spending == nil)
                    {
                        VStack(spacing: 12) {
                            Label(L10n.string("Spending summary unavailable"), icon: .chartLine)
                            Button(L10n.string("Try again"), action: refreshTransactions)
                                .buttonStyle(.kualiaHaptic)
                        }
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(KualiaPalette.budgetPage)
                    }
                }
            }
        }
        .accessibilityIdentifier("category-spending-chart")
    }

    private func chart(
        _ spending: BudgetCategorySpending, months: [BudgetCategorySpendingMonth],
        isPlaceholder: Bool = false
    ) -> some View {
        let points = BudgetCategorySpendingMonth.chartPoints(
            months, selectedMonth: destination.month, selectedMonthSpent: spending.spent)
        let selected = AccountBalancePoint.selected(in: points, month: selectedMonth)
        let displayedMonth =
            selected.map {
                $0.date.formatted(
                    Date.FormatStyle(locale: locale, timeZone: .gmt).month(.wide).year())
            } ?? monthTitle
        let amountLabel =
            row?.isCreditCard == true
            ? L10n.string("Money out") : L10n.string("Spent in \(displayedMonth)")
        return VStack(alignment: .leading, spacing: 8) {
            Text(money(selected?.balance ?? spending.spent))
                .font(.system(size: amountSize, weight: .semibold, design: .rounded))
                .tracking(-0.6)
                .lineLimit(1).minimumScaleFactor(0.4)
                .contentTransition(.numericText())
                .accessibilityLabel(amountLabel)
                .accessibilityValue(money(selected?.balance ?? spending.spent))
            HStack(spacing: 10) {
                Text(amountLabel)
                if row?.isCreditCard == true { Text(displayedMonth) }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(KualiaPalette.mutedInk)
            MonthlyHistoryChart(
                points: points, workspace: transactions.workspace,
                valueLabel: L10n.string("Spending"),
                accessibilityLabel: L10n.string("Monthly category spending over 12 months"),
                selectedMonth: $selectedMonth
            )
            .padding(.horizontal, -24)
            .overlay {
                if isPlaceholder {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(KualiaPalette.border.opacity(0.3))
                }
            }
            if let error = history.errorMessage {
                Text(error).font(.caption).foregroundStyle(KualiaPalette.budgetNegative)
                Button(L10n.string("Try again"), action: refreshTransactions).buttonStyle(
                    .kualiaHaptic)
            }
            if selected == nil, spending.received > 0 {
                Text(L10n.string("\(money(spending.received)) in refunds & money in"))
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            } else if selected == nil, spending.spent == 0, !isPlaceholder {
                Text(L10n.string("No spending in \(monthTitle)"))
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    private var transactionList: some View {
        let categoryAmounts = Dictionary(
            uniqueKeysWithValues: (transactions.completedItems ?? transactions.items).map {
                ($0.id, $0.categoryActivity?.value)
            }
        ).compactMapValues { $0 }
        return Group {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text(L10n.string("Transactions in \(monthTitle)"))
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    Text(
                        "\(transactions.resultCount)\(transactions.completedItems == nil && transactions.hasMore ? "+" : "")"
                    )
                    .font(.subheadline.monospacedDigit()).foregroundStyle(KualiaPalette.mutedInk)
                }
                Button(action: openAllTransactions) {
                    HStack {
                        Text(L10n.string("View All Transactions"))
                        Spacer()
                        KualiaIconImage(icon: .arrowUpRight, size: 18)
                    }
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16).frame(minHeight: 48)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityIdentifier("category-view-all-transactions")
                if let error = transactions.errorMessage {
                    Text(error).font(.subheadline).foregroundStyle(KualiaPalette.budgetNegative)
                    Button(L10n.string("Try again"), action: transactions.retry).buttonStyle(
                        .kualiaHaptic)
                }
                if transactions.completedItems?.isEmpty == true
                    || (transactions.hasLoaded && transactions.resultCount == 0
                        && !transactions.hasMore)
                {
                    Text(
                        L10n.string(
                            "Nothing here yet. Transactions in this category will appear here.")
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    .padding(.vertical, 16)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            TransactionFeedRows(
                sections: feed.visibleSections(transactions.sections),
                workspace: transactions.workspace, listWidth: listWidth,
                categoryAmounts: categoryAmounts, activeSwipeRowID: $activeSwipeRowID,
                onEdit: { transactionEditor = feed.makeEditor(for: $0.id) },
                onAction: { action, entry in
                    if action == .categorize {
                        categoryEditor = feed.makeEditor(for: entry.id)
                    } else {
                        await feed.perform(action, on: entry, searchWorkspaceID: workspace.id)
                        if let pending = feed.transferReviewEditor {
                            transactionEditor = pending
                            feed.transferReviewEditor = nil
                        }
                        await reloadTransactions()
                    }
                })
            if transactions.isLoading, transactions.completedItems == nil {
                Text(L10n.string("Loading transactions…"))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
        }
    }

    private func openAllTransactions() {
        guard feed.workspace?.id == workspace.id else { return }
        allTransactions = feed.makeSearchStore(filters: .init(categoryID: destination.categoryID))
    }

    private func finishEditing() {
        if let receipt = savedReceipt, receipt.workspace.id == workspace.id {
            feed.publishReceipt(receipt)
        }
        savedReceipt = nil
        refreshTransactions()
    }

    private func loadTransactionsIfNeeded() async {
        if transactions.completedItems == nil { await transactions.refreshIfIdle() }
    }

    private func loadHistoryIfNeeded() async {
        if history.months == nil { await loadHistoryIfIdle() }
    }

    private func loadHistoryIfIdle() async {
        if !history.isLoading { await history.refresh() }
    }

    private func refreshTransactions() {
        Task { await reloadTransactions() }
    }

    private func reloadTransactions() async {
        async let refreshTransactions: Void = transactions.refresh()
        async let refreshHistory: Void = history.refresh()
        _ = await (refreshTransactions, refreshHistory)
    }

    private func money(_ amount: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: amount, currencyCode: workspace.currencyCode,
            minorUnit: workspace.minorUnit, showsPositiveSign: false,
            usesAbsoluteValue: false, locale: locale)
    }

}
