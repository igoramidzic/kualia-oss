import Combine
import Foundation
import Testing

@testable import Kualia

@MainActor
struct AppUpdatesTests {
    private let release = AppChangelog(
        version: "2.10.0", changelogUrl: "https://feedback.kualia.com/updates/release-2-10")

    @Test func comparesNumericVersionsAndNormalizesMissingComponents() throws {
        #expect(try #require(AppReleaseVersion("2.10")) > #require(AppReleaseVersion("2.9.9")))
        #expect(AppReleaseVersion("1.0") == AppReleaseVersion("1.0.0"))
        #expect(AppReleaseVersion(" 2.10.0\n") == AppReleaseVersion("2.10"))
        for value in ["", "2..1", "2.a.0", "-1.0", "2.0.0.1", "latest", "2.0-beta"] {
            #expect(AppReleaseVersion(value) == nil)
        }
    }

    @Test func maintenanceTakesPriorityOverRequiredUpdate() {
        let status = AppSystemStatus(
            maintenanceMode: true, maintenanceMessage: "Back at 4 PM",
            minIosVersion: "3.0", iosUpdateMessage: "Install the new app")
        #expect(status.blocker(currentVersion: "2.10") == .maintenance(message: "Back at 4 PM"))
    }

    @Test func missingAndBlankMessagesUseDefaults() {
        for message: String? in [nil, "", " \n\t"] {
            let maintenance = AppSystemStatus(maintenanceMode: true, maintenanceMessage: message)
            #expect(
                maintenance.blocker(currentVersion: "1.0")?.message
                    == "We're currently performing maintenance. Please check back shortly.")
            let update = AppSystemStatus(minIosVersion: "2.0", iosUpdateMessage: message)
            #expect(
                update.blocker(currentVersion: "1.0")?.message
                    == "Please update Kualia to the latest version to continue.")
        }
    }

    @Test func requiredVersionAllowsEqualOrNewerAppsAndUsesServerMessage() {
        let status = AppSystemStatus(minIosVersion: "2.10.0", iosUpdateMessage: " Upgrade today \n")
        #expect(
            status.blocker(currentVersion: "2.9.9")
                == .updateRequired(message: "Upgrade today", minimumVersion: "2.10.0"))
        #expect(status.blocker(currentVersion: "2.10") == nil)
        #expect(status.blocker(currentVersion: "3.0") == nil)
        #expect(AppSystemStatus().blocker(currentVersion: "2.10") == nil)
        #expect(AppSystemStatus(minIosVersion: "invalid").blocker(currentVersion: "2.10") == nil)
    }

    @Test func decodesPublicQueryDefaultsAndNullChangelog() throws {
        let data = Data(
            """
            {"maintenanceMode":false,"maintenanceMessage":null,"minIosVersion":null,"iosUpdateMessage":null}
            """.utf8)
        #expect(try JSONDecoder().decode(AppSystemStatus.self, from: data) == AppSystemStatus())
        #expect(try JSONDecoder().decode(AppChangelog?.self, from: Data("null".utf8)) == nil)
        let minimal = Data("{\"maintenanceMode\":true}".utf8)
        #expect(try JSONDecoder().decode(AppSystemStatus.self, from: minimal).maintenanceMode)
    }

    @Test func livePublicStatusBlocksBeforeAuthenticationAndRecovers() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.store.start()
        fixture.status.send(.init(maintenanceMode: true))
        try await eventually { fixture.store.blocker != nil }
        #expect(fixture.store.sessionID == nil)
        fixture.status.send(.init(minIosVersion: "3.0"))
        try await eventually {
            if case .updateRequired = fixture.store.blocker { return true }
            return false
        }
        fixture.status.send(.init())
        try await eventually { fixture.store.blocker == nil }
    }

    @Test func startIsIdempotentAndStopCancelsBothStreams() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.store.start()
        fixture.store.start()
        #expect(fixture.statusStarts == 1)
        #expect(fixture.changelogStarts == 1)
        fixture.store.stop()
        fixture.status.send(.init(maintenanceMode: true))
        fixture.changelogs.send(release)
        try await Task.sleep(for: .milliseconds(20))
        #expect(fixture.store.blocker == nil)
        #expect(fixture.store.latestChangelog == nil)
        fixture.store.start()
        #expect(fixture.statusStarts == 2)
        #expect(fixture.changelogStarts == 2)
    }

    @Test func matchingUnreadReleasePresentsAndDoesNotRepeatAfterRelaunch() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        try await fixture.load()
        await fixture.store.prepareChangelog()
        let presentation = try #require(fixture.store.presentedChangelog)
        #expect(presentation.url.absoluteString == fixture.signedURL)
        fixture.store.markChangelogViewed(presentation)
        fixture.store.presentedChangelog = nil
        await fixture.store.prepareChangelog()
        #expect(fixture.store.presentedChangelog == nil)

        fixture.store.stop()
        fixture.store = fixture.makeStore()
        try await fixture.load()
        #expect(fixture.store.unreadChangelog == nil)
    }

    @Test func legacyViewedVersionIsRespectedWithEquivalentVersionFormatting() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.defaults.set("2.10", forKey: AppUpdatesStore.lastViewedKey)
        fixture.store = fixture.makeStore()
        try await fixture.load()
        #expect(fixture.store.unreadChangelog == nil)
    }

    @Test func olderNewerAndAbsentReleasesNeverPopUp() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        try await fixture.load()
        for version in ["2.9.0", "3.0.0", "invalid"] {
            fixture.changelogs.send(.init(version: version, changelogUrl: release.changelogUrl))
            try await eventually { fixture.store.latestChangelog?.version == version }
            await fixture.store.prepareChangelog()
            #expect(fixture.store.presentedChangelog == nil)
        }
        fixture.changelogs.send(nil)
        try await eventually { fixture.store.latestChangelog == nil }
        #expect(fixture.store.unreadChangelog == nil)
    }

    @Test func aLateMatchingReleaseBecomesEligible() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.store.start()
        fixture.store.authenticate(sessionID: "session-a")
        fixture.status.send(.init())
        fixture.changelogs.send(nil)
        try await eventually { fixture.store.hasLoadedStatus }
        #expect(fixture.store.unreadChangelog == nil)
        fixture.changelogs.send(release)
        try await eventually { fixture.store.unreadChangelog != nil }
        await fixture.store.prepareChangelog()
        #expect(fixture.store.presentedChangelog != nil)
    }

    @Test func blockedAndSignedOutAppsDeferChangelogWithoutMarkingItViewed() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        try await fixture.load()
        fixture.store.authenticate(sessionID: nil)
        await fixture.store.prepareChangelog()
        #expect(fixture.store.presentedChangelog == nil)
        fixture.store.authenticate(sessionID: "session-a")
        fixture.status.send(.init(maintenanceMode: true))
        try await eventually { fixture.store.blocker != nil }
        await fixture.store.prepareChangelog()
        #expect(fixture.store.presentedChangelog == nil)
        #expect(fixture.store.lastViewedVersion == nil)
        fixture.status.send(.init())
        try await eventually { fixture.store.blocker == nil }
        await fixture.store.prepareChangelog()
        #expect(fixture.store.presentedChangelog != nil)
    }

    @Test func liveBlockAndSignOutClearPresentedSignedLinks() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        try await fixture.load()
        await fixture.store.prepareChangelog()
        fixture.status.send(.init(minIosVersion: "3.0"))
        try await eventually { fixture.store.presentedChangelog == nil }
        fixture.status.send(.init())
        try await eventually { fixture.store.blocker == nil }
        await fixture.store.prepareChangelog()
        #expect(fixture.store.presentedChangelog != nil)
        fixture.store.authenticate(sessionID: nil)
        #expect(fixture.store.presentedChangelog == nil)
    }

    @Test func recordsDisplayedVersionIfLatestReleaseChangesWhileSheetIsOpen() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        try await fixture.load()
        await fixture.store.prepareChangelog()
        let presented = try #require(fixture.store.presentedChangelog)
        fixture.changelogs.send(.init(version: "3.0", changelogUrl: release.changelogUrl))
        try await eventually { fixture.store.latestChangelog?.version == "3.0" }
        fixture.store.markChangelogViewed(presented)
        #expect(fixture.store.lastViewedVersion == "2.10.0")
    }

    @Test func rejectsUnsafeUnsignedAndWrongReleaseURLs() {
        for value in [
            "http://feedback.kualia.com/updates/release-2-10?clientToken=test",
            "https://example.com/updates/release-2-10?clientToken=test",
            "https://feedback.kualia.com/updates/other?clientToken=test",
            "https://feedback.kualia.com/updates/release-2-10",
            "https://feedback.kualia.com/updates/release-2-10?clientToken=",
            "https://user@feedback.kualia.com/updates/release-2-10?clientToken=test",
        ] {
            #expect(release.signedURL(value) == nil)
        }
        #expect(release.signedURL(nil) == nil)
        #expect(release.signedURL(release.changelogUrl + "?clientToken=test") != nil)
    }

    @Test func signingFailureNeverMarksReleaseViewed() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.signingError = true
        try await fixture.load()
        await fixture.store.prepareChangelog()
        #expect(fixture.store.presentedChangelog == nil)
        #expect(fixture.store.lastViewedVersion == nil)
    }

    @Test func staleSignedResponseCannotPresentAfterSessionChangeOrCancellation() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.delaysSigning = true
        try await fixture.load()
        let pending = Task { await fixture.store.prepareChangelog() }
        try await eventually { fixture.signingContinuation != nil }
        fixture.store.authenticate(sessionID: "session-b")
        fixture.finishSigning()
        await pending.value
        #expect(fixture.store.presentedChangelog == nil)
        let cancelled = Task { await fixture.store.prepareChangelog() }
        try await eventually { fixture.signingContinuation != nil }
        cancelled.cancel()
        fixture.finishSigning()
        await cancelled.value
        #expect(fixture.store.presentedChangelog == nil)
    }

    @Test func statusFailurePreservesBlockAndReconnects() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.store.start()
        fixture.status.send(.init(maintenanceMode: true))
        try await eventually { fixture.store.blocker != nil }
        fixture.status.send(completion: .failure(Fixture.Failure.offline))
        try await Task.sleep(for: .milliseconds(20))
        #expect(fixture.store.blocker != nil)
        fixture.status = PassthroughSubject<AppSystemStatus, Error>()
        try await eventually(timeout: .seconds(6)) { fixture.statusStarts == 2 }
        fixture.status.send(.init())
        try await eventually { fixture.store.blocker == nil }
    }

    @Test func aModalOpeningDuringLinkLoadingDefersPresentationUntilItCloses() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.delaysSigning = true
        try await fixture.load()
        var isAvailable = true
        let pending = Task {
            await fixture.store.prepareChangelog(canPresent: { isAvailable })
        }
        try await eventually { fixture.signingContinuation != nil }
        isAvailable = false
        fixture.finishSigning()
        await pending.value
        #expect(fixture.store.presentedChangelog == nil)
        #expect(fixture.store.lastViewedVersion == nil)
        isAvailable = true
        fixture.delaysSigning = false
        await fixture.store.prepareChangelog(canPresent: { isAvailable })
        #expect(fixture.store.presentedChangelog != nil)
    }

    @Test func liveBlockOrReleaseReplacementDiscardsAnInFlightSignedLink() async throws {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.delaysSigning = true
        try await fixture.load()
        let pending = Task { await fixture.store.prepareChangelog() }
        try await eventually { fixture.signingContinuation != nil }
        fixture.status.send(.init(maintenanceMode: true))
        try await eventually { fixture.store.blocker != nil }
        fixture.finishSigning()
        await pending.value
        #expect(fixture.store.presentedChangelog == nil)
        fixture.status.send(.init())
        try await eventually { fixture.store.blocker == nil }
        let replaced = Task { await fixture.store.prepareChangelog() }
        try await eventually { fixture.signingContinuation != nil }
        fixture.changelogs.send(.init(version: "3.0", changelogUrl: release.changelogUrl))
        try await eventually { fixture.store.latestChangelog?.version == "3.0" }
        fixture.finishSigning()
        await replaced.value
        #expect(fixture.store.presentedChangelog == nil)
    }

    @Test func unavailableInitialStatusEventuallyAllowsLaunchButStillAcceptsLiveBlock() async throws
    {
        let fixture = Fixture(release: release)
        defer { fixture.cleanUp() }
        fixture.store.start()
        #expect(!fixture.store.hasLoadedStatus)
        try await eventually(timeout: .seconds(6)) { fixture.store.hasLoadedStatus }
        fixture.status.send(.init(maintenanceMode: true))
        try await eventually { fixture.store.blocker != nil }
    }

    private func eventually(
        timeout: Duration = .seconds(1), _ condition: () -> Bool
    ) async throws {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while !condition(), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(condition())
    }

    @MainActor private final class Fixture {
        enum Failure: Error { case offline }
        let suite = "AppUpdatesTests.\(UUID().uuidString)"
        let defaults: UserDefaults
        let release: AppChangelog
        var status = PassthroughSubject<AppSystemStatus, Error>()
        var changelogs = PassthroughSubject<AppChangelog?, Error>()
        var statusStarts = 0
        var changelogStarts = 0
        var signingError = false
        var delaysSigning = false
        var signingContinuation: CheckedContinuation<String?, Error>?
        var signedURL: String { release.changelogUrl + "?clientToken=test-token" }
        lazy var store = makeStore()

        init(release: AppChangelog) {
            self.release = release
            defaults = UserDefaults(suiteName: suite)!
        }

        func makeStore() -> AppUpdatesStore {
            AppUpdatesStore(
                client: .init(
                    watchStatus: { [unowned self] in
                        statusStarts += 1
                        return status.eraseToAnyPublisher()
                    },
                    watchChangelog: { [unowned self] in
                        changelogStarts += 1
                        return changelogs.eraseToAnyPublisher()
                    },
                    signedChangelogURL: { [unowned self] in
                        if signingError { throw Failure.offline }
                        if delaysSigning {
                            return try await withCheckedThrowingContinuation {
                                signingContinuation = $0
                            }
                        }
                        return signedURL
                    }), currentVersion: "2.10", defaults: defaults)
        }

        func load() async throws {
            store.start()
            store.authenticate(sessionID: "session-a")
            status.send(.init())
            changelogs.send(release)
            try await Task.sleep(for: .milliseconds(20))
            #expect(store.hasLoadedStatus)
            #expect(store.latestChangelog == release)
        }

        func finishSigning() {
            signingContinuation?.resume(returning: signedURL)
            signingContinuation = nil
        }

        func cleanUp() {
            store.stop()
            finishSigning()
            defaults.removePersistentDomain(forName: suite)
        }
    }
}
