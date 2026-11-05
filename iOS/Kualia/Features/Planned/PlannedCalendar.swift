import SwiftUI

extension EnvironmentValues {
    @Entry var transactionScheduleStore: PlannedStore? = nil
}

extension PlannedStatus {
    var color: Color {
        switch self {
        case .upcoming: PlannedStyle.accent
        case .overdue: KualiaPalette.budgetNegative
        case .paid: KualiaPalette.budgetPositive
        case .skipped: KualiaPalette.mutedInk
        }
    }
}

enum PlannedStyle {
    static let transactionSurface = KualiaPalette.transactionsPage.mix(with: .black, by: 0.06)
    static let transactionDateSurface = transactionSurface.mix(
        with: KualiaPalette.transactionsPage.mix(with: .white, by: 0.03), by: 0.5)
    static let transactionSeparator = KualiaPalette.transactionsPage.mix(
        with: KualiaPalette.ink, by: 0.24)

    static let accent = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.77, green: 0.66, blue: 1, alpha: 1)
                : UIColor(red: 0.39, green: 0.25, blue: 0.66, alpha: 1)
        })
}

/// Shared date vocabulary for the calendar overview and the transaction's When sheet.
struct PlannedCalendar: View {
    let month: Int
    let workspace: TransactionFeedWorkspace
    let selectedDate: String?
    var entries: [PlannedOccurrence] = []
    var schedules: [PlannedSchedule] = []
    var showsMerchantLogos = false
    var previewDates: Set<String> = []
    var latestDate: String?
    var today: String? = nil
    var firstWeekday = Calendar.current.firstWeekday
    let onSelect: (String) -> Void
    @Environment(\.locale) private var locale

    private var calendar: Calendar {
        var calendar = TransactionEditorDate.calendar(workspace: workspace)
        calendar.locale = locale
        calendar.firstWeekday = firstWeekday
        return calendar
    }
    var body: some View {
        let calendar = calendar
        let days = PlannedCalendarGrid.days(in: month, calendar: calendar)
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let first = calendar.firstWeekday - 1
        let weekdaySymbols = Array(symbols[first...] + symbols[..<first])
        let byDay = Dictionary(grouping: entries, by: \.displayDate)
        let schedulesByID = Dictionary(
            schedules.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let todayKey = today ?? TransactionEditorDate.today(workspace: workspace)
        let labels = dayLabels(calendar: calendar, days: days)
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 5
        ) {
            ForEach(0..<7, id: \.self) { index in
                Text(weekdaySymbols[index])
                    .font(.system(.caption2, weight: .semibold))
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .frame(maxWidth: .infinity, minHeight: 24)
                    .accessibilityHidden(true)
            }
            ForEach(days) { day in
                dayButton(
                    day: day.number, key: day.key, isCurrentMonth: day.isCurrentMonth,
                    entries: byDay[day.key] ?? [],
                    schedulesByID: schedulesByID, todayKey: todayKey,
                    label: labels[day.key] ?? day.key)
            }
        }
    }

    private func calendarMerchant(name: String, logoURL: String?)
        -> some View
    {
        let initials = Text(TransactionCalendarInitials.text(for: name))
            .font(.system(size: 8, weight: .bold, design: .rounded))
            .foregroundStyle(KualiaPalette.ink)
            .frame(width: 18, height: 18)
            .background(KualiaPalette.surface, in: Circle())
            .overlay {
                Circle().strokeBorder(KualiaPalette.border, lineWidth: 0.5)
            }
        return Group {
            if let logoURL, !logoURL.isEmpty, let url = URL(string: logoURL) {
                TransactionMerchantLogo(url: url) { initials }
            } else {
                initials
            }
        }
        .frame(width: 18, height: 18)
        .clipShape(Circle())
    }

