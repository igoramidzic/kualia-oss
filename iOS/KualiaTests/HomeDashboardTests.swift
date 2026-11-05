import Foundation
import Testing

@testable import Kualia

struct HomeDashboardTests {
    private let day = "2026-09-06"
    private var notices: [HomeNotice] { HomeDashboardScenario.needsAttention.notices }

    @Test func transactionNoticesSelectTheMatchingFilter() {
        func notice(_ kind: HomeNotice.Kind) -> HomeNotice {
            HomeNotice(
                id: kind.rawValue, kind: kind, eyebrow: "", title: "", message: "",
                actionTitle: "", destination: .transactions, revision: "1")
        }
        #expect(notice(.review).transactionFilter == .needsReview)
        #expect(notice(.category).transactionFilter == .needsReview)
        #expect(notice(.unavailable).transactionFilter == .all)
    }

    @Test func loadingHidesPartialAndCachedNoticesUntilEverySourceSettles() {
        #expect(HomeInboxContentState(isLoading: true, visibleCount: 0) == .loading)
        #expect(HomeInboxContentState(isLoading: true, visibleCount: notices.count) == .loading)
        #expect(HomeInboxContentState(isLoading: false, visibleCount: notices.count) == .briefing)
        #expect(HomeInboxContentState(isLoading: false, visibleCount: 0) == .empty)
    }

    @Test func dismissingEverythingClearsNoticesWithoutChangingTheSource() throws {
        var state = HomeInboxState()
        state.reconcile(notices: notices, day: day)
        for notice in notices { state.dismiss(notice) }
        #expect(state.visible(in: notices).isEmpty)
        #expect(notices.count == 3)
        let last = try #require(notices.last)
        state.restore(last)
        #expect(state.visible(in: notices) == [last])
    }

