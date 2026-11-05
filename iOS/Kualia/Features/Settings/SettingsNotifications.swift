import Observation
import UIKit
import UserNotifications

@MainActor
@Observable
final class SettingsNotifications {
    static let shared = SettingsNotifications()
    let handler = AppNotificationHandler()
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var isRequestingPermission = false
    var registrationError: String?
    var onDeviceToken: ((String) -> Void)?

    @ObservationIgnored private let center = UNUserNotificationCenter.current()
    @ObservationIgnored private var profile: SettingsProfile?
    @ObservationIgnored private var reconciliation: Task<Void, Never>?
    private static let reminderIDs = (0..<8).map { "kualia.settings.reminder.\($0)" }

    var isAuthorized: Bool {
        authorization == .authorized || authorization == .provisional || authorization == .ephemeral
    }
    var statusLabel: String {
        switch authorization {
        case .authorized, .ephemeral: L10n.string("Allowed on this device")
        case .provisional: L10n.string("Delivered quietly")
        case .denied: L10n.string("Blocked in iOS Settings")
        case .notDetermined: L10n.string("Not enabled on this device")
        @unknown default: L10n.string("Check iOS Settings")
        }
    }

    func requestPermission() async -> Bool {
        guard !isRequestingPermission else { return false }
        isRequestingPermission = true
        defer { isRequestingPermission = false }
        registrationError = nil
        do {
            authorization = await center.notificationSettings().authorizationStatus
            if authorization == .notDetermined {
                _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                authorization = await center.notificationSettings().authorizationStatus
            }
            if isAuthorized { UIApplication.shared.registerForRemoteNotifications() }
            return isAuthorized
        } catch {
            registrationError = L10n.string(
                "Couldn't request notification permission. Please try again.")
            return false
        }
    }

    func refresh() { apply(profile: profile, force: true) }

    func apply(profile: SettingsProfile?, force: Bool = false) {
        guard force || self.profile != profile else { return }
        self.profile = profile
        let previous = reconciliation
        previous?.cancel()
        reconciliation = Task {
            // Serialize scheduling so a canceled task cannot leave reminders behind after logout.
            await previous?.value
            guard !Task.isCancelled else { return }
            let deviceSettings = await center.notificationSettings()
            authorization = deviceSettings.authorizationStatus
            guard !Task.isCancelled else { return }
            handler.setBadgesEnabled(
                profile?.notificationsEnabled != false && deviceSettings.badgeSetting == .enabled)
            center.removePendingNotificationRequests(withIdentifiers: Self.reminderIDs)
            guard let profile, profile.notificationsEnabled, isAuthorized else { return }
            UIApplication.shared.registerForRemoteNotifications()
            let preferences = profile.notificationPreferences ?? .init()
            guard preferences.remindersEnabled else { return }
            for (index, hour) in preferences.frequency.hours.enumerated() {
                guard !Task.isCancelled else {
                    center.removePendingNotificationRequests(withIdentifiers: Self.reminderIDs)
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = L10n.string("A moment for your money")
                content.body = L10n.string(
                    "Check in with your budget and give your latest transactions a home.")
                content.sound = .default
                let trigger = UNCalendarNotificationTrigger(
                    dateMatching: DateComponents(hour: hour, minute: 0), repeats: true)
                do {
                    try await center.add(
                        .init(
                            identifier: Self.reminderIDs[index], content: content, trigger: trigger)
                    )
                } catch {
                    registrationError =
                        L10n.string(
                            "Couldn't schedule budget reminders. Try enabling reminders again.")
                }
            }
            if Task.isCancelled {
                center.removePendingNotificationRequests(withIdentifiers: Self.reminderIDs)
            }
        }
    }

    func reset() {
        profile = nil
        onDeviceToken = nil
        registrationError = nil
        reconciliation?.cancel()
        center.removePendingNotificationRequests(withIdentifiers: Self.reminderIDs)
        handler.reset()
        UIApplication.shared.unregisterForRemoteNotifications()
    }
}

final class SettingsAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        AdTrackingStore.initializeSDK()
        UNUserNotificationCenter.current().delegate = SettingsNotifications.shared.handler
        return true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(
            name: nil, sessionRole: connectingSceneSession.role)
        if connectingSceneSession.role == .windowApplication {
            configuration.delegateClass = TransactionShortcutSceneDelegate.self
        }
        return configuration
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        SettingsNotifications.shared.onDeviceToken?(token)
    }

    func application(
        _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        SettingsNotifications.shared.registrationError =
            L10n.string(
                "This device couldn't register for bank alerts. Check your connection and try again."
            )
    }
}
