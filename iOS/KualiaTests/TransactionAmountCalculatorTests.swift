import Foundation
import SwiftUI
import Testing

@testable import Kualia

@MainActor
struct TransactionAmountCalculatorTests {
    @Test(arguments: [Int64(0), Int64(1_250), Int64(-2_500)])
    func defaultCancelRestoresTheOpeningAmountBeforeClosing(amount: Int64) {
        var calculator = AmountCalculator(amount: amount, minorUnit: 2, allowsNegativeAmounts: true)
        var amountAtDismissal: Int64?
        let pad = AmountPad(
            calculator: Binding(get: { calculator }, set: { calculator = $0 }),
            accessibilityIdentifierPrefix: "test",
            onDismiss: { amountAtDismissal = calculator.amount })
        calculator = AmountCalculator(amount: 900, minorUnit: 2, allowsNegativeAmounts: true)
        calculator.appendOperation(.add)
        pad.cancel()
        #expect(calculator.amount == amount)
        #expect(amountAtDismissal == amount)
        #expect(!calculator.hasOperations)
    }

    @Test
    func explicitCancelNeverInvokesThePrimaryAction() {
        var calculator = AmountCalculator(amount: 100, minorUnit: 2)
        var cancelled = false
        var submitted = false
        let pad = AmountPad(
            calculator: Binding(get: { calculator }, set: { calculator = $0 }),
            accessibilityIdentifierPrefix: "test",
            onDismiss: { submitted = true }, onCancel: { cancelled = true },
            primaryActionTitle: "Move", isPrimaryActionEnabled: false)
        calculator = AmountCalculator(amount: 200, minorUnit: 2)
        pad.cancel()
        #expect(cancelled)
        #expect(!submitted)
        #expect(calculator.amount == 200)
    }

    @Test
    func evaluatesDecimalMoneyAndStandardOperatorPrecedence() throws {
        #expect(try TransactionAmountCalculator.evaluate("0.1+0.2", minorUnit: 2) == 30)
        #expect(try TransactionAmountCalculator.evaluate("10+2×3", minorUnit: 2) == 1_600)
        #expect(try TransactionAmountCalculator.evaluate("20−12÷3", minorUnit: 2) == 1_600)
        #expect(try TransactionAmountCalculator.evaluate("20÷2×3−5", minorUnit: 2) == 2_500)
        #expect(try TransactionAmountCalculator.evaluate("1−2+3", minorUnit: 2) == 200)
    }

    @Test
    func roundsOnlyTheFinalCurrencyAmount() throws {
        #expect(try TransactionAmountCalculator.evaluate("1÷3", minorUnit: 2) == 33)
        #expect(try TransactionAmountCalculator.evaluate("1÷3×3", minorUnit: 2) == 100)
        #expect(try TransactionAmountCalculator.evaluate("12.345", minorUnit: 2) == 1_235)
        #expect(try TransactionAmountCalculator.evaluate("12.5", minorUnit: 0) == 13)
        #expect(try TransactionAmountCalculator.evaluate("1.2345", minorUnit: 3) == 1_235)
        #expect(try TransactionAmountCalculator.evaluate("0.0004+0.0004", minorUnit: 3) == 1)
    }

