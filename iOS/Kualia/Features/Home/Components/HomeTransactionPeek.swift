import SwiftUI

enum TransactionPeekTiming {
    static func beforeHold(for kind: TransactionMutationKind) -> Duration {
        switch kind {
        case .accountCreated: .milliseconds(1_500)
        case .restored: .zero
        default: .seconds(1)
        }
    }
    static let balanceAnimation = 0.65
    // Includes the balance animation, leaving several seconds to read the result.
    static func resultHold(for kind: TransactionMutationKind) -> Duration {
        switch kind {
        case .accountCreated: .milliseconds(3_500)
        case .accountClosed, .accountDeleted: .seconds(6)
        case .restored: .milliseconds(2_500)
        default: .seconds(3)
        }
    }
}

struct TransactionPeekPresentation {
    enum Phase { case before, after }
    private(set) var receipt: TransactionMutationReceipt?
    private var lastPresentedReceiptID: UUID?
    private(set) var phase: Phase = .before
    private(set) var reveal = PeekPresentation()
    private(set) var showsUndo = false
    private(set) var isClosing = false

    var animationID: UUID? {
        reveal.isPresented && receipt?.isUpdating != true ? receipt?.id : nil
    }

    var showsFinalAmount: Bool { phase == .after }
    var isOverspent: Bool {
        receipt?.budgetChanges.contains(where: { isOverspent(for: $0) }) == true
    }

    var backgroundColor: Color {
        if let account = receipt?.accountCreation {
            return !showsFinalAmount || account.readyToAssignDelta >= 0
                ? KualiaPalette.peekPositiveBackground : KualiaPalette.peekBackground
        }
        guard let changes = receipt?.budgetChanges, !changes.isEmpty else {
            return KualiaPalette.peekBackground
        }
        if !showsFinalAmount {
            return changes.allSatisfy { $0.before < 0 && $0.after < 0 }
                ? KualiaPalette.peekDangerBackground : KualiaPalette.peekBackground
        }
        if isOverspent { return KualiaPalette.peekDangerBackground }
        if changes.contains(where: { $0.after > $0.before }) {
            return KualiaPalette.peekPositiveBackground
        }
        return KualiaPalette.peekBackground
    }

    func amount(for change: TransactionBudgetChange) -> Int64 {
        showsFinalAmount ? change.after : change.before
    }

    func isOverspent(for change: TransactionBudgetChange) -> Bool {
        amount(for: change) < 0
    }

    func categoryTitle(for change: TransactionBudgetChange) -> String {
        guard let month = change.yearMonth,
            receipt?.budgetChanges.contains(where: {
                $0.categoryId == change.categoryId && $0.yearMonth != change.yearMonth
            }) == true
        else { return change.name }
        return "\(change.name) · \(BudgetMonth.title(month))"
    }

    mutating func present(
        _ receipt: TransactionMutationReceipt, showsUndo: Bool = false,
        hasVisiblePeek: Bool = false
    ) {
        // A late acknowledgement must never reopen a peek the user already finished.
        guard self.receipt != nil || lastPresentedReceiptID != receipt.id else { return }
        let isUpdate = self.receipt?.id == receipt.id
        var receipt = receipt
        if receipt.kind == .restored || isUpdate, let previous = self.receipt {
            receipt.budgetChanges = receipt.budgetChanges.map { change in
                guard let prior = previous.budgetChanges.first(where: { $0.id == change.id }) else {
                    return change
                }
                var change = change
                change.before = isUpdate ? prior.before : amount(for: prior)
                return change
            }
        }
        self.receipt = receipt
        lastPresentedReceiptID = receipt.id
        self.showsUndo = showsUndo
        if isUpdate { return }
        phase = .before
        isClosing = false
        if reveal.isPresented {
            reveal.open()
        } else {
            reveal.prepare(hasVisiblePeek: hasVisiblePeek)
        }
    }

    mutating func revealContent(receiptID: UUID) {
        guard receipt?.id == receiptID, !isClosing, let sessionID = reveal.sessionID else { return }
        reveal.reveal(sessionID: sessionID)
    }

    mutating func applyChange(receiptID: UUID) {
        guard receipt?.id == receiptID, !isClosing else { return }
        phase = .after
    }

    mutating func beginClosing(receiptID: UUID) {
        guard receipt?.id == receiptID else { return }
        isClosing = true
        reveal.beginClosing()
    }

    @discardableResult
    mutating func finishClosing(receiptID: UUID, sessionID: UUID) -> Bool {
        guard receipt?.id == receiptID, reveal.sessionID == sessionID, isClosing else {
            return false
        }
        reveal.finishClosing(sessionID: sessionID)
        dismiss()
        return true
    }

    mutating func dismiss() {
        receipt = nil
        showsUndo = false
        isClosing = false
        reveal.dismissForFocusChange()
    }
}

