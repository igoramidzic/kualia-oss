import Foundation

/// Reusable cents-first input. Signed amounts are opt-in; transaction direction stays
/// with its editor. Calculations remain Decimal until final currency rounding.
struct AmountCalculator {
    enum Operation: String, CaseIterable {
        case add = "+"
        case subtract = "−"
        case multiply = "×"
        case divide = "÷"

        fileprivate init?(character: Character) {
            switch character {
            case "+": self = .add
            case "−", "-": self = .subtract
            case "×", "*": self = .multiply
            case "÷", "/": self = .divide
            default: return nil
            }
        }
    }

    enum CalculationError: Error, Equatable, LocalizedError {
        case incompleteExpression
        case invalidExpression
        case divideByZero
        case negativeAmount
        case amountTooLarge

        var errorDescription: String? {
            switch self {
            case .incompleteExpression: nil
            case .invalidExpression: L10n.string("Check this calculation and try again.")
            case .divideByZero: L10n.string("You can't divide by zero.")
            case .negativeAmount:
                L10n.string("Use a positive amount. Change the direction in the editor.")
            case .amountTooLarge: L10n.string("This amount is too large.")
            }
        }
    }

    private(set) var expression: String
    let minorUnit: Int
    let allowsNegativeAmounts: Bool
    private var replacesOnNextDigit = true

    init(amount: Int64, minorUnit: Int, allowsNegativeAmounts: Bool = false) {
        self.minorUnit = min(max(minorUnit, 0), 6)
        self.allowsNegativeAmounts = allowsNegativeAmounts
        expression = Self.amountText(
            allowsNegativeAmounts ? amount : max(amount, 0), minorUnit: self.minorUnit
        )
    }

    var result: Result<Int64, CalculationError> {
        do {
            return .success(
                try Self.evaluate(
                    expression, minorUnit: minorUnit, allowsNegativeAmounts: allowsNegativeAmounts
                )
            )
        } catch let error as CalculationError {
            return .failure(error)
        } catch {
            return .failure(.invalidExpression)
        }
    }

    var amount: Int64? {
        try? result.get()
    }

    /// A trailing operator keeps the preceding amount visible, but never makes
    /// an unfinished expression eligible to be applied by the owning feature.
    var previewAmount: Int64? {
        if let amount { return amount }
        guard error == .incompleteExpression, let last = expression.last,
            Operation(character: last) != nil
        else { return nil }
        return try? Self.evaluate(
            String(expression.dropLast()), minorUnit: minorUnit,
            allowsNegativeAmounts: allowsNegativeAmounts
        )
    }

    var error: CalculationError? {
        if case .failure(let error) = result { return error }
        return nil
    }

    var hasOperations: Bool {
        expression.dropFirst(isNegativeOperand(expression) ? 1 : 0).contains {
            Operation(character: $0) != nil
        }
    }

    func displayExpression(decimalSeparator: String) -> String {
        expression.enumerated().map { index, character in
            if index == 0, isNegativeOperand(expression) { return "−" }
            if let operation = Operation(character: character) {
                return " \(operation.rawValue) "
            }
            return character == "." ? decimalSeparator : String(character)
        }.joined()
    }

    /// Inline money fields show only the operand being entered. A pending operator
    /// displays zero without making the unfinished calculation eligible to save.
    @MainActor
    func displayCurrentOperation(currencyCode: String, locale: Locale) -> String? {
        guard
            let index = expression.indices.dropFirst().last(where: {
                Operation(character: expression[$0]) != nil
            }), let operation = Operation(character: expression[index])
        else { return nil }
        let operand = String(expression[expression.index(after: index)...])
        guard let amount = operand.isEmpty ? 0 : try? Self.evaluate(operand, minorUnit: minorUnit)
        else { return nil }
        let formattedAmount = MoneyAmountFormatter.string(
            minorUnits: amount, currencyCode: currencyCode, minorUnit: minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale
        )
        return operation.rawValue + formattedAmount
    }

    mutating func appendDigit(_ digit: Int) {
        guard (0...9).contains(digit) else { return }
        prepareForNumericInput()
        let operand = currentOperand
        let digits = operand.replacingOccurrences(of: ".", with: "") + String(digit)
        let nextOperand = Self.amountText(digits: digits, minorUnit: minorUnit)
        guard expression.count - operand.count + nextOperand.count <= 160 else { return }
        expression.removeLast(operand.count)
        expression.append(nextOperand)
    }

    mutating func appendOperation(_ operation: Operation) {
        replacesOnNextDigit = false
        if let last = expression.last, Operation(character: last) != nil {
            expression.removeLast()
        }
        guard !expression.isEmpty, expression.count < 160 else { return }
        expression.append(operation.rawValue)
    }

    mutating func deleteLast() {
        replacesOnNextDigit = false
        let operand = currentOperand
        if operand.isEmpty {
            if !expression.isEmpty { expression.removeLast() }
        } else {
            var digits = operand.replacingOccurrences(of: ".", with: "")
            expression.removeLast(operand.count)
            // Once an operand reaches zero, another backspace steps back to its operator.
            if !expression.isEmpty, digits.allSatisfy({ $0 == "0" }) { return }
            if !digits.isEmpty { digits.removeLast() }
            expression.append(Self.amountText(digits: digits, minorUnit: minorUnit))
        }
        if expression.isEmpty { expression = Self.amountText(0, minorUnit: minorUnit) }
    }

    mutating func clear() {
        expression = Self.amountText(0, minorUnit: minorUnit)
        replacesOnNextDigit = true
    }

    /// Equals resolves the draft without committing it to the owning feature.
    mutating func resolve() {
        guard let amount else { return }
        expression = Self.amountText(amount, minorUnit: minorUnit)
        replacesOnNextDigit = true
    }

