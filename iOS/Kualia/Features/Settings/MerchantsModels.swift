import ConvexMobile
import Foundation

struct SettingsMerchant: Decodable, Identifiable, Hashable {
    let id: String
    let workspaceId: String
    var name: String
    var logoUrl: String?
    var globalMerchantLogoUrl: String?
    var logoState: EntityLogoState
    let transactionCount: Int
    let activeRecurringTransactionCount: Int
    let totalSpent: Int64
    let isDeleted: Bool

    /// Match the existing merchant query/list: magnitude of the net amount, including refunds.
    /// Decimal avoids abs(Int64.min) and overflow when summing multiple merchants.
    var amount: Decimal { abs(Decimal(totalSpent)) }
    var requiresMerge: Bool { transactionCount > 0 || activeRecurringTransactionCount > 0 }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    init(
        id: String, workspaceId: String, name: String, logoUrl: String?, transactionCount: Int,
        activeRecurringTransactionCount: Int, totalSpent: Int64
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.name = name
        self.logoUrl = logoUrl
        self.globalMerchantLogoUrl = nil
        self.logoState = .automatic
        self.transactionCount = transactionCount
        self.activeRecurringTransactionCount = activeRecurringTransactionCount
        self.totalSpent = totalSpent
        self.isDeleted = false
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        workspaceId = try values.decode(String.self, forKey: .workspaceId)
        name = try values.decode(String.self, forKey: .name)
        logoUrl = try values.decodeIfPresent(String.self, forKey: .logoUrl)
        globalMerchantLogoUrl = try values.decodeIfPresent(
            String.self, forKey: .globalMerchantLogoUrl)
        logoState = EntityLogoState(
            rawURL: try values.decodeIfPresent(String.self, forKey: .rawLogoUrl),
            hasRawValue: values.contains(.rawLogoUrl))
        transactionCount = try values.decodeIfPresent(Int.self, forKey: .transactionCount) ?? 0
        activeRecurringTransactionCount =
            try values.decodeIfPresent(Int.self, forKey: .activeRecurringTransactionCount) ?? 0
        totalSpent =
            try values.decodeIfPresent(ConvexInt.self, forKey: .totalSpent)?.wrappedValue ?? 0
        isDeleted = try values.decodeIfPresent(Bool.self, forKey: .isDeleted) ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case workspaceId, name, logoUrl, rawLogoUrl, globalMerchantLogoUrl
        case transactionCount, activeRecurringTransactionCount, totalSpent, isDeleted
    }
}

struct MerchantSelection {
    var isSelecting = false
    private(set) var ids: Set<String> = []

    mutating func begin() { isSelecting = true }
    mutating func toggle(_ id: String) {
        isSelecting = true
        if !ids.insert(id).inserted { ids.remove(id) }
    }
    mutating func reconcile(_ merchants: [SettingsMerchant]) {
        ids.formIntersection(merchants.map(\.id))
    }
    mutating func end() {
        isSelecting = false
        ids = []
    }
    func merchants(in merchants: [SettingsMerchant]) -> [SettingsMerchant] {
        merchants.filter { ids.contains($0.id) }
    }
}

struct MerchantMergeRequest: Identifiable, Hashable {
    let id = UUID()
    let merchants: [SettingsMerchant]

    func sources(targetID: String) -> [SettingsMerchant] {
        merchants.filter { $0.id != targetID }
    }
    func allowsTarget(_ merchant: SettingsMerchant) -> Bool {
        !merchant.isDeleted && merchants.contains { $0.id != merchant.id }
    }
}

enum MerchantOrder: String, CaseIterable {
    case count, amount
    var title: String {
        switch self {
        case .count: L10n.string("Transaction count")
        case .amount: L10n.string("Total amount")
        }
    }

    func merchants(_ merchants: [SettingsMerchant], matching search: String) -> [SettingsMerchant] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return merchants.filter {
            !$0.isDeleted && (query.isEmpty || $0.name.localizedStandardContains(query))
        }.sorted { lhs, rhs in
            let left = self == .count ? Decimal(lhs.transactionCount) : lhs.amount
            let right = self == .count ? Decimal(rhs.transactionCount) : rhs.amount
            if left != right { return left > right }
            let comparison = lhs.name.localizedStandardCompare(rhs.name)
            return comparison == .orderedSame ? lhs.id < rhs.id : comparison == .orderedAscending
        }
    }
}

struct MerchantOverview {
    let merchantCount: Int
    let transactionCount: Decimal
    let amount: Decimal

    init(merchants: [SettingsMerchant]) {
        let active = merchants.filter { !$0.isDeleted }
        merchantCount = active.count
        transactionCount = active.reduce(.zero) { $0 + Decimal($1.transactionCount) }
        amount = active.reduce(.zero) { $0 + $1.amount }
    }
}

struct MerchantDraft: Equatable {
    var name: String
    var logo: EntityLogoChoice = .unchanged
    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    func isDirty(comparedTo merchant: SettingsMerchant) -> Bool {
        trimmedName != merchant.name || logo != .unchanged
    }

    func arguments(workspaceID: String, merchant: SettingsMerchant) -> [String: ConvexEncodable?] {
        var result: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "merchantId": merchant.id,
        ]
        if trimmedName != merchant.name { result["name"] = trimmedName }
        if let argument = logo.argument { result["logoUrl"] = argument }
        return result
    }
}
