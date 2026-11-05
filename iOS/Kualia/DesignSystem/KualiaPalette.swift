import SwiftUI

enum KualiaPalette {
    static let canvas = adaptiveColor(
        light: (0.94, 0.94, 0.94),
        dark: (0.055, 0.055, 0.055)
    )
    static let surface = adaptiveColor(
        light: (1, 1, 1),
        dark: (0.11, 0.11, 0.11)
    )
    static let ink = adaptiveColor(
        light: (0.09, 0.09, 0.09),
        dark: (0.95, 0.95, 0.95)
    )
    static let mutedInk = adaptiveColor(
        light: (0.42, 0.42, 0.42),
        dark: (0.65, 0.65, 0.65)
    )
    static let border = adaptiveColor(
        light: (0.85, 0.85, 0.85),
        dark: (0.25, 0.25, 0.25)
    )
    static let glassTint = adaptiveColor(
        light: (0.96, 0.96, 0.96),
        dark: (0.29, 0.29, 0.29)
    )
    static let menuOptionAccent = adaptiveColor(
        light: (0.27, 0.27, 0.27),
        dark: (0.84, 0.84, 0.84)
    )
    static let menuOptionHighlight = adaptiveColor(
        light: (0.86, 0.86, 0.86),
        dark: (0.29, 0.29, 0.29)
    )
    static let cardSurface = adaptiveColor(
        light: (0.99, 0.99, 0.99),
        dark: (0.15, 0.15, 0.15)
    )
    .opacity(0.68)
    static let cardBorder = adaptiveColor(
        light: (1, 1, 1),
        dark: (0.43, 0.43, 0.43)
    )
    .opacity(0.58)
    static let accent = Color.accentColor
    // Native switch thumbs stay white in both appearances; keep their track dark enough.
    static let toggleOn = Color(red: 0.13, green: 0.43, blue: 0.25)
    static let transactionsPage = canvas
    static let budgetPage = canvas
    static let budgetSelection = adaptiveColor(
        light: (0.91, 0.91, 0.91),
        dark: (0.17, 0.17, 0.17)
    )
    static let budgetNegative = adaptiveColor(
        light: (0.65, 0.17, 0.13),
        dark: (1, 0.60, 0.52)
    )
    static let budgetPositive = adaptiveColor(
        light: (0.13, 0.43, 0.25),
        dark: (0.48, 0.85, 0.61)
    )
    static let budgetUnderfunded = adaptiveColor(
        light: (0.51, 0.36, 0.04),
        dark: (0.98, 0.79, 0.32)
    )
    static let budgetAvailableProgress = adaptiveColor(
        light: (0.43, 0.57, 0.49),
        dark: (0.40, 0.56, 0.47)
    )
    static let budgetFundingProgress = adaptiveColor(
        light: (0.90, 0.71, 0.14),
        dark: (0.98, 0.79, 0.32)
    )
    static let budgetMonthNotice = Color(red: 1, green: 0.76, blue: 0.18)
    static let budgetMonthNoticeInk = Color(red: 0.18, green: 0.12, blue: 0.02)
    static let accountsPage = canvas
    static let plannedPage = canvas
    static let reportsPage = canvas
    static let reportInflow = budgetPositive
    static let reportOutflow = budgetNegative
    static let assistantPage = canvas
    static let homeGlow = Color(red: 0.47, green: 0.56, blue: 0.98)
    static let budgetGlow = Color(red: 0.92, green: 0.62, blue: 0.42)
    static let transactionsGlow = PlannedStyle.accent
    static let accountsGlow = Color(red: 0.32, green: 0.62, blue: 0.98)
    static let accountsChart = Color(red: 0.10, green: 0.38, blue: 0.78)
    static let plannedGlow = Color(red: 0.69, green: 0.48, blue: 0.94)
    static let reportsGlow = Color(red: 0.36, green: 0.41, blue: 0.47)
    static let assistantGlow = Color(red: 0.24, green: 0.79, blue: 0.75)
    static let peekBackground = Color(red: 0.025, green: 0.025, blue: 0.025)
    static let peekPositiveBackground = Color(red: 0.08, green: 0.38, blue: 0.20)
    static let peekDangerBackground = Color(red: 0.58, green: 0.10, blue: 0.09)
    static let peekInk = Color.white
    static let peekMutedInk = Color.white.opacity(0.84)
    static let peekControlSurface = Color.white.opacity(0.14)

    static func budgetInputBackground(readyToAssign: Decimal, showsCompletion: Bool = false)
        -> Color
    {
        if readyToAssign == 0 && showsCompletion { return peekPositiveBackground }
        return budgetInputBackground(tone: .init(readyToAssign: readyToAssign))
    }

    static func budgetInputBackground(tone: BudgetPeekPresentation.Tone) -> Color {
        switch tone {
        case .neutral: peekBackground
        case .positive: peekPositiveBackground
        case .negative: peekDangerBackground
        }
    }

    @available(iOS 26.0, *)
    static var controlGlass: Glass {
        .regular
            .tint(glassTint.opacity(0.38))
            .interactive()
    }

    private static func adaptiveColor(
        light: (red: Double, green: Double, blue: Double),
        dark: (red: Double, green: Double, blue: Double)
    ) -> Color {
        Color(
            uiColor: UIColor { traits in
                let components = traits.userInterfaceStyle == .dark ? dark : light
                return UIColor(
                    red: components.red,
                    green: components.green,
                    blue: components.blue,
                    alpha: 1
                )
            }
        )
    }
}
