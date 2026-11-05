import Foundation
import Testing

@testable import Kualia

struct HomeCheckInTests {
    @Test func accountDayUsesTheSavedTimezoneAcrossMidnightAndTravel() throws {
        let checkIn = HomeCheckIn(
            days: 9, lastDate: "2026-09-08", timezone: "America/New_York",
            startedAt: "2026-09-01T12:00:00Z")
        let formatter = ISO8601DateFormatter()
        #expect(checkIn.includes(try #require(formatter.date(from: "2026-09-09T03:59:59Z"))))
        #expect(!checkIn.includes(try #require(formatter.date(from: "2026-09-09T04:00:00Z"))))
    }

    @Test func countDecodesServerNumbers() throws {
        let value = try JSONDecoder().decode(
            HomeCheckIn.self,
            from: Data(
                #"{"days":12,"lastDate":"2026-09-08","timezone":"UTC","startedAt":"2026-09-01T12:00:00Z"}"#
                    .utf8))
        #expect(value.days == 12)
    }

    @Test func digitsExpandAndBecomeSmallerWithoutTruncatingTheTotal() {
        let single = HomeCheckInDigits(days: 9)
        let double = HomeCheckInDigits(days: 10)
        let triple = HomeCheckInDigits(days: 100)
        #expect(single.digits == [9])
        #expect(double.digits == [1, 0])
        #expect(triple.digits == [1, 0, 0])
        #expect(double.preferredWidth > single.preferredWidth)
        #expect(triple.preferredWidth > double.preferredWidth)
        #expect(double.preferredHeight < single.preferredHeight)
        #expect(triple.preferredHeight < double.preferredHeight)
        #expect(HomeCheckInDigits(days: 12345).digits == [1, 2, 3, 4, 5])
        #expect(HomeCheckInDigits(days: 0).digits == [0])
    }

    @Test func digitsShareAContinuousGridWithOneUnlitColumnBetweenThem() {
        let number = HomeCheckInDigits(days: 123)
        #expect(number.columns == 17)
        for row in 0..<7 {
            for column in [5, 11] {
                #expect(!number.isLit(row: row, column: column))
            }
            for digit in number.digits.indices {
                for column in 0..<5 {
                    #expect(
                        number.isLit(row: row, column: digit * 6 + column)
                            == number.isLit(digit: digit, row: row, column: column))
                }
            }
        }
        #expect(HomeCheckInDigits(days: 1).columns == 5)
        #expect(HomeCheckInDigits(days: 12).columns == 11)
    }

    @Test func animationReservesFinalSizeAndLeavesLeadingDigitsUnlit() {
        for total in [12, 100, 365, 1234] {
            let final = HomeCheckInDigits(days: total)
            for value in [0, 1, 9, 10, 99, total] where value <= total {
                let frame = HomeCheckInDigits(days: value, reservingDays: total)
                #expect(frame.columns == final.columns)
                #expect(frame.preferredWidth == final.preferredWidth)
                #expect(frame.preferredHeight == final.preferredHeight)
                let leadingColumns = (frame.digitCount - frame.digits.count) * 6
                for row in 0..<7 {
                    for column in 0..<leadingColumns {
                        #expect(!frame.isLit(row: row, column: column))
                    }
                    for column in leadingColumns..<frame.columns {
                        #expect(
                            frame.isLit(row: row, column: column)
                                == HomeCheckInDigits(days: value).isLit(
                                    row: row, column: column - leadingColumns))
                    }
                }
            }
        }
    }

    @Test func countUpRevealsExactlyOneDayWithoutGoingNegative() {
        for days in [0, 1, 6, 12, 365, 12345] {
            #expect(HomeCheckInCountUp.value(days: days, progress: 0) == max(0, days - 1))
            #expect(HomeCheckInCountUp.value(days: days, progress: 1) == days)
            #expect(HomeCheckInCountUp.value(days: days, progress: 2) == days)
            let frames = (0...33).map {
                HomeCheckInCountUp.value(days: days, progress: Double($0) / 33)
            }
            #expect(frames == frames.sorted())
            #expect(frames.allSatisfy { (max(0, days - 1)...days).contains($0) })
        }
        #expect(HomeCheckInCountUp.value(days: 12, progress: 0.5) == 11)
        #expect(HomeCheckInCountUp.value(days: -1, progress: 0.5) == 0)
    }

    @Test func displayedCountSurvivesRelaunchAndOnlyNewTotalsNeedAReveal() throws {
        let suite = "HomeCheckInTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let history = HomeCheckInHistory(defaults: defaults, userID: "first")
        #expect(history.initialValue(days: 12) == 11)
        history.recordDisplayed(days: 12)

        let relaunched = HomeCheckInHistory(
            defaults: try #require(UserDefaults(suiteName: suite)), userID: "first")
        #expect(relaunched.initialValue(days: 12) == 12)
        #expect(relaunched.initialValue(days: 13) == 12)
        #expect(relaunched.initialValue(days: 15) == 12)
        // Reading or interrupting a reveal must not mark its final number as seen.
        #expect(relaunched.initialValue(days: 13) == 12)
        relaunched.recordDisplayed(days: 13)
        #expect(history.initialValue(days: 13) == 13)
        #expect(history.initialValue(days: 0) == 0)
        #expect(history.initialValue(days: 5) == 5)
        #expect(
            HomeCheckInHistory(defaults: defaults, userID: "second").initialValue(days: 12) == 11)
    }

    @Test func referenceSixHasTheCurvedTopAndClosedLowerLoop() {
        let number = HomeCheckInDigits(days: 6)
        let rows = (0..<7).map { row in
            (0..<5).map { number.isLit(digit: 0, row: row, column: $0) ? "1" : "0" }.joined()
        }
        #expect(rows == ["00110", "01000", "10000", "11110", "10001", "10001", "01110"])
        #expect(HomeCheckInDigits.glyphs.count == 10)
        #expect(HomeCheckInDigits.glyphs.allSatisfy { $0.count == 7 && $0.allSatisfy { $0 < 32 } })
    }
}
