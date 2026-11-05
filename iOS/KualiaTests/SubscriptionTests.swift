import Combine
import Foundation
import Testing

@testable import Kualia

@Suite(.serialized)
@MainActor
struct SubscriptionTests {
    @Test
    func accessUsesServerDecisionForLifetimeFamilyAndExpiredSubscriptions() async {
        let subject = PassthroughSubject<SubscriptionAppAccess, Error>()
        let store = SubscriptionStore(purchasing: PurchaseStub()) { _ in
            subject.eraseToAnyPublisher()
        }
        store.start(userID: "alice")
        #expect(store.accessState == .loading)
        subject.send(
            .init(
                hasAppAccess: true, accessSource: "own_subscription",
                ownSubscription: .init(
                    status: "active", subscriptionType: "lifetime", expiresAt: nil)))
        await settle()
        #expect(store.accessState == .allowed)
        subject.send(.init(hasAppAccess: true, accessSource: "family_owner_subscription"))
        await settle()
        #expect(store.accessState == .allowed)
        subject.send(
            .init(
                hasAppAccess: false,
                ownSubscription: .init(
                    status: "expired", subscriptionType: "trial", expiresAt: "2020-01-01T00:00:00Z")
            ))
        await settle()
        #expect(store.accessState == .paywall)
        store.reset()
    }

    @Test
    func resetPreventsPreviousUsersLatePricingFromAppearing() async {
        let provider = PurchaseStub()
        provider.suspendPlans = true
        let store = SubscriptionStore(purchasing: provider) { _ in Empty().eraseToAnyPublisher() }
        store.start(userID: "alice")
        store.loadPlans()
        await settle()
        store.start(userID: "bob")
        provider.plansContinuation?.resume(returning: [Self.yearly])
        await settle()
        #expect(store.plans.isEmpty)
        #expect(store.selectedPlanID == nil)
        #expect(!store.isLoadingPlans)
        #expect(store.accessState == .loading)
        store.reset()
    }

    @Test
    func purchaseWaitsForAuthoritativeActivationAndCannotBeRepeated() async {
        let subject = CurrentValueSubject<SubscriptionAppAccess, Error>(.init(hasAppAccess: false))
        let provider = PurchaseStub()
        let store = SubscriptionStore(purchasing: provider) { _ in subject.eraseToAnyPublisher() }
        store.start(userID: "alice")
        store.loadPlans()
        await settle()
        await store.purchase()
        #expect(store.isAwaitingActivation)
        #expect(!store.canPurchase)
        #expect(store.accessState == .paywall)
        await store.purchase()
        #expect(provider.purchases == 1)
        subject.send(.init(hasAppAccess: true))
        await settle()
        #expect(store.accessState == .allowed)
        #expect(!store.isAwaitingActivation)
        store.reset()
    }

    @Test
    func cancellationKeepsThePaywallUsableWithoutAnError() async {
        let provider = PurchaseStub()
        provider.outcome = .cancelled
        let store = SubscriptionStore(purchasing: provider) { _ in
            Just(.init(hasAppAccess: false)).setFailureType(to: Error.self).eraseToAnyPublisher()
        }
        store.start(userID: "alice")
        store.loadPlans()
        await settle()
        await store.purchase()
        #expect(!store.isBusy)
        #expect(!store.isAwaitingActivation)
        #expect(store.errorMessage == nil)
        #expect(store.canPurchase)
        store.reset()
    }

    @Test
    func foregroundRefreshChangesTheQueryKeyWithoutReusingAPriorAccessResponse() async {
        var keys: [String] = []
        let store = SubscriptionStore(purchasing: PurchaseStub()) { key in
            keys.append(key)
            return Just(.init(hasAppAccess: false)).setFailureType(to: Error.self)
                .eraseToAnyPublisher()
        }
        store.start(userID: "alice")
        await store.refresh()
        #expect(keys.count == 2)
        #expect(Set(keys).count == 2)
        store.reset()
    }

