import SwiftUI

struct RuleEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var store: RulesStore
    let rule: TransactionRule?
    @State private var draft: RuleDraft
    @State private var originalDraft: RuleDraft
    @State private var submission: RuleEditorSubmission
    @State private var peekHeight: CGFloat = 112
    @State private var showsDiscardConfirmation = false
    @State private var showsConditions = false
    @State private var showsCategoryPicker = false
    @State private var showsMerchantPicker = false
    @State private var conditionsCompleted: Bool
    @State private var conditionDraft: RuleDraft

    init(store: RulesStore, rule: TransactionRule? = nil, initialDraft: RuleDraft? = nil) {
        self.store = store
        self.rule = rule
        let initial =
            initialDraft ?? rule.map {
                RuleDraft(rule: $0, currency: store.currency, minorUnit: store.minorUnit)
            } ?? RuleDraft(currency: store.currency, minorUnit: store.minorUnit)
        _draft = State(initialValue: initial)
        _originalDraft = State(initialValue: initial)
        _conditionDraft = State(initialValue: initial)
        _conditionsCompleted = State(initialValue: rule != nil && initial.hasConfiguredConditions)
        _submission = State(initialValue: RuleEditorSubmission(ruleID: rule?.id))
    }

    private var isDirty: Bool {
        draft != originalDraft || conditionDraft != originalDraft
            || submission.applyExisting != (rule == nil)
            || submission.savedDraft != nil
    }
    private var canSave: Bool {
        conditionsCompleted && draft.isValid && store.hasLoaded && store.loadError == nil
            && !store.isSaving
            && (rule == nil || isDirty)
            && (!submission.applyExisting
                || (!store.isLoadingPreview && store.previewError == nil && store.matchCount != nil))
    }

    var body: some View {
        PeekContainer(
            isCompactPresented: conditionsCompleted && !showsConditions, compactHeight: peekHeight,
            compactAlignment: .top,
            foregroundColor: conditionsCompleted && !showsConditions
                ? KualiaPalette.peekBackground : KualiaPalette.canvas
        ) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        loadingErrors
                        conditions
                        Divider()
                        actions
                        if conditionsCompleted {
                            Divider()
                            behavior
                        }
                        if let error = store.actionError {
                            RuleEditorMessage(message: error, isError: true)
                        } else if conditionsCompleted, isDirty,
                            let message = draft.validationMessage
                        {
                            RuleEditorMessage(message: message, isError: false)
                        }
                    }
                    .frame(maxWidth: 600)
                    .padding(.horizontal, 22).padding(.vertical, 20)
                    .frame(maxWidth: .infinity)
                    .disabled(store.isSaving)
                }
                .scrollDismissesKeyboard(.interactively)
                .kualiaScrollEdges(for: .top)
                .background(KualiaPalette.canvas)
                .navigationTitle(rule == nil ? L10n.string("New rule") : L10n.string("Edit rule"))
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(isPresented: $showsConditions) {
                    RuleConditionsEditor(draft: $conditionDraft, store: store)
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        KualiaCloseButton(
                            placement: .toolbar, label: L10n.string("Cancel"), action: requestClose
                        ).disabled(store.isSaving)
                            .accessibilityIdentifier("rule-editor-cancel")
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action: requestSave) {
                            if store.isSaving {
                                ProgressView().accessibilityLabel(L10n.string("Saving rule"))
                            } else {
                                Text(L10n.string("Save")).fontWeight(.semibold)
                            }
                        }
                        .disabled(!canSave).accessibilityIdentifier("rule-editor-save")
                    }
                }
            }
        } compact: {
            matchingPeek
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    peekHeight = $0
                }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .tint(KualiaPalette.ink)
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .presentationBackground(KualiaPalette.canvas)
        .interactiveDismissDisabled(isDirty || store.isSaving)
        .background {
            TransactionEditorDismissalObserver(
                isDirty: isDirty, isSaving: store.isSaving,
                onAttempt: { showsDiscardConfirmation = true })
        }
        .alert(
            submission.savedDraft == nil
                ? L10n.string("Discard your changes?") : L10n.string("Close this editor?"),
            isPresented: $showsDiscardConfirmation
        ) {
            Button(
                submission.savedDraft == nil
                    ? L10n.string("Discard changes") : L10n.string("Close"), role: .destructive
            ) {
                dismiss()
            }
            Button(L10n.string("Keep editing"), role: .cancel) {}
        } message: {
            if submission.savedDraft != nil {
                Text(
                    L10n.string(
                        "Your rule is saved. Applying to existing transactions wasn't confirmed."))
            }
        }
        .onAppear { refreshPreview() }
        .onChange(of: showsConditions) { _, presented in
            if presented {
                store.clearPreview()
            } else {
                conditionsCompleted = conditionDraft.hasConfiguredConditions
                if conditionsCompleted { draft.copyConditions(from: conditionDraft) }
                refreshPreview()
            }
        }
        .onDisappear { store.clearPreview() }
    }

    @ViewBuilder private var loadingErrors: some View {
        if let error = store.loadError {
            SettingsRetry(message: error, retry: store.reload)
        } else if !store.hasLoaded {
            ProgressView(L10n.string("Loading rules…"))
        }
        if let error = store.choicesError {
            SettingsRetry(message: error, retry: store.reloadChoices)
        }
    }

    private var conditions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.string("Conditions")).font(.headline)
            if conditionDraft.conditionKinds.isEmpty && conditionDraft.bankAccountIDs.isEmpty {
                Menu {
                    ForEach(RuleConditionKind.allCases) { kind in
                        Button(kind.title) {
                            conditionDraft.addCondition(kind)
                            showsConditions = true
                        }
                    }
                } label: {
                    HStack {
                        Text(L10n.string("Choose a condition")).font(.body.weight(.medium))
                        Spacer()
                        KualiaIconImage(icon: .chevronDown, size: 16)
                    }.frame(minHeight: 48).contentShape(Rectangle())
                }
                .accessibilityIdentifier("rule-editor-choose-condition")
            } else {
                Button {
                    showsConditions = true
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            if conditionsCompleted {
                                ForEach(Array(conditionSummary.enumerated()), id: \.offset) {
                                    _, line in
                                    Text(line).font(.subheadline)
                                }
                            } else {
                                Text(L10n.string("Finish conditions")).font(.body.weight(.medium))
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        KualiaIconImage(icon: .chevronRight, size: 16)
                    }
                    .padding(.vertical, 12).contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityIdentifier("rule-editor-conditions")
            }
        }
    }

    private var conditionSummary: [String] {
        let rule = TransactionRule(
            id: "preview", workspaceId: store.workspaceID, name: "", isActive: draft.isActive,
            priority: draft.priorityValue ?? 0, conditions: draft.conditions ?? .init(),
            actions: draft.actions)
        return RulePresentation.conditionLines(
            rule, choices: store.choices,
            currency: store.currency, minorUnit: store.minorUnit)
    }

    private func refreshPreview() {
        store.preview(conditions: conditionsCompleted && !showsConditions ? draft.conditions : nil)
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(L10n.string("Set")).font(.headline).padding(.bottom, 8)
            Button {
                showsCategoryPicker = true
            } label: {
                RuleSelectionRow(
                    title: L10n.string("Category"),
                    value: selectedName(
                        draft.categoryID, in: store.choices.categories,
                        fallback: L10n.string("Unavailable category")), icon: .category,
                    isSet: draft.categoryID != nil)
            }.buttonStyle(.plain).accessibilityIdentifier("rule-editor-category")
                .sheet(isPresented: $showsCategoryPicker) {
                    RuleChoicePicker(
                        title: L10n.string("Set category"), choices: store.choices.categories,
                        selection: singleSelection($draft.categoryID), allowsMultiple: false,
                        emptyLabel: L10n.string("Leave category unchanged"),
                        unavailableLabel: L10n.string("Unavailable category"), icon: .category)
                }
            Button {
                showsMerchantPicker = true
            } label: {
                RuleSelectionRow(
                    title: L10n.string("Merchant"),
                    value: selectedName(
                        draft.merchantID, in: store.choices.merchants,
                        fallback: L10n.string("Unavailable merchant")), icon: .shop,
                    isSet: draft.merchantID != nil)
            }.buttonStyle(.plain).accessibilityIdentifier("rule-editor-merchant")
                .sheet(isPresented: $showsMerchantPicker) {
                    RuleChoicePicker(
                        title: L10n.string("Set merchant"), choices: store.choices.merchants,
                        selection: singleSelection($draft.merchantID), allowsMultiple: false,
                        emptyLabel: L10n.string("Leave merchant unchanged"),
                        unavailableLabel: L10n.string("Unavailable merchant"), icon: .shop)
                }
        }
    }

    private var behavior: some View {
        DisclosureGroup(L10n.string("More options")) {
            VStack(alignment: .leading, spacing: 16) {
                Toggle(L10n.string("Run on future imports"), isOn: $draft.isActive)
                    .accessibilityIdentifier("rule-editor-active")
                HStack {
                    Text(L10n.string("Priority"))
                    TextField(
                        rule == nil ? L10n.string("Last") : L10n.string("Keep current"),
                        text: $draft.priority
                    )
                    .multilineTextAlignment(.trailing).keyboardType(.numbersAndPunctuation)
                    .accessibilityIdentifier("rule-editor-priority")
                }
                Text(
                    L10n.string(
                        "Lower numbers run first. Only the first matching active rule runs.")
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                Text(
                    L10n.string(
                        "Text matching ignores case. Imports use the bank's merchant name; existing transactions use their current merchant."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }.padding(.top, 14)
        }.font(.subheadline)
    }

    private var matchingPeek: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: $submission.applyExisting) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(
                        store.isSaving
                            ? L10n.string("Saving…") : L10n.string("Apply now when you save")
                    )
                    .font(.body.weight(.semibold))
                    HStack(spacing: 7) {
                        if let count = store.matchCount, !store.isLoadingPreview,
                            draft.conditions != nil
                        {
                            Text(count.formatted()).contentTransition(.numericText())
                        } else {
                            RoundedRectangle(cornerRadius: 4).fill(.white.opacity(0.18))
                                .frame(width: 38, height: 19).accessibilityLabel(
                                    L10n.string("Calculating matches"))
                        }
                        Text(L10n.string("matching transactions"))
                    }
                    .font(.body)
                    .foregroundStyle(KualiaPalette.peekMutedInk)
                }
            }
            .tint(KualiaPalette.budgetPositive)
            .accessibilityLabel(L10n.string("Apply to existing transactions when saving"))
            .accessibilityIdentifier("rule-editor-apply-now")
            .disabled(store.isSaving)
            if let error = store.previewError {
                HStack(alignment: .top) {
                    Text(error).font(.caption)
                    Button(L10n.string("Retry")) { store.preview(conditions: draft.conditions) }
                        .font(
                            .caption.bold())
                }
            }
        }
        .foregroundStyle(KualiaPalette.peekInk)
        .padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 32)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("rule-editor-match-peek")
    }
    private func selectedName(_ id: String?, in choices: [RuleChoice], fallback: String) -> String {
        guard let id else { return L10n.string("Leave unchanged") }
        return choices.first { $0.id == id }?.name ?? fallback
    }

    private func singleSelection(_ value: Binding<String?>) -> Binding<Set<String>> {
        Binding(
            get: { value.wrappedValue.map { Set([$0]) } ?? [] },
            set: { value.wrappedValue = $0.first })
    }

    private func requestClose() {
        guard !store.isSaving else { return }
        if isDirty { showsDiscardConfirmation = true } else { dismiss() }
    }

    private func requestSave() {
        guard canSave else { return }
        save()
    }

    private func save() {
        Task {
            if await store.saveFromEditor(draft: draft, submission: submission) { dismiss() }
        }
    }
}
