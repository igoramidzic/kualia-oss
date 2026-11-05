import SwiftUI

struct BudgetCategoryLifecycleView: View {
    let budget: BudgetStore
    @Bindable var store: BudgetCategoryLifecycleStore
    var hasUnsavedName = false
    let onFinished: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showsDestinationPicker = false

    private var destinations: [TransactionEditorChoice] {
        budget.planGroups.flatMap { group in
            group.categories.filter { $0.id != store.category.id && $0.type != "credit_card" }.map {
                TransactionEditorChoice(
                    id: $0.id, title: $0.name, groupID: group.id,
                    groupTitle: group.categoryGroup.name)
            }
        }
    }
    private var destinationName: String? {
        destinations.first { $0.id == store.destinationID }?.title
    }
    private var isProcessing: Bool { store.phase == .processing }
    private var canConfirm: Bool {
        store.canConfirm && budget.canEditPlan
            && (!store.needsDestination || destinationName != nil)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                intro
                if store.phase == .loading {
                    ProgressView(L10n.string("Checking category…"))
                        .frame(maxWidth: .infinity, minHeight: 80)
                } else if isProcessing {
                    processingNotice
                } else if let details = store.details {
                    if store.action == .archive {
                        Text(
                            L10n.string(
                                "Available money and future assignments return to Ready to Assign. Transactions and targets stay saved."
                            )
                        )
                        .font(.body).foregroundStyle(KualiaPalette.mutedInk)
                    } else {
                        deletionDetails(details)
                    }
                    if hasUnsavedName {
                        Text(L10n.string("Your unsaved name edit won’t be applied."))
                            .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                if let error = store.errorMessage {
                    TransactionEditorNotice(message: error, isError: true)
                    if store.phase == .failed {
                        Button(L10n.string("Check again")) { Task { await store.load() } }
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .scrollIndicators(.hidden)
        .kualiaScrollEdges(for: .all)
        .kualiaSafeAreaBar(edge: .top, spacing: 0) { header }
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) { footer }
        .fontDesign(.rounded).foregroundStyle(KualiaPalette.ink).tint(KualiaPalette.ink)
        .background(KualiaPalette.canvas)
        .presentationBackground(KualiaPalette.canvas)
        .presentationDetents(store.action == .delete ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible).presentationCornerRadius(34)
        .interactiveDismissDisabled(store.phase == .saving)
        .task { await store.load() }
        .onDisappear { store.stop() }
        .onChange(of: budget.workspace?.id) { _, id in
            if id != store.workspaceID {
                store.stop()
                dismiss()
            }
        }
        .onChange(of: store.phase) { _, phase in
            if phase == .completed { finish() }
        }
        .sheet(isPresented: $showsDestinationPicker) {
            TransactionEditorPicker(
                title: L10n.string("Move transactions to"), choices: destinations,
                selectedID: store.destinationID, showsCategoryBalances: true,
                focusesSearchOnAppear: true,
                onSelect: { store.destinationID = $0 }
            )
            .environment(\.categoryPickerBudget, budget)
        }
        .accessibilityIdentifier("budget-category-lifecycle")
    }

    private var header: some View {
        HStack {
            Text(store.action.title).font(.headline.weight(.bold))
                .frame(maxWidth: .infinity, alignment: .leading)
            KualiaCloseButton(label: L10n.string("Cancel")) { dismiss() }
                .disabled(store.phase == .saving)
        }.padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            KualiaIconImage(icon: store.action == .archive ? .archive : .trash, size: 24)
                .foregroundStyle(
                    store.action == .archive ? KualiaPalette.ink : KualiaPalette.budgetNegative
                )
                .frame(width: 52, height: 52)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
            Text(store.details?.name ?? store.category.name)
                .font(.title2.weight(.bold)).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func deletionDetails(_ details: BudgetCategoryDetails) -> some View {
        if store.needsDestination {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.string("Give the history a new home.")).font(.headline)
                Text(
                    L10n.string(
                        "\(details.transactionCount) transactions will move to the category you choose. The transactions themselves won’t be deleted."
                    )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            if destinations.isEmpty {
                TransactionEditorNotice(
                    message:
                        L10n.string(
                            "Add another category to your budget before deleting this one. You can archive it instead."
                        ),
                    symbol: .category)
            } else {
                TransactionEditorGroup {
                    TransactionEditorField(
                        title: L10n.string("Move transactions to"),
                        value: destinationName ?? L10n.string("Choose a category"),
                        symbol: .category
                    ) {
                        showsDestinationPicker = true
                    }
                }
                .disabled(store.isBusy)
                .accessibilityIdentifier("budget-category-delete-destination")
            }
        } else {
            Text(
                L10n.string(
                    "There are no transactions to move. This category and its target will be removed from your budget."
                )
            )
            .font(.body).foregroundStyle(KualiaPalette.mutedInk)
        }
        Label(L10n.string("Any assigned money returns to Ready to Assign."), icon: .budget)
            .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var processingNotice: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(L10n.string("Moving transactions"), icon: .transfer).font(.headline)
            Text(
                L10n.string(
                    "This category has a lot of history. The move will continue in the background, and the category will disappear when it’s finished."
                )
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 22))
    }

    private var footer: some View {
        Button {
            if isProcessing {
                finish()
            } else {
                Task {
                    await store.confirm(
                        eligibleDestinationIDs: Set(destinations.map(\.id)),
                        currentWorkspaceID: budget.workspace?.id)
                }
            }
        } label: {
            HStack(spacing: 10) {
                if store.phase == .saving { ProgressView().tint(KualiaPalette.canvas) }
                Text(
                    isProcessing
                        ? L10n.string("Done")
                        : store.phase == .saving ? L10n.string("Working…") : confirmationTitle
                )
                .font(.headline)
            }
            .foregroundStyle(KualiaPalette.canvas)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                store.action == .delete && !isProcessing
                    ? KualiaPalette.budgetNegative : KualiaPalette.ink, in: Capsule()
            )
            .opacity(canConfirm || isProcessing || store.phase == .saving ? 1 : 0.35)
        }
        .buttonStyle(.kualiaHaptic).disabled(!canConfirm && !isProcessing)
        .accessibilityIdentifier("budget-category-lifecycle-confirm")
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 20)
    }

    private var confirmationTitle: String {
        store.action == .archive
            ? L10n.string("Archive category")
            : store.needsDestination
                ? L10n.string("Move transactions & delete") : L10n.string("Delete category")
    }

    private func finish() {
        onFinished()
        dismiss()
    }
}

struct BudgetGroupDeletionView: View {
    let budget: BudgetStore
    @Bindable var store: BudgetGroupDeletionStore
    var hasUnsavedName = false
    let onFinished: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showsDestinationPicker = false

