import Combine
import ConvexMobile
import Foundation
import OSLog
import Observation

enum PlannedAction: String {
    case enter, skip, pause, resume, delete
    var title: String {
        switch self {
        case .enter: L10n.string("Record transaction")
        case .skip: L10n.string("Skip")
        case .pause: L10n.string("Pause")
        case .resume: L10n.string("Resume")
        case .delete: L10n.string("Delete")
        }
    }
    var mutationName: String {
        switch self {
        case .enter: "scheduledTransactions:enterScheduledTransactionNow"
        case .skip: "scheduledTransactions:skipScheduledTransaction"
        case .pause, .resume: "scheduledTransactions:updateScheduledTransaction"
        case .delete: "scheduledTransactions:deleteScheduledTransaction"
        }
    }
}

private struct PlannedActionResult: Decodable {
    let scheduledTransactionId: String?
    let success: Bool?
    let transactionId: String?
}

struct PlannedEntryReceipt: Identifiable {
    let id: String
    let name: String
}

@MainActor
@Observable
final class PlannedStore {
    private var editorFactory: (() -> TransactionEditorStore)?
    typealias Subscription = (String, String) -> AnyPublisher<PlannedData, Error>
    typealias ActionHandler = (String, String, String, PlannedAction) async throws -> String?

    private static let subscriptionQueue = DispatchQueue(
        label: "com.kualia.agenda.subscription", qos: .userInitiated)

    let workspace: TransactionFeedWorkspace
    private(set) var data: PlannedData?
    private(set) var errorMessage: String?
    var actionError: String?
    private(set) var busyScheduleID: String?
    private(set) var latestEntry: PlannedEntryReceipt?
    private(set) var isLoading = false
    private(set) var agendaEntries: [PlannedOccurrence] = []
    private(set) var timeline = PlannedTimelinePresentation(
        entries: [], schedules: [], today: "1900-01-01")
    @ObservationIgnored private var calendarPages: [Int: PlannedCalendarPage] = [:]
    @ObservationIgnored private var calendarPageOrder: [Int] = []
    @ObservationIgnored private var schedulesByID: [String: PlannedSchedule] = [:]
    @ObservationIgnored private var projectedMonths: [Int: [PlannedOccurrence]] = [:]
    var selectedMonth: Int
    var showsMonthPicker = false
    var filter: PlannedStatus?

    @ObservationIgnored private let subscribe: Subscription
    @ObservationIgnored private let performAction: ActionHandler
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var choicesStore: TransactionEditorChoicesStore?
    @ObservationIgnored private var client: ConvexClientWithAuth<String>?
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var midnight: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var subscribedDay: String?
    @ObservationIgnored private var undoDeadline: Task<Void, Never>?
    @ObservationIgnored private var presentationDay: String?
    #if DEBUG
        @ObservationIgnored private let performanceLogger = Logger(
            subsystem: "com.kualia.app", category: "TransactionAgenda")
    #endif

    init(
        workspace: TransactionFeedWorkspace, now: @escaping () -> Date = Date.init,
        editorFactory: (() -> TransactionEditorStore)? = nil,
        subscription: @escaping Subscription, actionHandler: @escaping ActionHandler
    ) {
        self.editorFactory = editorFactory
        self.workspace = workspace
        self.now = now
        self.subscribe = subscription
        self.performAction = actionHandler
        selectedMonth = PlannedDates.month(
            TransactionEditorDate.today(workspace: workspace, now: now()))
    }

    convenience init(
        workspace: TransactionFeedWorkspace, convexClient: ConvexClientWithAuth<String>,
        choicesStore: TransactionEditorChoicesStore? = nil
    ) {
        self.init(
            workspace: workspace,
            subscription: { id, today in
                // Convex cancellation calls its native subscription handle
                // synchronously, and subscribe() eagerly starts initialization.
                // Defer creation as well as scheduling upstream cancellation;
                // watch() still delivers state updates on the main thread.
                Deferred {
                    convexClient.subscribe(
                        to: "scheduledTransactions:listPlannedTransactionsData",
                        with: [
                            "workspaceId": id, "today": today,
                        ],
                        yielding: PlannedData.self
                    ).mapError { $0 as Error }
                }
                .subscribe(on: Self.subscriptionQueue)
                .eraseToAnyPublisher()
            },
            actionHandler: { workspaceID, scheduleID, nextDate, action in
                var arguments: [String: ConvexEncodable?] = [
                    "workspaceId": workspaceID, "scheduledTransactionId": scheduleID,
                ]
                if action == .enter || action == .skip { arguments["expectedNextDate"] = nextDate }
                if action == .pause || action == .resume { arguments["paused"] = action == .pause }
                let result: PlannedActionResult = try await convexClient.mutation(
                    action.mutationName, with: arguments)
                guard result.success == true || result.scheduledTransactionId != nil else {
                    throw TransactionEditorError.saveFailed
                }
                return result.transactionId
            })
        self.choicesStore = choicesStore
        client = convexClient
    }

