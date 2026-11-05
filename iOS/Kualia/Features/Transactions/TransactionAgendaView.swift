import SwiftUI

struct TransactionAgendaView: View {
    @ScaledMetric(relativeTo: .body) private var minimumDetailHeight: CGFloat = 68
    let plans: PlannedStore
    @Binding var isExpanded: Bool
    let onSelectPlan: (PlannedSelection) -> Void

    var body: some View {
        Section {
            header
                .id("transaction-agenda")
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if isExpanded {
                if plans.data == nil || isEmpty {
                    status
                        .modifier(TransactionTimelineRow())
                } else {
                    ForEach(plans.timeline.allSections) { section in
                        TransactionFeedDayHeader(
                            date: section.id, workspace: plans.workspace
                        )
                        .modifier(
                            TransactionFeedDayHeaderRow(
                                background: PlannedStyle.transactionDateSurface)
                        )
                        .id("planned-date-\(section.id)")

                        TransactionPlannedRows(
                            plans: plans, entries: section.entries,
                            background: PlannedStyle.transactionSurface,
                            showsPlannedDate: false,
                            onSelect: onSelectPlan)
                    }
                    if !plans.pausedSchedules.isEmpty {
                        Text(L10n.string("Paused"))
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundStyle(KualiaPalette.ink)
                            .textCase(.uppercase).tracking(0.7)
                            .accessibilityAddTraits(.isHeader)
                            .modifier(
                                TransactionFeedDayHeaderRow(
                                    background: PlannedStyle.transactionDateSurface))
                        ForEach(plans.pausedSchedules) { schedule in
                            Button {
                                onSelectPlan(.init(id: schedule.id))
                            } label: {
                                if let row = schedule.pausedFeedRow {
                                    TransactionFeedRow(
                                        entry: row, workspace: plans.workspace,
                                        recurrence: schedule.recurrence, showsPlannedDate: false,
                                        isPausedPlan: true,
                                        background: PlannedStyle.transactionSurface
                                    ).equatable()
                                } else {
                                    PlannedRow(schedule: schedule, workspace: plans.workspace)
                                }
                            }
                            .buttonStyle(.kualiaHaptic)
                            .accessibilityHint(L10n.string("View planned transaction"))
                            .modifier(
                                TransactionPlannedListRow(
                                    showsSeparator: schedule.id != plans.pausedSchedules.last?.id,
                                    background: PlannedStyle.transactionSurface))
                        }
                    }
                }
            }
            if plans.latestEntry != nil || plans.actionError != nil {
                PlannedEntryNotice(store: plans).modifier(TransactionTimelineRow())
            }
        }
        .listSectionSeparator(.hidden)
    }

    private var isEmpty: Bool {
        plans.timeline.allSections.isEmpty && plans.pausedSchedules.isEmpty
    }

    private var header: some View {
        TransactionDisclosureHeader(
            title: L10n.string("Planned"), isExpanded: $isExpanded,
            identifier: "transactions.plannedHeader"
        )
        .overlay(alignment: .top) {
            TransactionRowDivider()
        }
        .overlay(alignment: .bottom) {
            if isExpanded && (plans.data == nil || isEmpty) { TransactionRowDivider() }
        }
    }

    private var status: some View {
        Group {
            if plans.data == nil && plans.errorMessage == nil {
                ProgressView(L10n.string("Loading scheduled activity…"))
            } else if plans.data == nil {
                Text(L10n.string("Scheduled activity is unavailable."))
            } else {
                Text(L10n.string("No planned transactions."))
            }
        }
        .font(.subheadline)
        .foregroundStyle(KualiaPalette.mutedInk)
        .frame(maxWidth: .infinity, minHeight: minimumDetailHeight, alignment: .leading)
    }
}

struct TransactionCalendarSection: View {
    let plans: PlannedStore
    @Binding var isExpanded: Bool
    let onSelectDay: (String) -> Void

