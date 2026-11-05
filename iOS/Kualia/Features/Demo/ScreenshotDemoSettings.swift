#if DEBUG
    import Combine
    import Foundation

    extension ScreenshotDemoData {
        func makeFamily() -> FamilyStore {
            let name = "Morgan"
            let group = FamilyGroup(
                _id: "demo-family", name: L10n.string("\(name)'s Family"), currentUserRole: "owner",
                members: [
                    .init(
                        _id: "alex", name: "Alex Morgan", email: "alex@example.com", role: "owner",
                        isCurrentUser: true, joinedAt: "2025-01-01T12:00:00Z"),
                    .init(
                        _id: "sam", name: "Sam Morgan", email: "sam@example.com", role: "member",
                        isCurrentUser: false, joinedAt: "2025-01-01T12:00:00Z"),
                ], pendingInvites: [], inviteEmailQuota: nil)
            return .init(
                client: .init(
                    watch: { Self.publisher(group) },
                    change: { _ in throw ScreenshotDemoError.unavailable },
                    preview: { _ in
                        Fail(error: ScreenshotDemoError.unavailable).eraseToAnyPublisher()
                    }))
        }
        func makeRules() -> RulesStore {
            let rules = [
                ("Walmart", "groceries"), ("Netflix", "subscriptions"), ("Uber", "transport"),
            ].enumerated().map { index, item in
                TransactionRule(
                    id: "demo-rule-\(index)", workspaceId: workspace.id, name: item.0,
                    isActive: true, priority: Double(index + 1),
                    conditions: .init(merchantName: [.init(matchType: .contains, value: item.0)]),
                    actions: .init(setCategoryId: item.1), usageCount: 24 + index * 11,
                    lastUsedAt: today)
            }
            let choices = RuleChoices(
                merchants: Dictionary(grouping: records, by: \.merchantId).compactMap {
                    id, values in
                    values.first.map {
                        .init(id: id, name: $0.merchantName, logoURL: $0.merchantLogoUrl)
                    }
                }, categories: categories.map { .init(id: $0.id, name: $0.name) },
                accounts: accounts.map {
                    .init(
                        id: $0.id, name: $0.name, logoURL: $0.resolvedLogoUrl,
                        accountType: $0.accountType)
                })
            return .init(
                workspaceID: workspace.id, currency: workspace.currencyCode ?? "USD",
                client: .init(
                    watchRules: { _ in Self.publisher(rules) },
                    watchChoices: { _ in Self.publisher(choices) },
                    save: { _, _, _ in throw ScreenshotDemoError.unavailable },
                    setActive: { _, _, _ in throw ScreenshotDemoError.unavailable },
                    delete: { _, _ in throw ScreenshotDemoError.unavailable },
                    apply: { _, _ in throw ScreenshotDemoError.unavailable },
                    count: { _, _ in Self.publisher(0) }))
        }
        func makeMerchants() -> MerchantsStore {
            let merchants = Dictionary(grouping: records, by: \.merchantId).compactMap {
                id, records -> SettingsMerchant? in
                guard let entry = records.first else { return nil }
                return .init(
                    id: id, workspaceId: workspace.id, name: entry.merchantName,
                    logoUrl: entry.merchantLogoUrl, transactionCount: records.count,
                    activeRecurringTransactionCount: planned.allPlannedTransactions.filter {
                        $0.merchantId == id
                    }.count,
                    totalSpent: NSDecimalNumber(decimal: records.reduce(0) { $0 + $1.amount })
                        .int64Value)
            }
            return .init(
                workspaceID: workspace.id, currency: workspace.currencyCode ?? "USD",
                client: .init(
                    watch: { _ in Self.publisher(merchants) },
                    update: { _ in throw ScreenshotDemoError.unavailable }, isAvailable: { true }))
        }
    }
#endif
