import ConvexMobile
import CoreGraphics
import Foundation

enum PlannedStatus: String, Decodable, CaseIterable, Identifiable {
    case upcoming, overdue, paid, skipped
    var id: String { rawValue }
    var title: String {
        switch self {
        case .upcoming: L10n.string("Upcoming")
        case .overdue: L10n.string("Overdue")
        case .paid: L10n.string("Paid")
        case .skipped: L10n.string("Skipped")
        }
    }
    var symbol: KualiaIcon {
        switch self {
        case .upcoming: .clock
        case .overdue: .warning
        case .paid: .checkCircle
        case .skipped: .skip
        }
    }
    var isOutstanding: Bool { self == .upcoming || self == .overdue }
}

struct PlannedSchedule: Decodable, Identifiable, Equatable {
    static func statusTitle(_ status: String) -> String {
        switch status {
        case "active": L10n.string("Active")
        case "paused": L10n.string("Paused")
        case "completed": L10n.string("Completed")
        default: status
        }
    }

    let _id: String
    let workspaceId: String
    let bankAccountId: String
    let transferToAccountId: String?
    let transactionType: String?
    let merchantId: String?
    let merchantName: String?
    let merchantLogoUrl: String?
    let bankAccountName: String?
    let transferToAccountName: String?
    let notes: String?
    let entryStatus: TransactionFeedStatus
    let entryMode: TransactionEditorEntryMode?
    let recurrence: TransactionEditorRecurrence
    let anchorDate: String
    let nextDate: String
    let status: String
    let movements: [Movement]

    struct Movement: Decodable, Equatable {
        @ConvexInt var amount: Int64
        let categoryId: String?
        let categoryName: String?
        let readyToAssign: Bool?
        let notes: String?
    }

    var id: String { _id }
    var isTransfer: Bool { transactionType == "transfer" }
    var isRepeating: Bool { recurrence != .once }
    var canPause: Bool { isRepeating && status == "active" }
    var mode: TransactionEditorEntryMode { entryMode ?? .automatic }
    var amount: Decimal { movements.reduce(0) { $0 + Decimal($1.amount) } }
    var name: String {
        if isTransfer {
            return L10n.string("To \(transferToAccountName ?? L10n.string("another account"))")
        }
        return merchantName ?? movements.first?.categoryName ?? L10n.string("Planned transaction")
    }
    var categorySummary: String {
        if movements.count > 1 { return L10n.string("\(movements.count) categories") }
        return movements.first?.categoryName
            ?? (movements.first?.readyToAssign == true
                ? L10n.string("Ready to Assign") : L10n.string("Uncategorized"))
    }

    func editorDraft(workspace: TransactionFeedWorkspace) throws -> TransactionEditorDraft {
        var total: Int64 = 0
        for movement in movements {
            let sum = total.addingReportingOverflow(movement.amount)
            guard !sum.overflow else { throw TransactionEditorError.amountOutOfRange }
            total = sum.partialValue
        }
        guard total != Int64.min else { throw TransactionEditorError.amountOutOfRange }
        var draft = TransactionEditorDraft(workspace: workspace, now: Date())
        draft.flow = isTransfer ? .transfer : total < 0 ? .outflow : .inflow
        draft.amount = abs(total)
        draft.merchantID = merchantId
        draft.accountID = bankAccountId
        draft.transferAccountID = transferToAccountId
        draft.dateKey = nextDate
        draft.status = entryStatus
        draft.notes = notes ?? ""
        draft.recurrence = recurrence
        draft.entryMode = mode
        draft.wantsToSchedule = true
        draft.allocations = movements.enumerated().map { index, movement in
            TransactionEditorAllocation(
                id: "planned-\(index)", amount: isTransfer ? -movement.amount : movement.amount,
                categoryID: movement.categoryId, readyToAssign: movement.readyToAssign ?? false,
                notes: movement.notes ?? "")
        }
        return draft
    }
}

struct PlannedOccurrence: Decodable, Identifiable, Equatable {
    let scheduledTransactionId: String
    let occurrenceDate: String
    let displayDate: String
    let isTransfer: Bool
    let coverage: Coverage