    var today: String { TransactionEditorDate.today(workspace: workspace, now: now()) }
    var currentMonth: Int { PlannedDates.month(today) }
    private var calendarRange: BudgetMonthRange? {
        guard let data else { return nil }
        return .init(
            minYearMonth: 190001, maxYearMonth: max(210012, data.availableRange.maxYearMonth))
    }
    var months: [Int] {
        guard let range = calendarRange else { return [currentMonth] }
        return (BudgetMonth.index(range.minYearMonth)...BudgetMonth.index(range.maxYearMonth)).map(
            BudgetMonth.fromIndex)
    }
    var calendarMonths: [Int] {
        PlannedCalendarWindow.months(around: selectedMonth, range: calendarRange)
    }
    var schedules: [PlannedSchedule] {
        (data?.allPlannedTransactions ?? []).sorted {
            let rank: (PlannedSchedule) -> Int = {
                $0.status == "active" ? 0 : $0.status == "paused" ? 1 : 2
            }
            if rank($0) != rank($1) { return rank($0) < rank($1) }
            if $0.nextDate != $1.nextDate { return $0.nextDate < $1.nextDate }
            return $0.id < $1.id
        }
    }

    var pausedSchedules: [PlannedSchedule] {
        schedules.filter { $0.status == "paused" }
    }

    func schedule(_ id: String) -> PlannedSchedule? {
        _ = data  // Track live schedule changes while using the cached lookup.
        return schedulesByID[id]
    }

    func entries(in month: Int) -> [PlannedOccurrence] {
        guard let data else { return [] }
        if let cached = projectedMonths[month] { return cached }
        let selection = TransactionAgendaSelection(anchor: PlannedDates.key(month: month, day: 1))
        let dates = selection.dates(workspace: workspace)
        guard let first = dates.first, let last = dates.last else { return [] }
        let recorded = data.plannedByMonth.values.flatMap { $0 }
        let recordedDates = Dictionary(grouping: recorded, by: \.scheduledTransactionId)
            .mapValues { Set($0.map(\.occurrenceDate)) }
        // Server occurrences retain reopened bills, payments and skips. Local recurrence
        // projections fill the remaining dates without replacing those exact instances.
        let projected = PlannedProjection.entries(
            schedules: data.allPlannedTransactions,
            today: today, range: first...last, workspace: workspace
        ).filter {
            recordedDates[$0.scheduledTransactionId]?.contains($0.occurrenceDate) != true
        }
        let entries =
            (projected + recorded.filter { first <= $0.displayDate && $0.displayDate <= last })
            .sorted {
                $0.displayDate == $1.displayDate
                    ? $0.id < $1.id : $0.displayDate < $1.displayDate
            }
        projectedMonths[month] = entries
        return entries
    }

    func calendarPage(in month: Int, firstWeekday: Int = Calendar.current.firstWeekday)
        -> PlannedCalendarPage
    {
        // Reading data registers live-data invalidation even on a cache hit.
        guard data != nil else {
            return .init(
                month: month, firstWeekday: firstWeekday,
                entries: [], schedules: [])
        }
        if let page = calendarPages[month], page.firstWeekday == firstWeekday { return page }
        var calendar = TransactionEditorDate.calendar(workspace: workspace)
        calendar.firstWeekday = firstWeekday
        let days = PlannedCalendarGrid.days(in: month, calendar: calendar)
        let visibleDates = Set(days.map(\.key))
        let visibleMonths = Set(days.map { PlannedDates.month($0.key) }).sorted()
        // Keep entered occurrences from their exact schedule links and project
        // upcoming/overdue repeats locally, including neighboring month cells.
        let entries = visibleMonths.flatMap { self.entries(in: $0) }
            .filter { visibleDates.contains($0.displayDate) }
        let scheduleIDs = Set(entries.map(\.scheduledTransactionId))
        let page = PlannedCalendarPage(
            month: month, firstWeekday: firstWeekday, entries: entries,
            schedules: scheduleIDs.sorted().compactMap { schedulesByID[$0] })
        calendarPages[month] = page
        calendarPageOrder.removeAll { $0 == month }
        calendarPageOrder.append(month)
        if calendarPageOrder.count > 12 {
            let oldest = calendarPageOrder.removeFirst()
            calendarPages.removeValue(forKey: oldest)
            projectedMonths.removeValue(forKey: oldest)
        }
        return page
    }

