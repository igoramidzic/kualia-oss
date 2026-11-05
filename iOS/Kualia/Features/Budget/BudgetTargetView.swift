import SwiftUI

struct BudgetTargetView: View {
    let store: BudgetStore
    let destination: BudgetTargetDestination
    let onPresented: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft: BudgetTargetDraft
    @State private var original: BudgetTargetDraft
    @State private var existing: BudgetTarget?
    @State private var calculator: AmountCalculator
    @State private var editingContribution = false
    @State private var pad = PeekPresentation(initiallyPresented: true)
    @State private var padHeight: CGFloat = 274
    @State private var toolbarHeight: CGFloat = 74
    @State private var showsSchedule = false
    @State private var showsDiscard = false
    @State private var isSubmitting = false

    init(
        store: BudgetStore, destination: BudgetTargetDestination,
        onPresented: @escaping () -> Void = {}
    ) {
        self.store = store
        self.destination = destination
        self.onPresented = onPresented
        let target = store.targets.targets[destination.category.id]
        let workspace = destination.workspace.transactionWorkspace
        let draft = BudgetTargetDraft(
            target: target, today: TransactionEditorDate.today(workspace: workspace))
        _existing = State(initialValue: target)
        _original = State(initialValue: draft)
        _draft = State(initialValue: draft)
        _calculator = State(
            initialValue: AmountCalculator(
                amount: draft.amount ?? 0, minorUnit: workspace.minorUnit))
    }

    private var workspace: BudgetWorkspace { destination.workspace }
    private var today: String {
        TransactionEditorDate.today(workspace: workspace.transactionWorkspace)
    }
    private var isDirty: Bool { draft != original }
    private var isTargetAmountFocused: Bool { pad.isPresented && !editingContribution }
    private var isContributionFocused: Bool { pad.isPresented && editingContribution }
    private var canSave: Bool {
        !isSubmitting && store.canEditPlan && store.targets.canEdit
            && (existing == nil || isDirty)
            && draft.validationMessage(today: today, existing: existing) == nil
    }
    private var animation: Animation? { reduceMotion ? nil : .spring(duration: 0.38, bounce: 0.08) }

