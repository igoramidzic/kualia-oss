import Charts
import SwiftUI

struct AccountsView: View {
    @Environment(\.homeControlDock) private var dock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let store: AccountsStore
    let onSelectAccount: (String) -> Void
    var onAccountCreated: (TransactionMutationReceipt) -> Void = { _ in }
    var isActive = true
    var scrollToTopRequest = 0
    var creationRequest = 0
    @State private var scrollPosition = ScrollPosition()
    @State private var pendingCreationReceipt: TransactionMutationReceipt?
    @State private var categoryFilter = AccountCategoryFilter()
    @State private var showsClosed = false
    @State private var showsCreation = false
    @State private var reconciliation: AccountReconciliationStore?

    private var visibleAccounts: [AccountSnapshot] {
        store.activeAccounts.filter { categoryFilter.includes($0.category) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if !store.hasLoaded {
                    if let error = store.errorMessage {
                        AccountMessage(
                            title: L10n.string("Couldn't load accounts"), message: error,
                            retry: store.retry)
                    } else {
                        ProgressView(L10n.string("Loading accounts…"))
                            .frame(maxWidth: .infinity, minHeight: 260)
                    }
                } else if store.workspace == nil {
                    AccountMessage(
                        title: L10n.string("Your money, together"),
                        message: L10n.string("Choose a workspace to see your accounts."))
                } else if store.accounts.isEmpty {
                    emptyAccounts
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        if dock == nil { filters }
                        AccountBalanceChart(
                            points: store.balanceHistory(
                                accountIDs: Set(visibleAccounts.map(\.id)),
                                timelineAccountIDs: Set(store.activeAccounts.map(\.id))),
                            currentBalance: visibleAccounts.reduce(Decimal.zero) {
                                $0 + Decimal($1.currentBalance)
                            },
                            workspace: store.workspace,
                            isLoading: store.isLoadingHistory,
                            error: store.historyErrorMessage,
                            onRetry: store.retry,
                            resetRequest: scrollToTopRequest
                        )
                    }
                    accountsSection
                    if !store.closedAccounts.isEmpty { closedAccounts }
                    if let error = store.errorMessage {
                        AccountMessage(
                            title: L10n.string("Accounts couldn't refresh"), message: error,
                            retry: store.retry)
                    }
                }
                if store.hasLoaded, store.workspace != nil {
                    addAccountButton
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 10)
            .padding(.bottom, 120)
        }
        .scrollPosition($scrollPosition)
        .onChange(of: scrollToTopRequest) { _, _ in
            guard isActive else { return }
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                scrollPosition.scrollTo(edge: .top)
            }
        }
        .onChange(of: creationRequest) { _, _ in
            guard isActive, store.hasLoaded, store.workspace != nil, !store.isSaving else { return }
            showsCreation = true
        }
        .modifier(HomeGlowScrollObserver())
        .scrollIndicators(.hidden)
        .onChange(of: store.workspace?.id) { _, _ in
            categoryFilter = AccountCategoryFilter()
            showsClosed = false
            showsCreation = false
            pendingCreationReceipt = nil
            reconciliation = nil
        }
        .onChange(of: store.availableCategories) { _, categories in
            categoryFilter.reconcile(availableCategories: categories)
        }
        .sheet(
            isPresented: $showsCreation,
            onDismiss: {
                guard let receipt = pendingCreationReceipt else { return }
                pendingCreationReceipt = nil
                guard receipt.workspace.id == store.workspace?.id else { return }
                categoryFilter = AccountCategoryFilter()
                onAccountCreated(receipt)
            }
        ) {
            AccountSetupView(
                store: store,
                onSaved: {
                    pendingCreationReceipt = store.latestCreationReceipt
                })
        }
        .sheet(
            isPresented: Binding(
                get: { reconciliation != nil },
                set: {
                    if !$0 {
                        reconciliation = nil
                    }
                })
        ) {
            if let reconciliation {
                AccountReconciliationView(store: reconciliation)
            }
        }
        .homeDockFilters {
            if store.hasLoaded && !store.accounts.isEmpty {
                accountFilterButtons
            }
        }
        .accessibilityIdentifier("accounts.page")
    }

    private var filters: some View {
        ScrollView(.horizontal) {
            accountFilterButtons
        }
        .scrollIndicators(.hidden)
        .modifier(HorizontalFilterScrollEdges(horizontalInset: 18))
        .padding(.horizontal, -6)
    }

    private var accountFilterButtons: some View {
        HomeFilterOptions {
            filter(title: L10n.string("All"), category: nil)
            ForEach(store.availableCategories) { category in
                filter(title: category.title, category: category)
            }
        }
        .sensoryFeedback(.selection, trigger: categoryFilter.isSelectingMultiple)
    }

    private func filter(title: String, category: AccountCategory?) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
                categoryFilter.select(category)
            }
        } label: {
            HomeFilterLabel(title)
                .foregroundStyle(
                    categoryFilter.isSelected(category) ? KualiaPalette.canvas : KualiaPalette.ink
                )
                .modifier(
                    FilterChipStyle(
                        background: categoryFilter.isSelected(category)
                            ? KualiaPalette.ink : KualiaPalette.surface))
        }
        .buttonStyle(.kualiaHaptic)
        .highPriorityGesture(
            LongPressGesture(minimumDuration: 0.45).onEnded { _ in
                if let category { beginMultipleSelection(with: category) }
            }, including: category != nil && !categoryFilter.isSelectingMultiple ? .all : .none
        )
        .accessibilityActions {
            if let category, !categoryFilter.isSelectingMultiple {
                Button(L10n.string("Select multiple filters")) {
                    beginMultipleSelection(with: category)
                }
            }
        }
        .accessibilityAddTraits(categoryFilter.isSelected(category) ? .isSelected : [])
    }

    private func beginMultipleSelection(with category: AccountCategory) {
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
            categoryFilter.beginMultipleSelection(with: category)
        }
    }

    private var accountsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            if visibleAccounts.isEmpty {
                Text(L10n.string("No accounts of this type yet."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    .padding(.vertical, 12)
            }
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(store.accountOrdering.sections(accounts: visibleAccounts)) { section in
                    accountGroup(section)
                }
            }
            .padding(.horizontal, -12)
        }
        .foregroundStyle(KualiaPalette.ink)
    }

    private func accountGroup(_ section: AccountListSection) -> some View {
        let isCollapsed = store.collapsedCategoryIDs.contains(section.category.id)
        return VStack(spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
                    store.toggleAccountGroup(section.category)
                }
            } label: {
                accountGroupHeader(section, isCollapsed: isCollapsed)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .frame(minHeight: 44)
                    .background(KualiaPalette.border.opacity(0.12))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityLabel(section.category.title)
            .accessibilityValue(
                "\(isCollapsed ? L10n.string("Collapsed") : L10n.string("Expanded")), \(AccountMoney.string(section.totalBalance, workspace: store.workspace))"
            )
            .accessibilityIdentifier("accounts-group-\(section.category.id)")

            BudgetDisclosure(isExpanded: !isCollapsed) {
                ForEach(section.accounts) { account in
                    accountRow(
                        account, horizontalInset: 14,
                        showsDivider: account.id != section.accounts.last?.id)
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

    private func accountGroupHeader(
        _ section: AccountListSection, isCollapsed: Bool
    ) -> some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .font(.caption.weight(.bold))
                    .rotationEffect(.degrees(isCollapsed ? 0 : 90))
                    .frame(width: 10)
                Text(section.category.title)
                    .font(.subheadline.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 3) {
                Text(L10n.string("Balance"))
                    .font(.caption2.weight(.semibold))
                Text(AccountMoney.string(section.totalBalance, workspace: store.workspace))
                    .font(.subheadline.weight(.medium).monospacedDigit())
                    .contentTransition(
                        reduceMotion
                            ? .identity
                            : .numericText(
                                value: NSDecimalNumber(decimal: section.totalBalance).doubleValue)
                    )
            }
            .foregroundStyle(KualiaPalette.mutedInk)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(
                width: dynamicTypeSize.isAccessibilitySize ? nil : 112,
                alignment: .trailing
            )
            .frame(
                maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : nil,
                alignment: .trailing)
        }
    }

    private func accountRow(
        _ account: AccountSnapshot, horizontalInset: CGFloat = 0, showsDivider: Bool = true
    ) -> some View {
        Button {
            onSelectAccount(account.id)
        } label: {
            HStack(spacing: 8) {
                AccountBrandMark(
                    logoURL: account.resolvedLogoUrl, name: account.name,
                    accountType: account.accountType, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.name).font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(KualiaPalette.ink)
                    if account.isClosed {
                        Text(L10n.string("Closed"))
                            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                Spacer(minLength: 8)
                Text(
                    AccountMoney.string(Decimal(account.currentBalance), workspace: store.workspace)
                )
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(KualiaPalette.ink)
                .lineLimit(1).minimumScaleFactor(0.65)
                KualiaIconImage(icon: .chevronRight, size: 10)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
            .padding(.horizontal, horizontalInset)
            .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? 16 : 12)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityHint(L10n.string("Open account details"))
        .contextMenu {
            if !account.isClosed {
                Button(L10n.string("Reconcile account"), icon: .checkCircle) {
                    reconciliation = store.makeReconciliationStore(accountID: account.id)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle().fill(KualiaPalette.border.opacity(0.55)).frame(height: 0.5)
                    .padding(.horizontal, horizontalInset)
            }
        }
    }

    private var closedAccounts: some View {
        VStack(spacing: 4) {
            Button {
                withAnimation(reduceMotion ? nil : .smooth) { showsClosed.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Label(L10n.string("Closed accounts"), icon: .archive)
                    Text(store.closedAccounts.count, format: .number)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityValue(showsClosed ? L10n.string("Expanded") : L10n.string("Collapsed"))
            if showsClosed { ForEach(store.closedAccounts) { accountRow($0) } }
        }
    }

    private var addAccountButton: some View {
        Button {
            showsCreation = true
        } label: {
            Label(L10n.string("Add Account"), icon: .plus)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(KualiaPalette.ink)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(KualiaPalette.surface, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(store.isSaving)
        .accessibilityIdentifier("accounts.addAccount")
    }

    private var emptyAccounts: some View {
        VStack(alignment: .leading, spacing: 22) {
            AccountBrandMark(
                logoURL: nil, name: L10n.string("Accounts"), accountType: "banking_checking",
                size: 76)
            Text(L10n.string("Give your money\na place to land."))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(KualiaPalette.ink)
            Text(
                L10n.string(
                    "Connect your bank for automatic updates, or add a manual account and make it your own."
                )
            )
            .font(.body).foregroundStyle(KualiaPalette.mutedInk)
        }
        .padding(.vertical, 48)
    }
}

struct AccountBalanceChart: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .title2) private var amountSize = 26.0
    let points: [AccountBalancePoint]
    let currentBalance: Decimal
    let workspace: TransactionFeedWorkspace?
    var isLoading = false
    var error: String?
    var onRetry: () -> Void = {}
    var resetRequest = 0
    @State private var selectedMonth: String?
    private var showsHistory: Bool { points.count > 1 }

    private var selectedPoint: AccountBalancePoint? {
        guard showsHistory else { return nil }
        return AccountBalancePoint.selected(in: points, month: selectedMonth)
    }

    private var displayedBalance: Decimal {
        selectedPoint?.balance ?? currentBalance
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(
                AccountMoney.string(displayedBalance, workspace: workspace)
            )
            .font(.system(size: amountSize, weight: .semibold, design: .rounded))
            .tracking(-0.6)
            .foregroundStyle(KualiaPalette.ink)
            .lineLimit(1).minimumScaleFactor(0.4)
            .contentTransition(.numericText())
            .accessibilityLabel(L10n.string("Balance"))
            .accessibilityValue(
                AccountMoney.string(displayedBalance, workspace: workspace)
            )
            .accessibilityIdentifier("accounts.totalBalance")
            if showsHistory, error == nil, let summaryPoint = selectedPoint ?? points.last {
                monthlyChange(summaryPoint)
            }
            if isLoading, points.isEmpty {
                ProgressView(L10n.string("Loading balance history…"))
                    .frame(maxWidth: .infinity, minHeight: 150)
            } else if let error {
                AccountMessage(
                    title: L10n.string("History unavailable"), message: error, retry: onRetry)
            } else if points.isEmpty {
                Text(L10n.string("Your balance story starts here"))
                    .font(.system(.subheadline, weight: .semibold))
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .frame(maxWidth: .infinity, minHeight: 150, alignment: .leading)
            } else if showsHistory {
                MonthlyHistoryChart(
                    points: points, workspace: workspace,
                    valueLabel: L10n.string("Balance"),
                    accessibilityLabel: L10n.string("Monthly balance history"),
                    selectedMonth: $selectedMonth, resetRequest: resetRequest
                )
                .padding(.horizontal, -24)
            }
        }
        .onChange(of: workspace?.id) { _, _ in resetChart() }
        .onChange(of: resetRequest) { _, _ in
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { resetChart() }
        }
    }

    private func monthlyChange(_ point: AccountBalancePoint) -> some View {
        let change = point.changeFromPreviousMonth(in: points)
        let color =
            change > 0
            ? KualiaPalette.budgetPositive
            : change < 0 ? KualiaPalette.budgetNegative : KualiaPalette.mutedInk
        return HStack(spacing: 10) {
            HStack(spacing: 4) {
                if change != 0 {
                    KualiaIconImage(icon: change > 0 ? .arrowUpRight : .arrowDownLeft, size: 16)
                        .accessibilityHidden(true)
                }
                Text(AccountMoney.string(change, workspace: workspace, signed: true))
                    .monospacedDigit()
            }
            .foregroundStyle(color)
            Text(point.date.formatted(.dateTime.month(.abbreviated).year().locale(L10n.locale)))
                .foregroundStyle(KualiaPalette.mutedInk)
        }
        .font(.subheadline.weight(.medium))
        .accessibilityElement(children: .combine)
    }

    private func resetChart() {
        selectedMonth = nil
    }
}

/// Shared by account balances and category spending so both use the same bars and selection.
struct MonthlyHistoryChart: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .caption) private var monthWidth = AccountBalanceChartLayout
        .defaultMonthWidth
    let points: [AccountBalancePoint]
    let workspace: TransactionFeedWorkspace?
    let valueLabel: String
    let accessibilityLabel: String
    @Binding var selectedMonth: String?
    var resetRequest = 0
    @State private var chartScrollPosition = ScrollPosition()
    @State private var hasUserScrolled = false
    @State private var visibleIndices: Range<Int>?

    private var selectedPoint: AccountBalancePoint? {
        AccountBalancePoint.selected(in: points, month: selectedMonth)
    }

    private func chartAmount(_ point: AccountBalancePoint) -> Double {
        point.chartValue / pow(10, Double(workspace?.minorUnit ?? 2))
    }

    var body: some View {
        scrollableChart
            .onChange(of: workspace?.id) { _, _ in resetChart() }
            .onChange(of: resetRequest) { _, _ in
                withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { resetChart() }
            }
    }

    private func resetChart() {
        selectedMonth = nil
        visibleIndices = nil
        hasUserScrolled = false
        chartScrollPosition.scrollTo(edge: .trailing)
    }

    private var scrollableChart: some View {
        GeometryReader { geometry in
            let layout = AccountBalanceChartLayout(
                monthCount: points.count, monthWidth: monthWidth,
                viewportWidth: geometry.size.width)
            let initialIndices = AccountBalanceChartScale.visibleIndices(
                count: points.count, monthWidth: monthWidth,
                chartMinX: layout.initialChartMinX,
                viewportWidth: geometry.size.width)
            let indices =
                visibleIndices.flatMap {
                    $0.overlaps(points.indices) ? $0 : nil
                } ?? initialIndices
            let domain = AccountBalanceChartScale.barDomain(
                balances: points.map(\.balance), visibleIndices: indices,
                minorUnit: workspace?.minorUnit ?? 2)
            ScrollView(.horizontal) {
                chart(layout: layout, domain: domain)
                    .frame(width: layout.chartWidth, height: geometry.size.height)
                    .onGeometryChange(for: Range<Int>.self) { chartGeometry in
                        AccountBalanceChartScale.visibleIndices(
                            count: points.count, monthWidth: monthWidth,
                            chartMinX: chartGeometry.frame(in: .scrollView(axis: .horizontal)).minX,
                            viewportWidth: geometry.size.width)
                    } action: {
                        visibleIndices = $0
                    }
                    .frame(width: layout.contentWidth, alignment: .trailing)
                    .padding(.horizontal, layout.horizontalInset)
            }
            .scrollPosition($chartScrollPosition)
            .defaultScrollAnchor(.trailing)
            .defaultScrollAnchor(hasUserScrolled ? nil : .trailing, for: .sizeChanges)
            .scrollIndicators(.hidden)
            .frame(width: geometry.size.width, height: geometry.size.height)
            .onScrollPhaseChange { _, phase in
                if phase == .tracking || phase == .interacting { hasUserScrolled = true }
            }
        }
        .frame(height: 144)
        .padding(.top, 10)
    }

    private func chart(layout: AccountBalanceChartLayout, domain: ClosedRange<Double>) -> some View
    {
        Chart(points) { point in
            BarMark(
                x: .value(L10n.string("Month"), point.id),
                y: .value(valueLabel, chartAmount(point)),
                width: .fixed(layout.barWidth)
            )
            .cornerRadius(4)
            .foregroundStyle(
                KualiaPalette.ink.opacity(
                    selectedPoint == nil || point.id == selectedPoint?.id ? 0.85 : 0.22)
            )
            .accessibilityLabel(
                point.date.formatted(
                    Date.FormatStyle(locale: L10n.locale, timeZone: .gmt).month(.wide).year())
            )
            .accessibilityValue(AccountMoney.string(point.balance, workspace: workspace))
        }
        .chartXScale(
            domain: points.map(\.id),
            range: .plotDimension(startPadding: 0, endPadding: 0)
        )
        .chartYScale(domain: domain)
        .chartPlotStyle { plot in plot.clipped() }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: domain)
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: points.map(\.id)) { value in
                if let month = value.as(String.self),
                    let point = points.first(where: { $0.id == month })
                {
                    AxisValueLabel(centered: true, anchor: .top) {
                        Text(
                            point.date.formatted(
                                Date.FormatStyle(locale: L10n.locale, timeZone: .gmt)
                                    .month(.abbreviated))
                        )
                        .font(.caption2)
                        .foregroundStyle(
                            point.id == selectedPoint?.id
                                ? KualiaPalette.ink : KualiaPalette.mutedInk)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onTapGesture { location in
                        guard let plotFrame = proxy.plotFrame else { return }
                        let plot = geometry[plotFrame]
                        let x = location.x - plot.minX
                        guard (0...plot.width).contains(x),
                            let month = proxy.value(atX: x, as: String.self),
                            let point = points.first(where: { $0.id == month })
                        else { return }
                        selectedMonth = point.toggledSelection(from: selectedMonth)
                    }
                    .accessibilityHidden(true)
            }
        }
        .sensoryFeedback(.selection, trigger: selectedMonth)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(
            selectedPoint.map {
                $0.date.formatted(
                    Date.FormatStyle(locale: L10n.locale, timeZone: .gmt).month(.wide).year())
            } ?? ""
        )
        .accessibilityAdjustableAction { direction in
            guard !points.isEmpty else { return }
            let index = points.firstIndex(where: { $0.id == selectedPoint?.id }) ?? points.count
            let nextIndex: Int
            switch direction {
            case .increment: nextIndex = min(index + 1, points.count - 1)
            case .decrement: nextIndex = max(index - 1, 0)
            @unknown default: return
            }
            selectedMonth = points[nextIndex].id
            hasUserScrolled = true
            chartScrollPosition.scrollTo(x: layout.scrollOffset(forMonthAt: nextIndex))
        }
    }
}

enum AccountMoney {
    static func string(
        _ amount: Decimal, workspace: TransactionFeedWorkspace?, signed: Bool = false
    ) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: amount, currencyCode: workspace?.currencyCode ?? "USD",
            minorUnit: workspace?.minorUnit ?? 2, showsPositiveSign: signed,
            usesAbsoluteValue: false)
    }
}

struct AccountMessage: View {
    let title: String
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(.headline, design: .rounded)).foregroundStyle(
                KualiaPalette.ink)
            Text(message).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            if let retry { Button(L10n.string("Try again"), action: retry).buttonStyle(.bordered) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 20)
    }
}
