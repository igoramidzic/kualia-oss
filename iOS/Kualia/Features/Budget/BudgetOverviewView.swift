import SwiftUI

struct BudgetCategoryFilterStrip: View {
    let groups: [BudgetGroupModel]
    let selection: BudgetCategoryFilter
    var isEnabled = true
    let onSelect: (BudgetCategoryFilter) -> Void
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
                .onChange(of: selection, initial: true) { _, filter in
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
                        proxy.scrollTo(filter, anchor: .center)
                    }
                }
            }
            .accessibilityIdentifier("budget-category-filters")

        }
    }

    private var filterButtons: some View {
        ForEach(BudgetCategoryFilter.visible(in: groups), id: \.self) { filter in
            Button {
                onSelect(filter)
            } label: {
                chip(filter)
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(!isEnabled)
            .id(filter)
            .accessibilityLabel(filter.title)
            .accessibilityValue(L10n.string("\(filter.count(in: groups)) categories"))
            .accessibilityAddTraits(selection == filter ? .isSelected : [])
            .accessibilityIdentifier("budget-filter-\(filter.rawValue)")
        }
    }

    private func chip(_ filter: BudgetCategoryFilter) -> some View {
        let isSelected = selection == filter
        let isDanger = filter == .overspent
        let ink = isDanger ? KualiaPalette.budgetNegative : KualiaPalette.ink
        let layout =
            isVertical
            ? AnyLayout(VStackLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 6))
        return layout {
            HomeFilterLabel(filter.title)
            if filter != .all {
                FilterCountBadge(count: filter.count(in: groups))
            }
        }
        .foregroundStyle(isSelected ? KualiaPalette.canvas : ink)
        .fixedSize(horizontal: !isVertical, vertical: isVertical)
        .modifier(FilterChipStyle(background: isSelected ? ink : KualiaPalette.surface))
        .animation(reduceMotion ? nil : .smooth(duration: 0.24), value: filter.count(in: groups))
        .animation(reduceMotion ? nil : .smooth(duration: 0.24), value: isSelected)
    }
}

