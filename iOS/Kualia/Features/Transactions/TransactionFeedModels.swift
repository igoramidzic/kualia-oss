import ConvexMobile
import Foundation

enum TransactionFeedPreferences {
    static let showsReconciledTransactionsKey = "transactions.showsReconciledTransactions"

    static func visibilityActionTitle(showsReconciledTransactions: Bool) -> String {
        showsReconciledTransactions
            ? L10n.string("Hide reconciled transactions")
            : L10n.string("Show reconciled transactions")
    }
}

enum TransactionFeedLoadingState {
    /// A refresh keeps the last snapshot visible. An initial failure must expose Retry.
    static func isLoading(
        feedLoaded: Bool, feedFailed: Bool, showsAgenda: Bool, hasWorkspace: Bool,
        agendaLoaded: Bool, agendaFailed: Bool
    ) -> Bool {
        if feedFailed || agendaFailed { return false }
        if !feedLoaded { return true }
        return showsAgenda && hasWorkspace && !agendaLoaded
    }
}

enum TransactionFeedItemType: String, Codable {
    case regular
    case startingBalance = "starting_balance"
    case balanceAdjustment = "balance_adjustment"
    case transfer
}

enum TransactionFeedStatus: String, Codable {
    case pending
    case cleared
    case reconciled

    var title: String {
        switch self {
        case .pending: L10n.string("Pending")
        case .cleared: L10n.string("Cleared")
        case .reconciled: L10n.string("Reconciled")
        }
    }
}

enum TransactionFeedReviewStatus: String, Codable {
    case reviewed
    case needsReview = "needs_review"
}

enum TransactionFeedFilter: String, CaseIterable, Identifiable {
    case all
    case needsReview = "needs_review"
    case inflow, outflow
    case transfers, pending
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: L10n.string("All")
        case .needsReview: L10n.string("Needs Review")
        case .inflow: L10n.string("Inflow")
        case .outflow: L10n.string("Outflow")
        case .transfers: L10n.string("Transfers")
        case .pending: L10n.string("Pending")
        }
    }

    var searchFlow: TransactionSearchFlow? {
        switch self {
        case .inflow: .inflow
        case .outflow: .outflow
        default: nil
        }
    }

    func matchesFlow(of item: TransactionFeedItem) -> Bool {
        switch self {
        case .inflow: item.type != .transfer && item.amount > 0
        case .outflow: item.type != .transfer && item.amount < 0
        default: true
        }
    }
}

struct TransactionFeedFilterCounts: Decodable, Equatable {
    var needsReview: Int = 0
    var transfers: Int = 0
    var pending: Int = 0

    func count(for filter: TransactionFeedFilter) -> Int? {
        switch filter {
        case .all, .inflow, .outflow: nil
        case .needsReview: needsReview
        case .transfers: transfers
        case .pending: pending
        }
    }
}

struct TransactionFeedWorkspace: Decodable, Equatable {
    let id: String
    let name: String
    let currencyCode: String
    let minorUnit: Int
    let timezoneIdentifier: String?
}

struct TransactionFeedItem: Decodable, Identifiable, Equatable {
    let id: String
    let transferGroupId: String?
    let scheduledTransactionId: String?
    let date: String
    let type: TransactionFeedItemType
    var status: TransactionFeedStatus
    let reviewStatus: TransactionFeedReviewStatus
    @ConvexInt var amount: Int64
    let notes: String?
    let merchantName: String?
    let merchantLogoUrl: String?
    let merchantVisualIdentityMode: String?
    let merchantIconName: String?
    let merchantIconColorId: String?
    let bankAccountName: String?
    let bankAccountType: String?
    let bankAccountLogoUrl: String?
    let transferPairAccountName: String?
    let transferPairAccountType: String?
    let transferPairAccountLogoUrl: String?
    let isCreditCardPayment: Bool?
    let categoryNames: [String]
    let hasUncategorized: Bool
    let hasMissingPayee: Bool
    let deletionBudgetChanges: [TransactionBudgetChange]?
    var categoryActivity: BudgetCategoryActivity? = nil
    var suggestedTransfer: TransactionEditorTransferSuggestion? = nil

