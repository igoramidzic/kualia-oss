import Foundation

/// The only events sent for advertising measurement. Never attach account identifiers,
/// financial records, chat content, or arbitrary event properties.
enum AdAttributionMilestone: String, CaseIterable {
    case signedUp = "af_complete_registration"
    case onboardingCompleted = "af_tutorial_completion"
    case trialStarted = "af_start_trial"
    case subscribed = "af_subscribe"
}

/// Installation-wide milestones, recorded from actual successful actions, not restored state.
/// AppsFlyer owns install/session reporting and Apple's conversion-value updates.
@MainActor
final class AdAttributionStore {
    #if os(iOS)
        static let shared = AdAttributionStore(defaults: .standard) {
            AdTrackingStore.shared.record($0)
        }
    #endif

    private let defaults: UserDefaults
    private let send: (AdAttributionMilestone) -> Void

    init(defaults: UserDefaults, send: @escaping (AdAttributionMilestone) -> Void) {
        self.defaults = defaults
        self.send = send
    }

    func record(_ milestone: AdAttributionMilestone) {
        let key = "advertising.appsflyer.recorded.\(milestone.rawValue)"
        guard !defaults.bool(forKey: key) else { return }
        send(milestone)
        defaults.set(true, forKey: key)
    }
}
