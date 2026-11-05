import ClerkKit
@preconcurrency import ConvexMobile
import Foundation
import OSLog
import Observation

/// Kualia still uses Clerk's named Convex JWT template on both deployments.
@MainActor
final class KualiaClerkAuthProvider: AuthProvider {
    typealias T = String
    typealias TokenFetcher = @MainActor (Session.GetTokenOptions) async throws -> String?

    private let currentSessionID: @MainActor () -> String?
    private let fetchToken: TokenFetcher
    private let signOut: @MainActor () async throws -> Void
    private let logger = Logger(subsystem: "com.kualia.app", category: "ConvexAuth")
    private weak var client: ConvexClientWithAuth<String>?
    private var eventTask: Task<Void, Never>?
    private var onIdToken: (@Sendable (String?) -> Void)?
    private(set) var authenticatedSessionID: String?
    private var lastToken: String?
    private var isSynchronizing = false
    private var isClearingConvexSession = false
    private var authenticationGeneration = 0

    init(
        currentSessionID: @escaping @MainActor () -> String? = {
            guard Clerk.shared.isLoaded, Clerk.shared.session?.status == .active else {
                return nil
            }
            return Clerk.shared.session?.id
        },
        fetchToken: @escaping TokenFetcher = { options in
            try await Clerk.shared.session?.getToken(options)
        },
        signOut: @escaping @MainActor () async throws -> Void = {
            if Clerk.shared.session != nil {
                try await Clerk.shared.auth.signOut()
            }
        }
    ) {
        self.currentSessionID = currentSessionID
        self.fetchToken = fetchToken
        self.signOut = signOut
    }

    deinit {
        eventTask?.cancel()
    }

    func bind(client: ConvexClientWithAuth<String>) {
        self.client = client
        observeSessionRestoration()
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            let events = Clerk.shared.auth.events
            await self?.syncSession()
            for await event in events {
                guard !Task.isCancelled else { return }
                switch event {
                case .sessionChanged(let oldSession, let newSession):
                    self?.logSessionChange(from: oldSession, to: newSession)
                    await self?.syncSession()
                case .signedOut:
                    self?.logger.notice("Clerk emitted a signed-out event")
                case .tokenRefreshed:
                    // Clerk also emits default session tokens here. Fetch the named
                    // template again instead of forwarding the event's token.
                    await self?.refreshSessionToken()
                default:
                    break
                }
            }
        }
    }

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        try await authenticate(onIdToken: onIdToken)
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        try await authenticate(onIdToken: onIdToken)
    }

    func logout() async throws {
        authenticationGeneration += 1
        onIdToken = nil
        authenticatedSessionID = nil
        lastToken = nil
        // Convex calls this method from client.logout(). Session synchronization
        // clears only Convex; explicit logout retains its normal Clerk behavior.
        if !isClearingConvexSession {
            logger.notice("Explicit auth-provider sign-out requested")
            try await signOut()
        }
    }

    func clearConvexSession(_ clear: @MainActor () async -> Void) async {
        isClearingConvexSession = true
        defer { isClearingConvexSession = false }
        await clear()
    }

    private func logSessionChange(from old: Session?, to new: Session?) {
        // No identifiers, credentials, tokens, or profile data enter diagnostics.
        let knownStatuses = [
            "active", "pending", "abandoned", "ended", "expired", "removed", "replaced", "revoked",
        ]
        let oldStatus =
            old.map { knownStatuses.contains($0.status.rawValue) ? $0.status.rawValue : "unknown" }
            ?? "absent"
        let newStatus =
            new.map { knownStatuses.contains($0.status.rawValue) ? $0.status.rawValue : "unknown" }
            ?? "absent"
        let identityChanged = old?.id != new?.id
        logger.notice(
            "Clerk session transition: \(oldStatus, privacy: .public) -> \(newStatus, privacy: .public); identity changed: \(identityChanged, privacy: .public)"
        )
    }

    nonisolated func extractIdToken(from authResult: String) -> String {
        authResult
    }

    private func authenticate(
        onIdToken: @Sendable @escaping (String?) -> Void
    ) async throws -> String {
        guard !isClearingConvexSession else { throw TokenError.sessionChanged }
        let generation = authenticationGeneration
        let (sessionID, token) = try await tokenForCurrentSession(skipCache: false)
        guard generation == authenticationGeneration, !isClearingConvexSession else {
            throw TokenError.sessionChanged
        }
        self.onIdToken = onIdToken
        authenticatedSessionID = sessionID
        lastToken = token
        return token
    }

    private func tokenForCurrentSession(skipCache: Bool) async throws -> (String, String) {
        guard let sessionID = currentSessionID() else { throw TokenError.noActiveSession }
        guard let token = try await fetchToken(.init(template: "convex", skipCache: skipCache))
        else {
            throw TokenError.missingToken
        }
        guard currentSessionID() == sessionID else { throw TokenError.sessionChanged }
        return (sessionID, token)
    }

    func reconnect() async {
        guard !isSynchronizing else { return }
        authenticatedSessionID = nil
        await syncSession()
    }

    private func syncSession() async {
        guard let client, !isSynchronizing else { return }
        isSynchronizing = true
        defer { isSynchronizing = false }
        // Serialize identity changes so an older login cannot finish after a
        // newer one and publish its authentication result over the new session.
        while !Task.isCancelled {
            let sessionID = currentSessionID()
            guard sessionID != authenticatedSessionID else { return }
            onIdToken = nil
            authenticatedSessionID = nil
            lastToken = nil
            if sessionID != nil {
                _ = await client.loginFromCache()
            } else {
                logger.notice("Clearing Convex authentication after loss of active Clerk session")
                await clearConvexSession { await client.logout() }
            }
            guard currentSessionID() != sessionID else { return }
        }
    }

    private func observeSessionRestoration() {
        withObservationTracking {
            _ = Clerk.shared.isLoaded
            _ = Clerk.shared.session?.id
            _ = Clerk.shared.session?.status
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.client != nil else { return }
                self.observeSessionRestoration()
                // Client restoration and environment loading can finish in either
                // order. A session event alone is not the SDK's readiness signal.
                guard Clerk.shared.isLoaded else { return }
                await self.syncSession()
            }
        }
    }

    func refreshSessionToken() async {
        guard currentSessionID() != nil else { return }
        guard authenticatedSessionID == currentSessionID(), let onIdToken else {
            await syncSession()
            return
        }

        do {
            let generation = authenticationGeneration
            let (_, token) = try await tokenForCurrentSession(skipCache: false)
            guard generation == authenticationGeneration else { return }
            guard token != lastToken else { return }
            lastToken = token
            onIdToken(token)
        } catch {
            logger.error("Could not refresh the Convex session: \(error.localizedDescription)")
        }
    }

    private enum TokenError: LocalizedError {
        case noActiveSession
        case missingToken
        case sessionChanged

        var errorDescription: String? {
            switch self {
            case .noActiveSession: L10n.string("There is no active sign-in session.")
            case .missingToken: L10n.string("Clerk could not provide a Convex access token.")
            case .sessionChanged: L10n.string("The sign-in session changed while connecting.")
            }
        }
    }
}
