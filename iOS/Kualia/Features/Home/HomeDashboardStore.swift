import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class HomeDashboardStore {
    typealias Subscription = (String, String) -> AnyPublisher<HomeBriefing, Error>
    typealias ConnectionSubscription = (String) -> AnyPublisher<[HomeBankConnection], Error>
    let workspaceID: String
    private(set) var snapshot: HomeBriefing?
    private(set) var errorMessage: String?
    private(set) var connections: [HomeBankConnection] = []
    private(set) var connectionsHaveLoaded: Bool
    private(set) var connectionsError: String?
    private(set) var inbox = HomeInboxState()
    @ObservationIgnored private let subscribe: Subscription
    @ObservationIgnored private let subscribeToConnections: ConnectionSubscription?
    @ObservationIgnored private var connectionSubscription: AnyCancellable?
    @ObservationIgnored private var connectionDeadline: Task<Void, Never>?
    @ObservationIgnored private var dismissalDefaults: UserDefaults?
    @ObservationIgnored private var dismissalKey: String?
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()

    convenience init(convexClient: ConvexClientWithAuth<String>, workspaceID: String) {
        self.init(
            workspaceID: workspaceID,
            connections: { id in
                convexClient.subscribe(
                    to: "bankConnections:listConnections", with: ["workspaceId": id],
                    yielding: [HomeBankConnection].self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            subscribe: { id, refreshKey in
                convexClient.subscribe(
                    to: "home:getHomeDashboard",
                    with: ["workspaceId": id, "refreshKey": refreshKey], yielding: HomeBriefing.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            })
    }

    init(
        workspaceID: String, connections: ConnectionSubscription? = nil,
        subscribe: @escaping Subscription
    ) {
        self.workspaceID = workspaceID
        self.subscribe = subscribe
        subscribeToConnections = connections
        connectionsHaveLoaded = connections == nil
    }

    /// Admission and the live page share the same first-result boundary. Errors
    /// settle a check too, allowing Home to show its existing retry notices.
    func isLoading(budget: BudgetStore) -> Bool {
        let budgetIsReady =
            budget.workspace?.id == workspaceID && budget.hasLoaded
            && !budget.isRefreshing && budget.errorMessage == nil
        return (snapshot == nil && errorMessage == nil)
            || (!budgetIsReady && budget.errorMessage == nil)
            || (!connectionsHaveLoaded && connectionsError == nil)
    }

    func configureDismissals(userID: String, defaults: UserDefaults?) {
        dismissalDefaults = defaults
        // Encode the pair so user/workspace boundaries cannot collide.
        let scope = (try? JSONEncoder().encode([userID, workspaceID]))?.base64EncodedString() ?? ""
        let key = "home.dismissals.v1.\(scope)"
        dismissalKey = key
        inbox =
            defaults?.data(forKey: key).flatMap {
                try? JSONDecoder().decode(HomeInboxState.self, from: $0)
            }
            ?? HomeInboxState()
    }

    func updateInbox(_ next: HomeInboxState) {
        guard inbox != next else { return }
        inbox = next
        if let dismissalKey, let data = try? JSONEncoder().encode(next) {
            dismissalDefaults?.set(data, forKey: dismissalKey)
        }
    }

    func start() {
        guard subscription == nil else { return }
        // A resumed subscription must receive a fresh briefing before Home is ready.
        snapshot = nil
        errorMessage = nil
        let attempt = UUID()
        generation = attempt
        watchConnections(attempt: attempt)
        subscription = subscribe(workspaceID, attempt.uuidString)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                guard let self, self.generation == attempt else { return }
                if case .failure = completion {
                    self.deadline?.cancel()
                    self.errorMessage = L10n.string("Your briefing couldn't be updated. Try again.")
                    self.snapshot = nil
                }
            } receiveValue: { [weak self] value in
                guard let self, self.generation == attempt else { return }
                guard value.workspace.id == self.workspaceID else {
                    self.snapshot = nil
                    self.errorMessage = L10n.string(
                        "The briefing belongs to another workspace. Try again.")
                    return
                }
                self.deadline?.cancel()
                self.errorMessage = nil
                self.snapshot = value
            }
        deadline = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled, let self, self.generation == attempt, self.snapshot == nil
            else { return }
            self.errorMessage = L10n.string(
                "Your briefing is taking longer than expected. Try again.")
        }
    }

    func refreshIfNeeded(now: Date = .now) {
        guard let snapshot else { return }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: snapshot.workspace.timezoneIdentifier) ?? .gmt
        formatter.dateFormat = "yyyy-MM-dd"
        if formatter.string(from: now) != snapshot.today { retry() }
    }

    func retry() {
        stop()
        snapshot = nil
        start()
    }
    func stop() {
        generation = UUID()
        subscription?.cancel()
        subscription = nil
        deadline?.cancel()
        deadline = nil
        connectionSubscription?.cancel()
        connectionSubscription = nil
        connectionDeadline?.cancel()
        connectionDeadline = nil
    }
    func reset() {
        stop()
        snapshot = nil
        errorMessage = nil
        connections = []
        connectionsHaveLoaded = subscribeToConnections == nil
        connectionsError = nil
        inbox = HomeInboxState()
        dismissalDefaults = nil
        dismissalKey = nil
    }

    private func watchConnections(attempt: UUID) {
        guard let subscribeToConnections else { return }
        connectionsError = nil
        connectionsHaveLoaded = false
        connectionSubscription = subscribeToConnections(workspaceID)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                guard let self, self.generation == attempt else { return }
                if case .failure = completion {
                    self.connectionDeadline?.cancel()
                    self.connectionsError = L10n.string("Bank connections couldn't be checked.")
                }
            } receiveValue: { [weak self] connections in
                guard let self, self.generation == attempt else { return }
                self.connectionDeadline?.cancel()
                self.connections = connections
                self.connectionsHaveLoaded = true
                self.connectionsError = nil
            }
        connectionDeadline = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled, let self, self.generation == attempt,
                !self.connectionsHaveLoaded
            else { return }
            self.connectionsError = L10n.string("Bank connections are taking longer than expected.")
        }
    }
}
