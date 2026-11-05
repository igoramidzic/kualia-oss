import Combine
import ConvexMobile
import Foundation
import Observation

/// One subscription for the authenticated session, independent of mounted pages and filters.
@MainActor
@Observable
final class HomeNavigationAttentionStore {
    typealias Subscription = (String) -> AnyPublisher<[HomeWorkspaceAttention], Error>
    private(set) var values: [HomeWorkspaceAttention] = []
    private(set) var hasLoaded = false
    private(set) var errorMessage: String?
    @ObservationIgnored private let subscribe: Subscription?
    @ObservationIgnored private let responseTimeout: Duration
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var isAwaitingResponse = false

    convenience init(convexClient: ConvexClientWithAuth<String>) {
        self.init { key in
            convexClient.subscribe(
                to: "workspaces:getNavigationAttention", with: ["refreshKey": key],
                yielding: [HomeWorkspaceAttention].self
            ).mapError { $0 as Error }.eraseToAnyPublisher()
        }
    }

    init(responseTimeout: Duration = .seconds(15), subscribe: Subscription? = nil) {
        self.responseTimeout = responseTimeout
        self.subscribe = subscribe
    }

    func start() {
        guard subscription == nil, let subscribe else { return }
        let attempt = UUID()
        generation = attempt
        isAwaitingResponse = true
        errorMessage = nil
        deadline = Task { [weak self, responseTimeout] in
            do { try await Task.sleep(for: responseTimeout) } catch { return }
            guard let self, self.generation == attempt else { return }
            self.isAwaitingResponse = false
            self.errorMessage = L10n.string("Status couldn't be updated")
        }
        subscription = subscribe(attempt.uuidString)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self, self.generation == attempt else { return }
                self.deadline?.cancel()
                self.isAwaitingResponse = false
                self.subscription = nil
                self.errorMessage = L10n.string("Status couldn't be updated")
            } receiveValue: { [weak self] values in
                guard let self, self.generation == attempt else { return }
                self.deadline?.cancel()
                self.isAwaitingResponse = false
                self.errorMessage = nil
                self.values = values
                self.hasLoaded = true
            }
    }

    func refreshIfNeeded(now: Date = .now) {
        guard !isAwaitingResponse else { return }
        if errorMessage != nil || values.contains(where: { $0.needsMonthRefresh(now: now) }) {
            retry()
        }
    }

    func retry() {
        stop()
        start()
    }

    func reset() {
        stop()
        values = []
        hasLoaded = false
        errorMessage = nil
    }

    /// Reconnecting must not turn the last known status into an empty result.
    /// Only an authentication reset or a live response can clear the dots.
    private func stop() {
        generation = UUID()
        subscription?.cancel()
        subscription = nil
        deadline?.cancel()
        deadline = nil
        isAwaitingResponse = false
    }

    func summary(workspaces: [AppWorkspace], selectedWorkspaceID: String?)
        -> HomeNavigationAttention
    {
        .init(
            values: values,
            accessibleWorkspaceIDs: Set(workspaces.filter { !$0.isArchived }.map(\.id)),
            selectedWorkspaceID: selectedWorkspaceID)
    }
}
