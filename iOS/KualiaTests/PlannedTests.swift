import Combine
import ConvexMobile
import CoreGraphics
import Foundation
import SwiftUI
import Testing

@testable import Kualia

@MainActor
struct PlannedCalendarGridTests {
    @Test func calendarUsesOnlyPlannedOccurrences() {
        let workspace = TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        let page = PlannedCalendarPage(
            month: 202609, firstWeekday: 1, entries: [], schedules: [])
        let view = PlannedCalendarPageView(
            page: page, workspace: workspace, today: "2026-09-08", onSelectDay: { _ in })
        #expect(view.calendar.entries.isEmpty)
        #expect(view.calendar.month == 202609)
        #expect(view.calendar.showsMerchantLogos)
    }

    @Test(arguments: [1, 2, 7], ["America/New_York", "Europe/Berlin", "Pacific/Auckland"])
    func sixCompleteWeeksIncludeEachDayOnceAcrossLeapYearsAndDaylightSaving(
        firstWeekday: Int, timezone: String
    ) throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: timezone))
        calendar.firstWeekday = firstWeekday
        for month in [202601, 202602, 202603, 202608, 202609, 202611, 202612, 202802] {
            let days = PlannedCalendarGrid.days(in: month, calendar: calendar)
            #expect(days.count == 42)
            #expect(Set(days.map(\.key)).count == 42)
            let first = try #require(days.first)
            #expect(calendar.component(.weekday, from: first.date) == firstWeekday)
            let current = days.filter(\.isCurrentMonth)
            let start = try #require(current.first)
            let monthLength = try #require(calendar.range(of: .day, in: .month, for: start.date))
            #expect(current.map(\.number) == Array(monthLength))
            for (previous, next) in zip(days, days.dropFirst()) {
                #expect(
                    calendar.dateComponents([.day], from: previous.date, to: next.date).day == 1)
            }
        }
    }

    @Test func calendarIconsDistinguishEveryRepeatPatternFromOneTime() {
        #expect(TransactionEditorRecurrence.once.calendarIcon == .calendarFilled)
        for recurrence in TransactionEditorRecurrence.allCases where recurrence != .once {
            #expect(recurrence.calendarIcon == .calendarRepeating)
        }
    }

    @Test func merchantInitialsUseAtMostTwoLetters() {
        #expect(TransactionCalendarInitials.text(for: "Whole Foods Market") == "WF")
        #expect(TransactionCalendarInitials.text(for: "  trader’s   joe’s  ") == "TJ")
        #expect(TransactionCalendarInitials.text(for: "Netflix") == "N")
        #expect(TransactionCalendarInitials.text(for: "école Montréal") == "ÉM")
        #expect(TransactionCalendarInitials.text(for: "ß shop").count == 2)
        #expect(TransactionCalendarInitials.text(for: "  \n ") == "?")
    }

    @Test func paddingDatesCrossMonthAndYearBoundaries() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        calendar.firstWeekday = 1
        let september = PlannedCalendarGrid.days(in: 202609, calendar: calendar)
        #expect(september.first?.key == "2026-08-30")
        #expect(september.last?.key == "2026-10-10")
        #expect(september.filter { !$0.isCurrentMonth }.count == 12)
        let january = PlannedCalendarGrid.days(in: 202601, calendar: calendar)
        #expect(january.first?.key == "2025-12-28")
        #expect(january.last?.key == "2026-02-07")
        // Even a February that starts on the first weekday fills all six rows.
        let february = PlannedCalendarGrid.days(in: 202602, calendar: calendar)
        #expect(february.first?.key == "2026-02-01")
        #expect(february.last?.key == "2026-03-14")
        calendar.firstWeekday = 2
        let monday = PlannedCalendarGrid.days(in: 202609, calendar: calendar)
        #expect(monday.first?.key == "2026-08-31")
        #expect(monday.last?.key == "2026-10-11")
    }
}

@Suite(.serialized)
@MainActor
struct PlannedTests {
    private var workspace: TransactionFeedWorkspace {
        .init(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "America/New_York")
    }
    private var now: Date { ISO8601DateFormatter().date(from: "2026-09-06T02:00:00Z")! }

