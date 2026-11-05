import Combine
import Foundation
import Observation

#if canImport(ConvexMobile)
    import ConvexMobile
#endif

struct ReportsContext: Equatable {
    let id: String
    let currencyCode: String
    let minorUnit: Int
    let timezone: String?
}

nonisolated struct ReportSummaryRequest: Hashable {
    let workspaceID: String
    let range: ReportRange
    let comparison: ReportRange
    let kind: ReportKind
    let filters: ReportFilters
    var scope: ReportDrilldown? = nil

    func hasSameScope(as other: Self) -> Bool {
        workspaceID == other.workspaceID && range == other.range
            && comparison == other.comparison && filters == other.filters && scope == other.scope
    }

    func matching(_ entry: ReportEntry) -> ReportMatchedEntry {
        .init(
            entry: entry,
            movements: entry.movements.filter {
                (filters.categoryIDs.isEmpty || filters.categoryIDs.contains($0.categoryId))
                    && (scope?.categoryID == nil || scope?.categoryID == $0.categoryId)
                    && (scope?.groupID == nil || scope?.groupID == $0.resolvedGroupID)
                    && (kind == .cashFlow || (kind == .spending ? $0.amount < 0 : $0.amount > 0))
            })
    }
}

nonisolated struct ReportPageRequest {
    let report: ReportSummaryRequest
    let cursor: String?
    let search: String
}

nonisolated struct ReportHistoryRequest {
    let workspaceID: String
    let cursor: String?
}

@MainActor
@Observable
final class ReportsStore {
    typealias HistoryLoader = (ReportHistoryRequest) async throws -> ReportPage
    private(set) var context: ReportsContext?
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    private(set) var errorMessage: String?
    private(set) var updatedAt: Date?
    private(set) var range: ReportRange
    private(set) var period: ReportPeriod = .month
    let comparison: ReportComparison = .previous
    let kind: ReportKind = .cashFlow
    let filters = ReportFilters()
    private(set) var analysis: ReportAnalysis
    private(set) var inflow: ReportAnalysis
    private(set) var outflow: ReportAnalysis
    private(set) var months: [ReportBucket] = []
    var inflowGrouping: ReportGrouping = .categories
    var outflowGrouping: ReportGrouping = .categories
    private(set) var selectionAnchor: String?
    private(set) var rangeRevision = 0
    var detail: ReportDrilldown?
    @ObservationIgnored private let historyLoader: HistoryLoader
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let requestedWorkspaceID: String?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var history = ReportHistory(entries: [])
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var customRange: ReportRange?
    @ObservationIgnored private var historyDay: String?

    var today: String { ReportDates.key(now(), timezone: context?.timezone) }
    var comparisonRange: ReportRange { range.comparison(comparison) }
    var chartMonths: [ReportChartMonth] {
        months.map { ReportChartMonth(bucket: $0, selectedRange: range) }
    }
    var rangeLabel: String { range.monthLabel }
    var availableMonths: [String] {
        let previousYear = ReportDates.range(
            .previousYear, now: now(), timezone: context?.timezone, custom: nil)
        return ReportDates.months(
            from: min(months.first?.id ?? today, previousYear.start), through: today)
    }

    init(
        workspaceID: String? = nil, now: @escaping () -> Date = Date.init,
        historyLoader: @escaping HistoryLoader
    ) {
        requestedWorkspaceID = workspaceID
        self.now = now
        self.historyLoader = historyLoader
        let range = ReportDates.range(.month, now: now(), timezone: nil, custom: nil)
        self.range = range
        analysis = .init(range: range)
        inflow = .init(range: range)
        outflow = .init(range: range)
    }

