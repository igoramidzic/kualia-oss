import Foundation

enum SubscriptionAccessState: Equatable {
    case loading, allowed, paywall
    case failed(String)
}

struct SubscriptionAppAccess: Decodable, Equatable {
    struct Subscription: Decodable, Equatable {
        let status: String
        let subscriptionType: String
        let expiresAt: String?
    }

    struct Family: Decodable, Equatable {
        let role: String
        let ownerHasValidSubscription: Bool
    }

    let hasAppAccess: Bool
    var accessSource: String? = nil
    var ownSubscription: Subscription? = nil
    var familyAccess: Family? = nil
    var nextCheckAt: String? = nil

    var requiresFamilyRenewal: Bool {
        !hasAppAccess && familyAccess?.role == "member"
            && familyAccess?.ownerHasValidSubscription == false
    }

    var expiration: Date? {
        let value =
            nextCheckAt
            ?? (accessSource == "own_subscription"
                && ["trialing", "canceled"].contains(ownSubscription?.status ?? "")
                ? ownSubscription?.expiresAt : nil)
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.remove(.withFractionalSeconds)
        return formatter.date(from: value)
    }
}

struct SubscriptionPlan: Identifiable, Equatable {
    enum Period: String { case monthly, yearly }
    let id: String
    let period: Period
    let price: String
    let amount: Decimal
    let currencyCode: String?
    var freeTrial: String? = nil

    var title: String { period == .yearly ? L10n.string("Yearly") : L10n.string("Monthly") }
    var billingUnit: String { period == .yearly ? L10n.string("year") : L10n.string("month") }
    var billingSummary: String { "\(price) / \(billingUnit)" }
    var terms: String {
        if let freeTrial {
            return
                L10n.string(
                    "\(freeTrial) free, then \(billingSummary). Renews automatically. Cancel anytime in App Store settings."
                )
        }
        return
            L10n.string(
                "\(billingSummary), billed \(period == .yearly ? L10n.string("yearly") : L10n.string("monthly")). Renews automatically. Cancel anytime in App Store settings."
            )
    }

    func savings(comparedWith monthly: Self?) -> Int? {
        guard period == .yearly, let monthly, monthly.period == .monthly,
            currencyCode != nil, currencyCode == monthly.currencyCode,
            amount > 0, monthly.amount > 0, amount < monthly.amount * 12
        else { return nil }
        let percentage = (1 - amount / (monthly.amount * 12)) * 100
        return Int((percentage as NSDecimalNumber).doubleValue)
    }
}

enum SubscriptionPurchaseOutcome { case purchased, cancelled, pending }

@MainActor
protocol SubscriptionPurchasing: AnyObject {
    func plans(userID: String) async throws -> [SubscriptionPlan]
    func purchase(planID: String, userID: String) async throws -> SubscriptionPurchaseOutcome
    func restore(userID: String) async throws -> Bool
    func refresh(userID: String) async throws
}
