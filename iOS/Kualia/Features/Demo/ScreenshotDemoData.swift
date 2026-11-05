#if DEBUG
    import Combine
    import Foundation

    /// One immutable ledger supplies every demo screen. No provider here captures a live client.
    @MainActor
    final class ScreenshotDemoData {
        static let workspaceID = "screenshot-demo"
        let now: Date
        let today: String
        let month: Int
        let workspace: AppWorkspace
        let records: [ReportEntry]

        struct ScheduledPayment {
            let name: String
            let logo: String?
            let categoryID: String
            let amount: Int64
            let day: Int
            var accountID = "amex"
            var isWeekly = false
            var id: String { logo ?? categoryID }

            func occurs(on date: Date) -> Bool {
                ReportDates.calendar.component(isWeekly ? .weekday : .day, from: date) == day
            }

            func transactionID(date: String) -> String { "demo-planned-\(id)-\(date)" }
        }

        // Use the same schedule for calendar events and their recorded payments.
        static let scheduledPayments: [ScheduledPayment] = [
            .init(
                name: "Amazon", logo: "amazon", categoryID: "subscriptions", amount: -1_499, day: 3),
            .init(
                name: "Netflix", logo: "netflix", categoryID: "subscriptions", amount: -1_799,
                day: 5),
            .init(
                name: "Walmart", logo: "walmart", categoryID: "subscriptions", amount: -1_295,
                day: 7, accountID: "capitalone"),
            .init(
                name: "Spotify", logo: "spotify", categoryID: "subscriptions", amount: -1_199,
                day: 9),
            .init(name: "Uber", logo: "uber", categoryID: "transport", amount: -999, day: 11),
            .init(
                name: "Duke Energy", logo: nil, categoryID: "utilities", amount: -13_480, day: 12,
                accountID: "chase"),
            .init(
                name: "Acme Studio", logo: nil, categoryID: "income", amount: 325_000, day: 15,
                accountID: "chase"),
            .init(
                name: "Target", logo: "target", categoryID: "shopping", amount: -4_890, day: 16,
                accountID: "capitalone"),
            .init(name: "Apple", logo: "apple", categoryID: "subscriptions", amount: -299, day: 18),
            .init(
                name: "Whole Foods Market", logo: "wholefoods", categoryID: "groceries",
                amount: -11_746, day: 20, accountID: "sofi"),
            .init(
                name: "CVS Pharmacy", logo: "cvs", categoryID: "health", amount: -2_499, day: 21,
                accountID: "capitalone"),
            .init(
                name: "Verizon", logo: "verizon", categoryID: "utilities", amount: -8_500, day: 24,
                accountID: "sofi"),
            .init(
                name: "Starbucks", logo: "starbucks", categoryID: "dining", amount: -2_500, day: 27,
                accountID: "sofi"),
            .init(
                name: "Parkside Apartments", logo: nil, categoryID: "housing", amount: -46_250,
                day: 6, accountID: "chase", isWeekly: true),
        ]

        struct Category {
            let id: String
            let name: String
            let assigned: Int64
            var carry: Int64 = 0
        }
        var categories: [Category] {
            [
                .init(id: "housing", name: L10n.string("Housing"), assigned: 185_000),
                .init(id: "groceries", name: L10n.string("Groceries"), assigned: 65_000),
                .init(id: "dining", name: L10n.string("Dining out"), assigned: 22_000),
                .init(id: "transport", name: L10n.string("Transport"), assigned: 18_000),
                .init(id: "shopping", name: L10n.string("Shopping"), assigned: 25_000),
                .init(id: "subscriptions", name: L10n.string("Subscriptions"), assigned: 8_000),
                .init(id: "utilities", name: L10n.string("Utilities"), assigned: 24_000),
                .init(id: "health", name: L10n.string("Health"), assigned: 12_000),
                .init(
                    id: "travel", name: L10n.string("Next adventure"), assigned: 35_000,
                    carry: 215_000),
                .init(
                    id: "emergency", name: L10n.string("Emergency Fund"), assigned: 50_000,
                    carry: 1_200_000),
            ]
        }
        var feedWorkspace: TransactionFeedWorkspace {
            .init(
                id: workspace.id, name: workspace.name,
                currencyCode: workspace.currencyCode ?? "USD",
                minorUnit: 2,
                timezoneIdentifier: "America/New_York")
        }
        static func logo(_ name: String) -> String { "kualia-demo://logo/\(name)" }
        static func publisher<Value>(_ value: Value) -> AnyPublisher<Value, Error> {
            Just(value).setFailureType(to: Error.self).eraseToAnyPublisher()
        }

        init(now: Date = .now, language: AppLanguage? = nil) {
            self.now = now
            today = ReportDates.key(now, timezone: "America/New_York")
            month = PlannedDates.month(today)
            workspace = .init(
                _id: Self.workspaceID, name: L10n.string("Personal"),
                currencyCode: ScreenshotDemoMode.currencyCode(
                    for: language ?? AppLanguageStore.shared.preference), minorUnit: 2,
                timezoneIdentifier: "America/New_York")
            // Keep two years for year-over-year comparisons, including a full previous year.
            let end = ReportDates.date(today)
            let start = ReportDates.add(.month, -25, to: end)
            let purchases: [(String, String, String, Int64)] = [
                ("Walmart", "walmart", "groceries", 7_842),
                ("Starbucks", "starbucks", "dining", 685),
                ("Target", "target", "shopping", 4_629),
                ("Whole Foods Market", "wholefoods", "groceries", 9_364),
                ("Uber", "uber", "transport", 2_145),
                ("Amazon", "amazon", "shopping", 3_799),
                ("Starbucks", "starbucks", "dining", 1_845),
                ("Walmart", "walmart", "groceries", 6_327),
            ]
            var ledger: [ReportEntry] = []
            let names: [String: String] = [
                "housing": L10n.string("Housing"), "groceries": L10n.string("Groceries"),
                "dining": L10n.string("Dining out"), "transport": L10n.string("Transport"),
                "shopping": L10n.string("Shopping"), "subscriptions": L10n.string("Subscriptions"),
                "utilities": L10n.string("Utilities"), "health": L10n.string("Health"),
                "income": L10n.string("Income"),
            ]
            let accountNames = [
                "chase": "Chase Total Checking", "sofi": "SoFi Checking",
                "savings": "Ally Savings", "amex": "Amex Gold", "capitalone": "Capital One Venture",
            ]
            let monthlySpending: [Int64] = [
                92, 108, 96, 117, 101, 124, 109, 88, 103, 114, 128, 119,
            ]
            var date = start
            var index = 0
            while date <= end {
                let key = ReportDates.key(date)
                let day = ReportDates.calendar.component(.day, from: date)
                let monthNumber = ReportDates.calendar.component(.month, from: date)
                let weekday = ReportDates.calendar.component(.weekday, from: date)
                func add(
                    _ merchant: String, _ logo: String?, _ category: String,
                    _ amount: Int64, _ account: String = "chase", _ pending: Bool = false,
                    id: String? = nil
                ) {
                    ledger.append(
                        .init(
                            id: id ?? "demo-\(key)-\(ledger.count)", date: key, accountId: account,
                            accountName: accountNames[account] ?? account,
                            merchantId: logo ?? category, merchantName: merchant,
                            merchantLogoUrl: logo.map(Self.logo),
                            status: pending ? "pending" : "cleared",
                            reviewStatus: pending ? "needs_review" : "reviewed", notes: nil,
                            movements: [
                                .init(
                                    categoryId: category, categoryName: names[category] ?? category,
                                    amount: Decimal(amount))
                            ]))
                }
                let purchase = purchases[(index + monthNumber) % purchases.count]
                let variation = Int64((day * day * 37 + monthNumber * 113) % 2700)
                let spendingScale = monthlySpending[monthNumber - 1]
                // Mix quieter days, small purchases, and larger weekend errands.
                if !day.isMultiple(of: 11) || key == today {
                    let amount = (purchase.3 + variation) * spendingScale / 100
                    add(
                        purchase.0, purchase.1, purchase.2, -amount,
                        index.isMultiple(of: 3)
                            ? "amex" : index.isMultiple(of: 4) ? "sofi" : "chase",
                        key == today)
                }
                if weekday == 7 || index.isMultiple(of: 5) {
                    let extra = purchases[(index * 3 + 2) % purchases.count]
                    let amount = (extra.3 + Int64((index * 719) % 9000)) * spendingScale / 100
                    add(extra.0, extra.1, extra.2, -amount, "capitalone")
                }
                if day == 1 { add("Acme Studio", nil, "income", 325_000) }
                for payment in Self.scheduledPayments where payment.occurs(on: date) {
                    add(
                        payment.name, payment.logo, payment.categoryID, payment.amount,
                        payment.accountID, id: payment.transactionID(date: key))
                }
                if day == 26 { add("Acme Studio", nil, "income", 38_000 + variation) }
                if day == 28 {
                    add("Ally Bank", "ally", "income", 4_182 + Int64(monthNumber * 23), "savings")
                }
                date = ReportDates.add(.day, 1, to: date)
                index += 1
            }
            records = ledger.sorted { $0.date == $1.date ? $0.id > $1.id : $0.date > $1.date }
        }

        var accounts: [AccountSnapshot] {
            [
                account(
                    "chase", "Chase Total Checking", "banking_checking", 648_235, "chase", "Chase",
                    "#117ACA", "4821"),
                account(
                    "sofi", "SoFi Checking", "banking_checking", 236_890, "sofi", "SoFi", "#00A5AC",
                    "7038"),
                account(
                    "savings", "Ally Savings", "banking_savings", 1_485_600, "ally", "Ally Bank",
                    "#650360", "2904"),
                account(
                    "amex", "Amex Gold", "credit_credit_card", -128_450, "americanexpress",
                    "American Express", "#006FCF", "1005"),
                account(
                    "capitalone", "Capital One Venture", "credit_credit_card", -42_680,
                    "capitalone", "Capital One", "#004977", "9156"),
            ]
        }
        private func account(
            _ id: String, _ name: String, _ type: String, _ balance: Int64,
            _ logo: String, _ institution: String, _ color: String, _ mask: String
        ) -> AccountSnapshot {
            let pending = records.filter { $0.accountId == id && $0.status == "pending" }
                .reduce(Int64.zero) { $0 + NSDecimalNumber(decimal: $1.amount).int64Value }
            return .init(
                id: id, name: name, accountType: type, currentBalance: balance,
                pendingBalance: pending, clearedBalance: balance - pending,
                resolvedLogoUrl: Self.logo(logo), institutionPrimaryColor: color,
                institutionName: institution, accountNumberMask: mask,
                isLinked: true, firstBalanceYearMonth: monthKey(BudgetMonth.offset(month, by: -11)))
        }
        func monthKey(_ month: Int) -> String {
            String(format: "%04d-%02d", month / 100, month % 100)
        }
        var history: [AccountHistoryMonth] {
            // Independent monthly snapshots: paycheck cycles, savings deposits, and card payments.
            let balances: [String: [Int64]] = [
                "chase": [
                    424_618, 398_042, 523_476, 486_523, 712_439, 609_614, 564_378, 731_955, 681_712,
                    538_984, 709_641,
                ],
                "sofi": [
                    128_437, 175_048, 142_691, 218_965, 167_423, 256_879, 289_314, 224_085, 271_632,
                    198_557, 264_918,
                ],
                "savings": [
                    785_760, 832_418, 914_255, 988_574, 1_030_621, 1_129_438, 1_096_145, 1_198_612,
                    1_274_068, 1_220_644, 1_396_428,
                ],
                "amex": [
                    -213_467, -143_828, -186_291, -92_416, -169_783, -238_654, -136_429, -197_463,
                    -287_546, -149_382, -215_764,
                ],
                "capitalone": [
                    -86_432, -33_865, -69_527, -104_873, -48_219, -127_456, -91_842, -37_489,
                    -143_675, -65_823, -91_248,
                ],
            ]
            let currentAccounts = accounts
            return (-11...0).map { offset in
                .init(
                    yearMonth: monthKey(BudgetMonth.offset(month, by: offset)),
                    accounts: currentAccounts.map { account in
                        return .init(
                            accountId: account.id,
                            balance: offset == 0
                                ? account.currentBalance : balances[account.id]![offset + 11])
                    })
            }
        }
        var structure: BudgetStructure {
            .init(
                workspace: workspace.budgetWorkspace,
                categoryGroups: [
                    .init(
                        categoryGroup: .init(
                            _id: "everyday", name: L10n.string("Everyday essentials"),
                            type: "expense"),
                        categories: categories.prefix(8).map {
                            .init(_id: $0.id, name: $0.name, iconName: nil, type: "expense")
                        }),
                    .init(
                        categoryGroup: .init(
                            _id: "future", name: L10n.string("Looking ahead"), type: "expense"),
                        categories: categories.suffix(2).map {
                            .init(_id: $0.id, name: $0.name, iconName: nil, type: "expense")
                        }),
                ])
        }
        func budgetSnapshot(month requested: Int) -> BudgetSnapshot {
            let snapshots = (-11...2).map { BudgetMonth.offset(requested, by: $0) }.map {
                selected in
                let prefix = monthKey(selected)
                let amounts = Dictionary(
                    uniqueKeysWithValues: categories.map { category in
                        let activity = records.filter { $0.date.hasPrefix(prefix) }
                            .flatMap(\.movements).filter { $0.categoryId == category.id }.reduce(
                                Decimal.zero
                            ) { $0 + $1.amount }
                        let spent = NSDecimalNumber(decimal: activity).int64Value
                        let target = category.assigned + (category.id == "travel" ? 15_000 : 0)
                        let assigned = max(target, -spent - category.carry)
                        return (
                            category.id,
                            BudgetCategoryAmounts(
                                assignedAmount: assigned,
                                available: category.carry + assigned + spent,
                                activity: spent,
                                target: .init(
                                    targetAmount: target, underfundedAmount: 0,
                                    assignmentNeeded: target, remainingToAssign: 0,
                                    fundedRatio: 1,
                                    spentRatio: assigned > 0
                                        ? min(1, Double(max(0, -spent)) / Double(assigned)) : 0))
                        )
                    })
                let funded = categories.reduce(Int64.zero) { $0 + $1.assigned }
                return BudgetMonthSnapshot(
                    yearMonth: selected, budgetData: amounts,
                    summary: .init(
                        totalTargetAmount: funded + 15_000, totalFunded: funded + 15_000,
                        totalRemainingToFund: 0))
            }
            return .init(
                months: snapshots,
                availableRange: .init(
                    minYearMonth: BudgetMonth.offset(month, by: -11),
                    maxYearMonth: BudgetMonth.offset(month, by: 2)),
                readyToAssign: 45_000)
        }

        func feedItem(_ entry: ReportEntry) -> TransactionFeedItem {
            let account = accounts.first { $0.id == entry.accountId }
            var item = TransactionFeedItem(
                id: entry.id, date: entry.date, type: .regular,
                status: TransactionFeedStatus(rawValue: entry.status) ?? .cleared,
                reviewStatus: TransactionFeedReviewStatus(rawValue: entry.reviewStatus)
                    ?? .reviewed,
                amount: NSDecimalNumber(decimal: entry.amount).int64Value, notes: entry.notes,
                merchantName: entry.merchantName, merchantLogoUrl: entry.merchantLogoUrl,
                bankAccountName: entry.accountName, bankAccountType: account?.accountType,
                bankAccountLogoUrl: account?.resolvedLogoUrl,
                categoryNames: entry.movements.map(\.categoryName))
            item.categoryActivity = .init(
                amount: NSDecimalNumber(decimal: entry.amount).stringValue,
                outflow: NSDecimalNumber(decimal: max(0, -entry.amount)).stringValue,
                inflow: NSDecimalNumber(decimal: max(0, entry.amount)).stringValue)
            return item
        }
        func feedResponse(entries: [ReportEntry], cursor: String?, limit: Int)
            -> TransactionFeedResponse
        {
            let offset = min(max(0, Int(cursor ?? "") ?? 0), entries.count)
            let end = min(offset + limit, entries.count)
            let review = entries.filter { $0.reviewStatus == "needs_review" }.map(feedItem)
            let pending = entries.filter { $0.status == "pending" }.map(feedItem)
            return .init(
                workspace: feedWorkspace,
                transactions: .init(
                    page: entries[offset..<end].map(feedItem), continueCursor: String(end),
                    isDone: end == entries.count),
                filterCounts: .init(needsReview: review.count, pending: pending.count),
                filterSetsComplete: true,
                filterTransactions: .init(needsReview: review, pending: pending))
        }
        func searchEntries(_ filters: TransactionSearchFilters) -> [ReportEntry] {
            records.filter { entry in
                let matchingMovements = entry.movements.filter {
                    (filters.categoryID == nil || $0.categoryId == filters.categoryID)
                        && (filters.group == nil || $0.resolvedGroupID == filters.group?.id)
                }
                let matchesFlow =
                    filters.reportActivity
                    ? matchingMovements.contains {
                        filters.flow == .inflow
                            ? $0.amount > 0
                            : filters.flow == .outflow ? $0.amount < 0 : $0.amount != 0
                    }
                    : (filters.flow == nil || (filters.flow == .inflow && entry.amount > 0)
                        || (filters.flow == .outflow && entry.amount < 0))
                return
                    (filters.accountID == nil || filters.accountID == entry.accountId)
                    && ((filters.categoryID == nil && filters.group == nil)
                        || !matchingMovements.isEmpty)
                    && (filters.merchant == nil || filters.merchant?.id == entry.merchantId)
                    && (!filters.reportActivity || entry.status != "pending")
                    && (filters.startDate == nil || entry.date >= filters.startDate!)
                    && (filters.endDate == nil || entry.date <= filters.endDate!)
                    && (filters.status == nil || filters.status?.rawValue == entry.status
                        || filters.status?.rawValue == entry.reviewStatus)
                    && matchesFlow
                    && (!filters.hasNotes || !(entry.notes ?? "").isEmpty)
                    && (filters.text.isEmpty
                        || "\(entry.merchantName) \(entry.accountName) \(entry.movements.map(\.categoryName).joined(separator: " "))"
                            .localizedCaseInsensitiveContains(filters.text))
            }
        }
    }

    enum ScreenshotDemoError: Error { case unavailable }
#endif
