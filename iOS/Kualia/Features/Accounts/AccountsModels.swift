import ConvexMobile
import Foundation

enum AccountCategory: String, CaseIterable, Identifiable {
    case banking, credit, investment, loan

    var id: String { rawValue }
    var title: String {
        switch self {
        case .banking: L10n.string("Cash")
        case .credit: L10n.string("Credit")
        case .investment: L10n.string("Investments")
        case .loan: L10n.string("Loans")
        }
    }
    /// Stable backend keys are independent of the localized group titles.
    var orderingKey: String {
        switch self {
        case .banking: "Banking"
        case .credit: "Credit"
        case .investment: "Investment"
        case .loan: "Loan"
        }
    }
    var isLiability: Bool { self == .credit || self == .loan }

    static func from(_ accountType: String) -> Self? {
        accountType.split(separator: "_").first.flatMap { Self(rawValue: String($0)) }
    }
}

struct AccountCategoryFilter {
    private(set) var categories: Set<AccountCategory> = []
    private(set) var isSelectingMultiple = false

    func includes(_ category: AccountCategory) -> Bool {
        categories.isEmpty || categories.contains(category)
    }

    func isSelected(_ category: AccountCategory?) -> Bool {
        category.map { categories.contains($0) } ?? categories.isEmpty
    }

    mutating func select(_ category: AccountCategory?) {
        guard let category else {
            self = Self()
            return
        }
        guard isSelectingMultiple else {
            categories = [category]
            return
        }
        if !categories.insert(category).inserted { categories.remove(category) }
        if categories.isEmpty { isSelectingMultiple = false }
    }

    mutating func beginMultipleSelection(with category: AccountCategory) {
        isSelectingMultiple = true
        categories.insert(category)
    }

    mutating func reconcile(availableCategories: [AccountCategory]) {
        categories.formIntersection(availableCategories)
        if categories.isEmpty { isSelectingMultiple = false }
    }
}

struct AccountListSection: Identifiable {
    let category: AccountCategory
    let accounts: [AccountSnapshot]
    var id: AccountCategory { category }
    var totalBalance: Decimal {
        accounts.reduce(.zero) { $0 + Decimal($1.currentBalance) }
    }

    static func build(accounts: [AccountSnapshot]) -> [Self] {
        AccountCategory.allCases.compactMap { category in
            let members = accounts.filter { $0.category == category }
            return members.isEmpty ? nil : Self(category: category, accounts: members)
        }
    }
}

struct AccountTypeOption: Identifiable, Equatable {
    let rawValue: String
    let title: String
    var id: String { rawValue }
    var category: AccountCategory { AccountCategory.from(rawValue) ?? .banking }

    static let all: [Self] = [
        .init(rawValue: "banking_checking", title: L10n.string("Checking")),
        .init(rawValue: "banking_savings", title: L10n.string("Savings")),
        .init(rawValue: "banking_cash", title: L10n.string("Cash")),
        .init(rawValue: "banking_cash_management", title: L10n.string("Cash management")),
        .init(rawValue: "banking_money_market", title: L10n.string("Money market")),
        .init(rawValue: "banking_cd", title: L10n.string("Certificate of deposit")),
        .init(rawValue: "banking_other", title: L10n.string("Other cash account")),
        .init(rawValue: "credit_credit_card", title: L10n.string("Credit card")),
        .init(rawValue: "credit_line_of_credit", title: L10n.string("Line of credit")),
        .init(rawValue: "credit_other", title: L10n.string("Other credit account")),
        .init(rawValue: "investment_brokerage", title: L10n.string("Brokerage")),
        .init(rawValue: "investment_401k", title: "401(k)"),
        .init(rawValue: "investment_ira", title: "IRA"),
        .init(rawValue: "investment_keogh", title: L10n.string("Keogh")),
        .init(rawValue: "investment_roth_ira", title: L10n.string("Roth IRA")),
        .init(rawValue: "investment_roth_401k", title: L10n.string("Roth 401(k)")),
        .init(rawValue: "investment_hsa", title: L10n.string("Health savings account")),
        .init(rawValue: "investment_sep_ira", title: L10n.string("SEP IRA")),
        .init(rawValue: "investment_simple_ira", title: L10n.string("SIMPLE IRA")),
        .init(rawValue: "investment_529_plan", title: L10n.string("529 plan")),
        .init(rawValue: "investment_403b", title: "403(b)"),
        .init(rawValue: "investment_other", title: L10n.string("Other investment")),
        .init(rawValue: "loan_auto", title: L10n.string("Auto loan")),
        .init(rawValue: "loan_business", title: L10n.string("Business loan")),
        .init(rawValue: "loan_commercial", title: L10n.string("Commercial loan")),
        .init(rawValue: "loan_construction", title: L10n.string("Construction loan")),
        .init(rawValue: "loan_home_equity", title: L10n.string("Home equity loan")),
        .init(rawValue: "loan_mortgage", title: L10n.string("Mortgage")),
        .init(rawValue: "loan_student", title: L10n.string("Student loan")),
        .init(rawValue: "loan_other", title: L10n.string("Other loan")),
    ]
}