    init(
        id: String,
        transferGroupId: String? = nil,
        scheduledTransactionId: String? = nil,
        date: String,
        type: TransactionFeedItemType,
        status: TransactionFeedStatus = .cleared,
        reviewStatus: TransactionFeedReviewStatus = .reviewed,
        amount: Int64,
        notes: String? = nil,
        merchantName: String? = nil,
        merchantLogoUrl: String? = nil,
        merchantVisualIdentityMode: String? = nil,
        merchantIconName: String? = nil,
        merchantIconColorId: String? = nil,
        bankAccountName: String? = nil,
        bankAccountType: String? = nil,
        bankAccountLogoUrl: String? = nil,
        transferPairAccountName: String? = nil,
        transferPairAccountType: String? = nil,
        transferPairAccountLogoUrl: String? = nil,
        isCreditCardPayment: Bool? = nil,
        categoryNames: [String] = [],
        hasUncategorized: Bool = false,
        hasMissingPayee: Bool = false,
        deletionBudgetChanges: [TransactionBudgetChange]? = nil
    ) {
        self.id = id
        self.transferGroupId = transferGroupId
        self.scheduledTransactionId = scheduledTransactionId
        self.date = date
        self.type = type
        self.status = status
        self.reviewStatus = reviewStatus
        self._amount = ConvexInt(wrappedValue: amount)
        self.notes = notes
        self.merchantName = merchantName
        self.merchantLogoUrl = merchantLogoUrl
        self.merchantVisualIdentityMode = merchantVisualIdentityMode
        self.merchantIconName = merchantIconName
        self.merchantIconColorId = merchantIconColorId
        self.bankAccountName = bankAccountName
        self.bankAccountType = bankAccountType
        self.bankAccountLogoUrl = bankAccountLogoUrl
        self.transferPairAccountName = transferPairAccountName
        self.transferPairAccountType = transferPairAccountType
        self.transferPairAccountLogoUrl = transferPairAccountLogoUrl
        self.isCreditCardPayment = isCreditCardPayment
        self.categoryNames = categoryNames
        self.hasUncategorized = hasUncategorized
        self.hasMissingPayee = hasMissingPayee
        self.deletionBudgetChanges = deletionBudgetChanges
    }
}

enum TransactionFeedPageStatus: String, Decodable {
    case splitRecommended = "SplitRecommended"
    case splitRequired = "SplitRequired"
}

struct TransactionFeedPage: Decodable {
    let page: [TransactionFeedItem]
    let continueCursor: String
    let isDone: Bool
    let splitCursor: String?
    let pageStatus: TransactionFeedPageStatus?

    init(
        page: [TransactionFeedItem],
        continueCursor: String,
        isDone: Bool,
        splitCursor: String? = nil,
        pageStatus: TransactionFeedPageStatus? = nil
    ) {
        self.page = page
        self.continueCursor = continueCursor
        self.isDone = isDone
        self.splitCursor = splitCursor
        self.pageStatus = pageStatus
    }
}

struct TransactionFeedFilterTransactions: Decodable, Equatable {
    var needsReview: [TransactionFeedItem] = []
    var transfers: [TransactionFeedItem] = []
    var pending: [TransactionFeedItem] = []

    func items(for filter: TransactionFeedFilter) -> [TransactionFeedItem] {
        switch filter {
        case .all, .inflow, .outflow: []
        case .needsReview: needsReview
        case .transfers: transfers
        case .pending: pending
        }
    }
}

struct TransactionFeedResponse: Decodable {
    let workspace: TransactionFeedWorkspace?
    let transactions: TransactionFeedPage
    var filterCounts: TransactionFeedFilterCounts? = nil
    var filterSetsComplete: Bool? = nil
    var filterTransactions: TransactionFeedFilterTransactions? = nil
}

struct TransactionFeedEntry: Identifiable, Equatable {
    let id: String
    let transferGroupId: String?
    let scheduledTransactionId: String?
    let date: String
    let type: TransactionFeedItemType
    let status: TransactionFeedStatus
    let reviewStatus: TransactionFeedReviewStatus
    let amount: Int64
    let notes: String?
    let merchantName: String?
    let merchantLogoUrl: String?
    let merchantVisualIdentityMode: String?
    let merchantIconName: String?
    let merchantIconColorId: String?
    let bankAccountName: String?
    let bankAccountType: String?
    let bankAccountLogoUrl: String?
    let transferPairAccountName: String?
    let transferPairAccountType: String?
    let transferPairAccountLogoUrl: String?
    let isCreditCardPayment: Bool
    let categoryNames: [String]
    let hasUncategorized: Bool
    let hasMissingPayee: Bool
    let suggestedTransfer: TransactionEditorTransferSuggestion?

