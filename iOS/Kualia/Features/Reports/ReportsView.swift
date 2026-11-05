import Charts
import SwiftUI

struct ReportsView: View {
    @Bindable var store: ReportsStore
    let feed: TransactionFeedStore
    let isActive: Bool
    @State private var search: TransactionSearchStore?
    @ScaledMetric(relativeTo: .title2) private var amountFontSize: CGFloat = 26

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if store.hasLoaded, let error = store.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(L10n.string("Showing your last report. \(error)"))
                        Button(L10n.string("Try again"), action: store.reload)
                    }.font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
                if let error = store.errorMessage, !store.hasLoaded {
                    ContentUnavailableView {
                        Label(L10n.string("Report couldn't load"), icon: .reports)
                    } description: {
                        Text(error)
                    } actions: {
                        Button(L10n.string("Try again"), action: store.reload)
                    }
                } else if !store.hasLoaded {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text(L10n.string("Finding the whole picture")).font(.headline)
                        Text(L10n.string("Loading your report history…"))
                            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }.frame(maxWidth: .infinity, minHeight: 290)
                } else {
                    summary
                    ReportRhythmChart(store: store)
                    ReportBreakdownSection(
                        store: store, kind: .moneyIn, grouping: $store.inflowGrouping,
                        onOpenTransactions: openTransactions)
                    ReportBreakdownSection(
                        store: store, kind: .spending, grouping: $store.outflowGrouping,
                        onOpenTransactions: openTransactions)
                    methodology
                }
            }
            .padding(.horizontal, 24).padding(.top, 14).padding(.bottom, 30)
        }
        .refreshable { await store.refresh() }
        .scrollIndicators(.hidden)
        .modifier(HomeGlowScrollObserver())
        .modifier(HomeScrollSurface(showsBottomToolbar: true))
        .onChange(of: isActive) { _, active in
            if !active {
                search = nil
            }
        }
        .onChange(of: store.context?.id) { _, _ in search = nil }
        .sheet(item: $search) { search in
            TransactionSearchSheet(store: search, feed: feed, focusesSearchOnAppear: false)
        }
        .accessibilityIdentifier("reports.page")
    }

    private func openTransactions(_ filters: TransactionSearchFilters) {
        guard let workspaceID = store.context?.id, feed.workspace?.id == workspaceID else { return }
        search = feed.makeSearchStore(filters: filters)
    }

    private var summary: some View {
        let net = store.analysis.totals.net
        return VStack(alignment: .leading, spacing: 4) {
            Text(store.money(net))
                .font(.system(size: amountFontSize, weight: .semibold, design: .rounded))
                .tracking(-0.6).minimumScaleFactor(0.4).lineLimit(1)
                .foregroundStyle(KualiaPalette.ink)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    net == 0
                        ? L10n.string("Cash flow")
                        : net > 0 ? L10n.string("Net inflow") : L10n.string("Net outflow")
                )
                .accessibilityValue(store.money(net))
            HStack(spacing: 16) {
                flowTotal(.moneyIn)
                flowTotal(.spending)
            }
        }.foregroundStyle(KualiaPalette.ink)
    }

    private func flowTotal(_ kind: ReportKind) -> some View {
        let value = store.money(store.analysis.totals.value(for: kind))
        return HStack(spacing: 5) {
            KualiaIconImage(icon: kind == .moneyIn ? .arrowUpRight : .arrowDownRight, size: 16)
                .foregroundStyle(
                    kind == .moneyIn ? KualiaPalette.budgetPositive : KualiaPalette.budgetNegative
                )
                .accessibilityHidden(true)
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(kind == .moneyIn ? L10n.string("Inflow") : L10n.string("Outflow"))
        .accessibilityValue(value)
    }
    private var methodology: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.string("The details behind the numbers")).font(.caption.weight(.semibold))
            Text(
                L10n.string(
                    "The top amount is inflow minus outflow for the selected months. Green bars show money in, including refunds; red bars show money out. The curve shows the difference for each month."
                )
            )
            .font(.caption).fixedSize(horizontal: false, vertical: true)
            Text(
                L10n.string(
                    "View inflow and outflow by category, merchant or group. Tap a row to see matching transactions. Each section's largest row fills the bar; percentages show each row's share of that section's total."
                )
            )
            .font(.caption).fixedSize(horizontal: false, vertical: true)
            Text(
                L10n.string(
                    "Split transactions contribute to their categories and groups. Pending transactions, transfers, starting balances and balance adjustments are excluded."
                )
            )
            .font(.caption).fixedSize(horizontal: false, vertical: true)
            if let updated = store.updatedAt {
                Text(
                    L10n.string(
                        "Updated \(updated.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: L10n.locale)))"
                    )
                )
                .font(.caption)
            }
        }.foregroundStyle(KualiaPalette.mutedInk)
    }
}