    var body: some View {
        Section {
            TransactionDisclosureHeader(
                title: L10n.string("Calendar"), isExpanded: $isExpanded,
                identifier: "transactions.calendarHeader"
            )
            .overlay(alignment: .top) {
                TransactionRowDivider()
            }
            .id("transaction-calendar")
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            if isExpanded {
                VStack(alignment: .leading, spacing: 24) {
                    TransactionAgendaCalendar(plans: plans, onSelectDay: onSelectDay)
                    PlannedCalendarStatus(plans: plans)
                }
                .padding(.top, 8).padding(.bottom, 16)
                .modifier(TransactionTimelineRow())
            }
        }
        .listSectionSeparator(.hidden)
    }
}

private struct TransactionDisclosureHeader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let title: String
    @Binding var isExpanded: Bool
    let identifier: String

    var body: some View {
        Button {
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                isExpanded.toggle()
            }
        } label: {
            HStack(spacing: 8) {
                KualiaIconImage(icon: .chevronRight, size: 14)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .accessibilityHidden(true)
                Text(title)
                    .font(.system(.headline, design: .rounded, weight: .bold))
                Spacer(minLength: 12)
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityValue(isExpanded ? L10n.string("Expanded") : L10n.string("Collapsed"))
        .accessibilityIdentifier(identifier)
        .foregroundStyle(KualiaPalette.ink)
        .padding(.horizontal, 18)
    }
}

/// Shared native list rows retain Enter/Delete swipes in the feed and the schedule browser.
private struct TransactionPlannedRows: View {
    @Bindable var plans: PlannedStore
    let entries: [PlannedTimelineEntry]
    var background: Color = KualiaPalette.surface
    var showsPlannedDate = true
    let onSelect: (PlannedSelection) -> Void
    @State private var swipeError: String?

    var body: some View {
        ForEach(entries) { entry in
            Button {
                onSelect(.init(id: entry.schedule.id, occurrence: entry.occurrence))
            } label: {
                TransactionFeedRow(
                    entry: entry.row, workspace: plans.workspace,
                    planStatus: entry.occurrence.coverage.status,
                    recurrence: entry.schedule.recurrence, showsPlannedDate: showsPlannedDate,
                    background: background
                ).equatable()
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityHint(L10n.string("View planned transaction"))
            .id("planned-row-\(entry.id)")
            .modifier(
                TransactionPlannedListRow(
                    showsSeparator: entry.id != entries.last?.id,
                    background: background)
            )
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button {
                    perform(.enter, entry: entry)
                } label: {
                    Label(L10n.string("Enter"), icon: .check).labelStyle(.iconOnly)
                }
                .tint(PlannedStyle.accent)
                .disabled(plans.busyScheduleID != nil)
                .accessibilityLabel(L10n.string("Enter transaction"))
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button(role: .destructive) {
                    perform(.delete, entry: entry)
                } label: {
                    Label(L10n.string("Delete"), icon: .trash).labelStyle(.iconOnly)
                }
                .disabled(plans.busyScheduleID != nil)
                .accessibilityLabel(L10n.string("Delete scheduled transaction"))
                .accessibilityHint(
                    L10n.string("Deletes this scheduled transaction and its future repeats"))
            }
        }
        .alert(
            L10n.string("Couldn't update scheduled transaction"),
            isPresented: Binding(
                get: { swipeError != nil }, set: { if !$0 { swipeError = nil } })
        ) {
            Button("OK", role: .cancel) { swipeError = nil }
        } message: {
            Text(swipeError ?? L10n.string("Please try again."))
        }
    }

    private func perform(_ action: PlannedAction, entry: PlannedTimelineEntry) {
        Task {
            if !(await plans.act(
                action, scheduleID: entry.schedule.id,
                expectedNextDate: entry.occurrence.occurrenceDate))
            {
                swipeError = plans.actionError ?? L10n.string("Please try again.")
            }
        }
    }
}

struct TransactionUpcomingPlansSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var plans: PlannedStore
    let feed: TransactionFeedStore
    @State private var selection: PlannedSelection?
    @State private var daySelection: PlannedDaySelection?

    var body: some View {
        NavigationStack {
            List {
                TransactionAgendaCalendar(
                    plans: plans, onSelectDay: { daySelection = .init(id: $0) }
                )
                .padding(.top, 8).padding(.bottom, 16)
                .modifier(TransactionTimelineRow())
                PlannedCalendarStatus(plans: plans).modifier(TransactionTimelineRow())
                if !plans.timeline.overdueEntries.isEmpty {
                    Text(L10n.string("Overdue"))
                        .font(.headline).foregroundStyle(KualiaPalette.budgetNegative)
                        .padding(.vertical, 12).modifier(TransactionTimelineRow())
                    TransactionPlannedRows(
                        plans: plans, entries: plans.timeline.overdueEntries,
                        onSelect: { selection = $0 })
                }
                if plans.data != nil && plans.timeline.upcomingEntries.isEmpty {
                    Text(L10n.string("Nothing coming up."))
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .modifier(TransactionTimelineRow())
                } else if !plans.timeline.upcomingEntries.isEmpty {
                    Text(L10n.string("Upcoming"))
                        .font(.headline).foregroundStyle(KualiaPalette.ink)
                        .padding(.top, 16).modifier(TransactionTimelineRow())
                    Text(L10n.string("Next occurrence of each scheduled transaction"))
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        .padding(.vertical, 12).modifier(TransactionTimelineRow())
                    TransactionPlannedRows(
                        plans: plans, entries: plans.timeline.upcomingEntries,
                        onSelect: { selection = $0 })
                }
                if !plans.pausedSchedules.isEmpty {
                    pausedSeparator.modifier(TransactionTimelineRow())
                    ForEach(plans.pausedSchedules) { schedule in
                        Button {
                            selection = PlannedSelection(id: schedule.id)
                        } label: {
                            if let row = schedule.pausedFeedRow {
                                TransactionFeedRow(
                                    entry: row,
                                    workspace: plans.workspace, recurrence: schedule.recurrence,
                                    showsPlannedDate: false, isPausedPlan: true
                                ).equatable()
                            } else {
                                PlannedRow(schedule: schedule, workspace: plans.workspace)
                            }
                        }
                        .buttonStyle(.kualiaHaptic)
                        .foregroundStyle(KualiaPalette.ink)
                        .accessibilityHint(L10n.string("View planned transaction"))
                        .modifier(
                            TransactionPlannedListRow(
                                showsSeparator: schedule.id != plans.pausedSchedules.last?.id))
                    }
                }
            }
            .listStyle(.plain).listRowSpacing(0).listSectionSpacing(0)
            .scrollContentBackground(.hidden).background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Planned transactions"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Done")) { dismiss() }
                }
            }
        }
        .tint(PlannedStyle.accent)
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .presentationBackground(KualiaPalette.canvas)
        .sheet(item: $selection) { selected in
            PlannedDetailSheet(store: plans, feed: feed, selection: selected)
        }
        .modifier(
            PlannedCalendarPresentation(plans: plans, feed: feed, daySelection: $daySelection))
    }

    private var pausedSeparator: some View {
        HStack(spacing: 12) {
            dottedLine
            Text(L10n.string("Paused"))
                .font(.subheadline.weight(.semibold)).fixedSize()
            dottedLine
        }
        .foregroundStyle(KualiaPalette.mutedInk)
        .padding(.vertical, 20)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.string("Paused"))
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("planned-paused-separator")
    }

    private var dottedLine: some View {
        GeometryReader { geometry in
            Path { path in
                path.move(to: CGPoint(x: 0, y: 1))
                path.addLine(to: CGPoint(x: geometry.size.width, y: 1))
            }
            .stroke(style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [1, 5]))
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

struct TransactionPlannedListRow: ViewModifier {
    let showsSeparator: Bool
    var background: Color = KualiaPalette.surface

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 18)
            .background(background)
            .overlay(alignment: .bottom) {
                if showsSeparator {
                    TransactionRowDivider()
                }
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(background)
            .listRowSeparator(.hidden)
    }
}