    init(item: TransactionFeedItem) {
        self.id = item.id
        self.transferGroupId = item.type == .transfer ? item.transferGroupId : nil
        self.scheduledTransactionId = item.scheduledTransactionId
        self.date = item.date
        self.type = item.type
        self.status = item.status
        self.reviewStatus = item.reviewStatus
        self.amount = item.amount
        let notes = item.notes?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.notes = notes?.isEmpty == false ? notes : nil
        self.merchantName = item.merchantName
        self.merchantLogoUrl = item.merchantLogoUrl
        self.merchantVisualIdentityMode = item.merchantVisualIdentityMode
        self.merchantIconName = item.merchantIconName
        self.merchantIconColorId = item.merchantIconColorId
        self.bankAccountName = item.bankAccountName
        self.bankAccountType = item.bankAccountType
        self.bankAccountLogoUrl = item.bankAccountLogoUrl
        self.transferPairAccountName = item.transferPairAccountName
        self.transferPairAccountType = item.transferPairAccountType
        self.transferPairAccountLogoUrl = item.transferPairAccountLogoUrl
        self.isCreditCardPayment = item.type == .transfer && item.isCreditCardPayment == true
        self.categoryNames = item.categoryNames
        self.hasUncategorized = item.hasUncategorized
        self.hasMissingPayee = item.hasMissingPayee
        self.suggestedTransfer = item.suggestedTransfer

    }

    var transactionIDs: [String] { [id] }

    var deletionGroupID: String { transferGroupId ?? id }

    var title: String {
        switch type {
        case .regular:
            let trimmedName = merchantName?.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmedName?.isEmpty == false
                ? trimmedName ?? L10n.string("Merchant needed")
                : (hasTransferSuggestion
                    ? L10n.string("Suggested transfer") : L10n.string("Merchant needed"))
        case .startingBalance:
            return L10n.string("Starting balance")
        case .balanceAdjustment:
            return L10n.string("Balance adjustment")
        case .transfer:
            guard amount != 0, let account = transferPairAccountName, !account.isEmpty else {
                return L10n.string("Transfer")
            }
            return "\(amount < 0 ? L10n.string("To") : L10n.string("From")) \(account)"
        }
    }

    var categoryLabels: [String] {
        let uniqueNames = Self.unique(categoryNames)
        if type == .transfer, uniqueNames.isEmpty, !hasUncategorized { return [] }
        guard !uniqueNames.isEmpty else {
            return [hasUncategorized ? L10n.string("Uncategorized") : fallbackCategoryLabel]
        }
        return hasUncategorized
            ? Self.unique(uniqueNames + [L10n.string("Uncategorized")]) : uniqueNames
    }

    var categorySummary: String {
        let names = categoryLabels
        let visibleNames = names.prefix(2).joined(separator: ", ")
        let remainingCount = names.count - 2
        return remainingCount > 0 ? "\(visibleNames) +\(remainingCount)" : visibleNames
    }

    var accountSummary: String? { bankAccountName }

    var bankAccountIcon: KualiaIcon {
        bankAccountType?.hasPrefix("credit_") == true ? .accounts : .bank
    }

    var transferAccountIcon: KualiaIcon {
        transferPairAccountType?.hasPrefix("credit_") == true ? .accounts : .bank
    }

    var displayLogoUrl: String? {
        if type == .transfer { return transferPairAccountLogoUrl }
        return type == .regular && merchantVisualIdentityMode != "icon" ? merchantLogoUrl : nil
    }

    var needsAttention: Bool {
        reviewStatus == .needsReview || hasUncategorized || hasMissingPayee
    }

    var hasTransferSuggestion: Bool {
        reviewStatus == .needsReview && suggestedTransfer?.isActionable == true
    }

