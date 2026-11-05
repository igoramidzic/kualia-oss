import SwiftUI

struct BudgetPlanView: View {
    let store: BudgetStore
    let workspaceID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var editor: BudgetPlanNameEditor?
    @State private var targetEditor: BudgetTargetDestination?
    @State private var isReordering = false
    @State private var isDragging = false

    private var groups: [BudgetCategoryGroup] { store.planGroups }

    var body: some View {
        ZStack {
            // Keep scroll positions and native view geometry alive across page changes.
            // Only opacity animates; the outgoing page disappears before the next appears.
            planContent
                .animation(pageFade(appearing: !isReordering)) {
                    $0.opacity(isReordering ? 0 : 1)
                }
                .allowsHitTesting(!isReordering)
                .accessibilityHidden(isReordering)
            reorderContent
                .animation(pageFade(appearing: isReordering)) {
                    $0.opacity(isReordering ? 1 : 0)
                }
                .allowsHitTesting(isReordering)
                .accessibilityHidden(!isReordering)
        }
        .kualiaSafeAreaBar(edge: .top, spacing: 0) { toolbar }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .tint(KualiaPalette.ink)
        .background(KualiaPalette.budgetPage)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.budgetPage)
        .interactiveDismissDisabled(store.isSavingPlan || isDragging)
        .sheet(item: $editor) { item in
            BudgetPlanNameSheet(store: store, workspaceID: workspaceID, editor: item)
        }
        .sheet(item: $targetEditor) { destination in
            BudgetTargetView(store: store, destination: destination)
        }
        .onAppear { store.planError = nil }
        .onChange(of: store.workspace?.id) { _, id in
            if id != workspaceID { dismiss() }
        }
        .accessibilityIdentifier("budget-plan")
    }

    private func pageFade(appearing: Bool) -> Animation {
        let duration = reduceMotion ? 0.075 : 0.1
        return .easeInOut(duration: duration).delay(appearing ? duration : 0)
    }

    private var planContent: some View {
        ScrollView {
            VStack(spacing: 22) {
                monthlyAmount
                actions
                status
                if let message = store.targets.loadError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message).font(.footnote).foregroundStyle(KualiaPalette.budgetNegative)
                        Button(L10n.string("Retry targets"), action: store.targets.retry).font(
                            .footnote.weight(.semibold))
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                LazyVStack(spacing: 12) {
                    ForEach(groups) { group in groupCard(group) }
                }
                if groups.isEmpty {
                    ContentUnavailableView(
                        L10n.string("Make room for your plans"), icon: .category,
                        description: Text(
                            L10n.string(
                                "Add a group, then give each part of your budget a category.")))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .kualiaScrollEdges(for: .top)
        .kualiaScrollEdgeEffectHidden(true, for: .bottom)
    }

    private var toolbar: some View {
        VStack(spacing: 12) {
            ZStack {
                ZStack {
                    Text(L10n.string("Budget plan"))
                        .animation(pageFade(appearing: !isReordering)) {
                            $0.opacity(isReordering ? 0 : 1)
                        }
                        .accessibilityHidden(isReordering)
                    Text(L10n.string("Reorder budget"))
                        .animation(pageFade(appearing: isReordering)) {
                            $0.opacity(isReordering ? 1 : 0)
                        }
                        .accessibilityHidden(!isReordering)
                }
                .font(.headline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, 80)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
                HStack {
                    Button {
                        isReordering = false
                    } label: {
                        HStack(spacing: 4) {
                            KualiaIconImage(icon: .chevronLeft, size: 18)
                            Text(L10n.string("Back")).font(.subheadline.weight(.semibold))
                        }
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(isDragging || !isReordering)
                    .animation(pageFade(appearing: isReordering)) {
                        $0.opacity(isReordering ? 1 : 0)
                    }
                    .accessibilityHidden(!isReordering)
                    .accessibilityIdentifier("budget-plan-back")
                    Spacer(minLength: 0)
                    KualiaCloseButton(label: L10n.string("Close budget plan"), icon: .check) {
                        dismiss()
                    }
                    .disabled(store.isSavingPlan || isDragging)
                    .accessibilityValue(store.isSavingPlan ? L10n.string("Saving changes") : "")
                    .accessibilityIdentifier("budget-plan-done")
                }
            }
            if isReordering {
                status
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 12)
    }

    private var monthlyAmount: some View {
        VStack(spacing: 8) {
            Text(L10n.string("Your monthly number"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(KualiaPalette.mutedInk)
            if let amount = store.monthlyPlanAmount {
                Text(
                    MoneyAmountFormatter.string(
                        decimalMinorUnits: Decimal(amount),
                        currencyCode: store.workspace?.currencyCode ?? "USD",
                        minorUnit: store.workspace?.minorUnit ?? 2,
                        showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
                )
                .font(.system(size: 48, weight: .bold, design: .rounded).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.4)
                .accessibilityIdentifier("budget-plan-monthly-amount")
                Text(
                    L10n.string(
                        "Needed for \(BudgetMonth.title(store.currentMonth, locale: locale))")
                )
                .font(.caption)
                .foregroundStyle(KualiaPalette.mutedInk)
                if amount == 0 {
                    Text(L10n.string("Categories with targets make up your monthly number."))
                        .font(.footnote)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .multilineTextAlignment(.center)
                }
            } else if store.budgetError == nil {
                ProgressView(L10n.string("Loading monthly amount…"))
            } else {
                Text(L10n.string("Monthly amount unavailable"))
                    .font(.title3.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
    }

    private var actions: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            planAction(L10n.string("Add group"), icon: .plus) {
                editor = .init(kind: .newGroup)
            }
            .accessibilityIdentifier("budget-plan-add-group")
            planAction(L10n.string("Reorder"), icon: .sort) { isReordering = true }
                .disabled(groups.isEmpty)
                .accessibilityIdentifier("budget-plan-reorder")
        }
        .disabled(!store.canEditPlan)
    }

    private func planAction(_ title: String, icon: KualiaIcon, action: @escaping () -> Void)
        -> some View
    {
        Button(action: action) {
            Label(title, icon: icon)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(KualiaPalette.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(KualiaPalette.border.opacity(0.5), lineWidth: 0.5))
        }
        .buttonStyle(.kualiaHaptic)
    }

    @ViewBuilder
    private var status: some View {
        if let message = store.planError ?? store.errorMessage {
            VStack(alignment: .leading, spacing: 8) {
                Text(message).font(.footnote)
                if store.errorMessage != nil {
                    Button(L10n.string("Retry"), action: store.retry)
                        .font(.footnote.weight(.semibold))
                        .buttonStyle(.kualiaHaptic)
                }
            }
            .foregroundStyle(KualiaPalette.budgetNegative)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("budget-plan-error")
        }
    }

    private func groupCard(_ group: BudgetCategoryGroup) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                Text(group.categoryGroup.name)
                    .font(.subheadline.weight(.bold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 16)
                    .accessibilityAddTraits(.isHeader)
                if group.categoryGroup.type != "credit_card" {
                    Button {
                        editor = .init(kind: .newCategory(groupID: group.id))
                    } label: {
                        KualiaIconImage(icon: .plus, size: 18)
                            .frame(width: 32, height: 32)
                            .background(KualiaPalette.surface, in: Circle())
                            .overlay(
                                Circle().strokeBorder(
                                    KualiaPalette.border.opacity(0.5), lineWidth: 0.5)
                            )
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityLabel(L10n.string("Add category to \(group.categoryGroup.name)"))
                    .accessibilityIdentifier("budget-plan-add-category-\(group.id)")
                }
                Button {
                    editor = .init(kind: .group(id: group.id), name: group.categoryGroup.name)
                } label: {
                    KualiaIconImage(icon: .pencil, size: 18)
                        .frame(width: 32, height: 32)
                        .background(KualiaPalette.surface, in: Circle())
                        .overlay(
                            Circle().strokeBorder(
                                KualiaPalette.border.opacity(0.5), lineWidth: 0.5)
                        )
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityLabel(L10n.string("Edit \(group.categoryGroup.name) group"))
                .accessibilityIdentifier("budget-plan-edit-group-\(group.id)")
            }
            .frame(minHeight: 56)
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .background(KualiaPalette.border.opacity(0.12))

            ForEach(group.categories) { category in
                HStack(spacing: 0) {
                    Button {
                        editor = .init(kind: .category(id: category.id), name: category.name)
                    } label: {
                        Text(category.name)
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                            .padding(.leading, 16)
                            .padding(.trailing, 8)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityLabel(L10n.string("Edit \(category.name)"))
                    .accessibilityIdentifier("budget-plan-category-\(category.id)")
                    if category.type != "credit_card", let workspace = store.workspace {
                        BudgetTargetButton(
                            store: store.targets, category: category, workspace: workspace
                        ) {
                            targetEditor = .init(workspace: workspace, category: category)
                        }
                    }
                }
                if category.id != group.categories.last?.id {
                    Rectangle().fill(KualiaPalette.border.opacity(0.45))
                        .frame(height: 0.5).padding(.horizontal, 14)
                }
            }
            if group.categories.isEmpty {
                Text(L10n.string("No categories yet"))
                    .font(.subheadline)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
        }
        .background(KualiaPalette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(KualiaPalette.border.opacity(0.4), lineWidth: 0.5)
        )
        .disabled(!store.canEditPlan)
    }

    private var reorderContent: some View {
        GeometryReader { geometry in
            // Carry the SwiftUI bar's safe area across the native drag surface.
            // The viewport extends to the sheet edges; only its content is inset.
            let insets = HomePageBarInsets(geometry.safeAreaInsets)
            BudgetPlanReorderView(
                groups: groups, isEnabled: isReordering && store.canReorderPlan,
                topInset: insets.top, bottomInset: insets.bottom,
                onDragActivity: { isDragging = $0 },
                onMove: { move in
                    store.enqueuePlanMove(move, workspaceID: workspaceID)
                }
            )
            .ignoresSafeArea(.container, edges: .vertical)
            .accessibilityIdentifier("budget-plan-reorder-list")
        }
        .kualiaScrollEdges(for: .top)
    }

}

struct BudgetPlanNameSheet: View {
    let store: BudgetStore
    let workspaceID: String
    let editor: BudgetPlanNameEditor
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var name: String
    @State private var targetEditor: BudgetTargetDestination?
    @State private var lifecycle: BudgetCategoryLifecycleStore?
    @State private var groupDeletion: BudgetGroupDeletionStore?
    @State private var itemWasRemoved = false
    @State private var showsDiscardConfirmation = false
    @State private var isSubmitting = false
    @FocusState private var isNameFocused: Bool

    init(store: BudgetStore, workspaceID: String, editor: BudgetPlanNameEditor) {
        self.store = store
        self.workspaceID = workspaceID
        self.editor = editor
        _name = State(initialValue: editor.name)
    }

    private var isDirty: Bool { name != editor.name }
    private var canSave: Bool {
        !isSubmitting && store.canEditPlan && editor.change(name: name) != nil
            && (editor.isCreating || isDirty)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(editor.isGroup ? L10n.string("Group name") : L10n.string("Category name"))
                    .font(.subheadline.weight(.semibold))
                TextField(
                    editor.isGroup
                        ? L10n.string("e.g. Everyday spending") : L10n.string("e.g. Groceries"),
                    text: $name
                )
                .textInputAutocapitalization(.sentences)
                .submitLabel(.done)
                .focused($isNameFocused)
                .padding(16)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 16))
                .disabled(isSubmitting)
                .onSubmit(save)
                .accessibilityLabel(
                    editor.isGroup ? L10n.string("Group name") : L10n.string("Category name")
                )
                .accessibilityIdentifier("budget-plan-name")
                if case .category(let id) = editor.kind,
                    let category = store.planGroups.flatMap(\.categories).first(where: {
                        $0.id == id
                    }),
                    category.type != "credit_card", let workspace = store.workspace
                {
                    targetCard(category: category, workspace: workspace)
                        .padding(.top, 18)
                    categoryActions(category)
                        .padding(.top, 20)
                }
                if case .group(let id) = editor.kind,
                    let group = store.planGroups.first(where: { $0.id == id }),
                    group.categoryGroup.type != "credit_card",
                    group.categoryGroup.isSystemGroup != true
                {
                    deleteGroupAction(group).padding(.top, 20)
                }
                if let message = store.planError {
                    Text(message).font(.footnote).foregroundStyle(KualiaPalette.budgetNegative)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .kualiaScrollEdges(for: .top)
        .kualiaScrollEdgeEffectHidden(true, for: .bottom)
        .kualiaSafeAreaBar(edge: .top, spacing: 0) { header }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .tint(KualiaPalette.ink)
        .background(KualiaPalette.canvas)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.canvas)
        .interactiveDismissDisabled(isDirty || isSubmitting)
        .background {
            TransactionEditorDismissalObserver(
                isDirty: isDirty, isSaving: isSubmitting,
                onAttempt: { showsDiscardConfirmation = true })
        }
        .alert(L10n.string("Discard this name?"), isPresented: $showsDiscardConfirmation) {
            Button(L10n.string("Discard changes"), role: .destructive) { dismiss() }
            Button(L10n.string("Keep editing"), role: .cancel) {}
        }
        .onAppear {
            store.planError = nil
            isNameFocused = editor.isCreating || editor.isGroup
        }
        .sheet(item: $targetEditor) { destination in
            BudgetTargetView(store: store, destination: destination)
        }
        .sheet(
            item: $lifecycle,
            onDismiss: {
                if itemWasRemoved { dismiss() }
            }
        ) { lifecycle in
            BudgetCategoryLifecycleView(
                budget: store, store: lifecycle, hasUnsavedName: isDirty,
                onFinished: { itemWasRemoved = true })
        }
        .sheet(
            item: $groupDeletion,
            onDismiss: { if itemWasRemoved { dismiss() } }
        ) { deletion in
            BudgetGroupDeletionView(
                budget: store, store: deletion, hasUnsavedName: isDirty,
                onFinished: { itemWasRemoved = true })
        }
        .onChange(of: name) { _, _ in store.planError = nil }
        .onChange(of: store.workspace?.id) { _, id in
            if id != workspaceID { dismiss() }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            KualiaCloseButton(label: L10n.string("Cancel")) {
                if isDirty { showsDiscardConfirmation = true } else { dismiss() }
            }
            .disabled(isSubmitting)
            Text(editor.title)
                .font(.headline.weight(.bold))
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
            Button(action: save) {
                Text(editor.isCreating ? L10n.string("Add") : L10n.string("Save"))
                    .opacity(isSubmitting ? 0 : 1)
                    .overlay {
                        if isSubmitting { ProgressView().tint(KualiaPalette.canvas) }
                    }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(KualiaPalette.canvas)
                    .frame(minWidth: 64, minHeight: 44)
                    .background(KualiaPalette.ink, in: Capsule())
                    .opacity(canSave || isSubmitting ? 1 : 0.3)
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(!canSave)
            .accessibilityLabel(editor.isCreating ? L10n.string("Add") : L10n.string("Save name"))
            .accessibilityValue(isSubmitting ? L10n.string("Saving") : "")
            .accessibilityIdentifier("budget-plan-name-save")
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 12)
    }

    private func deleteGroupAction(_ group: BudgetCategoryGroup) -> some View {
        Button {
            isNameFocused = false
            groupDeletion = BudgetGroupDeletionStore(
                workspaceID: workspaceID, groupID: group.id, name: group.categoryGroup.name,
                client: store.categoryLifecycleClient)
        } label: {
            HStack(spacing: 14) {
                KualiaIconImage(icon: .trash, size: 22)
                    .foregroundStyle(KualiaPalette.budgetNegative)
                VStack(alignment: .leading, spacing: 5) {
                    Text(L10n.string("Delete group")).font(.subheadline.weight(.semibold))
                    Text(L10n.string("Review and move any categories first"))
                        .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
            .padding(18).frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
        .disabled(isSubmitting || !store.canEditPlan)
        .accessibilityIdentifier("budget-group-delete")
    }

    private func categoryActions(_ category: BudgetCategory) -> some View {
        VStack(spacing: 0) {
            categoryAction(
                .archive, category: category,
                subtitle: L10n.string("Hide from your budget, keep the history"),
                icon: .archive)
            Rectangle().fill(KualiaPalette.border.opacity(0.45))
                .frame(height: 0.5).padding(.leading, 56)
            categoryAction(
                .delete, category: category,
                subtitle: L10n.string("Review and move any transactions first"),
                icon: .trash)
        }
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
        .disabled(isSubmitting || !store.canEditPlan)
    }

    private func categoryAction(
        _ action: BudgetCategoryAction, category: BudgetCategory, subtitle: String, icon: KualiaIcon
    ) -> some View {
        Button {
            isNameFocused = false
            lifecycle = BudgetCategoryLifecycleStore(
                workspaceID: workspaceID, category: category, action: action,
                client: store.categoryLifecycleClient)
        } label: {
            HStack(spacing: 14) {
                KualiaIconImage(icon: icon, size: 22)
                    .foregroundStyle(
                        action == .delete ? KualiaPalette.budgetNegative : KualiaPalette.ink)
                VStack(alignment: .leading, spacing: 5) {
                    Text(action.title).font(.subheadline.weight(.semibold))
                    Text(subtitle).font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 12).foregroundStyle(
                    KualiaPalette.mutedInk)
            }
            .padding(18).frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityIdentifier(
            action == .archive ? "budget-category-archive" : "budget-category-delete")
    }

    private func targetCard(category: BudgetCategory, workspace: BudgetWorkspace) -> some View {
        let target = store.targets.targets[category.id]
        return VStack(alignment: .leading, spacing: 10) {
            Text(L10n.string("Target")).font(.subheadline.weight(.semibold))
            VStack(alignment: .leading, spacing: 16) {
                if let target {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(target.targetType?.title ?? L10n.string("Category target"))
                            .font(.subheadline.weight(.semibold))
                        if let amount = target.displayAmount {
                            Text(
                                MoneyAmountFormatter.string(
                                    minorUnits: amount, currencyCode: workspace.currencyCode,
                                    minorUnit: workspace.minorUnit, showsPositiveSign: false,
                                    usesAbsoluteValue: false, locale: locale)
                            )
                            .font(.title2.weight(.bold)).monospacedDigit()
                        }
                        Text(target.cadence)
                            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        if let explanation = target.targetType?.explanation {
                            Text(explanation)
                                .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } else if store.targets.hasLoaded && store.targets.loadError == nil {
                    Text(L10n.string("Plan how much to save or spend."))
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                } else if store.targets.loadError == nil {
                    ProgressView(L10n.string("Loading target…")).font(.subheadline)
                }
                if let message = store.targets.loadError {
                    Text(message).font(.footnote).foregroundStyle(KualiaPalette.budgetNegative)
                    Button(L10n.string("Retry targets"), action: store.targets.retry)
                        .font(.subheadline.weight(.semibold))
                }
                if target != nil || (store.targets.hasLoaded && store.targets.loadError == nil) {
                    Button {
                        isNameFocused = false
                        targetEditor = .init(workspace: workspace, category: category)
                    } label: {
                        Label(
                            target == nil
                                ? L10n.string("Create target") : L10n.string("Edit target"),
                            icon: target == nil ? .plus : .pencil
                        )
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(KualiaPalette.canvas, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(isSubmitting || !store.canEditPlan || !store.targets.canEdit)
                    .accessibilityLabel(
                        L10n.string(
                            "\(target == nil ? L10n.string("Create") : L10n.string("Edit")) target for \(category.name)"
                        )
                    )
                    .accessibilityIdentifier(
                        target == nil ? "budget-category-set-target" : "budget-category-edit-target"
                    )
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
        }
    }

    private func save() {
        guard canSave, let change = editor.change(name: name) else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            if await store.savePlanChange(change, workspaceID: workspaceID) { dismiss() }
        }
    }
}