private struct TransactionTimelineRow: ViewModifier {
    var background: Color = .clear
    func body(content: Content) -> some View {
        content
            .listRowInsets(EdgeInsets(top: 0, leading: 18, bottom: 0, trailing: 18))
            .listRowBackground(background).listRowSeparator(.hidden)
    }
}

struct PlannedEntryNotice: View {
    let store: PlannedStore
    var body: some View {
        if let receipt = store.latestEntry {
            HStack(spacing: 10) {
                KualiaIconImage(icon: .calendarCheck, size: 18).foregroundStyle(PlannedStyle.accent)
                Text(L10n.string("\(receipt.name) recorded")).font(.subheadline).frame(
                    maxWidth: .infinity, alignment: .leading)
                Button(L10n.string("Undo")) { Task { await store.undoEntry() } }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(PlannedStyle.accent)
                    .frame(minHeight: 44).disabled(store.busyScheduleID != nil).buttonStyle(
                        .kualiaHaptic)
            }.padding(.horizontal, 14).background(
                KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18)
            )
            .accessibilityElement(children: .contain)
        }
        if let error = store.actionError {
            Text(error).font(.caption).foregroundStyle(KualiaPalette.budgetNegative)
        }
    }
}

struct PlannedCalendarStatus: View {
    let plans: PlannedStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            PlannedEntryNotice(store: plans)
            if let message = plans.errorMessage {
                HStack {
                    Text(message).font(.caption)
                    Spacer(minLength: 8)
                    Button(L10n.string("Retry"), action: plans.retry).frame(minHeight: 44)
                }
                .foregroundStyle(KualiaPalette.budgetNegative)
            } else if plans.data == nil {
                ProgressView(L10n.string("Loading scheduled activity…"))
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }
}

/// Present from the stable page container, outside individual scroll/list rows.
struct PlannedCalendarPresentation: ViewModifier {
    let plans: PlannedStore?
    let feed: TransactionFeedStore?
    @Binding var daySelection: PlannedDaySelection?
    @State private var showsMonthPicker = false

    func body(content: Content) -> some View {
        content
            .environment(
                \.openPlannedMonthPicker,
                {
                    showsMonthPicker = true
                    // Keep the shared shell's widget-navigation guard informed,
                    // while only this presentation owns the sheet binding.
                    plans?.showsMonthPicker = true
                }
            )
            .sheet(isPresented: $showsMonthPicker, onDismiss: { plans?.showsMonthPicker = false }) {
                if let plans {
                    MonthPicker(
                        selectedMonth: plans.selectedMonth, currentMonth: plans.currentMonth,
                        availableRange: plans.data?.availableRange, workspaceID: plans.workspace.id,
                        identifier: "agenda-month-picker", onSelect: plans.selectMonth)
                }
            }
            .sheet(item: $daySelection) { day in
                if let plans, let feed {
                    PlannedDaySheet(store: plans, feed: feed, date: day.id)
                }
            }
            .onChange(of: plans?.workspace.id) { _, _ in
                daySelection = nil
                showsMonthPicker = false
            }
            .onDisappear {
                if showsMonthPicker { plans?.showsMonthPicker = false }
            }
    }
}

extension EnvironmentValues {
    @Entry var openPlannedMonthPicker: (() -> Void)? = nil
}