    func entries(on date: String) -> [PlannedOccurrence] {
        entries(in: PlannedDates.month(date)).filter { $0.displayDate == date }
    }

    func isKnownEmptyDay(_ date: String) -> Bool {
        guard !isLoading, errorMessage == nil, data != nil else { return false }
        return entries(on: date).isEmpty
    }

    func selectMonth(_ month: Int) {
        guard month != selectedMonth, (1900...9998).contains(month / 100),
            (1...12).contains(month % 100), data == nil || months.contains(month)
        else { return }
        selectedMonth = month
    }

    func start() {
        isActive = true
        guard subscription == nil || subscribedDay != today else { return }
        watch()
    }

    func stop() {
        isActive = false
        generation = UUID()
        subscription?.cancel()
        subscription = nil
        deadline?.cancel()
        midnight?.cancel()
    }

    func retry() { if isActive { watch() } }
    func refreshDay() { if isActive, subscribedDay != today { watch() } }

    private func watch() {
        generation = UUID()
        let current = generation
        subscription?.cancel()
        deadline?.cancel()
        midnight?.cancel()
        errorMessage = nil
        isLoading = true
        subscribedDay = today
        deadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.generation == current else { return }
            self.errorMessage =
                L10n.string(
                    "Your scheduled transactions are taking longer to load. Check your connection and try again."
                )
        }
        subscription = subscribe(workspace.id, today).receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.generation == current else { return }
                    self.deadline?.cancel()
                    self.isLoading = false
                    if case .failure = completion {
                        self.errorMessage =
                            L10n.string(
                                "Couldn't refresh scheduled transactions. Your last loaded transactions are still here."
                            )
                    }
                },
                receiveValue: { [weak self] data in
                    guard let self, self.generation == current else { return }
                    self.deadline?.cancel()
                    let day = self.today
                    self.isLoading = false
                    self.errorMessage = nil
                    // A retained page resubscribes when it returns. Convex can
                    // replay the same snapshot: preserve month identities and
                    // their projections instead of invalidating every calendar.
                    guard self.data != data || self.presentationDay != day else { return }
                    #if DEBUG
                        let preparationStart = ContinuousClock.now
                    #endif
                    self.projectedMonths = [:]
                    self.calendarPages = [:]
                    self.calendarPageOrder = []
                    self.schedulesByID = Dictionary(
                        data.allPlannedTransactions.map { ($0.id, $0) },
                        uniquingKeysWith: { first, _ in first })
                    self.agendaEntries = PlannedProjection.timelineEntries(
                        schedules: data.allPlannedTransactions,
                        today: day, workspace: self.workspace)
                    self.timeline = PlannedTimelinePresentation(
                        entries: self.agendaEntries,
                        schedules: data.allPlannedTransactions, today: day)
                    self.presentationDay = day
                    self.data = data
                    if !self.months.contains(self.selectedMonth) {
                        self.selectedMonth = self.currentMonth
                    }
                    #if DEBUG
                        let duration = preparationStart.duration(to: .now)
                        let milliseconds =
                            Double(duration.components.seconds) * 1_000
                            + Double(duration.components.attoseconds) / 1_000_000_000_000_000
                        self.performanceLogger.debug(
                            "Prepared agenda in \(milliseconds, privacy: .public) ms; schedules=\(data.allPlannedTransactions.count, privacy: .public)"
                        )
                    #endif
                })
        let calendar = TransactionEditorDate.calendar(workspace: workspace)
        let interval = calendar.dateInterval(of: .day, for: now())
        let seconds = max(1, (interval?.end.timeIntervalSince(now()) ?? 86_400) + 1)
        midnight = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(seconds)) } catch { return }
            guard let self, self.generation == current, self.isActive else { return }
            self.watch()
        }
    }

    /// Actions always target the schedule's next occurrence, never a tapped later projection.
    func act(_ action: PlannedAction, scheduleID: String, expectedNextDate: String? = nil) async
        -> Bool
    {
        guard busyScheduleID == nil, let schedule = schedule(scheduleID),
            schedule.workspaceId == workspace.id
        else { return false }
        if action == .enter, let expectedNextDate, expectedNextDate != schedule.nextDate {
            actionError =
                L10n.string(
                    "Enter the occurrence due \(PlannedDates.label(schedule.nextDate, workspace: workspace, format: "MMM d, yyyy")) first."
                )
            return false
        }
        guard action != .pause || schedule.canPause else { return false }
        busyScheduleID = scheduleID
        actionError = nil
        defer { busyScheduleID = nil }
        do {
            let transactionID = try await performAction(
                workspace.id, scheduleID, schedule.nextDate, action)
            if action == .enter, let transactionID {
                latestEntry = .init(id: transactionID, name: schedule.name)
                undoDeadline?.cancel()
                undoDeadline = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(8)) } catch { return }
                    guard self?.latestEntry?.id == transactionID else { return }
                    self?.latestEntry = nil
                }
            }
            return true
        } catch {
            actionError =
                L10n.string(
                    "Couldn't \(action.rawValue) this scheduled transaction. Please try again.")
            return false
        }
    }

    func undoEntry() async {
        guard let latestEntry, let client, busyScheduleID == nil else { return }
        busyScheduleID = latestEntry.id
        undoDeadline?.cancel()
        defer { busyScheduleID = nil }
        do {
            let result: PlannedActionResult = try await client.mutation(
                "scheduledTransactions:undoScheduledTransactionEntry",
                with: ["workspaceId": workspace.id, "transactionId": latestEntry.id])
            guard result.success == true else { throw TransactionEditorError.saveFailed }
            self.latestEntry = nil
        } catch {
            self.latestEntry = nil
            actionError =
                L10n.string(
                    "This entry couldn't be undone. It may have changed since you recorded it.")
        }
    }

    func makeEditor(
        schedule: PlannedSchedule? = nil, date: String? = nil,
        recurrence: TransactionEditorRecurrence? = nil
    )
        -> TransactionEditorStore?
    {
        let editor: TransactionEditorStore
        if let editorFactory {
            editor = editorFactory()
        } else if let client {
            editor = TransactionEditorStore(
                workspace: workspace, convexClient: client, choicesStore: choicesStore)
        } else {
            return nil
        }
        if let schedule {
            editor.preparePlannedEdit(schedule)
        } else {
            editor.preselectPlannedDate(
                date ?? PlannedDates.preview(
                    from: today, recurrence: .daily, workspace: workspace, count: 2
                ).last ?? today, recurrence: recurrence)
        }
        return editor
    }
}