    private func dayLabels(calendar: Calendar, days: [PlannedCalendarGrid.Day]) -> [String: String]
    {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("EEEE MMMM d yyyy")
        return Dictionary(
            uniqueKeysWithValues: days.map { day in
                (day.key, formatter.string(from: day.date))
            })
    }

    private func dayButton(
        day: Int, key: String, isCurrentMonth: Bool, entries: [PlannedOccurrence],
        schedulesByID: [String: PlannedSchedule], todayKey: String, label: String
    ) -> some View {
        let selected = key == selectedDate
        let isToday = key == todayKey
        let statuses = PlannedStatus.allCases.filter { status in
            entries.contains { $0.coverage.status == status }
        }
        let merchantPreview = TransactionCalendarDayPreview(
            planned: entries)
        let dayAccent =
            showsMerchantLogos && merchantPreview.hasOverdue
            ? KualiaPalette.budgetNegative : PlannedStyle.accent
        let preview = previewDates.contains(key)
        return Button {
            onSelect(key)
        } label: {
            VStack(spacing: 4) {
                Text(day.formatted())
                    .font(
                        .system(
                            .subheadline, design: .rounded,
                            weight: selected || isToday ? .bold : .medium)
                    )
                    .foregroundStyle(
                        selected
                            ? KualiaPalette.surface
                            : showsMerchantLogos && merchantPreview.hasOverdue
                                ? dayAccent
                                : isToday
                                    ? PlannedStyle.accent
                                    : isCurrentMonth ? KualiaPalette.ink : KualiaPalette.mutedInk)
                if showsMerchantLogos {
                    let preview = merchantPreview
                    HStack(spacing: -5) {
                        ForEach(preview.visible) { entry in
                            calendarMerchant(
                                name: schedulesByID[entry.scheduledTransactionId]?.name ?? "",
                                logoURL: schedulesByID[entry.scheduledTransactionId]?
                                    .merchantLogoUrl
                            )
                            .overlay(alignment: .bottomTrailing) {
                                if entry.coverage.status == .paid
                                    || entry.coverage.status == .overdue
                                {
                                    Circle().fill(entry.coverage.status.color)
                                        .frame(width: 8, height: 8)
                                }
                            }
                        }
                        if preview.additionalCount > 0 {
                            Text("+\(preview.additionalCount)")
                                .font(.system(size: 9, weight: .bold, design: .rounded))
                                .foregroundStyle(
                                    selected ? KualiaPalette.surface : PlannedStyle.accent
                                )
                                .frame(width: 18, height: 18)
                                .background(
                                    selected ? PlannedStyle.accent : KualiaPalette.surface,
                                    in: Circle())
                        }
                    }
                    .frame(height: 20)
                    .accessibilityHidden(true)
                } else {
                    HStack(spacing: 3) {
                        ForEach(statuses.prefix(3)) { status in
                            Circle().fill(selected ? KualiaPalette.surface : status.color).frame(
                                width: 4, height: 4)
                        }
                        if statuses.isEmpty, preview {
                            Circle().fill(selected ? KualiaPalette.surface : PlannedStyle.accent)
                                .frame(
                                    width: 4, height: 4)
                        }
                    }
                    .frame(height: 4)
                }
            }
            .frame(maxWidth: .infinity, minHeight: showsMerchantLogos ? 60 : 46)
            .background(
                selected
                    ? dayAccent
                    : preview
                        ? PlannedStyle.accent.opacity(0.10)
                        : showsMerchantLogos && !entries.isEmpty
                            ? dayAccent.opacity(merchantPreview.hasOverdue ? 0.10 : 0.05) : .clear,
                in: RoundedRectangle(cornerRadius: 15)
            )
            .overlay {
                if isToday && !selected {
                    RoundedRectangle(cornerRadius: 15).strokeBorder(
                        dayAccent.opacity(0.5), lineWidth: 1)
                }
            }
            .opacity(isCurrentMonth || selected || isToday ? 1 : 0.6)
            .contentShape(Rectangle())
        }
        .buttonStyle(KualiaHapticButtonStyle(appearance: PlannedDayButtonStyle()))
        .disabled(latestDate.map { key > $0 } ?? false)
        .opacity(latestDate.map { key > $0 } == true ? 0.3 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(
            (entries.isEmpty
                ? (preview ? L10n.string("Repeating occurrence") : L10n.string("No transactions"))
                : (statuses.map { status in
                    "\(entries.filter { $0.coverage.status == status }.count) \(status.title.lowercased())"
                }).joined(
                    separator: ", "))
        )
        .accessibilityHint(
            showsMerchantLogos
                ? L10n.string("Open this day, or add a transaction if it is empty")
                : L10n.string("Select date")
        )
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("planned.day.\(key)")
    }
}

struct PlannedMonthNavigation: View {
    let month: Int
    var canGoBack = true
    var canGoForward = true
    let onChange: (Int) -> Void
    var body: some View {
        HStack {
            Button {
                onChange(-1)
            } label: {
                KualiaIconImage(icon: .chevronLeft, size: 18).frame(width: 44, height: 44)
            }
            .disabled(!canGoBack)
            .accessibilityLabel(L10n.string("Previous month"))
            Text(BudgetMonth.title(month))
                .font(.system(.headline, design: .rounded, weight: .bold))
                .frame(maxWidth: .infinity)
                .contentTransition(.numericText())
                .accessibilityAddTraits(.isHeader)
            Button {
                onChange(1)
            } label: {
                KualiaIconImage(icon: .chevronRight, size: 18).frame(width: 44, height: 44)
            }
            .disabled(!canGoForward)
            .accessibilityLabel(L10n.string("Next month"))
        }
        .buttonStyle(.kualiaHaptic)
        .foregroundStyle(KualiaPalette.ink)
    }
}

/// Uses the same cached merchant artwork as the transaction feed.
struct PlannedMerchantAvatar: View {
    let schedule: PlannedSchedule?
    var size: CGFloat = 34

