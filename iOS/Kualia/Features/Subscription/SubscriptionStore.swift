import Combine
import Foundation
import Observation

#if canImport(ConvexMobile)
    import ConvexMobile
#endif

@MainActor
@Observable
final class SubscriptionStore {
    typealias AccessSubscription = (String) -> AnyPublisher<SubscriptionAppAccess, Error>

    private(set) var accessState: SubscriptionAccessState = .loading
    private(set) var appAccess: SubscriptionAppAccess?
    private(set) var plans: [SubscriptionPlan] = []
    var selectedPlanID: String?
    private(set) var isLoadingPlans = false
    private(set) var isPurchasing = false
    private(set) var isRestoring = false
    private(set) var isAwaitingActivation = false
    private(set) var errorMessage: String?
    private(set) var statusMessage: String?

    @ObservationIgnored private let subscribe: AccessSubscription
    @ObservationIgnored private let purchasing: any SubscriptionPurchasing
    @ObservationIgnored private let responseTimeout: Duration
    @ObservationIgnored private let retryDelay: Duration
    @ObservationIgnored private var userID: String?
    @ObservationIgnored private var sessionID: String?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var accessAttempt = UUID()
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var retryTask: Task<Void, Never>?
    @ObservationIgnored private var expirationTask: Task<Void, Never>?
    @ObservationIgnored private var plansTask: Task<Void, Never>?
    @ObservationIgnored private var activationTask: Task<Void, Never>?

    init(
        purchasing: any SubscriptionPurchasing,
        responseTimeout: Duration = .seconds(15),
        retryDelay: Duration = .seconds(5),
        accessSubscription: @escaping AccessSubscription
    ) {
        self.purchasing = purchasing
        self.responseTimeout = responseTimeout
        self.retryDelay = retryDelay
        subscribe = accessSubscription
    }

    var selectedPlan: SubscriptionPlan? { plans.first { $0.id == selectedPlanID } }
    var isBusy: Bool { isPurchasing || isRestoring }
    var canPurchase: Bool {
        selectedPlan != nil && !isBusy && !isLoadingPlans && !isAwaitingActivation
    }

    func start(userID: String, sessionID: String? = nil) {
        guard self.userID != userID || self.sessionID != sessionID else { return }
        reset()
        self.userID = userID
        self.sessionID = sessionID
        watchAccess()
    }

    func reset() {
        generation = UUID()
        subscription?.cancel()
        deadline?.cancel()
        retryTask?.cancel()
        expirationTask?.cancel()
        plansTask?.cancel()
        activationTask?.cancel()
        subscription = nil
        userID = nil
        sessionID = nil
        appAccess = nil
        accessState = .loading
        plans = []
        selectedPlanID = nil
        isLoadingPlans = false
        isPurchasing = false
        isRestoring = false
        isAwaitingActivation = false
        errorMessage = nil
        statusMessage = nil
    }

    /// Called on foreground entry as well as at the server-provided expiry boundary.
    func refresh() async {
        guard let userID else { return }
        if accessState == .allowed, let expiration = appAccess?.expiration, expiration <= Date() {
            accessState = .loading
        }
        watchAccess()
        try? await purchasing.refresh(userID: userID)
    }

    func retry() {
        watchAccess()
        if plans.isEmpty { loadPlans() }
    }

    func loadPlans() {
        guard let userID, !isLoadingPlans else { return }
        let generation = generation
        isLoadingPlans = true
        errorMessage = nil
        plansTask = Task { [weak self, purchasing] in
            do {
                let plans = try await purchasing.plans(userID: userID)
                guard let self, self.generation == generation else { return }
                self.plans = plans
                if !plans.contains(where: { $0.id == self.selectedPlanID }) {
                    self.selectedPlanID =
                        plans.first(where: { $0.period == .yearly })?.id
                        ?? plans.first?.id
                }
                self.isLoadingPlans = false
                if plans.isEmpty {
                    self.errorMessage =
                        L10n.string(
                            "Subscription options aren't available right now. Please try again.")
                }
            } catch {
                guard let self, self.generation == generation else { return }
                self.isLoadingPlans = false
                self.errorMessage =
                    L10n.string(
                        "Couldn't load pricing from the App Store. Check your connection and try again."
                    )
            }
        }
    }

    func purchase() async {
        guard canPurchase, let plan = selectedPlan, let userID else { return }
        let generation = generation
        isPurchasing = true
        errorMessage = nil
        statusMessage = nil
        defer { if self.generation == generation { isPurchasing = false } }
        do {
            let outcome = try await purchasing.purchase(planID: plan.id, userID: userID)
            guard self.generation == generation else { return }
            switch outcome {
            case .cancelled: break
            case .pending:
                isAwaitingActivation = true
                statusMessage =
                    L10n.string(
                        "Your purchase is awaiting approval from Apple. Access will update when it's approved."
                    )
            case .purchased:
                awaitActivation(
                    message: L10n.string(
                        "Purchase received. We're activating Kualia for your account."))
            }
        } catch {
            guard self.generation == generation else { return }
            errorMessage = L10n.string("Your purchase couldn't be completed. Please try again.")
        }
    }