    @Test
    func retainsExactInt64BoundaryWithoutConvertingThroughDouble() throws {
        #expect(
            try TransactionAmountCalculator.evaluate("92233720368547758.07", minorUnit: 2)
                == Int64.max
        )
        #expect(
            throws: TransactionAmountCalculator.CalculationError.amountTooLarge,
            performing: {
                try TransactionAmountCalculator.evaluate("92233720368547758.08", minorUnit: 2)
            }
        )
        #expect(
            throws: TransactionAmountCalculator.CalculationError.amountTooLarge,
            performing: {
                try TransactionAmountCalculator.evaluate(
                    "999999999999999999999×999999999999999999999", minorUnit: 2)
            }
        )
    }

    @Test
    func refusesInvalidOrIncompleteExpressionsAndNegativeResults() {
        for expression in ["", "12+", "12."] {
            #expect(
                throws: TransactionAmountCalculator.CalculationError.incompleteExpression,
                performing: { try TransactionAmountCalculator.evaluate(expression, minorUnit: 2) }
            )
        }
        for expression in ["1..2", "1++2", "hello", "1e2", "-2"] {
            #expect(
                throws: TransactionAmountCalculator.CalculationError.invalidExpression,
                performing: { try TransactionAmountCalculator.evaluate(expression, minorUnit: 2) }
            )
        }
        #expect(
            throws: TransactionAmountCalculator.CalculationError.divideByZero,
            performing: { try TransactionAmountCalculator.evaluate("1÷0", minorUnit: 2) }
        )
        #expect(
            throws: TransactionAmountCalculator.CalculationError.negativeAmount,
            performing: { try TransactionAmountCalculator.evaluate("1−2", minorUnit: 2) }
        )
        #expect(
            throws: TransactionAmountCalculator.CalculationError.negativeAmount,
            performing: { try TransactionAmountCalculator.evaluate("0−0.001", minorUnit: 2) }
        )
    }

    @Test
    func startsWithExactAmountAndFirstDigitReplacesIt() {
        var calculator = TransactionAmountCalculator(amount: 8_420, minorUnit: 2)
        #expect(calculator.expression == "84.20")
        #expect(calculator.amount == 8_420)
        calculator.appendDigit(9)
        #expect(calculator.expression == "0.09")
        calculator.appendDigit(5)
        #expect(calculator.amount == 95)
        calculator.appendDigit(0)
        #expect(calculator.amount == 950)
    }

    @Test
    func typingShiftsDigitsInFromTheCurrencyMinorUnit() {
        for (precision, expected) in [(0, "123"), (2, "1.23"), (3, "0.123")] {
            var calculator = TransactionAmountCalculator(amount: 0, minorUnit: precision)
            calculator.appendDigit(1)
            #expect(calculator.amount == 1)
            calculator.appendDigit(2)
            #expect(calculator.amount == 12)
            calculator.appendDigit(3)
            #expect(calculator.amount == 123)
            #expect(calculator.expression == expected)
            calculator.deleteLast()
            #expect(calculator.amount == 12)
        }
    }

    @Test
    func shiftingDigitsKeepsLargeAmountsExactAndOverflowRecoverable() {
        var calculator = TransactionAmountCalculator(amount: 0, minorUnit: 2)
        for digit in String(Int64.max).compactMap(\.wholeNumberValue) {
            calculator.appendDigit(digit)
        }
        #expect(calculator.amount == Int64.max)
        calculator.appendDigit(8)
        #expect(calculator.error == .amountTooLarge)
        calculator.deleteLast()
        #expect(calculator.amount == Int64.max)
    }

    @Test
    func supportsArithmeticFromTheInitialAmountAndOperatorReplacement() {
        var calculator = TransactionAmountCalculator(amount: 8_420, minorUnit: 2)
        calculator.appendOperation(.add)
        calculator.appendOperation(.multiply)
        #expect(calculator.expression == "84.20×")
        #expect(calculator.error == .incompleteExpression)
        calculator.appendDigit(2)
        calculator.appendDigit(0)
        calculator.appendDigit(0)
        #expect(calculator.amount == 16_840)
        calculator.resolve()
        #expect(calculator.expression == "168.40")
        calculator.appendOperation(.subtract)
        calculator.appendDigit(8)
        calculator.appendDigit(0)
        calculator.appendDigit(0)
        #expect(calculator.amount == 16_040)
    }

    @Test
    func clearDeleteAndEqualsKeepCentsFirstEntryPredictable() {
        var calculator = TransactionAmountCalculator(amount: 500, minorUnit: 2)
        calculator.appendDigit(5)
        #expect(calculator.expression == "0.05")
        calculator.deleteLast()
        #expect(calculator.expression == "0.00")
        calculator.appendOperation(.add)
        calculator.appendDigit(2)
        calculator.resolve()
        #expect(calculator.expression == "0.02")
        #expect(!calculator.hasOperations)
        calculator.appendDigit(3)
        #expect(calculator.expression == "0.03")
        calculator.clear()
        calculator.deleteLast()
        calculator.appendDigit(0)
        calculator.appendDigit(7)
        #expect(calculator.expression == "0.07")
        #expect(calculator.amount == 7)
    }

    @Test
    func backspaceCanCrossFromAnOperandToItsOperatorAndPreviousAmount() {
        var calculator = TransactionAmountCalculator(amount: 1_234, minorUnit: 2)
        calculator.appendOperation(.add)
        calculator.appendDigit(5)
        #expect(calculator.expression == "12.34+0.05")
        calculator.deleteLast()
        #expect(calculator.expression == "12.34+0.00")
        calculator.deleteLast()
        #expect(calculator.expression == "12.34+")
        #expect(calculator.error == .incompleteExpression)
        calculator.deleteLast()
        #expect(calculator.expression == "12.34")
        calculator.deleteLast()
        #expect(calculator.expression == "1.23")
        #expect(calculator.amount == 123)
    }

    @Test
    func localizesOnlyTheDisplayAndLeavesTheCalculationCanonical() {
        var calculator = TransactionAmountCalculator(amount: 1_250, minorUnit: 2)
        calculator.appendOperation(.divide)
        calculator.appendDigit(2)
        calculator.appendDigit(0)
        calculator.appendDigit(0)
        #expect(calculator.hasOperations)
        #expect(calculator.displayExpression(decimalSeparator: ",") == "12,50 ÷ 2,00")
        #expect(calculator.expression == "12.50÷2.00")
        #expect(calculator.amount == 625)
    }

    @Test
    func rendersTheSplitKeypadAtNarrowWidthAndAccessibilitySizes() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            let image = try await HostedViewSnapshot.image(
                of: TransactionAmountPad(
                    amount: 8_420, minorUnit: 2,
                    onChange: { _ in }, onDismiss: {}
                )
                .environment(\.dynamicTypeSize, size),
                size: CGSize(width: 320, height: 470)
            )
            #expect(image.size.width == 320)
            #expect(image.size.height == 470)
            Attachment.record(
                Array(try #require(image.pngData())), named: "transaction-amount-pad-\(size).png"
            )
        }
    }

    @Test
    func rendersInlineBudgetKeypadAtNarrowWidthAndAccessibilitySizes() async throws {
        for size in [DynamicTypeSize.large, .accessibility3, .accessibility5] {
            let image = try await HostedViewSnapshot.image(
                of: AmountPad(
                    calculator: .constant(
                        AmountCalculator(
                            amount: -184_250, minorUnit: 2, allowsNegativeAmounts: true
                        )),
                    accessibilityIdentifierPrefix: "budget", onDismiss: {},
                    headerAction: .init(
                        title: BudgetCategoryAssignment(amounts: .init(available: -184_250))
                            .title(currencyCode: "USD", minorUnit: 2),
                        perform: {}),
                    leadingHeaderAction: .init(
                        title: L10n.string("Edit target"), icon: .pencil, perform: {})
                )
                .environment(\.dynamicTypeSize, size),
                size: CGSize(width: 320, height: 470)
            )
            #expect(image.size.width == 320)
            #expect(image.size.height == 470)
            Attachment.record(
                Array(try #require(image.pngData())),
                named: "budget-inline-amount-pad-\(size).png"
            )
        }
    }
}
