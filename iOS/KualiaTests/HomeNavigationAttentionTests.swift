import Combine
import Foundation
import Testing

@testable import Kualia

@Suite(.serialized)
@MainActor
struct HomeNavigationAttentionTests {
    private func workspace(_ id: String = "personal") -> HomeWorkspaceAttention {
        .init(workspaceId: id, currentMonth: 202609, timezone: "UTC")
    }

    @Test func issueCountsTrackConditionsAndClearAsTheyResolve() {
        var value = workspace()
        value.hasOverspending = true
        value.hasOverassignment = true
        value.hasMissingCategory = true
        value.hasMissingPayee = true
        value.hasNewTransactions = true
        #expect(value.budget?.count == 2)
        #expect(value.transactions?.count == 2)
        #expect(value.status?.count == 4)
        value.hasMissingCategory = false
        #expect(value.transactions?.count == 1)
        #expect(value.status?.count == 3)
        value.hasMissingPayee = false
        #expect(value.transactions?.level == .newActivity)
        #expect(value.status?.count == 2)
        value.hasOverspending = false
        value.hasOverassignment = false
        #expect(value.status?.level == .newActivity)
        #expect(value.status?.count == 1)
        value.hasNewTransactions = false
        #expect(value.status == nil)
    }

    @Test func budgetBadgeCountsActiveIssuesAndClearsWhenResolved() {
        var value = workspace()
        var badges = HomeNavigationBadges()
        #expect(badges.budgetBadgeValue == nil)
        value.hasOverspending = true
        badges.pageStatuses[.budget] = value.budget
        #expect(badges.budgetBadgeValue == "1")
        value.hasOverassignment = true
        badges.pageStatuses[.budget] = value.budget
        #expect(badges.budgetBadgeValue == "2")
        value.hasOverspending = false
        badges.pageStatuses[.budget] = value.budget
        #expect(badges.budgetBadgeValue == "1")
        value.hasOverassignment = false
        badges.pageStatuses[.budget] = value.budget
        #expect(badges.budgetBadgeValue == nil)
    }

