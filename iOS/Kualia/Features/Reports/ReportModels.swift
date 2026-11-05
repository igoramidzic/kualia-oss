import CoreGraphics
import Foundation

nonisolated enum ReportKind: String, CaseIterable, Identifiable {
    case spending, moneyIn, cashFlow
    var id: Self { self }
    var title: String {
        switch self {
        case .spending: L10n.string("Spending")
        case .moneyIn: L10n.string("Money in")
        case .cashFlow: L10n.string("Cash flow")
        }
    }
}

nonisolated enum ReportPeriod: String, CaseIterable, Identifiable {
    case month, lastThreeMonths, lastSixMonths, lastYear, previousYear, custom
    var id: Self { self }
    var title: String {
        switch self {
        case .month: L10n.string("This month")
        case .lastThreeMonths: L10n.string("Last 3 months")
        case .lastSixMonths: L10n.string("Last 6 months")
        case .lastYear: L10n.string("Last year")
        case .previousYear: L10n.string("Previous year")
        case .custom: L10n.string("Custom")
        }
    }
}

nonisolated enum ReportComparison: String, CaseIterable, Identifiable {
    case previous, lastYear
    var id: Self { self }
    var title: String {
        self == .previous ? L10n.string("Previous period") : L10n.string("A year earlier")
    }
}

nonisolated enum ReportGrouping: String, CaseIterable, Identifiable {
    case categories, merchants, groups
    var id: Self { self }
    var title: String {
        switch self {
        case .categories: L10n.string("Categories")
        case .merchants: L10n.string("Merchants")
        case .groups: L10n.string("Groups")
        }
    }
}

nonisolated struct ReportRange: Decodable, Equatable, Hashable {
    let start: String
    let end: String
    var dayCount: Int {
        ReportDates.calendar.dateComponents(
            [.day], from: ReportDates.date(start), to: ReportDates.date(end)
        ).day! + 1
    }
    func contains(_ date: String) -> Bool { date >= start && date <= end }
    var monthLabel: String {
        let first = ReportDates.monthLabel(start)
        let last = ReportDates.monthLabel(end)
        return ReportDates.monthStart(start) == ReportDates.monthStart(end)
            ? first : "\(first) – \(last)"
    }
    func compactMonthLabel(locale: Locale = L10n.locale) -> String {
        let first = ReportDates.date(start)
        let last = ReportDates.date(end)
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = ReportDates.calendar
        formatter.timeZone = .gmt
        // Only complete calendar years collapse; a partial December still shows months.
        if start.hasSuffix("-01-01"), end.hasSuffix("-12-31") {
            formatter.setLocalizedDateFormatFromTemplate("yyyy")
            let firstYear = formatter.string(from: first)
            let lastYear = formatter.string(from: last)
            return firstYear == lastYear ? firstYear : "\(firstYear)–\(lastYear)"
        }
        formatter.setLocalizedDateFormatFromTemplate("MMMyy")
        if locale.language.languageCode?.identifier == "en" {
            formatter.dateFormat = "MMM ’yy"
        }
        let firstMonth = formatter.string(from: first)
        let lastMonth = formatter.string(from: last)
        return ReportDates.monthStart(start) == ReportDates.monthStart(end)
            ? firstMonth : "\(firstMonth)–\(lastMonth)"
    }
    var label: String {
        let first = ReportDates.date(start).formatted(
            Date.FormatStyle(
                date: .abbreviated, time: .omitted, locale: L10n.locale, timeZone: .gmt))
        let last = ReportDates.date(end).formatted(
            Date.FormatStyle(
                date: .abbreviated, time: .omitted, locale: L10n.locale, timeZone: .gmt))
        return start == end ? first : "\(first) – \(last)"
    }
    func comparison(_ mode: ReportComparison) -> Self {
        let first = ReportDates.date(start)
        let comparisonStart =
            mode == .previous
            ? ReportDates.add(.day, -dayCount, to: first)
            : ReportDates.add(.year, -1, to: first)
        return .init(
            start: ReportDates.key(comparisonStart),
            end: ReportDates.key(ReportDates.add(.day, dayCount - 1, to: comparisonStart)))
    }
}

