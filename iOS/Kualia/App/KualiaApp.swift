import AppIntents
import ClerkKit
import ConvexMobile
import SwiftUI
import WidgetKit

@main
struct KualiaApp: App {
    @UIApplicationDelegateAdaptor(SettingsAppDelegate.self) private var appDelegate
    @AppStorage(SettingsAppearance.defaultsKey) private var appearance = SettingsAppearance.system
        .rawValue
    @Environment(\.scenePhase) private var scenePhase
    #if DEBUG
        @AppStorage(ScreenshotDemoMode.defaultsKey) private var screenshotDemo = false
    #endif
    private let language = AppLanguageStore.shared
    private let convexClient: ConvexClientWithAuth<String>
    private let authProvider: KualiaClerkAuthProvider

    init() {
        Clerk.configure(publishableKey: AppEnvironment.current.clerkPublishableKey)
        authProvider = KualiaClerkAuthProvider()
        convexClient = ConvexClientWithAuth(
            deploymentUrl: AppEnvironment.current.convexDeploymentURL,
            authProvider: authProvider
        )
        authProvider.bind(client: convexClient)
        KualiaAppShortcuts.updateAppShortcutParameters()
        HomeScreenQuickAction.refresh()
    }

    @ViewBuilder private var appContent: some View {
        #if DEBUG
            if screenshotDemo {
                ScreenshotDemoView()
            } else {
                AppRootView(convexClient: convexClient, authProvider: authProvider)
            }
        #else
            AppRootView(convexClient: convexClient, authProvider: authProvider)
        #endif
    }

    var body: some Scene {
        WindowGroup {
            appContent
                .toggleStyle(SwitchToggleStyle(tint: KualiaPalette.toggleOn))
                .environment(Clerk.shared)
                .environment(\.locale, language.locale)
                .environment(
                    \.layoutDirection, language.isRightToLeft ? .rightToLeft : .leftToRight
                )
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active {
                        AdTrackingStore.shared.refresh()
                        SettingsNotifications.shared.handler.clearDeliveredNotifications()
                        language.refreshDevicePreferences()
                        HomeScreenQuickAction.refresh()
                    } else if phase == .background {
                        AdTrackingStore.shared.didEnterBackground()
                    }
                }
                .onChange(of: language.locale, initial: true) { _, locale in
                    HomeScreenQuickAction.refresh()
                    if WidgetSharedStorage.localeIdentifier != locale.identifier {
                        WidgetSharedStorage.localeIdentifier = locale.identifier
                        WidgetCenter.shared.reloadAllTimelines()
                    }
                }
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: NSLocale.currentLocaleDidChangeNotification)
                ) { _ in
                    language.refreshDevicePreferences()
                }
                .onOpenURL { url in
                    Task { try? await Clerk.shared.handle(url) }
                }
                .background {
                    AppAppearanceBridge(appearance: SettingsAppearance.resolve(appearance))
                        .frame(width: 0, height: 0)
                }
        }
    }
}

/// Apply the override at the window so sheets inherit changes, including returning to System.
struct AppAppearanceBridge: UIViewRepresentable {
    let appearance: SettingsAppearance

    func makeUIView(context: Context) -> AppearanceView {
        AppearanceView(style: appearance.interfaceStyle)
    }

    func updateUIView(_ view: AppearanceView, context: Context) {
        view.style = appearance.interfaceStyle
        view.applyAppearance()
    }

    final class AppearanceView: UIView {
        var style: UIUserInterfaceStyle

        init(style: UIUserInterfaceStyle) {
            self.style = style
            super.init(frame: .zero)
            isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { nil }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            applyAppearance()
        }

        func applyAppearance() {
            guard let window, window.overrideUserInterfaceStyle != style else { return }
            window.overrideUserInterfaceStyle = style
        }
    }
}
