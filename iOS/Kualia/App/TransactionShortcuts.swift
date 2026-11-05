import AppIntents
import UIKit

struct KualiaAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTransactionIntent(),
            phrases: ["Add a transaction in \(.applicationName)"],
            shortTitle: "Add Transaction", systemImageName: "plus.circle")
        AppShortcut(
            intent: OpenTransactionsIntent(),
            phrases: ["Open transactions in \(.applicationName)"],
            shortTitle: "Open Transactions", systemImageName: "list.bullet.rectangle")
    }
}

@MainActor
enum HomeScreenQuickAction {
    static let addTransactionType = "com.kualia.app.new-transaction"

    static func refresh() {
        UIApplication.shared.shortcutItems = [
            UIApplicationShortcutItem(
                type: addTransactionType, localizedTitle: L10n.string("Add Transaction"),
                localizedSubtitle: nil, icon: UIApplicationShortcutIcon(type: .add))
        ]
    }

    @discardableResult
    static func handle(
        _ item: UIApplicationShortcutItem,
        defaults: UserDefaults? = UserDefaults(suiteName: PendingAppActionStore.appGroupSuiteName)
    ) -> Bool {
        guard item.type == addTransactionType else { return false }
        PendingAppActionStore.enqueueNewTransaction(draft: nil, defaults: defaults)
        return true
    }
}

@MainActor
final class TransactionShortcutSceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(
        _ scene: UIScene, willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        if let item = connectionOptions.shortcutItem { HomeScreenQuickAction.handle(item) }
    }

    func windowScene(
        _ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem
    ) async -> Bool {
        HomeScreenQuickAction.handle(shortcutItem)
    }
}