/// A third tap starts a new range. Endpoints may be selected in either order.
nonisolated struct ReportMonthSelection {
    private(set) var range: ReportRange
    private(set) var isComplete = true
    private var anchor: String?

    init(range: ReportRange) { self.range = range }

    mutating func select(_ month: String, today: String) {
        if let anchor, !isComplete {
            range = ReportDates.monthRange(from: anchor, through: month, today: today)
            isComplete = true
        } else {
            anchor = ReportDates.monthStart(month)
            range = ReportDates.monthRange(from: month, through: month, today: today)
            isComplete = false
        }
    }
}

nonisolated enum ReportDates {
    static var calendar: Calendar {
        var result = Calendar(identifier: .gregorian)
        result.timeZone = .gmt
        return result
    }
    static func date(_ key: String) -> Date {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return .distantPast }
        return calendar.date(from: .init(year: parts[0], month: parts[1], day: parts[2]))
            ?? .distantPast
    }
    static func key(_ date: Date, timezone: String? = nil) -> String {
        var cal = calendar
        cal.timeZone = timezone.flatMap(TimeZone.init(identifier:)) ?? .gmt
        let components = cal.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
    }
    static func add(_ component: Calendar.Component, _ value: Int, to date: Date) -> Date {
        calendar.date(byAdding: component, value: value, to: date)!
    }
    static func range(_ period: ReportPeriod, now: Date, timezone: String?, custom: ReportRange?)
        -> ReportRange
    {
        let today = date(key(now, timezone: timezone))
        let month = calendar.dateInterval(of: .month, for: today)!.start
        let start: Date
        let end: Date
        switch period {
        case .month:
            start = month
            end = today
        case .lastThreeMonths, .lastSixMonths, .lastYear:
            let months = period == .lastThreeMonths ? 3 : period == .lastSixMonths ? 6 : 12
            start = add(.month, 1 - months, to: month)
            end = today
        case .previousYear:
            let year = calendar.dateInterval(of: .year, for: today)!.start
            start = add(.year, -1, to: year)
            end = add(.day, -1, to: year)
        case .custom:
            if let custom { return custom }
            start = month
            end = today
        }
        return .init(start: key(start), end: key(end))
    }
}

nonisolated struct ReportMovement: Decodable, Equatable {
    let categoryId: String
    let categoryName: String
    let amount: Decimal
    let groupId: String?
    let groupName: String?
    var resolvedGroupID: String {
        groupId ?? (categoryId == "ready-to-assign" ? "ready-to-assign" : "ungrouped")
    }
    var resolvedGroupName: String {
        switch resolvedGroupID {
        case "ready-to-assign": L10n.string("Ready to assign")
        case "ungrouped": L10n.string("Ungrouped")
        default: groupName ?? L10n.string("Ungrouped")
        }
    }
    var displayCategoryName: String {
        switch categoryId {
        case "ready-to-assign": L10n.string("Ready to assign")
        case "uncategorized": L10n.string("Uncategorized")
        default: categoryName
        }
    }

    init(
        categoryId: String, categoryName: String, amount: Decimal, groupId: String? = nil,
        groupName: String? = nil
    ) {
        self.categoryId = categoryId
        self.categoryName = categoryName
        self.amount = amount
        self.groupId = groupId
        self.groupName = groupName
    }
    private enum CodingKeys: String, CodingKey {
        case categoryId, categoryName, amount, groupId, groupName
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        categoryId = try values.decode(String.self, forKey: .categoryId)
        categoryName = try values.decode(String.self, forKey: .categoryName)
        groupId = try values.decodeIfPresent(String.self, forKey: .groupId)
        groupName = try values.decodeIfPresent(String.self, forKey: .groupName)
        let raw = try values.decode(String.self, forKey: .amount)
        guard raw.range(of: "^-?[0-9]+$", options: .regularExpression) != nil,
            let value = Decimal(string: raw, locale: Locale(identifier: "en_US_POSIX"))
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .amount, in: values, debugDescription: "Expected integer minor units")
        }
        amount = value
    }
}

nonisolated struct ReportEntry: Decodable, Identifiable, Equatable {
    let id: String
    let date: String
    let accountId: String
    let accountName: String
    let merchantId: String
    let merchantName: String
    let merchantLogoUrl: String?
    let status: String
    let reviewStatus: String
    let notes: String?
    let movements: [ReportMovement]
    var amount: Decimal { movements.reduce(0) { $0 + $1.amount } }
}

