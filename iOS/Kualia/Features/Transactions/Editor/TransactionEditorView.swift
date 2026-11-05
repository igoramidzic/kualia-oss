import SwiftUI

/// Presentation only: the store owns loading and persistence, and the draft owns money rules.
struct TransactionEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Bindable var store: TransactionEditorStore
    var onSaved: (TransactionMutationReceipt) -> Void = { _ in }

    @State private var amountPadPresentation: PeekPresentation
    @State private var amountCalculator: AmountCalculator
    @State private var showsDiscardConfirmation = false
    @State private var showsSwipeDiscardConfirmation = false
    @State private var showsScheduleConfirmation = false
    @State private var showsDeleteConfirmation = false
    @State private var amountPadContentHeight: CGFloat = 274

    init(
        store: TransactionEditorStore,
        onSaved: @escaping (TransactionMutationReceipt) -> Void = { _ in }
    ) {
        self.store = store
        self.onSaved = onSaved
        _amountCalculator = State(
            initialValue: AmountCalculator(
                amount: store.draft?.amount ?? 0, minorUnit: store.workspace.minorUnit
            ))
        // Initial state opens with the sheet and won't reopen when a picker returns.
        _amountPadPresentation = State(
            initialValue: PeekPresentation(initiallyPresented: store.isCreating))
    }

    var body: some View {
        PeekContainer(
            presentation: amountPadPresentation, expansionHeight: amountPadContentHeight
        ) {
            NavigationStack {
                editorContent
                    .background(KualiaPalette.canvas)
                    .navigationTitle(store.editorTitle)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { closeButton }
                        ToolbarItem(placement: .confirmationAction) { saveButton }
                    }
            }
        } expansion: {
            if store.draft != nil, let sessionID = amountPadPresentation.sessionID {
                AmountPad(
                    calculator: Binding(
                        get: { amountCalculator },
                        set: {
                            amountCalculator = $0
                            store.setAmount(from: $0)
                        }
                    ),
                    accessibilityIdentifierPrefix: "transaction",
                    onDismiss: closeAmountPad,
                    onContentHeightChange: { revealAmountPad(height: $0, sessionID: sessionID) }
                )
                .disabled(store.isSaving)
            }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.canvas)
        .interactiveDismissDisabled(store.isDirty || store.isSaving)
        .background {
            TransactionEditorDismissalObserver(
                isDirty: store.isDirty, isSaving: store.isSaving,
                onAttempt: {
                    showsDiscardConfirmation = false
                    showsSwipeDiscardConfirmation = true
                })
        }
        .alert(L10n.string("Discard your changes?"), isPresented: $showsSwipeDiscardConfirmation) {
            Button(L10n.string("Discard changes"), role: .destructive) { dismiss() }
            Button(L10n.string("Keep editing"), role: .cancel) {}
        }
        .alert(
            store.isEditingPlan
                ? L10n.string("Record this occurrence?")
                : store.isCreating
                    ? L10n.string("Schedule this transaction?")
                    : L10n.string("Move this transaction to planned?"),
            isPresented: $showsScheduleConfirmation
        ) {
            Button(L10n.string("Keep editing"), role: .cancel) {}
            Button(
                store.isEditingPlan
                    ? L10n.string("Record & save")
                    : store.isCreating
                        ? L10n.string("Schedule transaction") : L10n.string("Move to planned")
            ) {
                store.draft?.wantsToSchedule = true
                save()
            }
        } message: {
            Text(
                store.isEditingPlan
                    ? L10n.string(
                        "This date adds an entry to your transactions and updates your balances. A repeating transaction advances to its next future date."
                    )
                    : store.isCreating
                        ? L10n.string(
                            "This transaction will be planned for its future date. Your balances will change when it is entered."
                        )
                        : L10n.string(
                            "A future date replaces this ledger entry with a planned transaction. Account balances will update. Transfer entries move together."
                        )
            )
        }
        .alert(L10n.string("Delete Transaction"), isPresented: $showsDeleteConfirmation) {
            Button(L10n.string("Cancel"), role: .cancel) {}
            Button(L10n.string("Delete Transaction"), role: .destructive) {
                Task {
                    if await store.delete() {
                        if let receipt = store.savedReceipt { onSaved(receipt) }
                        dismiss()
                    }
                }
            }
        }
        .task { await store.load() }
        .onDisappear { store.stop() }
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
        ) { _ in
            dismissAmountPadForFocusChange()
        }
    }

    private var closeButton: some View {
        KualiaCloseButton(placement: .toolbar, label: L10n.string("Close transaction")) {
            if store.isDirty { showsDiscardConfirmation = true } else { dismiss() }
        }
        .disabled(store.isSaving)
        .popover(
            isPresented: $showsDiscardConfirmation,
            attachmentAnchor: .rect(.bounds), arrowEdge: .top
        ) {
            VStack(alignment: .leading, spacing: 16) {
                Text(L10n.string("Discard your changes?"))
                    .font(.headline)
                    .foregroundStyle(KualiaPalette.ink)
                Button(L10n.string("Discard changes"), role: .destructive) {
                    showsDiscardConfirmation = false
                    dismiss()
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                Button(L10n.string("Keep editing"), role: .cancel) {
                    showsDiscardConfirmation = false
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .padding(20)
            .frame(width: 260)
            .presentationCompactAdaptation(.popover)
        }
    }

    private var saveButton: some View {
        Button(action: requestSave) {
            if store.isSaving {
                ProgressView()
            } else {
                Text(
                    store.isCreating
                        ? (store.isPlanned ? L10n.string("Schedule") : L10n.string("Add"))
                        : (store.needsApproval ? L10n.string("Approve") : L10n.string("Save"))
                )
                .fontWeight(.semibold)
            }
        }
        .disabled(!canRequestSave)
        .accessibilityLabel(
            store.isSaving
                ? L10n.string("Saving transaction")
                : store.isCreating
                    ? L10n.string("Add transaction")
                    : (store.needsApproval
                        ? L10n.string("Approve") : L10n.string("Save changes")))
    }

    @ViewBuilder
    private var editorContent: some View {
        if let draft = Binding($store.draft) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    amountHeader(draft: draft)
                    if let message = store.shortcutNotice {
                        TransactionEditorNotice(message: message, symbol: .warning)
                    }
                    TransactionEditorForm(
                        store: store, draft: draft,
                        onInteraction: handleEditorInteraction,
                        onImportLinkSaved: {
                            if let receipt = store.savedReceipt { onSaved(receipt) }
                            dismiss()
                        }
                    )

                    if let message = store.saveErrorMessage {
                        TransactionEditorNotice(
                            message: message, symbol: .warning, isError: true)
                    } else if let message = store.inlineValidationMessage,
                        !needsScheduleConfirmation
                    {
                        TransactionEditorNotice(message: message, symbol: .warning)
                    }

                    if store.transactionID != nil && !store.isEditingPlan {
                        deleteButton
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
            .disabled(store.isSaving)
        } else if store.isLoading {
            ProgressView(L10n.string("Opening transaction…"))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label(L10n.string("Couldn't open transaction"), icon: .warning)
            } description: {
                Text(store.loadErrorMessage ?? L10n.string("Try opening the transaction again."))
            } actions: {
                Button(L10n.string("Try again")) { Task { await store.load() } }
            }
        }
    }

    private var deleteButton: some View {
        Button {
            dismissAmountPadForFocusChange()
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            showsDeleteConfirmation = true
        } label: {
            HStack(spacing: 14) {
                KualiaIconImage(icon: .trash, size: 22)
                    .foregroundStyle(KualiaPalette.budgetNegative)
                Text(L10n.string("Delete Transaction"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KualiaPalette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
        .disabled(!store.canDelete)
        .accessibilityIdentifier("transaction.delete")
    }

    private func amountHeader(draft: Binding<TransactionEditorDraft>) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                if draft.wrappedValue.isTransfer && !store.isCreating {
                    Label(L10n.string("Transfer"), icon: .transfer)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .padding(.horizontal, 13)
                        .padding(.vertical, 9)
                        .background(KualiaPalette.border.opacity(0.3), in: Capsule())
                } else {
                    TransactionEditorFlowControl(
                        selection: draft.wrappedValue.flow,
                        onSelect: {
                            handleEditorInteraction(.inlineControl)
                            store.selectFlow($0)
                        }
                    )
                }
                Spacer(minLength: 0)
            }

            Button {
                // Resign any notes/search keyboard before the calculator takes its place.
                UIApplication.shared.sendAction(
                    #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                if showsAmountPad {
                    closeAmountPad()
                } else {
                    resetAmountCalculator()
                    withTransaction(Transaction(animation: nil)) { amountPadPresentation.prepare() }
                }
            } label: {
                Text(
                    showsAmountPad && amountCalculator.previewAmount == nil
                        ? "—"
                        : TransactionAmountFormatter.string(
                            minorUnits: draft.wrappedValue.amount,
                            currencyCode: store.workspace.currencyCode,
                            minorUnit: store.workspace.minorUnit,
                            showsPositiveSign: false,
                            usesAbsoluteValue: true
                        )
                )
                .font(
                    .system(
                        size: dynamicTypeSize.isAccessibilitySize ? 40 : 48, weight: .bold,
                        design: .rounded)
                )
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.45)
                .contentTransition(.numericText())
                .foregroundStyle(KualiaPalette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityLabel(L10n.string("Amount"))
            .accessibilityValue(
                TransactionAmountFormatter.string(
                    minorUnits: draft.wrappedValue.amount,
                    currencyCode: store.workspace.currencyCode,
                    minorUnit: store.workspace.minorUnit, showsPositiveSign: false,
                    usesAbsoluteValue: true
                )
            )
            .accessibilityHint(
                showsAmountPad
                    ? L10n.string("Hide calculator") : L10n.string("Open calculator to edit amount")
            )

            if showsAmountPad {
                AmountCalculationCaption(
                    calculator: amountCalculator,
                    accessibilityIdentifierPrefix: "transaction"
                )
            }
        }
        .padding(.top, 16)
        .padding(.horizontal, 4)
    }

    private var needsScheduleConfirmation: Bool {
        store.requiresScheduleConfirmation
    }

    private var canRequestSave: Bool {
        // The future-date guard is resolved explicitly by the confirmation above.
        (store.canSave || (needsScheduleConfirmation && store.canSaveAfterScheduleConfirmation))
            && (!showsAmountPad || amountCalculator.amount != nil)
    }

    private func requestSave() {
        if needsScheduleConfirmation { showsScheduleConfirmation = true } else { save() }
    }

    private func save() {
        Task {
            if await store.save() {
                if let receipt = store.savedReceipt { onSaved(receipt) }
                dismiss()
            }
        }
    }

    private var showsAmountPad: Bool { amountPadPresentation.isPresented }

    private var amountPadAnimation: Animation? {
        reduceMotion ? nil : .spring(duration: 0.38, bounce: 0.08)
    }

    private func resetAmountCalculator() {
        amountCalculator = AmountCalculator(
            amount: store.draft?.amount ?? 0, minorUnit: store.workspace.minorUnit
        )
    }

    private func closeAmountPad() {
        guard let sessionID = amountPadPresentation.sessionID else { return }
        withAnimation(amountPadAnimation, completionCriteria: .removed) {
            amountPadPresentation.beginClosing()
        } completion: {
            amountPadPresentation.finishClosing(sessionID: sessionID)
        }
    }

    private func revealAmountPad(height: CGFloat, sessionID: UUID) {
        guard amountPadPresentation.acceptsMeasurement(sessionID: sessionID)
        else { return }
        if abs(amountPadContentHeight - height) > 0.5 { amountPadContentHeight = height }
        guard amountPadPresentation.isPreparing else { return }
        withAnimation(amountPadAnimation) { amountPadPresentation.reveal(sessionID: sessionID) }
    }

    private func dismissAmountPadForFocusChange() {
        guard amountPadPresentation.sessionID != nil else { return }
        // Another input owns the next animation. Remove the keypad before the keyboard or
        // a picker resizes this sheet, including when a keypad close is already in progress.
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) { amountPadPresentation.dismissForFocusChange() }
    }

    private func handleEditorInteraction(_ interaction: TransactionEditorInteraction) {
        if interaction.takesOverAmountInput { dismissAmountPadForFocusChange() }
    }

}

/// Fade the scrolling viewport itself. The opaque sheet and its toolbar stay above the drawer.
struct TransactionEditorScrollFade: View {
    let topInset: CGFloat
    let fadeHeight: CGFloat
    let fadesBottom: Bool

    var body: some View {
        GeometryReader { geometry in
            let height = max(1, geometry.size.height)
            let topEnd = min(topInset + 12, height * 0.5)
            let topStart = max(0, topEnd - fadeHeight)
            // The keyboard covers the sheet's bottom edge; its top is not a new fading edge.
            let bottomStart = fadesBottom ? max(topEnd, height - fadeHeight) : height

            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .clear, location: topStart / height),
                    .init(color: .black, location: topEnd / height),
                    .init(color: .black, location: bottomStart / height),
                    .init(color: fadesBottom ? .clear : .black, location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
}

private struct TransactionEditorFlowControl: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let selection: TransactionEditorFlow
    let onSelect: (TransactionEditorFlow) -> Void
    @Namespace private var selectionAnimation

    var body: some View {
        HStack(spacing: 2) {
            choice(.outflow, title: L10n.string("Outflow"), symbol: .arrowUpRight)
            choice(.inflow, title: L10n.string("Inflow"), symbol: .arrowDownLeft)

        }
        .padding(4)
        .background(KualiaPalette.border.opacity(0.3), in: Capsule())
    }

    private func choice(_ flow: TransactionEditorFlow, title: String, symbol: KualiaIcon)
        -> some View
    {
        Button {
            withAnimation(reduceMotion ? nil : .spring(duration: 0.25)) { onSelect(flow) }
        } label: {
            Label(title, icon: symbol)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(
                    flow == .outflow ? KualiaPalette.budgetNegative : KualiaPalette.budgetPositive
                )
                .padding(.horizontal, 13)
                .frame(minHeight: 44)
                .background {
                    if selection == flow {
                        Capsule().fill(KualiaPalette.surface)
                            .matchedGeometryEffect(id: "flow", in: selectionAnimation)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityAddTraits(selection == flow ? .isSelected : [])
    }
}

/// SwiftUI blocks interactive dismissal but exposes no attempted-dismiss callback.
/// Observe the enclosing sheet, forwarding its existing delegate's lifecycle callbacks.
struct TransactionEditorDismissalObserver: UIViewControllerRepresentable {
    let isDirty: Bool
    let isSaving: Bool
    let onAttempt: () -> Void
    var onPresented: () -> Void = {}

    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.isDirty = isDirty
        controller.isSaving = isSaving
        controller.onAttempt = onAttempt
        controller.onPresented = onPresented
        controller.attach()
        // The SwiftUI parent may be attached after this update.
        DispatchQueue.main.async { [weak controller] in controller?.attach() }
    }

    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.detach()
    }

    final class Controller: UIViewController, UIAdaptivePresentationControllerDelegate {
        var isDirty = false
        var isSaving = false
        var onAttempt: (() -> Void)?
        var onPresented: (() -> Void)?
        private var hasPresented = false
        private weak var observedPresentation: UIPresentationController?
        private weak var previousDelegate: (any UIAdaptivePresentationControllerDelegate)?

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            attach()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            attach()
            // UIKit calls this after the enclosing sheet's presentation completes.
            // Returning from a nested picker must not repeat the handoff.
            guard !hasPresented else { return }
            hasPresented = true
            onPresented?()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            // SwiftUI may replace the presentation delegate during a sheet update.
            attach()
        }

        func attach() {
            var ancestor = parent
            while let current = ancestor {
                if current.presentingViewController?.presentedViewController === current,
                    let presentation = current.presentationController,
                    presentation.presentedViewController === current
                {
                    attach(to: presentation)
                    return
                }
                ancestor = current.parent
            }
        }

        func attach(to presentation: UIPresentationController) {
            // Keep UIKit's lock current even when this delegate is already installed.
            presentation.presentedViewController.isModalInPresentation = isDirty || isSaving
            guard presentation.delegate !== self else { return }
            detach()
            previousDelegate = presentation.delegate
            observedPresentation = presentation
            presentation.delegate = self
        }

        func detach() {
            if observedPresentation?.delegate === self {
                observedPresentation?.delegate = previousDelegate
            }
            observedPresentation = nil
            previousDelegate = nil
        }

        func presentationControllerShouldDismiss(_ presentationController: UIPresentationController)
            -> Bool
        {
            guard !isDirty, !isSaving else { return false }
            return previousDelegate?.presentationControllerShouldDismiss?(presentationController)
                ?? true
        }

        func presentationControllerDidAttemptToDismiss(
            _ presentationController: UIPresentationController
        ) {
            if isDirty, !isSaving { onAttempt?() }
            previousDelegate?.presentationControllerDidAttemptToDismiss?(presentationController)
        }

        func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
            previousDelegate?.presentationControllerWillDismiss?(presentationController)
        }

        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            previousDelegate?.presentationControllerDidDismiss?(presentationController)
        }
    }
}
