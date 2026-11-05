#if DEBUG
    import Foundation
    import Testing

    @testable import Kualia

    struct ScreenshotDemoReportTests {
        private let range = ReportRange(start: "2026-09-01", end: "2026-09-30")
        private let previous = ReportRange(start: "2026-08-01", end: "2026-08-30")

        private func entry(
            _ id: String, date: String = "2026-09-05", account: String = "checking",
            merchant: String = "Netflix", status: String = "cleared", review: String = "reviewed",
            movements: [ReportMovement]
        ) -> ReportEntry {
            .init(
                id: id, date: date, accountId: account, accountName: account, merchantId: merchant,
                merchantName: merchant, merchantLogoUrl: nil, status: status, reviewStatus: review,
                notes: nil, movements: movements)
        }
        private func movement(_ category: String, _ amount: Decimal) -> ReportMovement {
            .init(categoryId: category, categoryName: category, amount: amount)
        }
        private func provider(_ records: [ReportEntry]) -> ScreenshotDemoReports {
            .init(workspaceID: "demo", records: records, accounts: [], categories: [])
        }
        private func request(
            _ kind: ReportKind = .spending, filters: ReportFilters = .init(),
            scope: ReportDrilldown? = nil
        ) -> ReportSummaryRequest {
            .init(
                workspaceID: "demo", range: range, comparison: previous, kind: kind,
                filters: filters, scope: scope)
        }

        @Test func reportsReconcileSpendingIncomeCashFlowAndComparison() {
            let source = provider([
                entry("expense", movements: [movement("Subscriptions", -1800)]),
                entry("income", merchant: "Payroll", movements: [movement("Income", 325000)]),
                entry("pending", status: "pending", movements: [movement("Groceries", -5000)]),
                entry(
                    "previous", date: "2026-08-05", movements: [movement("Subscriptions", -1500)]),
            ])
            let spending = source.report(request())
            #expect(spending.totals.outflow == 1800)
            #expect(spending.previous.outflow == 1500)
            #expect(
                spending.buckets.reduce(Decimal.zero) { $0 + $1.totals.outflow }
                    == spending.totals.outflow)
            #expect(
                spending.categories.reduce(Decimal.zero) { $0 + $1.amount }
                    == spending.totals.outflow)
            #expect(source.report(request(.moneyIn)).totals.inflow == 325000)
            #expect(source.report(request(.cashFlow)).totals.net == 323200)
            #expect(
                source.report(request(filters: .init(includesPending: true))).totals.outflow == 6800
            )
        }

        @Test func splitCategoriesAndFilteredDrilldownsCountOnlyMatchingMovements() {
            let source = provider([
                entry(
                    "split", movements: [movement("Groceries", -4000), movement("Shopping", -2000)]),
                entry(
                    "different-account", account: "card", merchant: "Walmart",
                    movements: [movement("Groceries", -7000)]),
            ])
            let result = source.report(request())
            #expect(result.categories.first { $0.id == "Groceries" }?.amount == 11000)
            #expect(result.categories.first { $0.id == "Shopping" }?.amount == 2000)
            #expect(result.categories.reduce(Decimal.zero) { $0 + $1.amount } == 13000)
            let scoped = request(
                filters: .init(accountIDs: ["checking"]),
                scope: .init(title: "Groceries", categoryID: "Groceries"))
            #expect(source.report(scoped).totals.outflow == 4000)
            let page = source.reportPage(.init(report: scoped, cursor: nil, search: "netFLIX"))
            #expect(page.page.map(\.id) == ["split"])
            #expect(scoped.matching(page.page[0]).amount == -4000)
        }

        @Test func merchantReviewAndDateFiltersMatchSummaryAndDetail() {
            let source = provider([
                entry(
                    "match", review: "needs_review", movements: [movement("Subscriptions", -1800)]),
                entry("reviewed", movements: [movement("Subscriptions", -1000)]),
                entry(
                    "other-merchant", merchant: "Spotify", review: "needs_review",
                    movements: [movement("Subscriptions", -1200)]),
                entry(
                    "outside", date: "2026-10-01", review: "needs_review",
                    movements: [movement("Subscriptions", -1800)]),
            ])
            let scoped = request(
                filters: .init(reviewStatus: "needs_review"),
                scope: .init(title: "Netflix", merchantID: "Netflix"))
            #expect(source.report(scoped).totals.outflow == 1800)
            #expect(
                source.reportPage(.init(report: scoped, cursor: nil, search: "")).page.map(\.id)
                    == ["match"])
        }

        @Test func paginationIsStableAndForeignWorkspacesStayEmpty() {
            let source = provider(
                (0..<123).map { entry("\($0)", movements: [movement("Shopping", -100)]) })
            var cursor: String?
            var ids: [String] = []
            for _ in 0..<3 {
                let page = source.reportPage(.init(report: request(), cursor: cursor, search: ""))
                ids += page.page.map(\.id)
                cursor = page.continueCursor
            }
            #expect(ids.count == 123)
            #expect(Set(ids).count == 123)
            #expect(source.reportPage(.init(report: request(), cursor: cursor, search: "")).isDone)
            let foreign = ReportSummaryRequest(
                workspaceID: "real-workspace", range: range, comparison: previous, kind: .spending,
                filters: .init())
            #expect(source.report(foreign).totals.count == 0)
            #expect(source.reportPage(.init(report: foreign, cursor: nil, search: "")).page.isEmpty)
        }
    }
#endif
