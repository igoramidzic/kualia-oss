import Testing
import UserNotifications

@testable import Kualia

@MainActor
struct AppNotificationHandlerTests {
    @Test func backgroundTransactionTapCompletesOnMainThreadAfterQueuingNavigation() async {
        let center = NotificationCenterStub(badge: 5, delivered: ["transactions"])
        let handler = center.makeHandler()

        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                handler.handleResponse(
                    actionIdentifier: UNNotificationDefaultActionIdentifier,
                    type: "transactions", workspaceID: "family"
                ) {
                    #expect(Thread.isMainThread)
                    MainActor.assumeIsolated {
                        #expect(handler.pendingTransactionRequest?.workspaceID == "family")
                        #expect(center.delivered.isEmpty)
                        #expect(center.badge == 5)
                    }
                    continuation.resume()
                }
            }
        }
    }

    @Test(arguments: [UNNotificationDismissActionIdentifier, UNNotificationDefaultActionIdentifier])
    func ignoredBackgroundResponseStillCompletesOnMainThread(actionIdentifier: String) async {
        let handler = NotificationCenterStub(badge: 5, delivered: []).makeHandler()

        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                handler.handleResponse(
                    actionIdentifier: actionIdentifier, type: "unknown", workspaceID: "personal"
                ) {
                    #expect(Thread.isMainThread)
                    continuation.resume()
                }
            }
        }

        #expect(handler.pendingTransactionRequest == nil)
    }

    @Test func backgroundForegroundCallbackCompletesOnMainThreadWithoutApplyingPushBadge() async {
        let center = NotificationCenterStub(badge: 5, delivered: ["transactions"])
        let handler = center.makeHandler()
        handler.updateBadgeCount(2)

        let options = await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                handler.presentForegroundNotification { options in
                    #expect(Thread.isMainThread)
                    MainActor.assumeIsolated {
                        #expect(center.delivered.isEmpty)
                        #expect(center.badge == 2)
                    }
                    continuation.resume(returning: options)
                }
            }
        }

        #expect(options == [.banner, .sound])
    }

    @Test func transactionTapWaitsForNavigationAndPreservesItsWorkspace() throws {
        let center = NotificationCenterStub(badge: 5, delivered: ["transactions"])
        let handler = center.makeHandler()
        handler.handleResponse(
            actionIdentifier: UNNotificationDefaultActionIdentifier,
            type: "transactions", workspaceID: "family")

        let request = try #require(handler.pendingTransactionRequest)
        #expect(request.workspaceID == "family")
        #expect(center.badge == 5)
        #expect(center.delivered.isEmpty)

        let navigation = WidgetNavigationStore()
        navigation.openTransactionNotification(workspaceID: request.workspaceID)
        let destination = try #require(navigation.pending)
        #expect(destination.route == .filteredTransactions(.needsReview))
        #expect(
            destination.resolveWorkspace(
                currentID: "personal", accessibleIDs: ["personal", "family"])
                == .switchWorkspace("family"))
        #expect(navigation.pending?.id == destination.id)
        #expect(
            destination.resolveWorkspace(
                currentID: "family", accessibleIDs: ["personal", "family"])
                == .ready)
    }

    @Test func transactionTapWithoutWorkspaceUsesTheCurrentWorkspace() throws {
        let handler = NotificationCenterStub(badge: 1, delivered: []).makeHandler()
        handler.handleResponse(
            actionIdentifier: UNNotificationDefaultActionIdentifier,
            type: "transactions", workspaceID: nil)
        let request = try #require(handler.pendingTransactionRequest)
        let navigation = WidgetNavigationStore()
        navigation.openTransactionNotification(workspaceID: request.workspaceID)

        #expect(navigation.pending?.route == .filteredTransactions(.needsReview))
        #expect(
            navigation.pending?.resolveWorkspace(currentID: "personal", accessibleIDs: ["personal"])
                == .ready)
    }

    @Test func removedOrInaccessibleWorkspaceNeverRoutesToAnotherFeed() throws {
        let navigation = WidgetNavigationStore()
        navigation.openTransactionNotification(workspaceID: "removed")
        let request = try #require(navigation.pending)
        #expect(
            request.resolveWorkspace(currentID: "personal", accessibleIDs: ["personal"])
                == .unavailable)
    }

    @Test func repeatedTapsRequestNavigationAgainEvenForTheSameWorkspace() throws {
        let handler = NotificationCenterStub(badge: 0, delivered: []).makeHandler()
        handler.handleResponse(
            actionIdentifier: UNNotificationDefaultActionIdentifier,
            type: "transactions", workspaceID: "personal")
        let first = try #require(handler.pendingTransactionRequest)
        handler.handleResponse(
            actionIdentifier: UNNotificationDefaultActionIdentifier,
            type: "transactions", workspaceID: "personal")
        #expect(handler.pendingTransactionRequest?.id != first.id)
    }

    @Test func dismissingAnAlertDoesNotNavigateOrClearOtherAlerts() {
        let center = NotificationCenterStub(badge: 5, delivered: ["another-alert"])
        let handler = center.makeHandler()
        handler.handleResponse(
            actionIdentifier: UNNotificationDismissActionIdentifier,
            type: "transactions", workspaceID: "personal")
        #expect(handler.pendingTransactionRequest == nil)
        #expect(center.badge == 5)
        #expect(center.delivered == ["another-alert"])
    }

    @Test(arguments: ["bankLink", "scheduled:rent", "unknown", nil] as [String?])
    func otherNotificationTypesDoNotOpenTransactionReview(_ type: String?) {
        let handler = NotificationCenterStub(badge: 5, delivered: []).makeHandler()
        handler.handleResponse(
            actionIdentifier: UNNotificationDefaultActionIdentifier,
            type: type, workspaceID: "personal")
        #expect(handler.pendingTransactionRequest == nil)
    }

    @Test func openingTheAppPreservesPushBadgeUntilLiveIssueCountsLoad() {
        let center = NotificationCenterStub(badge: 5, delivered: ["transactions", "reminder"])
        let handler = center.makeHandler()

        handler.clearDeliveredNotifications()

        #expect(center.badge == 5)
        #expect(center.delivered.isEmpty)
        #expect(center.pending == ["tomorrow-reminder"])
        handler.updateBadgeCount(2)
        #expect(center.badge == 2)
    }

    @Test func returningToTheAppRestoresKnownIssuesInsteadOfClearingTheBadge() {
        let center = NotificationCenterStub(badge: 5, delivered: ["old-transactions"])
        let handler = center.makeHandler()
        handler.updateBadgeCount(2)
        handler.clearDeliveredNotifications()
        center.badge = 3
        center.delivered = ["new-transactions"]

        handler.clearDeliveredNotifications()

        #expect(center.badge == 2)
        #expect(center.delivered.isEmpty)
        #expect(center.pending == ["tomorrow-reminder"])
    }

    @Test func foregroundPushShowsAnAlertWithoutRestoringItsPayloadBadge() {
        let center = NotificationCenterStub(badge: 5, delivered: ["old-transactions"])
        let handler = center.makeHandler()

        handler.updateBadgeCount(2)
        let options = handler.presentForegroundNotification()

        #expect(options.contains(.banner))
        #expect(options.contains(.sound))
        #expect(!options.contains(.badge))
        #expect(!options.contains(.list))
        #expect(center.badge == 2)
        #expect(center.delivered.isEmpty)
    }

    @Test func resolvedIssuesClearTheIconAndSignOutClearsCachedCounts() {
        let center = NotificationCenterStub(badge: 0, delivered: ["transactions"])
        let handler = center.makeHandler()
        handler.updateBadgeCount(4)
        #expect(center.badge == 4)
        handler.updateBadgeCount(0)
        #expect(center.badge == 0)
        handler.updateBadgeCount(3)
        handler.reset()
        #expect(center.badge == 0)
        #expect(center.delivered.isEmpty)
        handler.clearDeliveredNotifications()
        #expect(center.badge == 0)
    }

    @Test func disablingBadgesClearsTheIconAndReenablingUsesLatestCount() {
        let center = NotificationCenterStub(badge: 0, delivered: [])
        let handler = center.makeHandler()
        handler.updateBadgeCount(4)
        handler.setBadgesEnabled(false)
        #expect(center.badge == 0)
        handler.updateBadgeCount(2)
        handler.clearDeliveredNotifications()
        #expect(center.badge == 0)
        handler.setBadgesEnabled(true)
        #expect(center.badge == 2)
    }

    @Test func clearingAnEmptyNotificationCenterIsSafeToRepeat() {
        let center = NotificationCenterStub(badge: 0, delivered: [])
        let handler = center.makeHandler()

        handler.clearDeliveredNotifications()
        handler.clearDeliveredNotifications()

        #expect(center.badge == 0)
        #expect(center.delivered.isEmpty)
        #expect(center.pending == ["tomorrow-reminder"])
    }
}

@MainActor
private final class NotificationCenterStub {
    var badge: Int
    var delivered: [String]
    var pending = ["tomorrow-reminder"]

    init(badge: Int, delivered: [String]) {
        self.badge = badge
        self.delivered = delivered
    }

    func makeHandler() -> AppNotificationHandler {
        AppNotificationHandler(
            setBadgeCount: { self.badge = $0 },
            removeDeliveredNotifications: { self.delivered.removeAll() })
    }
}