    func restorePurchases() async {
        guard !isBusy, let userID else { return }
        let generation = generation
        isRestoring = true
        errorMessage = nil
        statusMessage = nil
        defer { if self.generation == generation { isRestoring = false } }
        do {
            let restored = try await purchasing.restore(userID: userID)
            guard self.generation == generation else { return }
            watchAccess()
            if restored {
                awaitActivation(
                    message: L10n.string(
                        "Purchase found. We're confirming access for your account."))
            } else {
                isAwaitingActivation = false
                statusMessage =
                    L10n.string(
                        "No active App Store subscription was found. If you subscribed on the web, use the same Kualia account."
                    )
            }
        } catch {
            guard self.generation == generation else { return }
            errorMessage = L10n.string("Couldn't restore purchases. Please try again.")
        }
    }

    private func watchAccess() {
        guard userID != nil else { return }
        let generation = generation
        accessAttempt = UUID()
        let attempt = accessAttempt
        subscription?.cancel()
        deadline?.cancel()
        retryTask?.cancel()
        deadline = Task { [weak self, responseTimeout] in
            do { try await Task.sleep(for: responseTimeout) } catch { return }
            guard let self, self.generation == generation, self.accessAttempt == attempt else {
                return
            }
            self.handleAccessFailure(
                L10n.string(
                    "Couldn't confirm your subscription. Check your connection and try again."))
        }
        subscription = subscribe(attempt.uuidString)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.generation == generation, self.accessAttempt == attempt
                    else { return }
                    if case .failure = completion {
                        self.deadline?.cancel()
                        self.handleAccessFailure(
                            L10n.string("Couldn't confirm your subscription. Please try again."))
                        self.scheduleRetry(generation: generation, attempt: attempt)
                    }
                },
                receiveValue: { [weak self] access in
                    guard let self, self.generation == generation, self.accessAttempt == attempt
                    else { return }
                    self.deadline?.cancel()
                    self.appAccess = access
                    self.accessState = access.hasAppAccess ? .allowed : .paywall
                    if access.hasAppAccess {
                        self.isAwaitingActivation = false
                        self.statusMessage = nil
                        self.activationTask?.cancel()
                    }
                    self.scheduleExpiration(access.expiration)
                })
    }

    private func handleAccessFailure(_ message: String) {
        // A network failure does not revoke access already confirmed for this session.
        // Keep the expiration boundary and explicit server denials authoritative.
        if accessState == .allowed, let appAccess, appAccess.hasAppAccess,
            appAccess.expiration.map({ $0 > Date() }) ?? true
        {
            return
        }
        accessState = .failed(message)
    }

    private func scheduleRetry(generation: UUID, attempt: UUID) {
        retryTask?.cancel()
        retryTask = Task { [weak self, retryDelay] in
            do { try await Task.sleep(for: retryDelay) } catch { return }
            guard let self, self.generation == generation, self.accessAttempt == attempt else {
                return
            }
            self.watchAccess()
        }
    }

    private func scheduleExpiration(_ expiration: Date?) {
        expirationTask?.cancel()
        guard let expiration, expiration > Date() else { return }
        let generation = generation
        expirationTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(expiration.timeIntervalSinceNow + 1)) } catch {
                return
            }
            guard let self, self.generation == generation else { return }
            self.accessState = .loading
            await self.refresh()
        }
    }

    private func awaitActivation(message: String) {
        isAwaitingActivation = true
        statusMessage = message
        watchAccess()
        activationTask?.cancel()
        let generation = generation
        activationTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(20)) } catch { return }
            guard let self, self.generation == generation, self.accessState != .allowed else {
                return
            }
            self.statusMessage =
                L10n.string(
                    "Your purchase is safe. Activation is taking a little longer. Tap Check access, or contact support if it doesn't update."
                )
        }
    }
}

#if canImport(ConvexMobile) && canImport(RevenueCat)
    extension SubscriptionStore {
        convenience init(convexClient: ConvexClientWithAuth<String>) {
            self.init(purchasing: RevenueCatSubscriptionProvider()) { refreshKey in
                convexClient.subscribe(
                    to: "appAccess:getCurrentAppAccess", with: ["refreshKey": refreshKey],
                    yielding: SubscriptionAppAccess.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            }
        }
    }
#endif
