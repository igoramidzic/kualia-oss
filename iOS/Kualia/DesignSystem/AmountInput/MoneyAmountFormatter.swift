import Foundation

/// Currency formatting shared by money inputs and summaries. Decimal keeps exact
/// Int64 amounts and larger aggregate totals out of floating-point conversions.
@MainActor
enum MoneyAmountFormatter {
    private struct Key: Hashable {
        let currencyCode: String
        let minorUnit: Int
        let localeIdentifier: String
    }

    private static var formatters: [Key: NumberFormatter] = [:]

    static func string(
        minorUnits: Int64,
        currencyCode: String,
        minorUnit: Int,
        showsPositiveSign: Bool,
        usesAbsoluteValue: Bool,
        locale: Locale = L10n.locale
    ) -> String {
        string(
            decimalMinorUnits: Decimal(minorUnits), currencyCode: currencyCode,
            minorUnit: minorUnit,
            showsPositiveSign: showsPositiveSign, usesAbsoluteValue: usesAbsoluteValue,
            locale: locale
        )
    }

    static func string(
        decimalMinorUnits minorUnits: Decimal,
        currencyCode: String,
        minorUnit: Int,
        showsPositiveSign: Bool,
        usesAbsoluteValue: Bool,
        locale: Locale = L10n.locale
    ) -> String {
        let safeMinorUnit = min(max(minorUnit, 0), 6)
        var decimalAmount = minorUnits
        var divisor = Decimal(1)

        for _ in 0..<safeMinorUnit {
            divisor *= 10
        }
        decimalAmount /= divisor

        if usesAbsoluteValue, decimalAmount < 0 {
            decimalAmount *= -1
        }

        let formatter = formatter(
            currencyCode: currencyCode, minorUnit: safeMinorUnit, locale: locale
        )
        let formatted =
            formatter.string(from: NSDecimalNumber(decimal: decimalAmount))
            ?? NSDecimalNumber(decimal: decimalAmount).stringValue

        if showsPositiveSign, minorUnits > 0 {
            return "+\(formatted)"
        }
        return formatted
    }

    private static func formatter(
        currencyCode: String, minorUnit: Int, locale: Locale
    ) -> NumberFormatter {
        let key = Key(
            currencyCode: currencyCode.uppercased(), minorUnit: minorUnit,
            localeIdentifier: locale.identifier
        )
        if let formatter = formatters[key] { return formatter }

        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = locale
        formatter.currencyCode = key.currencyCode
        formatter.minimumFractionDigits = minorUnit
        formatter.maximumFractionDigits = minorUnit
        formatters[key] = formatter
        return formatter
    }
}
