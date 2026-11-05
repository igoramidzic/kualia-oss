import SwiftUI

struct RulesView: View {
    @State var store: RulesStore
    let workspaceName: String
    @State private var editor: RuleEditorDestination?
    @State private var pendingDelete: TransactionRule?
    @State private var pendingApplication: TransactionRule?
    @State private var filter = RuleListFilter.all

    private var visibleRules: [TransactionRule] {
        store.rules.filter { filter.includes($0) }
    }

    private var showsEmptyState: Bool { store.hasLoaded && store.rules.isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                if store.hasLoaded, !showsEmptyState { introduction }
                if let error = store.loadError {
                    SettingsRetry(message: error, retry: store.reload)
                }
                if let error = store.choicesError {
                    SettingsRetry(message: error, retry: store.reloadChoices)
                }
                if let notice = store.notice {
                    Label(notice, icon: .checkCircle)
                        .font(.subheadline).foregroundStyle(KualiaPalette.budgetPositive)
                        .accessibilityIdentifier("rules-notice")
                }
                if !store.hasLoaded, store.loadError == nil {
                    ProgressView(L10n.string("Loading your rules…"))
                        .frame(maxWidth: .infinity, minHeight: 180)
                } else if store.hasLoaded, store.rules.isEmpty {
                    emptyState
                } else if store.hasLoaded {
                    ruleCollection
                }
            }
            .frame(maxWidth: 600)
            .padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 36)
            .frame(maxWidth: .infinity)
        }
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .foregroundStyle(KualiaPalette.ink)
        .kualiaScrollEdges(for: .top)
        .kualiaScrollEdges(for: .bottom)
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
            if showsEmptyState {
                Button {
                    editor = .init()
                } label: {
                    Text(L10n.string("Create your first rule"))
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .tint(KualiaPalette.ink).foregroundStyle(KualiaPalette.surface)
                .disabled(store.isSaving)
                .accessibilityIdentifier("rules-create-first")
                .frame(maxWidth: 600)
                .padding(.horizontal, 22).padding(.vertical, 12)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(L10n.string("Rules"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            if store.hasLoaded, !showsEmptyState {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.string("Create rule"), icon: .plus) { editor = .init() }
                        .labelStyle(.iconOnly)
                        .disabled(store.isSaving)
                        .accessibilityIdentifier("rules-create")
                }
            }
        }
        .sheet(item: $editor) { destination in
            RuleEditorView(store: store, rule: destination.rule)
        }
        .alert(
            L10n.string("Couldn't finish that"),
            isPresented: Binding(
                get: { store.actionError != nil && editor == nil && pendingApplication == nil },
                set: { if !$0 { store.actionError = nil } }
            )
        ) {
            Button("OK", role: .cancel) { store.actionError = nil }
        } message: {
            Text(store.actionError ?? L10n.string("Please try again."))
        }
        .alert(
            L10n.string("Delete this rule?"),
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            )
        ) {
            Button(L10n.string("Cancel"), role: .cancel) { pendingDelete = nil }
            Button(L10n.string("Delete rule"), role: .destructive) {
                guard let rule = pendingDelete else { return }
                pendingDelete = nil
                Task { _ = await store.delete(rule: rule) }
            }
        } message: {
            Text(
                L10n.string(
                    "\(pendingDelete?.name ?? L10n.string("This rule")) will stop running. Transactions it already changed stay as they are."
                )
            )
        }
        .sheet(item: $pendingApplication, onDismiss: { store.clearPreview() }) { rule in
            RuleApplySheet(store: store, rule: rule)
        }
        .onAppear { store.start() }
        .onDisappear { if editor == nil && pendingApplication == nil { store.stop() } }
        .onChange(of: store.rules.isEmpty) { _, empty in
            if empty { filter = .all }
        }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(workspaceName, icon: .workspace)
                .font(.caption.weight(.semibold)).foregroundStyle(KualiaPalette.mutedInk)
            Text(L10n.string("Less sorting.\nMore living."))
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            Text(
                L10n.string(
                    "Teach Kualia once. Rules give matching imported transactions the right merchant and category automatically."
                )
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            KualiaIconImage(icon: .bolt, size: 32)
                .foregroundStyle(KualiaPalette.mutedInk)
                .frame(width: 76, height: 76)
                .background(KualiaPalette.surface, in: Circle())
            Text(L10n.string("No rules yet"))
                .font(.system(.title2, design: .rounded, weight: .bold))
            Text(
                L10n.string(
                    "Automatically give matching imported transactions the right merchant and category."
                )
            )
            .font(.body).foregroundStyle(KualiaPalette.mutedInk)
            .frame(maxWidth: 310)
            Text(workspaceName)
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 64)
        .accessibilityIdentifier("rules-empty")
    }

    private var ruleCollection: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline) {
                Text(L10n.string("\(store.rules.filter(\.isActive).count) active"))
                    .font(.headline).fontDesign(.rounded)
                Spacer()
                Menu {
                    Picker(L10n.string("Show rules"), selection: $filter) {
                        ForEach(RuleListFilter.allCases) { value in
                            Text(value.rawValue).tag(value)
                        }
                    }
                } label: {
                    Label(filter.rawValue, icon: .filter)
                        .font(.subheadline.weight(.medium)).padding(.vertical, 10)
                }
            }
            Text(
                L10n.string(
                    "Rules run in priority order, lowest number first. The first match wins.")
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            if visibleRules.isEmpty {
                ContentUnavailableView(
                    L10n.string("No \(filter.rawValue.lowercased()) rules"), icon: .filter,
                    description: Text(L10n.string("Choose All to see the rest of your rules.")))
            }
            LazyVStack(spacing: 16) {
                ForEach(visibleRules) { rule in
                    RuleRecipeCard(
                        rule: rule,
                        conditions: RulePresentation.conditionLines(
                            rule, choices: store.choices, currency: store.currency,
                            minorUnit: store.minorUnit),
                        actions: RulePresentation.actionLines(rule, choices: store.choices),
                        isSaving: store.isSaving,
                        onEdit: { editor = .init(rule: rule) },
                        onToggle: {
                            Task { _ = await store.setActive(!rule.isActive, rule: rule) }
                        },
                        onApply: { pendingApplication = rule },
                        onDelete: { pendingDelete = rule })
                }
            }
        }
    }
}