struct AccountSnapshot: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let accountType: String
    let currentBalance: Int64
    var pendingBalance: Int64?
    var clearedBalance: Int64?
    var isClosed = false
    var isDeleted = false
    var notes: String?
    var logoUrl: String?
    var resolvedLogoUrl: String?
    var institutionLogoUrl: String?
    var logoState: EntityLogoState = .automatic
    var institutionPrimaryColor: String?
    var institutionName: String?
    var accountNumberMask: String?
    var visualIdentityMode: String?
    var iconName: String?
    var iconColorId: String?
    var closedAt: String?
    var lastReconciledAt: String?
    var firstBalanceYearMonth: String?
    var isLinked = false

    var category: AccountCategory { AccountCategory.from(accountType) ?? .banking }
    var resolvedClearedBalance: Decimal {
        clearedBalance.map(Decimal.init)
            ?? Decimal(currentBalance) - Decimal(pendingBalance ?? 0)
    }

    var lastReconciledDate: Date? {
        guard let lastReconciledAt else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: lastReconciledAt)
            ?? ISO8601DateFormatter().date(from: lastReconciledAt)
    }
    var typeTitle: String {
        AccountTypeOption.all.first { $0.rawValue == accountType }?.title ?? L10n.string("Account")
    }

    init(
        id: String, name: String, accountType: String, currentBalance: Int64 = 0,
        pendingBalance: Int64? = nil, clearedBalance: Int64? = nil,
        isClosed: Bool = false, isDeleted: Bool = false, notes: String? = nil,
        logoUrl: String? = nil, resolvedLogoUrl: String? = nil,
        institutionPrimaryColor: String? = nil, institutionName: String? = nil,
        accountNumberMask: String? = nil, visualIdentityMode: String? = nil,
        iconName: String? = nil, iconColorId: String? = nil, closedAt: String? = nil,
        isLinked: Bool = false, firstBalanceYearMonth: String? = nil,
        institutionLogoUrl: String? = nil, logoState: EntityLogoState? = nil
    ) {
        self.id = id
        self.name = name
        self.accountType = accountType
        self.currentBalance = currentBalance
        self.pendingBalance = pendingBalance
        self.clearedBalance = clearedBalance
        self.isClosed = isClosed
        self.isDeleted = isDeleted
        self.notes = notes
        self.logoUrl = logoUrl
        self.resolvedLogoUrl = resolvedLogoUrl
        self.institutionLogoUrl = institutionLogoUrl
        self.logoState = logoState ?? EntityLogoState(rawURL: logoUrl, hasRawValue: logoUrl != nil)
        self.institutionPrimaryColor = institutionPrimaryColor
        self.institutionName = institutionName
        self.accountNumberMask = accountNumberMask
        self.visualIdentityMode = visualIdentityMode
        self.iconName = iconName
        self.iconColorId = iconColorId
        self.closedAt = closedAt
        self.isLinked = isLinked
        self.firstBalanceYearMonth = firstBalanceYearMonth
    }

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, accountType, currentBalance, pendingBalance, clearedBalance, isClosed, isDeleted
        case notes, logoUrl, resolvedLogoUrl, institutionLogoUrl, visualIdentityMode, iconName,
            iconColorId, closedAt, lastReconciledAt
        case bankLinkAccount, financeKitAccount, bankLinkAccountId, financeKitAccountId
        case firstBalanceYearMonth
    }

    private struct LinkedAccount: Decodable {
        let accountNumberMask: String?
        let bankLink: Link?
        struct Link: Decodable {
            let institution: Institution?
            struct Institution: Decodable {
                let name: String?
                let primaryColor: String?
            }
        }
    }

    private struct WalletAccount: Decodable { let institutionName: String? }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        accountType = try values.decode(String.self, forKey: .accountType)
        currentBalance = try values.decode(ConvexInt.self, forKey: .currentBalance).wrappedValue
        pendingBalance = try values.decodeIfPresent(ConvexInt.self, forKey: .pendingBalance)?
            .wrappedValue
        clearedBalance = try values.decodeIfPresent(ConvexInt.self, forKey: .clearedBalance)?
            .wrappedValue
        isClosed = try values.decodeIfPresent(Bool.self, forKey: .isClosed) ?? false
        isDeleted = try values.decodeIfPresent(Bool.self, forKey: .isDeleted) ?? false
        notes = try values.decodeIfPresent(String.self, forKey: .notes)
        logoUrl = try values.decodeIfPresent(String.self, forKey: .logoUrl)
        logoState = EntityLogoState(rawURL: logoUrl, hasRawValue: values.contains(.logoUrl))
        resolvedLogoUrl = try values.decodeIfPresent(String.self, forKey: .resolvedLogoUrl)
        institutionLogoUrl = try values.decodeIfPresent(String.self, forKey: .institutionLogoUrl)
        visualIdentityMode = try values.decodeIfPresent(String.self, forKey: .visualIdentityMode)
        iconName = try values.decodeIfPresent(String.self, forKey: .iconName)
        iconColorId = try values.decodeIfPresent(String.self, forKey: .iconColorId)
        closedAt = try values.decodeIfPresent(String.self, forKey: .closedAt)
        lastReconciledAt = try values.decodeIfPresent(String.self, forKey: .lastReconciledAt)
        firstBalanceYearMonth = try values.decodeIfPresent(
            String.self, forKey: .firstBalanceYearMonth)
        let linked = try values.decodeIfPresent(LinkedAccount.self, forKey: .bankLinkAccount)
        let wallet = try values.decodeIfPresent(WalletAccount.self, forKey: .financeKitAccount)
        institutionPrimaryColor = linked?.bankLink?.institution?.primaryColor
        institutionName = linked?.bankLink?.institution?.name ?? wallet?.institutionName
        accountNumberMask = linked?.accountNumberMask
        isLinked =
            try values.decodeIfPresent(String.self, forKey: .bankLinkAccountId) != nil
            || values.decodeIfPresent(String.self, forKey: .financeKitAccountId) != nil
    }
}