nonisolated struct ReportPage: Decodable {
    let page: [ReportEntry]
    let continueCursor: String
    let isDone: Bool
}

nonisolated struct ReportFilters: Equatable, Hashable {
    var accountIDs: Set<String> = []
    var categoryIDs: Set<String> = []
    var merchantIDs: Set<String> = []
    var includesPending = false
    var reviewStatus: String? = nil
    var count: Int {
        accountIDs.count + categoryIDs.count + merchantIDs.count + (includesPending ? 1 : 0)
            + (reviewStatus == nil ? 0 : 1)
    }
    func matches(_ entry: ReportEntry) -> Bool {
        (accountIDs.isEmpty || accountIDs.contains(entry.accountId))
            && (merchantIDs.isEmpty || merchantIDs.contains(entry.merchantId))
            && (includesPending || entry.status != "pending")
            && (reviewStatus == nil || reviewStatus == entry.reviewStatus)
    }
}

nonisolated struct ReportDrilldown: Identifiable, Hashable {
    var title: String
    var categoryID: String? = nil
    var merchantID: String? = nil
    var range: ReportRange? = nil
    var groupID: String? = nil
    var kind: ReportKind? = nil
    var id: String {
        "\(title)|\(categoryID ?? "")|\(merchantID ?? "")|\(range?.start ?? "")|\(range?.end ?? "")|\(groupID ?? "")|\(kind?.rawValue ?? "")"
    }
}

nonisolated struct ReportTotals: Decodable, Equatable {
    var outflow: Decimal = 0
    var inflow: Decimal = 0
    var count = 0
    var net: Decimal { inflow - outflow }
    init(outflow: Decimal = 0, inflow: Decimal = 0, count: Int = 0) {
        self.outflow = outflow
        self.inflow = inflow
        self.count = count
    }
    private enum CodingKeys: String, CodingKey { case outflow, inflow, count }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        outflow = try values.reportAmount(forKey: .outflow)
        inflow = try values.reportAmount(forKey: .inflow)
        count = try values.decode(Int.self, forKey: .count)
    }
    func value(for kind: ReportKind) -> Decimal {
        switch kind {
        case .spending: outflow
        case .moneyIn: inflow
        case .cashFlow: net
        }
    }
}

nonisolated struct ReportBucket: Decodable, Identifiable, Equatable {
    let range: ReportRange
    var totals = ReportTotals()
    var previous = ReportTotals()
    var id: String { range.start }
    var date: Date { ReportDates.date(range.start) }
    var label: String {
        date.formatted(
            Date.FormatStyle(locale: L10n.locale, timeZone: .gmt).month(.abbreviated).day())
    }
}

/// Selection is part of the mark's input and identity, so Charts cannot reuse
/// a stale foreground style when the ledger buckets themselves haven't changed.
nonisolated struct ReportChartMonth: Identifiable {
    struct ID: Hashable {
        let month: String
        let isSelected: Bool
    }
    let bucket: ReportBucket
    let isSelected: Bool
    var id: ID { .init(month: bucket.id, isSelected: isSelected) }
    /// Position of zero measured down from the top of this single, two-color bar.
    var zeroPosition: Double {
        let total = bucket.totals.inflow + bucket.totals.outflow
        guard total > 0 else { return 0.5 }
        return NSDecimalNumber(decimal: bucket.totals.inflow / total).doubleValue
    }

    init(bucket: ReportBucket, selectedRange: ReportRange) {
        self.bucket = bucket
        isSelected =
            bucket.range.start <= selectedRange.end && bucket.range.end >= selectedRange.start
    }
}

nonisolated struct ReportRank: Decodable, Identifiable {
    let id: String
    let name: String
    let logoURL: String?
    var amount: Decimal = 0
    var previousAmount: Decimal = 0
    var count = 0
    init(
        id: String, name: String, logoURL: String?, amount: Decimal = 0,
        previousAmount: Decimal = 0, count: Int = 0
    ) {
        self.id = id
        self.name = name
        self.logoURL = logoURL
        self.amount = amount
        self.previousAmount = previousAmount
        self.count = count
    }
    private enum CodingKeys: String, CodingKey {
        case id, name, logoURL, amount, previousAmount, count
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        logoURL = try values.decodeIfPresent(String.self, forKey: .logoURL)
        amount = try values.reportAmount(forKey: .amount)
        previousAmount = try values.reportAmount(forKey: .previousAmount)
        count = try values.decode(Int.self, forKey: .count)
    }
}

