import Foundation
import Observation

enum TransactionSearchPeriod: String, CaseIterable, Identifiable {
    case month, lastMonth, last30Days, year
    var id: String { rawValue }
    var title: String {
        switch self {
        case .month: L10n.string("This month")
        case .lastMonth: L10n.string("Last month")
        case .last30Days: L10n.string("Last 30 days")
        case .year: L10n.string("This year")
        }
    }

    func range(workspace: TransactionFeedWorkspace, now: Date = Date()) -> (
        start: String, end: String
    ) {
        let calendar = TransactionEditorDate.calendar(workspace: workspace)
        let today = calendar.startOfDay(for: now)
        let monthStart = calendar.dateInterval(of: .month, for: today)?.start ?? today
        let start: Date
        let end: Date
        switch self {
        case .month:
            start = monthStart
            end = today
        case .lastMonth:
            start = calendar.date(byAdding: .month, value: -1, to: monthStart) ?? monthStart
            end = calendar.date(byAdding: .day, value: -1, to: monthStart) ?? monthStart
        case .last30Days:
            start = calendar.date(byAdding: .day, value: -29, to: today) ?? today
            end = today
        case .year:
            start = calendar.dateInterval(of: .year, for: today)?.start ?? today
            end = today
        }
        return (
            TransactionEditorDate.key(from: start, workspace: workspace),
            TransactionEditorDate.key(from: end, workspace: workspace)
        )
    }
}

enum TransactionSearchStatus: String, CaseIterable, Identifiable {
    case pending, cleared, reconciled
    case needsReview = "needs_review"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .pending: L10n.string("Pending")
        case .cleared: L10n.string("Cleared")
        case .reconciled: L10n.string("Reconciled")
        case .needsReview: L10n.string("Needs approval")
        }
    }
}

enum TransactionSearchFlow: String, CaseIterable, Identifiable {
    case outflow, inflow, transfer
    var id: String { rawValue }
    var title: String {
        switch self {
        case .outflow: L10n.string("Money out")
        case .inflow: L10n.string("Money in")
        case .transfer: L10n.string("Transfers")
        }
    }
}

struct TransactionSearchNamedFilter: Equatable {
    let id: String
    let title: String
}

struct TransactionSearchFilters: Equatable {
    var text = ""
    var accountID: String?
    var categoryID: String?
    var startDate: String?
    var endDate: String?
    var status: TransactionSearchStatus?
    var flow: TransactionSearchFlow?
    var hasNotes = false
    var group: TransactionSearchNamedFilter?
    var merchant: TransactionSearchNamedFilter?
    var reportActivity = false

    var count: Int {
        [
            accountID != nil, categoryID != nil, startDate != nil || endDate != nil,
            status != nil, flow != nil, hasNotes, group != nil, merchant != nil, reportActivity,
        ].filter { $0 }.count
    }

    var isSearching: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || count > 0
    }

    static func report(
        row: ReportRank, grouping: ReportGrouping, kind: ReportKind, range: ReportRange
    ) -> Self {
        .init(
            categoryID: grouping == .categories ? row.id : nil,
            startDate: range.start, endDate: range.end,
            flow: kind == .moneyIn ? .inflow : kind == .spending ? .outflow : nil,
            group: grouping == .groups ? .init(id: row.id, title: row.name) : nil,
            merchant: grouping == .merchants ? .init(id: row.id, title: row.name) : nil,
            reportActivity: true)
    }
}

struct TransactionSearchRequest: Equatable {
    let filters: TransactionSearchFilters
    let cursor: String?
}

struct TransactionSearchChoices {
    var accounts: [TransactionEditorChoice] = []
    var categories: [TransactionEditorChoice] = []
}

@MainActor
@Observable
final class TransactionSearchStore: Identifiable {
    typealias PageLoader = (TransactionSearchRequest) async throws -> TransactionFeedResponse
    typealias ChoicesLoader = () async throws -> TransactionSearchChoices

    let id = UUID()
    let workspace: TransactionFeedWorkspace
    let loadsAllPages: Bool
    var filters = TransactionSearchFilters()
    private(set) var sections: [TransactionFeedSection] = []
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    private(set) var hasMore = true
    private(set) var errorMessage: String?
    private(set) var choices = TransactionSearchChoices()
    private(set) var isLoadingChoices = false
    private(set) var choicesError: String?

    @ObservationIgnored private let pageLoader: PageLoader
    @ObservationIgnored private let choicesLoader: ChoicesLoader
    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var choicesTask: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var choicesGeneration = UUID()
    private(set) var items: [TransactionFeedItem] = []
    /// Last fully loaded result for the applied filters, retained during refreshes.
    private(set) var completedItems: [TransactionFeedItem]?
    @ObservationIgnored private var refreshResultTarget: Int?
    @ObservationIgnored private var cursor: String?
    @ObservationIgnored private var visitedCursors: Set<String> = []
    @ObservationIgnored private var appliedFilters: TransactionSearchFilters?