struct AccountDraft: Equatable {
    var name = ""
    var accountType = "banking_checking"
    var initialBalance: Int64 = 0
    var initialBalanceDate = ""
    var notes = ""
    var logoUrl = ""
    var logoChoice: EntityLogoChoice = .unchanged

    mutating func acceptSavedLogo(from account: AccountSnapshot) {
        logoUrl = account.logoUrl ?? account.resolvedLogoUrl ?? ""
        logoChoice = .unchanged
    }

    init(
        name: String = "", accountType: String = "banking_checking", initialBalance: Int64 = 0,
        initialBalanceDate: String = "", notes: String = "", logoUrl: String = ""
    ) {
        self.name = name
        self.accountType = accountType
        self.initialBalance = initialBalance
        self.initialBalanceDate = initialBalanceDate
        self.notes = notes
        self.logoUrl = logoUrl
    }

    init(account: AccountSnapshot) {
        name = account.name
        accountType = account.accountType
        notes = account.notes ?? ""
        logoUrl = account.logoUrl ?? account.resolvedLogoUrl ?? ""
    }
}

/// Describes the committed manual starting balance, never an estimated workspace total.
struct AccountLifecycleSummary {
    let accountID: String
    let name: String
    let wasLinked: Bool
}

struct AccountCreationSummary {
    let accountID: String
    let name: String
    let accountType: String
    let startingBalance: Int64