    var body: some View {
        PeekContainer(presentation: pad, expansionHeight: padHeight) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    amountField
                    kindChoices
                    settings
                    if isDirty,
                        let message = draft.validationMessage(today: today, existing: existing)
                    {
                        Text(message).font(.footnote).foregroundStyle(
                            KualiaPalette.budgetNegative)
                    }
                    if let message = store.targets.saveError ?? store.targets.loadError {
                        TransactionEditorNotice(message: message, isError: true)
                    }
                    if store.targets.loadError != nil {
                        Button(L10n.string("Retry targets"), action: store.targets.retry)
                            .font(.subheadline.weight(.semibold))
                    }
                    if !store.targets.hasLoaded && store.targets.loadError == nil {
                        ProgressView(L10n.string("Loading target settings"))
                    }
                    if existing != nil {
                        Button(action: deleteTarget) {
                            Label(L10n.string("Delete target"), icon: .trash)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(KualiaPalette.budgetNegative)
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .background(KualiaPalette.surface, in: Capsule())
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.kualiaHaptic)
                        .disabled(isSubmitting || !store.canEditPlan || !store.targets.canEdit)
                        .accessibilityIdentifier("budget-target-delete")
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, toolbarHeight + 20)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .kualiaScrollEdgeEffectHidden()
            .mask {
                TransactionEditorScrollFade(
                    topInset: toolbarHeight, fadeHeight: 32, fadesBottom: true)
            }
            .overlay(alignment: .top) {
                header
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: {
                        toolbarHeight = $0
                    }
            }
        } expansion: {
            if let sessionID = pad.sessionID {
                AmountPad(
                    calculator: Binding(
                        get: { calculator },
                        set: { value in
                            calculator = value
                            if editingContribution {
                                draft.monthlyContribution = value.amount
                            } else {
                                draft.amount = value.amount
                            }
                            store.targets.saveError = nil
                        }), accessibilityIdentifierPrefix: "target", onDismiss: closePad,
                    onContentHeightChange: { height in
                        guard pad.acceptsMeasurement(sessionID: sessionID) else { return }
                        padHeight = height
                        if pad.isPreparing {
                            withAnimation(animation) { pad.reveal(sessionID: sessionID) }
                        }
                    }
                )
                .disabled(isSubmitting)
            }
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .tint(KualiaPalette.ink)
        .ignoresSafeArea(.container, edges: .bottom)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.canvas)
        .interactiveDismissDisabled(isDirty || isSubmitting)
        .background {
            TransactionEditorDismissalObserver(
                isDirty: isDirty, isSaving: isSubmitting, onAttempt: { showsDiscard = true },
                onPresented: onPresented)
        }
        .alert(L10n.string("Discard target changes?"), isPresented: $showsDiscard) {
            Button(L10n.string("Discard changes"), role: .destructive) { dismiss() }
            Button(L10n.string("Keep editing"), role: .cancel) {}
        }
        .sheet(isPresented: $showsSchedule) {
            BudgetTargetScheduleSheet(draft: $draft, workspace: workspace)
        }
        .onAppear { store.targets.saveError = nil }
        .onChange(of: store.workspace?.id) { _, id in if id != workspace.id { dismiss() } }
        .onChange(of: store.planGroups) { _, groups in
            if !groups.flatMap(\.categories).contains(where: { $0.id == destination.category.id }) {
                dismiss()
            }
        }
        .accessibilityIdentifier("budget-target")
    }

    private var header: some View {
        HStack(spacing: 12) {
            KualiaCloseButton(label: L10n.string("Close target")) {
                if isDirty { showsDiscard = true } else { dismiss() }
            }
            .disabled(isSubmitting)
            Text(existing == nil ? L10n.string("Set target") : L10n.string("Edit target"))
                .font(.headline.weight(.bold)).frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
            Button(action: save) {
                Text(L10n.string("Save")).opacity(isSubmitting ? 0 : 1)
                    .overlay { if isSubmitting { ProgressView().tint(KualiaPalette.canvas) } }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(KualiaPalette.canvas)
                    .frame(minWidth: 64, minHeight: 44)
                    .background(KualiaPalette.ink, in: Capsule())
                    .opacity(canSave || isSubmitting ? 1 : 0.3)
            }
            .buttonStyle(.kualiaHaptic).disabled(!canSave)
            .accessibilityIdentifier("budget-target-save")
        }
        .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 10)
    }

    private var amountField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(destination.category.name).font(.subheadline.weight(.semibold))
                .foregroundStyle(KualiaPalette.mutedInk)
            Button {
                openPad(contribution: false)
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(formatted(editingContribution ? draft.amount : calculator.previewAmount))
                        .font(.system(size: 46, weight: .bold, design: .rounded))
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.4)
                        .contentTransition(.numericText())
                    if isTargetAmountFocused {
                        KualiaIconImage(icon: .pencil, size: 18)
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .accessibilityHidden(true)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic).disabled(isSubmitting)
            .accessibilityLabel(L10n.string("Target amount, \(formatted(draft.amount))"))
            .accessibilityHint(L10n.string("Opens the amount keypad"))
            .accessibilityIdentifier("budget-target-amount")
            .accessibilityAddTraits(isTargetAmountFocused ? .isSelected : [])
            AmountCalculationCaption(
                calculator: editingContribution
                    ? AmountCalculator(amount: draft.amount ?? 0, minorUnit: workspace.minorUnit)
                    : calculator,
                title: L10n.string("Target amount"), accessibilityIdentifierPrefix: "target",
                foregroundColor: isTargetAmountFocused
                    ? KualiaPalette.ink : KualiaPalette.mutedInk)
        }
    }

    private var kindChoices: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(BudgetTargetKind.allCases) { kind in
                    Button {
                        if editingContribution { openPad(contribution: false) }
                        withAnimation(reduceMotion ? nil : .snappy) { draft.kind = kind }
                        store.targets.saveError = nil
                    } label: {
                        HStack(spacing: 6) {
                            Text(kind.title).font(.subheadline.weight(.semibold))
                            Spacer(minLength: 0)
                            if draft.kind == kind { KualiaIconImage(icon: .checkCircle, size: 16) }
                        }
                        .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundStyle(
                            draft.kind == kind ? KualiaPalette.surface : KualiaPalette.ink
                        )
                        .background(
                            draft.kind == kind ? KualiaPalette.ink : KualiaPalette.surface,
                            in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityAddTraits(draft.kind == kind ? .isSelected : [])
                    .accessibilityHint(kind.explanation)
                    .accessibilityIdentifier("budget-target-kind-\(kind.rawValue)")
                }
            }
            Text(draft.kind.explanation).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .disabled(isSubmitting)
    }

    @ViewBuilder
    private var settings: some View {
        if draft.kind == .maintainBalance {
            TransactionEditorGroup {
                TransactionEditorField(
                    title: L10n.string("Monthly contribution"),
                    value: formatted(draft.monthlyContribution),
                    symbol: .money, valueIcon: isContributionFocused ? .pencil : nil
                ) {
                    openPad(contribution: true)
                }
                .accessibilityAddTraits(isContributionFocused ? .isSelected : [])
            }
            .disabled(isSubmitting)
            Text(
                L10n.string(
                    "Choose how much to add each month. Funding stops once the balance reaches your target."
                )
            )
            .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
        } else {
            Button {
                closePad()
                showsSchedule = true
            } label: {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label(
                            draft.kind == .oneTime
                                ? L10n.string("TARGET DATE") : L10n.string("WHEN & REPEAT"),
                            icon: draft.kind.repeats ? .calendarRepeating : .calendarFilled
                        )
                        .font(.caption2.weight(.bold)).tracking(1)
                        Spacer()
                        KualiaIconImage(icon: .arrowUpRight, size: 14)
                    }.foregroundStyle(KualiaPalette.mutedInk)
                    Text(
                        draft.kind == .oneTime
                            ? dateLabel(draft.targetDate)
                            : draft.frequency.title(interval: draft.interval)
                    )
                    .font(.title3.weight(.bold))
                    Text(scheduleDetail).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                }
                .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
            }
            .buttonStyle(.kualiaHaptic).disabled(isSubmitting)
            .accessibilityIdentifier("budget-target-schedule")
        }
    }

    private var scheduleDetail: String {
        if draft.kind == .oneTime { return L10n.string("Save up by this date.") }
        if draft.frequency == .weekly {
            return
                L10n.string(
                    "Due \(locale.calendar.weekdaySymbols[min(max(draft.dayOfWeek, 0), 6)]) · Starts \(dateLabel(draft.firstDueDate))"
                )
        }
        if draft.frequency == .monthly {
            return
                L10n.string(
                    "Due \(draft.dueDay == -1 ? L10n.string("at the end of the month") : L10n.string("on day \(draft.dueDay ?? Int(draft.firstDueDate.suffix(2)) ?? 1)")) · Starts \(dateLabel(draft.firstDueDate))"
                )
        }
        return L10n.string("First due \(dateLabel(draft.firstDueDate))")
    }

    private func dateLabel(_ key: String) -> String {
        guard
            let date = TransactionEditorDate.date(
                from: key, workspace: workspace.transactionWorkspace)
        else { return key }
        return date.formatted(
            Date.FormatStyle(
                date: .abbreviated, time: .omitted, locale: locale,
                timeZone: TransactionEditorDate.calendar(workspace: workspace.transactionWorkspace)
                    .timeZone))
    }

    private func formatted(_ amount: Int64?) -> String {
        guard let amount else { return "—" }
        return MoneyAmountFormatter.string(
            minorUnits: amount, currencyCode: workspace.currencyCode,
            minorUnit: workspace.minorUnit, showsPositiveSign: false, usesAbsoluteValue: false,
            locale: locale)
    }

    private func openPad(contribution: Bool) {
        if editingContribution != contribution || pad.sessionID == nil {
            calculator = AmountCalculator(
                amount: (contribution ? draft.monthlyContribution : draft.amount) ?? 0,
                minorUnit: workspace.minorUnit)
            // Switching fields must not turn an invalid expression into a saved old value.
            if contribution {
                draft.monthlyContribution = calculator.amount
            } else {
                draft.amount = calculator.amount
            }
        }
        editingContribution = contribution
        if !pad.isPresented { withTransaction(Transaction(animation: nil)) { pad.prepare() } }
    }

    private func closePad() {
        guard let id = pad.sessionID else { return }
        withAnimation(animation, completionCriteria: .removed) {
            pad.beginClosing()
        } completion: {
            pad.finishClosing(sessionID: id)
        }
    }

    private func deleteTarget() {
        guard let existing, !isSubmitting, store.canEditPlan, store.targets.canEdit else { return }
        closePad()
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            if await store.targets.delete(
                categoryID: destination.category.id, workspaceID: workspace.id, expected: existing)
            {
                dismiss()
            }
        }
    }

    private func save() {
        guard canSave else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            if await store.targets.save(
                draft: draft, categoryID: destination.category.id, workspaceID: workspace.id,
                expected: existing, today: today)
            {
                dismiss()
            }
        }
    }
}

