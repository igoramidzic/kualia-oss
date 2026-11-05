import Foundation

nonisolated enum AppEntryRoute: Equatable {
    case loading, signIn, ready

    static func resolve(
        clerkIsLoaded: Bool, sessionID: String?, authenticatedSessionID: String?,
        isAuthenticated: Bool, isSigningOut: Bool = false, sessionRequiresRecovery: Bool = false
    ) -> Self {
        guard !isSigningOut else { return .signIn }
        guard !sessionRequiresRecovery else { return .loading }
        guard let sessionID else { return .signIn }
        guard clerkIsLoaded else { return .loading }
        return isAuthenticated && authenticatedSessionID == sessionID ? .ready : .loading
    }
}

/// Resolve onboarding before billing so a new user can experience their first budget.
/// Unknown access never reveals the financial workspace behind a paywall.
nonisolated enum AppAdmission: Equatable {
    case loading, onboarding, paywall, home, failed

    static func resolve(
        profileLoaded: Bool, onboardingCompleted: Bool,
        accessAllowed: Bool, accessNeedsPurchase: Bool, accessFailed: Bool
    ) -> Self {
        guard profileLoaded else { return .loading }
        guard onboardingCompleted else { return .onboarding }
        if accessAllowed { return .home }
        if accessNeedsPurchase { return .paywall }
        if accessFailed { return .failed }
        return .loading
    }
}

/// All startup dependencies share one loading route and one presentation lifetime.
nonisolated enum AppLaunchRoute: Equatable {
    case blocked, signIn, loading, onboarding, paywall, workspace

    static func resolve(
        entry: AppEntryRoute, hasBlocker: Bool, statusLoaded: Bool,
        admission: AppAdmission, workspaceReady: Bool
    ) -> Self {
        if hasBlocker { return .blocked }
        if entry == .signIn { return .signIn }
        guard entry == .ready, statusLoaded else { return .loading }
        switch admission {
        case .loading, .failed: return .loading
        case .onboarding: return .onboarding
        case .paywall: return .paywall
        case .home: return workspaceReady ? .workspace : .loading
        }
    }
}