    // Mirrors createBankAccount's starting-balance reconciliation: only banking affects RTA.
    var readyToAssignDelta: Int64 {
        AccountCategory.from(accountType) == .banking ? startingBalance : 0
    }
}

struct AccountHistoryReport: Decodable {
    let months: [AccountHistoryMonth]
    let currentMonth: String
}

struct AccountHistoryMonth: Decodable {
    let yearMonth: String
    let accounts: [AccountHistoryBalance]
}

struct AccountHistoryBalance: Decodable {
    let accountId: String
    @ConvexInt var balance: Int64

    init(accountId: String, balance: Int64) {
        self.accountId = accountId
        _balance = ConvexInt(wrappedValue: balance)
    }
}

struct AccountBalancePoint: Identifiable, Equatable {
    let yearMonth: String
    let date: Date
    let balance: Decimal
    var id: String { yearMonth }
    var chartValue: Double { NSDecimalNumber(decimal: balance).doubleValue }

    func changeFromPreviousMonth(in points: [Self]) -> Decimal {
        let previous = points.filter { $0.yearMonth < yearMonth }
            .max { $0.yearMonth < $1.yearMonth }
        return balance - (previous?.balance ?? 0)
    }

    static func selected(in points: [Self], month: String?) -> Self? {
        points.first { $0.yearMonth == month }
    }

    func toggledSelection(from selectedMonth: String?) -> String? {
        selectedMonth == yearMonth ? nil : yearMonth
    }

    static func build(
        months: [AccountHistoryMonth], accountIDs: Set<String>,
        currentMonth: String? = nil, currentBalance: Decimal? = nil
    ) -> [Self] {
        guard !accountIDs.isEmpty else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return months.sorted { $0.yearMonth < $1.yearMonth }.compactMap { month in
            let parts = month.yearMonth.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 2, (1...12).contains(parts[1]),
                let date = calendar.date(
                    from: DateComponents(year: parts[0], month: parts[1], day: 1, hour: 12))
            else { return nil }
            let balance: Decimal
            if month.yearMonth == currentMonth, let currentBalance {
                // The open month must match the account rows, even when the separately
                // subscribed monthly transaction history differs or has not refreshed yet.
                balance = currentBalance
            } else {
                balance = month.accounts.filter { accountIDs.contains($0.accountId) }
                    .reduce(Decimal.zero) { $0 + Decimal($1.balance) }
            }
            return Self(yearMonth: month.yearMonth, date: date, balance: balance)
        }
    }
}

struct AccountBalanceChartLayout: Equatable {
    static let defaultMonthWidth = 36.0
    let monthCount: Int
    let monthWidth: Double
    let viewportWidth: Double
    let horizontalInset: Double = 24

    var chartWidth: Double { Double(monthCount) * monthWidth }
    var barWidth: Double { monthWidth * 0.65 }
    var contentWidth: Double { max(chartWidth, viewportWidth - horizontalInset * 2) }
    var scrollContentWidth: Double { contentWidth + horizontalInset * 2 }
    var trailingOffset: Double { max(0, scrollContentWidth - viewportWidth) }
    var initialChartMinX: Double { viewportWidth - horizontalInset - chartWidth }

    func scrollOffset(forMonthAt index: Int) -> Double {
        let center =
            horizontalInset + contentWidth - chartWidth + (Double(index) + 0.5) * monthWidth
        return min(max(0, center - viewportWidth / 2), trailingOffset)
    }
}