    func prepare(_ next: ReportsContext?) {
        if let requestedWorkspaceID, let next, next.id != requestedWorkspaceID { return }
        guard next != context else { return }
        let resume = isActive
        reset()
        context = next
        updateRange()
        if resume { start() }
    }
    func start() {
        guard !isActive else { return }
        isActive = true
        updateRange()
        loadHistory()
    }
    func stop() {
        isActive = false
        generation = UUID()
        task?.cancel()
        task = nil
        isLoading = false
        selectionAnchor = nil
    }
    func reset() {
        stop()
        context = nil
        hasLoaded = false
        errorMessage = nil
        updatedAt = nil
        period = .month
        customRange = nil
        detail = nil
        historyDay = nil
        history = .init(entries: [])
        months = []
        inflowGrouping = .categories
        outflowGrouping = .categories
        updateRange()
    }
    func refreshIfNeeded(refreshStaleContent: Bool = false) {
        guard isActive else { return }
        let changedDay = historyDay != today
        if changedDay { updateRange() }
        if changedDay || refreshStaleContent { loadHistory(force: changedDay && !isLoading) }
    }
    func apply(period: ReportPeriod, custom: ReportRange? = nil) {
        self.period = period
        rangeRevision += 1
        customRange = custom.map {
            ReportDates.monthRange(from: $0.start, through: $0.end, today: today)
        }
        selectionAnchor = nil
        detail = nil
        updateRange()
    }
    func selectMonth(_ month: String, extending: Bool = false) {
        guard hasLoaded, months.contains(where: { $0.id == month }) else { return }
        let selectedMonth =
            ReportDates.monthStart(range.start) == ReportDates.monthStart(range.end)
            ? ReportDates.monthStart(range.start) : nil
        let anchor = extending ? (selectionAnchor ?? selectedMonth ?? month) : month
        let next = ReportDates.monthRange(from: anchor, through: month, today: today)
        selectionAnchor = anchor
        guard next != range || period != .custom else { return }
        period = .custom
        customRange = next
        detail = nil
        updateRange()
    }
    private func updateRange() {
        range = ReportDates.range(
            period, now: now(), timezone: context?.timezone, custom: customRange)
        if let request = request() {
            analysis = history.report(request)
            inflow = history.report(requestForKind(.moneyIn))
            outflow = history.report(requestForKind(.spending))
        } else {
            analysis = .init(range: range)
            inflow = .init(range: range)
            outflow = .init(range: range)
        }
    }
    private func requestForKind(_ kind: ReportKind) -> ReportSummaryRequest {
        .init(
            workspaceID: context?.id ?? "", range: range, comparison: comparisonRange, kind: kind,
            filters: filters)
    }
    func request(for scope: ReportDrilldown? = nil) -> ReportSummaryRequest? {
        guard let context else { return nil }
        let visible = scope?.range ?? range
        return .init(
            workspaceID: context.id, range: visible, comparison: visible.comparison(comparison),
            kind: scope?.kind ?? kind, filters: filters, scope: scope)
    }
    func summary(for request: ReportSummaryRequest) async throws -> ReportAnalysis {
        guard hasLoaded, context?.id == request.workspaceID else { throw CancellationError() }
        return history.report(request)
    }
    func page(_ request: ReportPageRequest) async throws -> ReportPage {
        guard hasLoaded, context?.id == request.report.workspaceID else {
            throw CancellationError()
        }
        return history.page(request)
    }
    func reload() { loadHistory(force: true) }
    func refresh() async {
        reload()
        await task?.value
    }
    private func loadHistory(force: Bool = false) {
        guard isActive, let context else { return }
        if !force {
            guard !isLoading else { return }
            if let updatedAt, now().timeIntervalSince(updatedAt) < 60, historyDay == today {
                return
            }
        }
        generation = UUID()
        let token = generation
        task?.cancel()
        isLoading = true
        errorMessage = nil
        task = Task { [weak self] in
            guard let self else { return }
            do {
                var entries: [String: ReportEntry] = [:]
                var cursor: String?
                var cursors: Set<String> = []
                repeat {
                    let page = try await historyLoader(
                        .init(workspaceID: context.id, cursor: cursor))
                    try Task.checkCancellation()
                    guard token == generation else { return }
                    for entry in page.page { entries[entry.id] = entry }
                    if page.isDone { break }
                    guard !page.continueCursor.isEmpty, cursors.insert(page.continueCursor).inserted
                    else {
                        throw HistoryError.invalidCursor
                    }
                    cursor = page.continueCursor
                } while true
                // Publish atomically: a partial history must never look like complete totals.
                history = .init(entries: Array(entries.values))
                months = history.months(through: today)
                historyDay = today
                updateRange()
                hasLoaded = true
                updatedAt = now()
                isLoading = false
                task = nil
            } catch {
                guard token == generation, !Task.isCancelled else { return }
                isLoading = false
                task = nil
                errorMessage = L10n.string(
                    "Couldn't calculate this report. Check your connection and try again.")
            }
        }
    }
    private enum HistoryError: Error { case invalidCursor }
    static var preview: ReportsStore {
        ReportsStore(historyLoader: { _ in .init(page: [], continueCursor: "", isDone: true) })
    }
}

