import Foundation
import Testing

@testable import Kualia

@MainActor
struct AdAttributionTests {
    @Test
    func successfulMilestonesAreDeduplicatedAcrossRelaunchWithoutSuppressingOtherEvents() throws {
        let defaults = try makeDefaults()
        var events: [AdAttributionMilestone] = []
        let store = AdAttributionStore(defaults: defaults) { events.append($0) }
        store.record(.signedUp)
        store.record(.signedUp)
        store.record(.onboardingCompleted)
        let relaunched = AdAttributionStore(defaults: defaults) { events.append($0) }
        relaunched.record(.signedUp)
        relaunched.record(.trialStarted)
        relaunched.record(.subscribed)
        #expect(events == [.signedUp, .onboardingCompleted, .trialStarted, .subscribed])
    }

    @Test(arguments: [AdTrackingAuthorization.denied, .restricted, .authorized])
    func signupSurvivesEitherPermissionDecision(authorization: AdTrackingAuthorization) async throws
    {
        let defaults = try makeDefaults()
        let client = MeasurementSpy()
        var status = AdTrackingAuthorization.notDetermined
        let store = AdTrackingStore(
            defaults: defaults, readAuthorization: { status },
            requestAuthorization: {
                status = authorization
                return status
            },
            isActive: { true }, measurement: client)
        store.readyForSession()
        store.record(.signedUp)
        #expect(client.starts == 0)
        #expect(client.events.isEmpty)
        await store.requestPermission()
        #expect(client.allowed == (authorization == .authorized))
        #expect(client.starts == 1)
        #expect(client.events == [.signedUp])
        #expect(!store.needsOnboardingStep)
        store.refresh()
        #expect(client.starts == 1)
        #expect(client.events == [.signedUp])
    }

    @Test
    func abandonmentStartsLimitedMeasurementAndPermissionChangesApplyBeforeEvents() throws {
        let defaults = try makeDefaults()
        let client = MeasurementSpy()
        var status = AdTrackingAuthorization.notDetermined
        let store = AdTrackingStore(
            defaults: defaults, readAuthorization: { status },
            requestAuthorization: { status }, isActive: { true }, measurement: client)
        store.readyForSession()
        store.finishConsentGracePeriod()
        #expect(client.starts == 1)
        #expect(!client.allowed)
        #expect(store.needsOnboardingStep)
        status = .authorized
        store.record(.signedUp)
        #expect(client.eventPermissions == [true])
        status = .denied
        store.record(.onboardingCompleted)
        #expect(client.eventPermissions == [true, false])
        store.readyForSession()
        #expect(client.starts == 2)
    }

    @Test
    func sdkReadinessAndForegroundAreRequiredAndPendingEventsSurviveRelaunch() throws {
        let defaults = try makeDefaults()
        let client = MeasurementSpy()
        var active = false
        func makeStore() -> AdTrackingStore {
            AdTrackingStore(
                defaults: defaults, readAuthorization: { .denied },
                requestAuthorization: { .denied }, isActive: { active }, measurement: client)
        }
        let store = makeStore()
        store.record(.signedUp)
        store.finishConsentGracePeriod()
        #expect(client.starts == 0)
        let relaunched = makeStore()
        relaunched.readyForSession()
        #expect(client.events.isEmpty)
        active = true
        relaunched.refresh()
        #expect(client.starts == 1)
        #expect(client.events == [.signedUp])
    }

    @Test
    func backgroundInvalidatesThePreviousSessionReadiness() throws {
        let client = MeasurementSpy()
        let store = AdTrackingStore(
            defaults: try makeDefaults(), readAuthorization: { .notDetermined },
            requestAuthorization: { .notDetermined }, isActive: { true }, measurement: client)
        store.readyForSession()
        store.didEnterBackground()
        store.finishConsentGracePeriod()
        #expect(client.starts == 0)
        store.readyForSession()
        #expect(client.starts == 1)
    }

    @Test
    func inactiveAppCannotRequestPermission() async throws {
        let client = MeasurementSpy()
        var requests = 0
        let store = AdTrackingStore(
            defaults: try makeDefaults(), readAuthorization: { .notDetermined },
            requestAuthorization: {
                requests += 1
                return .authorized
            },
            isActive: { false }, measurement: client)
        await store.requestPermission()
        #expect(requests == 0)
        #expect(store.needsOnboardingStep)
    }

    private func makeDefaults() throws -> UserDefaults {
        try #require(UserDefaults(suiteName: "AdAttributionTests.\(UUID().uuidString)"))
    }
}

@MainActor
private final class MeasurementSpy: AdMeasurementReporting {
    var allowed = false
    var starts = 0
    var events: [AdAttributionMilestone] = []
    var eventPermissions: [Bool] = []
    func setTrackingAllowed(_ allowed: Bool) { self.allowed = allowed }
    func start() { starts += 1 }
    func record(_ milestone: AdAttributionMilestone) {
        events.append(milestone)
        eventPermissions.append(allowed)
    }
}