private struct ReportBreakdownSection: View {
    let store: ReportsStore
    let kind: ReportKind
    @Binding var grouping: ReportGrouping
    let onOpenTransactions: (TransactionSearchFilters) -> Void
    private var report: ReportAnalysis { kind == .moneyIn ? store.inflow : store.outflow }
    private var rows: [ReportRank] {
        switch grouping {
        case .categories: report.categories
        case .merchants: report.merchants
        case .groups: report.groups
        }
    }
    var body: some View {
        LazyVStack(alignment: .leading, spacing: 18) {
            Text(kind == .moneyIn ? L10n.string("Inflow") : L10n.string("Outflow"))
                .font(.system(.title3, design: .rounded, weight: .bold))
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(ReportGrouping.allCases) { option in
                        Button {
                            grouping = option
                        } label: {
                            HomeFilterLabel(option.title)
                                .foregroundStyle(
                                    grouping == option ? KualiaPalette.canvas : KualiaPalette.ink
                                )
                                .modifier(
                                    FilterChipStyle(
                                        background: grouping == option
                                            ? KualiaPalette.ink : KualiaPalette.surface,
                                        horizontalPadding: 16))
                        }.buttonStyle(.kualiaHaptic)
                            .accessibilityAddTraits(grouping == option ? .isSelected : [])
                    }
                }
            }.scrollIndicators(.hidden)
                .modifier(HorizontalFilterScrollEdges(horizontalInset: 24))
            if rows.isEmpty {
                Text(
                    kind == .moneyIn
                        ? L10n.string("No inflow in these months.")
                        : L10n.string("No outflow in these months.")
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            LazyVStack(spacing: 0) {
                ForEach(rows) { row in
                    Button {
                        onOpenTransactions(
                            .report(row: row, grouping: grouping, kind: kind, range: store.range))
                    } label: {
                        ReportRankRow(
                            row: row, maximum: rows.first?.amount ?? 0,
                            total: report.totals.value(for: kind), money: store.money,
                            isMerchant: grouping == .merchants,
                            tint: kind == .moneyIn
                                ? KualiaPalette.reportInflow : KualiaPalette.reportOutflow)
                    }.buttonStyle(.kualiaHaptic)
                        .accessibilityHint(
                            L10n.string("Opens matching transactions"))
                }
            }.padding(.leading, -24)
        }.foregroundStyle(KualiaPalette.ink)
    }
}

