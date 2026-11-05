import Foundation
import Testing

@testable import Kualia

@Suite(.serialized)
@MainActor
struct TransactionSearchTests {
    let workspace = TransactionFeedWorkspace(
        id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
        timezoneIdentifier: "America/New_York")

    @Test func sparseResultsAppearTogetherWhenTheScanFinishes() async throws {
        var pending: CheckedContinuation<TransactionFeedResponse, Error>?
        let store = TransactionSearchStore(workspace: workspace) { request in
            if request.cursor == nil { return response([item("first")], cursor: "older") }
            return try await withCheckedThrowingContinuation { pending = $0 }
        }
        let refresh = Task { await store.refresh() }
        await waitUntil { pending != nil }
        #expect(store.isLoading)
        #expect(store.sections.isEmpty)
        #expect(!store.hasLoaded)
        try #require(pending).resume(
            returning: response((1..<26).map { item("row-\($0)") }, done: true))
        await refresh.value
        #expect(store.resultCount == 26)
        #expect(store.hasLoaded && !store.isLoading)
    }

    @Test func aFullServerSearchResultNeedsOnlyOneRequest() async {
        var requests = 0
        let store = TransactionSearchStore(workspace: workspace) { _ in
            requests += 1
            return response((0..<26).map { item("row-\($0)") }, done: true)
        }
        await store.refresh()
        #expect(requests == 1)
        #expect(store.resultCount == 26)
        #expect(!store.hasMore)
    }

    @Test func categoryMonthLoadsAllPagesWithoutAnotherTap() async {
        let filters = BudgetCategoryMonth.filters(categoryID: "groceries", month: 202609)
        var requests: [TransactionSearchRequest] = []
        let store = TransactionSearchStore(
            workspace: workspace, filters: filters, loadsAllPages: true
        ) { request in
            requests.append(request)
            if request.cursor == nil {
                return response((0..<100).map { item("row-\($0)") }, cursor: "older")
            }
            return response([item("row-99"), item("oldest")], done: true)
        }
        await store.refresh()
        #expect(store.resultCount == 101)
        #expect(store.items.count == 101)
        #expect(!store.hasMore && !store.isLoading)
        #expect(requests.map(\.cursor) == [nil, "older"])
        #expect(requests.allSatisfy { $0.filters == filters })
    }

    @Test func searchesPastEmptyPagesForOldTransactions() async {
        var requests: [TransactionSearchRequest] = []
        let store = TransactionSearchStore(workspace: workspace) { request in
            requests.append(request)
            switch request.cursor {
            case nil: return response([], cursor: "older")
            case "older": return response([], cursor: "oldest")
            default: return response([item("match", date: "2020-02-29")], done: true)
            }
        }
        store.filters.text = "birthday checking"
        await store.refresh()
        #expect(requests.map(\.cursor) == [nil, "older", "oldest"])
        #expect(requests.allSatisfy { $0.filters.text == "birthday checking" })
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["match"])
        #expect(!store.hasMore && !store.isLoading)
    }

    @Test func completeCategoryResultsStayVisibleUntilEveryRefreshPageArrives() async throws {
        var refreshing = false
        var pending: CheckedContinuation<TransactionFeedResponse, Error>?
        var calls = 0
        let store = TransactionSearchStore(workspace: workspace, loadsAllPages: true) { request in
            calls += 1
            if !refreshing { return response([item("original")], done: true) }
            if request.cursor == nil {
                return response((0..<40).map { item("new-\($0)") }, cursor: "older")
            }
            return try await withCheckedThrowingContinuation { pending = $0 }
        }
        await store.refresh()
        refreshing = true
        let refresh = Task { await store.refreshIfIdle() }
        await waitUntil { pending != nil }
        #expect(store.completedItems?.map(\.id) == ["original"])
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["original"])
        let repeatedRefresh = Task { await store.refreshIfIdle() }
        await Task.yield()
        #expect(calls == 3)
        try #require(pending).resume(returning: response([item("last")], done: true))
        await refresh.value
        await repeatedRefresh.value
        #expect(store.completedItems?.count == 41)
        #expect(store.resultCount == 41)
        #expect(store.completedItems?.last?.id == "last")
    }

    @Test func failedRefreshRetainsCompleteResultsAndFilterChangesDiscardThem() async {
        var fails = false
        let store = TransactionSearchStore(workspace: workspace, loadsAllPages: true) { _ in
            if fails { throw TestError.offline }
            return response([item("original")], done: true)
        }
        await store.refresh()
        fails = true
        await store.refresh()
        #expect(store.completedItems?.map(\.id) == ["original"])
        #expect(store.resultCount == 1)
        #expect(store.errorMessage != nil)
        store.filters.categoryID = "different"
        await store.refresh()
        #expect(store.completedItems == nil)
        #expect(store.resultCount == 0)
    }

    @Test func emptyCompleteMonthRemainsAvailableDuringRefresh() async throws {
        var refreshing = false
        var pending: CheckedContinuation<TransactionFeedResponse, Error>?
        let store = TransactionSearchStore(workspace: workspace, loadsAllPages: true) { _ in
            if refreshing {
                return try await withCheckedThrowingContinuation { pending = $0 }
            }
            return response([], done: true)
        }
        await store.refresh()
        refreshing = true
        let refresh = Task { await store.refresh() }
        await waitUntil { pending != nil }
        #expect(store.completedItems?.isEmpty == true)
        #expect(store.hasLoaded)
        try #require(pending).resume(returning: response([], done: true))
        await refresh.value
        #expect(store.completedItems?.isEmpty == true)
    }

    @Test func loadsMoreWithoutDuplicatesAndKeepsFilters() async {
        var requests: [TransactionSearchRequest] = []
        let store = TransactionSearchStore(workspace: workspace) { request in
            requests.append(request)
            if request.cursor == nil {
                return response((0..<40).map { item("row-\($0)") }, cursor: "next")
            }
            return response([item("row-39"), item("last")], done: true)
        }
        store.filters = .init(accountID: "account", status: .pending, hasNotes: true)
        await store.refresh()
        #expect(store.resultCount == 40)
        #expect(store.hasMore)
        store.loadMore()
        await waitUntil { !store.isLoading }
        #expect(store.resultCount == 41)
        #expect(requests.last?.filters == store.filters)
        #expect(requests.last?.cursor == "next")
        #expect(!store.hasMore)
    }

    @Test func refreshingAfterASwipePreservesOlderResultsUntilTheirPagesAreReloaded() async throws {
        var isRefreshing = false
        var olderPage: CheckedContinuation<TransactionFeedResponse, Error>?
        let store = TransactionSearchStore(workspace: workspace) { request in
            if request.cursor == nil {
                return response((0..<40).map { item("row-\($0)") }, cursor: "older")
            }
            if isRefreshing {
                return try await withCheckedThrowingContinuation { olderPage = $0 }
            }
            return response([item("older-match")], done: true)
        }
        await store.refresh()
        store.loadMore()
        await waitUntil { !store.isLoading }
        #expect(store.resultCount == 41)
        isRefreshing = true
        let refresh = Task { await store.refresh() }
        await waitUntil { olderPage != nil }
        #expect(store.resultCount == 41)
        #expect(store.sections.flatMap(\.entries).last?.id == "older-match")
        let pending = try #require(olderPage)
        pending.resume(returning: response([], done: true))
        await refresh.value
        #expect(store.resultCount == 40)
        #expect(!store.hasMore)
        #expect(!store.isLoading)
    }

    @Test func debouncesTypingAndOnlyLoadsTheLatestSearch() async throws {
        var texts: [String] = []
        let store = TransactionSearchStore(workspace: workspace, debounce: .milliseconds(20)) {
            request in
            texts.append(request.filters.text)
            return response([], done: true)
        }
        store.filters.text = "co"
        store.search()
        store.filters.text = "coffee"
        store.search()
        try await Task.sleep(for: .milliseconds(60))
        #expect(texts == ["coffee"])
        #expect(store.hasLoaded)
    }

    @Test func staleResponsesCannotOverwriteANewSearch() async throws {
        var oldResponse: CheckedContinuation<TransactionFeedResponse, Error>?
        let store = TransactionSearchStore(workspace: workspace) { request in
            if request.filters.text == "old" {
                return try await withCheckedThrowingContinuation { oldResponse = $0 }
            }
            return response([item("new")], done: true)
        }
        store.filters.text = "old"
        store.search(immediately: true)
        await waitUntil { oldResponse != nil }
        store.filters.text = "new"
        await store.refresh()
        let pending = try #require(oldResponse)
        pending.resume(returning: response([item("old")], done: true))
        await Task.yield()
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["new"])
        #expect(!store.isLoading)
    }

    @Test func retriesAnInterruptedScanFromItsLastCursor() async {
        var fail = true
        var cursors: [String?] = []
        let store = TransactionSearchStore(workspace: workspace) { request in
            cursors.append(request.cursor)
            if request.cursor == nil { return response([item("first")], cursor: "next") }
            if fail {
                fail = false
                throw TestError.offline
            }
            return response([item("last")], done: true)
        }
        await store.refresh()
        #expect(store.resultCount == 1)
        #expect(store.errorMessage != nil)
        store.retry()
        await waitUntil { !store.isLoading }
        #expect(cursors == [nil, "next", "next"])
        #expect(store.resultCount == 2)
        #expect(store.errorMessage == nil)
    }

    @Test func stoppingSearchIgnoresAnInflightResponse() async throws {
        var pending: CheckedContinuation<TransactionFeedResponse, Error>?
        let store = TransactionSearchStore(workspace: workspace) { _ in
            try await withCheckedThrowingContinuation { pending = $0 }
        }
        store.search(immediately: true)
        await waitUntil { pending != nil }
        store.stop()
        try #require(pending).resume(returning: response([item("late")], done: true))
        await Task.yield()
        #expect(store.sections.isEmpty)
        #expect(!store.isLoading)
    }

    @Test func doesNotExposeAnotherWorkspacesResults() async {
        let store = TransactionSearchStore(workspace: workspace) { _ in
            TransactionFeedResponse(
                workspace: .init(
                    id: "other", name: "Other", currencyCode: "USD", minorUnit: 2,
                    timezoneIdentifier: nil),
                transactions: .init(page: [item("foreign")], continueCursor: "", isDone: true))
        }
        await store.refresh()
        #expect(store.resultCount == 0)
        #expect(store.errorMessage != nil)
    }

    @Test func repeatedCursorStopsInsteadOfLoopingForever() async {
        var calls = 0
        let store = TransactionSearchStore(workspace: workspace) { _ in
            calls += 1
            return response([], cursor: "repeated")
        }
        await store.refresh()
        #expect(calls == 2)
        #expect(store.errorMessage != nil)
        #expect(!store.isLoading)
    }

    @Test func clearingFiltersPreservesTheTypedSearch() {
        let store = TransactionSearchStore(workspace: workspace) { _ in response([], done: true) }
        store.filters = .init(
            text: "lunch", accountID: "account", categoryID: "category", startDate: "2026-01-01",
            endDate: "2026-12-31", status: .pending, flow: .outflow, hasNotes: true)
        #expect(store.filters.count == 6)
        store.clearFilters()
        #expect(store.filters == .init(text: "lunch"))
    }

    @Test func reportRowsPrefillExactFiltersAndPreserveThemAcrossPages() async {
        let range = ReportRange(start: "2024-02-01", end: "2024-03-31")
        for grouping in ReportGrouping.allCases {
            for kind in [ReportKind.moneyIn, .spending] {
                let row = ReportRank(id: "row-id", name: "Selected row", logoURL: nil)
                let filters = TransactionSearchFilters.report(
                    row: row, grouping: grouping, kind: kind, range: range)
                #expect(filters.startDate == range.start && filters.endDate == range.end)
                #expect(filters.flow == (kind == .moneyIn ? .inflow : .outflow))
                #expect(filters.categoryID == (grouping == .categories ? row.id : nil))
                #expect(filters.group?.id == (grouping == .groups ? row.id : nil))
                #expect(filters.merchant?.id == (grouping == .merchants ? row.id : nil))
                #expect(filters.text.isEmpty && filters.reportActivity)
                var requests: [TransactionSearchRequest] = []
                let store = TransactionSearchStore(
                    workspace: workspace, filters: filters, loadsAllPages: true
                ) { request in
                    requests.append(request)
                    return request.cursor == nil
                        ? response([], cursor: "older") : response([item("match")], done: true)
                }
                await store.refresh()
                #expect(requests.count == 2 && requests.allSatisfy { $0.filters == filters })
                store.clearFilters()
                #expect(store.filters == .init())
            }
        }
    }

    @Test func reportSpecialRowsKeepTheirExactIdentity() {
        let range = ReportRange(start: "2026-09-01", end: "2026-09-25")
        let merchant = TransactionSearchFilters.report(
            row: .init(id: "unlinked:no merchant", name: "No merchant", logoURL: nil),
            grouping: .merchants, kind: .spending, range: range)
        #expect(merchant.merchant?.id == "unlinked:no merchant")
        let group = TransactionSearchFilters.report(
            row: .init(id: "ungrouped", name: "Ungrouped", logoURL: nil),
            grouping: .groups, kind: .spending, range: range)
        #expect(group.group?.id == "ungrouped")
        #expect(group.count == 4)
    }

    @Test func dateShortcutsUseWorkspaceDaysAndLeapMonths() throws {
        let now = try #require(ISO8601DateFormatter().date(from: "2024-03-01T02:00:00Z"))
        let thisMonth = TransactionSearchPeriod.month.range(workspace: workspace, now: now)
        #expect(thisMonth.start == "2024-02-01")
        #expect(thisMonth.end == "2024-02-29")
        let march = try #require(ISO8601DateFormatter().date(from: "2024-03-15T12:00:00Z"))
        let lastMonth = TransactionSearchPeriod.lastMonth.range(workspace: workspace, now: march)
        #expect(lastMonth.start == "2024-02-01" && lastMonth.end == "2024-02-29")
        let last30 = TransactionSearchPeriod.last30Days.range(workspace: workspace, now: march)
        #expect(last30.start == "2024-02-15" && last30.end == "2024-03-15")
    }

    @Test func rowNotesAreTrimmedAndParticipateInEquality() {
        let original = TransactionFeedEntry(item: item("row"))
        let updated = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "row", date: "2026-09-06", type: .regular, amount: -1250,
                notes: "  Birthday lunch\n "))
        #expect(updated.notes == "Birthday lunch")
        #expect(original != updated)
        let empty = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "blank", date: "2026-09-06", type: .regular, amount: -1250, notes: " \n "))
        #expect(empty.notes == nil)
    }

    private func item(_ id: String, date: String = "2026-09-06") -> TransactionFeedItem {
        TransactionFeedItem(id: id, date: date, type: .regular, amount: -1250)
    }
    private func response(_ items: [TransactionFeedItem], cursor: String = "", done: Bool = false)
        -> TransactionFeedResponse
    {
        .init(
            workspace: workspace,
            transactions: .init(page: items, continueCursor: cursor, isDone: done))
    }
    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<500 {
            if condition() { return }
            await Task.yield()
        }
        #expect(condition())
    }
    private enum TestError: Error { case offline }
}