enum AccountBalanceChartScale {
    /// Bars need a zero baseline so their lengths represent the full balance.
    static func barDomain(
        balances: [Decimal], visibleIndices: Range<Int>, minorUnit: Int
    ) -> ClosedRange<Double> {
        let visibleDomain = domain(
            balances: balances, visibleIndices: visibleIndices, minorUnit: minorUnit)
        return min(0, visibleDomain.lowerBound)...max(0, visibleDomain.upperBound)
    }

    /// Month cells overlap the viewport, including partially visible months at either edge.
    static func visibleIndices(
        count: Int, monthWidth: Double, chartMinX: Double, viewportWidth: Double
    ) -> Range<Int> {
        guard count > 0, monthWidth > 0, viewportWidth > 0 else { return 0..<0 }
        let first = min(max(Int(floor(-chartMinX / monthWidth)), 0), count - 1)
        let end = min(max(Int(ceil((viewportWidth - chartMinX) / monthWidth)), first + 1), count)
        return first..<end
    }

    static func domain(
        balances: [Decimal], visibleIndices: Range<Int>, minorUnit: Int
    ) -> ClosedRange<Double> {
        let values = balances[visibleIndices.clamped(to: balances.indices)].map {
            NSDecimalNumber(decimal: $0).doubleValue / pow(10, Double(minorUnit))
        }
        guard let lower = values.min(), let upper = values.max() else { return 0...1 }
        // A small minimum span keeps flat histories and tiny changes from looking dramatic.
        let padding = max((upper - lower) * 0.12, max(abs(lower), abs(upper)) * 0.05, 1)
        let minimum = lower >= 0 ? max(0, lower - padding) : lower - padding
        let maximum = upper <= 0 ? min(0, upper + padding) : upper + padding
        return minimum == maximum ? -1...1 : minimum...maximum
    }
}

struct AccountMutationRequest {
    enum Operation {
        case create(AccountDraft)
        case update(AccountSnapshot, AccountDraft)
        case close(String)
        case reopen(String)
        case delete(String)
        case restore(String)
        case reorderGroups([String])
        case reorderAccounts([String: [String]])
    }

    let workspaceID: String
    let operation: Operation

    var mutationName: String {
        switch operation {
        case .create: "bankAccounts:createBankAccount"
        case .update: "bankAccounts:updateBankAccount"
        case .close: "bankAccounts:closeBankAccount"
        case .reopen: "bankAccounts:reopenBankAccount"
        case .delete: "bankAccounts:deleteBankAccount"
        case .restore: "bankAccounts:restoreBankAccount"
        case .reorderGroups: "workspaces:updateBankAccountGroupOrder"
        case .reorderAccounts: "workspaces:updateBankAccountOrderAllGroups"
        }
    }

    var arguments: [String: ConvexEncodable?] {
        var result: [String: ConvexEncodable?] = ["workspaceId": workspaceID]
        switch operation {
        case .create(let draft):
            result["name"] = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
            result["accountType"] = draft.accountType
            // A zero opening balance needs no synthetic transaction. This also
            // leaves a genuinely empty account eligible for deletion.
            if draft.initialBalance != 0 {
                result["initialBalance"] = draft.initialBalance
                result["initialBalanceDate"] = draft.initialBalanceDate
            }
        case .update(let original, let draft):
            result["bankAccountId"] = original.id
            let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if name != original.name { result["name"] = name }
            if draft.accountType != original.accountType {
                result["accountType"] = draft.accountType
            }
            if draft.notes != (original.notes ?? "") { result["notes"] = draft.notes }
            if let argument = draft.logoChoice.argument {
                result["logoUrl"] = argument
            } else if draft.logoUrl != AccountDraft(account: original).logoUrl {
                result["logoUrl"] = draft.logoUrl.isEmpty ? AccountNull() : draft.logoUrl
            }
        case .reorderGroups(let groups):
            result["groupOrder"] = groups.map { $0 as ConvexEncodable? }
        case .reorderAccounts(let accounts):
            result["accountOrderByGroup"] = accounts.mapValues { ids -> ConvexEncodable? in
                ids.map { $0 as ConvexEncodable? }
            }
        case .close(let id), .reopen(let id), .delete(let id), .restore(let id):
            result["bankAccountId"] = id
        }
        return result
    }
}

