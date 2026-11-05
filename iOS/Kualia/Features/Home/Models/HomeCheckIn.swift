import Foundation

nonisolated struct HomeCheckIn: Decodable, Equatable {
    let days: Int
    let lastDate: String
    let timezone: String
    let startedAt: String

    func includes(_ date: Date) -> Bool {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date) <= lastDate
    }
}

/// Five columns and seven rows, including the pale unlit dots in the reference.
nonisolated struct HomeCheckInDigits {
    let digits: [Int]
    let digitCount: Int
    static let glyphs: [[UInt8]] = [
        [14, 17, 17, 17, 17, 17, 14],
        [4, 12, 4, 4, 4, 4, 14],
        [14, 17, 1, 2, 4, 8, 31],
        [30, 1, 1, 14, 1, 1, 30],
        [2, 6, 10, 18, 31, 2, 2],
        [31, 16, 16, 30, 1, 1, 30],
        [6, 8, 16, 30, 17, 17, 14],
        [31, 1, 2, 4, 8, 8, 8],
        [14, 17, 17, 14, 17, 17, 14],
        [14, 17, 17, 15, 1, 2, 12],
    ]

    init(days: Int, reservingDays: Int? = nil) {
        digits = String(max(0, days)).compactMap(\.wholeNumberValue)
        digitCount = max(digits.count, String(max(0, reservingDays ?? days)).count)
    }
    var columns: Int { digitCount * 6 - 1 }
    var preferredHeight: Double { digitCount == 1 ? 88 : digitCount == 2 ? 78 : 68 }
    var preferredWidth: Double { Double(columns) * preferredHeight / 7 }

    func isLit(row: Int, column: Int) -> Bool {
        let glyphColumn = column % 6
        guard glyphColumn < 5 else { return false }
        let digit = column / 6 - (digitCount - digits.count)
        guard digit >= 0 else { return false }
        return isLit(digit: digit, row: row, column: glyphColumn)
    }

    func isLit(digit: Int, row: Int, column: Int) -> Bool {
        Self.glyphs[digits[digit]][row] & (1 << (4 - column)) != 0
    }
}

/// Reveal only the newest day while reserving the final total's layout.
nonisolated enum HomeCheckInCountUp {
    static func value(days: Int, progress: Double) -> Int {
        let total = max(0, days)
        return progress >= 1 ? total : max(0, total - 1)
    }
}

/// Device-local presentation history; the server remains the source of the total.
nonisolated struct HomeCheckInHistory {
    let defaults: UserDefaults
    let userID: String

    private var key: String { "home.checkIn.lastDisplayedDays.\(userID)" }

    func initialValue(days: Int) -> Int {
        let total = max(0, days)
        guard defaults.object(forKey: key) != nil else {
            return HomeCheckInCountUp.value(days: total, progress: 0)
        }
        return min(total, max(0, defaults.integer(forKey: key)))
    }

    func recordDisplayed(days: Int) {
        defaults.set(max(0, days), forKey: key)
    }
}