    struct Coverage: Decodable, Equatable {
        let status: PlannedStatus
        @ConvexInt var expectedAmount: Int64
        @ConvexInt var paidAmount: Int64
        let linkedTransactions: [LinkedTransaction]
    }
    struct LinkedTransaction: Decodable, Equatable {
        let transactionId: String
    }
    var id: String {
        "\(scheduledTransactionId):\(occurrenceDate):\(coverage.status.rawValue):\(coverage.linkedTransactions.map(\.transactionId).joined(separator: ","))"
    }
    var amount: Decimal {
        coverage.status == .paid
            ? Decimal(coverage.paidAmount) : abs(Decimal(coverage.expectedAmount))
    }
    var isIncome: Bool { !isTransfer && coverage.expectedAmount > 0 }
}

struct PlannedTimelineEntry: Identifiable {
    let occurrence: PlannedOccurrence
    let schedule: PlannedSchedule
    let row: TransactionFeedEntry
    var id: String { occurrence.id }

    init(occurrence: PlannedOccurrence, schedule: PlannedSchedule) {
        self.occurrence = occurrence
        self.schedule = schedule
        row = schedule.feedRow(
            id: occurrence.id, date: occurrence.displayDate,
            amount: occurrence.coverage.expectedAmount)
    }
}

extension PlannedSchedule {
    var pausedFeedRow: TransactionFeedEntry? {
        guard let total = Int64(NSDecimalNumber(decimal: amount).stringValue) else { return nil }
        return feedRow(id: "paused-\(id)", date: nextDate, amount: total)
    }

    /// Active occurrences and paused schedules share the same transaction-row presentation.
    func feedRow(id: String, date: String, amount expectedAmount: Int64) -> TransactionFeedEntry {
        // Scheduled transfers store a positive amount; the feed displays the source outflow.
        let amount = isTransfer && expectedAmount > 0 ? -expectedAmount : expectedAmount
        let categories =
            isTransfer
            ? []
            : movements.compactMap { movement in
                movement.readyToAssign == true
                    ? L10n.string("Ready to Assign") : movement.categoryName
            }
        return TransactionFeedEntry(
            item: .init(
                id: id, scheduledTransactionId: self.id,
                date: date,
                type: isTransfer ? .transfer : .regular, status: entryStatus,
                amount: amount, merchantName: name,
                merchantLogoUrl: merchantLogoUrl,
                bankAccountName: bankAccountName,
                transferPairAccountName: transferToAccountName,
                categoryNames: categories,
                hasUncategorized: !isTransfer
                    && movements.contains {
                        $0.categoryId == nil && $0.readyToAssign != true
                    }))
    }
}

struct PlannedTimelineSection: Identifiable {
    let id: String
    let entries: [PlannedTimelineEntry]

    static func grouped(
        occurrences: [PlannedOccurrence], schedules: [PlannedSchedule], newestFirst: Bool = false
    ) -> [Self] {
        let lookup = Dictionary(
            schedules.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let rows = occurrences.compactMap { occurrence -> PlannedTimelineEntry? in
            guard let schedule = lookup[occurrence.scheduledTransactionId] else { return nil }
            return .init(occurrence: occurrence, schedule: schedule)
        }
        return Dictionary(grouping: rows, by: { $0.occurrence.displayDate }).map { date, rows in
            Self(id: date, entries: rows.sorted { newestFirst ? $0.id > $1.id : $0.id < $1.id })
        }.sorted { newestFirst ? $0.id > $1.id : $0.id < $1.id }
    }
}

/// Only a small window participates in horizontal layout; the month picker keeps the full range.
enum PlannedCalendarWindow {
    static func months(around month: Int, range: BudgetMonthRange?) -> [Int] {
        let selected = BudgetMonth.index(month)
        let lower = max(BudgetMonth.index(range?.minYearMonth ?? 190001), selected - 2)
        let upper = min(BudgetMonth.index(range?.maxYearMonth ?? 999812), selected + 2)
        guard lower <= upper else { return [month] }
        return (lower...upper).map(BudgetMonth.fromIndex)
    }
}

/// Six complete weeks in workspace time, including the neighboring months.
enum PlannedCalendarGrid {
    struct Day: Identifiable {
        let date: Date
        let key: String
        let number: Int
        let isCurrentMonth: Bool
        var id: String { key }
    }

