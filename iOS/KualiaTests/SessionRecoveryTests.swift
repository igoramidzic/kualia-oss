import XCTest

@testable import Kualia

@MainActor
final class SessionRecoveryTests: XCTestCase {
    private let absent = SessionSnapshot(isLoaded: true, id: nil, status: nil)
    private let active = SessionSnapshot(isLoaded: true, id: "session", status: "active")

    func testMissingSessionWaitsForSuccessfulRefresh() async {
        let recovery = SessionRecovery()
        XCTAssertTrue(recovery.requiresRecovery(for: absent))
        let failed = await recovery.reconcile(snapshot: absent) {
            throw URLError(.notConnectedToInternet)
        }
        XCTAssertFalse(failed)
        XCTAssertTrue(recovery.requiresRecovery(for: absent))
        let succeeded = await recovery.reconcile(snapshot: absent) { self.absent }
        XCTAssertTrue(succeeded)
        XCTAssertFalse(recovery.requiresRecovery(for: absent))
    }

    func testTemporaryLossRestoresTheActiveSessionWithoutLogin() async {
        let recovery = SessionRecovery()
        await recovery.reconcile(snapshot: active) {
            XCTFail("Active session must not refresh")
            return self.active
        }
        XCTAssertTrue(recovery.requiresRecovery(for: absent))
        await recovery.reconcile(snapshot: absent) { self.active }
        XCTAssertFalse(recovery.requiresRecovery(for: active))
        // A later missing session requires its own confirmation.
        XCTAssertTrue(recovery.requiresRecovery(for: absent))
    }

    func testPendingAndUnknownSessionsRemainInRecovery() async {
        for status in ["pending", "future-status"] {
            let recovery = SessionRecovery()
            let snapshot = SessionSnapshot(isLoaded: true, id: "session", status: status)
            await recovery.reconcile(snapshot: snapshot) { snapshot }
            XCTAssertTrue(recovery.requiresRecovery(for: snapshot))
        }
    }

    func testTerminalStatesRequireLoginWithoutRecovery() async {
        for status in ["abandoned", "ended", "expired", "removed", "replaced", "revoked"] {
            let recovery = SessionRecovery()
            let snapshot = SessionSnapshot(isLoaded: true, id: "session", status: status)
            await recovery.reconcile(snapshot: snapshot) {
                XCTFail("Terminal session must not refresh")
                return snapshot
            }
            XCTAssertFalse(recovery.requiresRecovery(for: snapshot))
        }
    }

    func testIncompleteClerkLoadingCannotConfirmAbsence() async {
        let recovery = SessionRecovery()
        let snapshot = SessionSnapshot(isLoaded: false, id: nil, status: nil)
        await recovery.reconcile(snapshot: snapshot) { snapshot }
        XCTAssertTrue(recovery.requiresRecovery(for: snapshot))
        XCTAssertTrue(recovery.requiresRecovery(for: absent))
    }

    func testSupersededRefreshCannotConfirmSignOut() async {
        let recovery = SessionRecovery()
        var finish: CheckedContinuation<SessionSnapshot, Never>?
        let oldRefresh = Task {
            await recovery.reconcile(snapshot: absent) {
                await withCheckedContinuation { finish = $0 }
            }
        }
        while finish == nil { await Task.yield() }
        await recovery.reconcile(snapshot: active) { self.active }
        finish?.resume(returning: absent)
        let accepted = await oldRefresh.value
        XCTAssertFalse(accepted)
        XCTAssertTrue(recovery.requiresRecovery(for: absent))
    }

    func testCanceledRefreshCannotConfirmSignOut() async {
        let recovery = SessionRecovery()
        var finish: CheckedContinuation<SessionSnapshot, Never>?
        let refresh = Task {
            await recovery.reconcile(snapshot: absent) {
                await withCheckedContinuation { finish = $0 }
            }
        }
        while finish == nil { await Task.yield() }
        refresh.cancel()
        finish?.resume(returning: absent)
        let accepted = await refresh.value
        XCTAssertFalse(accepted)
        XCTAssertTrue(recovery.requiresRecovery(for: absent))
    }
}