struct ReportRhythmChart: View {
    @Bindable var store: ReportsStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .caption) private var monthWidth = AccountBalanceChartLayout
        .defaultMonthWidth
    @State private var scrollPosition = ScrollPosition()
    @State private var visibleIndices: Range<Int>?
    private func amount(_ value: Decimal) -> Double {
        NSDecimalNumber(decimal: value).doubleValue / pow(10, Double(store.context?.minorUnit ?? 2))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geometry in
                let layout = AccountBalanceChartLayout(
                    monthCount: store.months.count, monthWidth: monthWidth,
                    viewportWidth: geometry.size.width)
                let initial = AccountBalanceChartScale.visibleIndices(
                    count: store.months.count, monthWidth: monthWidth,
                    chartMinX: layout.initialChartMinX, viewportWidth: geometry.size.width)
                let indices = visibleIndices ?? initial
                let visible = store.months.enumerated().filter { indices.contains($0.offset) }.map(
                    \.element)
                let low = min(-1, -amount(visible.map { $0.totals.outflow }.max() ?? 0) * 1.1)
                let high = max(1, amount(visible.map { $0.totals.inflow }.max() ?? 0) * 1.1)
                ScrollView(.horizontal) {
                    chart(
                        months: store.chartMonths, barWidth: layout.barWidth,
                        domain: low...high
                    )
                    .frame(width: layout.chartWidth, height: geometry.size.height)
                    .onGeometryChange(for: Range<Int>.self) { frame in
                        AccountBalanceChartScale.visibleIndices(
                            count: store.months.count, monthWidth: monthWidth,
                            chartMinX: frame.frame(in: .scrollView(axis: .horizontal)).minX,
                            viewportWidth: geometry.size.width)
                    } action: {
                        visibleIndices = $0
                    }
                    .frame(width: layout.contentWidth, alignment: .trailing)
                    .padding(.horizontal, layout.horizontalInset)
                }
                .scrollPosition($scrollPosition)
                .defaultScrollAnchor(.trailing)
                .scrollIndicators(.hidden)
                .onChange(of: store.rangeRevision) { _, _ in
                    let range = store.range
                    if let index = store.months.firstIndex(where: {
                        $0.id == ReportDates.monthStart(range.end)
                    }) {
                        withAnimation(reduceMotion ? nil : .smooth(duration: 0.25)) {
                            scrollPosition.scrollTo(x: layout.scrollOffset(forMonthAt: index))
                        }
                    }
                }
                .accessibilityAdjustableAction { direction in
                    let index =
                        store.months.firstIndex(where: {
                            $0.id == ReportDates.monthStart(store.range.end)
                        }) ?? 0
                    let next: Int
                    switch direction {
                    case .increment: next = min(index + 1, store.months.count - 1)
                    case .decrement: next = max(0, index - 1)
                    @unknown default: return
                    }
                    if store.months.indices.contains(next) {
                        store.selectMonth(store.months[next].id)
                    }
                }
            }.frame(height: 200).padding(.horizontal, -24)
        }
        .onChange(of: store.context?.id) { _, _ in
            visibleIndices = nil
            scrollPosition.scrollTo(edge: .trailing)
        }
    }
    private func chart(
        months: [ReportChartMonth], barWidth: Double,
        domain: ClosedRange<Double>
    ) -> some View {
        Chart {
            RuleMark(y: .value(L10n.string("Break even"), 0.0))
                .foregroundStyle(KualiaPalette.border)
            ForEach(months) { point in
                let month = point.bucket
                BarMark(
                    x: .value(L10n.string("Month"), month.id),
                    yStart: .value(L10n.string("Outflow"), -amount(month.totals.outflow)),
                    yEnd: .value(L10n.string("Inflow"), amount(month.totals.inflow)),
                    width: .fixed(barWidth)
                )
                .cornerRadius(4)
                .foregroundStyle(
                    LinearGradient(
                        stops: [
                            .init(color: KualiaPalette.reportInflow, location: 0),
                            .init(color: KualiaPalette.reportInflow, location: point.zeroPosition),
                            .init(color: KualiaPalette.reportOutflow, location: point.zeroPosition),
                            .init(color: KualiaPalette.reportOutflow, location: 1),
                        ], startPoint: .top, endPoint: .bottom)
                )
                .alignsMarkStylesWithPlotArea(false)
                .opacity(point.isSelected ? 1 : 0.4)
                .accessibilityLabel(ReportDates.monthLabel(month.id))
                .accessibilityValue(
                    L10n.string(
                        "Inflow: \(store.money(month.totals.inflow)). Outflow: \(store.money(month.totals.outflow))."
                    )
                )
            }
            ForEach(months.map(\.bucket)) { month in
                LineMark(
                    x: .value(L10n.string("Month"), month.id),
                    y: .value(L10n.string("Cash flow"), amount(month.totals.net))
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(KualiaPalette.ink.opacity(0.85))
                .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                .accessibilityLabel(
                    ReportDates.monthLabel(month.id) + ", " + L10n.string("Cash flow")
                )
                .accessibilityValue(store.money(month.totals.net))
            }
        }
        .chartXScale(
            domain: store.months.map(\.id), range: .plotDimension(startPadding: 0, endPadding: 0)
        )
        .chartYScale(domain: domain)
        .chartYAxis(.hidden)
        .chartPlotStyle { $0.clipped() }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: domain)
        .chartXAxis {
            AxisMarks(values: store.months.map(\.id)) { value in
                if let month = value.as(String.self) {
                    AxisValueLabel(centered: true, anchor: .top) {
                        Text(
                            ReportDates.date(month).formatted(
                                Date.FormatStyle(locale: L10n.locale, timeZone: .gmt).month(
                                    .abbreviated))
                        )
                        .font(.caption2).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                ReportChartInteractionView(plotFrame: proxy.plotFrame.map { geometry[$0] } ?? .zero)
                { location, extending in
                    guard let anchor = proxy.plotFrame else { return }
                    let frame = geometry[anchor]
                    let x = min(max(location.x - frame.minX, 0), max(0, frame.width - 0.001))
                    if let month = proxy.value(atX: x, as: String.self) {
                        store.selectMonth(month, extending: extending)
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: store.range)
        .accessibilityLabel(L10n.string("Monthly inflow and outflow"))
        .accessibilityValue(store.rangeLabel)
    }
}

/// Taps select one month; a recognized hold extends the range and owns the touch.
/// Ordinary swipes remain available to the horizontal chart and vertical page.
struct ReportChartInteractionView: UIViewRepresentable {
    let plotFrame: CGRect
    let onChanged: (CGPoint, Bool) -> Void
    func makeCoordinator() -> Coordinator {
        Coordinator(plotFrame: plotFrame, onChanged: onChanged)
    }
    func makeUIView(context: Context) -> UIView { context.coordinator.makeView() }
    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.plotFrame = plotFrame
        context.coordinator.onChanged = onChanged
    }
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var plotFrame: CGRect
        var onChanged: (CGPoint, Bool) -> Void
        init(plotFrame: CGRect, onChanged: @escaping (CGPoint, Bool) -> Void) {
            self.plotFrame = plotFrame
            self.onChanged = onChanged
        }
        func makeView() -> UIView {
            let view = UIView()
            view.backgroundColor = .clear
            let hold = UILongPressGestureRecognizer(target: self, action: #selector(selectMonth))
            hold.minimumPressDuration = 0.35
            hold.allowableMovement = 10
            let tap = UITapGestureRecognizer(target: self, action: #selector(selectMonth))
            tap.require(toFail: hold)
            for recognizer in [hold, tap] {
                recognizer.delegate = self
                view.addGestureRecognizer(recognizer)
            }
            return view
        }
        @objc private func selectMonth(_ recognizer: UIGestureRecognizer) {
            if recognizer.state == .began || recognizer.state == .changed
                || recognizer.state == .ended
            {
                onChanged(
                    recognizer.location(in: recognizer.view),
                    recognizer is UILongPressGestureRecognizer)
            }
        }
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch
        ) -> Bool {
            plotFrame.contains(touch.location(in: gestureRecognizer.view))
        }
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool { false }
        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            gestureRecognizer is UILongPressGestureRecognizer
                && otherGestureRecognizer is UIPanGestureRecognizer
                && otherGestureRecognizer.view is UIScrollView
        }
    }
}

struct ReportRankRow: View {
    let row: ReportRank
    let maximum: Decimal
    let total: Decimal
    let money: (Decimal) -> String
    let isMerchant: Bool
    let tint: Color
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .caption) private var percentageWidth = 36.0

    private var relativeWidth: Double {
        min(1, max(0, ReportStyle.ratio(row.amount, of: maximum)))
    }
    private var barShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(bottomTrailingRadius: 8, topTrailingRadius: 8)
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    name
                    amounts
                }
            } else {
                HStack(spacing: 12) {
                    name
                    Spacer(minLength: 0)
                    amounts
                }
            }
        }
        .padding(.leading, 24).padding(.trailing, 16).padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        .foregroundStyle(KualiaPalette.ink)
        .background {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    barShape.fill(KualiaPalette.surface)
                    barShape.fill(tint.opacity(0.30))
                        .frame(width: geometry.size.width * relativeWidth)
                }
            }.accessibilityHidden(true)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var name: some View {
        HStack(spacing: 8) {
            if isMerchant {
                ReportMerchantLogo(logoURL: row.logoURL, size: 22)
                    .background(KualiaPalette.surface, in: Circle())
            }
            Text(row.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private var amounts: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(money(row.amount)).font(.subheadline.weight(.semibold))
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(ReportStyle.percent(row.amount, of: total, compact: true))
                .font(.caption.weight(.medium)).foregroundStyle(KualiaPalette.ink)
                .lineLimit(1).minimumScaleFactor(0.8)
                .frame(width: percentageWidth, alignment: .trailing)
        }.monospacedDigit().layoutPriority(1)
    }
}

