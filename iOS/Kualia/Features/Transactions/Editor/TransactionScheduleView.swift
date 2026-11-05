import SwiftUI

struct TransactionScheduleCard: View {
    let date: String
    let recurrence: TransactionEditorRecurrence
    let isPlanned: Bool
    let entryMode: TransactionEditorEntryMode
    let summary: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label(
                        isPlanned
                            ? L10n.string("PLANNED TRANSACTION") : L10n.string("WHEN & REPEAT"),
                        icon: recurrence.calendarIcon
                    )
                    .font(.system(.caption2, weight: .bold)).tracking(1)
                    Spacer()
                    KualiaIconImage(icon: .arrowRight, size: 12).font(.caption.weight(.semibold))
                }
                .foregroundStyle(isPlanned ? PlannedStyle.accent : KualiaPalette.mutedInk)
                VStack(alignment: .leading, spacing: 6) {
                    Text(date).font(.system(.title3, design: .rounded, weight: .bold))
                    HStack(spacing: 12) {
                        Text(recurrence == .once ? L10n.string("One time") : recurrence.title)
                        if isPlanned {
                            Text(
                                entryMode == .automatic
                                    ? L10n.string("Auto-add") : L10n.string("You confirm"))
                        }
                    }
                    .font(.caption.weight(.medium)).foregroundStyle(KualiaPalette.mutedInk)
                }
                if isPlanned || recurrence != .once {
                    Text(summary).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(
                isPlanned ? PlannedStyle.accent.opacity(0.08) : KualiaPalette.surface,
                in: RoundedRectangle(cornerRadius: 24)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 24).strokeBorder(
                    isPlanned
                        ? PlannedStyle.accent.opacity(0.22) : KualiaPalette.border.opacity(0.3),
                    lineWidth: 1)
            }
        }
        .buttonStyle(.kualiaHaptic)
        .foregroundStyle(KualiaPalette.ink)
        .accessibilityHint(
            L10n.string("Choose a date, repeat pattern, and how the transaction is added")
        )
        .accessibilityIdentifier("transaction.schedule")
    }
}