extension BudgetWorkspace {
    var transactionWorkspace: TransactionFeedWorkspace {
        .init(
            id: id, name: name, currencyCode: currencyCode, minorUnit: minorUnit,
            timezoneIdentifier: timezoneIdentifier)
    }
}

private struct BudgetTargetScheduleSheet: View {
    @Binding var draft: BudgetTargetDraft
    let workspace: BudgetWorkspace
    @Environment(\.dismiss) private var dismiss
    @State private var month: Int

    init(draft: Binding<BudgetTargetDraft>, workspace: BudgetWorkspace) {
        _draft = draft
        self.workspace = workspace
        let value = draft.wrappedValue
        _month = State(
            initialValue: PlannedDates.month(
                value.kind == .oneTime ? value.targetDate : value.firstDueDate))
    }

    private var selectedDate: String {
        draft.kind == .oneTime ? draft.targetDate : draft.firstDueDate
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(
                            draft.kind == .oneTime
                                ? L10n.string("Give it a date.") : L10n.string("Repeat frequency")
                        )
                        .font(.title.weight(.bold))
                        Text(
                            draft.kind == .oneTime
                                ? L10n.string("When would you like this money ready?")
                                : L10n.string(
                                    "Choose when this target starts and how often to fund it.")
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    if draft.kind.repeats { repeatChoices }
                    Text(
                        draft.kind == .oneTime
                            ? L10n.string("Target date") : L10n.string("First due date")
                    ).font(.headline)
                    VStack(spacing: 6) {
                        PlannedMonthNavigation(month: month) {
                            month = BudgetMonth.offset(month, by: $0)
                        }
                        PlannedCalendar(
                            month: month, workspace: workspace.transactionWorkspace,
                            selectedDate: selectedDate
                        ) { key in
                            if draft.kind == .oneTime {
                                draft.targetDate = key
                            } else {
                                draft.firstDueDate = key
                            }
                        }
                    }
                    .padding(12).background(
                        KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
                    if draft.kind == .oneTime,
                        draft.targetDate
                            <= TransactionEditorDate.today(
                                workspace: workspace.transactionWorkspace)
                    {
                        Text(L10n.string("Choose a future date for a new deadline.")).font(
                            .footnote
                        )
                        .foregroundStyle(KualiaPalette.budgetNegative)
                    }
                }.padding(20)
            }
            .background(KualiaPalette.canvas)
            .navigationTitle(
                draft.kind == .oneTime ? L10n.string("Target date") : L10n.string("When & repeat")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Done")) { dismiss() }.fontWeight(.bold)
                }
            }
        }
        .fontDesign(.rounded).foregroundStyle(KualiaPalette.ink).tint(KualiaPalette.ink)
        .presentationDetents([.large]).presentationDragIndicator(.visible)
    }

    private var repeatChoices: some View {
        VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(BudgetTargetFrequency.allCases) { frequency in
                    Button {
                        draft.frequency = frequency
                    } label: {
                        Text(frequency.title).font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .foregroundStyle(
                                draft.frequency == frequency
                                    ? KualiaPalette.surface : KualiaPalette.ink
                            )
                            .background(
                                draft.frequency == frequency
                                    ? KualiaPalette.ink : KualiaPalette.surface,
                                in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.kualiaHaptic).accessibilityAddTraits(
                        draft.frequency == frequency ? .isSelected : [])
                }
            }
            Stepper(value: $draft.interval, in: 1...999) {
                Text(draft.frequency.title(interval: draft.interval))
            }.padding(16).background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
            if draft.frequency == .weekly {
                Picker(L10n.string("Due on"), selection: $draft.dayOfWeek) {
                    ForEach(0..<7, id: \.self) { day in
                        Text(L10n.locale.calendar.weekdaySymbols[day]).tag(day)
                    }
                }.pickerStyle(.menu).padding(16).background(
                    KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
            }
            if draft.frequency == .monthly {
                Picker(L10n.string("Due on"), selection: $draft.dueDay) {
                    Text(L10n.string("Use the first due date")).tag(Optional<Int>.none)
                    Text(L10n.string("Last day of the month")).tag(Optional(-1))
                    ForEach(1...31, id: \.self) { day in
                        Text(L10n.string("Day \(day)")).tag(Optional(day))
                    }
                }.pickerStyle(.menu).padding(16).background(
                    KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
            }
        }
    }
}

