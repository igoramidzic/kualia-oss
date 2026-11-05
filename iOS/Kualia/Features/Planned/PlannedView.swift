import SwiftUI

struct PlannedSelection: Identifiable {
    let id: String
    var occurrence: PlannedOccurrence?
}

struct PlannedDaySelection: Identifiable {
    let id: String
}

enum PlannedMoney {
    static func string(_ amount: Decimal, workspace: TransactionFeedWorkspace) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = workspace.currencyCode
        formatter.minimumFractionDigits = workspace.minorUnit
        formatter.maximumFractionDigits = workspace.minorUnit
        let divisor = pow(Decimal(10), workspace.minorUnit)
        return formatter.string(from: NSDecimalNumber(decimal: amount / divisor)) ?? "—"
    }
}

struct PlannedRow: View {
    let schedule: PlannedSchedule
    var occurrence: PlannedOccurrence?
    let workspace: TransactionFeedWorkspace
    @Environment(\.layoutDirection) private var layoutDirection

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                PlannedMerchantAvatar(schedule: schedule, size: 34)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        merchantName.fixedSize(horizontal: true, vertical: false)
                        Spacer(minLength: 0)
                        amountLabel.fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        merchantName
                        amountLabel
                    }
                }
            }
            TransactionMetadataLayout(layoutDirection: layoutDirection) {
                if !schedule.isTransfer {
                    TransactionMetadataChip(title: schedule.categorySummary, icon: .category)
                }
                if let account = schedule.bankAccountName {
                    TransactionMetadataChip(title: account, icon: .bank)
                }
                TransactionMetadataChip(
                    title: schedule.recurrence.plannedBadgeTitle,
                    icon: schedule.recurrence.calendarIcon,
                    tint: PlannedStyle.accent
                )
                .accessibilityLabel(schedule.recurrence.title)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 9) { badges }
                VStack(alignment: .leading, spacing: 6) { badges }
            }
        }
        .padding(16).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var merchantName: some View {
        Text(schedule.name).font(.system(.subheadline, design: .rounded, weight: .semibold))
            .fixedSize(horizontal: false, vertical: true)
    }

    private var amountLabel: some View {
        Text(amount).font(.system(.body, design: .rounded, weight: .bold))
            .monospacedDigit().fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var badges: some View {
        if let occurrence {
            Label(
                occurrence.coverage.status == .paid && occurrence.isIncome
                    ? L10n.string("Received") : occurrence.coverage.status.title,
                icon: occurrence.coverage.status.symbol
            )
            .foregroundStyle(occurrence.coverage.status.color)
            .font(.system(.caption2, weight: .semibold))
        } else {
            Text(
                schedule.status == "active"
                    ? L10n.string(
                        "Next · \(PlannedDates.label(schedule.nextDate, workspace: workspace, format: "MMM d yyyy"))"
                    )
                    : PlannedSchedule.statusTitle(schedule.status)
            )
            .font(.system(.caption2, weight: .semibold)).foregroundStyle(PlannedStyle.accent)
        }

    }

    private var amount: String {
        let income = occurrence?.isIncome ?? (!schedule.isTransfer && schedule.amount > 0)
        return (income ? "+" : "")
            + PlannedMoney.string(occurrence?.amount ?? abs(schedule.amount), workspace: workspace)
    }
}