    var opensEditorForApproval: Bool {
        hasTransferSuggestion && suggestedTransfer?.reliableAccountID == nil
    }

    var suggestedAccountLabel: String? {
        guard hasTransferSuggestion else { return nil }
        guard let account = suggestedTransfer?.counterpartAccountName else {
            return L10n.string("Choose the other account")
        }
        return "\(amount < 0 ? L10n.string("To") : L10n.string("From")) \(account)"
    }

    var swipeAction: TransactionFeedAction? {
        if hasTransferSuggestion { return .approve }
        if hasUncategorized { return .categorize }
        if reviewStatus == .needsReview { return .approve }
        switch status {
        case .pending: return .setStatus(.cleared)
        case .cleared: return .setStatus(.pending)
        case .reconciled: return nil
        }
    }

    var fallbackIcon: KualiaIcon {
        if hasTransferSuggestion { return .transfer }
        switch type {
        case .regular:
            return hasMissingPayee ? .question : .shop
        case .startingBalance:
            return .money
        case .balanceAdjustment:
            return .preferences
        case .transfer:
            return .transfer
        }
    }

    private var fallbackCategoryLabel: String {
        switch type {
        case .transfer:
            return L10n.string("Uncategorized")
        case .startingBalance:
            return L10n.string("Opening balance")
        case .balanceAdjustment:
            return L10n.string("Balance correction")
        case .regular:
            return L10n.string("Uncategorized")
        }
    }

    private static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, seen.insert(trimmed).inserted else {
                return nil
            }
            return trimmed
        }
    }
}

struct TransactionFeedSection: Identifiable, Equatable {
    let id: String
    var entries: [TransactionFeedEntry]
}

enum TransactionFeedPresentation {
    static func entries(from items: [TransactionFeedItem]) -> [TransactionFeedEntry] {
        var seen = Set<String>()
        return items.compactMap { item in
            guard seen.insert(item.id).inserted else { return nil }
            return TransactionFeedEntry(item: item)
        }
    }

    static func sections(from items: [TransactionFeedItem]) -> [TransactionFeedSection] {
        var sections: [TransactionFeedSection] = []
        var sectionIndexByDate: [String: Int] = [:]
        for entry in entries(from: items) {
            if let index = sectionIndexByDate[entry.date] {
                sections[index].entries.append(entry)
            } else {
                sectionIndexByDate[entry.date] = sections.count
                sections.append(TransactionFeedSection(id: entry.date, entries: [entry]))
            }
        }

        for index in sections.indices {
            sections[index].entries = adjacentTransfers(in: sections[index].entries)
        }
        return sections
    }

    private static func adjacentTransfers(in entries: [TransactionFeedEntry])
        -> [TransactionFeedEntry]
    {
        let pairs = Dictionary(
            grouping: entries.filter { $0.transferGroupId != nil }, by: \.deletionGroupID)
        var emittedGroups = Set<String>()
        return entries.flatMap { entry -> [TransactionFeedEntry] in
            guard let groupID = entry.transferGroupId else { return [entry] }
            guard emittedGroups.insert(groupID).inserted else { return [] }
            // Keep the pair at its first position in this day, with the outflow first.
            return (pairs[groupID] ?? [entry]).sorted { $0.amount < $1.amount }
        }
    }
}

enum TransactionDateLabel {
    static func title(
        for dateKey: String,
        relativeTo referenceDate: Date = Date(),
        timezoneIdentifier: String?,
        locale: Locale = L10n.locale
    ) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current

        guard let date = date(from: dateKey, calendar: calendar) else {
            return dateKey
        }

        if calendar.isDate(date, inSameDayAs: referenceDate) {
            return L10n.string("Today")
        }

        let includesYear =
            calendar.component(.year, from: date)
            != calendar.component(
                .year,
                from: referenceDate
            )
        if !includesYear,
            let yesterday = calendar.date(byAdding: .day, value: -1, to: referenceDate),
            calendar.isDate(date, inSameDayAs: yesterday)
        {
            return L10n.string("Yesterday")
        }