    static func days(in month: Int, calendar: Calendar) -> [Day] {
        guard
            let start = calendar.date(
                from: DateComponents(
                    year: month / 100, month: month % 100, day: 1, hour: 12))
        else { return [] }
        let leading = (calendar.component(.weekday, from: start) - calendar.firstWeekday + 7) % 7
        return (0..<42).compactMap { index in
            guard let date = calendar.date(byAdding: .day, value: index - leading, to: start)
            else { return nil }
            let parts = calendar.dateComponents([.year, .month, .day], from: date)
            guard let year = parts.year, let dayMonth = parts.month, let day = parts.day
            else { return nil }
            return Day(
                date: date, key: String(format: "%04d-%02d-%02d", year, dayMonth, day),
                number: day, isCurrentMonth: year * 100 + dayMonth == month)
        }
    }
}

struct PlannedCalendarPage: Identifiable {
    let id = UUID()
    let month: Int
    let firstWeekday: Int
    let entries: [PlannedOccurrence]
    let schedules: [PlannedSchedule]
}

struct PlannedTimelinePresentation {
    let allSections: [PlannedTimelineSection]
    let nextUpEntries: [PlannedTimelineEntry]
    let upcomingEntries: [PlannedTimelineEntry]
    let overdueEntries: [PlannedTimelineEntry]

    init(entries: [PlannedOccurrence], schedules: [PlannedSchedule], today: String) {
        let active = schedules.filter { $0.status == "active" }
        let nextDates = Dictionary(
            active.map { ($0.id, $0.nextDate) }, uniquingKeysWith: { first, _ in first })
        // Show each plan's actual next transaction. Later repeats are promoted by
        // the live update after entry, so every displayed row can be entered now.
        let upcoming = entries.filter {
            $0.coverage.status == .upcoming && $0.displayDate >= today
                && nextDates[$0.scheduledTransactionId] == $0.occurrenceDate
        }
        upcomingEntries = PlannedTimelineSection.grouped(
            occurrences: upcoming, schedules: active
        ).flatMap(\.entries)
        overdueEntries = PlannedTimelineSection.grouped(
            occurrences: entries.filter {
                $0.coverage.status == .overdue && $0.displayDate < today
                    && nextDates[$0.scheduledTransactionId] == $0.occurrenceDate
            }, schedules: active
        ).flatMap(\.entries)
        allSections = PlannedTimelineSection.grouped(
            occurrences: (overdueEntries + upcomingEntries).map(\.occurrence), schedules: active)
        let nextDate = upcomingEntries.first?.row.date
        nextUpEntries = upcomingEntries.filter { $0.row.date == nextDate }
    }
}

struct PlannedData: Decodable, Equatable {
    let today: String
    let availableRange: BudgetMonthRange
    let allPlannedTransactions: [PlannedSchedule]
    let plannedByMonth: [String: [PlannedOccurrence]]
    var skippedHistoryTruncated: Bool?
    func entries(in month: Int) -> [PlannedOccurrence] {
        (plannedByMonth[String(month)] ?? []).sorted {
            if $0.displayDate != $1.displayDate { return $0.displayDate < $1.displayDate }
            return $0.id < $1.id
        }
    }
}

/// Shared by the combined feed and the schedule browser. All dates use workspace time.
struct TransactionAgendaSelection: Equatable {
    var anchor: String
    var isBrowsing = false

    func dates(workspace: TransactionFeedWorkspace) -> [String] {
        let calendar = TransactionEditorDate.calendar(workspace: workspace)
        guard let date = TransactionEditorDate.date(from: anchor, workspace: workspace),
            let interval = calendar.dateInterval(of: .month, for: date)
        else { return [] }
        let count = calendar.range(of: .day, in: .month, for: date)?.count ?? 31
        return (0..<count).compactMap {
            calendar.date(byAdding: .day, value: $0, to: interval.start).map {
                TransactionEditorDate.key(from: $0, workspace: workspace)
            }
        }
    }