private enum RuleListFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case active = "Active"
    case paused = "Paused"
    var id: Self { self }
    func includes(_ rule: TransactionRule) -> Bool {
        switch self {
        case .all: true
        case .active: rule.isActive
        case .paused: !rule.isActive
        }
    }
}

private struct RuleEditorDestination: Identifiable {
    let id = UUID()
    var rule: TransactionRule?
}

private struct RuleRecipeCard: View {
    let rule: TransactionRule
    let conditions: [String]
    let actions: [String]
    let isSaving: Bool
    let onEdit: () -> Void
    let onToggle: () -> Void
    let onApply: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Button(action: onEdit) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(rule.name).font(.title3.bold()).fontDesign(.rounded)
                            .foregroundStyle(KualiaPalette.ink)
                        Text(L10n.string("Priority \(rule.priority.formatted())"))
                            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }.buttonStyle(.kualiaHaptic)
                Menu {
                    Button(L10n.string("Edit rule"), icon: .pencil, action: onEdit)
                    Button(
                        rule.isActive ? L10n.string("Pause rule") : L10n.string("Enable rule"),
                        icon: rule.isActive ? .stop : .bolt, action: onToggle)
                    Button(
                        L10n.string("Apply to existing transactions"), icon: .refresh,
                        action: onApply)
                    Divider()
                    Button(role: .destructive, action: onDelete) {
                        Label(L10n.string("Delete rule"), icon: .trash)
                    }
                } label: {
                    KualiaIconImage(icon: .dots, size: 20).frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(L10n.string("Actions for \(rule.name)"))
            }
            Button(action: onEdit) {
                VStack(alignment: .leading, spacing: 14) {
                    RuleRecipeStep(
                        title: "WHEN", icon: .filter, tint: KualiaPalette.plannedGlow,
                        lines: conditions)
                    RuleRecipeConnector()
                    RuleRecipeStep(
                        title: "THEN", icon: .bolt, tint: KualiaPalette.budgetPositive,
                        lines: actions)
                }
                .padding(.vertical, 22).frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }.buttonStyle(.kualiaHaptic)
            Divider().overlay(KualiaPalette.border.opacity(0.35))
            ViewThatFits(in: .horizontal) {
                HStack {
                    statusButton
                    Spacer()
                    usage
                }
                VStack(alignment: .leading, spacing: 8) {
                    statusButton
                    usage
                }
            }.padding(.top, 12)
        }
        .padding(20)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
        .overlay {
            RoundedRectangle(cornerRadius: 26)
                .strokeBorder(
                    rule.isActive
                        ? KualiaPalette.plannedGlow.opacity(0.22)
                        : KualiaPalette.border.opacity(0.4), lineWidth: 1)
        }
        .disabled(isSaving)
        .accessibilityIdentifier("rule-\(rule.id)")
    }

    private var statusButton: some View {
        Button(action: onToggle) {
            Label(
                rule.isActive ? L10n.string("Active") : L10n.string("Paused"),
                icon: rule.isActive ? .bolt : .stop
            )
            .font(.caption.weight(.semibold))
            .foregroundStyle(
                rule.isActive ? KualiaPalette.budgetPositive : KualiaPalette.mutedInk
            )
            .frame(minHeight: 44)
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityLabel(
            "\(rule.name), \(rule.isActive ? L10n.string("active") : L10n.string("paused"))"
        )
        .accessibilityHint(
            rule.isActive ? L10n.string("Pause this rule") : L10n.string("Enable this rule"))
    }

    private var usage: some View {
        Text(
            rule.usageCount.map { L10n.string("\($0.formatted()) recorded uses") }
                ?? L10n.string("No recorded usage")
        )
        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
    }
}

