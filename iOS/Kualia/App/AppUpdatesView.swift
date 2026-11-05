import SwiftUI

struct AppStatusBlockingView: View {
    let blocker: AppStatusBlocker
    let currentVersion: String
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize = 42

    private var isMaintenance: Bool {
        if case .maintenance = blocker { return true }
        return false
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    wordmark
                    Spacer(minLength: 44)
                    statusIcon
                        .padding(.bottom, 32)

                    VStack(alignment: .leading, spacing: 16) {
                        Text(
                            isMaintenance
                                ? L10n.string("Maintenance\nmode") : L10n.string("Update\nrequired")
                        )
                        .font(.system(size: titleSize, weight: .bold, design: .rounded))
                        .tracking(-1.6)
                        .lineSpacing(-2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        Text(blocker.message)
                            .font(.body)
                            .lineSpacing(4)
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 32)
                    nextStep
                }
                .padding(.horizontal, 28)
                .padding(.top, 24)
                .padding(.bottom, 24)
                .frame(maxWidth: 520, minHeight: geometry.size.height, alignment: .top)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .foregroundStyle(KualiaPalette.ink)
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .accessibilityIdentifier("app.statusBlocker")
    }

    private var wordmark: some View {
        HStack(spacing: 8) {
            Image("KualiaMark")
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)
            Text("Kualia")
                .font(.system(.title3, design: .rounded, weight: .bold))
        }
        .fixedSize()
    }

    private var statusIcon: some View {
        KualiaIconImage(icon: isMaintenance ? .maintenance : .download, size: 64)
            .foregroundStyle(isMaintenance ? KualiaPalette.budgetUnderfunded : KualiaPalette.ink)
            .padding(28)
            .background(
                (isMaintenance ? KualiaPalette.budgetUnderfunded : KualiaPalette.accountsGlow)
                    .opacity(0.12),
                in: RoundedRectangle(cornerRadius: 32)
            )
            .accessibilityHidden(true)
    }

    @ViewBuilder private var nextStep: some View {
        switch blocker {
        case .maintenance:
            HStack(alignment: .top, spacing: 12) {
                KualiaIconImage(icon: .clock, size: 20)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 5) {
                    Text(L10n.string("We'll take it from here."))
                        .font(.subheadline.weight(.semibold))
                    Text(L10n.string("Kualia will reopen automatically when maintenance ends."))
                        .font(.footnote)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
        case .updateRequired(_, let minimumVersion):
            VStack(spacing: 14) {
                Button {
                    openURL(AppEnvironment.appStoreURL)
                } label: {
                    HStack(spacing: 16) {
                        Text(L10n.string("Update Kualia"))
                            .font(.system(.headline, design: .rounded))
                        Spacer(minLength: 8)
                        KualiaIconImage(icon: .arrowUpRight, size: 20)
                            .padding(9)
                            .background(KualiaPalette.canvas.opacity(0.12), in: Circle())
                    }
                    .padding(.leading, 24)
                    .padding(.trailing, 12)
                    .padding(.vertical, 12)
                    .frame(minHeight: 62)
                    .foregroundStyle(KualiaPalette.canvas)
                    .background(KualiaPalette.ink, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityHint(L10n.string("Opens Kualia in the App Store"))
                .accessibilityIdentifier("app.updateRequired.update")

                Text(
                    L10n.string(
                        "You're on \(currentVersion). Version \(minimumVersion) or later is required."
                    )
                )
                .font(.caption)
                .foregroundStyle(KualiaPalette.mutedInk)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct AppChangelogModifier: ViewModifier {
    var store: AppUpdatesStore?
    let isAvailable: Bool
    @State private var presentationAnchor = UIView(frame: .zero)

    private struct Request: Equatable {
        let changelog: AppChangelog?
        let sessionID: String?
        let isAvailable: Bool
    }

    func body(content: Content) -> some View {
        content
            .background {
                AppPresentationAnchor(view: presentationAnchor).frame(width: 0, height: 0)
            }
            .task(
                id: Request(
                    changelog: store?.unreadChangelog, sessionID: store?.sessionID,
                    isAvailable: isAvailable)
            ) {
                guard isAvailable else { return }
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                while !Task.isCancelled, let store, store.unreadChangelog != nil,
                    store.presentedChangelog == nil
                {
                    await store.prepareChangelog(canPresent: canPresent)
                    // Nested sheets may close without changing Home's navigation state.
                    // Retry optional link loading too, while this presentation stays eligible.
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                }
            }
            .sheet(
                item: Binding(
                    get: { store?.presentedChangelog },
                    set: { store?.presentedChangelog = $0 })
            ) { presentation in
                SettingsBrowser(url: presentation.url)
                    .ignoresSafeArea()
                    .onAppear { store?.markChangelogViewed(presentation) }
            }
    }

    private func canPresent() -> Bool {
        guard let window = presentationAnchor.window, window.isKeyWindow else { return false }
        return window.rootViewController?.presentedViewController == nil
    }
}
