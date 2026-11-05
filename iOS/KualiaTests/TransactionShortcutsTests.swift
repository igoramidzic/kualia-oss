import Foundation
import Testing
import UIKit

@testable import Kualia

@MainActor
struct TransactionShortcutsTests {
    @Test func quickActionAcceptsOnlyTheRegisteredTypeAndClearsPrefill() throws {
        let suite = "kualia-quick-action-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        #expect(
            !HomeScreenQuickAction.handle(
                UIApplicationShortcutItem(type: "unknown", localizedTitle: "Unknown"),
                defaults: defaults))
        #expect(PendingAppActionStore.consume(defaults: defaults) == nil)
        PendingAppActionStore.enqueueNewTransaction(
            draft: TransactionShortcutDraft(
                amount: 25, direction: .inflow, payee: "Old", account: nil,
                category: nil, date: nil, notes: nil), defaults: defaults)
        #expect(
            HomeScreenQuickAction.handle(
                UIApplicationShortcutItem(
                    type: HomeScreenQuickAction.addTransactionType, localizedTitle: "Add"),
                defaults: defaults))
        #expect(PendingAppActionStore.consume(defaults: defaults) == .newTransaction(nil))
    }
}