struct PlannedSaveRequest {
    let workspaceID: String
    let schedule: PlannedSchedule
    let draft: TransactionEditorDraft
    let original: TransactionEditorDraft

    var arguments: [String: ConvexEncodable?] {
        var result: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "scheduledTransactionId": schedule.id,
        ]
        if draft.recurrence != original.recurrence {
            result["recurrence"] = draft.recurrence.rawValue
        }
        if draft.entryMode != original.entryMode { result["entryMode"] = draft.entryMode.rawValue }
        if draft.status != original.status { result["entryStatus"] = draft.status.rawValue }
        if draft.dateKey != original.dateKey {
            result["date"] = draft.dateKey
            if draft.wantsToSchedule { result["enterDue"] = true }
        }
        if draft.accountID != original.accountID { result["bankAccountId"] = draft.accountID }
        if draft.transferAccountID != original.transferAccountID {
            result["transferToAccountId"] = draft.transferAccountID
        }
        if draft.merchantID != original.merchantID {
            result["merchantId"] = draft.merchantID.map { $0 as ConvexEncodable } ?? PlannedNull()
        }
        if draft.notes != original.notes {
            result["notes"] = draft.notes.isEmpty ? PlannedNull() : draft.notes
        }
        if draft.allocations != original.allocations || draft.amount != original.amount {
            result["movements"] = draft.allocations.map { allocation -> ConvexEncodable? in
                var movement: [String: ConvexEncodable?] = [
                    "amount": draft.isTransfer ? draft.amount : allocation.amount,
                    "readyToAssign": allocation.readyToAssign,
                ]
                if let id = allocation.categoryID { movement["categoryId"] = id }
                if !allocation.notes.isEmpty { movement["notes"] = allocation.notes }
                return movement
            }
        }
        return result
    }
}

private struct PlannedNull: ConvexEncodable {
    func convexEncode() throws -> String { "null" }
}
