import SwiftUI

extension EnvironmentValues {
    @Entry var checkInSettings: SettingsStore? = nil
}

struct HomeCheckInHeader: View {
    @Environment(\.checkInSettings) private var settings
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var successTrigger = false
    @State private var revealedCount: CountContext?
    var isActive = true
    var previewDays: Int? = nil
    var centered = false

    private var days: Int? {
        if let settings { return settings.profile.map { $0.checkIn?.days ?? 0 } }
        return previewDays
    }

    private var countContext: CountContext {
        CountContext(userID: settings?.profile?.clerkId, days: days)
    }

    private var history: HomeCheckInHistory? {
        countContext.userID.map { HomeCheckInHistory(defaults: .standard, userID: $0) }
    }

    private func initialValue(days: Int) -> Int {
        history?.initialValue(days: days)
            ?? HomeCheckInCountUp.value(days: days, progress: 0)
    }

    var body: some View {
        VStack(alignment: centered ? .center : .leading, spacing: 12) {
            VStack(alignment: centered ? .center : .leading, spacing: 12) {
                if let days {
                    dotNumber(
                        reduceMotion || revealedCount == countContext
                            ? days : initialValue(days: days),
                        totalDays: days)
                } else {
                    ProgressView().frame(width: 50, height: 88)
                }
                Text(days == 1 ? L10n.string("Day checked in") : L10n.string("Days checked in"))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                days == 1 ? L10n.string("Day checked in") : L10n.string("Days checked in")
            )
            .accessibilityValue(
                days.map { $0.formatted(.number.locale(L10n.locale)) } ?? L10n.string("Loading")
            )
            .accessibilityIdentifier("home.checkInCount")

            if let error = settings?.checkInError ?? settings?.profileError {
                Text(error).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                Button(L10n.string("Try again")) {
                    if settings?.profileError != nil { settings?.reload() }
                    settings?.recordCheckIn()
                }
                .font(.caption.weight(.medium)).frame(minHeight: 44)
                .buttonStyle(.kualiaHaptic)
            }
        }
        .task(
            id: AnimationContext(
                count: countContext, isActive: isActive, reduceMotion: reduceMotion)
        ) {
            guard isActive, let days else { return }
            let context = countContext
            let history = history
            guard !reduceMotion, initialValue(days: days) < days,
                revealedCount != context
            else {
                history?.recordDisplayed(days: days)
                revealedCount = context
                return
            }
            do {
                try await Task.sleep(for: .seconds(1))
                try Task.checkCancellation()
                history?.recordDisplayed(days: days)
                revealedCount = context
                successTrigger.toggle()
            } catch {
                // An interrupted reveal has not displayed the new total yet.
            }
        }
        .sensoryFeedback(.success, trigger: successTrigger)
    }

    private struct CountContext: Equatable {
        let userID: String?
        let days: Int?
    }

    private struct AnimationContext: Equatable {
        let count: CountContext
        let isActive: Bool
        let reduceMotion: Bool
    }

    private func dotNumber(_ days: Int, totalDays: Int) -> some View {
        let number = HomeCheckInDigits(days: days, reservingDays: totalDays)
        return Canvas { context, size in
            let pitch = min(size.width / CGFloat(number.columns), size.height / 7)
            let diameter = pitch * 0.72
            for row in 0..<7 {
                for column in 0..<number.columns {
                    let lit = number.isLit(row: row, column: column)
                    let ink: Color = colorScheme == .dark ? .white : .black
                    let color = lit ? ink : ink.opacity(contrast == .increased ? 0.18 : 0.07)
                    let rect = CGRect(
                        x: CGFloat(column) * pitch,
                        y: CGFloat(row) * pitch,
                        width: diameter, height: diameter)
                    context.fill(Path(ellipseIn: rect), with: .color(color))
                }
            }
        }
        .frame(maxWidth: number.preferredWidth, alignment: .leading)
        .frame(height: number.preferredHeight)
        .accessibilityHidden(true)
    }
}