    @Test func combinedIssueCountsPreserveNestedTotalsAndDescriptions() throws {
        let page = try #require(
            HomeAttentionStatus.combined([
                .init(level: .issue, message: "First", count: 2),
                .init(level: .issue, message: "Second"),
                .init(level: .newActivity, message: "New activity", count: 5),
            ]))
        #expect(page.count == 3)
        let combined = try #require(
            HomeAttentionStatus.combined([
                page, .init(level: .issue, message: "Third"),
            ]))
        #expect(combined.count == 4)
        #expect(combined.message == "First. Second. New activity. Third")
    }

    @Test func workspaceIssueTotalsExcludeSelectedAndInaccessibleWorkspaces() {
        var first = workspace("first")
        first.hasOverspending = true
        first.hasOverassignment = true
        var second = workspace("second")
        second.hasMissingCategory = true
        var inaccessible = workspace("inaccessible")
        inaccessible.hasMissingPayee = true
        let summary = HomeNavigationAttention(
            values: [first, second, inaccessible], accessibleWorkspaceIDs: ["first", "second"],
            selectedWorkspaceID: "second")
        #expect(summary.menu?.count == 3)
        #expect(summary.otherWorkspaces?.count == 2)
    }

    @Test(arguments: [HomePage.reports])
    func secondaryPageIssuesReachTheMenuBadge(page: HomePage) {
        let status = HomeAttentionStatus(level: .issue, message: "Page couldn't update")
        var badges = HomeNavigationBadges()
        #expect(badges.menuStatus == nil)
        badges.pageStatuses[page] = status
        #expect(badges.menuStatus == status)
        badges.pageStatuses[page] = nil
        #expect(badges.menuStatus == nil)
    }

    @Test func primaryPageBadgesAndSecondaryWorkspaceBadgesStayScoped() {
        var other = workspace("other")
        other.hasNewTransactions = true
        let summary = HomeNavigationAttention(
            values: [other], accessibleWorkspaceIDs: ["personal", "other"],
            selectedWorkspaceID: "personal")
        let issue = HomeAttentionStatus(level: .issue, message: "Needs attention")
        var badges = HomeNavigationBadges(
            transactionCount: 2, pageStatuses: [.transactions: issue, .budget: issue])
        #expect(badges.menuStatus == nil)
        badges.otherWorkspacesStatus = summary.otherWorkspaces
        #expect(badges.menuStatus != nil)
        var archived = summary
        archived.accessibleWorkspaceIDs = ["personal"]
        badges.otherWorkspacesStatus = archived.otherWorkspaces
        #expect(badges.menuStatus == nil)
        badges.settingsStatus = issue
        #expect(badges.menuStatus == issue)
        badges.settingsStatus = nil
        badges.statusError = "Status couldn't be updated"
        #expect(badges.menuStatus?.level == .issue)
    }

    @Test func menuCountSumsVisibleIssueCountsInsteadOfAffectedRows() {
        let calendar = HomeAttentionStatus(level: .issue, message: "Calendar", count: 2)
        var badges = HomeNavigationBadges(
            transactionCount: 5,
            pageStatuses: [.home: calendar, .transactions: calendar, .budget: calendar],
            otherWorkspacesStatus: .init(level: .issue, message: "Other workspace"),
            otherWorkspaceCount: 1)
        #expect(badges.menuBadgeValue == "1")

        badges.otherWorkspacesStatus = .init(level: .issue, message: "Other workspace", count: 3)
        #expect(badges.menuBadgeValue == "3")
        badges.settingsStatus = .init(level: .issue, message: "Settings", count: 2)
        badges.pageStatuses[.reports] = .init(level: .issue, message: "Reports")
        badges.statusError = "Status unavailable"
        #expect(badges.menuBadgeValue == "7")

        badges.pageStatuses[.home] = nil
        badges.pageStatuses[.reports] = nil
        badges.settingsStatus = nil
        badges.statusError = nil
        #expect(badges.menuBadgeValue == "3")
        badges.otherWorkspacesStatus = nil
        badges.otherWorkspaceCount = 0
        #expect(badges.menuBadgeValue == nil)
    }

    @Test func menuCountIncludesIssuesAcrossPagesAndOtherActiveWorkspaces() {
        var first = workspace("first")
        first.hasNewTransactions = true
        first.hasOverspending = true
        var second = workspace("second")
        second.hasMissingCategory = true
        var archived = workspace("archived")
        archived.hasOverspending = true
        let summary = HomeNavigationAttention(
            values: [workspace(), first, second, archived],
            accessibleWorkspaceIDs: ["personal", "first", "second"], selectedWorkspaceID: "personal"
        )
        #expect(summary.otherWorkspaceCount == 2)
        let issue = HomeAttentionStatus(level: .issue, message: "Needs attention")
        var badges = HomeNavigationBadges(
            pageStatuses: [.reports: issue, .home: issue], settingsStatus: issue,
            otherWorkspacesStatus: summary.otherWorkspaces,
            otherWorkspaceCount: summary.otherWorkspaceCount)
        #expect(badges.menuBadgeValue == "4")
        badges.pageStatuses = [:]
        badges.settingsStatus = nil
        #expect(badges.menuBadgeValue == "2")
        badges.otherWorkspacesStatus = nil
        badges.otherWorkspaceCount = 0
        #expect(badges.menuBadgeValue == nil)
    }

    @Test(arguments: [HomePage.home, .planned])
    func hiddenPagesCannotContributeMenuOrAppIconBadges(page: HomePage) {
        let badges = HomeNavigationBadges(
            pageStatuses: [page: .init(level: .issue, message: "Hidden page", count: 2)])
        #expect(badges.menuBadgeCount == 0)
        #expect(badges.menuStatus == nil)
        #expect(badges.appIconBadgeCount == 0)
    }

    @Test func appIconSumsVisibleDestinationsWithoutCountingReviewRowsTwice() {
        var badges = HomeNavigationBadges(
            transactionCount: 5,
            pageStatuses: [
                .budget: .init(level: .issue, message: "Budget", count: 2),
                .transactions: .init(level: .issue, message: "Review", count: 2),
                .accounts: .init(level: .issue, message: "Accounts"),
                .home: .init(level: .issue, message: "Hidden calendar", count: 10),
            ],
            settingsStatus: .init(level: .issue, message: "Bank connection"),
            otherWorkspacesStatus: .init(level: .newActivity, message: "Other workspace", count: 2))
        #expect(badges.appIconBadgeCount == 11)
        badges.transactionCount = 0
        #expect(badges.appIconBadgeCount == 8)
        badges = .init()
        #expect(badges.appIconBadgeCount == 0)
    }

    @Test func cleanWorkspacesHaveNoDots() {
        let summary = HomeNavigationAttention(
            values: [workspace()], accessibleWorkspaceIDs: ["personal"],
            selectedWorkspaceID: "personal")
        #expect(summary.current?.budget == nil)
        #expect(summary.current?.transactions == nil)
        #expect(summary.otherWorkspaces == nil)
        #expect(summary.menu == nil)
    }

    @Test func overspendingAndOverassignmentAreBudgetIssues() {
        var value = workspace()
        value.hasOverspending = true
        #expect(value.budget?.level == .issue)
        #expect(value.transactions == nil)
        value.hasOverspending = false
        value.hasOverassignment = true
        #expect(value.budget?.level == .issue)
        #expect(value.budget?.message == "Budget is overassigned")
    }

    @Test func newActivityRemainsDistinctUntilAnIssueTakesPriority() {
        var value = workspace()
        value.hasNewTransactions = true
        #expect(value.transactions?.level == .newActivity)
        value.hasMissingCategory = true
        #expect(value.transactions?.level == .issue)
        #expect(value.transactions?.message.contains("category") == true)
        #expect(value.transactions?.message.contains("review") == true)
        value.hasMissingCategory = false
        value.hasMissingPayee = true
        #expect(value.transactions?.level == .issue)
        value.hasMissingPayee = false
        #expect(value.transactions?.level == .newActivity)
        value.hasNewTransactions = false
        #expect(value.transactions == nil)
    }

    @Test func onlyOtherWorkspacesLightTheWorkspaceHeader() {
        var personal = workspace()
        personal.hasOverspending = true
        var family = workspace("family")
        var summary = HomeNavigationAttention(
            values: [personal, family], accessibleWorkspaceIDs: ["personal", "family"],
            selectedWorkspaceID: "personal")
        #expect(summary.menu?.level == .issue)
        #expect(summary.otherWorkspaces == nil)
        family.hasNewTransactions = true
        summary.values = [personal, family]
        #expect(summary.otherWorkspaces?.level == .newActivity)
        #expect(summary.menu?.level == .issue)
        #expect(summary.current?.transactions == nil)
        summary.selectedWorkspaceID = "family"
        #expect(summary.current?.budget == nil)
        #expect(summary.current?.transactions?.level == .newActivity)
        #expect(summary.otherWorkspaces?.level == .issue)
    }

    @Test func removedAndArchivedWorkspacesCannotContributeStaleStatus() {
        var removed = workspace("removed")
        removed.hasMissingPayee = true
        let summary = HomeNavigationAttention(
            values: [workspace(), removed], accessibleWorkspaceIDs: ["personal"],
            selectedWorkspaceID: "removed")
        #expect(summary.menu == nil)
        #expect(summary.current == nil)
        #expect(summary.workspace("removed") == nil)
    }

    @Test func rolloverUsesEachWorkspacesTimezone() throws {
        let now = try #require(ISO8601DateFormatter().date(from: "2026-10-01T01:00:00Z"))
        let california = HomeWorkspaceAttention(
            workspaceId: "west", currentMonth: 202609, timezone: "America/Los_Angeles")
        let sydney = HomeWorkspaceAttention(
            workspaceId: "east", currentMonth: 202609, timezone: "Australia/Sydney")
        #expect(!california.needsMonthRefresh(now: now))
        #expect(sydney.needsMonthRefresh(now: now))
    }

    @Test func decodesTheBackendContract() throws {
        let data = Data(
            """
            {"workspaceId":"personal","currentMonth":202609,"timezone":"UTC",
            "hasOverspending":true,"hasOverassignment":false,"hasMissingCategory":false,
            "hasMissingPayee":true,"hasNewTransactions":true}
            """.utf8)
        let value = try JSONDecoder().decode(HomeWorkspaceAttention.self, from: data)
        #expect(value.budget?.level == .issue)
        #expect(value.transactions?.level == .issue)
        #expect(value.hasNewTransactions)
    }

    @Test func sharesOneLiveSubscriptionAndClearsResolvedIssues() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        var subscriptions = 0
        let store = HomeNavigationAttentionStore { _ in
            subscriptions += 1
            return publisher.eraseToAnyPublisher()
        }
        defer { store.reset() }
        #expect(!store.hasLoaded)
        store.start()
        store.start()
        #expect(subscriptions == 1)
        var value = workspace()
        value.hasMissingCategory = true
        publisher.send([value])
        try await waitUntil { store.values.first?.hasMissingCategory == true }
        #expect(store.hasLoaded)
        let now = try #require(ISO8601DateFormatter().date(from: "2026-09-08T12:00:00Z"))
        for _ in 0..<5 {
            store.refreshIfNeeded(now: now)
            store.start()
            #expect(store.values == [value])
        }
        #expect(subscriptions == 1)
        publisher.send([workspace()])
        try await waitUntil { store.values.first?.hasMissingCategory == false }
        #expect(store.values.first?.status == nil)
        #expect(subscriptions == 1)
    }

    @Test func resetCancelsAndRejectsAlreadyQueuedValues() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        var cancellations = 0
        let store = HomeNavigationAttentionStore { _ in
            publisher.handleEvents(receiveCancel: { cancellations += 1 }).eraseToAnyPublisher()
        }
        store.start()
        publisher.send([workspace()])
        store.reset()
        try await Task.sleep(for: .milliseconds(10))
        #expect(cancellations == 1)
        #expect(!store.hasLoaded)
        #expect(store.values.isEmpty)
        #expect(store.errorMessage == nil)
    }

    @Test func failedStatusRetainsLastKnownDotsUntilRetryResolvesThem() async throws {
        var publishers: [PassthroughSubject<[HomeWorkspaceAttention], Error>] = []
        let store = HomeNavigationAttentionStore { _ in
            let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
            publishers.append(publisher)
            return publisher.eraseToAnyPublisher()
        }
        defer { store.reset() }
        store.start()
        var value = workspace()
        value.hasOverspending = true
        value.hasNewTransactions = true
        publishers[0].send([value])
        try await waitUntil { !store.values.isEmpty }
        publishers[0].send(completion: .failure(NSError(domain: "offline", code: 1)))
        try await waitUntil { store.errorMessage != nil }
        #expect(store.values == [value])
        store.retry()
        #expect(publishers.count == 2)
        #expect(store.values == [value])
        publishers[1].send([workspace()])
        try await waitUntil { store.values.first?.status == nil }
        #expect(store.errorMessage == nil)
        #expect(store.values.first?.status == nil)
    }

    @Test func timeoutRecoversWhenTheLiveResponseArrives() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        let store = HomeNavigationAttentionStore(responseTimeout: .milliseconds(1)) { _ in
            publisher.eraseToAnyPublisher()
        }
        defer { store.reset() }
        store.start()
        try await waitUntil { store.errorMessage != nil }
        publisher.send([workspace()])
        try await waitUntil { store.errorMessage == nil }
        #expect(store.values.count == 1)
    }

    @Test func refreshOnlyRestartsAtMonthRolloverOrAfterFailure() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        var keys: [String] = []
        let store = HomeNavigationAttentionStore { key in
            keys.append(key)
            return publisher.eraseToAnyPublisher()
        }
        defer { store.reset() }
        store.start()
        publisher.send([workspace()])
        try await waitUntil { !store.values.isEmpty }
        let september = try #require(ISO8601DateFormatter().date(from: "2026-09-30T23:59:00Z"))
        store.refreshIfNeeded(now: september)
        #expect(keys.count == 1)
        store.refreshIfNeeded(now: september.addingTimeInterval(120))
        #expect(keys.count == 2)
        #expect(Set(keys).count == 2)
        #expect(store.values == [workspace()])
        // Returning to the foreground again while refreshing must not restart it.
        store.refreshIfNeeded(now: september.addingTimeInterval(180))
        #expect(keys.count == 2)
    }

    @Test func refreshTimeoutRetainsDotsAndALateEmptyResponseClearsThem() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        let store = HomeNavigationAttentionStore(responseTimeout: .milliseconds(20)) { _ in
            publisher.eraseToAnyPublisher()
        }
        defer { store.reset() }
        store.start()
        var value = workspace()
        value.hasOverspending = true
        value.hasNewTransactions = true
        publisher.send([value])
        try await waitUntil { store.values == [value] }
        store.retry()
        try await waitUntil { store.errorMessage != nil }
        #expect(store.values == [value])
        publisher.send([])
        try await waitUntil { store.errorMessage == nil }
        #expect(store.values.isEmpty)
    }

    @Test func retryRejectsQueuedOldValuesAndResetClearsCachedDots() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        let store = HomeNavigationAttentionStore { _ in publisher.eraseToAnyPublisher() }
        store.start()
        var value = workspace()
        value.hasNewTransactions = true
        publisher.send([value])
        try await waitUntil { store.values == [value] }
        publisher.send([])
        store.retry()
        try await Task.sleep(for: .milliseconds(10))
        #expect(store.values == [value])
        store.reset()
        #expect(store.values.isEmpty)
        #expect(store.errorMessage == nil)
    }

    @Test func completedStreamCanReconnectWithoutClearingDots() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        var subscriptions = 0
        let store = HomeNavigationAttentionStore { _ in
            subscriptions += 1
            return publisher.eraseToAnyPublisher()
        }
        defer { store.reset() }
        store.start()
        var value = workspace()
        value.hasNewTransactions = true
        publisher.send([value])
        try await waitUntil { store.values == [value] }
        publisher.send(completion: .finished)
        try await waitUntil { store.errorMessage != nil }
        store.refreshIfNeeded()
        #expect(subscriptions == 2)
        #expect(store.values == [value])
    }

    @Test func summaryFiltersArchivedAndNoLongerAccessibleWorkspaces() async throws {
        let publisher = PassthroughSubject<[HomeWorkspaceAttention], Error>()
        let store = HomeNavigationAttentionStore { _ in publisher.eraseToAnyPublisher() }
        defer { store.reset() }
        store.start()
        var archived = workspace("archived")
        archived.hasOverspending = true
        publisher.send([workspace(), archived])
        try await waitUntil { store.values.count == 2 }
        let summary = store.summary(
            workspaces: [
                .init(_id: "personal", name: "Personal"),
                .init(_id: "archived", name: "Archived", isArchived: true),
            ], selectedWorkspaceID: "personal")
        #expect(summary.menu == nil)
        #expect(summary.otherWorkspaces == nil)
    }

    private func waitUntil(_ predicate: () -> Bool) async throws {
        for _ in 0..<1_000 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(1))
        }
        Issue.record("Timed out waiting for navigation status")
    }
}
