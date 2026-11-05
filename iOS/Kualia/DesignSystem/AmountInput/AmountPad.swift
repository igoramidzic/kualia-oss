import SwiftUI

/// A presentation-independent tool drawer. The owner decides how to show and dismiss it.
struct AmountPad: View {
    enum DismissButtonStyle {
        case primary
        case secondary
    }

    struct HeaderAction {
        let title: String
        var icon: KualiaIcon? = nil
        var isEnabled = true
        let perform: () -> Void
    }

    @Binding var calculator: AmountCalculator
    let accessibilityIdentifierPrefix: String
    let onDismiss: () -> Void
    var onCancel: (() -> Void)? = nil
    var onContentHeightChange: ((CGFloat) -> Void)? = nil
    var backgroundColor: Color = KualiaPalette.peekBackground
    var topPadding: CGFloat = 20
    var headerAction: HeaderAction? = nil
    var leadingHeaderAction: HeaderAction? = nil
    var primaryActionTitle = L10n.string("Done")
    var isPrimaryActionEnabled = true
    var dismissButtonStyle: DismissButtonStyle = .primary

    @State private var startingCalculator: AmountCalculator
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @ScaledMetric(relativeTo: .title3) private var keyHeight = 54

    init(
        calculator: Binding<AmountCalculator>, accessibilityIdentifierPrefix: String,
        onDismiss: @escaping () -> Void, onCancel: (() -> Void)? = nil,
        onContentHeightChange: ((CGFloat) -> Void)? = nil,
        backgroundColor: Color = KualiaPalette.peekBackground, topPadding: CGFloat = 20,
        headerAction: HeaderAction? = nil, leadingHeaderAction: HeaderAction? = nil,
        primaryActionTitle: String = L10n.string("Done"), isPrimaryActionEnabled: Bool = true,
        dismissButtonStyle: DismissButtonStyle = .primary
    ) {
        _calculator = calculator
        _startingCalculator = State(initialValue: calculator.wrappedValue)
        self.accessibilityIdentifierPrefix = accessibilityIdentifierPrefix
        self.onDismiss = onDismiss
        self.onCancel = onCancel
        self.onContentHeightChange = onContentHeightChange
        self.backgroundColor = backgroundColor
        self.topPadding = topPadding
        self.headerAction = headerAction
        self.leadingHeaderAction = leadingHeaderAction
        self.primaryActionTitle = primaryActionTitle
        self.isPrimaryActionEnabled = isPrimaryActionEnabled
        self.dismissButtonStyle = dismissButtonStyle
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let headerAction {
                    HStack(spacing: 8) {
                        if let leadingHeaderAction {
                            headerButton(leadingHeaderAction, compact: true)
                                .accessibilityIdentifier(
                                    "\(accessibilityIdentifierPrefix)-edit-target")
                        }
                        headerButton(headerAction)
                            .accessibilityIdentifier(
                                "\(accessibilityIdentifierPrefix)-header-action")
                    }
                }
                keypad
                    // Keep the standard numeric keypad order in right-to-left languages.
                    .environment(\.layoutDirection, .leftToRight)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 28)
            .padding(.top, topPadding)
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height
            } action: {
                onContentHeightChange?($0)
            }
            .background(ImmediateScrollTouches())
        }
        .contentMargins(.vertical, 0, for: .scrollContent)
        .scrollBounceBehavior(.basedOnSize)
        .background(backgroundColor)
        .foregroundStyle(KualiaPalette.peekInk)
        .fontDesign(.rounded)
        .accessibilityIdentifier("\(accessibilityIdentifierPrefix)-amount-pad")
    }

    private func headerButton(_ action: HeaderAction, compact: Bool = false) -> some View {
        Button(action: action.perform) {
            HStack(spacing: 8) {
                if let icon = action.icon {
                    KualiaIconImage(icon: icon, size: 20)
                }
                if !compact || action.icon == nil {
                    Text(action.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .minimumScaleFactor(0.6)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, compact ? 14 : 16)
            .padding(.vertical, 12)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: 48)
            .background(KualiaPalette.peekControlSurface, in: Capsule())
            .contentShape(.interaction, Capsule())
            .opacity(action.isEnabled ? 1 : 0.4)
        }
        .buttonStyle(KualiaHapticButtonStyle(appearance: AmountKeyStyle(isPrimary: false)))
        .disabled(!action.isEnabled)
        .accessibilityLabel(action.title)
    }

    private var keypad: some View {
        Grid(horizontalSpacing: 8, verticalSpacing: 6) {
            GridRow {
                digitKey(7)
                digitKey(8)
                digitKey(9)
                operationKey(.subtract, icon: .minus, accessibilityLabel: L10n.string("Subtract"))
            }
            GridRow {
                digitKey(4)
                digitKey(5)
                digitKey(6)
                operationKey(.add, icon: .plus, accessibilityLabel: L10n.string("Add"))
            }
            GridRow {
                digitKey(1)
                digitKey(2)
                digitKey(3)
                key(
                    icon: .equals, accessibilityLabel: L10n.string("Equals"),
                    isDisabled: calculator.amount == nil
                ) {
                    calculator.resolve()
                }
            }
            GridRow {
                key(
                    icon: .closeCircle, accessibilityLabel: L10n.string("Cancel amount changes"),
                    action: cancel
                )
                .accessibilityIdentifier("cancel-\(accessibilityIdentifierPrefix)-amount")
                digitKey(0)
                key(icon: .backspace, accessibilityLabel: L10n.string("Delete last digit")) {
                    calculator.deleteLast()
                }
                key(
                    primaryActionTitle,
                    icon: dismissButtonStyle == .secondary ? .chevronDown : nil,
                    accessibilityLabel: primaryActionTitle,
                    isPrimary: dismissButtonStyle == .primary,
                    isDisabled: !isPrimaryActionEnabled, action: onDismiss
                )
                .accessibilityIdentifier("hide-\(accessibilityIdentifierPrefix)-amount")
            }
        }
    }

    func cancel() {
        if let onCancel {
            onCancel()
        } else {
            // Writing the original calculator through the binding also restores
            // callers that preview their draft amount while typing.
            calculator = startingCalculator
            onDismiss()
        }
    }

    private func digitKey(_ digit: Int) -> some View {
        key(String(digit), accessibilityLabel: String(digit), isDigit: true) {
            calculator.appendDigit(digit)
        }
    }

    private func operationKey(
        _ operation: AmountCalculator.Operation,
        icon: KualiaIcon,
        accessibilityLabel: String
    ) -> some View {
        key(icon: icon, accessibilityLabel: accessibilityLabel) {
            calculator.appendOperation(operation)
        }
    }

    private func key(
        _ title: String = "",
        icon: KualiaIcon? = nil,
        accessibilityLabel: String,
        isDigit: Bool = false,
        isPrimary: Bool = false,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if let icon {
                    KualiaIconImage(icon: icon, size: 22)
                } else {
                    Text(title)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
            }
            .font(.title3.weight(isPrimary ? .semibold : .medium))
            .frame(maxWidth: .infinity)
            .frame(minWidth: 44, minHeight: max(44, keyHeight))
            .foregroundStyle(isPrimary ? KualiaPalette.peekBackground : KualiaPalette.peekInk)
            .background(
                isPrimary
                    ? KualiaPalette.peekInk
                    : KualiaPalette.peekControlSurface.opacity(isDigit ? 0.45 : 1),
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .contentShape(.interaction, RoundedRectangle(cornerRadius: 20, style: .continuous))
            .opacity(isDisabled ? 0.4 : 1)
        }
        .buttonStyle(KualiaHapticButtonStyle(appearance: AmountKeyStyle(isPrimary: isPrimary)))
        .disabled(isDisabled)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// Two permanent lines: the amount, then its title or calculation. Only their
/// contents change while typing; Dynamic Type still determines the line heights.
struct AmountPadDisplay: View {
    let calculator: AmountCalculator
    let currencyCode: String
    let title: String
    let accessibilityIdentifierPrefix: String

    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            // Overlays cannot change the size of these font-sized placeholders.
            Text("0")
                .font(.largeTitle.weight(.semibold))
                .hidden()
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    Text(amountText)
                        .font(.largeTitle.weight(.semibold).monospacedDigit())
                        .lineLimit(1)
                        .minimumScaleFactor(0.4)
                        .foregroundStyle(
                            calculator.amount == nil
                                ? KualiaPalette.peekMutedInk : KualiaPalette.peekInk
                        )
                        .contentTransition(.numericText())
                        .animation(
                            reduceMotion ? nil : .smooth(duration: 0.2), value: amountText
                        )
                        .accessibilityLabel(
                            calculator.amount == nil
                                ? L10n.string("Current amount") : L10n.string("Result")
                        )
                        .accessibilityValue(amountText)
                        .accessibilityHint(title)
                        .accessibilityIdentifier("\(accessibilityIdentifierPrefix)-amount-result")
                }

            Text(" ")
                .font(.subheadline)
                .hidden()
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    AmountCalculationCaption(
                        calculator: calculator, title: title,
                        accessibilityIdentifierPrefix: accessibilityIdentifierPrefix,
                        foregroundColor: KualiaPalette.peekMutedInk
                    )
                }
        }
        .padding(.bottom, 4)
    }

    private var amountText: String {
        guard let amount = calculator.previewAmount else { return "—" }
        return MoneyAmountFormatter.string(
            minorUnits: amount, currencyCode: currencyCode, minorUnit: calculator.minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: !calculator.allowsNegativeAmounts,
            locale: locale
        )
    }

}

