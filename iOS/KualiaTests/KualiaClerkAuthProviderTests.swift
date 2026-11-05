import ClerkKit
import Testing

@testable import Kualia

@MainActor
struct KualiaClerkAuthProviderTests {
    @Test
    func loginAndRefreshBothRequestTheConvexTemplate() async throws {
        var options: [Session.GetTokenOptions] = []
        let tokens = CapturedTokens()
        let provider = KualiaClerkAuthProvider(
            currentSessionID: { "session" },
            fetchToken: { request in
                options.append(request)
                return options.count == 1 ? "initial-convex-token" : "refreshed-convex-token"
            },
            signOut: {}
        )

        let initial = try await provider.loginFromCache { token in
            Task { await tokens.append(token) }
        }
        await provider.refreshSessionToken()

        #expect(initial == "initial-convex-token")
        #expect(provider.authenticatedSessionID == "session")
        #expect(options.map(\.template) == ["convex", "convex"])
        #expect(options.map(\.skipCache) == [false, false])
        for _ in 0..<20 {
            if await tokens.values.count == 1 { break }
            await Task.yield()
        }
        #expect(await tokens.values == ["refreshed-convex-token"])
    }

    @Test
    func rejectsATokenWhenItsSessionChangesDuringFetch() async {
        var sessionID = "first-session"
        let provider = KualiaClerkAuthProvider(
            currentSessionID: { sessionID },
            fetchToken: { _ in
                sessionID = "second-session"
                return "first-session-token"
            },
            signOut: {}
        )

        await #expect(throws: Error.self) {
            try await provider.loginFromCache { _ in }
        }
        #expect(provider.authenticatedSessionID == nil)
    }

    @Test
    func signOutClearsTheVerifiedSessionIdentity() async throws {
        var didSignOut = false
        let provider = KualiaClerkAuthProvider(
            currentSessionID: { "session" }, fetchToken: { _ in "convex-token" },
            signOut: { didSignOut = true })
        _ = try await provider.loginFromCache { _ in }
        try await provider.logout()
        #expect(provider.authenticatedSessionID == nil)
        #expect(didSignOut)
    }

    @Test
    func synchronizationClearsConvexWithoutRevokingClerk() async throws {
        var signOutCount = 0
        let provider = KualiaClerkAuthProvider(
            currentSessionID: { "session" }, fetchToken: { _ in "convex-token" },
            signOut: { signOutCount += 1 })
        _ = try await provider.loginFromCache { _ in }

        // Convex's logout API delegates back to AuthProvider.logout.
        await provider.clearConvexSession { try? await provider.logout() }
        #expect(provider.authenticatedSessionID == nil)
        #expect(signOutCount == 0)

        _ = try await provider.loginFromCache { _ in }
        #expect(provider.authenticatedSessionID == "session")
        try await provider.logout()
        #expect(signOutCount == 1)
    }

    @Test
    func failedRefreshDoesNotRevokeClerkOrDiscardIdentity() async throws {
        var failRefresh = false
        var didSignOut = false
        let provider = KualiaClerkAuthProvider(
            currentSessionID: { "session" },
            fetchToken: { _ in
                if failRefresh { throw CancellationError() }
                return "convex-token"
            }, signOut: { didSignOut = true })
        _ = try await provider.loginFromCache { _ in }
        failRefresh = true
        await provider.refreshSessionToken()
        #expect(provider.authenticatedSessionID == "session")
        #expect(!didSignOut)
    }

    @Test
    func loginCannotStartWhileConvexIsBeingCleared() async {
        var fetchedToken = false
        let provider = KualiaClerkAuthProvider(
            currentSessionID: { "session" },
            fetchToken: { _ in
                fetchedToken = true
                return "convex-token"
            }, signOut: {})
        await provider.clearConvexSession {
            await #expect(throws: Error.self) {
                try await provider.loginFromCache { _ in }
            }
        }
        #expect(!fetchedToken)
        #expect(provider.authenticatedSessionID == nil)
    }

    @Test
    func inFlightLoginCannotRestoreIdentityAfterLogout() async {
        var finishFetch: CheckedContinuation<String?, Never>?
        let provider = KualiaClerkAuthProvider(
            currentSessionID: { "session" },
            fetchToken: { _ in await withCheckedContinuation { finishFetch = $0 } },
            signOut: {})
        let login = Task { try await provider.loginFromCache { _ in } }
        while finishFetch == nil { await Task.yield() }
        await provider.clearConvexSession { try? await provider.logout() }
        finishFetch?.resume(returning: "late-token")
        await #expect(throws: Error.self) { try await login.value }
        #expect(provider.authenticatedSessionID == nil)
    }
}

private actor CapturedTokens {
    private(set) var values: [String?] = []

    func append(_ token: String?) {
        values.append(token)
    }
}