    @Test func undoDismissalsRestoresEveryCurrentNotice() {
        var state = HomeInboxState()
        state.reconcile(notices: notices, day: day)
        for notice in notices { state.dismiss(notice) }
        #expect(
            HomeInboxContentState(isLoading: false, visibleCount: state.visible(in: notices).count)
                == .empty)
        state.restoreAll()
        #expect(state.visible(in: notices) == notices)
        #expect(state.dismissed.isEmpty)
        #expect(
            HomeInboxContentState(isLoading: false, visibleCount: state.visible(in: notices).count)
                == .briefing)
    }

    @Test func unrelatedUpdatesDoNotBringBackDismissedNotices() throws {
        let notice = try #require(notices.first)
        var state = HomeInboxState()
        state.reconcile(notices: [notice], day: day)
        state.dismiss(notice)
        state.reconcile(notices: notices, day: day)
        #expect(!state.visible(in: notices).contains(notice))
        #expect(state.visible(in: notices).count == 2)
    }

    @Test func changedAmountsBringTheIssueBackImmediately() throws {
        let initial = try #require(
            HomeNotice.overspending(
                id: "food", name: "Dining", available: -4280, formattedAmount: "$42.80",
                month: 202609))
        let changed = try #require(
            HomeNotice.overspending(
                id: "food", name: "Dining", available: -5000, formattedAmount: "$50.00",
                month: 202609))
        var state = HomeInboxState()
        state.reconcile(notices: [initial], day: day)
        state.dismiss(initial)
        state.reconcile(notices: [changed], day: day)
        #expect(state.visible(in: [changed]) == [changed])
    }

    @Test func resolvedThenRecurringIssuesAreShownAgain() throws {
        let notice = try #require(notices.first)
        var state = HomeInboxState()
        state.reconcile(notices: [notice], day: day)
        state.dismiss(notice)
        state.reconcile(notices: [], day: day)
        state.reconcile(notices: [notice], day: day)
        #expect(state.visible(in: [notice]) == [notice])
    }

    @Test func unresolvedNoticesReturnOnTheNextWorkspaceDay() {
        var state = HomeInboxState()
        state.reconcile(notices: notices, day: day)
        for notice in notices { state.dismiss(notice) }
        state.reconcile(notices: notices, day: "2026-09-07")
        #expect(state.visible(in: notices) == notices)
        #expect(state.dismissed.isEmpty)
    }

    @Test func dismissalDuringPartialLoadingSurvivesTheCompleteSnapshot() throws {
        let notice = try #require(notices.first)
        var state = HomeInboxState()
        state.prepare(day: day)
        state.dismiss(notice)
        // Loading another source must not prune or reset this acknowledgement.
        state.prepare(day: "")
        state.prepare(day: day)
        state.reconcile(notices: notices, day: day)
        #expect(state.isDismissed(notice))
    }

    @Test func unavailableInformationCannotBeDismissedIntoAllDone() throws {
        let incomplete = try HomeBriefingTests.snapshot(partial: true)
        var state = HomeInboxState()
        state.reconcile(notices: incomplete.notices, day: day)
        for notice in incomplete.notices { state.dismiss(notice) }
        #expect(state.visible(in: incomplete.notices).count == 1)
    }

    @Test func repeatedDismissalsAreHarmlessAndCanBeRestored() throws {
        let notice = try #require(notices.first)
        var state = HomeInboxState()
        state.reconcile(notices: notices, day: day)
        state.dismiss(notice)
        state.dismiss(notice)
        #expect(state.dismissed.count == 1)
        state.restoreAll()
        #expect(state.visible(in: notices) == notices)
    }

    @Test func persistenceKeepsAcknowledgementsWithoutSavingAmountsOrCopy() throws {
        var state = HomeInboxState()
        state.reconcile(notices: notices, day: day)
        for notice in notices { state.dismiss(notice) }
        let data = try JSONEncoder().encode(state)
        let restored = try JSONDecoder().decode(HomeInboxState.self, from: data)
        #expect(restored.visible(in: notices).isEmpty)
        let saved = String(decoding: data, as: UTF8.self)
        #expect(!saved.contains("Dining"))
        #expect(!saved.contains("4280"))
        #expect(!saved.contains("$"))
    }

    @Test func healthyEnvelopesNeverBecomeNotices() {
        for available: Decimal in [0, 1200] {
            #expect(
                HomeNotice.overspending(
                    id: "food", name: "Dining", available: available,
                    formattedAmount: "$12.00", month: 202609) == nil)
        }
        #expect(HomeDashboardScenario.allSet.notices.isEmpty)
        #expect(HomeDashboardScenario.quietDay.notices.allSatisfy { $0.isUpcoming })
    }

    @Test func readyToAssignCanBeClearedAndZeroDoesNotClutterHome() {
        #expect(HomeNotice.readyToAssign(0, formattedAmount: "$0.00", month: 202609) == nil)
        let positive = HomeNotice.readyToAssign(100, formattedAmount: "$1.00", month: 202609)
        let negative = HomeNotice.readyToAssign(-100, formattedAmount: "-$1.00", month: 202609)
        #expect(positive?.kind == .allocation)
        #expect(positive?.isDismissible == true)
        #expect(negative?.kind == .overspent)
    }

    @Test func connectionNoticesOnlyIncludeLinkedBanksThatNeedAttention() throws {
        func notice(_ status: String, linked: Bool = true, canManage: Bool = true) -> HomeNotice? {
            HomeNotice.bankConnection(
                id: "chase", provider: "plaid", name: "Chase", status: status,
                hasLinkedAccounts: linked, canManage: canManage)
        }
        #expect(notice("connected") == nil)
        #expect(notice("pending") == nil)
        #expect(notice("disconnected", linked: false) == nil)
        #expect(notice("needs_attention")?.kind == .connection)
        #expect(notice("disconnected")?.title == "Chase is disconnected")
        #expect(try #require(notice("needs_attention", canManage: false)).message.contains("owner"))
    }

    @Test func navigationDateUsesTheUsersTimeZone() throws {
        let date = try Date.ISO8601FormatStyle().parse("2026-09-06T02:00:00Z")
        let timeZone = try #require(TimeZone(identifier: "America/New_York"))
        #expect(
            HomeDashboardDate.title(
                for: date, locale: Locale(identifier: "en_US"), timeZone: timeZone) == "Sat, Sep 5")
        #expect(
            HomeDashboardDate.title(for: date, locale: Locale(identifier: "en_US"), timeZone: .gmt)
                == "Sun, Sep 6")
    }
}
