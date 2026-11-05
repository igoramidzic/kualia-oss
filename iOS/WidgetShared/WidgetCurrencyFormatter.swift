import Foundation

/// Currency formatting for widgets. Self-contained (no dependency on main app extensions).
nonisolated enum WidgetCurrencyFormatter {
    /// Formats an amount in minor units (e.g., cents) to a currency string.
    static func format(
        _ cents: Int, currencyCode: String, locale: Locale = WidgetSharedStorage.locale
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode

        let decimalPlaces = formatter.maximumFractionDigits
        let divisor = pow(10.0, Double(decimalPlaces))
        let value = Double(abs(cents)) / divisor

        let formatted = formatter.string(from: NSNumber(value: value)) ?? "$0.00"

        if cents < 0 {
            return "−\(formatted)"
        }
        return formatted
    }

    /// Formats an amount showing only the absolute value.
    static func formatAbsolute(
        _ cents: Int, currencyCode: String, locale: Locale = WidgetSharedStorage.locale
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode

        let decimalPlaces = formatter.maximumFractionDigits
        let divisor = pow(10.0, Double(decimalPlaces))
        let value = Double(abs(cents)) / divisor

        return formatter.string(from: NSNumber(value: value)) ?? "$0.00"
    }
}