struct TransactionUpcomingRow: View {
    let schedule: PlannedSchedule
    let occurrence: PlannedOccurrence
    let workspace: TransactionFeedWorkspace
    let today: String
    var usesMerchantMark = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: 11) {
            if usesMerchantMark {
                PlannedMerchantAvatar(schedule: schedule, size: 40)
                    .overlay(alignment: .bottomTrailing) {
                        KualiaIconImage(icon: schedule.recurrence.calendarIcon, size: 18)
                            .foregroundStyle(PlannedStyle.accent)
                            .padding(2)
                            .background(KualiaPalette.surface, in: Circle())
                            .offset(x: 3, y: 3)
                    }
            } else {
                VStack(spacing: 0) {
                    Text(
                        PlannedDates.label(
                            occurrence.displayDate, workspace: workspace, format: "MMM"
                        )
                        .uppercased()
                    )
                    .font(.system(size: 9, weight: .semibold)).tracking(0.5)
                    Text(
                        PlannedDates.label(
                            occurrence.displayDate, workspace: workspace, format: "d")
                    )
                    .font(.system(.title3, design: .rounded, weight: .semibold))
                }.foregroundStyle(PlannedStyle.accent).frame(width: 40, height: 45)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 11))
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    heading
                    Spacer(minLength: 4)
                    amount
                }
                VStack(alignment: .leading, spacing: 8) {
                    heading
                    amount
                }
            }
        }.padding(.vertical, 10).frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
            .background(KualiaPalette.surface)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
            .accessibilityHint(L10n.string("View scheduled transaction and its next occurrence"))
    }
    private var heading: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(schedule.name).font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(KualiaPalette.ink).lineLimit(
                    typeSize.isAccessibilitySize ? nil : 2)
            Text(
                [
                    schedule.bankAccountName,
                    schedule.isTransfer ? L10n.string("Transfer") : schedule.categorySummary,
                ].compactMap { $0 }.joined(separator: " · ")
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk).lineLimit(
                typeSize.isAccessibilitySize ? nil : 2)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var dueLabel: String {
        let dateLabel = PlannedDates.label(
            occurrence.displayDate, workspace: workspace,
            format: occurrence.displayDate.prefix(4) == today.prefix(4)
                ? "MMM d" : "MMM d, yyyy")
        if occurrence.coverage.status == .overdue { return L10n.string("Past due · \(dateLabel)") }
        return occurrence.displayDate == today ? L10n.string("Due today") : dateLabel
    }

    private var amount: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(
                (occurrence.isIncome ? "+" : schedule.isTransfer ? "" : "−")
                    + PlannedMoney.string(occurrence.amount, workspace: workspace)
            )
            .font(.subheadline.weight(.semibold)).monospacedDigit()
            .foregroundStyle(occurrence.isIncome ? KualiaPalette.budgetPositive : KualiaPalette.ink)
            Text(
                usesMerchantMark
                    ? dueLabel
                    : occurrence.coverage.status == .overdue
                        ? L10n.string("Past due")
                        : occurrence.displayDate == today
                            ? L10n.string("Due today")
                            : PlannedDates.label(
                                occurrence.displayDate, workspace: workspace, format: "EEE")
            )
            .font(.caption).foregroundStyle(
                occurrence.displayDate <= today
                    ? KualiaPalette.budgetUnderfunded : KualiaPalette.mutedInk)
        }.fixedSize(horizontal: true, vertical: false)
    }
}

struct TransactionAgendaCalendar: View {
    @Environment(\.openPlannedMonthPicker) private var openMonthPicker
    let plans: PlannedStore
    let onSelectDay: (String) -> Void
    @State private var paging = BudgetMonthPaging()

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                monthButton
                Spacer(minLength: 0)
            }
            PlannedCalendarPager(
                store: plans, onSelectDay: onSelectDay
            )
            .frame(height: 420).padding(.horizontal, -18)
        }
        .environment(\.plannedMonthPaging, paging)
        .environment(\.budgetMonthPaging, paging)
    }
    private var monthButton: some View {
        Button {
            if let openMonthPicker { openMonthPicker() } else { plans.showsMonthPicker = true }
        } label: {
            BudgetSlidingMonthTitle(month: plans.selectedMonth, currentMonth: plans.currentMonth)
                .frame(minHeight: 44)
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityLabel(BudgetMonth.title(plans.selectedMonth))
        .accessibilityHint(L10n.string("Choose a month or year"))
    }

}