    var body: some View {
        Group {
            if let rawURL = schedule?.merchantLogoUrl, let url = URL(string: rawURL),
                schedule?.isTransfer != true
            {
                TransactionMerchantLogo(url: url) { fallback }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var fallback: some View {
        ZStack {
            PlannedStyle.accent.opacity(0.12)
            if schedule?.isTransfer == true {
                KualiaIconImage(icon: .transfer, size: 18).font(
                    .system(size: size * 0.4, weight: .semibold))
            } else {
                Text(String(schedule?.name.prefix(1) ?? "?").uppercased())
                    .font(.system(size: size * 0.44, weight: .bold, design: .rounded))
            }
        }.foregroundStyle(PlannedStyle.accent)
    }
}

/// Keeps finger-driven scroll state local; the rest of Planned updates only after settling.
struct PlannedCalendarPager: View {
    let store: PlannedStore
    let onSelectDay: (String) -> Void
    @State private var position = ScrollPosition(idType: Int.self)
    @Environment(\.plannedMonthPaging) private var sharedPaging
    @State private var localPaging = BudgetMonthPaging()
    private var paging: BudgetMonthPaging { sharedPaging ?? localPaging }
    @State private var pendingSwipe: BudgetMonthPaging.Selection?

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(store.calendarMonths, id: \.self) { month in
                    PlannedCalendarLazyPage(
                        store: store, month: month, onSelectDay: onSelectDay
                    )
                    .padding(.horizontal, 18)
                    .containerRelativeFrame(.horizontal)
                    .id(month)
                    .accessibilityHidden(month != store.selectedMonth)
                    // Neighboring months keep their normal appearance during
                    // a swipe. Day sheets handle loading independently, so a
                    // refresh must not disable the selected calendar either.
                    .allowsHitTesting(month == store.selectedMonth)
                }
            }.scrollTargetLayout()
        }
        .scrollPosition($position)
        .scrollTargetBehavior(.paging)
        .scrollIndicators(.hidden)
        .onAppear { if position.viewID(type: Int.self) != store.selectedMonth { alignMonth() } }
        // Rebase the five-page window only after the native swipe has settled.
        .onChange(of: store.selectedMonth) { _, _ in alignMonth() }
        .onChange(of: store.data?.availableRange) { _, _ in alignMonth() }
        .onScrollGeometryChange(for: BudgetMonthPaging.Geometry.self) { geometry in
            .init(
                offset: geometry.contentOffset.x + geometry.contentInsets.leading,
                width: geometry.containerSize.width)
        } action: { _, geometry in
            let months = store.calendarMonths
            guard let first = months.first, let last = months.last else { return }
            paging.update(geometry, firstMonth: first, lastMonth: last)
        }
        .onScrollPhaseChange { _, phase in
            if phase == .interacting { paging.beginUserScroll() }
            if phase == .idle {
                pendingSwipe = paging.finishUserScroll(
                    selectedMonth: store.selectedMonth, workspaceID: store.workspace.id)
            } else {
                paging.isScrolling = true
            }
        }
        .task(id: pendingSwipe) {
            guard !Task.isCancelled, let request = pendingSwipe,
                request.sourceMonth == store.selectedMonth,
                request.workspaceID == store.workspace.id
            else { return }
            store.selectMonth(request.destinationMonth)
        }
        .onDisappear {
            pendingSwipe = nil
            paging.cancelSwipe()
        }
        .accessibilityScrollAction { edge in
            if edge == .leading {
                store.selectMonth(BudgetMonth.offset(store.selectedMonth, by: -1))
            }
            if edge == .trailing {
                store.selectMonth(BudgetMonth.offset(store.selectedMonth, by: 1))
            }
        }
        .accessibilityIdentifier("planned.calendarPager")
    }

