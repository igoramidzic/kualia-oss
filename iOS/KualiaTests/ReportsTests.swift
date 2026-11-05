import CoreGraphics
import Foundation
import Testing

@testable import Kualia

#if canImport(UIKit)
    import UIKit
#endif

struct ReportModelTests {
    static let range = ReportRange(start: "2026-09-01", end: "2026-09-05")

    @Test func compactRangeLabelsDistinguishWholeYearsAndMonthRanges() {
        let cases = [
            ("2025-01-01", "2025-12-31", "2025"),
            ("2024-01-01", "2025-12-31", "2024–2025"),
            ("2025-01-01", "2025-03-31", "Jan ’25–Mar ’25"),
            ("2025-11-01", "2026-02-28", "Nov ’25–Feb ’26"),
            ("2024-02-01", "2024-02-29", "Feb ’24"),
            ("2026-09-01", "2026-09-25", "Sep ’26"),
            ("2025-01-01", "2025-12-15", "Jan ’25–Dec ’25"),
            ("2025-02-01", "2025-12-31", "Feb ’25–Dec ’25"),
        ]
        for (start, end, expected) in cases {
            #expect(
                ReportRange(start: start, end: end).compactMonthLabel(
                    locale: Locale(identifier: "en_US")) == expected)
        }
    }

    @Test func compactRangeLabelsUseLocalizedMonthsAndYears() {
        let range = ReportRange(start: "2025-01-01", end: "2025-03-31")
        #expect(range.compactMonthLabel(locale: Locale(identifier: "fr_FR")).contains("janv."))
        let chinese = range.compactMonthLabel(locale: Locale(identifier: "zh_Hans_CN"))
        #expect(chinese.contains("1月") && chinese.contains("3月"))
        for locale in ["en", "de", "es", "fr", "it", "sr_Latn", "zh_Hans"] {
            let label = range.compactMonthLabel(locale: Locale(identifier: locale))
            #expect(!label.contains("\n"))
            #expect(label.components(separatedBy: "–").count == 2)
        }
    }

    static func entry(
        _ id: String = "one", date: String = "2026-09-02", account: String = "cash",
        merchant: String = "shop", status: String = "cleared", review: String = "reviewed",
        amounts: [(String, Decimal)] = [("food", -1000)]
    ) -> ReportEntry {
        .init(
            id: id, date: date, accountId: account, accountName: account, merchantId: merchant,
            merchantName: merchant, merchantLogoUrl: nil, status: status, reviewStatus: review,
            notes: nil,
            movements: amounts.map { .init(categoryId: $0.0, categoryName: $0.0, amount: $0.1) })
    }

    @Test func multiYearRangesHaveNoReportingLimitAndComparisonsStayEqualLength() {
        let range = ReportRange(start: "2010-01-01", end: "2026-09-05")
        #expect(range.dayCount > 6000)
        #expect(range.comparison(.previous).dayCount == range.dayCount)
        #expect(range.comparison(.lastYear).dayCount == range.dayCount)
        #expect(ReportDates.range(.custom, now: Date(), timezone: nil, custom: range) == range)
    }

    @Test func summaryTransportPreservesAmountsAboveInt64AndContainsNoLedger() throws {
        let raw =
            #"{"range":{"start":"2020-01-01","end":"2026-09-05"},"totals":{"outflow":"18446744073709551616","inflow":"200","count":12000},"previous":{"outflow":"0","inflow":"0","count":0},"buckets":[],"categories":[],"merchants":[],"spendingDays":50,"categoryCount":0,"merchantCount":0,"accounts":[],"categoryOptions":[],"merchantOptions":[],"optionsTruncated":false}"#
        let report = try JSONDecoder().decode(ReportAnalysis.self, from: Data(raw.utf8))
        #expect(report.totals.outflow == Decimal(string: "18446744073709551616"))
        #expect(report.totals.count == 12000)
        #expect(report.spendingDays == 50)
    }

    @Test func detailShowsOnlyMatchingMovementsButRetainsTheFullTransaction() {
        var filters = ReportFilters()
        filters.categoryIDs = ["food"]
        let request = ReportSummaryRequest(
            workspaceID: "personal", range: Self.range,
            comparison: Self.range.comparison(.previous), kind: .spending, filters: filters)
        let match = request.matching(
            Self.entry(amounts: [("food", -1000), ("food", 200), ("home", -500)]))
        #expect(match.amount == -1000)
        #expect(match.entry.amount == -1300)
        #expect(match.entry.movements.count == 3)
    }

    @Test func workspaceCalendarAndLeapYearComparisonsStayExact() {
        let now = Date(timeIntervalSince1970: 1_788_223_800)  // 2026-09-01 00:50 UTC
        #expect(
            ReportDates.range(.month, now: now, timezone: "America/Los_Angeles", custom: nil).end
                == "2026-08-31")
        let leap = ReportRange(start: "2024-02-01", end: "2024-02-29")
        #expect(leap.dayCount == 29)
        #expect(leap.comparison(.lastYear).dayCount == 29)
        #expect(ReportRange(start: "2026-03-01", end: "2026-03-31").dayCount == 31)
    }

    @Test func presetsUseWholeMonthsAndTheWorkspaceCalendar() {
        let now = ReportDates.date("2026-09-23")
        func range(_ period: ReportPeriod) -> ReportRange {
            ReportDates.range(period, now: now, timezone: "UTC", custom: nil)
        }
        #expect(range(.lastThreeMonths) == .init(start: "2026-07-01", end: "2026-09-23"))
        #expect(range(.lastSixMonths).start == "2026-04-01")
        #expect(range(.lastYear).start == "2025-10-01")
        #expect(range(.previousYear) == .init(start: "2025-01-01", end: "2025-12-31"))
        #expect(
            ReportDates.monthRange(from: "2024-02-20", through: "2024-02-01", today: "2026-09-23")
                == .init(start: "2024-02-01", end: "2024-02-29"))
    }

    @Test func customMonthPickerCompletesEitherDirectionAndRestartsOnTheThirdTap() {
        let today = "2026-09-23"
        var selection = ReportMonthSelection(range: .init(start: "2026-09-01", end: today))
        #expect(selection.isComplete)
        selection.select("2026-08-01", today: today)
        #expect(!selection.isComplete)
        selection.select("2026-06-01", today: today)
        #expect(selection.isComplete)
        #expect(selection.range == .init(start: "2026-06-01", end: "2026-08-31"))
        selection.select("2025-12-01", today: today)
        #expect(!selection.isComplete)
        #expect(selection.range == .init(start: "2025-12-01", end: "2025-12-31"))
        selection.select("2026-02-01", today: today)
        #expect(selection.isComplete)
        #expect(selection.range == .init(start: "2025-12-01", end: "2026-02-28"))
    }

    @Test func customMonthPickerSupportsOneMonthLeapYearsAndTheCurrentPartialMonth() {
        var selection = ReportMonthSelection(range: .init(start: "2026-09-01", end: "2026-09-23"))
        selection.select("2024-02-01", today: "2026-09-23")
        selection.select("2024-02-01", today: "2026-09-23")
        #expect(selection.isComplete)
        #expect(selection.range == .init(start: "2024-02-01", end: "2024-02-29"))
        selection.select("2026-08-01", today: "2026-09-23")
        selection.select("2026-09-01", today: "2026-09-23")
        #expect(selection.range == .init(start: "2026-08-01", end: "2026-09-23"))
    }

    @Test func localHistoryKeepsBothSidesOfMixedSplitsAndCountsGroupsOnce() {
        let split = ReportEntry(
            id: "split", date: "2026-09-02", accountId: "cash", accountName: "Cash",
            merchantId: "shop", merchantName: "Shop", merchantLogoUrl: nil, status: "cleared",
            reviewStatus: "reviewed", notes: nil,
            movements: [
                .init(
                    categoryId: "food", categoryName: "Food", amount: -1000, groupId: "living",
                    groupName: "Living"),
                .init(
                    categoryId: "home", categoryName: "Home", amount: -500, groupId: "living",
                    groupName: "Living"),
                .init(
                    categoryId: "food", categoryName: "Food", amount: 200, groupId: "living",
                    groupName: "Living"),
            ])
        let history = ReportHistory(entries: [split, Self.entry("pending", status: "pending")])
        func request(_ kind: ReportKind) -> ReportSummaryRequest {
            .init(
                workspaceID: "personal", range: Self.range,
                comparison: Self.range.comparison(.previous), kind: kind, filters: .init())
        }
        let incoming = history.report(request(.moneyIn))
        let outgoing = history.report(request(.spending))
        #expect(incoming.totals.inflow == 200)
        #expect(outgoing.totals.outflow == 1500)
        #expect(outgoing.groups.count == 1)
        #expect(outgoing.groups.first?.count == 1)
        #expect(outgoing.groups.first?.amount == 1500)
        #expect(outgoing.categories.reduce(Decimal.zero) { $0 + $1.amount } == 1500)
        #expect(incoming.merchants.first?.amount == 200)
        #expect(history.report(request(.cashFlow)).totals.net == -1300)
        var scoped = request(.spending)
        scoped.scope = .init(title: "Living", groupID: "living", kind: .spending)
        #expect(history.matched(scoped, range: Self.range).first?.movements.count == 2)
        #expect(history.matched(scoped, range: Self.range).first?.entry.movements.count == 3)
    }

    @Test func monthlyHistoryIncludesQuietMonthsAndExcludesPendingAndFutureActivity() {
        let history = ReportHistory(entries: [
            Self.entry("first", date: "2026-06-30"),
            Self.entry("last", date: "2026-09-05", amounts: [("income", 5000)]),
            Self.entry("pending", date: "2026-07-01", status: "pending"),
            Self.entry("future", date: "2026-10-01"),
        ])
        let months = history.months(through: "2026-09-23")
        #expect(months.map(\.id) == ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"])
        #expect(months[1].totals.count == 0)
        #expect(months.last?.range.end == "2026-09-23")
        #expect(months.reduce(Decimal.zero) { $0 + $1.totals.outflow } == 1000)
        #expect(months.reduce(Decimal.zero) { $0 + $1.totals.inflow } == 5000)
    }

    @Test func continuousBarsSplitExactlyAtZeroForBothAndSingleDirections() {
        func point(inflow: Decimal, outflow: Decimal) -> ReportChartMonth {
            .init(
                bucket: .init(range: Self.range, totals: .init(outflow: outflow, inflow: inflow)),
                selectedRange: Self.range)
        }
        #expect(point(inflow: 300, outflow: 900).zeroPosition == 0.25)
        #expect(point(inflow: 900, outflow: 300).zeroPosition == 0.75)
        #expect(point(inflow: 300, outflow: 0).zeroPosition == 1)
        #expect(point(inflow: 0, outflow: 900).zeroPosition == 0)
        #expect(point(inflow: 0, outflow: 0).zeroPosition == 0.5)
    }

    @Test func monthlyCashFlowUsesOnlyThatMonthsInflowAndOutflow() {
        let history = ReportHistory(entries: [
            Self.entry(
                "january", date: "2026-01-15", amounts: [("income", 9000), ("food", -6000)]),
            Self.entry("march", date: "2026-03-15", amounts: [("income", 3000), ("food", -12000)]),
            Self.entry("april", date: "2026-04-15", amounts: [("income", 6000), ("food", -3000)]),
        ])
        let months = history.months(through: "2026-04-20")
        #expect(months.map(\.id) == ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"])
        #expect(months.map(\.totals.net) == [3000, 0, -9000, 3000])
        #expect(months.last?.range.end == "2026-04-20")
    }

    @Test func historyTransportKeepsExactAmountsAndGroupMetadata() throws {
        let raw =
            #"{"categoryId":"food","categoryName":"Food","amount":"-9223372036854775808","groupId":"living","groupName":"Living"}"#
        let movement = try JSONDecoder().decode(ReportMovement.self, from: Data(raw.utf8))
        #expect(movement.amount == Decimal(string: "-9223372036854775808"))
        #expect(movement.resolvedGroupID == "living")
        #expect(
            ReportMovement(categoryId: "uncategorized", categoryName: "", amount: -1)
                .resolvedGroupID == "ungrouped")
    }
}