/// Use the same cached disclosure layout as category groups; keep live amount animations local.
struct BudgetTargetSummaryCard: View {
    let summary: BudgetMonthlyFundingSummary?
    let currencyCode: String
    let minorUnit: Int
    @Binding var isExpanded: Bool
    var month: Int? = nil
    var animatesDisclosure = true
    @State private var showsExplanation = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                isExpanded.toggle()
            } label: {
                header
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(minHeight: 48)
                    .background(KualiaPalette.border.opacity(0.12))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityLabel(L10n.string("Monthly funding"))
            .accessibilityValue(headerAccessibilityValue)
            .accessibilityHint(
                isExpanded
                    ? L10n.string("Hide funding details") : L10n.string("Show funding details")
            )
            .accessibilityIdentifier("budget-target-summary-toggle")

            BudgetDisclosure(isExpanded: isExpanded) {
                if let summary {
                    BudgetTargetFundingDetails(
                        summary: summary, currencyCode: currencyCode, minorUnit: minorUnit,
                        onExplain: { showsExplanation = true }
                    )
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                } else {
                    HStack(alignment: .top, spacing: 12) {
                        Text(L10n.string("Funding totals aren't available for this month yet."))
                            .font(.subheadline)
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        BudgetFundingInfoButton { showsExplanation = true }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                }
            }
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .background(KualiaPalette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(KualiaPalette.border.opacity(0.4), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("budget-target-summary")
        .animation(disclosureAnimation, value: isExpanded)
        .sheet(isPresented: $showsExplanation) {
            BudgetTargetFundingExplanationSheet(
                summary: summary, currencyCode: currencyCode, minorUnit: minorUnit, month: month)
        }
    }

    private var header: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .font(.caption.weight(.bold))
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .frame(width: 10)
                Text(L10n.string("Monthly funding"))
                    .font(.subheadline.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let summary, summary.total > 0 {
                VStack(alignment: .trailing, spacing: 3) {
                    Text(L10n.string("Funded")).font(.caption2.weight(.semibold))
                    HStack(spacing: 8) {
                        BudgetMonthlyFundingTrack(summary: summary, isCompact: true)
                            .frame(minWidth: 0, idealWidth: 96, maxWidth: 112)
                            .frame(height: 10)
                            .layoutPriority(-1)
                            // Reserve its space so disclosure never moves the title or percentage.
                            .opacity(isExpanded ? 0 : 1)
                            .animation(
                                reduceMotion || !animatesDisclosure
                                    ? nil
                                    : .easeInOut(duration: 0.16).delay(isExpanded ? 0 : 0.24),
                                value: isExpanded
                            )
                            .accessibilityHidden(true)
                        Text(
                            Double(summary.percentage) / 100,
                            format: .percent.precision(.fractionLength(0))
                        )
                        .font(.subheadline.weight(.medium).monospacedDigit())
                        .lineLimit(1).minimumScaleFactor(0.8)
                        .contentTransition(reduceMotion ? .identity : .numericText())
                        .animation(
                            BudgetProgressMotion.animation(reduceMotion: reduceMotion),
                            value: summary.percentage)
                    }
                }
                .foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    private var headerAccessibilityValue: String {
        let state = isExpanded ? L10n.string("Expanded") : L10n.string("Collapsed")
        guard let summary, summary.total > 0 else { return state }
        return state + ", "
            + L10n.string(
                "\(summary.percentage)% funded, \(money(summary.funded)) of \(money(summary.total))"
            )
    }

    private var disclosureAnimation: Animation? {
        reduceMotion || !animatesDisclosure ? nil : .smooth(duration: 0.24)
    }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: currencyCode, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
    }

}

private struct BudgetFundingInfoButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            KualiaIconImage(icon: .info, size: 20)
                .foregroundStyle(KualiaPalette.mutedInk)
                .frame(width: 44, height: 44)
                .background(KualiaPalette.border.opacity(0.16), in: Circle())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityLabel(L10n.string("About monthly funding"))
        .accessibilityHint(
            L10n.string("Explains targets, overspending, and carryover")
        )
        .accessibilityIdentifier("budget-target-funding-info")
    }
}

/// The budget and explanation share the same amounts, formatting, and funding ruler.
private struct BudgetTargetFundingDetails: View {
    let summary: BudgetMonthlyFundingSummary
    let currencyCode: String
    let minorUnit: Int
    var showsReferences = false
    var onExplain: (() -> Void)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                fundingHeadline(summary)
                if let onExplain { BudgetFundingInfoButton(action: onExplain) }
            }
            BudgetMonthlyFundingTrack(summary: summary)
                .frame(height: 24)
                .accessibilityHidden(true)
            fundingMetrics(summary)
            if summary.extraTotal > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    breakdown(L10n.string("Targets left"), value: summary.targets.remaining)
                    breakdown(L10n.string("Extra spending left"), value: summary.extraRemaining)
                }
                .accessibilityIdentifier("budget-monthly-funding-breakdown")
            }
        }
    }

    private func fundingHeadline(_ summary: BudgetMonthlyFundingSummary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Group {
                if summary.isFullyFunded && !showsReferences {
                    Text(L10n.string("Fully Funded"))
                        .foregroundStyle(KualiaPalette.mutedInk)
                } else {
                    amount(summary.remaining)
                }
            }
            .font(.system(.largeTitle, design: .rounded, weight: .bold))
            .accessibilityIdentifier("budget-target-remaining")
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(
                    summary.total == 0
                        ? L10n.string("No funding needed this month")
                        : summary.isFullyFunded
                            ? L10n.string("Targets and spending are covered")
                            : L10n.string("left to fund")
                )
                if showsReferences { BudgetFundingReference("1") }
            }
            .font(.subheadline)
            .foregroundStyle(KualiaPalette.mutedInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func fundingMetrics(_ summary: BudgetMonthlyFundingSummary) -> some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 16))
        return layout {
            metric(
                L10n.string("Funded"), reference: "2", value: summary.funded,
                color: summary.funded < 0
                    ? KualiaPalette.budgetNegative : KualiaPalette.budgetPositive)
            metric(
                L10n.string("Monthly need"), reference: "3", value: summary.total,
                color: KualiaPalette.ink)
        }
    }

    private func breakdown(_ title: String, value: Decimal) -> some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            Text(title).frame(maxWidth: .infinity, alignment: .leading)
            amount(value).fontWeight(.semibold)
                .foregroundStyle(
                    value > 0 ? KualiaPalette.budgetUnderfunded : KualiaPalette.budgetPositive)
        }
        .font(.caption)
        .foregroundStyle(KualiaPalette.mutedInk)
        .accessibilityElement(children: .combine)
    }

    private func metric(_ title: String, reference: String, value: Decimal, color: Color)
        -> some View
    {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(title)
                if showsReferences { BudgetFundingReference(reference) }
            }
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            amount(value).font(.subheadline.weight(.bold)).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func amount(_ value: Decimal) -> some View {
        Text(money(value))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.55)
            .contentTransition(
                reduceMotion
                    ? .identity : .numericText(value: NSDecimalNumber(decimal: value).doubleValue)
            )
            .animation(reduceMotion ? nil : .smooth(duration: 0.24), value: value)
    }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: currencyCode, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
    }
}

