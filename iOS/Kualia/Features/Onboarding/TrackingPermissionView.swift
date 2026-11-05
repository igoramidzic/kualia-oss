import SwiftUI

/// A neutral pre-alert: Apple's dialog owns the Allow / Ask App Not to Track choice.
struct TrackingPermissionView: View {
    @Bindable var tracking: AdTrackingStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                KualiaIconImage(icon: .shield, size: 40)
                    .foregroundStyle(KualiaPalette.ink)
                    .accessibilityHidden(true)
                Text(L10n.string("A choice about ad measurement"))
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .accessibilityAddTraits(.isHeader)
                Text(
                    L10n.string(
                        "With your permission, AppsFlyer and our ad partners can use your device’s advertising identifier to understand which ads led to installs and signups."
                    ))
                Text(
                    L10n.string(
                        "Your budgets, transactions, balances, bank details, and chat content are never sent for ad measurement."
                    ))
                Text(
                    L10n.string(
                        "You can say no and use Kualia normally. AppsFlyer can still count limited, anonymized installs and milestones, and Apple can provide aggregate attribution."
                    ))
                Text(
                    L10n.string(
                        "Continue opens Apple's tracking permission dialog, where you can choose.")
                )
                .foregroundStyle(KualiaPalette.mutedInk)
            }
            .font(.body)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 520, alignment: .leading)
            .padding(25)
            .frame(maxWidth: .infinity)
        }
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
            Button {
                Task { await tracking.requestPermission() }
            } label: {
                HStack(spacing: 10) {
                    if tracking.isRequesting { ProgressView().tint(KualiaPalette.canvas) }
                    Text(L10n.string("Continue"))
                }
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 56)
                .foregroundStyle(KualiaPalette.canvas)
                .background(KualiaPalette.ink, in: Capsule())
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(tracking.isRequesting || scenePhase != .active)
            .accessibilityIdentifier("onboarding.tracking.continue")
            .frame(maxWidth: 520)
            .padding(.horizontal, 25)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
        }
        .background(KualiaPalette.canvas)
        .accessibilityIdentifier("onboarding.tracking")
    }
}