@MainActor
@Observable
final class ReportDetailStore {
    private(set) var analysis: ReportAnalysis?
    private(set) var entries: [ReportMatchedEntry] = []
    private(set) var summaryError: String?
    private(set) var pageError: String?
    private(set) var isLoading = false
    private(set) var isDone = false
    private let store: ReportsStore
    private let request: ReportSummaryRequest?
    private var cursor: String?
    private var search = ""
    private var generation = UUID()
    private var seenCursors: Set<String> = []

    init(store: ReportsStore, scope: ReportDrilldown) {
        self.store = store
        request = store.request(for: scope)
    }

    func loadSummary() async {
        guard analysis == nil, let request else { return }
        summaryError = nil
        do { analysis = try await store.summary(for: request) } catch {
            if !Task.isCancelled {
                summaryError = L10n.string("Couldn't load the breakdown. Try again.")
            }
        }
    }

    func search(_ value: String) async {
        generation = UUID()
        let token = generation
        search = String(value.prefix(200))
        entries = []
        cursor = nil
        seenCursors = []
        isDone = false
        isLoading = false
        pageError = nil
        if !value.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
        guard token == generation, !Task.isCancelled else { return }
        await loadMore()
    }

    func loadMore() async {
        guard !isLoading, !isDone, let request else { return }
        let token = generation
        isLoading = true
        pageError = nil
        do {
            let page = try await store.page(.init(report: request, cursor: cursor, search: search))
            guard token == generation, !Task.isCancelled else { return }
            if !page.isDone
                && (page.continueCursor.isEmpty
                    || !seenCursors.insert(page.continueCursor).inserted)
            {
                throw ReportPageError.invalidCursor
            }
            let existing = Set(entries.map(\.id))
            entries.append(
                contentsOf: page.page.filter { !existing.contains($0.id) }.map(request.matching))
            cursor = page.continueCursor
            isDone = page.isDone
            isLoading = false
        } catch {
            guard token == generation, !Task.isCancelled else { return }
            isLoading = false
            pageError = L10n.string("Couldn't load this activity. Try again.")
        }
    }

    func cancel() {
        generation = UUID()
        isLoading = false
    }
    private enum ReportPageError: Error { case invalidCursor }
}

#if canImport(ConvexMobile)
    extension ReportSummaryRequest {
        var arguments: [String: ConvexEncodable?] {
            let filterArgs: [String: ConvexEncodable?] = [
                "accountIds": filters.accountIDs.sorted().map { $0 as ConvexEncodable? },
                "categoryIds": filters.categoryIDs.sorted().map { $0 as ConvexEncodable? },
                "merchantIds": filters.merchantIDs.sorted().map { $0 as ConvexEncodable? },
                "includesPending": filters.includesPending,
                "reviewStatus": filters.reviewStatus,
                "categoryId": scope?.categoryID,
                "merchantId": scope?.merchantID,
            ]
            let dates: [String: ConvexEncodable?] = ["start": range.start, "end": range.end]
            return [
                "workspaceId": workspaceID, "range": dates, "kind": kind.rawValue,
                "filters": filterArgs,
            ]
        }
    }

    extension ReportHistoryRequest {
        var arguments: [String: ConvexEncodable?] {
            let pagination: [String: ConvexEncodable?] = [
                "numItems": 200.0, "cursor": cursor,
            ]
            return ["workspaceId": workspaceID, "paginationOpts": pagination]
        }
    }

    extension ReportsStore {
        convenience init(convexClient: ConvexClientWithAuth<String>, workspaceID: String) {
            self.init(
                workspaceID: workspaceID,
                historyLoader: { request in
                    guard
                        let page = try await convexClient.subscribe(
                            to: "reports:listHistoryEntries", with: request.arguments,
                            yielding: ReportPage.self
                        ).first().timeout(.seconds(30), scheduler: DispatchQueue.main).values.first(
                            where: { _ in true })
                    else {
                        throw CancellationError()
                    }
                    return page
                })
        }
    }
#endif
