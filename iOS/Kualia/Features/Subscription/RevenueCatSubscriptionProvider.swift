import Foundation
import RevenueCat

/// Serializes purchases and identity changes, so an in-flight purchase finishes
/// under the same Clerk identity that initiated it.
@MainActor
final class RevenueCatSubscriptionProvider: SubscriptionPurchasing {
    private var tail: Task<Void, Never>?
    private var packages: [String: Package] = [:]
    private var packagesUserID: String?

    func plans(userID: String) async throws -> [SubscriptionPlan] {
        try await perform(userID: userID) {
            let offering = try await Purchases.shared.offerings().current
            let packages = [offering?.annual, offering?.monthly].compactMap { $0 }
            let eligibility = await Purchases.shared.checkTrialOrIntroDiscountEligibility(
                productIdentifiers: packages.map { $0.storeProduct.productIdentifier })
            self.packages = Dictionary(uniqueKeysWithValues: packages.map { ($0.identifier, $0) })
            self.packagesUserID = userID
            return packages.compactMap { package in
                let product = package.storeProduct
                guard let period = product.subscriptionPeriod,
                    (period.unit == .year && period.value == 1)
                        || (period.unit == .month && period.value == 1)
                else { return nil }
                var trial: String?
                if eligibility[product.productIdentifier]?.status == .eligible,
                    let discount = product.introductoryDiscount,
                    discount.paymentMode == .freeTrial, discount.price == 0
                {
                    trial = Self.trialDuration(
                        period: discount.subscriptionPeriod, count: discount.numberOfPeriods)
                }
                return SubscriptionPlan(
                    id: package.identifier, period: period.unit == .year ? .yearly : .monthly,
                    price: product.localizedPriceString, amount: product.price,
                    currencyCode: product.currencyCode, freeTrial: trial)
            }
        }
    }

    func purchase(planID: String, userID: String) async throws -> SubscriptionPurchaseOutcome {
        try await perform(userID: userID) {
            guard self.packagesUserID == userID, let package = self.packages[planID] else {
                throw PurchaseError.unavailable
            }
            do {
                let result = try await Purchases.shared.purchase(package: package)
                guard !result.userCancelled else { return .cancelled }
                // Use the confirmed purchased entitlement, never the displayed trial offer or
                // an existing/restored subscription, and send no product or customer identifiers.
                if let entitlement = result.customerInfo.entitlements.active.values.first(where: {
                    $0.productIdentifier == package.storeProduct.productIdentifier
                }) {
                    AdAttributionStore.shared.record(
                        entitlement.periodType == .trial ? .trialStarted : .subscribed)
                }
                return .purchased
            } catch {
                let code = (error as NSError).code
                if code == ErrorCode.purchaseCancelledError.rawValue { return .cancelled }
                if code == ErrorCode.paymentPendingError.rawValue { return .pending }
                throw error
            }
        }
    }

    func restore(userID: String) async throws -> Bool {
        try await perform(userID: userID) {
            let info = try await Purchases.shared.restorePurchases()
            return !info.entitlements.active.isEmpty
        }
    }

    func refresh(userID: String) async throws {
        try await perform(userID: userID) {
            _ = try await Purchases.shared.customerInfo(fetchPolicy: .fetchCurrent)
        }
    }

    private func perform<Value>(
        userID: String, operation: @escaping @MainActor () async throws -> Value
    ) async throws -> Value {
        let previous = tail
        let operationTask = Task { @MainActor in
            await previous?.value
            if !Purchases.isConfigured {
                Purchases.configure(
                    withAPIKey: AppEnvironment.current.revenueCatAPIKey, appUserID: userID)
            } else if Purchases.shared.appUserID != userID {
                _ = try await Purchases.shared.logIn(userID)
            }
            guard Purchases.shared.appUserID == userID else { throw PurchaseError.unavailable }
            return try await operation()
        }
        tail = Task { _ = try? await operationTask.value }
        return try await operationTask.value
    }

    private static func trialDuration(period: SubscriptionPeriod, count: Int) -> String? {
        let value = period.value * count
        guard value > 0 else { return nil }
        switch period.unit {
        case .day: return L10n.string("\(value) days")
        case .week: return L10n.string("\(value) weeks")
        case .month: return L10n.string("\(value) months")
        case .year: return L10n.string("\(value) years")
        @unknown default: return nil
        }
    }

    private enum PurchaseError: Error { case unavailable }
}