    @Test func overviewKeepsSevenUpcomingDaysAndAllRecordedHistoryAcrossMonthEnd() {
        let selection = TransactionAgendaSelection(anchor: "2026-09-30")
        #expect(
            selection.upcomingRange(today: "2026-09-30", workspace: workspace)
                == "2026-09-30"..."2026-10-06")
        #expect(selection.dates(workspace: workspace).count == 30)
    }

    @Test func emptyDayRoutingNeedsOnlyPlansAndDoesNotConfuseAnErrorWithAnEmptyDay() {
        #expect(
            TransactionCalendarDayRoute.resolve(
                hasPlans: false, plansLoaded: true, hasError: false) == .create)
        #expect(
            TransactionCalendarDayRoute.resolve(
                hasPlans: true, plansLoaded: true, hasError: false) == .entries)
        #expect(
            TransactionCalendarDayRoute.resolve(
                hasPlans: false, plansLoaded: false, hasError: false) == .loading)
        #expect(
            TransactionCalendarDayRoute.resolve(
                hasPlans: false, plansLoaded: true, hasError: true) == .entries)
    }

    @Test func calendarDateCreationPreservesTheChosenDateWithoutAssumingAMonthlyRepeat() {
        for date in ["2026-08-31", "2026-09-05", "2026-10-12"] {
            let editor = TransactionEditorStore(workspace: workspace, now: { now })
            editor.preselectDate(date)
            #expect(editor.draft?.dateKey == date)
            #expect(editor.draft?.recurrence == .once)
            #expect(editor.isPlanned == (date > "2026-09-05"))
            #expect(editor.draft?.wantsToSchedule == (date > "2026-09-05"))
            #expect(!editor.isDirty)
        }
    }

    @Test func calendarLogoPreviewIncludesPaidAndOverduePlansAndCountsOnlyPlans() throws {
        let upcoming = try occurrence(status: "upcoming", amount: -100)
        let paid = try occurrence(status: "paid", amount: -100)
        let overdue = try occurrence(status: "overdue", amount: -100)
        let preview = TransactionCalendarDayPreview(planned: [paid, overdue, upcoming])
        #expect(preview.visible.map(\.coverage.status) == [.paid, .overdue])
        #expect(preview.additionalCount == 1)
        #expect(preview.hasOverdue)
    }

    @Test func calendarDayIsOverdueEvenWhenItsOverdueLogoIsHidden() throws {
        let upcoming = try occurrence(status: "upcoming", amount: -100)
        let overdue = try occurrence(status: "overdue", amount: -100)
        let preview = TransactionCalendarDayPreview(
            planned: [upcoming, upcoming, overdue])
        #expect(preview.hasOverdue)
        for status in ["upcoming", "paid", "skipped"] {
            let entry = try occurrence(status: status, amount: -100)
            #expect(
                !TransactionCalendarDayPreview(
                    planned: [entry]
                ).hasOverdue)
        }
        #expect(
            !TransactionCalendarDayPreview(
                planned: []
            ).hasOverdue)
    }

    @Test func loadedCalendarOpensEmptyDaysWithoutReadingRecordedTransactions() async throws {
        let payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [try plan()], plannedByMonth: [:])
        let subject = PassthroughSubject<PlannedData, Error>()
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        #expect(!store.isKnownEmptyDay("2026-09-09"))
        subject.send(payload)
        for _ in 0..<100 where store.data == nil { await Task.yield() }
        #expect(store.isKnownEmptyDay("2026-09-09"))
        #expect(!store.isKnownEmptyDay("2026-09-08"))
        #expect(store.isKnownEmptyDay("2026-10-09"))
        subject.send(completion: .failure(TransactionEditorError.saveFailed))
        for _ in 0..<100 where store.errorMessage == nil { await Task.yield() }
        #expect(!store.isKnownEmptyDay("2026-09-09"))
        store.stop()
    }

    @Test func browsingUsesWholeMonthsAndHandlesLeapYears() {
        let selection = TransactionAgendaSelection(anchor: "2028-02-01", isBrowsing: true)
        #expect(selection.isBrowsing)
        #expect(selection.dates(workspace: workspace).count == 29)
        #expect(
            selection.upcomingRange(today: "2026-09-05", workspace: workspace)
                == "2026-09-05"..."2026-09-11")
    }

    @Test func agendaPreviewCapsRowsAndSeparatesOverduePaidAndFarFutureItems() throws {
        let entries = try [
            occurrence(status: "upcoming", amount: -2000),
            occurrence(status: "upcoming", amount: -3000),
            occurrence(status: "upcoming", amount: 40000),
            occurrence(status: "upcoming", amount: 10000, transfer: true),
            occurrence(status: "overdue", amount: -5000, date: "2026-09-01"),
            occurrence(status: "paid", amount: -7000, paid: 7000),
            occurrence(status: "skipped", amount: -9000),
            occurrence(status: "upcoming", amount: -100000, date: "2099-09-08"),
        ]
        let preview = TransactionAgendaPreview(entries: entries, range: "2026-09-05"..."2026-09-11")
        #expect(preview.visible.count == 3)
        #expect(preview.remainingCount == 1)
        #expect(preview.overdue.count == 1)
        #expect(preview.upcoming.count == 4)
        #expect(preview.outgoing == 5000)
        #expect(preview.incoming == 40000)
    }

    @Test func nextUpIncludesEveryPlanOnTheNearestDayEvenBeyondThisMonth() throws {
        let schedules =
            try (0..<6).map {
                try plan(id: "plan-\($0)", nextDate: "2029-01-08", anchorDate: "2029-01-08")
            } + [plan(id: "later", nextDate: "2029-02-01", anchorDate: "2029-02-01")]
        let entries = PlannedProjection.timelineEntries(
            schedules: schedules, today: "2026-09-06", workspace: workspace)
        let timeline = PlannedTimelinePresentation(
            entries: entries, schedules: schedules, today: "2026-09-06")
        #expect(timeline.nextUpEntries.count == 6)
        #expect(Set(timeline.nextUpEntries.map(\.row.date)) == ["2029-01-08"])
        #expect(timeline.upcomingEntries.count == 7)
        #expect(timeline.upcomingEntries.last?.schedule.id == "later")
    }

    @Test func timelineIncludesDistantNextPlansAndKeepsOverdueSeparate() throws {
        let monthly = try plan(nextDate: "2029-01-08", anchorDate: "2026-01-08")
        let overdue = try plan(recurrence: "once", nextDate: "2026-08-08", anchorDate: "2026-08-08")
        let preview = TransactionAgendaPreview(
            entries: PlannedProjection.timelineEntries(
                schedules: [monthly, overdue], today: "2026-09-30", workspace: workspace),
            range: "2026-09-30"..."9998-12-31")
        #expect(preview.visible.map(\.displayDate) == ["2029-01-08"])
        #expect(preview.overdue.map(\.displayDate) == ["2026-08-08"])
    }

    @Test func timelineDoesNotExpandDailyRepeatsButCalendarStillDoes() throws {
        let schedules = try [
            plan(id: "daily", recurrence: "daily", nextDate: "2026-09-06"),
            plan(id: "overdue", recurrence: "daily", nextDate: "2026-09-01"),
            plan(id: "paused", status: "paused", recurrence: "daily", nextDate: "2026-09-06"),
        ]
        let timeline = PlannedProjection.timelineEntries(
            schedules: schedules, today: "2026-09-06", workspace: workspace)
        #expect(timeline.map(\.scheduledTransactionId) == ["overdue", "daily"])
        #expect(timeline.map(\.displayDate) == ["2026-09-01", "2026-09-06"])
        #expect(timeline.map(\.coverage.status) == [.overdue, .upcoming])

        let calendar = PlannedProjection.entries(
            schedules: schedules, today: "2026-09-06",
            range: "2026-09-01"..."2026-09-30", workspace: workspace)
        #expect(calendar.filter { $0.scheduledTransactionId == "daily" }.count == 25)
        #expect(calendar.contains { $0.displayDate == "2026-09-30" })
    }

    @Test func calendarExistsBeforeActivityArrivesAndUpdatesTheSameMonth() async throws {
        let subject = PassthroughSubject<PlannedData, Error>()
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        let initial = store.calendarPage(in: store.selectedMonth)
        #expect(initial.month == store.currentMonth)
        #expect(initial.entries.isEmpty)
        #expect(store.calendarMonths.contains(initial.month))

        subject.send(try data())
        for _ in 0..<100 where store.data == nil { await Task.yield() }
        #expect(store.data != nil)
        let loaded = store.calendarPage(in: store.selectedMonth)
        #expect(loaded.month == initial.month)
        #expect(
            loaded.entries.filter { PlannedDates.month($0.displayDate) == initial.month }.count
                == store.entries(in: initial.month).count)
        #expect(loaded.id != initial.id)
        store.stop()
    }

    @Test func returningToAgendaKeepsItsLoadedSnapshotWhileRefreshing() async throws {
        let subject = PassthroughSubject<PlannedData, Error>()
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        subject.send(try data())
        for _ in 0..<100 where store.data == nil { await Task.yield() }
        #expect(store.data != nil)
        let page = store.calendarPage(in: store.selectedMonth)
        store.stop()
        store.start()
        #expect(store.isLoading)
        #expect(store.data != nil)
        #expect(store.calendarPage(in: store.selectedMonth).id == page.id)
        #expect(
            !TransactionFeedLoadingState.isLoading(
                feedLoaded: true, feedFailed: false, showsAgenda: true, hasWorkspace: true,
                agendaLoaded: store.data != nil, agendaFailed: false))
        store.stop()
    }

    @Test func monthChangesDoNotResubscribe() async throws {
        let payload = try data()
        var requests: [String] = []
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { id, day in
                #expect(id == workspace.id)
                #expect(day == "2026-09-05")
                requests.append(day)
                return Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            }, actionHandler: { _, _, _, _ in nil })
        store.start()
        for _ in 0..<20 where store.data == nil { await Task.yield() }
        store.selectMonth(202710)
        store.selectMonth(202710)
        #expect(requests == ["2026-09-05"])
        store.stop()
    }

    @Test func replayedAgendaSnapshotKeepsPreparedCalendarAfterReturning() async throws {
        let payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [try plan()], plannedByMonth: [:])
        let subject = PassthroughSubject<PlannedData, Error>()
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        defer { store.stop() }
        store.start()
        subject.send(payload)
        for _ in 0..<100 where store.isLoading { await Task.yield() }
        #expect(store.data != nil)
        let page = store.calendarPage(in: store.selectedMonth)
        let upcoming = store.timeline.upcomingEntries.map(\.id)

        store.stop()
        store.start()
        subject.send(payload)
        for _ in 0..<100 where store.isLoading { await Task.yield() }
        #expect(!store.isLoading)
        #expect(store.errorMessage == nil)
        #expect(store.calendarPage(in: store.selectedMonth).id == page.id)
        #expect(store.timeline.upcomingEntries.map(\.id) == upcoming)
    }

    @Test func deletingAPaymentRestoresItsOccurrenceFromTheLiveSchedule() async throws {
        let schedule = try plan(nextDate: "2026-10-08")
        let paid = try occurrence(status: "paid", amount: -1200, date: "2026-09-08")
        var payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [schedule], plannedByMonth: ["202609": [paid]])
        let subject = CurrentValueSubject<PlannedData, Error>(payload)
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        defer { store.stop() }
        store.start()
        for _ in 0..<100 where store.isLoading { await Task.yield() }
        let previous = store.calendarPage(in: 202609)
        #expect(store.entries(on: "2026-09-08").map(\.coverage.status) == [.paid])
        #expect(!store.isKnownEmptyDay("2026-09-08"))
        payload = PlannedData(
            today: payload.today, availableRange: payload.availableRange,
            allPlannedTransactions: [try plan(nextDate: "2026-09-08")], plannedByMonth: [:])
        subject.send(payload)
        for _ in 0..<100 where store.data != payload { await Task.yield() }
        #expect(store.calendarPage(in: 202609).id != previous.id)
        #expect(store.entries(on: "2026-09-08").map(\.coverage.status) == [.upcoming])
        #expect(!store.isKnownEmptyDay("2026-09-08"))
        #expect(store.timeline.upcomingEntries.map(\.occurrence.occurrenceDate) == ["2026-09-08"])
        #expect(store.entries(on: "2026-10-08").map(\.coverage.status) == [.upcoming])
    }

    @Test func reopeningAnEarlierOccurrencePreservesLaterPaymentsAndSkippedHistory() async throws {
        let paid = try occurrence(status: "paid", amount: -1200, paid: 1150, date: "2026-10-08")
        let skipped = try occurrence(status: "skipped", amount: -1200, date: "2026-11-08")
        let payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [try plan(), try plan(id: "other")],
            plannedByMonth: ["202610": [paid], "202611": [skipped]])
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in
                Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            }, actionHandler: { _, _, _, _ in nil })
        defer { store.stop() }
        store.start()
        for _ in 0..<100 where store.isLoading { await Task.yield() }

        #expect(store.entries(on: "2026-09-08").count == 2)
        for (date, status) in [("2026-10-08", PlannedStatus.paid), ("2026-11-08", .skipped)] {
            let entries = store.entries(on: date)
            #expect(entries.count == 2)
            #expect(
                entries.first { $0.scheduledTransactionId == "plan" }?.coverage.status == status)
            #expect(
                entries.first { $0.scheduledTransactionId == "other" }?.coverage.status == .upcoming
            )
        }
        #expect(store.entries(on: "2026-12-08").count == 2)
        #expect(
            store.entries(on: "2026-10-08").first { $0.scheduledTransactionId == "plan" }?.amount
                == 1150)
    }

    @Test func settledProjectionMatchingUsesTheOccurrenceDateInsteadOfThePostingDate() async throws
    {
        let paid = PlannedOccurrence(
            scheduledTransactionId: "plan", occurrenceDate: "2026-10-08", displayDate: "2026-09-30",
            isTransfer: false,
            coverage: .init(
                status: .paid, expectedAmount: -1200, paidAmount: 1200, linkedTransactions: []))
        let payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [try plan()], plannedByMonth: ["202609": [paid]])
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in
                Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            }, actionHandler: { _, _, _, _ in nil })
        defer { store.stop() }
        store.start()
        for _ in 0..<100 where store.isLoading { await Task.yield() }

        #expect(store.entries(on: "2026-09-30").map(\.coverage.status) == [.paid])
        #expect(store.entries(on: "2026-10-08").isEmpty)
        #expect(store.entries(on: "2026-11-08").map(\.coverage.status) == [.upcoming])
    }

    @Test func calendarRetainsEveryServerReopenedOccurrenceAndOverridesProjectedAmounts()
        async throws
    {
        let payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [
                try plan(recurrence: "daily", nextDate: "2026-09-01", anchorDate: "2026-09-01")
            ],
            plannedByMonth: [
                "202609": [
                    try occurrence(status: "overdue", amount: -1500, date: "2026-09-01"),
                    try occurrence(status: "overdue", amount: -1800, date: "2026-09-03"),
                    try occurrence(status: "upcoming", amount: -2000, date: "2026-09-05"),
                ]
            ])
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in
                Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            }, actionHandler: { _, _, _, _ in nil })
        defer { store.stop() }
        store.start()
        for _ in 0..<100 where store.isLoading { await Task.yield() }

        #expect(store.entries(on: "2026-09-01").map(\.amount) == [1500])
        #expect(store.entries(on: "2026-09-03").map(\.coverage.status) == [.overdue])
        #expect(store.entries(on: "2026-09-03").map(\.amount) == [1800])
        #expect(store.entries(on: "2026-09-05").map(\.amount) == [2000])
        #expect(store.entries(on: "2026-09-06").map(\.coverage.status) == [.upcoming])
    }

    @Test func changingWorkspaceDayRebuildsEvenAnIdenticalSnapshot() async throws {
        let payload = try data()
        var clock = now
        let subject = PassthroughSubject<PlannedData, Error>()
        let store = PlannedStore(
            workspace: workspace, now: { clock },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        defer { store.stop() }
        store.start()
        subject.send(payload)
        for _ in 0..<100 where store.isLoading { await Task.yield() }
        let previous = store.calendarPage(in: store.selectedMonth)

        clock = clock.addingTimeInterval(86_400)
        store.refreshDay()
        subject.send(payload)
        for _ in 0..<100 where store.isLoading { await Task.yield() }
        #expect(store.calendarPage(in: store.selectedMonth).id != previous.id)
    }

    @Test func localProjectionBrowsesThreeYearsAheadWithoutChangingUpcomingOrFetchingAgain()
        async throws
    {
        let payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 190001, maxYearMonth: 210012),
            allPlannedTransactions: [try plan()], plannedByMonth: [:])
        var requests: [String] = []
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, day in
                requests.append(day)
                return Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            }, actionHandler: { _, _, _, _ in nil })
        store.start()
        for _ in 0..<20 where store.data == nil { await Task.yield() }
        let upcoming = store.agendaEntries.map(\.id)
        #expect(
            store.agendaEntries.map(\.displayDate) == ["2026-09-08"])
        for month in [202610, 202901, 202909, 202609] {
            store.selectMonth(month)
            #expect(!store.isLoading)
            #expect(!store.entries(in: month).isEmpty)
            #expect(store.agendaEntries.map(\.id) == upcoming)
        }
        #expect(store.entries(in: 202909).map(\.displayDate) == ["2029-09-08"])
        #expect(requests == ["2026-09-05"])
        store.stop()
    }

    @Test func seekingRecurrencesMatchesTheExistingAnchoredDatesAcrossYears() throws {
        for recurrence in TransactionEditorRecurrence.allCases where recurrence != .once {
            for anchor in ["2024-01-31", "2024-02-29"] {
                let schedule = try plan(
                    recurrence: recurrence.rawValue, nextDate: anchor, anchorDate: anchor)
                for target in ["2024-02-01", "2027-03-17", "2028-02-29"] {
                    var expected = anchor
                    while expected < target {
                        expected = PlannedDates.preview(
                            from: expected, recurrence: recurrence, anchor: anchor,
                            workspace: workspace, count: 2
                        ).last!
                    }
                    #expect(
                        PlannedProjection.firstOccurrence(
                            schedule: schedule, onOrAfter: target, workspace: workspace) == expected
                    )
                }
            }
        }
    }

    @Test func localProjectionKeepsOneOverdueEntryAndOnlyTheRequestedMonth() throws {
        let daily = try plan(recurrence: "daily", nextDate: "2020-01-01", anchorDate: "2020-01-01")
        let entries = PlannedProjection.entries(
            schedules: [daily], today: "2026-09-05",
            range: "2029-09-01"..."2029-09-30", workspace: workspace)
        #expect(entries.count == 30)
        #expect(entries.allSatisfy { $0.displayDate.hasPrefix("2029-09") })
        let agenda = PlannedProjection.entries(
            schedules: [daily], today: "2026-09-05",
            range: "2026-09-05"..."2026-09-11", workspace: workspace, includesAllOverdue: true)
        #expect(
            agenda.filter { $0.coverage.status == .overdue }.map(\.displayDate) == ["2020-01-01"])
        #expect(agenda.filter { $0.coverage.status == .upcoming }.count == 7)
        for status in ["paused", "completed"] {
            #expect(
                PlannedProjection.entries(
                    schedules: [try plan(status: status)], today: "2026-09-05",
                    range: "2026-09-01"..."2026-09-30", workspace: workspace
                ).isEmpty)
        }
    }

    @Test func compactRecurrenceBadgesKeepDifferentSchedulesDistinct() {
        let labels = TransactionEditorRecurrence.allCases.map(\.plannedBadgeTitle)
        #expect(Set(labels).count == labels.count)
        #expect(TransactionEditorRecurrence.monthly.plannedBadgeTitle == "1M")
        #expect(TransactionEditorRecurrence.everyThreeWeeks.plannedBadgeTitle == "3W")
        #expect(TransactionEditorRecurrence.twiceAMonth.plannedBadgeTitle == "2×/M")
        #expect(TransactionEditorRecurrence.everyOtherMonth.plannedBadgeTitle == "2M")
        #expect(TransactionEditorRecurrence.once.plannedBadgeTitle == "Once")
    }

    @Test func calendarPagerWindowIsBoundedAndSupportsDistantJumpsAndEdges() {
        let range = BudgetMonthRange(minYearMonth: 190001, maxYearMonth: 210012)
        #expect(
            PlannedCalendarWindow.months(around: 202609, range: range)
                == [202607, 202608, 202609, 202610, 202611])
        #expect(
            PlannedCalendarWindow.months(around: 202901, range: range)
                == [202811, 202812, 202901, 202902, 202903])
        #expect(
            PlannedCalendarWindow.months(around: 190001, range: range) == [190001, 190002, 190003])
        #expect(
            PlannedCalendarWindow.months(around: 210012, range: range) == [210010, 210011, 210012])
        var selected = 202609
        for _ in 0..<36 {
            selected = BudgetMonth.offset(selected, by: 1)
            let window = PlannedCalendarWindow.months(around: selected, range: range)
            #expect(window.count == 5)
            #expect(window[2] == selected)
        }
    }

    @Test func pausedPlansRemainVisibleWithoutOccurrencesAndUpdateWhenResumed() async throws {
        var payload = PlannedData(
            today: "2026-09-05",
            availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [
                try plan(id: "active"),
                try plan(id: "paused", status: "paused"),
                try plan(id: "completed", status: "completed"),
            ], plannedByMonth: [:])
        let subject = CurrentValueSubject<PlannedData, Error>(payload)
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        defer { store.stop() }
        for _ in 0..<100 where store.data == nil { await Task.yield() }
        #expect(store.pausedSchedules.map(\.id) == ["paused"])
        #expect(store.timeline.upcomingEntries.allSatisfy { $0.schedule.id != "paused" })
        payload = PlannedData(
            today: payload.today, availableRange: payload.availableRange,
            allPlannedTransactions: [try plan(id: "paused", status: "active")],
            plannedByMonth: [:])
        subject.send(payload)
        for _ in 0..<100 where !store.pausedSchedules.isEmpty { await Task.yield() }
        #expect(store.pausedSchedules.isEmpty)
        #expect(store.schedule("paused")?.status == "active")
    }

    @Test func sharedScheduleLookupUpdatesItsIconWhenRecurrenceChanges() async throws {
        var payload = PlannedData(
            today: "2026-09-05",
            availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [try plan(recurrence: "once")], plannedByMonth: [:])
        let subject = CurrentValueSubject<PlannedData, Error>(payload)
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        defer { store.stop() }
        for _ in 0..<100 where store.data == nil { await Task.yield() }
        #expect(store.schedule("plan")?.recurrence.calendarIcon == .calendarFilled)
        payload = PlannedData(
            today: payload.today, availableRange: payload.availableRange,
            allPlannedTransactions: [try plan(recurrence: "monthly")], plannedByMonth: [:])
        subject.send(payload)
        for _ in 0..<100 where store.schedule("plan")?.recurrence != .monthly { await Task.yield() }
        #expect(store.schedule("plan")?.recurrence.calendarIcon == .calendarRepeating)
    }

    @Test func calendarPagesIncludeVisibleNeighboringDatesAndInvalidateOnLiveData() async throws {
        let history = try ["2026-08-29", "2026-08-30", "2026-09-01", "2026-10-01"].map {
            try occurrence(status: "paid", amount: -100, date: $0)
        }
        var payload = PlannedData(
            today: "2026-09-05",
            availableRange: .init(minYearMonth: 190001, maxYearMonth: 210012),
            allPlannedTransactions: [try plan()],
            plannedByMonth: Dictionary(
                grouping: history, by: { String(PlannedDates.month($0.displayDate)) }))
        let subject = CurrentValueSubject<PlannedData, Error>(payload)
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        for _ in 0..<100 where store.data == nil { await Task.yield() }
        let first = store.calendarPage(in: 202609, firstWeekday: 1)
        #expect(store.calendarPage(in: 202609, firstWeekday: 1).id == first.id)
        #expect(
            first.entries.filter { $0.coverage.status == .paid }.map(\.displayDate) == [
                "2026-08-30", "2026-09-01", "2026-10-01",
            ])
        #expect(first.entries.contains { $0.displayDate == "2026-10-08" })
        #expect(
            store.calendarPage(in: 202610, firstWeekday: 1).entries.filter {
                $0.coverage.status == .paid
            }.map(\.displayDate) == ["2026-10-01"])
        #expect(store.calendarMonths.count == 5)
        #expect(store.months.count == 2412)
        let visibleIDs = store.timeline.nextUpEntries.map(\.id)
        store.selectMonth(202901)
        #expect(store.timeline.nextUpEntries.map(\.id) == visibleIDs)
        #expect(store.calendarPage(in: 202609, firstWeekday: 1).id == first.id)
        payload = PlannedData(
            today: payload.today, availableRange: payload.availableRange,
            allPlannedTransactions: payload.allPlannedTransactions,
            plannedByMonth: ["202608": [history[0], history[1]]])
        subject.send(payload)
        for _ in 0..<100 where store.data != payload { await Task.yield() }
        #expect(store.calendarPage(in: 202609, firstWeekday: 1).id != first.id)
        #expect(store.entries(on: "2026-09-01").isEmpty)
        let sunday = store.calendarPage(in: 202609, firstWeekday: 1)
        let monday = store.calendarPage(in: 202609, firstWeekday: 2)
        #expect(monday.id != sunday.id)
        #expect(!monday.entries.contains { $0.displayDate == "2026-08-30" })
        #expect(store.calendarPage(in: 202609, firstWeekday: 2).id == monday.id)
        let refreshed = store.calendarPage(in: 202609, firstWeekday: 1).id
        for offset in 1...13 { _ = store.calendarPage(in: BudgetMonth.offset(202609, by: offset)) }
        #expect(store.calendarPage(in: 202609, firstWeekday: 1).id != refreshed)
        store.stop()
    }

    @Test func calendarSwipeCommitsOnlyAfterSettlingAndDoesNotRealign() async {
        let paging = BudgetMonthPaging()
        paging.align(to: 202609)
        paging.beginUserScroll()
        paging.isScrolling = true
        paging.update(.init(offset: 210, width: 390), firstMonth: 202609, lastMonth: 202612)
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }
        // The halfway geometry is local to the pager. Selection is requested on idle only.
        #expect(paging.nearestMonth == 202610)
        #expect(
            abs(
                paging.titlePosition(selectedMonth: 202609)
                    - (CGFloat(BudgetMonth.index(202609)) + 210.0 / 390.0)) < 0.0001)
        #expect(paging.browsingLabel(selectedMonth: 202609, currentMonth: 202609) == "Future month")
        paging.update(.init(offset: 390, width: 390), firstMonth: 202609, lastMonth: 202612)
        let selection = paging.finishUserScroll(selectedMonth: 202609, workspaceID: "workspace")
        #expect(selection?.sourceMonth == 202609)
        #expect(selection?.destinationMonth == 202610)
        #expect(!paging.selectionNeedsAlignment(202610))
        #expect(paging.finishUserScroll(selectedMonth: 202610, workspaceID: "workspace") == nil)
    }

    @Test func calendarPreviewShowsTwoEntriesAndCountsTheRest() throws {
        let entry = try occurrence(status: "upcoming", amount: -100)
        for count in 0...5 {
            let preview = PlannedDayPreview(entries: Array(repeating: entry, count: count))
            #expect(preview.visibleEntries.count == min(count, 2))
            #expect(preview.additionalCount == max(count - 2, 0))
        }
    }

    @Test func changingCalendarMonthKeepsTheStatusFilterAndRejectsOutOfRangeMonths() async throws {
        let payload = try data()
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in
                Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        for _ in 0..<20 where store.data == nil { await Task.yield() }
        #expect(store.data != nil)
        store.filter = .paid
        store.selectMonth(202610)
        #expect(store.selectedMonth == 202610)
        #expect(store.filter == .paid)
        store.selectMonth(202001)
        #expect(store.selectedMonth == 202610)
        store.stop()
    }

    @Test func calendarCreationStartsMonthlyOnTheChosenDateWithoutADirtyDraft() {
        let editor = TransactionEditorStore(workspace: workspace, now: { now })
        editor.preselectPlannedDate("2026-11-14", recurrence: .monthly)
        #expect(editor.draft?.dateKey == "2026-11-14")
        #expect(editor.draft?.recurrence == .monthly)
        #expect(editor.draft?.entryMode == .manual)
        #expect(editor.isPlanned)
        #expect(!editor.isDirty)
    }

    @Test func daySheetEntriesIgnoreTheMonthListStatusFilter() async throws {
        let payload = PlannedData(
            today: "2026-09-05", availableRange: .init(minYearMonth: 202609, maxYearMonth: 202610),
            allPlannedTransactions: [
                try plan(id: "one", nextDate: "2026-09-08"),
                try plan(id: "plan", status: "completed"),
            ],
            plannedByMonth: [
                "202609": [
                    try occurrence(status: "paid", amount: -100, paid: 100, date: "2026-09-09")
                ]
            ])
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in
                Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        for _ in 0..<20 where store.data == nil { await Task.yield() }
        store.filter = .paid
        #expect(store.entries(on: "2026-09-08").map(\.scheduledTransactionId) == ["one"])
        #expect(store.entries(on: "2026-09-09").map(\.scheduledTransactionId) == ["plan"])
        #expect(store.entries(on: "2026-09-10").isEmpty)
        #expect(store.entries(in: 202609).count == 2)
        store.stop()
    }

    @Test func onlyActiveRepeatingPlansCanPause() throws {
        #expect(try plan().canPause)
        #expect(try !plan(status: "paused").canPause)
        #expect(try !plan(status: "completed").canPause)
        #expect(try !plan(recurrence: "once").canPause)
    }

    @Test func monthEndPreviewReturnsToTheAnchorAfterFebruary() {
        #expect(
            PlannedDates.preview(from: "2027-01-31", recurrence: .monthly, workspace: workspace)
                == ["2027-01-31", "2027-02-28", "2027-03-31"])
    }

    @Test func yearlyPreviewRestoresLeapDay() {
        #expect(
            PlannedDates.preview(
                from: "2027-02-28", recurrence: .yearly, anchor: "2024-02-29", workspace: workspace)
                == ["2027-02-28", "2028-02-29", "2029-02-28"])
    }

    @Test func twiceMonthlyUsesTheAnchoredPairAndClampsShortMonths() {
        #expect(
            PlannedDates.preview(
                from: "2027-01-31", recurrence: .twiceAMonth, workspace: workspace, count: 5)
                == ["2027-01-31", "2027-02-16", "2027-02-28", "2027-03-16", "2027-03-31"])
    }

    @Test func weeklyPreviewUsesCalendarDaysAcrossDaylightSaving() {
        #expect(
            PlannedDates.preview(from: "2026-03-01", recurrence: .weekly, workspace: workspace)
                == ["2026-03-01", "2026-03-08", "2026-03-15"])
        #expect(
            PlannedDates.preview(
                from: "2026-10-25", recurrence: .everyOtherWeek, workspace: workspace)
                == ["2026-10-25", "2026-11-08", "2026-11-22"])
    }

    @Test func oneTimeAndInvalidDatesDoNotGenerateRepeats() {
        #expect(
            PlannedDates.preview(from: "2026-09-07", recurrence: .once, workspace: workspace) == [
                "2026-09-07"
            ])
        #expect(
            PlannedDates.preview(from: "invalid", recurrence: .monthly, workspace: workspace)
                .isEmpty)
    }

    @Test func everyRepeatOptionProducesStrictlyIncreasingDates() {
        for recurrence in TransactionEditorRecurrence.allCases where recurrence != .once {
            let dates = PlannedDates.preview(
                from: "2028-02-29", recurrence: recurrence, workspace: workspace, count: 8)
            #expect(dates.count == 8)
            #expect(zip(dates, dates.dropFirst()).allSatisfy { $0 < $1 })
        }
    }

    @Test func workspaceTodayDoesNotUseTheDevicesCalendarDate() {
        #expect(TransactionEditorDate.today(workspace: workspace, now: now) == "2026-09-05")
        #expect(PlannedDates.month("2027-01-31") == 202701)
    }

    @Test func totalsExcludeSkippedIncomeAndTransfersFromRemainingExpenses() throws {
        let entries = try [
            occurrence(status: "upcoming", amount: -2000),
            occurrence(status: "overdue", amount: -3000),
            occurrence(status: "skipped", amount: -9000),
            occurrence(status: "paid", amount: -7000, paid: 6500),
            occurrence(status: "upcoming", amount: 40000),
            occurrence(status: "upcoming", amount: 10000, transfer: true),
        ]
        let summary = PlannedMonthSummary(entries: entries)
        #expect(summary.remaining == 5000)
        #expect(summary.incoming == 40000)
        #expect(summary.paid == 6500)
        #expect(summary.overdueCount == 1)
        #expect(summary.completedCount == 2)
        #expect(summary.totalCount == 6)
    }

    @Test func plannedTransfersKeepPositiveBackendAmountsAndOutgoingEditorAmounts() throws {
        let schedule = try plan(transfer: true)
        let draft = try schedule.editorDraft(workspace: workspace)
        #expect(draft.isTransfer)
        #expect(draft.signedAmount == -1200)
        #expect(draft.allocations[0].amount == -1200)
        var changed = draft
        changed.setAmount(2500)
        let request = PlannedSaveRequest(
            workspaceID: workspace.id, schedule: schedule, draft: changed, original: draft)
        let json = try request.arguments.convexEncode()
        #expect(json.contains(try Int64(2500).convexEncode()))
        #expect(!json.contains(try Int64(-2500).convexEncode()))
    }

    @Test func editingAPlanPreservesItsScheduleWithoutCreatingAnEntry() async throws {
        let schedule = try plan()
        var saved: PlannedSaveRequest?
        let store = TransactionEditorStore(
            workspace: workspace, now: { now },
            plannedSaveHandler: { request in
                saved = request
                return false
            })
        store.preparePlannedEdit(schedule)
        #expect(store.isEditingPlan)
        #expect(!store.isCreating)
        #expect(!store.isDirty)
        store.draft?.notes = "Updated note"
        #expect(store.canSave)
        #expect(await store.save())
        #expect(saved?.arguments["date"] == nil)
        #expect(saved?.arguments["movements"] == nil)
        #expect(saved?.arguments["recurrence"] == nil)
        #expect(saved?.arguments["entryMode"] == nil)
        #expect(saved?.arguments["entryStatus"] == nil)
        #expect(store.savedReceipt?.isScheduledOnly == true)
    }

    @Test func changingAPlanToTodayRequiresExplicitEntryConfirmation() throws {
        let store = TransactionEditorStore(workspace: workspace, now: { now })
        store.preparePlannedEdit(try plan())
        store.draft?.dateKey = "2026-09-05"
        store.draft?.wantsToSchedule = false
        #expect(store.requiresScheduleConfirmation)
        #expect(!store.canSave)
        #expect(store.canSaveAfterScheduleConfirmation)
        store.draft?.wantsToSchedule = true
        #expect(store.canSave)
    }

    @Test func aCompletedPlanNeedsANewDateToRestart() throws {
        let store = TransactionEditorStore(workspace: workspace, now: { now })
        store.preparePlannedEdit(try plan(status: "completed"))
        store.draft?.notes = "Restart"
        #expect(!store.canSave)
        store.draft?.dateKey = "2026-10-08"
        #expect(store.canSave)
    }

    @Test func manualModeIsTheNewPlanDefaultAndLegacyMissingModeRemainsAutomatic() throws {
        let store = TransactionEditorStore(workspace: workspace, now: { now })
        store.preselectPlannedDate("2026-09-08")
        #expect(store.isPlanned)
        #expect(store.draft?.entryMode == .manual)
        #expect(!store.isDirty)
        #expect(try plan(omitsMode: true).mode == .automatic)
    }

    @Test func subscriptionCancelsAndIgnoresLateValuesAfterLeavingThePage() async throws {
        let subject = PassthroughSubject<PlannedData, Error>()
        var subscriptions = 0
        var cancellations = 0
        var requestedToday: String?
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, today in
                subscriptions += 1
                requestedToday = today
                return subject.handleEvents(receiveCancel: { cancellations += 1 })
                    .eraseToAnyPublisher()
            }, actionHandler: { _, _, _, _ in nil })
        store.start()
        store.start()
        #expect(subscriptions == 1)
        #expect(requestedToday == "2026-09-05")
        store.stop()
        subject.send(try data())
        await Task.yield()
        #expect(store.data == nil)
        #expect(cancellations == 1)
        store.start()
        #expect(subscriptions == 2)
        store.stop()
    }

    @Test func failedPlannedSaveKeepsTheDraftForRetry() async throws {
        let store = TransactionEditorStore(
            workspace: workspace, now: { now },
            plannedSaveHandler: { _ in
                throw TransactionEditorError.saveFailed
            })
        store.preparePlannedEdit(try plan())
        store.draft?.notes = "Keep this"
        #expect(await store.save() == false)
        #expect(store.draft?.notes == "Keep this")
        #expect(store.isDirty)
        #expect(store.saveErrorMessage != nil)
    }

    @Test func allPlannedSectionsShowEveryActivePlanNearestDueFirstWithoutAHorizonLimit() throws {
        let schedules = try [
            plan(id: "far-future", nextDate: "2099-01-08", anchorDate: "2099-01-08"),
            plan(id: "same-day-b", nextDate: "2026-09-06"),
            plan(id: "overdue", recurrence: "daily", nextDate: "2026-09-01"),
            plan(id: "completed", status: "completed", nextDate: "2026-09-02"),
            plan(id: "paused", status: "paused", nextDate: "2026-09-03"),
            plan(id: "same-day-a", nextDate: "2026-09-06"),
        ]
        let timeline = PlannedTimelinePresentation(
            entries: PlannedProjection.timelineEntries(
                schedules: schedules, today: "2026-09-06", workspace: workspace),
            schedules: schedules, today: "2026-09-06")
        #expect(timeline.allSections.map(\.id) == ["2026-09-01", "2026-09-06", "2099-01-08"])
        #expect(
            timeline.allSections.map { $0.entries.map(\.schedule.id) }
                == [["overdue"], ["same-day-a", "same-day-b"], ["far-future"]])
        #expect(timeline.allSections.first?.entries.first?.occurrence.coverage.status == .overdue)
        #expect(timeline.allSections.last?.entries.first?.occurrence.coverage.status == .upcoming)
        #expect(timeline.nextUpEntries.map(\.schedule.id) == ["same-day-a", "same-day-b"])
        #expect(
            PlannedTimelinePresentation(entries: [], schedules: [], today: "2026-09-06")
                .allSections.isEmpty)
    }

    @Test func calendarSectionOnlyReservesCalendarHeightWhenExpanded() async throws {
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in Empty<PlannedData, Error>().eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        var historyPositions: [Bool: CGFloat] = [:]
        for isExpanded in [false, true] {
            let content = List {
                TransactionCalendarSection(
                    plans: store, isExpanded: .constant(isExpanded), onSelectDay: { _ in })
                TransactionAgendaView(
                    plans: store, isExpanded: .constant(false), onSelectPlan: { _ in })
                Text("Recorded history")
                    .onGeometryChange(for: CGFloat.self) {
                        $0.frame(in: .global).minY
                    } action: {
                        historyPositions[isExpanded] = $0
                    }
            }
            .listStyle(.plain).listRowSpacing(0).listSectionSpacing(0)
            .scrollContentBackground(.hidden).background(KualiaPalette.canvas)
            _ = try await HostedViewSnapshot.image(
                of: content, size: CGSize(width: 390, height: 1_000))
        }
        let collapsed = try #require(historyPositions[false])
        let expanded = try #require(historyPositions[true])
        #expect(collapsed < 200, "Collapsed Calendar and Planned leave history near the top.")
        #expect(expanded - collapsed >= 420, "Calendar expands independently of Planned.")
    }

    @Test func collapsingPlannedSectionHidesActiveAndPausedPlansAndKeepsRecordedHistory()
        async throws
    {
        let payload = PlannedData(
            today: "2026-09-05",
            availableRange: .init(minYearMonth: 202609, maxYearMonth: 202809),
            allPlannedTransactions: [
                try plan(id: "overdue", nextDate: "2026-09-01"),
                try plan(id: "active", nextDate: "2026-09-08"),
                try plan(id: "paused", status: "paused"),
            ], plannedByMonth: [:])
        let subject = CurrentValueSubject<PlannedData, Error>(payload)
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in subject.eraseToAnyPublisher() },
            actionHandler: { _, _, _, _ in nil })
        store.start()
        defer { store.stop() }
        for _ in 0..<100 where store.data == nil { await Task.yield() }
        try #require(store.timeline.allSections.count == 2)
        try #require(store.pausedSchedules.count == 1)
        var historyPositions: [Bool: CGFloat] = [:]
        for isExpanded in [false, true] {
            let content = List {
                TransactionAgendaView(
                    plans: store, isExpanded: .constant(isExpanded),
                    onSelectPlan: { _ in })
                Text("Recorded history")
                    .onGeometryChange(for: CGFloat.self) {
                        $0.frame(in: .global).minY
                    } action: {
                        historyPositions[isExpanded] = $0
                    }
            }
            .listStyle(.plain).listRowSpacing(0).listSectionSpacing(0)
            .scrollContentBackground(.hidden).background(KualiaPalette.canvas)
            _ = try await HostedViewSnapshot.image(
                of: content, size: CGSize(width: 390, height: 1_000))
        }
        let collapsed = try #require(historyPositions[false])
        let expanded = try #require(historyPositions[true])
        #expect(collapsed < 150, "Collapsing must leave only the Planned header above history.")
        #expect(expanded - collapsed >= 3 * 68, "Expansion must include active and paused rows.")
        #expect(store.timeline.allSections.flatMap(\.entries).count == 2)
        #expect(store.pausedSchedules.count == 1)
    }

    @Test func nextUpExcludesOverdueAndPausedPlansAndTheirLaterProjections() throws {
        let schedules = try [
            plan(id: "overdue", recurrence: "daily", nextDate: "2026-09-01"),
            plan(id: "paused", status: "paused", nextDate: "2026-09-06"),
            plan(id: "today", nextDate: "2026-09-06"),
            plan(id: "later", nextDate: "2026-10-01"),
        ]
        let timeline = PlannedTimelinePresentation(
            entries: PlannedProjection.timelineEntries(
                schedules: schedules, today: "2026-09-06", workspace: workspace),
            schedules: schedules, today: "2026-09-06")
        #expect(timeline.nextUpEntries.map(\.schedule.id) == ["today"])
        #expect(timeline.upcomingEntries.map(\.schedule.id) == ["today", "later"])
        #expect(timeline.overdueEntries.map(\.schedule.id) == ["overdue"])
        #expect(timeline.overdueEntries.allSatisfy { $0.occurrence.coverage.status == .overdue })
        #expect(timeline.upcomingEntries.allSatisfy { $0.occurrence.coverage.status == .upcoming })
    }

    @Test func nextUpAdvancesAfterEntryAndShowsNoOverdueFallback() throws {
        let original = try plan(recurrence: "daily", nextDate: "2026-09-06")
        let advanced = try plan(recurrence: "daily", nextDate: "2026-09-07")
        func timeline(_ schedules: [PlannedSchedule]) -> PlannedTimelinePresentation {
            .init(
                entries: PlannedProjection.timelineEntries(
                    schedules: schedules, today: "2026-09-06", workspace: workspace),
                schedules: schedules, today: "2026-09-06")
        }
        #expect(timeline([original]).nextUpEntries.map(\.row.date) == ["2026-09-06"])
        #expect(timeline([advanced]).nextUpEntries.map(\.row.date) == ["2026-09-07"])
        #expect(timeline([advanced]).upcomingEntries.count == 1)
        let overdue = try plan(nextDate: "2026-09-01")
        #expect(timeline([overdue]).nextUpEntries.isEmpty)
        #expect(timeline([overdue]).upcomingEntries.isEmpty)
        #expect(timeline([overdue]).overdueEntries.map(\.row.date) == ["2026-09-01"])
        #expect(timeline([advanced]).overdueEntries.isEmpty)
        #expect(timeline([]).nextUpEntries.isEmpty)
    }

    @Test(arguments: TransactionEditorRecurrence.allCases)
    func activeAndPausedRowsShowCompactFrequency(recurrence: TransactionEditorRecurrence) throws {
        let schedule = try plan(recurrence: recurrence.rawValue, withDisplayDetails: true)
        let occurrence = try occurrence(status: "upcoming", amount: -1200)
        let active = PlannedTimelineEntry(occurrence: occurrence, schedule: schedule)
        let pausedEntry = try #require(schedule.pausedFeedRow)
        #expect(active.row.title == pausedEntry.title)
        #expect(active.row.categoryLabels == pausedEntry.categoryLabels)
        #expect(active.row.accountSummary == pausedEntry.accountSummary)
        #expect(active.row.amount == pausedEntry.amount)
        #expect(active.row.displayLogoUrl == pausedEntry.displayLogoUrl)
        let activeRow = TransactionFeedRow(
            entry: active.row, workspace: workspace, planStatus: .upcoming, recurrence: recurrence)
        let pausedRow = TransactionFeedRow(
            entry: pausedEntry, workspace: workspace, recurrence: recurrence,
            showsPlannedDate: false, isPausedPlan: true)
        if recurrence == .once {
            #expect(activeRow.plannedTimingTitle == activeRow.plannedDateTitle)
        } else {
            #expect(activeRow.plannedTimingTitle.hasSuffix(recurrence.plannedBadgeTitle))
        }
        #expect(activeRow.plannedTimingTitle.contains(activeRow.plannedDateTitle))
        let groupedRow = TransactionFeedRow(
            entry: active.row, workspace: workspace, planStatus: .upcoming, recurrence: recurrence,
            showsPlannedDate: false)
        #expect(
            groupedRow.plannedTimingTitle
                == (recurrence == .once ? "" : recurrence.plannedBadgeTitle))
        #expect(!groupedRow.accessibilityValue.contains(groupedRow.plannedDateTitle))
        #expect(
            pausedRow.plannedTimingTitle
                == (recurrence == .once ? "Paused" : "Paused · \(recurrence.plannedBadgeTitle)"))
        #expect(pausedRow.accessibilityValue.contains("Paused"))
        #expect(pausedRow.accessibilityValue.contains(recurrence.title))
        #expect(!pausedRow.accessibilityValue.contains(pausedRow.plannedDateTitle))
        #expect(!pausedRow.accessibilityValue.contains("Pending"))
    }

    @Test func pausedTransferRowsKeepTheSourceOutflowAndAccountNames() throws {
        let schedule = try plan(transfer: true, status: "paused", withDisplayDetails: true)
        let row = try #require(schedule.pausedFeedRow)
        #expect(row.amount == -1200)
        #expect(row.title == "To Savings")
        #expect(row.categoryLabels.isEmpty)
        #expect(row.scheduledTransactionId == schedule.id)
    }

    @Test func plannedDateBadgesKeepTheDueDateAndIdentifyOverdueWithoutColor() throws {
        let schedule = try plan()
        let entry = PlannedTimelineEntry(
            occurrence: try occurrence(status: "overdue", amount: -1200, date: "2025-08-24"),
            schedule: schedule)
        let row = TransactionFeedRow(entry: entry.row, workspace: workspace, planStatus: .overdue)
        #expect(row.plannedDateTitle.hasPrefix("Overdue · "))
        #expect(row.plannedDateTitle.contains("2025"))
        #expect(row.accessibilityValue.contains(row.plannedDateTitle))
        #expect(
            PlannedDates.dueLabel("2026-09-09", today: "2026-09-06", workspace: workspace)
                == PlannedDates.label("2026-09-09", workspace: workspace))
        #expect(
            PlannedDates.dueLabel("2025-08-24", today: "2026-09-06", workspace: workspace).contains(
                "2025"))
    }

    @Test func plannedTimelineUsesFeedChipsAndGroupsByDate() throws {
        let schedule = try plan(withDisplayDetails: true)
        let dates = try [
            occurrence(status: "upcoming", amount: -1200, date: "2026-09-09"),
            occurrence(status: "upcoming", amount: -1200, date: "2026-09-08"),
        ]
        let groups = PlannedTimelineSection.grouped(occurrences: dates, schedules: [schedule])
        #expect(groups.map(\.id) == ["2026-09-08", "2026-09-09"])
        let row = try #require(groups.first?.entries.first?.row)
        #expect(row.title == "Market")
        #expect(row.categoryLabels == ["Groceries"])
        #expect(row.accountSummary == "Checking")
        #expect(row.amount == -1200)
        #expect(row.scheduledTransactionId == schedule.id)
        #expect(row.displayLogoUrl == "https://example.com/market.png")
        let accessibility = TransactionFeedRow(
            entry: row, workspace: workspace, planStatus: .upcoming
        )
        .accessibilityValue
        #expect(accessibility.contains("Planned"))
        #expect(!accessibility.contains("From plan"))
        #expect(!accessibility.contains("Pending"))
        let dayRow = TransactionFeedRow(
            entry: row, workspace: workspace, planStatus: .upcoming, showsPlannedDate: false)
        let timelineRow = TransactionFeedRow(
            entry: row, workspace: workspace, planStatus: .upcoming)
        #expect(dayRow != timelineRow)
        #expect(dayRow.accessibilityValue.contains("Planned"))
        #expect(!dayRow.accessibilityValue.contains(dayRow.plannedDateTitle))
        #expect(timelineRow.accessibilityValue.contains(timelineRow.plannedDateTitle))
        #expect(PlannedTimelineSection.grouped(occurrences: dates, schedules: []).isEmpty)
    }

    @Test func plannedFeedTransfersDisplaySourceOutflowAndIncomeStaysPositive() throws {
        let transfer = PlannedTimelineEntry(
            occurrence: try occurrence(status: "upcoming", amount: 1200, transfer: true),
            schedule: try plan(transfer: true, withDisplayDetails: true))
        #expect(transfer.row.amount == -1200)
        #expect(transfer.row.title == "To Savings")
        #expect(transfer.row.categoryLabels.isEmpty)
        #expect(!transfer.row.needsAttention)
        let income = PlannedTimelineEntry(
            occurrence: try occurrence(status: "upcoming", amount: 2400),
            schedule: try plan(withDisplayDetails: true))
        #expect(income.row.amount == 2400)
    }

    @Test func plannedSwipeEnterChecksTappedOccurrenceAndDeleteUsesScheduleID() async throws {
        let schedule = try plan()
        let payload = PlannedData(
            today: "2026-09-05",
            availableRange: .init(minYearMonth: 190001, maxYearMonth: 210012),
            allPlannedTransactions: [schedule], plannedByMonth: [:])
        var calls: [(String, String, PlannedAction)] = []
        let store = PlannedStore(
            workspace: workspace, now: { now },
            subscription: { _, _ in
                Just(payload).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            actionHandler: { _, id, date, action in
                calls.append((id, date, action))
                return action == .enter ? "entered-transaction" : nil
            })
        store.start()
        for _ in 0..<20 where store.data == nil { await Task.yield() }
        #expect(!(await store.act(.enter, scheduleID: "plan", expectedNextDate: "2026-10-08")))
        #expect(calls.isEmpty)
        #expect(store.actionError != nil)
        #expect(await store.act(.enter, scheduleID: "plan", expectedNextDate: "2026-09-08"))
        #expect(calls.first?.0 == "plan")
        #expect(calls.first?.1 == "2026-09-08")
        #expect(calls.first?.2 == .enter)
        #expect(store.latestEntry?.id == "entered-transaction")
        #expect(await store.act(.delete, scheduleID: "plan", expectedNextDate: "2026-10-08"))
        #expect(calls.last?.0 == "plan")
        #expect(calls.last?.2 == .delete)
        store.stop()
    }

    private func plan(
        id: String = "plan", transfer: Bool = false, status: String = "active",
        omitsMode: Bool = false,
        recurrence: String = "monthly", nextDate: String = "2026-09-08",
        anchorDate: String = "2026-08-08", withDisplayDetails: Bool = false
    )
        throws -> PlannedSchedule
    {
        var value: [String: ConvexEncodable?] = [
            "_id": id, "workspaceId": "workspace", "bankAccountId": "account",
            "nextDate": nextDate, "anchorDate": anchorDate, "recurrence": recurrence,
            "status": status, "entryStatus": "pending", "entryMode": "manual",
            "transactionType": transfer ? "transfer" : "regular",
            "movements": [
                [
                    "amount": Int64(transfer ? 1200 : -1200), "categoryId": "category",
                    "categoryName": withDisplayDetails ? "Groceries" : nil,
                ]
                    as [String: ConvexEncodable?]
            ] as [ConvexEncodable?],
        ]
        if withDisplayDetails {
            value["merchantName"] = "Market"
            value["merchantLogoUrl"] = "https://example.com/market.png"
            value["bankAccountName"] = "Checking"
            value["transferToAccountName"] = "Savings"
        }
        if transfer { value["transferToAccountId"] = "other-account" }
        if omitsMode { value.removeValue(forKey: "entryMode") }
        return try JSONDecoder().decode(PlannedSchedule.self, from: Data(value.convexEncode().utf8))
    }

    private func occurrence(
        status: String, amount: Int64, paid: Int64 = 0, transfer: Bool = false,
        date: String = "2026-09-08"
    )
        throws -> PlannedOccurrence
    {
        let coverage: [String: ConvexEncodable?] = [
            "status": status, "expectedAmount": amount, "paidAmount": paid,
            "linkedTransactions": [] as [ConvexEncodable?],
        ]
        let value: [String: ConvexEncodable?] = [
            "scheduledTransactionId": "plan", "occurrenceDate": date,
            "displayDate": date,
            "isTransfer": transfer, "coverage": coverage,
        ]
        return try JSONDecoder().decode(
            PlannedOccurrence.self, from: Data(value.convexEncode().utf8))
    }

    private func data() throws -> PlannedData {
        try JSONDecoder().decode(
            PlannedData.self,
            from: Data(
                """
                {"today":"2026-09-05","availableRange":{"minYearMonth":202609,"maxYearMonth":202809},
                 "allPlannedTransactions":[],"plannedByMonth":{}}
                """.utf8))
    }
}
