import SwiftUI

struct AccountReconciliationView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Bindable var store: AccountReconciliationStore
    @State private var presentation = PeekPresentation(
        initiallyPresented: true, hasVisiblePeek: true)
    @State private var padHeight: CGFloat = 274
    @State private var peekHeight: CGFloat = 78
    @State private var hasStartedEditing = false

    var body: some View {
        PeekContainer(
            presentation: presentation, expansionHeight: padHeight,
            isCompactPresented: true, compactHeight: peekHeight,
            foregroundColor: KualiaPalette.peekBackground
        ) {
            VStack(spacing: 0) {
                toolbar
                if let result = store.result {
                    success(result)
                } else if !store.canUseAccount {
                    AccountMessage(
                        title: L10n.string("Account unavailable"),
                        message: L10n.string("This account may have been removed.")
                    )
                    .padding(24)
                    Spacer()
                } else {
                    balancePage
                    if let message = store.errorMessage {
                        TransactionEditorNotice(message: message, isError: true)
                            .padding(.horizontal, 24)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KualiaPalette.canvas)
        } expansion: {
            if let sessionID = presentation.sessionID {
                AmountPad(
                    calculator: Binding(get: { store.calculator }, set: store.setCalculator),
                    accessibilityIdentifierPrefix: "reconcile",
                    onDismiss: finishAmount,
                    onCancel: {
                        store.cancelEditing()
                        closePad()
                    },
                    onContentHeightChange: { height in
                        guard presentation.acceptsMeasurement(sessionID: sessionID) else { return }
                        padHeight = height
                        withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
                            presentation.reveal(sessionID: sessionID)
                        }
                    },
                    topPadding: 4,
                    primaryActionTitle: L10n.string("Hide keypad"),
                    isPrimaryActionEnabled: store.calculator.amount != nil,
                    dismissButtonStyle: .secondary
                )
                .disabled(store.isSaving)
            }
        } compact: {
            reconciliationPeek
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.canvas)
        .interactiveDismissDisabled(store.isSaving)
        .onAppear {
            guard !hasStartedEditing else { return }
            hasStartedEditing = true
            store.beginEditing()
        }
        .onChange(of: store.result?.reconciledAt) { _, result in
            if result != nil { closePad() }
        }
        .onChange(of: store.canUseAccount) { _, available in
            if !available { closePad() }
        }
        .accessibilityIdentifier("accounts.reconcile")
    }

    private var toolbar: some View {
        HStack {
            Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
            Text(L10n.string("Reconcile account"))
                .font(.system(.headline, design: .rounded, weight: .bold))
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
            KualiaCloseButton(label: L10n.string("Close")) { dismiss() }
        }
        .foregroundStyle(KualiaPalette.ink)
        .padding(.horizontal, 18)
        .padding(.top, 20)
        .padding(.bottom, 12)
        .disabled(store.isSaving)
    }

    private var balancePage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.account?.name ?? L10n.string("Account"))
                        .font(.system(.title2, design: .rounded, weight: .bold))
                    Text(L10n.string("Does this match your bank?"))
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.string("Bank balance"))
                        .font(.system(.subheadline, weight: .medium))
                        .foregroundStyle(KualiaPalette.mutedInk)
                    HStack(spacing: 10) {
                        Button(action: openPad) {
                            Text(money(Decimal(store.calculator.previewAmount ?? 0)))
                                .font(.system(size: 38, weight: .bold, design: .rounded))
                                .lineLimit(1).minimumScaleFactor(0.45)
                                .contentTransition(.numericText())
                                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.kualiaHaptic)
                        .accessibilityLabel(L10n.string("Bank balance"))
                        .accessibilityValue(money(Decimal(store.calculator.previewAmount ?? 0)))
                        .accessibilityHint(L10n.string("Tap to edit the bank balance."))
                        .accessibilityIdentifier("reconcile.amount")
                        Button {
                            openPad()
                            store.changeSign()
                        } label: {
                            KualiaIconImage(icon: .plusMinus, size: 20)
                                .frame(width: 44, height: 44)
                                .background(KualiaPalette.canvas, in: Circle())
                        }
                        .buttonStyle(.kualiaHaptic)
                        .accessibilityLabel(L10n.string("Change sign"))
                    }
                    if presentation.sessionID != nil {
                        AmountCalculationCaption(
                            calculator: store.calculator,
                            accessibilityIdentifierPrefix: "reconcile")
                    }
                }
                .padding(16)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
                Toggle(
                    isOn: Binding(
                        get: { store.includesPending }, set: { store.setIncludesPending($0) })
                ) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L10n.string("Include pending transactions"))
                            .font(.system(.subheadline, weight: .semibold))
                        Text(
                            L10n.string(
                                "Turn this on if your bank balance includes pending transactions.")
                        )
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                .accessibilityIdentifier("reconcile.includePending")
            }
            .foregroundStyle(KualiaPalette.ink)
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .padding(.bottom, 12)
        }
        .disabled(store.isSaving)
    }

    private var reconciliationPeek: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
        let isFinished = store.result != nil || !store.canUseAccount
        return layout {
            VStack(alignment: .leading, spacing: 4) {
                if store.result != nil {
                    Text(L10n.string("Account reconciled"))
                        .font(.subheadline.weight(.semibold))
                } else if !store.canUseAccount {
                    Text(L10n.string("Account unavailable"))
                        .font(.subheadline.weight(.semibold))
                } else if let difference = store.difference, difference != 0 {
                    Text(L10n.string("Will create a balance adjustment"))
                        .font(.caption).foregroundStyle(KualiaPalette.peekMutedInk)
                    Text(money(difference, signed: true))
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .contentTransition(.numericText())
                        .accessibilityIdentifier("reconcile.adjustmentAmount")
                } else if store.difference == 0 {
                    Text(L10n.string("Balances match"))
                        .font(.subheadline.weight(.semibold))
                } else {
                    Text(
                        store.calculator.error?.errorDescription
                            ?? L10n.string("Finish the calculation.")
                    )
                    .font(.caption)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("reconcile.peekSummary")
            Button {
                if isFinished {
                    dismiss()
                } else {
                    Task { await store.reconcile() }
                }
            } label: {
                Text(isFinished ? L10n.string("Done") : L10n.string("Reconcile"))
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .opacity(store.isSaving ? 0 : 1)
                    .padding(.horizontal, 20).frame(minHeight: 48)
                    .foregroundStyle(KualiaPalette.peekBackground)
                    .overlay {
                        if store.isSaving { ProgressView().tint(KualiaPalette.peekBackground) }
                    }
                    .background(KualiaPalette.peekInk, in: Capsule())
                    .opacity(isFinished || store.canReconcile || store.isSaving ? 1 : 0.4)
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(!isFinished && !store.canReconcile)
            .accessibilityIdentifier("reconcile.confirm")
        }
        .foregroundStyle(KualiaPalette.peekInk)
        .padding(.horizontal, 24)
        .padding(.top, 18)
        .padding(.bottom, 12)
        .environment(\.colorScheme, .dark)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: {
            if abs(peekHeight - $0) > 0.5 { peekHeight = $0 }
        }
    }

    private func success(_ result: AccountReconciliationResult) -> some View {
        VStack(spacing: 20) {
            Spacer()
            KualiaIconImage(icon: .checkCircle, size: 60)
                .foregroundStyle(KualiaPalette.budgetPositive).accessibilityHidden(true)
            Text(L10n.string("Account reconciled"))
                .font(.system(.title2, design: .rounded, weight: .bold))
            Text(money(Decimal(store.calculator.amount ?? 0)))
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .lineLimit(1).minimumScaleFactor(0.5)
            Text(
                store.includesPending
                    ? L10n.string("Including pending") : L10n.string("Cleared balance")
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            if result.adjustmentCreated {
                Text(
                    L10n.string(
                        "Balance adjustment: \(money(Decimal(result.balanceAdjustmentAmount), signed: true))"
                    )
                )
                .font(.subheadline)
            }
            Text(
                L10n.string(
                    "Reviewed, cleared transactions are reconciled. Pending transactions stay pending."
                )
            )
            .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
            .multilineTextAlignment(.center)
            Spacer()
        }
        .foregroundStyle(KualiaPalette.ink)
        .padding(.horizontal, 24)
        .padding(.bottom, 36)
    }

    private func money(_ amount: Decimal, signed: Bool = false) -> String {
        AccountMoney.string(amount, workspace: store.workspace, signed: signed)
    }
    private func openPad() {
        guard !presentation.isPresented, !presentation.isPreparing, !store.isSaving else { return }
        store.beginEditing()
        presentation.prepare(hasVisiblePeek: true)
    }
    private func finishAmount() {
        guard store.calculator.amount != nil else { return }
        store.finishEditing()
        closePad()
    }
    private func closePad() {
        guard let sessionID = presentation.sessionID else { return }
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
            presentation.beginClosing()
        } completion: {
            presentation.finishClosing(sessionID: sessionID)
        }
    }
}