    func upcomingRange(today: String, workspace: TransactionFeedWorkspace) -> ClosedRange<String> {
        let calendar = TransactionEditorDate.calendar(workspace: workspace)
        let start = TransactionEditorDate.date(from: today, workspace: workspace) ?? Date()
        let end = calendar.date(byAdding: .day, value: 6, to: start) ?? start
        return today...TransactionEditorDate.key(from: end, workspace: workspace)
    }

}

/// Recurrence definitions are the cache. Browsing never asks the server to expand another month.
enum PlannedProjection {
    static func entries(
        schedules: [PlannedSchedule], today: String, range: ClosedRange<String>,
        workspace: TransactionFeedWorkspace, includesAllOverdue: Bool = false,
        limitPerSchedule: Int = 62
    ) -> [PlannedOccurrence] {
        var entries: [PlannedOccurrence] = []
        for schedule in schedules where schedule.status == "active" {
            guard TransactionEditorDate.date(from: schedule.nextDate, workspace: workspace) != nil,
                TransactionEditorDate.date(from: schedule.anchorDate, workspace: workspace) != nil
            else { continue }
            var total: Int64 = 0
            var overflow = false
            for movement in schedule.movements {
                let sum = total.addingReportingOverflow(movement.amount)
                total = sum.partialValue
                overflow = overflow || sum.overflow
            }
            guard !overflow else { continue }
            func occurrence(_ date: String, _ status: PlannedStatus) -> PlannedOccurrence {
                .init(
                    scheduledTransactionId: schedule.id, occurrenceDate: date, displayDate: date,
                    isTransfer: schedule.isTransfer,
                    coverage: .init(
                        status: status, expectedAmount: total, paidAmount: 0, linkedTransactions: []
                    ))
            }
            if schedule.nextDate < today
                && (includesAllOverdue || range.contains(schedule.nextDate))
            {
                entries.append(occurrence(schedule.nextDate, .overdue))
            }
            var next = firstOccurrence(
                schedule: schedule, onOrAfter: max(today, range.lowerBound), workspace: workspace)
            // Month projections are bounded; the timeline seeks the next occurrence per plan.
            for _ in 0..<max(0, min(limitPerSchedule, 62)) {
                guard let date = next, date <= range.upperBound else { break }
                entries.append(occurrence(date, .upcoming))
                next =
                    PlannedDates.preview(
                        from: date, recurrence: schedule.recurrence,
                        anchor: schedule.anchorDate, workspace: workspace, count: 2
                    ).dropFirst().first
            }
        }
        return entries.sorted {
            $0.displayDate == $1.displayDate ? $0.id < $1.id : $0.displayDate < $1.displayDate
        }
    }

    static func timelineEntries(
        schedules: [PlannedSchedule], today: String, workspace: TransactionFeedWorkspace
    ) -> [PlannedOccurrence] {
        // The timeline uses only each plan's actual next occurrence. Calendar repeats
        // are expanded separately, on demand, by entries(in:) in PlannedStore.
        schedules.compactMap { schedule -> PlannedOccurrence? in
            guard schedule.status == "active",
                TransactionEditorDate.date(from: schedule.nextDate, workspace: workspace) != nil,
                TransactionEditorDate.date(from: schedule.anchorDate, workspace: workspace) != nil
            else { return nil }
            var total: Int64 = 0
            for movement in schedule.movements {
                let sum = total.addingReportingOverflow(movement.amount)
                guard !sum.overflow else { return nil }
                total = sum.partialValue
            }
            return .init(
                scheduledTransactionId: schedule.id, occurrenceDate: schedule.nextDate,
                displayDate: schedule.nextDate, isTransfer: schedule.isTransfer,
                coverage: .init(
                    status: schedule.nextDate < today ? .overdue : .upcoming,
                    expectedAmount: total, paidAmount: 0, linkedTransactions: []))
        }.sorted {
            $0.displayDate == $1.displayDate
                ? $0.id < $1.id : $0.displayDate < $1.displayDate
        }
    }