struct HomeTransactionPeek: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let presentation: TransactionPeekPresentation
    let receipt: TransactionMutationReceipt

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let change = receipt.accountLifecycle {
                VStack(alignment: .leading, spacing: 4) {
                    Label(
                        receipt.kind.title,
                        icon: receipt.kind == .accountDeleted
                            ? .trash : .checkCircle
                    )
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    Text(lifecycleDetail(change))
                        .font(.subheadline).foregroundStyle(KualiaPalette.peekMutedInk)
                }
            }
            if let account = receipt.accountCreation {
                accountCreationResult(account)
            }
            ForEach(receipt.budgetChanges) { change in
                categoryBalance(change)
            }
            if receipt.budgetChanges.isEmpty && receipt.accountCreation == nil
                && receipt.accountLifecycle == nil
            {
                HStack(spacing: 10) {
                    if receipt.isUpdating { ProgressView().tint(KualiaPalette.peekInk) }
                    Text(
                        receipt.isUpdating
                            ? L10n.string("Updating transaction…")
                            : receipt.isScheduledOnly
                                ? L10n.string("Transaction scheduled") : receipt.kind.title
                    )
                    .font(.subheadline)
                }
            }
        }
        .foregroundStyle(KualiaPalette.peekInk)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityIdentifier("home.transactionPeek")
        .onChange(of: presentation.showsFinalAmount) { _, isFinal in
            if isFinal {
                UIAccessibility.post(notification: .announcement, argument: accessibilitySummary)
            }
        }
    }

    private func lifecycleDetail(_ change: AccountLifecycleSummary) -> String {
        if change.wasLinked && receipt.kind == .accountClosed {
            return L10n.string("\(change.name). Undo reopens it as a manual account.")
        }
        if change.wasLinked && receipt.kind == .accountReopened {
            return L10n.string("\(change.name). Reconnect your bank to resume syncing.")
        }
        return change.name
    }

    private func accountCreationResult(_ account: AccountCreationSummary) -> some View {
        HStack(alignment: .center, spacing: 14) {
            KualiaIconImage(
                icon: !presentation.showsFinalAmount
                    ? .checkCircle
                    : account.readyToAssignDelta == 0
                        ? .checkCircle : .arrowRightCircle, size: 28
            )
            .font(.system(size: 28, weight: .medium))
            .contentTransition(reduceMotion ? .identity : .opacity)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(accountResultTitle(account))
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    .contentTransition(.opacity)
                Text(accountResultDetail(account))
                    .font(.subheadline)
                    .foregroundStyle(KualiaPalette.peekMutedInk)
                    .contentTransition(.opacity)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .sensoryFeedback(.success, trigger: presentation.reveal.isPresented)
    }

    private func accountResultTitle(_ account: AccountCreationSummary) -> String {
        guard presentation.showsFinalAmount else { return L10n.string("Account created") }
        if account.readyToAssignDelta > 0 {
            return L10n.string(
                "\(money(Decimal(account.readyToAssignDelta))) added to Ready to Assign")
        }
        if account.readyToAssignDelta < 0 {
            return L10n.string(
                "\(money(-Decimal(account.readyToAssignDelta))) removed from Ready to Assign")
        }
        return account.startingBalance == 0
            ? L10n.string("Ready for your first transaction")
            : L10n.string("Starting balance recorded")
    }

    private func accountResultDetail(_ account: AccountCreationSummary) -> String {
        guard presentation.showsFinalAmount else { return account.name }
        if account.readyToAssignDelta != 0 {
            return L10n.string("From \(account.name)'s starting balance.")
        }
        if account.startingBalance == 0 { return L10n.string("\(account.name) starts at zero.") }
        return L10n.string(
            "\(money(Decimal(account.startingBalance))) · Ready to Assign unchanged.")
    }

    private func categoryBalance(_ change: TransactionBudgetChange) -> some View {
        let usesInlineAmount = receipt.budgetChanges.count > 1
        let layout =
            usesInlineAmount
            ? AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 16))
            : AnyLayout(VStackLayout(alignment: .leading, spacing: 3))

        return layout {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(presentation.categoryTitle(for: change))
                        .font(.system(.subheadline, weight: .medium))
                    // Keep the badge's width stable as the balance crosses zero.
                    if change.before < 0 || change.after < 0 {
                        Text(L10n.string("Overspent"))
                            .font(.caption)
                            .foregroundStyle(KualiaPalette.peekMutedInk)
                            .opacity(presentation.isOverspent(for: change) ? 1 : 0)
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
                Text(presentation.categoryTitle(for: change))
                    .font(.system(.subheadline, weight: .medium))
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ZStack(alignment: usesInlineAmount ? .trailing : .leading) {
                if usesInlineAmount {
                    // Reserve both widths so changing digits cannot reflow the category label.
                    Text(money(Decimal(change.before))).hidden()
                    Text(money(Decimal(change.after))).hidden()
                }
                Text(money(Decimal(presentation.amount(for: change))))
                    .contentTransition(
                        reduceMotion
                            ? .identity : .numericText(countsDown: change.after < change.before)
                    )
            }
            .font(.system(.title3, design: .rounded, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .layoutPriority(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var accessibilitySummary: String {
        if receipt.isUpdating { return L10n.string("Updating transaction…") }
        if let change = receipt.accountLifecycle {
            return "\(receipt.kind.title). \(lifecycleDetail(change))"
        }
        if let account = receipt.accountCreation {
            return "\(accountResultTitle(account)). \(accountResultDetail(account))"
        }
        guard !receipt.budgetChanges.isEmpty else {
            return receipt.isScheduledOnly
                ? L10n.string("Transaction scheduled for \(receipt.dateKey)") : receipt.kind.title
        }
        return receipt.budgetChanges.map { change in
            let category = presentation.categoryTitle(for: change)
            let overspent = presentation.isOverspent(for: change) ? " Overspent." : ""
            guard presentation.showsFinalAmount else {
                return
                    L10n.string(
                        "\(category). Available \(money(Decimal(change.before))).\(overspent)")
            }
            return
                L10n.string(
                    "\(category). Before \(money(Decimal(change.before))). Now \(money(Decimal(change.after))).\(overspent)"
                )
        }.joined(separator: " ")
    }

    private func money(_ amount: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: amount, currencyCode: receipt.workspace.currencyCode,
            minorUnit: receipt.workspace.minorUnit, showsPositiveSign: false,
            usesAbsoluteValue: false)
    }
}

struct HomeTransactionSelectionPeek: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let store: TransactionFeedStore

    private var showsFeedback: Bool {
        store.isSavingSelection || store.selectionConfirmationMessage != nil
    }

    private var showsUndo: Bool { store.hasSelectionDeletionUndo || store.isRestoringSelection }

    var body: some View {
        HStack(spacing: 16) {
            ZStack(alignment: .leading) {
                // Reserve the count/amount's height throughout saving and confirmation.
                selectionSummary
                    .opacity(showsFeedback ? 0 : 1)
                    .accessibilityHidden(showsFeedback)
                if store.isSavingSelection {
                    Text(
                        store.isRestoringSelection
                            ? L10n.string("Restoring transactions...")
                            : L10n.string("Saving edits...")
                    )
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    .accessibilityIdentifier("transaction-selection-saving")
                    .transition(.opacity)
                } else if let message = store.selectionConfirmationMessage {
                    Label(message, icon: .checkCircle)
                        .font(.system(.headline, design: .rounded, weight: .semibold))
                        .accessibilityIdentifier("transaction-selection-confirmation")
                        .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 10) {
                Button {
                    if showsUndo {
                        Task { await store.undoSelectionDeletion() }
                    } else {
                        store.presentSelectionEditor()
                    }
                } label: {
                    Text(showsUndo ? L10n.string("Undo") : L10n.string("Edit"))
                        .font(.system(.body, design: .rounded, weight: .semibold))
                        .opacity(store.isSavingSelection ? 0 : 1)
                        .overlay {
                            if store.isSavingSelection {
                                ProgressView().tint(KualiaPalette.peekInk)
                            }
                        }
                        .frame(minWidth: 42)
                        .padding(.horizontal, 20)
                        .frame(minHeight: 48)
                        .background(KualiaPalette.peekControlSurface, in: Capsule())
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(
                    (!showsUndo && store.selectionSummary.count == 0) || store.isPerformingAction
                )
                .accessibilityLabel(
                    store.isSavingSelection
                        ? L10n.string("Saving edits")
                        : showsUndo
                            ? L10n.string("Undo deletion")
                            : L10n.string("Edit selected transactions")
                )
                .accessibilityIdentifier("transaction-selection-actions")

                Button(action: store.endSelection) {
                    KualiaIconImage(icon: .close, size: 18)
                        .frame(width: 48, height: 48)
                        .background(KualiaPalette.peekControlSurface, in: Circle())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityLabel(L10n.string("Exit selection mode"))
                .accessibilityIdentifier("transaction-selection-close")
            }
        }
        .foregroundStyle(KualiaPalette.peekInk)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: store.isSavingSelection)
        .animation(
            reduceMotion ? nil : .easeInOut(duration: 0.18),
            value: store.selectionConfirmationMessage
        )
        .task(id: "\(store.selectionSaveRevision)-\(store.actionErrorMessage != nil)") {
            let revision = store.selectionSaveRevision
            guard store.selectionConfirmationMessage != nil, store.actionErrorMessage == nil else {
                return
            }
            do {
                try await Task.sleep(
                    for: store.hasSelectionDeletionUndo ? .seconds(5) : .seconds(1.5))
            } catch { return }
            guard !Task.isCancelled else { return }
            store.dismissSelectionConfirmation(revision: revision)
        }
    }

    private var selectionSummary: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L10n.string("\(store.selectionSummary.count) selected"))
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .accessibilityIdentifier("transaction-selection-count")
            if let workspace = store.workspace {
                Text(
                    MoneyAmountFormatter.string(
                        decimalMinorUnits: store.selectionSummary.total,
                        currencyCode: workspace.currencyCode, minorUnit: workspace.minorUnit,
                        showsPositiveSign: false, usesAbsoluteValue: false)
                )
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .accessibilityIdentifier("transaction-selection-total")
            }
        }
    }
}

/// Uses the Spending page's receipt, curtain reveal, timing, and Undo in drill-down surfaces.
struct TransactionActionFeedback: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let store: TransactionFeedStore?
    var background: Color = KualiaPalette.canvas
    var onUndo: () async -> Void = {}
    @State private var ownerID = UUID()
    @State private var presentation = TransactionPeekPresentation()
    @State private var height: CGFloat = 100

    private var animation: Animation? { reduceMotion ? nil : .smooth(duration: 0.3) }

    func body(content: Content) -> some View {
        PeekContainer(
            presentation: presentation.reveal, expansionHeight: height,
            foregroundColor: background, expansionColor: presentation.backgroundColor
        ) {
            content
        } expansion: {
            if let store, let receipt = presentation.receipt {
                HStack(spacing: 16) {
                    HomeTransactionPeek(presentation: presentation, receipt: receipt)
                    if presentation.showsUndo {
                        HomeTransactionUndoButton(isPerformingAction: !store.canUndoDeletion) {
                            Task {
                                await store.undoLastDeletion()
                                await onUndo()
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 32)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: { height in
                    guard presentation.receipt?.id == receipt.id, !presentation.isClosing else {
                        return
                    }
                    withAnimation(animation) {
                        self.height = height
                        presentation.revealContent(receiptID: receipt.id)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .onAppear { store?.registerReceiptPresentation(ownerID) }
        .onDisappear {
            store?.unregisterReceiptPresentation(ownerID)
            presentation.dismiss()
        }
        .onChange(of: store?.receiptPresentationOwner) { _, owner in
            if owner != ownerID { presentation.dismiss() }
        }
        .onChange(of: store?.workspace?.id) { _, _ in presentation.dismiss() }
        .onChange(of: store?.mutationReceiptRevision) { _, _ in
            guard let store, store.receiptPresentationOwner == ownerID else { return }
            guard let receipt = store.latestMutationReceipt else {
                presentation.dismiss()
                return
            }
            let updateAnimation =
                presentation.receipt?.id == receipt.id && !reduceMotion
                ? Animation.easeInOut(duration: TransactionPeekTiming.balanceAnimation) : nil
            withTransaction(Transaction(animation: updateAnimation)) {
                presentation.present(
                    receipt,
                    showsUndo: !store.deletedEntries.isEmpty
                        && (receipt.kind == .deleted || !receipt.isPending))
            }
        }
        .task(id: presentation.animationID) { await animateReceipt() }
        .alert(
            L10n.string("Transaction couldn't be updated"),
            isPresented: Binding(
                get: {
                    store?.receiptPresentationOwner == ownerID && store?.actionErrorMessage != nil
                },
                set: { if !$0 { store?.actionErrorMessage = nil } })
        ) {
            Button(L10n.string("OK"), role: .cancel) { store?.actionErrorMessage = nil }
        } message: {
            Text(store?.actionErrorMessage ?? L10n.string("Please try again."))
        }
    }

    private func animateReceipt() async {
        guard presentation.animationID != nil, let receipt = presentation.receipt else { return }
        do {
            try await Task.sleep(for: TransactionPeekTiming.beforeHold(for: receipt.kind))
            try Task.checkCancellation()
            guard presentation.receipt?.id == receipt.id else { return }
            withAnimation(
                reduceMotion ? nil : .easeInOut(duration: TransactionPeekTiming.balanceAnimation)
            ) {
                presentation.applyChange(receiptID: receipt.id)
            }
            try await Task.sleep(
                for: UIAccessibility.isVoiceOverRunning
                    ? .seconds(8) : TransactionPeekTiming.resultHold(for: receipt.kind))
            try Task.checkCancellation()
        } catch { return }
        guard presentation.receipt?.id == receipt.id,
            let sessionID = presentation.reveal.sessionID
        else { return }
        withAnimation(animation, completionCriteria: .removed) {
            presentation.beginClosing(receiptID: receipt.id)
        } completion: {
            if presentation.finishClosing(receiptID: receipt.id, sessionID: sessionID) {
                store?.finishBudgetPeek(receiptID: receipt.id)
            }
        }
    }
}
