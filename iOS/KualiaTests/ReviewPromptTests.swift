import Foundation
import Testing

@testable import Kualia

@MainActor
struct ReviewPromptTests {
    @MainActor private final class Clock {
        var date = Date(timeIntervalSince1970: 1_800_000_000)
        func advance(_ interval: TimeInterval = ReviewPromptStore.delay) {
            date = date.addingTimeInterval(interval)
        }
    }

    private func withStore(
        _ test: (ReviewPromptStore, Clock, UserDefaults) throws -> Void
    ) rethrows {
        let suite = "ReviewPromptTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let clock = Clock()
        let store = ReviewPromptStore(defaults: defaults, now: { clock.date })
        store.configure(userID: "user-a")
        try test(store, clock, defaults)
    }

    @Test func waitsAFullDayAndRequiresHomeCompletionForFirstMessage() {
        withStore { store, clock, _ in
            #expect(store.action(for: .homeCompleted) == nil)
            clock.advance(ReviewPromptStore.delay - 1)
            #expect(store.action(for: .homeCompleted) == nil)
            clock.advance(1)
            #expect(store.action(for: .transactionAdded(clock.date)) == nil)
            #expect(store.action(for: .homeCompleted) == .founderMessage)
        }
    }

    @Test func firstUseSurvivesRelaunchAndRepeatedSessions() {
        withStore { store, clock, defaults in
            clock.advance()
            store.configure(userID: "user-a")
            let restored = ReviewPromptStore(defaults: defaults, now: { clock.date })
            restored.configure(userID: "user-a")
            #expect(restored.action(for: .homeCompleted) == .founderMessage)
        }
    }

    @Test func dismissalStartsAnotherFullDayBeforeNativeFollowUp() {
        withStore { store, clock, _ in
            clock.advance()
            store.recordFounderShown()
            clock.advance(60)
            store.recordFounderDismissed()
            #expect(store.action(for: .homeCompleted) == nil)
            clock.advance(ReviewPromptStore.delay - 1)
            #expect(store.action(for: .homeCompleted) == nil)
            #expect(store.action(for: .transactionAdded(clock.date)) == nil)
            clock.advance(1)
            #expect(store.action(for: .homeCompleted) == .nativeReview)
            #expect(store.action(for: .transactionAdded(clock.date)) == .nativeReview)
        }
    }

    @Test func openingReviewLinkStopsAllFuturePromptsAcrossRelaunches() {
        withStore { store, clock, defaults in
            clock.advance()
            store.recordFounderShown()
            store.recordReviewLinkTapped()
            store.recordFounderDismissed()
            clock.advance(ReviewPromptStore.delay * 400)
            let restored = ReviewPromptStore(defaults: defaults, now: { clock.date })
            restored.configure(userID: "user-a")
            #expect(restored.action(for: .homeCompleted) == nil)
            #expect(restored.action(for: .transactionAdded(clock.date)) == nil)
        }
    }

    @Test func shownMessageNeverRepeatsEvenIfAppClosesBeforeDismissal() {
        withStore { store, clock, defaults in
            clock.advance()
            store.recordFounderShown()
            let restored = ReviewPromptStore(defaults: defaults, now: { clock.date })
            restored.configure(userID: "user-a")
            #expect(restored.action(for: .homeCompleted) == nil)
            clock.advance()
            #expect(restored.action(for: .homeCompleted) == .nativeReview)
        }
    }

    @Test func nativeRequestIsAttemptedOnlyOnceEvenWhenAppleSuppressesIt() {
        withStore { store, clock, defaults in
            clock.advance()
            store.recordFounderShown()
            store.recordFounderDismissed()
            clock.advance()
            #expect(store.action(for: .homeCompleted) == .nativeReview)
            store.recordNativeRequested()
            clock.advance(ReviewPromptStore.delay * 400)
            let restored = ReviewPromptStore(defaults: defaults, now: { clock.date })
            restored.configure(userID: "user-a")
            #expect(restored.action(for: .homeCompleted) == nil)
            #expect(restored.action(for: .transactionAdded(clock.date)) == nil)
        }
    }

    @Test func transactionMustBeFreshAndSavedAfterFollowUpBecomesEligible() {
        withStore { store, clock, _ in
            clock.advance()
            store.recordFounderShown()
            store.recordFounderDismissed()
            clock.advance(ReviewPromptStore.delay - 1)
            let tooEarly = clock.date
            clock.advance(1)
            #expect(store.action(for: .transactionAdded(tooEarly)) == nil)
            let eligible = clock.date
            #expect(store.action(for: .transactionAdded(eligible)) == .nativeReview)
            #expect(store.action(for: .transactionAdded(eligible.addingTimeInterval(1))) == nil)
            clock.advance(121)
            #expect(store.action(for: .transactionAdded(eligible)) == nil)
        }
    }

    @Test func switchingAccountsKeepsIndependentHistoriesAndSignOutClearsEligibility() {
        withStore { store, clock, _ in
            clock.advance()
            store.recordFounderShown()
            store.recordReviewLinkTapped()
            store.reset()
            #expect(store.action(for: .homeCompleted) == nil)
            store.configure(userID: "user-b")
            #expect(store.action(for: .homeCompleted) == nil)
            clock.advance()
            #expect(store.action(for: .homeCompleted) == .founderMessage)
            store.configure(userID: "user-a")
            #expect(store.action(for: .homeCompleted) == nil)
        }
    }

    @Test func repeatedDismissCallbacksDoNotPushBackFollowUp() {
        withStore { store, clock, _ in
            clock.advance()
            store.recordFounderShown()
            store.recordFounderDismissed()
            clock.advance()
            store.recordFounderDismissed()
            #expect(store.action(for: .homeCompleted) == .nativeReview)
        }
    }

    @Test func clockMovingBackwardsDoesNotMakePromptsEligible() {
        withStore { store, clock, _ in
            clock.advance(-ReviewPromptStore.delay)
            #expect(store.action(for: .homeCompleted) == nil)
            clock.advance(ReviewPromptStore.delay * 2)
            store.recordFounderShown()
            store.recordFounderDismissed()
            clock.advance(-1)
            #expect(store.action(for: .homeCompleted) == nil)
        }
    }
}