    static func firstOccurrence(
        schedule: PlannedSchedule, onOrAfter start: String,
        workspace: TransactionFeedWorkspace
    ) -> String? {
        let from = schedule.nextDate
        guard from < start else { return from }
        guard schedule.recurrence != .once else { return nil }
        let calendar = TransactionEditorDate.calendar(workspace: workspace)
        guard let fromDate = TransactionEditorDate.date(from: from, workspace: workspace),
            let startDate = TransactionEditorDate.date(from: start, workspace: workspace),
            let anchorDate = TransactionEditorDate.date(
                from: schedule.anchorDate, workspace: workspace)
        else { return nil }
        let days: Int? =
            switch schedule.recurrence {
            case .daily: 1
            case .weekly: 7
            case .everyOtherWeek: 14
            case .everyThreeWeeks: 21
            case .everyFourWeeks: 28
            default: nil
            }
        if let days {
            let distance = calendar.dateComponents([.day], from: fromDate, to: startDate).day ?? 0
            return calendar.date(
                byAdding: .day, value: ((distance + days - 1) / days) * days, to: fromDate
            )
            .map { TransactionEditorDate.key(from: $0, workspace: workspace) }
        }
        if schedule.recurrence == .twiceAMonth {
            guard let month = calendar.dateInterval(of: .month, for: startDate)?.start,
                let previous = calendar.date(byAdding: .day, value: -1, to: month)
            else { return nil }
            return PlannedDates.preview(
                from: TransactionEditorDate.key(from: previous, workspace: workspace),
                recurrence: .twiceAMonth, anchor: schedule.anchorDate, workspace: workspace,
                count: 4
            )
            .first { $0 >= start }
        }
        let step: Int =
            switch schedule.recurrence {
            case .everyOtherMonth: 2
            case .quarterly: 3
            case .everyFourMonths: 4
            case .twiceAYear: 6
            case .yearly: 12
            case .everyOtherYear: 24
            default: 1
            }
        guard let sourceMonth = calendar.dateInterval(of: .month, for: fromDate)?.start,
            let targetMonth = calendar.dateInterval(of: .month, for: startDate)?.start
        else { return nil }
        let distance =
            calendar.dateComponents([.month], from: sourceMonth, to: targetMonth).month ?? 0
        guard
            let month = calendar.date(
                byAdding: .month, value: (distance / step) * step, to: sourceMonth),
            let daysInMonth = calendar.range(of: .day, in: .month, for: month),
            let date = calendar.date(
                byAdding: .day,
                value: min(calendar.component(.day, from: anchorDate), daysInMonth.count) - 1,
                to: month)
        else { return nil }
        let jumped = TransactionEditorDate.key(from: date, workspace: workspace)
        if jumped >= start { return jumped }
        return PlannedDates.preview(
            from: jumped, recurrence: schedule.recurrence,
            anchor: schedule.anchorDate, workspace: workspace, count: 2
        ).dropFirst().first
    }
}

enum TransactionCalendarInitials {
    static func text(for name: String) -> String {
        let letters = name.split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(String(letters).uppercased().prefix(2))
    }
}

struct TransactionCalendarDayPreview {
    let planned: [PlannedOccurrence]
    var visible: [PlannedOccurrence] { Array(planned.prefix(2)) }
    var hasOverdue: Bool { planned.contains { $0.coverage.status == .overdue } }
    var additionalCount: Int { max(0, planned.count - visible.count) }
}

enum TransactionCalendarDayRoute: Equatable {
    case loading, entries, create
    static func resolve(hasPlans: Bool, plansLoaded: Bool, hasError: Bool) -> Self {
        if hasPlans || hasError { return .entries }
        return plansLoaded ? .create : .loading
    }
}

struct TransactionAgendaPreview {
    let upcoming: [PlannedOccurrence]
    let overdue: [PlannedOccurrence]

    init(entries: [PlannedOccurrence], range: ClosedRange<String>) {
        let sorted = entries.sorted {
            $0.displayDate == $1.displayDate ? $0.id < $1.id : $0.displayDate < $1.displayDate
        }
        upcoming = sorted.filter {
            $0.coverage.status == .upcoming && range.contains($0.displayDate)
        }
        overdue = sorted.filter { $0.coverage.status == .overdue }
    }

    var visible: [PlannedOccurrence] { Array(upcoming.prefix(3)) }
    var remainingCount: Int { max(0, upcoming.count - 3) }
    var outgoing: Decimal {
        upcoming.filter { !$0.isTransfer && !$0.isIncome }.reduce(0) { $0 + $1.amount }
    }
    var incoming: Decimal { upcoming.filter(\.isIncome).reduce(0) { $0 + $1.amount } }
}

/// Totals deliberately exclude skipped occurrences and transfers from money still due.
struct PlannedMonthSummary {
    let remaining: Decimal
    let incoming: Decimal
    let paid: Decimal
    let overdueCount: Int
    let completedCount: Int
    let totalCount: Int

    init(entries: [PlannedOccurrence]) {
        remaining = entries.filter {
            !$0.isTransfer && !$0.isIncome && $0.coverage.status.isOutstanding
        }.reduce(0) { $0 + $1.amount }
        incoming = entries.filter {
            $0.isIncome && $0.coverage.status.isOutstanding
        }.reduce(0) { $0 + $1.amount }
        paid = entries.filter {
            !$0.isTransfer && !$0.isIncome && $0.coverage.status == .paid
        }.reduce(0) { $0 + $1.amount }
        overdueCount = entries.filter { $0.coverage.status == .overdue }.count
        completedCount = entries.filter { !$0.coverage.status.isOutstanding }.count
        totalCount = entries.count
    }
}

enum PlannedDates {
    static func month(_ key: String) -> Int {
        Int(key.prefix(7).replacingOccurrences(of: "-", with: "")) ?? 200001
    }

    static func key(month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", month / 100, month % 100, day)
    }