private struct BudgetFundingReference: View {
    let mark: String
    var isInline: Bool
    @ScaledMetric(relativeTo: .subheadline) private var referenceRise: CGFloat = 4

    init(_ mark: String, isInline: Bool = true) {
        self.mark = mark
        self.isInline = isInline
    }

    var body: some View {
        Text(mark)
            .font(isInline ? .subheadline.weight(.bold) : .headline.weight(.bold))
            .baselineOffset(isInline ? referenceRise : 0)
            .fixedSize()
            .foregroundStyle(KualiaPalette.budgetPositive)
            .accessibilityHidden(true)
    }
}

struct BudgetTargetFundingExplanationSheet: View {
    let summary: BudgetMonthlyFundingSummary?
    let currencyCode: String
    let minorUnit: Int
    let month: Int?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                BudgetTargetFundingExplanation(
                    summary: summary, currencyCode: currencyCode, minorUnit: minorUnit, month: month
                )
                .padding(20)
                .padding(.bottom, 16)
            }
            .scrollIndicators(.hidden)
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Monthly funding"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Done")) { dismiss() }
                        .accessibilityIdentifier("budget-target-funding-info-done")
                }
            }
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .accessibilityIdentifier("budget-target-funding-explanation-sheet")
    }
}

struct BudgetTargetFundingExplanation: View {
    let summary: BudgetMonthlyFundingSummary?
    let currencyCode: String
    let minorUnit: Int
    let month: Int?
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            VStack(alignment: .leading, spacing: 10) {
                Text(L10n.string("Your monthly funding, explained"))
                    .font(.title2.weight(.bold))
                Text(
                    L10n.string(
                        "Monthly funding includes your targets and spending beyond them. Fully funded means both are covered."
                    )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }

            annotatedCard

            VStack(alignment: .leading, spacing: 22) {
                explanation(
                    "1", title: L10n.string("Left to fund"),
                    text: L10n.string(
                        "The money still needed for targets and overspending. If funding a target also covers that category's overspending, it is counted only once."
                    ))
                explanation(
                    "2", title: L10n.string("Funded"),
                    text: L10n.string(
                        "The target contributions and extra spending already covered. Surplus in one category does not cover another category's shortfall."
                    ))
                if let summary, summary.funded < 0 {
                    Text(
                        L10n.string(
                            "Funded can fall below zero when money is removed from target categories, increasing what's left to add."
                        )
                    )
                    .font(.caption).foregroundStyle(KualiaPalette.budgetNegative)
                    .padding(.leading, 44)
                }
                explanation(
                    "3", title: L10n.string("Monthly need"),
                    text: L10n.string(
                        "This month's target contributions plus spending beyond them. Overspending in categories without targets or with snoozed targets is included. Archived categories are excluded."
                    ))
                explanation(
                    "4", title: L10n.string("The percentage"),
                    text: L10n.string(
                        "The share of the monthly need covered, rounded down. One bar combines targets and extra spending. It stays amber while funding is needed and turns green when the full monthly need is covered."
                    ))
            }

            Text(
                L10n.string(
                    "Extra spending stays in the monthly need after you cover it, so progress increases as you assign money. Carryover can reduce the amount that needs new funding."
                )
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            carryoverNote
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("budget-target-funding-explanation")
    }

    private var annotatedCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(
                    month.map { BudgetMonth.title($0, locale: locale) }
                        ?? L10n.string("Monthly funding")
                )
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity, alignment: .leading)
                if let summary, summary.total > 0 {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(
                            Double(summary.percentage) / 100,
                            format: .percent.precision(.fractionLength(0))
                        )
                        .font(.subheadline.weight(.medium).monospacedDigit())
                        BudgetFundingReference("4")
                    }
                    .accessibilityLabel(L10n.string("\(summary.percentage)% funded"))
                }
            }
            .padding(18)
            .background(KualiaPalette.budgetPositive.opacity(0.07))

            if let summary {
                BudgetTargetFundingDetails(
                    summary: summary, currencyCode: currencyCode, minorUnit: minorUnit,
                    showsReferences: true
                )
                .padding(18)
            } else {
                Text(
                    L10n.string(
                        "Funding totals aren't available for this month yet. The guide below explains how they'll be calculated."
                    )
                )
                .font(.subheadline)
                .foregroundStyle(KualiaPalette.mutedInk)
                .padding(18)
            }
        }
        .background(KualiaPalette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(KualiaPalette.budgetPositive.opacity(0.22), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityIdentifier("budget-target-funding-annotated-card")
    }

    private func explanation(_ mark: String, title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            BudgetFundingReference(mark, isInline: false)
                .frame(minWidth: 32, minHeight: 32)
                .background(KualiaPalette.budgetPositive.opacity(0.08), in: Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.subheadline.weight(.bold))
                Text(text).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var carryoverNote: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(L10n.string("A new month can need a little less"), icon: .calendarRepeating)
                .font(.headline)
            Text(
                L10n.string(
                    "For targets that refill a category to a set amount, unused money carried into the next month can reduce what you need to add. Other target types may still call for their full contribution."
                )
            )
            .font(.subheadline)
            Divider().overlay(KualiaPalette.budgetPositive.opacity(0.2))
            Text(
                L10n.string(
                    "That's why the monthly target can change from month to month, even when you haven't edited your targets."
                )
            )
            .font(.subheadline.weight(.medium))
        }
        .foregroundStyle(KualiaPalette.budgetPositive)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            KualiaPalette.budgetPositive.opacity(0.07),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

private struct BudgetMonthlyFundingTrack: View {
    let summary: BudgetMonthlyFundingSummary
    var isCompact = false

    var body: some View {
        BudgetFundingTrack(
            progress: summary.progress, isCompact: isCompact,
            isComplete: summary.isFullyFunded)
    }
}

/// Fixed-size rulers keep disclosure layout independent from the funding fill.
struct BudgetFundingTrack: View {
    let progress: Double
    var isCompact = false
    var isComplete = true
    @State private var hasAppeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.budgetFundingAnimationsEnabled) private var animationsEnabled

    var body: some View {
        GeometryReader { geometry in
            let count = min(
                isCompact ? 17 : 33, max(5, Int(geometry.size.width / (isCompact ? 4 : 6))))
            let marks = BudgetFundingMarks(count: count, gap: isCompact ? 2 : 3)
            ZStack(alignment: .leading) {
                marks.fill(KualiaPalette.border.opacity(0.55))
                marks.fill(
                    isComplete
                        ? KualiaPalette.budgetPositive : KualiaPalette.budgetFundingProgress
                )
                .mask(alignment: .leading) {
                    BudgetFundingProgressMask(progress: progress)
                        .modifier(
                            BudgetFundingAnimation(
                                progress: progress,
                                isEnabled: hasAppeared && animationsEnabled && !reduceMotion))
                }
            }
        }
        // Page transitions and initial geometry must not animate the fill from zero.
        // The mask adds its own animation only when an already-mounted value changes.
        .transaction { $0.animation = nil }
        .onAppear { hasAppeared = true }
        .onDisappear { hasAppeared = false }
    }
}