    @Test
    func foregroundHidesExpiredAccessUntilTheServerRevalidates() async {
        var subscriptionCount = 0
        let store = SubscriptionStore(purchasing: PurchaseStub()) { _ in
            subscriptionCount += 1
            if subscriptionCount == 1 {
                return Just(
                    SubscriptionAppAccess(
                        hasAppAccess: true, nextCheckAt: "2020-01-01T00:00:00Z")
                )
                .setFailureType(to: Error.self).eraseToAnyPublisher()
            }
            return Empty(completeImmediately: false).eraseToAnyPublisher()
        }
        store.start(userID: "alice")
        await settle()
        #expect(store.accessState == .allowed)
        await store.refresh()
        #expect(store.accessState == .loading)
        store.reset()
    }

    @Test
    func refreshTimeoutPreservesConfirmedAccessAndAcceptsLaterServerDecisions() async {
        let subject = PassthroughSubject<SubscriptionAppAccess, Error>()
        let store = SubscriptionStore(
            purchasing: PurchaseStub(), responseTimeout: .milliseconds(20)
        ) { _ in subject.eraseToAnyPublisher() }
        store.start(userID: "alice")
        subject.send(.init(hasAppAccess: true, nextCheckAt: "2099-01-01T00:00:00Z"))
        await settle()

        await store.refresh()
        await settle()
        #expect(store.accessState == .allowed)
        // The timed-out subscription stays live so reconnection can deliver a decision.
        subject.send(.init(hasAppAccess: false))
        await settle()
        #expect(store.accessState == .paywall)
        store.reset()
    }

    @Test
    func connectionFailurePreservesAccessAndAutomaticallyResubscribes() async {
        let first = PassthroughSubject<SubscriptionAppAccess, Error>()
        let reconnected = PassthroughSubject<SubscriptionAppAccess, Error>()
        var keys: [String] = []
        let store = SubscriptionStore(
            purchasing: PurchaseStub(), retryDelay: .milliseconds(100)
        ) { key in
            keys.append(key)
            return (keys.count == 1 ? first : reconnected).eraseToAnyPublisher()
        }
        store.start(userID: "alice")
        first.send(.init(hasAppAccess: true))
        await settle()
        first.send(completion: .failure(URLError(.networkConnectionLost)))
        await settle()
        #expect(store.accessState == .allowed)

        try? await Task.sleep(for: .milliseconds(150))
        #expect(keys.count == 2)
        #expect(Set(keys).count == 2)
        #expect(store.accessState == .allowed)
        reconnected.send(.init(hasAppAccess: false))
        await settle()
        #expect(store.accessState == .paywall)
        store.reset()
    }

    @Test
    func firstAccessTimeoutStillFailsAndRecoversWhenTheServerResponds() async {
        let subject = PassthroughSubject<SubscriptionAppAccess, Error>()
        let store = SubscriptionStore(
            purchasing: PurchaseStub(), responseTimeout: .milliseconds(20)
        ) { _ in subject.eraseToAnyPublisher() }
        store.start(userID: "alice")
        await settle()
        guard case .failed = store.accessState else {
            Issue.record("Unconfirmed access must not be allowed after a timeout")
            store.reset()
            return
        }
        subject.send(.init(hasAppAccess: true))
        await settle()
        #expect(store.accessState == .allowed)
        store.reset()
    }

    @Test
    func expiredAccessIsNotPreservedAfterARefreshTimeout() async {
        let subject = PassthroughSubject<SubscriptionAppAccess, Error>()
        let store = SubscriptionStore(
            purchasing: PurchaseStub(), responseTimeout: .milliseconds(20)
        ) { _ in subject.eraseToAnyPublisher() }
        store.start(userID: "alice")
        subject.send(.init(hasAppAccess: true, nextCheckAt: "2020-01-01T00:00:00Z"))
        await settle()
        await store.refresh()
        await settle()
        if case .failed = store.accessState {
        } else {
            Issue.record("Expired access must require server revalidation")
        }
        store.reset()
    }