    static func label(
        _ key: String, workspace: TransactionFeedWorkspace, format: String = "MMM d"
    )
        -> String
    {
        guard let date = TransactionEditorDate.date(from: key, workspace: workspace) else {
            return key
        }
        let formatter = DateFormatter()
        formatter.locale = L10n.locale
        formatter.calendar = TransactionEditorDate.calendar(workspace: workspace)
        formatter.timeZone = formatter.calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate(format)
        return formatter.string(from: date)
    }

    static func dueLabel(
        _ key: String, today: String, workspace: TransactionFeedWorkspace
    ) -> String {
        label(
            key, workspace: workspace,
            format: key.prefix(4) == today.prefix(4)
                ? "MMM d" : "MMM d yyyy")
    }

    /// Matches the server's anchored calendar arithmetic, including Jan 31 and Feb 29.
    static func preview(
        from first: String, recurrence: TransactionEditorRecurrence, anchor: String? = nil,
        workspace: TransactionFeedWorkspace, count: Int = 3
    ) -> [String] {
        let calendar = TransactionEditorDate.calendar(workspace: workspace)
        guard let firstDate = TransactionEditorDate.date(from: first, workspace: workspace),
            let anchorDate = TransactionEditorDate.date(
                from: anchor ?? first, workspace: workspace), count > 0
        else { return [] }
        var dates = [first]
        var current = firstDate
        let anchorDay = calendar.component(.day, from: anchorDate)
        while dates.count < min(count, 12), recurrence != .once {
            let days: Int? =
                switch recurrence {
                case .daily: 1
                case .weekly: 7
                case .everyOtherWeek: 14
                case .everyThreeWeeks: 21
                case .everyFourWeeks: 28
                default: nil
                }
            let next: Date?
            if let days {
                next = calendar.date(byAdding: .day, value: days, to: current)
            } else if recurrence == .twiceAMonth {
                let partner = anchorDay <= 15 ? anchorDay + 15 : anchorDay - 15
                let monthStart = calendar.dateInterval(of: .month, for: current)?.start ?? current
                var candidates: [Date] = []
                for offset in 0...1 {
                    guard
                        let month = calendar.date(byAdding: .month, value: offset, to: monthStart),
                        let range = calendar.range(of: .day, in: .month, for: month)
                    else { continue }
                    for day in [anchorDay, partner] {
                        if let date = calendar.date(
                            byAdding: .day, value: min(day, range.count) - 1, to: month),
                            TransactionEditorDate.key(from: date, workspace: workspace) > dates
                                .last!
                        {
                            candidates.append(date)
                        }
                    }
                }
                next = candidates.min()
            } else {
                let months: Int =
                    switch recurrence {
                    case .everyOtherMonth: 2
                    case .quarterly: 3
                    case .everyFourMonths: 4
                    case .twiceAYear: 6
                    case .yearly: 12
                    case .everyOtherYear: 24
                    default: 1
                    }
                let start = calendar.dateInterval(of: .month, for: current)?.start ?? current
                if let month = calendar.date(byAdding: .month, value: months, to: start),
                    let range = calendar.range(of: .day, in: .month, for: month)
                {
                    next = calendar.date(
                        byAdding: .day, value: min(anchorDay, range.count) - 1, to: month)
                } else {
                    next = nil
                }
            }
            guard let next else { break }
            current = next
            dates.append(TransactionEditorDate.key(from: next, workspace: workspace))
        }
        return dates
    }
}

struct PlannedDayPreview {
    let entries: [PlannedOccurrence]
    var visibleEntries: [PlannedOccurrence] { Array(entries.prefix(2)) }
    var additionalCount: Int { max(entries.count - 2, 0) }
}

extension TransactionEditorRecurrence {
    var plannedBadgeTitle: String {
        switch self {
        case .once: L10n.string("Once")
        case .daily: L10n.string("1D")
        case .weekly: L10n.string("1W")
        case .everyOtherWeek: L10n.string("2W")
        case .everyThreeWeeks: L10n.string("3W")
        case .everyFourWeeks: L10n.string("4W")
        case .twiceAMonth: L10n.string("2×/M")
        case .monthly: L10n.string("1M")
        case .everyOtherMonth: L10n.string("2M")
        case .quarterly: L10n.string("3M")
        case .everyFourMonths: L10n.string("4M")
        case .twiceAYear: L10n.string("6M")
        case .yearly: L10n.string("1Y")
        case .everyOtherYear: L10n.string("2Y")
        }
    }
}
