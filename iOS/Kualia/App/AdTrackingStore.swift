import Foundation
import Observation

#if os(iOS)
    import AppTrackingTransparency
    import AppsFlyerLib
    import UIKit
#endif

enum AdTrackingAuthorization: Equatable {
    case notDetermined, restricted, denied, authorized
}

@MainActor
protocol AdMeasurementReporting {
    func setTrackingAllowed(_ allowed: Bool)
    func start()
    func record(_ milestone: AdAttributionMilestone)
}

/// ATT controls identifier-based attribution and partner sharing. Limited, anonymized
/// measurement remains available after refusal; it never bypasses Apple's permission.
@MainActor
@Observable
final class AdTrackingStore {
    static let explanationKey = "advertising.trackingExplanationCompleted"
    static let pendingEventsKey = "advertising.appsflyer.pendingEvents"

    private(set) var authorization: AdTrackingAuthorization
    private(set) var isRequesting = false
    private(set) var explanationCompleted: Bool
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let readAuthorization: () -> AdTrackingAuthorization
    @ObservationIgnored private let requestAuthorization: () async -> AdTrackingAuthorization
    @ObservationIgnored private let isActive: () -> Bool
    @ObservationIgnored private let measurement: AdMeasurementReporting
    @ObservationIgnored private var sessionReady = false
    @ObservationIgnored private var started = false
    @ObservationIgnored private var graceExpired = false
    @ObservationIgnored private var graceTask: Task<Void, Never>?

    init(
        defaults: UserDefaults,
        readAuthorization: @escaping () -> AdTrackingAuthorization,
        requestAuthorization: @escaping () async -> AdTrackingAuthorization,
        isActive: @escaping () -> Bool,
        measurement: AdMeasurementReporting
    ) {
        self.defaults = defaults
        self.readAuthorization = readAuthorization
        self.requestAuthorization = requestAuthorization
        self.isActive = isActive
        self.measurement = measurement
        authorization = readAuthorization()
        explanationCompleted = defaults.bool(forKey: Self.explanationKey)
    }

    var needsOnboardingStep: Bool {
        isRequesting || (authorization == .notDetermined && !explanationCompleted)
    }

    /// SDK 7 invokes this once per ready foreground session. A short grace period lets
    /// onboarding obtain ATT before the first install request; abandoned onboarding still counts.
    func readyForSession() {
        sessionReady = true
        refresh()
        if !started && graceTask == nil && authorization == .notDetermined {
            graceTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                self?.finishConsentGracePeriod()
            }
        }
    }

    func didEnterBackground() {
        sessionReady = false
    }

    func finishConsentGracePeriod() {
        graceExpired = true
        refresh()
    }

    /// Re-read Settings before every event and foreground, including revocations.
    func refresh() {
        authorization = readAuthorization()
        measurement.setTrackingAllowed(authorization == .authorized)
        if sessionReady && isActive()
            && (authorization != .notDetermined || explanationCompleted || graceExpired || started)
        {
            measurement.start()
            sessionReady = false
            started = true
            graceTask?.cancel()
            graceTask = nil
        }
        guard started else { return }
        for value in defaults.stringArray(forKey: Self.pendingEventsKey) ?? [] {
            if let milestone = AdAttributionMilestone(rawValue: value) {
                measurement.record(milestone)
            }
        }
        defaults.removeObject(forKey: Self.pendingEventsKey)
    }

    func requestPermission() async {
        guard !isRequesting, isActive() else { return }
        authorization = readAuthorization()
        if authorization == .notDetermined {
            isRequesting = true
            authorization = await requestAuthorization()
            isRequesting = false
        }
        explanationCompleted = true
        defaults.set(true, forKey: Self.explanationKey)
        refresh()
    }

    func record(_ milestone: AdAttributionMilestone) {
        var pending = defaults.stringArray(forKey: Self.pendingEventsKey) ?? []
        if !pending.contains(milestone.rawValue) { pending.append(milestone.rawValue) }
        defaults.set(pending, forKey: Self.pendingEventsKey)
        refresh()
    }
}

#if os(iOS)
    extension AdTrackingStore {
        static let shared = AdTrackingStore(
            defaults: .standard,
            readAuthorization: { .init(ATTrackingManager.trackingAuthorizationStatus) },
            requestAuthorization: {
                .init(await ATTrackingManager.requestTrackingAuthorization())
            },
            isActive: { UIApplication.shared.applicationState == .active },
            measurement: AppsFlyerMeasurementClient())

        static func initializeSDK() {
            #if !DEBUG
                let sdk = AppsFlyerLib.shared()
                // Public SDK authentication key, not an AppsFlyer server API token.
                // Archived source: advertising SDK initialization is disabled.
                shared.refresh()
                sdk.registerSessionReadyListener { shared.readyForSession() }
            #endif
        }
    }

    extension AdTrackingAuthorization {
        fileprivate init(_ status: ATTrackingManager.AuthorizationStatus) {
            switch status {
            case .notDetermined: self = .notDetermined
            case .restricted: self = .restricted
            case .denied: self = .denied
            case .authorized: self = .authorized
            @unknown default: self = .restricted
            }
        }
    }

    @MainActor
    private final class AppsFlyerMeasurementClient: AdMeasurementReporting {
        func setTrackingAllowed(_ allowed: Bool) {
            #if !DEBUG
                let sdk = AppsFlyerLib.shared()
                sdk.disableIDFVCollection = true
                sdk.disableAdvertisingIdentifier = !allowed
                sdk.anonymizeUser = !allowed
                sdk.setSharingFilterForPartners(allowed ? nil : ["all"])
                // AppsFlyer alone manages SKAN/AdAttributionKit conversion values.
                sdk.disableSKAdNetwork = false
            #endif
        }

        func start() {
            #if !DEBUG
                AppsFlyerLib.shared().start()
            #endif
        }

        func record(_ milestone: AdAttributionMilestone) {
            #if !DEBUG
                AppsFlyerLib.shared().logEvent(milestone.rawValue, withValues: nil)
            #endif
        }
    }
#endif