struct PlannedDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var store: PlannedStore
    let feed: TransactionFeedStore
    let selection: PlannedSelection
    @State private var editor: TransactionEditorStore?
    @State private var showsEditor = false
    @State private var action: PlannedAction?
    private var schedule: PlannedSchedule? { store.schedule(selection.id) }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let schedule {
                    VStack(alignment: .leading, spacing: 22) {
                        VStack(alignment: .leading, spacing: 10) {
                            Label(
                                schedule.isRepeating ? "REPEATING" : "ONE-TIME",
                                icon: schedule.recurrence.calendarIcon
                            )
                            .font(.system(.caption2, weight: .bold)).tracking(1).foregroundStyle(
                                PlannedStyle.accent)
                            HStack(spacing: 14) {
                                PlannedMerchantAvatar(schedule: schedule, size: 56)
                                Text(schedule.name).font(
                                    .system(.title, design: .rounded, weight: .bold)
                                )
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            Text(
                                PlannedMoney.string(
                                    selection.occurrence?.amount ?? abs(schedule.amount),
                                    workspace: store.workspace)
                            )
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .monospacedDigit()
                        }
                        if let occurrence = selection.occurrence {
                            Label(
                                "\(occurrence.coverage.status.title) · \(PlannedDates.label(occurrence.displayDate, workspace: store.workspace, format: "MMM d yyyy"))",
                                icon: occurrence.coverage.status.symbol
                            )
                            .font(.subheadline.weight(.semibold)).foregroundStyle(
                                occurrence.coverage.status.color)
                            ForEach(occurrence.coverage.linkedTransactions, id: \.transactionId) {
                                transaction in
                                Button(L10n.string("View recorded transaction")) {
                                    editor = feed.makeEditor(
                                        for: transaction.transactionId)
                                    showsEditor = editor != nil
                                }.frame(minHeight: 44).buttonStyle(.kualiaHaptic)
                            }
                        }
                        TransactionEditorGroup {
                            TransactionEditorField(
                                title: L10n.string("Next date"),
                                value: schedule.status == "active"
                                    ? PlannedDates.label(
                                        schedule.nextDate, workspace: store.workspace,
                                        format: "MMM d yyyy")
                                    : schedule.status.capitalized,
                                symbol: schedule.recurrence.calendarIcon)
                            TransactionEditorDivider()
                            TransactionEditorField(
                                title: L10n.string("Repeat"), value: schedule.recurrence.title,
                                symbol: schedule.recurrence.calendarIcon)
                            TransactionEditorDivider()
                            TransactionEditorField(
                                title: L10n.string("Entry"),
                                value: schedule.mode == .automatic
                                    ? L10n.string("Adds automatically on the due date")
                                    : L10n.string("You confirm when it's ready"), symbol: .bolt)
                            TransactionEditorDivider()
                            TransactionEditorField(
                                title: L10n.string("Account"),
                                value: schedule.bankAccountName ?? L10n.string("Selected account"),
                                symbol: .bank)
                        }
                        if let notes = schedule.notes, !notes.isEmpty {
                            Text(notes).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        }
                        if schedule.status == "active" {
                            Text(
                                L10n.string(
                                    "NEXT OCCURRENCE · \(PlannedDates.label(schedule.nextDate, workspace: store.workspace, format: "MMM d yyyy"))"
                                )
                            )
                            .font(.system(.caption2, weight: .bold)).foregroundStyle(
                                KualiaPalette.mutedInk)
                            if let occurrence = selection.occurrence,
                                occurrence.occurrenceDate != schedule.nextDate
                            {
                                Text(
                                    L10n.string(
                                        "This is a later repeat. Recording or skipping applies to the next date shown above."
                                    )
                                )
                                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                            }
                            Button {
                                action = .enter
                            } label: {
                                Label(L10n.string("Record now"), icon: .checkCircle)
                                    .frame(maxWidth: .infinity, minHeight: 50)
                                    .foregroundStyle(KualiaPalette.surface)
                                    .background(PlannedStyle.accent, in: Capsule())
                            }.font(.subheadline.weight(.semibold)).buttonStyle(.kualiaHaptic)
                        }
                        Button {
                            editor = store.makeEditor(schedule: schedule)
                            showsEditor = editor != nil
                        } label: {
                            Label(
                                schedule.status == "completed"
                                    ? L10n.string("Restart with a new date")
                                    : L10n.string("Edit transaction"),
                                icon: .preferences
                            )
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(PlannedStyle.accent.opacity(0.1), in: Capsule())
                        }.font(.subheadline.weight(.semibold)).foregroundStyle(PlannedStyle.accent)
                            .buttonStyle(.kualiaHaptic)

                        VStack(spacing: 0) {
                            if schedule.status == "active" {
                                scheduleAction(.skip, title: L10n.string("Skip next"), icon: .skip)
                                scheduleActionDivider
                                if schedule.canPause {
                                    scheduleAction(
                                        .pause, title: L10n.string("Pause schedule"), icon: .pause)
                                    scheduleActionDivider
                                }
                            } else if schedule.status == "paused" {
                                scheduleAction(
                                    .resume, title: L10n.string("Resume schedule"), icon: .refresh)
                                scheduleActionDivider
                            }
                            scheduleAction(
                                .delete, title: L10n.string("Delete scheduled transaction"),
                                icon: .trash)
                        }
                        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                        if store.busyScheduleID != nil { ProgressView().frame(maxWidth: .infinity) }
                        if let error = store.actionError {
                            Text(error).font(.subheadline).foregroundStyle(
                                KualiaPalette.budgetNegative)
                        }
                    }.padding(22).disabled(store.busyScheduleID != nil)
                } else {
                    ContentUnavailableView(
                        L10n.string("Scheduled transaction no longer available"),
                        icon: .calendarFilled)
                }
            }
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Scheduled transaction")).navigationBarTitleDisplayMode(
                .inline
            )
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Done")) { dismiss() }
                }
            }
        }
        .tint(PlannedStyle.accent).foregroundStyle(KualiaPalette.ink)
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .interactiveDismissDisabled(store.busyScheduleID != nil)
        .sheet(isPresented: $showsEditor, onDismiss: { editor = nil }) {
            if let editor { TransactionEditorView(store: editor) }
        }
        .confirmationDialog(
            actionTitle,
            isPresented: Binding(get: { action != nil }, set: { if !$0 { action = nil } }),
            titleVisibility: .visible
        ) {
            if let action {
                Button(
                    action == .delete
                        ? L10n.string("Delete scheduled transaction")
                        : action.title,
                    role: action == .delete ? .destructive : nil
                ) {
                    Task {
                        if await store.act(action, scheduleID: selection.id) {
                            dismiss()
                        }
                    }
                    self.action = nil
                }
            }
            Button(L10n.string("Cancel"), role: .cancel) { action = nil }
        } message: {
            Text(actionMessage)
        }
    }

    private var scheduleActionDivider: some View {
        Rectangle().fill(KualiaPalette.border.opacity(0.45))
            .frame(height: 0.5).padding(.leading, 56)
    }

    private func scheduleAction(
        _ selectedAction: PlannedAction, title: String, icon: KualiaIcon
    ) -> some View {
        Button(role: selectedAction == .delete ? .destructive : nil) {
            action = selectedAction
        } label: {
            HStack(spacing: 14) {
                KualiaIconImage(icon: icon, size: 22)
                    .foregroundStyle(
                        selectedAction == .delete
                            ? KualiaPalette.budgetNegative : KualiaPalette.ink
                    )
                    .accessibilityHidden(true)
                Text(title).font(.subheadline.weight(.semibold))
                    .foregroundStyle(KualiaPalette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .accessibilityHidden(true)
            }
            .padding(18).frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
    }

    private var actionTitle: String {
        switch action {
        case .enter: L10n.string("Record the next occurrence now?")
        case .skip: L10n.string("Skip the next occurrence?")
        case .pause: L10n.string("Pause this schedule?")
        case .resume: L10n.string("Resume this schedule?")
        case .delete: L10n.string("Delete this scheduled transaction?")
        case nil: L10n.string("Update scheduled transaction")
        }
    }
    private var actionMessage: String {
        switch action {
        case .enter:
            L10n.string(
                "Adds a transaction dated today and updates your Kualia balances. A repeating transaction advances to its next future date."
            )
        case .skip:
            L10n.string(
                "Leaves your balances unchanged and keeps a skipped record. A repeating transaction moves to its next future date."
            )
        case .pause: L10n.string("Stops new occurrences and automatic entry until you resume.")
        case .resume:
            L10n.string(
                "Repeating transactions resume at their next future date. A one-time transaction keeps its date."
            )
        case .delete:
            L10n.string(
                "Removes this scheduled transaction and its future repeats. Transactions already recorded stay in your accounts."
            )
        case nil: ""
        }
    }
}

struct PlannedDaySheet: View {
    let store: PlannedStore
    let feed: TransactionFeedStore
    let date: String
    @Environment(\.dismiss) private var dismiss
    @State private var selection: PlannedSelection?
    @State private var editor: TransactionEditorStore?
    @State private var emptyDayEditor: TransactionEditorStore?
    @State private var resolvedInitialRoute = false
    @State private var showsEditor = false

    private var entries: [PlannedOccurrence] { store.entries(on: date) }
    private var route: TransactionCalendarDayRoute {
        .resolve(
            hasPlans: !entries.isEmpty,
            plansLoaded: store.data != nil && !store.isLoading,
            hasError: store.errorMessage != nil)
    }

    var body: some View {
        Group {
            if let emptyDayEditor {
                TransactionEditorView(store: emptyDayEditor, onSaved: { feed.publishReceipt($0) })
            } else {
                dayContent
            }
        }
        .onChange(of: route, initial: true) { _, route in
            guard !resolvedInitialRoute, route != .loading else { return }
            if route == .create {
                resolvedInitialRoute = true
                emptyDayEditor = feed.makeCreationEditor(date: date)
            } else if !entries.isEmpty {
                resolvedInitialRoute = true
            }
        }
        .presentationDetents(emptyDayEditor == nil ? [.medium, .large] : [.large])
        .presentationDragIndicator(.visible)
        .sheet(item: $selection) { selected in
            PlannedDetailSheet(store: store, feed: feed, selection: selected)
        }
        .sheet(
            isPresented: $showsEditor, onDismiss: { editor = nil },
            content: {
                if let editor {
                    TransactionEditorView(store: editor, onSaved: { feed.publishReceipt($0) })
                }
            })
    }

    private var dayContent: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(PlannedDates.label(date, workspace: store.workspace, format: "EEEE"))
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        Text(
                            PlannedDates.label(
                                date, workspace: store.workspace, format: "MMMM d yyyy")
                        )
                        .font(.title3).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    .padding(.horizontal, 22)
                    if let error = store.errorMessage {
                        HStack {
                            Text(error).font(.caption)
                            Spacer()
                            Button(L10n.string("Retry"), action: store.retry).frame(minHeight: 44)
                        }.foregroundStyle(KualiaPalette.budgetNegative)
                            .padding(.horizontal, 22)
                    }
                    PlannedEntryNotice(store: store)
                        .padding(.horizontal, 22)
                    LazyVStack(spacing: 0) {
                        ForEach(entries) { entry in
                            if let schedule = store.schedule(entry.scheduledTransactionId) {
                                Button {
                                    selection = .init(id: schedule.id, occurrence: entry)
                                } label: {
                                    TransactionFeedRow(
                                        entry: PlannedTimelineEntry(
                                            occurrence: entry, schedule: schedule
                                        ).row,
                                        workspace: store.workspace,
                                        planStatus: entry.coverage.status,
                                        recurrence: schedule.recurrence,
                                        showsPlannedDate: false
                                    )
                                    .equatable()
                                }.buttonStyle(.kualiaHaptic)
                                    .modifier(
                                        TransactionPlannedListRow(
                                            showsSeparator: entry.id != entries.last?.id)
                                    )
                                    .accessibilityHint(L10n.string("View planned transaction"))
                            }
                        }
                    }
                    if route == .loading {
                        ProgressView(L10n.string("Loading this day…")).frame(maxWidth: .infinity)
                            .padding(.horizontal, 22)
                    }
                    if route == .create && emptyDayEditor == nil {
                        Text(
                            L10n.string("Nothing here yet. Add a transaction with the plus button.")
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        .padding(.horizontal, 22)
                    }
                }.padding(.vertical, 22)
            }
            .foregroundStyle(KualiaPalette.ink).background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Your day")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button(L10n.string("Done")) { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editor = feed.makeCreationEditor(date: date)
                        showsEditor = editor != nil
                    } label: {
                        KualiaIconImage(icon: .plus, size: 18)
                    }
                    .accessibilityLabel(L10n.string("Add a transaction for this day"))
                }
            }
        }
    }
}
