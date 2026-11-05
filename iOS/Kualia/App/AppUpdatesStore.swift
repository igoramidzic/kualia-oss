import Combine
import Foundation
import Observation

@MainActor
struct AppUpdatesClient {
    var watchStatus: () -> AnyPublisher<AppSystemStatus, Error>
    var watchChangelog: () -> AnyPublisher<AppChangelog?, Error>
    var signedChangelogURL: () async throws -> String?
}

@MainActor
@Observable
final class AppUpdatesStore {
    static let lastViewedKey = "lastViewedChangelogVersion"

    let currentVersion: String
    private(set) var status = AppSystemStatus()
    private(set) var hasLoadedStatus = false
    private(set) var latestChangelog: AppChangelog?
    private(set) var lastViewedVersion: String?
    private(set) var sessionID: String?
    var presentedChangelog: AppChangelogPresentation?

    @ObservationIgnored private let client: AppUpdatesClient
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var subscriptions: [Stream: AnyCancellable] = [:]
    @ObservationIgnored private var retries: [Stream: Task<Void, Never>] = [:]
    @ObservationIgnored private var statusDeadline: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var isWatching = false

    private enum Stream { case status, changelog }

    init(
        client: AppUpdatesClient, currentVersion: String,
        defaults: UserDefaults = .standard
    ) {
        self.client = client
        self.currentVersion = currentVersion
        self.defaults = defaults
        lastViewedVersion = defaults.string(forKey: Self.lastViewedKey)
    }

    var blocker: AppStatusBlocker? { status.blocker(currentVersion: currentVersion) }

    var unreadChangelog: AppChangelog? {
        guard let latestChangelog, latestChangelog.url != nil,
            let latest = AppReleaseVersion(latestChangelog.version),
            latest == AppReleaseVersion(currentVersion),
            lastViewedVersion.flatMap(AppReleaseVersion.init) != latest
        else { return nil }
        return latestChangelog
    }

    func start() {
        guard !isWatching else { return }
        isWatching = true
        let generation = generation
        if !hasLoadedStatus {
            statusDeadline = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                guard let self, self.generation == generation else { return }
                // An unavailable public query must not strand a first launch.
                // Keep listening so a later response can still block the app.
                self.hasLoadedStatus = true
            }
        }
        watch(.status)
        watch(.changelog)
    }

    func stop() {
        isWatching = false
        generation = UUID()
        subscriptions.removeAll()
        for retry in retries.values { retry.cancel() }
        retries.removeAll()
        statusDeadline?.cancel()
        statusDeadline = nil
    }

    func authenticate(sessionID: String?) {
        guard self.sessionID != sessionID else { return }
        self.sessionID = sessionID
        presentedChangelog = nil
    }

    func prepareChangelog(canPresent: () -> Bool = { true }) async {
        guard canPresent(), presentedChangelog == nil, blocker == nil, hasLoadedStatus,
            let sessionID, let changelog = unreadChangelog
        else { return }
        do {
            let value = try await client.signedChangelogURL()
            guard !Task.isCancelled, canPresent(), self.sessionID == sessionID,
                blocker == nil, unreadChangelog == changelog,
                presentedChangelog == nil, let url = changelog.signedURL(value)
            else { return }
            presentedChangelog = .init(changelog: changelog, url: url)
        } catch {
            // Changelog delivery is optional; never interrupt access with an error.
        }
    }

    func markChangelogViewed(_ presentation: AppChangelogPresentation) {
        // Record the release actually displayed, even if the live query advances.
        lastViewedVersion = presentation.changelog.version
        defaults.set(lastViewedVersion, forKey: Self.lastViewedKey)
    }

    private func watch(_ stream: Stream) {
        let generation = generation
        switch stream {
        case .status:
            subscriptions[stream] = client.watchStatus()
                .receive(on: DispatchQueue.main)
                .sink { [weak self] _ in
                    self?.finished(stream, generation: generation)
                } receiveValue: { [weak self] status in
                    guard let self, self.generation == generation else { return }
                    self.statusDeadline?.cancel()
                    self.status = status
                    self.hasLoadedStatus = true
                    if self.blocker != nil { self.presentedChangelog = nil }
                }
        case .changelog:
            subscriptions[stream] = client.watchChangelog()
                .receive(on: DispatchQueue.main)
                .sink { [weak self] _ in
                    self?.finished(stream, generation: generation)
                } receiveValue: { [weak self] changelog in
                    guard let self, self.generation == generation else { return }
                    self.latestChangelog = changelog
                }
        }
    }

    private func finished(_ stream: Stream, generation: UUID) {
        guard isWatching, self.generation == generation else { return }
        subscriptions[stream] = nil
        if stream == .status { hasLoadedStatus = true }
        // Preserve an active blocker on failure and reconnect terminated streams.
        retries[stream] = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
            guard let self, self.isWatching, self.generation == generation else { return }
            self.watch(stream)
        }
    }
}
