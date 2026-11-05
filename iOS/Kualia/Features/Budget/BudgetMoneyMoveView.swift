import SwiftUI

/// The budget stays visible and becomes the category picker for this peek.
struct BudgetMoneyMovePeek: View {
    let store: BudgetStore
    let session: BudgetMoneyMoveSession
    var isReceiptOnly = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !isShowingProgress && !isReceiptOnly {
                if session.phase == .choosing {
                    route
                    moveControls
                    if session.counterpart != nil && session.isCovering && session.remaining > 0 {
                        Text(L10n.string("\(money(session.remaining)) left to cover after this"))
                            .font(.caption).foregroundStyle(KualiaPalette.peekMutedInk)
                    } else if session.choices.isEmpty {
                        Text(L10n.string("No money available to move."))
                            .font(.caption).foregroundStyle(KualiaPalette.peekMutedInk)
                    }
                }
            }

            if isShowingProgress || (session.lastMoveID != nil && !session.isEnteringAmount) {
                moveStatus
            }

            if let error = session.errorMessage {
                Text(error).font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("budget-move-error")
            }
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.peekInk)
        .animation(animation, value: session.phase)
        .animation(animation, value: session.counterpart)
        .animation(animation, value: session.isEnteringAmount)
        .animation(animation, value: session.amount)
        .animation(animation, value: isShowingProgress)
        .animation(animation, value: session.lastMoveID)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("budget-money-move-peek")
        .sensoryFeedback(.success, trigger: session.lastMoveID)
    }

    private var route: some View {
        HStack(alignment: .top, spacing: 10) {
            endpointLabel(L10n.string("From"), endpoint: session.source)
            endpointLabel(L10n.string("To"), endpoint: session.destination)
        }
        .fixedSize(horizontal: false, vertical: true)
        .overlay {
            KualiaIconImage(icon: .arrowRight, size: 14)
                .foregroundStyle(KualiaPalette.peekMutedInk)
                .frame(width: 26, height: 26)
                .background(KualiaPalette.peekBackground, in: Circle())
                .accessibilityHidden(true)
                .allowsHitTesting(false)
        }
        .accessibilityIdentifier("budget-move-route")
    }

    private func endpointLabel(_ title: String, endpoint: BudgetMoneyEndpoint?) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(0.8)
                .foregroundStyle(KualiaPalette.peekMutedInk)
            Text(endpoint.flatMap(session.account)?.name ?? L10n.string("Choose category"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(
                    endpoint == nil ? KualiaPalette.peekMutedInk : KualiaPalette.peekInk
                )
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if let account = endpoint.flatMap(session.account) {
                Text(L10n.string("\(money(account.available)) available"))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(KualiaPalette.peekMutedInk)
                    .contentTransition(.numericText())
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(KualiaPalette.peekControlSurface, in: RoundedRectangle(cornerRadius: 14))
    }

    private var moveControls: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            if session.counterpart == nil {
                Text(
                    session.direction == .outgoing
                        ? L10n.string("Choose destination") : L10n.string("Choose source")
                )
                .font(.subheadline.weight(.medium))
                .foregroundStyle(KualiaPalette.peekMutedInk)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .accessibilityIdentifier("budget-move-choose-category")
            } else if session.isCovering {
                Text(money(session.amount))
                    .font(.title2.bold().monospacedDigit())
                    .contentTransition(.numericText())
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Button {
                    store.setMoneyMoveAmountEditing(true)
                } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(amountText)
                                .font(.title2.bold().monospacedDigit())
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .contentTransition(.numericText())
                            if session.isEnteringAmount {
                                AmountCalculationCaption(
                                    calculator: session.calculator,
                                    accessibilityIdentifierPrefix: "budget-move",
                                    foregroundColor: KualiaPalette.peekMutedInk,
                                    compactCurrencyCode: store.workspace?.currencyCode ?? "USD")
                            }
                        }
                        KualiaIconImage(icon: .newEntry, size: 14)
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: 48)
                    .background(KualiaPalette.peekControlSurface, in: Capsule())
                }
                .buttonStyle(.kualiaHaptic)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(L10n.string("Edit move amount, \(amountText)"))
                .accessibilityIdentifier("budget-move-edit-amount")
            }
            if session.isEnteringAmount {
                Button(action: store.useMoneyMoveMaximum) {
                    moveActionLabel
                        .hidden()
                        .overlay {
                            Text(L10n.string("Use all available"))
                                .font(.subheadline.weight(.bold))
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                                .padding(.horizontal, 10)
                        }
                        .foregroundStyle(KualiaPalette.peekInk)
                        .background(KualiaPalette.peekControlSurface, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(session.sourceLimit <= 0)
                .accessibilityLabel(L10n.string("Use all available"))
                .accessibilityIdentifier("budget-move-use-maximum")
                .transition(.opacity)
            } else {
                Button {
                    Task { await store.applyMoneyMove() }
                } label: {
                    moveActionLabel
                        .foregroundStyle(KualiaPalette.peekBackground)
                        .background(KualiaPalette.peekInk, in: Capsule())
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(!store.canApplyMoneyMove)
                .opacity(store.canApplyMoneyMove ? 1 : 0.45)
                .accessibilityIdentifier("budget-move-confirm")
            }
        }
    }

    private var moveActionLabel: some View {
        HStack(spacing: 6) {
            KualiaIconImage(icon: .transfer, size: 18)
            Text(session.isCovering ? L10n.string("Cover") : L10n.string("Move"))
        }
        .font(.subheadline.weight(.bold))
        .lineLimit(1)
        .padding(.horizontal, 24)
        .frame(minHeight: 48)
    }

    private var amountText: String {
        session.calculator.previewAmount.map { money(Decimal($0)) } ?? "—"
    }

    private var isShowingProgress: Bool {
        session.isBusy || store.isConfirmingMoneyMove
    }

    /// Keep the same row and icon slot mounted as saving becomes a receipt.
    private var moveStatus: some View {
        HStack(spacing: 12) {
            ZStack {
                if isShowingProgress {
                    ProgressView().tint(KualiaPalette.peekInk).controlSize(.small)
                        .transition(.opacity)
                } else {
                    KualiaIconImage(icon: .checkCircle, size: 20)
                        .transition(.opacity)
                }
            }
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(
                    isShowingProgress
                        ? progressLabel : L10n.string("Moved \(money(session.savedAmount))")
                )
                .font(.subheadline.weight(.medium))
                .contentTransition(.opacity)
                Text(L10n.string("to \(statusDestinationName)"))
                    .font(.caption)
                    .foregroundStyle(KualiaPalette.peekMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if !isShowingProgress && session.lastMoveID != nil {
                Button {
                    Task { await store.undoMoneyMove() }
                } label: {
                    Text(L10n.string("Undo")).font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16).frame(minHeight: 44)
                        .background(KualiaPalette.peekControlSurface, in: Capsule())
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(!store.canUndoMoneyMove)
                .opacity(session.isClosingReceipt || store.canUndoMoneyMove ? 1 : 0.45)
                .accessibilityLabel(L10n.string("Undo last money move"))
                .accessibilityIdentifier("budget-move-undo")
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityIdentifier(isShowingProgress ? "budget-move-progress" : "budget-move-receipt")
    }

    private var statusDestinationName: String {
        session.phase == .undoing || session.phase == .checkingUndo || session.phase == .undone
            ? session.savedSourceName : session.savedDestinationName
    }

    private var progressLabel: String {
        switch session.phase {
        case .undoing: L10n.string("Undoing move…")
        case .checkingUndo: L10n.string("Checking Undo…")
        case .checking: L10n.string("Checking move…")
        case .undone: L10n.string("Undoing move…")
        default: L10n.string("Moving \(money(session.savedAmount))…")
        }
    }

    private var animation: Animation? { reduceMotion ? nil : .smooth(duration: 0.3) }

    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: store.workspace?.currencyCode ?? "USD",
            minorUnit: store.workspace?.minorUnit ?? 2, showsPositiveSign: false,
            usesAbsoluteValue: false, locale: locale)
    }
}