        // Foundation caches identical format styles. A newly visible date
        // header should not construct and configure its own DateFormatter.
        let style = Date.FormatStyle(
            date: .omitted, time: .omitted, locale: locale, calendar: locale.calendar,
            timeZone: calendar.timeZone
        ).weekday(.abbreviated).month(.abbreviated).day()
        return date.formatted(includesYear ? style.year() : style)
    }

    private static func date(from value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-")
        guard parts.count == 3,
            let year = Int(parts[0]),
            let month = Int(parts[1]),
            let day = Int(parts[2])
        else {
            return nil
        }

        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }
}

typealias TransactionAmountFormatter = MoneyAmountFormatter

enum TransactionFeedAction: Equatable {
    case delete
    case restore
    case approve
    case categorize
    case setStatus(TransactionFeedStatus)

    var title: String {
        switch self {
        case .delete: L10n.string("Delete")
        case .restore: L10n.string("Undo")
        case .categorize: L10n.string("Categorize")
        case .approve: L10n.string("Approve")
        case .setStatus(.pending): L10n.string("Mark pending")
        case .setStatus: L10n.string("Mark cleared")
        }
    }

    var icon: KualiaIcon {
        switch self {
        case .delete: .trash
        case .restore: .undo
        case .categorize: .category
        case .approve: .badgeCheck
        case .setStatus(.pending): .clock
        case .setStatus: .checkCircle
        }
    }

    var mutationName: String? {
        switch self {
        case .delete: "transactions:deleteTransactions"
        case .restore: "transactions:restoreTransactions"
        case .categorize: nil
        case .approve: "transactions:approveTransactions"
        case .setStatus: "transactions:updateTransactionsStatus"
        }
    }

    var failureMessage: String {
        switch self {
        case .delete: L10n.string("Couldn't delete this transaction. Please try again.")
        case .restore: L10n.string("Couldn't restore this transaction. Please try again.")
        case .categorize: L10n.string("Couldn't categorize this transaction. Please try again.")
        case .approve: L10n.string("Couldn't approve this transaction. Please try again.")
        case .setStatus: L10n.string("Couldn't change this transaction's status. Please try again.")
        }
    }
}

/// Selection totals stay in decimal minor units so a large selection cannot overflow Int64.
struct TransactionSelectionSummary {
    let entries: [TransactionFeedEntry]

    var count: Int { entries.count }
    var total: Decimal { entries.reduce(Decimal.zero) { $0 + Decimal($1.amount) } }
    var approvalAction: TransactionFeedAction? {
        entries.contains { $0.reviewStatus == .needsReview } ? .approve : nil
    }
    var statusAction: TransactionFeedAction? {
        let editable = entries.filter { $0.status != .reconciled }
        guard !editable.isEmpty else { return nil }
        return .setStatus(editable.allSatisfy { $0.status == .cleared } ? .pending : .cleared)
    }
    var canEditMerchant: Bool { !entries.isEmpty && entries.allSatisfy { $0.type == .regular } }
    var canEditAccount: Bool {
        // Moving both sides to one account would collapse a transfer into itself.
        let transfers = entries.compactMap(\.transferGroupId)
        return !entries.isEmpty && Set(transfers).count == transfers.count
    }
}

enum TransactionSelectionField: String, Identifiable, CaseIterable {
    case category, account, merchant, notes

    var id: String { rawValue }
    var title: String {
        switch self {
        case .category: L10n.string("Change category")
        case .account: L10n.string("Change account")
        case .merchant: L10n.string("Change merchant")
        case .notes: L10n.string("Change notes")
        }
    }
    var icon: KualiaIcon {
        switch self {
        case .category: .category
        case .account: .bank
        case .merchant: .shop
        case .notes: .note
        }
    }
}

struct TransactionSelectionEdit: Equatable {
    let field: TransactionSelectionField
    let value: String

    func arguments(workspaceID: String, transactionIDs: [String]) -> [String: ConvexEncodable?] {
        var arguments: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID,
            "transactionIds": transactionIDs.map { $0 as ConvexEncodable? },
        ]
        switch field {
        case .category:
            if value != "none" && value != "rta" { arguments["categoryId"] = value }
            arguments["readyToAssign"] = value == "rta"
        case .account: arguments["bankAccountId"] = value
        case .merchant: arguments["merchantId"] = value
        case .notes: arguments["notes"] = value.isEmpty ? TransactionEditorNull() : value
        }
        return arguments
    }
}
