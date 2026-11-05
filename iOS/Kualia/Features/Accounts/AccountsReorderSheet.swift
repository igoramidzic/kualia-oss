import SwiftUI

struct AccountsReorderSheet: View {
    let store: AccountsStore
    let workspaceID: String
    @Environment(\.dismiss) private var dismiss
    @State private var isDragging = false
    @State private var showsCloseConfirmation = false

    var body: some View {
        GeometryReader { geometry in
            let insets = HomePageBarInsets(geometry.safeAreaInsets)
            BudgetPlanReorderView(
                groups: store.reorderGroups, isEnabled: store.canReorderAccounts,
                topInset: insets.top, bottomInset: insets.bottom,
                allowsMovingBetweenGroups: false, accessibilityPrefix: "accounts-reorder",
                onDragActivity: { isDragging = $0 },
                onMove: { store.moveAccount($0, workspaceID: workspaceID) }
            )
            .ignoresSafeArea(.container, edges: .vertical)
        }
        .kualiaSafeAreaBar(edge: .top, spacing: 0) {
            VStack(spacing: 12) {
                ZStack {
                    Text(L10n.string("Reorder accounts"))
                        .font(.headline.weight(.bold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                        .padding(.horizontal, 72)
                        .frame(maxWidth: .infinity)
                        .accessibilityAddTraits(.isHeader)
                    HStack {
                        KualiaCloseButton(action: requestClose)
                            .disabled(store.isSavingOrder || isDragging)
                            .accessibilityIdentifier("accounts-reorder-close")
                        Spacer()
                        saveButton
                    }
                }
                Text(
                    L10n.string("Drag groups or accounts to reorder. Accounts stay in their group.")
                )
                .font(.footnote)
                .foregroundStyle(KualiaPalette.mutedInk)
                .frame(maxWidth: .infinity, alignment: .leading)
                if store.isSavingOrder {
                    ProgressView(L10n.string("Saving changes")).font(.footnote)
                } else if let message = store.orderingError ?? store.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message).foregroundStyle(KualiaPalette.budgetNegative)
                        Button(L10n.string("Retry"), action: store.retry)
                            .buttonStyle(.kualiaHaptic)
                    }
                    .font(.footnote)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .tint(KualiaPalette.ink)
        .background(KualiaPalette.budgetPage)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.budgetPage)
        .interactiveDismissDisabled(
            store.hasAccountOrderChanges || store.isSavingOrder || isDragging
        )
        .background {
            TransactionEditorDismissalObserver(
                isDirty: store.hasAccountOrderChanges, isSaving: store.isSavingOrder || isDragging,
                onAttempt: requestClose)
        }
        .alert(L10n.string("Save changes?"), isPresented: $showsCloseConfirmation) {
            Button(L10n.string("Save changes"), action: save)
            Button(L10n.string("Discard changes"), role: .destructive) {
                store.discardAccountReordering()
                dismiss()
            }
            Button(L10n.string("Keep editing"), role: .cancel) {}
        }
        .onAppear { store.beginAccountReordering(workspaceID: workspaceID) }
        .onDisappear {
            if store.workspace?.id == workspaceID { store.discardAccountReordering() }
        }
        .onChange(of: store.workspace?.id) { _, id in
            if id != workspaceID { dismiss() }
        }
        .accessibilityIdentifier("accounts-reorder")
    }

    private var canSave: Bool {
        store.hasAccountOrderChanges && store.canReorderAccounts && !isDragging
    }

    private var saveButton: some View {
        Button(action: save) {
            Group {
                if store.isSavingOrder {
                    ProgressView().tint(KualiaPalette.canvas)
                } else {
                    Text(L10n.string("Save")).font(.subheadline.weight(.bold))
                }
            }
            .foregroundStyle(KualiaPalette.canvas)
            .frame(minWidth: 62, minHeight: 44)
            .background(KualiaPalette.ink, in: Capsule())
            .opacity(canSave ? 1 : 0.3)
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(!canSave)
        .accessibilityLabel(L10n.string("Save changes"))
        .accessibilityIdentifier("accounts-reorder-save")
    }

    private func requestClose() {
        guard !store.isSavingOrder, !isDragging else { return }
        if store.hasAccountOrderChanges {
            showsCloseConfirmation = true
        } else {
            store.discardAccountReordering()
            dismiss()
        }
    }

    private func save() {
        Task {
            if await store.saveAccountOrder(workspaceID: workspaceID) { dismiss() }
        }
    }
}