struct TransactionEditorDateSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var draft: TransactionEditorDraft
    let workspace: TransactionFeedWorkspace
    let allowsScheduling: Bool
    var isEditingPlan = false
    var isCreating = false
    var anchorDate: String?
    var originalDate: String?
    @State private var month: Int
    @State private var showsMoreRepeats = false

    init(
        draft: Binding<TransactionEditorDraft>, workspace: TransactionFeedWorkspace,
        allowsScheduling: Bool, isEditingPlan: Bool = false, isCreating: Bool = false,
        anchorDate: String? = nil, originalDate: String? = nil
    ) {
        _draft = draft
        self.workspace = workspace
        self.allowsScheduling = allowsScheduling
        self.isEditingPlan = isEditingPlan
        self.isCreating = isCreating
        self.anchorDate = anchorDate
        self.originalDate = originalDate
        _month = State(initialValue: PlannedDates.month(draft.wrappedValue.dateKey))
    }

    private var today: String { TransactionEditorDate.today(workspace: workspace) }
    private var isFuture: Bool { draft.dateKey > today }
    private var isPlanned: Bool { isEditingPlan || isFuture || draft.recurrence != .once }
    private var preview: [String] {
        PlannedDates.preview(
            from: draft.dateKey, recurrence: draft.recurrence,
            anchor: draft.dateKey == originalDate ? anchorDate : nil, workspace: workspace)
    }
    private let common: [TransactionEditorRecurrence] = [
        .once, .weekly, .everyOtherWeek, .monthly, .yearly,
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(
                            isEditingPlan
                                ? L10n.string("Set the next date.") : L10n.string("Give it a date.")
                        )
                        .font(.system(.title, design: .rounded, weight: .bold))
                        Text(
                            allowsScheduling
                                ? L10n.string("Once for a plan. Repeat for a rhythm.")
                                : L10n.string("Choose when this transaction happened.")
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    dateShortcuts
                    VStack(spacing: 6) {
                        PlannedMonthNavigation(month: month) { offset in changeMonth(offset) }
                        PlannedCalendar(
                            month: month, workspace: workspace, selectedDate: draft.dateKey,
                            previewDates: Set(preview), latestDate: allowsScheduling ? nil : today,
                            onSelect: selectDate)
                    }
                    .padding(12)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 35).onEnded { value in
                            guard abs(value.translation.width) > abs(value.translation.height) * 1.5
                            else { return }
                            let forward =
                                (value.translation.width < 0) != (layoutDirection == .rightToLeft)
                            changeMonth(forward ? 1 : -1)
                        })

                    if allowsScheduling {
                        repeatSection
                        if isPlanned {
                            previewSection
                            entrySection
                        }
                    }
                    Label(
                        outcome,
                        icon: isPlanned ? .calendarCheck : .checkCircle
                    )
                    .font(.subheadline)
                    .foregroundStyle(isPlanned ? PlannedStyle.accent : KualiaPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        PlannedStyle.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 20))
                }
                .padding(20)
            }
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("When & repeat"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Done")) { dismiss() }.fontWeight(.bold)
                }
            }
        }
        .foregroundStyle(KualiaPalette.ink)
        .tint(PlannedStyle.accent)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var dateShortcuts: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                shortcut(L10n.string("Today"), offset: 0)
                if allowsScheduling {
                    shortcut(L10n.string("Tomorrow"), offset: 1)
                    shortcut(L10n.string("In a week"), offset: 7)
                } else {
                    shortcut(L10n.string("Yesterday"), offset: -1)
                }
            }
        }.scrollIndicators(.hidden)
            .modifier(HorizontalFilterScrollEdges())
    }

    private func shortcut(_ title: String, offset: Int) -> some View {
        let calendar = TransactionEditorDate.calendar(workspace: workspace)
        let key = TransactionEditorDate.key(
            from: calendar.date(byAdding: .day, value: offset, to: Date()) ?? Date(),
            workspace: workspace)
        return Button {
            selectDate(key)
        } label: {
            Text(title).font(.subheadline.weight(.semibold))
                .padding(.horizontal, 18).frame(minHeight: 44)
                .foregroundStyle(draft.dateKey == key ? KualiaPalette.surface : KualiaPalette.ink)
                .background(
                    draft.dateKey == key ? PlannedStyle.accent : KualiaPalette.surface,
                    in: Capsule())
        }.buttonStyle(.kualiaHaptic)
    }

    private var repeatSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.string("Repeat frequency")).font(
                .system(.headline, design: .rounded, weight: .bold))
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 9) {
                ForEach(common) { recurrence in repeatButton(recurrence) }
                Button {
                    withAnimation(reduceMotion ? nil : .snappy) { showsMoreRepeats.toggle() }
                } label: {
                    Label(
                        showsMoreRepeats
                            ? L10n.string("Fewer options") : L10n.string("More options"),
                        icon: .dots
                    )
                    .font(.subheadline.weight(.medium)).frame(maxWidth: .infinity, minHeight: 48)
                }.buttonStyle(.kualiaHaptic)
            }
            if showsMoreRepeats || !common.contains(draft.recurrence) {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 9) {
                    ForEach(TransactionEditorRecurrence.allCases.filter { !common.contains($0) }) {
                        recurrence in
                        repeatButton(recurrence)
                    }
                }
            }
        }
    }

    private func repeatButton(_ recurrence: TransactionEditorRecurrence) -> some View {
        let selected = draft.recurrence == recurrence
        return Button {
            draft.recurrence = recurrence
        } label: {
            HStack(spacing: 8) {
                Text(
                    recurrence == .once
                        ? L10n.string("Just once")
                        : recurrence == .everyOtherWeek
                            ? L10n.string("Every 2 weeks") : recurrence.title
                )
                .font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if selected { KualiaIconImage(icon: .check, size: 12).font(.caption.weight(.bold)) }
            }
            .padding(.horizontal, 14).padding(.vertical, 10).frame(minHeight: 48)
            .foregroundStyle(selected ? PlannedStyle.accent : KualiaPalette.ink)
            .background(
                selected ? PlannedStyle.accent.opacity(0.12) : KualiaPalette.surface,
                in: RoundedRectangle(cornerRadius: 16))
        }.buttonStyle(.kualiaHaptic).accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var previewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                draft.recurrence == .once
                    ? L10n.string("On the calendar") : L10n.string("Your next dates")
            )
            .font(.system(.headline, design: .rounded, weight: .bold))
            HStack(spacing: 8) {
                ForEach(Array(preview.enumerated()), id: \.element) { index, key in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(index == 0 ? (isEditingPlan ? "NEXT" : "START") : "THEN")
                            .font(.system(.caption2, weight: .bold)).tracking(1)
                            .foregroundStyle(KualiaPalette.mutedInk)
                        Text(PlannedDates.label(key, workspace: workspace))
                            .font(.system(.body, design: .rounded, weight: .bold))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                }
            }
            if draft.recurrence == .twiceAMonth {
                Text(
                    L10n.string(
                        "Two dates each month, 15 days apart. Short months use the last available day."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            } else if Int(draft.dateKey.suffix(2)) ?? 0 > 28, draft.recurrence != .once {
                Text(
                    L10n.string(
                        "Shorter months use their last day, then return to your original date.")
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    private var entrySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.string("When it's due")).font(
                .system(.headline, design: .rounded, weight: .bold))
            entryChoice(
                .manual, title: L10n.string("I'll confirm it"),
                subtitle: L10n.string("Stays in Planned until you record it."), symbol: .handTap)
            entryChoice(
                .automatic, title: L10n.string("Add automatically"),
                subtitle: L10n.string("Kualia records it on the due date."), symbol: .bolt)
            Text(
                L10n.string(
                    "This only records a transaction in Kualia. It doesn't send a payment or move money at your bank."
                )
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        }
    }

    private func entryChoice(
        _ mode: TransactionEditorEntryMode, title: String, subtitle: String, symbol: KualiaIcon
    ) -> some View {
        Button {
            draft.entryMode = mode
        } label: {
            HStack(spacing: 12) {
                KualiaIconImage(icon: symbol, size: 18).frame(width: 24)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(subtitle).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }.frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: draft.entryMode == mode ? .checkCircle : .circle, size: 18)
            }
            .padding(16)
            .foregroundStyle(draft.entryMode == mode ? PlannedStyle.accent : KualiaPalette.ink)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
        }.buttonStyle(.kualiaHaptic).accessibilityAddTraits(
            draft.entryMode == mode ? .isSelected : [])
    }

    private var outcome: String {
        if isEditingPlan {
            return
                L10n.string(
                    "Saves the next date and repeat pattern for this plan. Past recorded entries stay the same."
                )
        }
        if isFuture {
            return
                L10n.string(
                    "This will be saved as a \(draft.recurrence == .once ? L10n.string("one-time") : L10n.string("repeating")) planned transaction."
                )
        }
        if draft.recurrence != .once {
            return L10n.string("This entry is recorded now. Its repeating plan appears in Planned.")
        }
        return
            L10n.string(
                "This is a regular transaction dated \(PlannedDates.label(draft.dateKey, workspace: workspace))."
            )
    }

    private func selectDate(_ key: String) {
        draft.dateKey = key
        // Choosing a future date explicitly communicates creation intent in this sheet.
        // Moving an existing ledger entry or re-dating a plan into the past still confirms at Save.
        draft.wantsToSchedule = isCreating && key > today
        month = PlannedDates.month(key)
    }
    private func changeMonth(_ offset: Int) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
            month = BudgetMonth.offset(month, by: offset)
        }
    }
}
