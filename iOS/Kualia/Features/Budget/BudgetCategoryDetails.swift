import Foundation
import Observation

struct BudgetCategoryActivity: Decodable, Equatable {
    let amount: String
    let outflow: String
    let inflow: String

    var value: Decimal? { Self.decimal(amount) }
    var spent: Decimal? { Self.decimal(outflow) }
    var received: Decimal? { Self.decimal(inflow) }

    private static func decimal(_ value: String) -> Decimal? {
        Decimal(string: value, locale: Locale(identifier: "en_US_POSIX"))
    }
}

enum BudgetCategoryMonth {
    static func historyFilters(
        categoryID: String, workspace: TransactionFeedWorkspace, now: Date = Date()
    ) -> TransactionSearchFilters {
        let month = BudgetMonth.current(now: now, timezoneIdentifier: workspace.timezoneIdentifier)
        return .init(
            categoryID: categoryID,
            startDate: filters(categoryID: categoryID, month: BudgetMonth.offset(month, by: -11))
                .startDate,
            endDate: TransactionEditorDate.today(workspace: workspace, now: now))
    }

    static func title(_ month: Int, currentMonth: Int, locale: Locale = L10n.locale) -> String {
        month / 100 == currentMonth / 100
            ? BudgetMonth.navigationTitle(month, currentMonth: currentMonth, locale: locale)
            : BudgetMonth.title(month, locale: locale)
    }

    static func dayCount(_ month: Int) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar.range(of: .day, in: .month, for: BudgetMonth.date(month))?.count ?? 30
    }

    static func filters(categoryID: String, month: Int) -> TransactionSearchFilters {
        let prefix = String(format: "%04d-%02d", month / 100, month % 100)
        return .init(
            categoryID: categoryID, startDate: "\(prefix)-01",
            endDate: "\(prefix)-\(dayCount(month))")
    }
}

struct BudgetCategorySpending {
    struct Day: Identifiable {
        let id: Int
        var spent: Decimal = 0
    }
    let days: [Day]
    let spent: Decimal
    let received: Decimal
    let transactionCount: Int

    /// Never substitute whole-transaction amounts when an older backend has not
    /// supplied split-category activity. Never present a partial scan as a total.
    init?(items: [TransactionFeedItem], month: Int, isComplete: Bool) {
        guard isComplete else { return nil }
        var days = (1...BudgetCategoryMonth.dayCount(month)).map { Day(id: $0) }
        var spent: Decimal = 0
        var received: Decimal = 0
        var seen = Set<String>()
        let range = BudgetCategoryMonth.filters(categoryID: "", month: month)
        for item in items where seen.insert(item.id).inserted {
            guard item.date >= (range.startDate ?? ""), item.date <= (range.endDate ?? ""),
                let day = Int(item.date.suffix(2)), days.indices.contains(day - 1),
                let outflow = item.categoryActivity?.spent,
                let inflow = item.categoryActivity?.received, outflow >= 0, inflow >= 0
            else { return nil }
            days[day - 1].spent += outflow
            spent += outflow
            received += inflow
        }
        self.days = days
        self.spent = spent
        self.received = received
        transactionCount = seen.count
    }
}

struct BudgetCategoryDetailsDestination: Identifiable {
    let id = UUID()
    let workspace: BudgetWorkspace
    let categoryID: String
    let month: Int
    let transactions: TransactionSearchStore
    let history: BudgetCategoryHistoryStore
}

struct BudgetCategorySpendingMonth: Identifiable, Equatable {
    let id: Int
    var spent: Decimal = 0

    static func chartPoints(
        _ months: [Self], selectedMonth: Int, selectedMonthSpent: Decimal
    ) -> [AccountBalancePoint] {
        months.map { month in
            AccountBalancePoint(
                yearMonth: String(format: "%04d-%02d", month.id / 100, month.id % 100),
                date: BudgetMonth.date(month.id),
                // Keep the selected budget month's bar in sync with its complete transaction total.
                balance: month.id == selectedMonth ? selectedMonthSpent : month.spent)
        }
    }

    func initial(locale: Locale) -> String {
        let format = Date.FormatStyle(locale: locale, timeZone: .gmt).month(.wide)
        return String(format.format(BudgetMonth.date(id)).prefix(1))
    }

    static func window(ending month: Int, values: [Self] = []) -> [Self] {
        (-11...0).map { offset in
            let id = BudgetMonth.offset(month, by: offset)
            return values.first { $0.id == id } ?? .init(id: id)
        }
    }
}

@MainActor
@Observable
final class BudgetCategoryHistoryStore {
    let month: Int
    private(set) var months: [BudgetCategorySpendingMonth]?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    @ObservationIgnored private let loader: () async throws -> [BudgetCategorySpendingMonth]
    @ObservationIgnored private var generation = UUID()

    init(month: Int, loader: @escaping () async throws -> [BudgetCategorySpendingMonth]) {
        self.month = month
        self.loader = loader
    }

    func refresh() async {
        let request = UUID()
        generation = request
        isLoading = true
        errorMessage = nil
        do {
            let values = try await loader()
            guard generation == request, !Task.isCancelled else { return }
            months = BudgetCategorySpendingMonth.window(ending: month, values: values)
        } catch {
            guard generation == request, !Task.isCancelled else { return }
            errorMessage = L10n.string("Couldn't refresh spending. Please try again.")
        }
        isLoading = false
    }

    func stop() {
        generation = UUID()
        isLoading = false
    }
}
