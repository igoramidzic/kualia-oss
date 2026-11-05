import SwiftUI

struct HomeTopBar: View {
    enum Placement { case all, title, dock }
    var placement: Placement = .all
    static let titleFont = Font.system(size: 30, weight: .bold, design: .rounded)
    @Environment(\.budgetMonthPaging) private var paging
    @Environment(\.locale) private var locale
    @Environment(\.timeZone) private var timeZone

    let title: String
    let onNewEntry: () -> Void
    let onPreferences: () -> Void
    var showsDateTitle = false
    var onSearch: (() -> Void)? = nil
    var isSearchEnabled = true
    var onTransactionPreferences: (() -> Void)? = nil
    var onEditBudgetPlan: (() -> Void)? = nil
    var canEditBudgetPlan = true
    var onBudgetPreferences: (() -> Void)? = nil
    var onAddAccount: (() -> Void)? = nil
    var canAddAccount = true
    var onReorderAccounts: (() -> Void)? = nil
    var canReorderAccounts = true
    var reportRange: ReportRange? = nil
    var onReportRange: (() -> Void)? = nil
    var canChangeReportRange = true
    var onTitleTap: (() -> Void)? = nil
    var isTitleEnabled = true
    var showsActions = true
    var monthBrowsingLabel: String? = nil
    var onReturnToCurrentMonth: (() -> Void)? = nil
    var budgetMonth: Int? = nil
    var currentBudgetMonth: Int = 0
    var monthPickerAccessibilityPrefix = "budget"
    var monthPickerAccessibilityHint = L10n.string("Choose a budget month")
    var onCloseQuickAssign: (() -> Void)?
    var canCloseQuickAssign = true
    var onCloseMoneyMove: (() -> Void)?
    var canCloseMoneyMove = true
    private var visibleMonthBrowsingLabel: String? {
        guard let budgetMonth, let paging else { return monthBrowsingLabel }
        return paging.browsingLabel(selectedMonth: budgetMonth, currentMonth: currentBudgetMonth)
    }