    var resultCount: Int { sections.reduce(0) { $0 + $1.entries.count } }

    init(
        workspace: TransactionFeedWorkspace, debounce: Duration = .milliseconds(300),
        filters: TransactionSearchFilters = .init(), loadsAllPages: Bool = false,
        pageLoader: @escaping PageLoader,
        choicesLoader: @escaping ChoicesLoader = { .init() }
    ) {
        self.workspace = workspace
        self.filters = filters
        self.loadsAllPages = loadsAllPages
        self.debounce = debounce
        self.pageLoader = pageLoader
        self.choicesLoader = choicesLoader
    }

    func search(immediately: Bool = false) {
        task?.cancel()
        generation = UUID()
        appliedFilters = filters
        items = []
        completedItems = nil
        sections = []
        refreshResultTarget = nil
        cursor = nil
        visitedCursors = []
        hasLoaded = false
        hasMore = true
        errorMessage = nil
        load(debounced: !immediately)
    }

    func loadMore() {
        guard !isLoading, hasMore, appliedFilters == filters else { return }
        load(debounced: false)
    }

    func retry() {
        if appliedFilters != filters { search(immediately: true) } else { loadMore() }
    }

    func clearFilters() {
        let text = filters.text
        filters = .init(text: text)
    }

    func refresh() async {
        let previousSections = appliedFilters == filters ? sections : []
        let previousCompletedItems = appliedFilters == filters ? completedItems : nil
        let previouslyLoaded = hasLoaded
        search(immediately: true)
        completedItems = previousCompletedItems
        if !previousSections.isEmpty || previousCompletedItems != nil {
            // Keep the loaded range on screen while mutations are reconciled, so
            // swiping an older result does not send the list back to the first page.
            sections = previousSections
            hasLoaded = previouslyLoaded
            refreshResultTarget = resultCount
        }
        await task?.value
    }

    func refreshIfIdle() async {
        if isLoading, appliedFilters == filters {
            await task?.value
        } else {
            await refresh()
        }
    }

    func stop() {
        generation = UUID()
        choicesGeneration = UUID()
        task?.cancel()
        choicesTask?.cancel()
        isLoading = false
        isLoadingChoices = false
    }

    func loadChoices() {
        choicesTask?.cancel()
        let generation = UUID()
        choicesGeneration = generation
        isLoadingChoices = true
        choicesError = nil
        choicesTask = Task { [weak self] in
            guard let self else { return }
            do {
                let choices = try await choicesLoader()
                guard !Task.isCancelled, choicesGeneration == generation else { return }
                self.choices = choices
            } catch {
                guard !Task.isCancelled, choicesGeneration == generation else { return }
                choicesError = L10n.string("Couldn't load your filters. Please try again.")
            }
            isLoadingChoices = false
        }
    }

    private func load(debounced: Bool) {
        isLoading = true
        errorMessage = nil
        let generation = generation
        let filters = filters
        task = Task { [weak self] in
            guard let self else { return }
            do {
                if debounced { try await Task.sleep(for: debounce) }
                let targetCount = max(items.count + 40, refreshResultTarget ?? 0)
                // The server fills pages with matches. Continue only when its
                // scan bound is reached or a complete category total is needed.
                while hasMore && (loadsAllPages || items.count < targetCount) {
                    try Task.checkCancellation()
                    let response = try await pageLoader(.init(filters: filters, cursor: cursor))
                    guard !Task.isCancelled, self.generation == generation,
                        self.filters == filters
                    else { return }
                    guard response.workspace?.id == workspace.id else {
                        throw TransactionSearchError.workspaceChanged
                    }
                    let page = response.transactions
                    guard
                        page.isDone
                            || (!page.continueCursor.isEmpty
                                && !visitedCursors.contains(page.continueCursor))
                    else {
                        throw TransactionSearchError.invalidCursor
                    }
                    var ids = Set(items.map(\.id))
                    items.append(contentsOf: page.page.filter { ids.insert($0.id).inserted })
                    if page.isDone { completedItems = items }
                    hasMore = !page.isDone
                    cursor = page.continueCursor
                    visitedCursors.insert(page.continueCursor)
                }
                sections = TransactionFeedPresentation.sections(from: items)
                hasLoaded = true
                refreshResultTarget = nil
            } catch {
                guard !Task.isCancelled, self.generation == generation,
                    self.filters == filters
                else { return }
                // An interrupted scan still exposes the matches already found.
                if refreshResultTarget == nil {
                    sections = TransactionFeedPresentation.sections(from: items)
                    hasLoaded = !items.isEmpty
                }
                errorMessage = L10n.string(
                    "Couldn't finish searching. Check your connection and try again.")
            }
            guard self.generation == generation else { return }
            isLoading = false
        }
    }

    private enum TransactionSearchError: Error {
        case workspaceChanged, invalidCursor
    }
}
