import Combine
import Foundation
import Testing

@testable import Kualia

@MainActor
struct HomeDashboardStoreTests {
    @Test func resumingWaitsForFreshBriefingEvenWhenBanksArriveFirst() async throws {
        let briefings = PassthroughSubject<HomeBriefing, Error>()
        let banks = PassthroughSubject<[HomeBankConnection], Error>()
        let store = HomeDashboardStore(
            workspaceID: "personal",
            connections: { _ in banks.eraseToAnyPublisher() },
            subscribe: { _, _ in briefings.eraseToAnyPublisher() })
        defer { store.reset() }
        store.start()
        briefings.send(try HomeBriefingTests.snapshot(reviews: 4))
        banks.send([])
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.snapshot?.reviews.count == 4)

        // Calling start on an already-live page must not reload its content.
        store.start()
        #expect(store.snapshot?.reviews.count == 4)
        store.stop()
        store.start()
        #expect(store.snapshot == nil)
        #expect(!store.connectionsHaveLoaded)
        banks.send([])
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.connectionsHaveLoaded)
        #expect(store.snapshot == nil)
        briefings.send(try HomeBriefingTests.snapshot(reviews: 1))
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.snapshot?.reviews.count == 1)
    }

    @Test func persistsDismissalsPerUserAndWorkspace() throws {
        let suite = "home-inbox-tests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        func make(_ workspace: String = "personal") -> HomeDashboardStore {
            HomeDashboardStore(workspaceID: workspace) { _, _ in
                Empty<HomeBriefing, Error>().eraseToAnyPublisher()
            }
        }
        let notices = HomeDashboardScenario.needsAttention.notices
        let first = make()
        first.configureDismissals(userID: "igor", defaults: defaults)
        var inbox = first.inbox
        inbox.reconcile(notices: notices, day: "2026-09-06")
        for notice in notices { inbox.dismiss(notice) }
        first.updateInbox(inbox)
        first.reset()
        let reopened = make()
        reopened.configureDismissals(userID: "igor", defaults: defaults)
        #expect(reopened.inbox.visible(in: notices).isEmpty)
        let anotherUser = make()
        anotherUser.configureDismissals(userID: "someone-else", defaults: defaults)
        #expect(anotherUser.inbox.visible(in: notices).count == 3)
        let anotherWorkspace = make("shared")
        anotherWorkspace.configureDismissals(userID: "igor", defaults: defaults)
        #expect(anotherWorkspace.inbox.visible(in: notices).count == 3)
    }

    @Test func connectionFailuresRemainExplicitAndRetryWaitsForNewData() async throws {
        let subjects = (0..<2).map { _ in PassthroughSubject<[HomeBankConnection], Error>() }
        var calls: [String] = []
        let store = HomeDashboardStore(
            workspaceID: "personal",
            connections: { id in
                calls.append(id)
                return subjects[calls.count - 1].eraseToAnyPublisher()
            },
            subscribe: { _, _ in Empty<HomeBriefing, Error>().eraseToAnyPublisher() })
        store.start()
        #expect(!store.connectionsHaveLoaded)
        subjects[0].send([])
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.connectionsHaveLoaded)
        subjects[0].send(completion: .failure(URLError(.notConnectedToInternet)))
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.connectionsError != nil)
        store.retry()
        #expect(!store.connectionsHaveLoaded)
        #expect(calls == ["personal", "personal"])
        subjects[1].send([])
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.connectionsHaveLoaded)
        #expect(store.connectionsError == nil)
        store.reset()
        subjects[1].send([])
        try await Task.sleep(for: .milliseconds(30))
        #expect(!store.connectionsHaveLoaded)
        #expect(store.connections.isEmpty)
    }

    @Test func subscribesToExplicitWorkspaceAndReceivesLiveUpdates() async throws {
        let subject = PassthroughSubject<HomeBriefing, Error>()
        var ids: [String] = []
        let store = HomeDashboardStore(workspaceID: "personal") { id, _ in
            ids.append(id)
            return subject.eraseToAnyPublisher()
        }
        store.start()
        subject.send(try HomeBriefingTests.snapshot(reviews: 4))
        try await Task.sleep(for: .milliseconds(30))
        #expect(ids == ["personal"])
        #expect(store.snapshot?.reviews.count == 4)
        subject.send(try HomeBriefingTests.snapshot())
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.snapshot?.notices.isEmpty == true)
        store.reset()
        #expect(store.snapshot == nil)
    }
    @Test func rejectsForeignWorkspaceAndIgnoresCancelledDeliveries() async throws {
        let subject = PassthroughSubject<HomeBriefing, Error>()
        let store = HomeDashboardStore(workspaceID: "personal") { _, _ in
            subject.eraseToAnyPublisher()
        }
        store.start()
        subject.send(try HomeBriefingTests.snapshot(workspace: "foreign"))
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.snapshot == nil)
        #expect(store.errorMessage != nil)
        subject.send(try HomeBriefingTests.snapshot())
        store.reset()
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.snapshot == nil)
    }
    @Test func refreshesOnlyAtWorkspaceDateRollover() async throws {
        let subject = PassthroughSubject<HomeBriefing, Error>()
        var keys: [String] = []
        let store = HomeDashboardStore(workspaceID: "personal") { _, key in
            keys.append(key)
            return subject.eraseToAnyPublisher()
        }
        store.start()
        subject.send(try HomeBriefingTests.snapshot())
        try await Task.sleep(for: .milliseconds(30))
        let dates = ISO8601DateFormatter()
        store.refreshIfNeeded(now: try #require(dates.date(from: "2026-09-06T02:00:00Z")))
        #expect(keys.count == 1)
        store.refreshIfNeeded(now: try #require(dates.date(from: "2026-09-06T04:01:00Z")))
        #expect(keys.count == 2)
        #expect(keys[0] != keys[1])
        #expect(store.snapshot == nil)
        store.reset()
    }
}