struct ReportComparisonLabel: View {
    let current: Decimal
    let previous: Decimal
    let money: (Decimal) -> String
    var body: some View {
        let delta = current - previous
        HStack(spacing: 5) {
            KualiaIconImage(
                icon: delta == 0 ? .equals : delta > 0 ? .arrowUpRight : .arrowDownRight, size: 18)
            if previous > 0 && current >= 0 {
                let percentage = ReportStyle.percent(abs(delta), of: previous)
                Text(
                    delta < 0
                        ? L10n.string("\(percentage) less")
                        : delta > 0 ? L10n.string("\(percentage) more") : L10n.string("No change"))
            } else if delta == 0 {
                Text(L10n.string("No change"))
            } else {
                Text(
                    delta > 0
                        ? L10n.string("\(money(abs(delta))) more")
                        : L10n.string("\(money(abs(delta))) less"))
            }
        }.font(.subheadline.weight(.medium)).foregroundStyle(KualiaPalette.ink)
    }
}

enum ReportStyle {
    static func chartColor(_ kind: ReportKind) -> Color {
        Color(
            uiColor: UIColor { traits in
                let dark = traits.userInterfaceStyle == .dark
                switch kind {
                case .spending:
                    return UIColor(
                        red: dark ? 0.79 : 0.50, green: dark ? 0.61 : 0.34,
                        blue: dark ? 0.76 : 0.48, alpha: 1)
                case .moneyIn:
                    return UIColor(
                        red: dark ? 0.58 : 0.30, green: dark ? 0.74 : 0.47,
                        blue: dark ? 0.87 : 0.62, alpha: 1)
                case .cashFlow:
                    return UIColor(
                        red: dark ? 0.66 : 0.36, green: dark ? 0.69 : 0.40,
                        blue: dark ? 0.90 : 0.63, alpha: 1)
                }
            })
    }