nonisolated struct ReportMatchedEntry: Identifiable {
    let entry: ReportEntry
    let movements: [ReportMovement]
    var id: String { entry.id }
    var amount: Decimal { movements.reduce(0) { $0 + $1.amount } }
}

nonisolated struct ReportFilterOption: Decodable, Identifiable {
    let id: String
    let title: String
}

/// Aggregates calculated from the complete local reports history.
nonisolated struct ReportAnalysis: Decodable {
    let range: ReportRange
    var totals = ReportTotals()
    var previous = ReportTotals()
    var buckets: [ReportBucket] = []
    var categories: [ReportRank] = []
    var merchants: [ReportRank] = []
    var groups: [ReportRank] = []
    var spendingDays = 0
    var categoryCount = 0
    var merchantCount = 0
    var accounts: [ReportFilterOption] = []
    var categoryOptions: [ReportFilterOption] = []
    var merchantOptions: [ReportFilterOption] = []
    var optionsTruncated = false
    var averagePerDay: Decimal { totals.outflow / Decimal(range.dayCount) }
}

extension KeyedDecodingContainer {
    nonisolated func reportAmount(forKey key: Key) throws -> Decimal {
        let raw = try decode(String.self, forKey: key)
        guard raw.range(of: "^-?[0-9]+$", options: .regularExpression) != nil,
            let value = Decimal(string: raw, locale: Locale(identifier: "en_US_POSIX"))
        else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "Expected integer minor units")
        }
        return value
    }
}

extension ReportDates {
    static func monthStart(_ key: String) -> String { String(key.prefix(7)) + "-01" }
    static func monthRange(from first: String, through last: String, today: String) -> ReportRange {
        let start = monthStart(min(first, last))
        let endMonth = date(monthStart(max(first, last)))
        let end = key(add(.day, -1, to: add(.month, 1, to: endMonth)))
        return .init(start: start, end: min(today, end))
    }
    static func monthLabel(_ key: String) -> String {
        date(monthStart(key)).formatted(
            Date.FormatStyle(locale: L10n.locale, timeZone: .gmt).month(.abbreviated).year())
    }
    static func months(from first: String, through last: String) -> [String] {
        var month = date(monthStart(first))
        let end = date(monthStart(last))
        var result: [String] = []
        while month <= end {
            result.append(key(month))
            month = add(.month, 1, to: month)
        }
        return result
    }
}