    static func evaluate(
        _ expression: String, minorUnit: Int, allowsNegativeAmounts: Bool = false
    ) throws -> Int64 {
        let tokens = try tokenize(expression, allowsNegativeAmounts: allowsNegativeAmounts)
        var total = Decimal.zero
        var term = tokens.numbers[0]
        var addition: Operation = .add

        // Fold multiplication/division into each term before adding/subtracting it.
        for (index, operation) in tokens.operations.enumerated() {
            let next = tokens.numbers[index + 1]
            switch operation {
            case .multiply, .divide:
                term = try calculate(term, operation, next)
            case .add, .subtract:
                total = try calculate(total, addition, term)
                term = next
                addition = operation
            }
        }
        var value = try calculate(total, addition, term)
        guard allowsNegativeAmounts || value >= 0 else { throw CalculationError.negativeAmount }

        var scaled = Decimal.zero
        let scalingError = NSDecimalMultiplyByPowerOf10(
            &scaled, &value, Int16(min(max(minorUnit, 0), 6)), .plain
        )
        guard scalingError == .noError else { throw CalculationError.amountTooLarge }
        var rounded = Decimal.zero
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        guard rounded <= Decimal(Int64.max), rounded >= Decimal(Int64.min) else {
            throw CalculationError.amountTooLarge
        }
        return NSDecimalNumber(decimal: rounded).int64Value
    }

    private var currentOperand: String {
        let trailingDigits = String(
            expression.reversed().prefix { Operation(character: $0) == nil }.reversed()
        )
        // A leading minus belongs to the number, rather than being a binary operator.
        if allowsNegativeAmounts, isNegativeOperand(expression),
            trailingDigits.count == expression.count - 1
        {
            return expression
        }
        return trailingDigits
    }

    private func isNegativeOperand(_ text: String) -> Bool {
        allowsNegativeAmounts && (text.hasPrefix("-") || text.hasPrefix("−"))
    }

    private mutating func prepareForNumericInput() {
        if replacesOnNextDigit {
            expression = ""
            replacesOnNextDigit = false
        }
    }

    private static func amountText(_ amount: Int64, minorUnit: Int) -> String {
        amountText(digits: String(amount), minorUnit: minorUnit)
    }

    /// Keyboard digits are minor units, including every operand in an expression.
    private static func amountText(digits input: String, minorUnit: Int) -> String {
        let isNegative = input.hasPrefix("-") || input.hasPrefix("−")
        var digits = String(input.dropFirst(isNegative ? 1 : 0).drop { $0 == "0" })
        if digits.isEmpty { digits = "0" }
        let sign = isNegative && digits != "0" ? "-" : ""
        guard minorUnit > 0 else { return sign + digits }
        while digits.count <= minorUnit { digits.insert("0", at: digits.startIndex) }
        digits.insert(".", at: digits.index(digits.endIndex, offsetBy: -minorUnit))
        return sign + digits
    }

    private static func tokenize(_ expression: String, allowsNegativeAmounts: Bool) throws -> (
        numbers: [Decimal], operations: [Operation]
    ) {
        guard expression.count <= 160 else { throw CalculationError.amountTooLarge }
        let characters = Array(expression)
        guard !characters.isEmpty else { throw CalculationError.incompleteExpression }
        var numbers: [Decimal] = []
        var operations: [Operation] = []
        var index = 0

        while index < characters.count {
            let start = index
            if allowsNegativeAmounts, index == 0,
                characters[index] == "-" || characters[index] == "−"
            {
                index += 1
            }
            var hasDecimalSeparator = false
            var digitCount = 0
            while index < characters.count {
                let character = characters[index]
                if character >= "0", character <= "9" {
                    digitCount += 1
                } else if character == ".", !hasDecimalSeparator {
                    hasDecimalSeparator = true
                } else {
                    break
                }
                index += 1
            }
            guard digitCount > 0 else { throw CalculationError.invalidExpression }
            // More than 28 digits is unnecessary for Int64 money and risks input rounding.
            guard digitCount <= 28 else { throw CalculationError.amountTooLarge }
            guard characters[index - 1] != "." else {
                throw index == characters.count
                    ? CalculationError.incompleteExpression : CalculationError.invalidExpression
            }
            let text = String(characters[start..<index]).replacingOccurrences(of: "−", with: "-")
            guard let number = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")),
                !number.isNaN
            else { throw CalculationError.invalidExpression }
            numbers.append(number)
            if index < characters.count {
                guard let operation = Operation(character: characters[index]) else {
                    throw CalculationError.invalidExpression
                }
                operations.append(operation)
                index += 1
                guard index < characters.count else { throw CalculationError.incompleteExpression }
            }
        }

        return (numbers, operations)
    }

    private static func calculate(_ lhs: Decimal, _ operation: Operation, _ rhs: Decimal) throws
        -> Decimal
    {
        var lhs = lhs
        var rhs = rhs
        var result = Decimal.zero
        let error: Decimal.CalculationError
        switch operation {
        case .add: error = NSDecimalAdd(&result, &lhs, &rhs, .plain)
        case .subtract: error = NSDecimalSubtract(&result, &lhs, &rhs, .plain)
        case .multiply: error = NSDecimalMultiply(&result, &lhs, &rhs, .plain)
        case .divide:
            guard rhs != 0 else { throw CalculationError.divideByZero }
            error = NSDecimalDivide(&result, &lhs, &rhs, .plain)
        }
        // Recurring division is rounded only when the result becomes a currency amount.
        guard error == .noError || (operation == .divide && error == .lossOfPrecision),
            !result.isNaN
        else { throw CalculationError.amountTooLarge }
        return result
    }
}
