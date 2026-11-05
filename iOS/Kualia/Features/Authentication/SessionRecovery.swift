import Foundation
import Observation

/// Distinguishes a missing local session from a server-confirmed sign-out.
nonisolated struct SessionSnapshot: Equatable {
    let isLoaded: Bool
    let id: String?
    let status: String?

    var isActive: Bool { isLoaded && id != nil && status == "active" }
    var isTerminal: Bool {
        guard let status else { return false }
        return ["abandoned", "ended", "expired", "removed", "replaced", "revoked"].contains(status)
    }
    var isAbsent: Bool { isLoaded && id == nil && status == nil }
}

@MainActor
@Observable
final class SessionRecovery {
    private var confirmedAbsent = false
    @ObservationIgnored private var attempt = 0

    func requiresRecovery(for snapshot: SessionSnapshot) -> Bool {
        if snapshot.isActive || snapshot.isTerminal { return false }
        return !(snapshot.isAbsent && confirmedAbsent)
    }

    /// Cancellation and supersession must never let an old refresh confirm a newer sign-out.
    @discardableResult
    func reconcile(
        snapshot: SessionSnapshot,
        refresh: @MainActor () async throws -> SessionSnapshot
    ) async -> Bool {
        attempt += 1
        let currentAttempt = attempt
        confirmedAbsent = false
        guard !snapshot.isActive, !snapshot.isTerminal else { return true }
        do {
            let refreshed = try await refresh()
            guard !Task.isCancelled, currentAttempt == attempt else { return false }
            confirmedAbsent = refreshed.isAbsent
            return true
        } catch {
            return false
        }
    }
}