extension EnvironmentValues {
    @Entry var budgetFundingAnimationsEnabled = true
}

struct BudgetFundingAnimation<Progress: Equatable>: ViewModifier {
    let progress: Progress
    let isEnabled: Bool

    func body(content: Content) -> some View {
        content.transaction(value: progress, update)
    }

    func update(_ transaction: inout Transaction) {
        transaction.animation =
            isEnabled && !transaction.disablesAnimations
            ? BudgetProgressMotion.animation(reduceMotion: false) : nil
    }
}

enum BudgetProgressMotion {
    static func animation(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.45)
    }
}

/// Interpolate the funding percentage without resizing or stretching the ruler marks.
struct BudgetFundingProgressMask: Shape {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let fraction = progress.isFinite ? min(1, max(0, progress)) : 0
        return Path(
            CGRect(
                x: rect.minX, y: rect.minY, width: rect.width * fraction,
                height: rect.height))
    }
}

struct BudgetFundingMarks: Shape {
    let count: Int
    let gap: CGFloat

    func path(in rect: CGRect) -> Path {
        // Reserve at least half the width for ink, even in compact layouts.
        let gap = min(gap, rect.width / CGFloat(count * 2))
        let width = max(0, (rect.width - gap * CGFloat(count - 1)) / CGFloat(count))
        var path = Path()
        for index in 0..<count {
            let height = index.isMultiple(of: (count - 1) / 4) ? rect.height : rect.height * 0.7
            let mark = CGRect(
                x: rect.minX + CGFloat(index) * (width + gap), y: rect.maxY - height,
                width: width, height: height)
            path.addRoundedRect(
                in: mark, cornerSize: CGSize(width: min(2, width / 2), height: min(2, height / 2)))
        }
        return path
    }
}