@MainActor
struct ReportsStoreTests {
    static let now = ReportDates.date("2026-09-23").addingTimeInterval(12 * 3600)
    static let context = ReportsContext(
        id: "personal", currencyCode: "USD", minorUnit: 2, timezone: "UTC")
    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<150 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        #expect(condition())
    }
    private enum Failure: Error { case failed }

    @Test func allPagesLoadBeforePublicationAndRangesAndDetailsStayLocal() async throws {
        var requests: [ReportHistoryRequest] = []
        var finish: CheckedContinuation<ReportPage, Never>?
        let store = ReportsStore(
            now: { Self.now },
            historyLoader: { request in
                requests.append(request)
                if request.cursor == nil {
                    return .init(
                        page: [ReportModelTests.entry("recent")], continueCursor: "older",
                        isDone: false)
                }
                return await withCheckedContinuation { finish = $0 }
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { finish != nil }
        #expect(!store.hasLoaded)
        #expect(store.analysis.totals.count == 0)
        store.refreshIfNeeded(refreshStaleContent: true)
        finish?.resume(
            returning: .init(
                page: [ReportModelTests.entry("older", date: "2025-01-02")], continueCursor: "",
                isDone: true))
        await waitUntil { store.hasLoaded }
        #expect(requests.map(\.cursor) == [nil, "older"])
        #expect(store.months.first?.id == "2025-01-01")
        store.apply(period: .previousYear)
        #expect(store.analysis.totals.outflow == 1000)
        store.inflowGrouping = .groups
        store.outflowGrouping = .merchants
        #expect(store.inflowGrouping == .groups)
        #expect(store.outflowGrouping == .merchants)
        let scope = ReportDrilldown(title: "Ungrouped", groupID: "ungrouped", kind: .spending)
        let request = try #require(store.request(for: scope))
        #expect(try await store.summary(for: request).totals.outflow == 1000)
        let page = try await store.page(.init(report: request, cursor: nil, search: "shop"))
        #expect(page.page.map(\.id) == ["older"])
        #expect(requests.count == 2)
        store.reset()
    }

    @Test func tappingSelectsAMonthAndHoldingExtendsEitherDirectionFromTheAnchor() async {
        var requests = 0
        let store = ReportsStore(
            now: { Self.now },
            historyLoader: { _ in
                requests += 1
                return .init(
                    page: [
                        ReportModelTests.entry("old", date: "2026-01-01"), ReportModelTests.entry(),
                    ], continueCursor: "", isDone: true)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.hasLoaded }
        store.selectMonth("2026-08-01")
        #expect(store.range == .init(start: "2026-08-01", end: "2026-08-31"))
        #expect(store.analysis.totals.count == 0)
        store.selectMonth("2026-06-01", extending: true)
        #expect(store.range == .init(start: "2026-06-01", end: "2026-08-31"))
        store.selectMonth("2026-09-01", extending: true)
        #expect(store.range == .init(start: "2026-08-01", end: "2026-09-23"))
        store.selectMonth("2026-02-01")
        #expect(store.selectionAnchor == "2026-02-01")
        #expect(store.range.end == "2026-02-28")
        store.apply(period: .lastSixMonths)
        #expect(store.selectionAnchor == nil)
        #expect(store.range.start == "2026-04-01")
        #expect(requests == 1)
        store.reset()
    }

    @Test func repeatedMonthSelectionsInvalidateBothBarStylesWithoutReloadingHistory() async {
        var requests = 0
        let store = ReportsStore(
            now: { Self.now },
            historyLoader: { _ in
                requests += 1
                return .init(
                    page: [
                        ReportModelTests.entry("old", date: "2026-01-01"), ReportModelTests.entry(),
                    ], continueCursor: "", isDone: true)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.hasLoaded }
        let selections = [8, 6, 9, 2, 8, 3, 6, 9, 1, 8]
        for month in selections {
            let before = store.chartMonths
            let selectedMonth = String(format: "2026-%02d-01", month)
            store.selectMonth(selectedMonth)
            let after = store.chartMonths
            #expect(after.filter(\.isSelected).map(\.bucket.id) == [selectedMonth])
            for (old, new) in zip(before, after) where old.isSelected != new.isSelected {
                #expect(old.id != new.id)
            }
        }
        store.selectMonth("2026-06-01", extending: true)
        #expect(
            store.chartMonths.filter(\.isSelected).map(\.bucket.id)
                == ["2026-06-01", "2026-07-01", "2026-08-01"])
        store.apply(period: .lastThreeMonths)
        #expect(
            store.chartMonths.filter(\.isSelected).map(\.bucket.id)
                == ["2026-07-01", "2026-08-01", "2026-09-01"])
        store.apply(period: .month)
        store.selectMonth("2026-07-01", extending: true)
        #expect(
            store.chartMonths.filter(\.isSelected).map(\.bucket.id)
                == ["2026-07-01", "2026-08-01", "2026-09-01"])
        store.inflowGrouping = .groups
        store.outflowGrouping = .merchants
        #expect(store.detail == nil)
        #expect(requests == 1)
        store.reset()
    }

    @Test func sparsePagesContinueAndDuplicateEntriesAreNotCountedTwice() async {
        let store = ReportsStore(
            now: { Self.now },
            historyLoader: { request in
                switch request.cursor {
                case nil: return .init(page: [], continueCursor: "one", isDone: false)
                case "one":
                    return .init(
                        page: [ReportModelTests.entry()], continueCursor: "two", isDone: false)
                default:
                    return .init(page: [ReportModelTests.entry()], continueCursor: "", isDone: true)
                }
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(store.analysis.totals.count == 1)
        #expect(store.analysis.totals.outflow == 1000)
        store.reset()
    }

    @Test func repeatedCursorsFailWithoutPublishingPartialTotals() async {
        let store = ReportsStore(
            now: { Self.now },
            historyLoader: { _ in
                .init(page: [ReportModelTests.entry()], continueCursor: "same", isDone: false)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.errorMessage != nil }
        #expect(!store.hasLoaded)
        #expect(store.analysis.totals.count == 0)
        store.reset()
    }

    @Test func staleRefreshRetainsContentAndRetryReplacesItAtomically() async {
        var now = Self.now
        var requests = 0
        let store = ReportsStore(
            now: { now },
            historyLoader: { _ in
                requests += 1
                if requests == 2 { throw Failure.failed }
                return .init(
                    page: [ReportModelTests.entry(amounts: [("food", Decimal(-1000 * requests))])],
                    continueCursor: "", isDone: true)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.hasLoaded }
        now = now.addingTimeInterval(61)
        store.stop()
        store.start()
        #expect(store.hasLoaded)
        await waitUntil { store.errorMessage != nil }
        #expect(store.analysis.totals.outflow == 1000)
        await store.refresh()
        #expect(store.analysis.totals.outflow == 3000)
        #expect(store.errorMessage == nil)
        store.reset()
    }

    @Test func freshNavigationAndSelectionsReuseHistoryButForegroundRefreshesStaleData() async {
        var now = Self.now
        var requests = 0
        let store = ReportsStore(
            now: { now },
            historyLoader: { _ in
                requests += 1
                return .init(page: [], continueCursor: "", isDone: true)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.hasLoaded }
        store.stop()
        store.start()
        store.refreshIfNeeded(refreshStaleContent: true)
        #expect(!store.isLoading)
        #expect(requests == 1)
        now = now.addingTimeInterval(61)
        store.refreshIfNeeded()
        #expect(requests == 1)
        store.refreshIfNeeded(refreshStaleContent: true)
        await waitUntil { !store.isLoading }
        #expect(requests == 2)
        store.reset()
    }

    @Test func stoppedOrChangedWorkspaceRejectsLatePages() async {
        var finish: CheckedContinuation<ReportPage, Never>?
        let store = ReportsStore(
            now: { Self.now },
            historyLoader: { request in
                if request.workspaceID == "personal" {
                    return await withCheckedContinuation { finish = $0 }
                }
                return .init(
                    page: [ReportModelTests.entry("other", amounts: [("food", -5000)])],
                    continueCursor: "", isDone: true)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { finish != nil }
        store.prepare(.init(id: "other", currencyCode: "JPY", minorUnit: 0, timezone: "UTC"))
        #expect(!store.hasLoaded)
        #expect(store.analysis.totals.count == 0)
        finish?.resume(
            returning: .init(page: [ReportModelTests.entry()], continueCursor: "", isDone: true))
        await waitUntil { store.hasLoaded }
        #expect(store.analysis.totals.outflow == 5000)
        store.reset()
        #expect(store.context == nil)
        #expect(store.months.isEmpty)
    }

    @Test func dayRolloverAdvancesCurrentMonthWithoutChangingHistoricalSelection() async {
        var now = Self.now
        let store = ReportsStore(
            now: { now },
            historyLoader: { _ in
                .init(page: [], continueCursor: "", isDone: true)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.hasLoaded }
        now = now.addingTimeInterval(86400)
        store.refreshIfNeeded()
        await waitUntil { !store.isLoading }
        #expect(store.range.end == "2026-09-24")
        store.apply(period: .custom, custom: .init(start: "2024-02-15", end: "2024-03-10"))
        #expect(store.range == .init(start: "2024-02-01", end: "2024-03-31"))
        now = now.addingTimeInterval(86400)
        store.refreshIfNeeded()
        #expect(store.range.end == "2024-03-31")
        store.reset()
    }

    @Test func detailPaginationAndSearchUseTheSameLocalDirectionAndGroupScope() async {
        let store = ReportsStore(
            now: { Self.now },
            historyLoader: { _ in
                .init(
                    page: (0..<123).map { ReportModelTests.entry("\($0)") }, continueCursor: "",
                    isDone: true)
            })
        store.prepare(Self.context)
        store.start()
        await waitUntil { store.hasLoaded }
        let detail = ReportDetailStore(
            store: store, scope: .init(title: "Ungrouped", groupID: "ungrouped", kind: .spending))
        await detail.loadSummary()
        #expect(detail.analysis?.totals.outflow == 123000)
        await detail.search("")
        #expect(detail.entries.count == 50)
        await detail.loadMore()
        await detail.loadMore()
        #expect(detail.entries.count == 123)
        #expect(detail.isDone)
        await detail.search("missing")
        #expect(detail.entries.isEmpty)
        #expect(detail.isDone)
        store.reset()
    }
}

#if canImport(UIKit)
    @MainActor
    struct ReportChartInteractionTests {
        @Test func holdingOwnsTheTouchButOrdinarySwipesCanScrollHistory() throws {
            let coordinator = ReportChartInteractionView.Coordinator(
                plotFrame: CGRect(x: 0, y: 0, width: 300, height: 200), onChanged: { _, _ in })
            let view = coordinator.makeView()
            let recognizers = try #require(view.gestureRecognizers)
            let hold = try #require(
                recognizers.compactMap { $0 as? UILongPressGestureRecognizer }.first)
            let tap = try #require(recognizers.compactMap { $0 as? UITapGestureRecognizer }.first)
            #expect(!recognizers.contains { $0 is UIPanGestureRecognizer })
            let scroll = UIScrollView()
            #expect(
                coordinator.gestureRecognizer(
                    hold, shouldBeRequiredToFailBy: scroll.panGestureRecognizer))
            #expect(
                !coordinator.gestureRecognizer(
                    tap, shouldBeRequiredToFailBy: scroll.panGestureRecognizer))
            #expect(
                !coordinator.gestureRecognizer(
                    hold, shouldRecognizeSimultaneouslyWith: scroll.panGestureRecognizer))
            #expect(hold.minimumPressDuration == 0.35)
        }
    }
#endif

#if canImport(ConvexMobile)
    import ConvexMobile

    struct ReportHistoryTransportTests {
        @Test func allHistoryArgumentsEncodePageSizeAsANumberAndKeepNullableCursors() throws {
            struct Arguments: Decodable {
                struct Pagination: Decodable {
                    let numItems: Double
                    let cursor: String?
                }
                let workspaceId: String
                let paginationOpts: Pagination
            }
            for cursor in [String?.none, "next"] {
                let request = ReportHistoryRequest(workspaceID: "personal", cursor: cursor)
                let encoded = try request.arguments.convexEncode()
                let decoded = try JSONDecoder().decode(Arguments.self, from: Data(encoded.utf8))
                #expect(decoded.workspaceId == "personal")
                #expect(decoded.paginationOpts.numItems == 200)
                #expect(decoded.paginationOpts.cursor == cursor)
                #expect(!encoded.contains("startDate"))
                #expect(!encoded.contains("endDate"))
            }
        }
    }
#endif
