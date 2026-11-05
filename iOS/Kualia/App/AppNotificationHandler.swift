import OSLog
import Observation
import UserNotifications

/// Delivered alerts are acknowledged separately from outstanding in-app issues.
@MainActor
@Observable
final class AppNotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    nonisolated struct TransactionRequest: Equatable {
        let id = UUID()
        let workspaceID: String?
    }

    var pendingTransactionRequest: TransactionRequest?
    private let setBadgeCount: (Int) -> Void
    private let removeDeliveredNotifications: () -> Void
    @ObservationIgnored private var badgeCount: Int?
    @ObservationIgnored private var badgesEnabled = true

    init(setBadgeCount: @escaping (Int) -> Void, removeDeliveredNotifications: @escaping () -> Void)
    {
        self.setBadgeCount = setBadgeCount
        self.removeDeliveredNotifications = removeDeliveredNotifications
        super.init()
    }

    convenience init(center: UNUserNotificationCenter = .current()) {
        self.init(
            setBadgeCount: { count in
                center.setBadgeCount(count) { @Sendable error in
                    if let error {
                        Logger(subsystem: "com.kualia", category: "Notifications").error(
                            "Couldn't update the app badge: \(error.localizedDescription, privacy: .public)"
                        )
                    }
                }
            },
            removeDeliveredNotifications: { center.removeAllDeliveredNotifications() })
    }

    func updateBadgeCount(_ count: Int) {
        let count = max(0, count)
        guard badgeCount != count else { return }
        badgeCount = count
        setBadgeCount(badgesEnabled ? count : 0)
    }

    func setBadgesEnabled(_ enabled: Bool) {
        guard badgesEnabled != enabled else { return }
        badgesEnabled = enabled
        if let badgeCount { setBadgeCount(enabled ? badgeCount : 0) }
    }

    /// Opening the app does not resolve its budget or transaction issues. Before
    /// live counts load, leave the last background-push badge untouched.
    func clearDeliveredNotifications() {
        removeDeliveredNotifications()
        if let badgeCount { setBadgeCount(badgesEnabled ? badgeCount : 0) }
    }

    func reset() {
        pendingTransactionRequest = nil
        badgeCount = nil
        removeDeliveredNotifications()
        setBadgeCount(0)
    }

    func presentForegroundNotification() -> UNNotificationPresentationOptions {
        clearDeliveredNotifications()
        // Show the alert without applying its APNs badge or keeping an already-seen list entry.
        return [.banner, .sound]
    }

    func handleResponse(actionIdentifier: String, type: String?, workspaceID: String?) {
        guard actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        // A tap can open an already-active scene without a scene-phase change.
        clearDeliveredNotifications()
        guard type == "transactions" else { return }
        pendingTransactionRequest = TransactionRequest(workspaceID: workspaceID)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        presentForegroundNotification(completionHandler: completionHandler)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        // Read the system objects on the callback queue; only send value types to MainActor.
        let content = response.notification.request.content
        handleResponse(
            actionIdentifier: response.actionIdentifier,
            type: content.userInfo["type"] as? String,
            workspaceID: content.userInfo["workspaceId"] as? String,
            completionHandler: completionHandler)
    }

    nonisolated func presentForegroundNotification(
        completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        Task { @MainActor in
            completionHandler(presentForegroundNotification())
        }
    }

    nonisolated func handleResponse(
        actionIdentifier: String, type: String?, workspaceID: String?,
        completionHandler: @escaping @Sendable () -> Void
    ) {
        // SwiftUI's notification-open completion can touch UIKit. Keep it on MainActor
        // along with navigation instead of using the async delegate's implicit completion.
        Task { @MainActor in
            handleResponse(
                actionIdentifier: actionIdentifier, type: type, workspaceID: workspaceID)
            completionHandler()
        }
    }
}