    @ViewBuilder
    var body: some View {
        if placement == .dock {
            actions
        } else if let reportRange, let onReportRange {
            HStack(spacing: 8) {
                reportRangeControl(reportRange, action: onReportRange)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KualiaPalette.ink)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("reports.title")

                Group {
                    if placement == .all {
                        actions
                    } else {
                        Color.clear.frame(width: 0, height: 48)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        } else {
            HStack(spacing: 8) {
                if let onTitleTap {
                    monthControl(onTitleTap: onTitleTap)
                } else {
                    titleLabel.frame(height: 48, alignment: .leading)
                }

                Spacer(minLength: 0)

                if placement == .all { actions }
            }
        }
    }

    private func reportRangeControl(_ range: ReportRange, action: @escaping () -> Void) -> some View
    {
        Button(action: action) {
            HStack(spacing: 8) {
                KualiaIconImage(icon: .filter, size: 16).accessibilityHidden(true)
                Text(range.compactMonthLabel(locale: locale))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
            .foregroundStyle(KualiaPalette.ink)
            .padding(.horizontal, 14)
            .frame(minWidth: 44, minHeight: 48)
            .contentShape(Capsule())
        }
        .buttonStyle(.kualiaHaptic)
        .kualiaControlGlass(in: Capsule())
        .disabled(!canChangeReportRange)
        .accessibilityLabel(L10n.string("Report range"))
        .accessibilityValue(range.label)
        .accessibilityIdentifier("reports.range")
    }

    @ViewBuilder
    private var actions: some View {
        if let onCloseMoneyMove {
            KualiaCloseButton(label: L10n.string("Close money move"), action: onCloseMoneyMove)
                .disabled(!canCloseMoneyMove)
                .accessibilityIdentifier("budget-move-close")
        } else if let onCloseQuickAssign {
            KualiaCloseButton(
                label: L10n.string("Close quick assign"), action: onCloseQuickAssign
            )
            .disabled(!canCloseQuickAssign)
            .accessibilityIdentifier("budget-quick-cancel")
        } else if showsActions {
            actionGroup.fixedSize()
        }
    }

    private func monthControl(onTitleTap: @escaping () -> Void) -> some View {
        HStack(spacing: 0) {
            Button(action: onTitleTap) {
                HStack(spacing: 6) {
                    Text(
                        budgetMonth.map {
                            BudgetMonth.navigationTitle(
                                $0, currentMonth: currentBudgetMonth, locale: locale)
                        } ?? title
                    )
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    KualiaIconImage(icon: .chevronDown, size: 12)
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 8)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(!isTitleEnabled)
            .accessibilityLabel(title)
            .accessibilityHint(monthPickerAccessibilityHint)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("\(monthPickerAccessibilityPrefix)-month-picker-trigger")

            if budgetMonth != nil, let monthBrowsingLabel = visibleMonthBrowsingLabel,
                let onReturnToCurrentMonth
            {
                Button(action: onReturnToCurrentMonth) {
                    KualiaIconImage(icon: .undo, size: 19)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(!isTitleEnabled)
                .accessibilityLabel(
                    L10n.string("\(monthBrowsingLabel). Return to current month")
                )
                .accessibilityIdentifier(
                    "\(monthPickerAccessibilityPrefix)-return-to-current-month")
            }
        }
        .foregroundStyle(KualiaPalette.ink)
        .padding(.horizontal, 6)
        .frame(height: 48)
        .kualiaControlGlass(in: Capsule())
    }

    private var titleLabel: some View {
        Group {
            if showsDateTitle {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    Text(
                        HomeDashboardDate.title(
                            for: context.date, locale: locale, timeZone: timeZone))
                }
            } else {
                Text(title)
            }
        }
        .font(Self.titleFont)
        .foregroundStyle(KualiaPalette.ink)
        .lineLimit(1)
        .accessibilityAddTraits(.isHeader)

        .minimumScaleFactor(0.65)
    }

    private var actionGroup: some View {
        let layout =
            placement == .dock
            ? AnyLayout(VStackLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 0))
        return layout {
            if let onSearch {
                actionButton(
                    icon: .search, accessibilityLabel: L10n.string("Search transactions"),
                    action: onSearch
                )
                .disabled(!isSearchEnabled)
                .accessibilityIdentifier("transaction-search-launcher")
            }
            if let onTransactionPreferences {
                actionButton(
                    icon: .preferences,
                    accessibilityLabel: L10n.string("Transaction preferences"),
                    action: onTransactionPreferences
                )
                .accessibilityIdentifier("transaction-preferences-launcher")
            }
            if let onEditBudgetPlan {
                actionButton(
                    icon: .pencil, accessibilityLabel: L10n.string("Edit budget plan"),
                    action: onEditBudgetPlan
                )
                .disabled(!canEditBudgetPlan)
                .accessibilityIdentifier("budget-plan-launcher")
            }
            if let onBudgetPreferences {
                actionButton(
                    icon: .preferences, accessibilityLabel: L10n.string("Budget preferences"),
                    action: onBudgetPreferences
                )
                .accessibilityIdentifier("budget-preferences-launcher")
            }
            if let onAddAccount {
                actionButton(
                    icon: .plus, accessibilityLabel: L10n.string("Add Account"),
                    action: onAddAccount
                )
                .disabled(!canAddAccount)
                .accessibilityIdentifier("accounts-add-launcher")
            }
            if let onReorderAccounts {
                actionButton(
                    icon: .sort, accessibilityLabel: L10n.string("Reorder accounts"),
                    action: onReorderAccounts
                )
                .disabled(!canReorderAccounts)
                .accessibilityIdentifier("accounts-reorder-launcher")
            }
            Button(action: onPreferences) {
                SettingsAvatar()
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityLabel(L10n.string("Account settings"))
            .accessibilityIdentifier("open-settings")
        }
        .padding(.horizontal, 6)
        .padding(.vertical, placement == .dock ? 6 : 0)
        .frame(height: placement == .dock ? nil : 48)
        .kualiaControlGlass(in: Capsule())
    }

    private func actionButton(
        icon: KualiaIcon,
        accessibilityLabel: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            KualiaIconImage(icon: icon, size: 19)
                .foregroundStyle(KualiaPalette.ink)
                .frame(width: 44, height: 44)
                .contentShape(.interaction, Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// Budget uses the displayed text's intrinsic width. The calendar keeps a stable
/// viewport for its sliding month titles.
struct BudgetSlidingMonthTitle: View {
    let month: Int
    let currentMonth: Int
    var usesPageTitleStyle = false
    var fitsAvailableWidth = false
    @Environment(\.budgetMonthPaging) private var paging
    @Environment(\.locale) private var locale
    private let fadeWidth: CGFloat = 8
    private var titleFont: Font {
        usesPageTitleStyle
            ? HomeTopBar.titleFont : .system(size: 26, weight: .bold, design: .rounded)
    }

    private var position: CGFloat {
        paging?.titlePosition(selectedMonth: month) ?? CGFloat(BudgetMonth.index(month))
    }

    private var sizingMonths: [Int] {
        let years = Set([currentMonth / 100, month / 100 - 1, month / 100, month / 100 + 1])
        return years.sorted().flatMap { year in (1...12).map { year * 100 + $0 } }
    }

    var body: some View {
        Group {
            if usesPageTitleStyle {
                Text(title(month))
                    .font(titleFont)
                    .foregroundStyle(KualiaPalette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .fixedSize(horizontal: !fitsAvailableWidth, vertical: true)
                    .padding(.bottom, 4)
                    .frame(height: 40)
                    .overlay(alignment: .bottom) {
                        MonthNameUnderline()
                            .stroke(
                                KualiaPalette.mutedInk,
                                style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [1, 4])
                            )
                            .frame(height: 1)
                    }
            } else {
                slidingTitle
            }
        }
        .accessibilityHidden(true)
    }

    private var slidingTitle: some View {
        // An intrinsic sizing layer prevents the GeometryReader from consuming
        // all remaining toolbar space. Include year-qualified labels as well.
        ZStack {
            ForEach(sizingMonths, id: \.self) { sizingMonth in
                Text(title(sizingMonth))
                    .font(titleFont)
                    .fixedSize()
            }
        }
        .hidden()
        .padding(.horizontal, fadeWidth)
        .frame(height: 34)
        .overlay {
            GeometryReader { geometry in
                let base = Int(position.rounded(.down))
                let fade = min(0.25, fadeWidth / max(1, geometry.size.width))
                ZStack(alignment: .leading) {
                    ForEach((base - 1)...(base + 1), id: \.self) { index in
                        Text(title(BudgetMonth.fromIndex(index)))
                            .font(titleFont)
                            .foregroundStyle(KualiaPalette.ink)
                            .fixedSize()
                            .padding(.bottom, 4)
                            .frame(
                                width: Self.titleWidth(
                                    in: geometry.size.width, fadeWidth: fadeWidth),
                                alignment: .leading
                            )
                            .offset(
                                x: fadeWidth + (CGFloat(index) - position) * geometry.size.width)
                    }
                }
                .frame(
                    width: geometry.size.width, height: geometry.size.height, alignment: .leading
                )
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .black, location: fade),
                            .init(color: .black, location: 1 - fade),
                            .init(color: .clear, location: 1),
                        ], startPoint: .leading, endPoint: .trailing)
                }
            }
        }
        .overlay(alignment: .bottom) {
            MonthNameUnderline()
                .stroke(
                    KualiaPalette.mutedInk,
                    style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [1, 4])
                )
                .frame(height: 1)
                .padding(.horizontal, fadeWidth)
        }
        .accessibilityHidden(true)
    }

    private func title(_ month: Int) -> String {
        BudgetMonth.navigationTitle(month, currentMonth: currentMonth, locale: locale)
    }

    nonisolated static func titleWidth(in viewportWidth: CGFloat, fadeWidth: CGFloat) -> CGFloat {
        // The overlay receives zero/narrow proposals while the toolbar mounts.
        // Reserving both fade edges must never produce a negative fixed frame.
        guard viewportWidth.isFinite, fadeWidth.isFinite else { return 0 }
        return max(0, viewportWidth - 2 * max(0, fadeWidth))
    }
}

private struct MonthNameUnderline: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.minX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        }
    }
}