private struct AccountNull: ConvexEncodable {
    func convexEncode() throws -> String { "null" }
}

/// Adapts account identities to the existing grouped drag surface. Only the
/// account ordering mutations are emitted; account types never change here.
struct AccountOrdering: Decodable, Equatable {
    var groupOrder: [String] = AccountCategory.allCases.map(\.orderingKey)
    var accountOrderByGroup: [String: [String]] = [:]

    var categories: [AccountCategory] {
        var remaining = AccountCategory.allCases
        let saved = groupOrder.compactMap { key -> AccountCategory? in
            guard let index = remaining.firstIndex(where: { $0.orderingKey == key }) else {
                return nil
            }
            return remaining.remove(at: index)
        }
        return saved + remaining
    }

    func sections(accounts: [AccountSnapshot]) -> [AccountListSection] {
        categories.compactMap { category in
            var remaining = accounts.filter { $0.category == category && !$0.isDeleted }
            let saved = (accountOrderByGroup[category.orderingKey] ?? []).compactMap { id in
                guard let index = remaining.firstIndex(where: { $0.id == id }) else {
                    return nil as AccountSnapshot?
                }
                return remaining.remove(at: index)
            }
            let members = saved + remaining
            return members.isEmpty ? nil : .init(category: category, accounts: members)
        }
    }

    func reorderGroups(accounts: [AccountSnapshot]) -> [BudgetCategoryGroup] {
        sections(accounts: accounts.filter { !$0.isClosed }).map { section in
            .init(
                categoryGroup: .init(
                    _id: section.category.id, name: section.category.title, type: "account"),
                categories: section.accounts.map {
                    .init(_id: $0.id, name: $0.name, iconName: nil, type: "account")
                })
        }
    }

    func applying(_ move: BudgetPlanOrdering.Move, accounts: [AccountSnapshot]) -> Self? {
        let groups = reorderGroups(accounts: accounts)
        guard let change = move.change(in: groups) else { return nil }
        let updated = change.applying(to: groups)
        var result = self
        switch change {
        case .moveGroup:
            // Preserve the positions of groups containing only closed accounts.
            var visible = updated.map(\.id).makeIterator()
            let visibleIDs = Set(groups.map(\.id))
            result.groupOrder = categories.map { category in
                let id = visibleIDs.contains(category.id) ? visible.next() : category.id
                return AccountCategory(rawValue: id ?? category.id)?.orderingKey
                    ?? category.orderingKey
            }
        case .moveCategory(_, let source, let destination, _):
            guard source == destination else { return nil }
            // The API replaces the whole map. Include every other group and all
            // closed accounts, retaining their relative order.
            result.accountOrderByGroup = Dictionary(
                uniqueKeysWithValues:
                    sections(accounts: accounts).map { section in
                        let active =
                            updated.first { $0.id == section.category.id }?.categories.map(\.id)
                            ?? []
                        let closed = section.accounts.filter(\.isClosed).map(\.id)
                        return (section.category.orderingKey, active + closed)
                    })
        default: return nil
        }
        return result
    }

    /// Canonicalize membership for dirty checks and saves. New accounts are
    /// appended, removed accounts disappear, and closed accounts keep their order.
    func normalized(accounts: [AccountSnapshot]) -> Self {
        Self(
            groupOrder: categories.map(\.orderingKey),
            accountOrderByGroup: Dictionary(
                uniqueKeysWithValues:
                    sections(accounts: accounts).map { section in
                        let active = section.accounts.filter { !$0.isClosed }.map(\.id)
                        let closed = section.accounts.filter(\.isClosed).map(\.id)
                        return (section.category.orderingKey, active + closed)
                    }))
    }
}
