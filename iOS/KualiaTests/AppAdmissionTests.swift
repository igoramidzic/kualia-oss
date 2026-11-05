import XCTest

@testable import Kualia

final class AppAdmissionTests: XCTestCase {
    func testSessionRecoveryHidesWorkspaceWithoutShowingLogin() {
        for sessionID in [nil, "session"] {
            let route = AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: sessionID,
                authenticatedSessionID: "session", isAuthenticated: true,
                sessionRequiresRecovery: true)
            XCTAssertEqual(route, .loading)
            XCTAssertEqual(launch(entry: route, workspaceReady: true), .loading)
        }
        XCTAssertEqual(
            AppEntryRoute.resolve(
                clerkIsLoaded: false, sessionID: nil, authenticatedSessionID: nil,
                isAuthenticated: false, isSigningOut: true, sessionRequiresRecovery: true), .signIn)
    }
    func testPendingSignOutHidesAnAuthenticatedWorkspaceUntilItFinishes() {
        let entry = AppEntryRoute.resolve(
            clerkIsLoaded: true, sessionID: "active",
            authenticatedSessionID: "active", isAuthenticated: true, isSigningOut: true)
        XCTAssertEqual(entry, .signIn)
        XCTAssertEqual(launch(entry: entry, workspaceReady: true), .signIn)
        // A failed sign-out can restore the still-valid session for retry.
        XCTAssertEqual(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: "active",
                authenticatedSessionID: "active", isAuthenticated: true, isSigningOut: false),
            .ready)
        XCTAssertEqual(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: nil,
                authenticatedSessionID: "active", isAuthenticated: true, isSigningOut: false),
            .signIn)
    }

    func testNewUserOnboardsBeforeSubscription() {
        XCTAssertEqual(route(loaded: true, completed: false, needsPurchase: true), .onboarding)
        XCTAssertEqual(route(loaded: true, completed: false, allowed: true), .onboarding)
    }

    func testReturningUserMustHaveAccess() {
        XCTAssertEqual(route(loaded: true, completed: true, needsPurchase: true), .paywall)
        XCTAssertEqual(route(loaded: true, completed: true, allowed: true), .home)
        XCTAssertEqual(route(loaded: true, completed: true), .loading)
        XCTAssertEqual(route(loaded: true, completed: true, failed: true), .failed)
    }

    func testUnknownProfileNeverRevealsHome() {
        XCTAssertEqual(route(loaded: false, completed: true, allowed: true), .loading)
    }

    func testConfirmedSignOutDoesNotWaitForPublicStatus() {
        let entry = AppEntryRoute.resolve(
            clerkIsLoaded: true, sessionID: nil,
            authenticatedSessionID: nil, isAuthenticated: false, sessionRequiresRecovery: false)
        XCTAssertEqual(entry, .signIn)
        XCTAssertEqual(
            launch(entry: entry, statusLoaded: false, admission: .loading), .signIn)
    }

    func testCachedSessionNeverFlashesLoginOrRevealsAnotherSession() {
        XCTAssertEqual(
            AppEntryRoute.resolve(
                clerkIsLoaded: false, sessionID: "cached",
                authenticatedSessionID: nil, isAuthenticated: false), .loading)
        XCTAssertEqual(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: "new",
                authenticatedSessionID: "old", isAuthenticated: true), .loading)
        XCTAssertEqual(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: "cached",
                authenticatedSessionID: "cached", isAuthenticated: true), .ready)
    }

    func testStartupUsesOneLoadingRouteAcrossAllDependenciesAndRetries() {
        let routes: [AppLaunchRoute] = [
            launch(entry: .loading, statusLoaded: false),
            launch(entry: .loading, statusLoaded: true),
            launch(statusLoaded: false),
            launch(admission: .loading),
            launch(admission: .failed),
            launch(admission: .loading),
            launch(admission: .home, workspaceReady: false),
        ]
        for route in routes { XCTAssertEqual(route, .loading) }
        XCTAssertEqual(launch(admission: .home, workspaceReady: true), .workspace)
    }

    func testLoadingRoutesToOnboardingPaywallAndAnEmptyWorkspaceList() {
        XCTAssertEqual(launch(admission: .onboarding), .onboarding)
        XCTAssertEqual(launch(admission: .paywall), .paywall)
        // No workspaces is ready to display the Settings entry point.
        XCTAssertEqual(launch(admission: .home, workspaceReady: true), .workspace)
    }

    func testKnownAppBlockersStillTakePriorityOverLoginAndWorkspace() {
        for entry in [AppEntryRoute.signIn, .loading, .ready] {
            XCTAssertEqual(
                AppLaunchRoute.resolve(
                    entry: entry, hasBlocker: true, statusLoaded: true,
                    admission: .home, workspaceReady: true), .blocked)
        }
    }

    private func launch(
        entry: AppEntryRoute = .ready, statusLoaded: Bool = true,
        admission: AppAdmission = .home, workspaceReady: Bool = false
    ) -> AppLaunchRoute {
        .resolve(
            entry: entry, hasBlocker: false, statusLoaded: statusLoaded,
            admission: admission, workspaceReady: workspaceReady)
    }

    private func route(
        loaded: Bool, completed: Bool, allowed: Bool = false,
        needsPurchase: Bool = false, failed: Bool = false
    ) -> AppAdmission {
        .resolve(
            profileLoaded: loaded, onboardingCompleted: completed, accessAllowed: allowed,
            accessNeedsPurchase: needsPurchase, accessFailed: failed)
    }
}