    @Test
    func serverDenialIsNotOverriddenByALaterConnectionFailure() async {
        let subject = PassthroughSubject<SubscriptionAppAccess, Error>()
        let store = SubscriptionStore(purchasing: PurchaseStub()) { _ in
            subject.eraseToAnyPublisher()
        }
        store.start(userID: "alice")
        subject.send(.init(hasAppAccess: true))
        await settle()
        subject.send(.init(hasAppAccess: false))
        await settle()
        subject.send(completion: .failure(URLError(.notConnectedToInternet)))
        await settle()
        if case .failed = store.accessState {
        } else {
            Issue.record("A previous grant must not override the latest server denial")
        }
        store.reset()
    }

    @Test(arguments: ["alice", "bob"])
    func sessionChangeClearsConfirmedAccessAndCancelsPendingRetry(userID: String) async {
        let first = PassthroughSubject<SubscriptionAppAccess, Error>()
        var subscriptionCount = 0
        let store = SubscriptionStore(
            purchasing: PurchaseStub(), responseTimeout: .milliseconds(20),
            retryDelay: .milliseconds(100)
        ) { _ in
            subscriptionCount += 1
            if subscriptionCount == 1 { return first.eraseToAnyPublisher() }
            return Empty(completeImmediately: false).eraseToAnyPublisher()
        }
        store.start(userID: "alice", sessionID: "first")
        first.send(.init(hasAppAccess: true))
        await settle()
        first.send(completion: .failure(URLError(.networkConnectionLost)))
        await settle()
        store.start(userID: userID, sessionID: "second")
        #expect(store.appAccess == nil)
        #expect(store.accessState == .loading)
        try? await Task.sleep(for: .milliseconds(150))
        #expect(subscriptionCount == 2)
        if case .failed = store.accessState {
        } else {
            Issue.record("A new session must not inherit confirmed access")
        }
        store.reset()
    }

    @Test
    func savingsRequireComparableCurrenciesAndActualSavings() {
        let monthly = SubscriptionPlan(
            id: "month", period: .monthly, price: "$10", amount: 10, currencyCode: "USD")
        #expect(Self.yearly.savings(comparedWith: monthly) == 25)
        let otherCurrency = SubscriptionPlan(
            id: "eur", period: .monthly, price: "€10", amount: 10, currencyCode: "EUR")
        #expect(Self.yearly.savings(comparedWith: otherCurrency) == nil)
        #expect(monthly.savings(comparedWith: monthly) == nil)
        #expect(!Self.yearly.terms.contains("free"))
        var trial = Self.yearly
        trial.freeTrial = "7 days"
        #expect(trial.terms.contains("7 days free, then $90 / year"))
    }

    @Test
    func serverFamilyExpirySupportsFractionalAndPlainISOStrings() {
        let plain = SubscriptionAppAccess(hasAppAccess: true, nextCheckAt: "2026-10-01T00:00:00Z")
        let fractional = SubscriptionAppAccess(
            hasAppAccess: true, nextCheckAt: "2026-10-01T00:00:00.000Z")
        #expect(plain.expiration != nil)
        #expect(plain.expiration == fractional.expiration)
    }

    private func settle() async { try? await Task.sleep(for: .milliseconds(30)) }
    fileprivate static let yearly = SubscriptionPlan(
        id: "year", period: .yearly, price: "$90", amount: 90, currencyCode: "USD")
}

@MainActor
private final class PurchaseStub: SubscriptionPurchasing {
    var suspendPlans = false
    var plansContinuation: CheckedContinuation<[SubscriptionPlan], Never>?
    var outcome: SubscriptionPurchaseOutcome = .purchased
    var purchases = 0

    func plans(userID: String) async throws -> [SubscriptionPlan] {
        if suspendPlans { return await withCheckedContinuation { plansContinuation = $0 } }
        return [SubscriptionTests.yearly]
    }
    func purchase(planID: String, userID: String) async throws -> SubscriptionPurchaseOutcome {
        purchases += 1
        return outcome
    }
    func restore(userID: String) async throws -> Bool { false }
    func refresh(userID: String) async throws {}
}