    private func alignMonth() {
        pendingSwipe = nil
        paging.cancelSwipe()
        paging.align(to: store.selectedMonth)
        position.scrollTo(id: store.selectedMonth, anchor: .leading)
    }
}

/// Resolve projections inside the lazy child, rather than while constructing pager rows.
/// Months that SwiftUI hasn't mounted do not need a calendar snapshot yet.
private struct PlannedCalendarLazyPage: View {
    let store: PlannedStore
    let month: Int
    let onSelectDay: (String) -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        var calendar = Calendar.current
        calendar.locale = locale
        calendar.firstWeekday = Calendar.current.firstWeekday
        return PlannedCalendarPageView(
            page: store.calendarPage(in: month, firstWeekday: calendar.firstWeekday),
            workspace: store.workspace,
            today: store.today, onSelectDay: onSelectDay
        ).equatable()
    }
}

/// A cached page keeps unrelated parent scroll updates out of the calendar's grid body.
struct PlannedCalendarPageView: View, Equatable {
    let page: PlannedCalendarPage
    let workspace: TransactionFeedWorkspace
    let today: String
    let onSelectDay: (String) -> Void

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.page.id == rhs.page.id && lhs.workspace == rhs.workspace && lhs.today == rhs.today
    }

    var body: some View { calendar }

    var calendar: PlannedCalendar {
        PlannedCalendar(
            month: page.month, workspace: workspace, selectedDate: nil,
            entries: page.entries, schedules: page.schedules,
            showsMerchantLogos: true, today: today,
            firstWeekday: page.firstWeekday, onSelect: onSelectDay)
    }
}

private struct PlannedDayButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                PlannedStyle.accent.opacity(configuration.isPressed ? 0.16 : 0),
                in: RoundedRectangle(cornerRadius: 15)
            )
            .animation(
                reduceMotion ? nil : .easeOut(duration: 0.08), value: configuration.isPressed
            )
    }
}

extension EnvironmentValues {
    @Entry var plannedMonthPaging: BudgetMonthPaging? = nil
}