    private var destinationName: String? {
        store.destinations.first { $0.id == store.destinationID }?.group.name
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                KualiaIconImage(icon: .trash, size: 24)
                    .foregroundStyle(KualiaPalette.budgetNegative)
                    .frame(width: 52, height: 52)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                Text(store.source?.group.name ?? store.name)
                    .font(.title2.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                if store.phase == .loading {
                    ProgressView(L10n.string("Checking group…"))
                        .frame(maxWidth: .infinity, minHeight: 80)
                } else if store.source != nil {
                    if store.needsDestination {
                        Text(
                            L10n.string(
                                "Move this group’s categories, including archived ones, to another group. Their transactions, targets, and assigned money stay with them."
                            )
                        )
                        .foregroundStyle(KualiaPalette.mutedInk)
                        if store.destinations.isEmpty {
                            TransactionEditorNotice(
                                message: L10n.string("Add another group before deleting this one."),
                                symbol: .category)
                        } else {
                            TransactionEditorGroup {
                                TransactionEditorField(
                                    title: L10n.string("Move categories to"),
                                    value: destinationName ?? L10n.string("Choose a group"),
                                    symbol: .category
                                ) { showsDestinationPicker = true }
                            }
                            .disabled(store.phase != .ready)
                            .accessibilityIdentifier("budget-group-delete-destination")
                        }
                    } else {
                        Text(
                            L10n.string(
                                "This group has no categories and will be removed from your budget."
                            )
                        )
                        .foregroundStyle(KualiaPalette.mutedInk)
                    }
                    if hasUnsavedName {
                        Text(L10n.string("Your unsaved name edit won’t be applied."))
                            .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                if let error = store.errorMessage {
                    TransactionEditorNotice(message: error, isError: true)
                    if store.phase == .failed {
                        Button(L10n.string("Check again")) { Task { await store.load() } }
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(20)
        }
        .scrollIndicators(.hidden)
        .kualiaScrollEdges(for: .all)
        .kualiaSafeAreaBar(edge: .top, spacing: 0) {
            HStack {
                Text(L10n.string("Delete group")).font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                KualiaCloseButton(label: L10n.string("Cancel")) { dismiss() }
                    .disabled(store.phase == .saving)
            }.padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
        }
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) { footer }
        .fontDesign(.rounded).foregroundStyle(KualiaPalette.ink).tint(KualiaPalette.ink)
        .background(KualiaPalette.canvas)
        .presentationBackground(KualiaPalette.canvas)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible).presentationCornerRadius(34)
        .interactiveDismissDisabled(store.phase == .saving)
        .task { await store.load() }
        .onDisappear { store.stop() }
        .onChange(of: budget.workspace?.id) { _, id in
            if id != store.workspaceID {
                store.stop()
                dismiss()
            }
        }
        .onChange(of: store.phase) { _, phase in
            if phase == .completed {
                onFinished()
                dismiss()
            }
        }
        .sheet(isPresented: $showsDestinationPicker) {
            TransactionEditorPicker(
                title: L10n.string("Move categories to"),
                choices: store.destinations.map { .init(id: $0.id, title: $0.group.name) },
                selectedID: store.destinationID, onSelect: { store.destinationID = $0 })
        }
        .accessibilityIdentifier("budget-group-delete-review")
    }

    private var footer: some View {
        Button {
            Task { await store.confirm(currentWorkspaceID: budget.workspace?.id) }
        } label: {
            HStack(spacing: 10) {
                if store.phase == .saving { ProgressView().tint(KualiaPalette.canvas) }
                Text(
                    store.phase == .saving
                        ? L10n.string("Working…")
                        : store.needsDestination
                            ? L10n.string("Move categories & delete") : L10n.string("Delete group")
                )
                .font(.headline)
            }
            .foregroundStyle(KualiaPalette.canvas)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(KualiaPalette.budgetNegative, in: Capsule())
            .opacity(store.canConfirm || store.phase == .saving ? 1 : 0.35)
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(!store.canConfirm || !budget.canEditPlan)
        .accessibilityIdentifier("budget-group-delete-confirm")
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 20)
    }
}

struct BudgetArchivedCategoriesView: View {
    let budget: BudgetStore
    @Bindable var store: BudgetArchivedCategoriesStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(L10n.string("Archived categories"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        KualiaCloseButton(placement: .toolbar, label: L10n.string("Done")) {
                            dismiss()
                        }
                        .disabled(store.isSaving)
                    }
                }
        }
        .fontDesign(.rounded).foregroundStyle(KualiaPalette.ink).tint(KualiaPalette.ink)
        .presentationBackground(KualiaPalette.canvas)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible).presentationCornerRadius(34)
        .interactiveDismissDisabled(store.isSaving)
        .task { await store.load() }
        .onDisappear { store.stop() }
        .onChange(of: budget.workspace?.id) { _, id in
            if id != store.workspaceID {
                store.stop()
                dismiss()
            }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if store.isLoading {
                    ProgressView(L10n.string("Loading…"))
                        .frame(maxWidth: .infinity, minHeight: 100)
                } else {
                    if let error = store.errorMessage {
                        TransactionEditorNotice(message: error, isError: true)
                        Button(L10n.string("Try again")) { Task { await store.load() } }
                            .disabled(store.isSaving)
                    }
                    if store.groups.isEmpty && store.errorMessage == nil {
                        ContentUnavailableView(
                            L10n.string("No archived categories"), icon: .archive,
                            description: Text(
                                L10n.string("Categories you archive will appear here.")))
                    } else {
                        Text(L10n.string("Select categories to return to your budget."))
                            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        ForEach(store.groups) { group in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(group.group.name).font(.subheadline.weight(.bold))
                                    .foregroundStyle(KualiaPalette.mutedInk)
                                TransactionEditorGroup {
                                    ForEach(group.categories) { category in
                                        categoryRow(category)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .kualiaScrollEdges(for: .all)
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
            if !store.groups.isEmpty {
                let canUnarchive = store.canUnarchive && budget.canEditPlan
                let labelColor = canUnarchive ? KualiaPalette.canvas : KualiaPalette.mutedInk
                Button {
                    Task { await store.unarchive(currentWorkspaceID: budget.workspace?.id) }
                } label: {
                    HStack(spacing: 10) {
                        if store.isSaving { ProgressView().tint(labelColor) }
                        Text(L10n.string("Unarchive selected"))
                    }
                    .font(.body.weight(.semibold))
                    .foregroundStyle(labelColor)
                    .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canUnarchive)
                .padding(20)
                .accessibilityIdentifier("budget-unarchive-selected")
            }
        }
        .background(KualiaPalette.canvas)
    }

    private func categoryRow(_ category: BudgetCategory) -> some View {
        let selected = store.selectedIDs.contains(category.id)
        return Button {
            if selected {
                store.selectedIDs.remove(category.id)
            } else {
                store.selectedIDs.insert(category.id)
            }
        } label: {
            HStack(spacing: 12) {
                Text(category.name).frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: selected ? .checkCircle : .circleOutline, size: 22)
            }
            .font(.body)
            .padding(16)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(store.isSaving)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("budget-archived-category-\(category.id)")
    }
}
