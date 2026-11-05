import Foundation
import Observation

enum ReviewPromptMilestone: Equatable {
    case homeCompleted
    case transactionAdded(Date)
}

/// Records requests, never whether Apple displayed a prompt or a user submitted a review.
@MainActor
@Observable
final class ReviewPromptStore {
    enum Action { case founderMessage, nativeReview }

    private struct History: Codable {
        var firstUsedAt: Date
        var founderShownAt: Date?
        var founderDismissedAt: Date?
        var reviewLinkTappedAt: Date?
        var nativeRequestedAt: Date?
    }

    static let delay: TimeInterval = 24 * 60 * 60
    static let reviewURL = URL(
        string: "https://apps.apple.com/app/id6466455367?action=write-review")!

    private(set) var userID: String?
    private var history: History?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let now: () -> Date

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
    }

    func configure(userID: String) {
        guard self.userID != userID else { return }
        self.userID = userID
        history =
            defaults.data(forKey: key(userID)).flatMap {
                try? JSONDecoder().decode(History.self, from: $0)
            } ?? History(firstUsedAt: now())
        persist()
    }

    func reset() {
        userID = nil
        history = nil
    }

    func action(for milestone: ReviewPromptMilestone) -> Action? {
        guard let history, history.reviewLinkTappedAt == nil, history.nativeRequestedAt == nil
        else { return nil }
        let date = now()
        guard date.timeIntervalSince(history.firstUsedAt) >= Self.delay else { return nil }

        guard let shownAt = history.founderShownAt else {
            return milestone == .homeCompleted ? .founderMessage : nil
        }

        // If the app closed while the sheet was visible, it still counts as shown once.
        let dismissedAt = history.founderDismissedAt ?? shownAt
        let eligibleAt = dismissedAt.addingTimeInterval(Self.delay)
        guard date >= eligibleAt else { return nil }
        if case .transactionAdded(let savedAt) = milestone {
            // A blocked or backgrounded presentation must not reuse an old transaction later.
            guard savedAt >= eligibleAt, savedAt <= date, date.timeIntervalSince(savedAt) <= 120
            else { return nil }
        }
        return .nativeReview
    }

    func recordFounderShown() {
        guard history?.founderShownAt == nil else { return }
        history?.founderShownAt = now()
        persist()
    }

    func recordFounderDismissed() {
        guard history?.founderShownAt != nil, history?.founderDismissedAt == nil,
            history?.reviewLinkTappedAt == nil
        else { return }
        history?.founderDismissedAt = now()
        persist()
    }

    func recordReviewLinkTapped() {
        history?.reviewLinkTappedAt = now()
        persist()
    }

    func recordNativeRequested() {
        history?.nativeRequestedAt = now()
        persist()
    }

    private func key(_ userID: String) -> String {
        "reviewPrompt.v1.\(Data(userID.utf8).base64EncodedString())"
    }

    private func persist() {
        guard let userID, let history, let data = try? JSONEncoder().encode(history) else { return }
        defaults.set(data, forKey: key(userID))
    }
}