/// A separate trailing hit target keeps category-name editing easy to reach.
struct BudgetTargetButton: View {
    let store: BudgetTargetStore
    let category: BudgetCategory
    let workspace: BudgetWorkspace
    let action: () -> Void
    @Environment(\.locale) private var locale

    var body: some View {
        Button(action: action) {
            VStack(alignment: .trailing, spacing: 4) {
                if let target = store.targets[category.id], let amount = target.displayAmount {
                    Text(
                        MoneyAmountFormatter.string(
                            minorUnits: amount, currencyCode: workspace.currencyCode,
                            minorUnit: workspace.minorUnit, showsPositiveSign: false,
                            usesAbsoluteValue: false, locale: locale)
                    )
                    .font(.subheadline.weight(.semibold)).monospacedDigit()
                    Text(target.cadence).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                } else if store.hasLoaded {
                    Text(L10n.string("Set target")).font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(KualiaPalette.canvas, in: Capsule())
                } else {
                    Text(
                        store.loadError == nil
                            ? L10n.string("Loading…") : L10n.string("Unavailable")
                    ).font(.caption)
                        .foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            .multilineTextAlignment(.trailing)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .frame(minWidth: 80, minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic).disabled(!store.canEdit)
        .accessibilityLabel(
            L10n.string(
                "\(store.targets[category.id] == nil ? L10n.string("Set") : L10n.string("Edit")) target for \(category.name)"
            )
        )
        .accessibilityValue(
            store.targets[category.id].map {
                "\($0.displayAmount.map { MoneyAmountFormatter.string(minorUnits: $0, currencyCode: workspace.currencyCode, minorUnit: workspace.minorUnit, showsPositiveSign: false, usesAbsoluteValue: false, locale: locale) } ?? ""), \($0.cadence)"
            } ?? L10n.string("No target")
        )
        .accessibilityIdentifier("budget-plan-target-\(category.id)")
    }
}