/// The calculation belongs beside the field being edited, independently of the keypad.
struct AmountCalculationCaption: View {
    let calculator: AmountCalculator
    var title: String = ""
    let accessibilityIdentifierPrefix: String
    var foregroundColor: Color = KualiaPalette.mutedInk
    var compactCurrencyCode: String?

    @Environment(\.locale) private var locale

    private var isCompact: Bool { compactCurrencyCode != nil }

    @ViewBuilder
    var body: some View {

        if let error = calculator.error, error != .incompleteExpression {
            Text(error.errorDescription ?? L10n.string("Check the calculation"))
                .font(isCompact ? .caption : .subheadline)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundStyle(KualiaPalette.budgetNegative)
                .accessibilityIdentifier("\(accessibilityIdentifierPrefix)-amount-error")
        } else if calculator.hasOperations {
            let expression =
                if let compactCurrencyCode {
                    calculator.displayCurrentOperation(
                        currencyCode: compactCurrencyCode, locale: locale) ?? ""
                } else {
                    calculator.displayExpression(decimalSeparator: locale.decimalSeparator ?? ".")
                }
            Group {
                if isCompact {
                    Text(expression)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                } else {
                    ScrollView(.horizontal) {
                        Text(expression)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .defaultScrollAnchor(.trailing)
                    .scrollIndicators(.hidden)
                }
            }
            .font((isCompact ? Font.caption : .subheadline).monospacedDigit())
            .environment(\.layoutDirection, .leftToRight)
            .foregroundStyle(foregroundColor)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L10n.string("Calculation"))
            .accessibilityValue(expression)
            .accessibilityIdentifier("\(accessibilityIdentifierPrefix)-amount-expression")
        } else if !title.isEmpty {
            Label {
                Text(title).lineLimit(1)
            } icon: {
                KualiaIconImage(icon: .plusMinus, size: 18)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(foregroundColor)
            .accessibilityLabel(title)
            .accessibilityIdentifier("\(accessibilityIdentifierPrefix)-amount-title")
        }
    }
}

private struct AmountKeyStyle: ButtonStyle {
    let isPrimary: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(isPrimary ? KualiaPalette.peekBackground : KualiaPalette.peekInk)
                    .opacity(configuration.isPressed ? 0.14 : 0)
                    .allowsHitTesting(false)
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.94 : 1)
            .animation(
                reduceMotion
                    ? nil
                    : configuration.isPressed
                        ? .easeOut(duration: 0.07)
                        : .spring(duration: 0.24, bounce: 0.25),
                value: configuration.isPressed
            )
    }
}