nonisolated struct ReportHistory {
    let entries: [ReportEntry]

    func matched(_ request: ReportSummaryRequest, range: ReportRange) -> [ReportMatchedEntry] {
        entries.filter {
            range.contains($0.date) && request.filters.matches($0)
                && (request.scope?.merchantID == nil || request.scope?.merchantID == $0.merchantId)
        }.map(request.matching).filter { !$0.movements.isEmpty }
    }

    static func totals(_ entries: [ReportMatchedEntry]) -> ReportTotals {
        var result = ReportTotals(count: entries.count)
        for entry in entries {
            for movement in entry.movements {
                result.inflow += max(0, movement.amount)
                result.outflow += max(0, -movement.amount)
            }
        }
        return result
    }

    func months(through today: String) -> [ReportBucket] {
        let eligible = entries.filter { $0.status != "pending" && $0.date <= today }
        let first = eligible.map(\.date).min() ?? today
        let grouped = Dictionary(grouping: eligible, by: { ReportDates.monthStart($0.date) })
        return ReportDates.months(from: first, through: today).map { month in
            .init(
                range: ReportDates.monthRange(from: month, through: month, today: today),
                totals: Self.totals(
                    (grouped[month] ?? []).map { .init(entry: $0, movements: $0.movements) }))
        }
    }

    func report(_ request: ReportSummaryRequest) -> ReportAnalysis {
        let current = matched(request, range: request.range)
        let previous = matched(request, range: request.comparison)
        var result = ReportAnalysis(range: request.range)
        result.totals = Self.totals(current)
        result.previous = Self.totals(previous)
        func ranks(_ grouping: ReportGrouping) -> [ReportRank] {
            var rows: [String: ReportRank] = [:]
            for (matches, isPrevious) in [(current, false), (previous, true)] {
                for match in matches {
                    var counted: Set<String> = []
                    for movement in match.movements {
                        let id: String
                        let name: String
                        switch grouping {
                        case .categories:
                            id = movement.categoryId
                            name = movement.displayCategoryName
                        case .merchants:
                            id = match.entry.merchantId
                            name = match.entry.merchantName
                        case .groups:
                            id = movement.resolvedGroupID
                            name = movement.resolvedGroupName
                        }
                        var row =
                            rows[id]
                            ?? .init(
                                id: id, name: name,
                                logoURL: grouping == .merchants ? match.entry.merchantLogoUrl : nil)
                        let amount = request.kind == .spending ? -movement.amount : movement.amount
                        if isPrevious {
                            row.previousAmount += amount
                        } else {
                            row.amount += amount
                            if counted.insert(id).inserted { row.count += 1 }
                        }
                        rows[id] = row
                    }
                }
            }
            return rows.values.filter { $0.count > 0 }.sorted {
                abs($0.amount) == abs($1.amount) ? $0.id < $1.id : abs($0.amount) > abs($1.amount)
            }
        }
        result.categories = ranks(.categories)
        result.merchants = ranks(.merchants)
        result.groups = ranks(.groups)
        result.categoryCount = result.categories.count
        result.merchantCount = result.merchants.count
        result.spendingDays =
            Set(current.filter { $0.movements.contains { $0.amount < 0 } }.map { $0.entry.date })
            .count
        let monthly = Dictionary(grouping: current, by: { ReportDates.monthStart($0.entry.date) })
        result.buckets = ReportDates.months(from: request.range.start, through: request.range.end)
            .map { month in
                .init(
                    range: .init(
                        start: max(month, request.range.start),
                        end: ReportDates.monthRange(
                            from: month, through: month, today: request.range.end
                        ).end), totals: Self.totals(monthly[month] ?? []))
            }
        return result
    }

    func page(_ request: ReportPageRequest) -> ReportPage {
        let matches = matched(request.report, range: request.report.range).map(\.entry)
        let filtered = matches.filter { entry in
            let fields = [entry.merchantName, entry.accountName, entry.notes ?? ""]
            return request.search.isEmpty
                || fields.contains { $0.localizedCaseInsensitiveContains(request.search) }
        }
        let rows = filtered.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date > $1.date }
        let start = min(max(0, Int(request.cursor ?? "") ?? 0), rows.count)
        let end = min(start + 50, rows.count)
        return .init(
            page: Array(rows[start..<end]), continueCursor: String(end), isDone: end == rows.count)
    }
}

extension ReportAnalysis {
    // Category history still consumes the shared server summary, which predates groups.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        range = try values.decode(ReportRange.self, forKey: .range)
        totals = try values.decode(ReportTotals.self, forKey: .totals)
        previous = try values.decode(ReportTotals.self, forKey: .previous)
        buckets = try values.decode([ReportBucket].self, forKey: .buckets)
        categories = try values.decode([ReportRank].self, forKey: .categories)
        merchants = try values.decode([ReportRank].self, forKey: .merchants)
        groups = try values.decodeIfPresent([ReportRank].self, forKey: .groups) ?? []
        spendingDays = try values.decode(Int.self, forKey: .spendingDays)
        categoryCount = try values.decode(Int.self, forKey: .categoryCount)
        merchantCount = try values.decode(Int.self, forKey: .merchantCount)
        accounts = try values.decode([ReportFilterOption].self, forKey: .accounts)
        categoryOptions = try values.decode([ReportFilterOption].self, forKey: .categoryOptions)
        merchantOptions = try values.decode([ReportFilterOption].self, forKey: .merchantOptions)
        optionsTruncated = try values.decode(Bool.self, forKey: .optionsTruncated)
    }
    private enum CodingKeys: String, CodingKey {
        case range, totals, previous, buckets, categories, merchants, groups, spendingDays,
            categoryCount, merchantCount, accounts, categoryOptions, merchantOptions,
            optionsTruncated
    }
}