struct RuleRecipeStep: View {
    let title: String
    let icon: KualiaIcon
    let tint: Color
    let lines: [String]

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            KualiaIconImage(icon: icon, size: 18)
                .foregroundStyle(tint).frame(width: 34, height: 34)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 7) {
                Text(title).font(.caption2.weight(.bold)).tracking(1.3).foregroundStyle(tint)
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    if index > 0 {
                        Text("AND").font(.caption2.weight(.bold)).foregroundStyle(
                            KualiaPalette.mutedInk)
                    }
                    Text(line).font(.subheadline.weight(.medium)).foregroundStyle(KualiaPalette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }.padding(.top, 2)
        }
        .multilineTextAlignment(.leading)
        .accessibilityElement(children: .combine)
    }
}

private struct RuleRecipeConnector: View {
    var body: some View {
        Capsule()
            .fill(
                LinearGradient(
                    colors: [
                        KualiaPalette.plannedGlow.opacity(0.45),
                        KualiaPalette.budgetPositive.opacity(0.45),
                    ],
                    startPoint: .top, endPoint: .bottom)
            )
            .frame(width: 2, height: 18).padding(.leading, 16)
            .accessibilityHidden(true)
    }
}

private struct RuleApplySheet: View {
    @Bindable var store: RulesStore
    let rule: TransactionRule
    @Environment(\.dismiss) private var dismiss

    private var ruleChanged: Bool {
        guard let current = store.rules.first(where: { $0.id == rule.id }) else { return true }
        return current.conditions != rule.conditions || current.actions != rule.actions
    }

    var body: some View {
        NavigationStack {
            SettingsCanvas {
                Text(L10n.string("Give past transactions the same treatment."))
                    .font(.title.bold()).fontDesign(.rounded)
                if let error = store.loadError {
                    SettingsRetry(message: error, retry: store.reload)
                }
                RuleRecipeStep(
                    title: L10n.string("APPLY \(rule.name.uppercased())"), icon: .refresh,
                    tint: KualiaPalette.plannedGlow,
                    lines: RulePresentation.actionLines(rule, choices: store.choices))
                if store.isLoadingPreview {
                    ProgressView(L10n.string("Checking existing transactions…"))
                } else if let error = store.previewError {
                    SettingsRetry(message: error) { store.preview(conditions: rule.conditions) }
                } else if let count = store.matchCount {
                    Text(
                        L10n.string(
                            "\(count.formatted()) matching \(count == 1 ? L10n.string("transaction") : L10n.string("transactions"))"
                        )
                    )
                    .font(.title2.bold()).fontDesign(.rounded)
                    .accessibilityIdentifier("rule-apply-count")
                }
                Text(
                    L10n.string(
                        "This updates all existing transactions that match this rule, including reviewed transactions. A category action changes the first category of a split. The count can change as new transactions arrive."
                    )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                if !rule.isActive {
                    Text(
                        L10n.string(
                            "This rule is paused. Applying it here runs it once and leaves it paused."
                        )
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                }
                if ruleChanged {
                    Text(
                        L10n.string(
                            "This rule changed while you were reviewing it. Close this sheet and open it again to review the latest version."
                        )
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.budgetNegative)
                }
                if let error = store.actionError {
                    Text(error).foregroundStyle(KualiaPalette.budgetNegative).font(.subheadline)
                }
                Button {
                    Task {
                        if await store.applyToExisting(rule: rule) != nil { dismiss() }
                    }
                } label: {
                    HStack {
                        if store.isSaving { ProgressView().tint(KualiaPalette.surface) }
                        Text(
                            store.isSaving
                                ? L10n.string("Applying…")
                                : L10n.string("Apply to matching transactions"))
                    }.frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent).tint(KualiaPalette.ink)
                .foregroundStyle(KualiaPalette.surface)
                .disabled(
                    ruleChanged || store.loadError != nil || store.isSaving
                        || store.isLoadingPreview
                        || (store.matchCount ?? 0) == 0
                        || store.previewError != nil)
            }
            .kualiaScrollEdges(for: .top)
            .navigationTitle(L10n.string("Apply rule")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    KualiaCloseButton(placement: .toolbar, label: L10n.string("Cancel")) {
                        dismiss()
                    }.disabled(store.isSaving)
                }
            }
        }
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .interactiveDismissDisabled(store.isSaving)
        .onAppear {
            store.actionError = nil
            store.preview(conditions: rule.conditions)
        }
    }
}
