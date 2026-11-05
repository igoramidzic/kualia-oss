import SwiftUI

/// Split amount contents hosted in the shared Peek drawer.
struct TransactionAmountPad: View {
    let amount: Int64
    let minorUnit: Int
    let onChange: (Int64) -> Void
    let onDismiss: () -> Void
    var onContentHeightChange: ((CGFloat) -> Void)?
    @State private var calculator: AmountCalculator

    init(
        amount: Int64, minorUnit: Int,
        onChange: @escaping (Int64) -> Void, onDismiss: @escaping () -> Void,
        onContentHeightChange: ((CGFloat) -> Void)? = nil
    ) {
        self.amount = amount
        self.minorUnit = minorUnit
        self.onChange = onChange
        self.onDismiss = onDismiss
        self.onContentHeightChange = onContentHeightChange
        _calculator = State(initialValue: AmountCalculator(amount: amount, minorUnit: minorUnit))
    }

    var body: some View {
        AmountPad(
            calculator: Binding(
                get: { calculator },
                set: {
                    calculator = $0
                    if let amount = $0.amount { onChange(amount) }
                }
            ),
            accessibilityIdentifierPrefix: "transaction", onDismiss: onDismiss,
            onContentHeightChange: onContentHeightChange,
            topPadding: 0
        )
        .onChange(of: amount) { _, amount in
            if calculator.amount != amount {
                calculator = AmountCalculator(amount: amount, minorUnit: minorUnit)
            }
        }
        .background(KualiaPalette.peekBackground)
    }
}
