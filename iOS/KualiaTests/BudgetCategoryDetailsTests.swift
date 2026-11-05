import Foundation
import Testing

@testable import Kualia

struct BudgetCategoryDetailsTests {
    @Test func historyEndsTodayInTheWorkspaceTimezoneAndIncludesTwelveCalendarMonths() throws {
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "America/New_York")
        let now = try #require(ISO8601DateFormatter().date(from: "2027-01-01T02:00:00Z"))
        let filters = BudgetCategoryMonth.historyFilters(
            categoryID: "groceries", workspace: workspace, now: now)
        #expect(filters.categoryID == "groceries")
        #expect(filters.startDate == "2026-01-01")
        #expect(filters.endDate == "2026-12-31")
        let september = try #require(ISO8601DateFormatter().date(from: "2026-09-09T01:00:00Z"))
        let current = BudgetCategoryMonth.historyFilters(
            categoryID: "groceries", workspace: workspace, now: september)
        #expect(current.startDate == "2025-10-01")
        #expect(current.endDate == "2026-09-08")
    }

    @Test func monthlyChartKeepsTwelveSlotsAndNewHistoryAtTheRightEdge() {
        let months = BudgetCategorySpendingMonth.window(
            ending: 202606,
            values: [.init(id: 202605, spent: 200), .init(id: 202606, spent: 11824)])
        #expect(months.count == 12)
        #expect(months.first?.id == 202507)
        #expect(months.last?.id == 202606)
        #expect(months.prefix(10).allSatisfy { $0.spent == 0 })
        #expect(months[10].spent == 200 && months[11].spent == 11824)
        #expect(
            months.map { $0.initial(locale: Locale(identifier: "en_US")) }
                == ["J", "A", "S", "O", "N", "D", "J", "F", "M", "A", "M", "J"])
    }

    @Test func sharedChartUsesCompleteBudgetMonthSpendingAndPreservesExactHistory() throws {
        let exact = try #require(Decimal(string: "9007199254740993"))
        let months = BudgetCategorySpendingMonth.window(
            ending: 202601,
            values: [.init(id: 202512, spent: exact), .init(id: 202601, spent: 100)])
        let points = BudgetCategorySpendingMonth.chartPoints(
            months, selectedMonth: 202601, selectedMonthSpent: 250)

        #expect(points.count == 12)
        #expect(points.first?.yearMonth == "2025-02")
        #expect(points.last?.yearMonth == "2026-01")
        #expect(points.last?.date == BudgetMonth.date(202601))
        #expect(points.last?.balance == 250)
        #expect(points[10].balance == exact)
        #expect(points.prefix(10).allSatisfy { $0.balance == 0 })
        let selected = try #require(AccountBalancePoint.selected(in: points, month: "2025-12"))
        #expect(selected.balance == exact)
        #expect(selected.toggledSelection(from: "2025-12") == nil)
        #expect(selected.toggledSelection(from: nil) == "2025-12")
    }

    @Test func budgetMonthsOutsideHistoryDoNotReplaceTheLatestSpendingBar() {
        let months: [BudgetCategorySpendingMonth] = [
            .init(id: 202512, spent: 300), .init(id: 202601, spent: 400),
        ]
        for budgetMonth in [202401, 202602] {
            let points = BudgetCategorySpendingMonth.chartPoints(
                months, selectedMonth: budgetMonth, selectedMonthSpent: 900)
            #expect(points.map(\.balance) == [300, 400])
            #expect(points.map(\.id) == ["2025-12", "2026-01"])
        }
    }

    @Test @MainActor func historyRefreshKeepsExistingBarsAndRetainsThemOnFailure() async throws {
        var pending: CheckedContinuation<[BudgetCategorySpendingMonth], Error>?
        var refresh = false
        let store = BudgetCategoryHistoryStore(month: 202606) {
            if refresh { return try await withCheckedThrowingContinuation { pending = $0 } }
            return [.init(id: 202606, spent: 11824)]
        }
        await store.refresh()
        refresh = true
        let update = Task { await store.refresh() }
        for _ in 0..<500 {
            if pending != nil { break }
            await Task.yield()
        }
        #expect(store.isLoading)
        #expect(store.months?.last?.spent == 11824)
        try #require(pending).resume(throwing: URLError(.notConnectedToInternet))
        await update.value
        #expect(store.months?.last?.spent == 11824)
        #expect(store.errorMessage != nil)
        #expect(!store.isLoading)
    }

    @Test func monthLabelsIncludeTheYearOnlyOutsideTheCurrentYear() {
        let locale = Locale(identifier: "en_US")
        #expect(BudgetCategoryMonth.title(202606, currentMonth: 202609, locale: locale) == "June")
        #expect(
            BudgetCategoryMonth.title(202506, currentMonth: 202609, locale: locale) == "June 2025")
        #expect(
            BudgetCategoryMonth.title(202701, currentMonth: 202612, locale: locale)
                == "January 2027")
        #expect(
            BudgetCategoryMonth.title(
                202606, currentMonth: 202609, locale: Locale(identifier: "fr_FR"))
                == "juin")
    }

    @Test func fundingUsesMonthlyRequirementRatherThanFullSavingsGoalOrAvailableBalance() throws {
        let target = BudgetCategoryTarget(
            targetAmount: 120_000, assignmentNeeded: 10_000, remainingToAssign: 4_000)
        let summary = try #require(target.fundingSummary(assigned: 6_000))
        #expect(summary == .init(funded: 6_000, remaining: 4_000, total: 10_000))
        #expect(summary.percentage == 60)
        #expect(
            target.fundingSummary(assigned: 6_000, assignmentDelta: 5_000)
                == .init(funded: 10_000, remaining: 0, total: 10_000))
    }

    @Test func fundingHandlesOverfundingAndNegativeAssignmentsWithoutInventingProgress() {
        let target = BudgetCategoryTarget(
            targetAmount: 10_000, assignmentNeeded: 10_000, remainingToAssign: 0)
        #expect(target.fundingSummary(assigned: 12_000, assignmentDelta: -1_000)?.remaining == 0)
        #expect(
            target.fundingSummary(assigned: 12_000, assignmentDelta: -3_000)?.remaining == 1_000)
        let negative = BudgetCategoryTarget(
            targetAmount: 10_000, assignmentNeeded: 10_000, remainingToAssign: 12_000)
        #expect(negative.fundingSummary(assigned: -2_000)?.funded == -2_000)
        #expect(negative.fundingSummary(assigned: -2_000)?.progress == 0)
    }

    @Test func fundingDistinguishesZeroNeedMissingAndSnoozedTargets() {
        #expect(BudgetCategoryTarget().fundingSummary(assigned: 0) == nil)
        #expect(BudgetCategoryTarget(targetAmount: 10_000).fundingSummary(assigned: 0) == nil)
        #expect(
            BudgetCategoryTarget(
                targetAmount: 10_000, isSnoozed: true,
                assignmentNeeded: 0, remainingToAssign: 0
            ).fundingSummary(assigned: 0) == nil)
        #expect(
            BudgetCategoryTarget(
                targetAmount: 10_000,
                assignmentNeeded: 0, remainingToAssign: 0
            ).fundingSummary(assigned: 0)
                == .init(funded: 0, remaining: 0, total: 0))
    }

    @Test func usesWholeSelectedMonthIncludingLeapDaysAndYearBoundaries() {
        for (month, start, end) in [
            (202402, "2024-02-01", "2024-02-29"),
            (202502, "2025-02-01", "2025-02-28"),
            (202612, "2026-12-01", "2026-12-31"),
            (202701, "2027-01-01", "2027-01-31"),
        ] {
            let filters = BudgetCategoryMonth.filters(categoryID: "category", month: month)
            #expect(filters.categoryID == "category")
            #expect(filters.startDate == start && filters.endDate == end)
            #expect(filters.flow == nil && filters.status == nil && filters.accountID == nil)
        }
    }

    @Test func chartUsesOnlyCategoryPortionsAndKeepsRefundsSeparate() throws {
        let split = item("split", day: "01", amount: "-1000", outflow: "1500", inflow: "500")
        let refund = item("refund", day: "03", amount: "200", outflow: "0", inflow: "200")
        let summary = try #require(
            BudgetCategorySpending(items: [split, refund, split], month: 202609, isComplete: true))
        #expect(summary.spent == 1500 && summary.received == 700)
        #expect(summary.transactionCount == 2)
        #expect(summary.days.count == 30)
        #expect(summary.days[0].spent == 1500)
        #expect(summary.days.dropFirst().allSatisfy { $0.spent == 0 })
    }

    @Test func doesNotShowPartialOrMissingCategoryAmountsAsCompleteSpending() {
        let split = item("split", day: "01", amount: "-500", outflow: "500", inflow: "0")
        #expect(BudgetCategorySpending(items: [split], month: 202609, isComplete: false) == nil)
        var legacy = split
        legacy.categoryActivity = nil
        #expect(BudgetCategorySpending(items: [legacy], month: 202609, isComplete: true) == nil)
        #expect(BudgetCategorySpending(items: [split], month: 202608, isComplete: true) == nil)
    }

    @Test func emptyMonthsHaveAZeroBaselineAndExactLargeAmountsRemainExact() throws {
        let empty = try #require(BudgetCategorySpending(items: [], month: 202402, isComplete: true))
        #expect(empty.days.count == 29 && empty.spent == 0 && empty.transactionCount == 0)
        let large = item(
            "large", day: "01", amount: "-9007199254740993", outflow: "9007199254740993",
            inflow: "0")
        let summary = try #require(
            BudgetCategorySpending(items: [large], month: 202609, isComplete: true))
        #expect(summary.spent == Decimal(string: "9007199254740993"))
    }

    @Test func categoryActivityDecodesFromTheFeedWireFormat() throws {
        let json = #"{"amount":"-1250","outflow":"1500","inflow":"250"}"#
        let activity = try JSONDecoder().decode(BudgetCategoryActivity.self, from: Data(json.utf8))
        #expect(activity.value == -1250 && activity.spent == 1500 && activity.received == 250)
    }

    @Test func feedDecodesCategoryActivityAndRemainsCompatibleWhenItIsAbsent() throws {
        let json =
            #"{"id":"row","date":"2026-09-01","type":"regular","status":"cleared","reviewStatus":"reviewed","amount":{"$integer":"iBMAAAAAAAA="},"categoryNames":["Groceries"],"hasUncategorized":false,"hasMissingPayee":false}"#
        let legacy = try JSONDecoder().decode(TransactionFeedItem.self, from: Data(json.utf8))
        #expect(legacy.categoryActivity == nil && legacy.amount == 5000)
        let withActivity =
            String(json.dropLast())
            + #", "categoryActivity":{"amount":"1500","outflow":"0","inflow":"1500"}}"#
        let scoped = try JSONDecoder().decode(
            TransactionFeedItem.self, from: Data(withActivity.utf8))
        #expect(scoped.categoryActivity?.value == 1500 && scoped.amount == 5000)
    }

    private func item(_ id: String, day: String, amount: String, outflow: String, inflow: String)
        -> TransactionFeedItem
    {
        var item = TransactionFeedItem(
            id: id, date: "2026-09-\(day)", type: .regular, amount: -99_999)
        item.categoryActivity = .init(amount: amount, outflow: outflow, inflow: inflow)
        return item
    }
}