    static func ratio(_ amount: Decimal, of total: Decimal) -> Double {
        guard total > 0 else { return 0 }
        return NSDecimalNumber(decimal: amount / total).doubleValue
    }
    static func percent(_ amount: Decimal, of total: Decimal, compact: Bool = false) -> String {
        let value = ratio(amount, of: total)
        if compact {
            // Switch before rounding can turn 9.95% into a three-digit "10.0%".
            let digits = abs(value) < 0.0995 ? 1 : 0
            return value.formatted(.percent.precision(.fractionLength(digits)).locale(L10n.locale))
        }
        return value.formatted(.percent.precision(.fractionLength(0...1)))
    }
}

extension ReportsStore {
    func money(_ amount: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: amount, currencyCode: context?.currencyCode ?? "USD",
            minorUnit: context?.minorUnit ?? 2, showsPositiveSign: false, usesAbsoluteValue: false)
    }
}

struct ReportMerchantLogo: View {
    let logoURL: String?
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            fallback
            if let logoURL, let url = URL(string: logoURL) {
                TransactionMerchantLogo(url: url) { fallback }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var fallback: some View {
        KualiaIconImage(icon: .shop, size: size * 0.46)
            .font(.system(size: size * 0.46, weight: .medium))
            .foregroundStyle(KualiaPalette.mutedInk)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KualiaPalette.border.opacity(0.3))
    }
}
