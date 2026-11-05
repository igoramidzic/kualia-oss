import ConvexMobile
import Foundation

enum TransactionEditorFlow: String, CaseIterable, Identifiable {
    case outflow, inflow, transfer

    var id: String { rawValue }
    var title: String {
        switch self {
        case .outflow: L10n.string("Outflow")
        case .inflow: L10n.string("Inflow")
        case .transfer: L10n.string("Transfer")
        }
    }
}

enum TransactionEditorRecurrence: String, Codable, CaseIterable, Identifiable {
    case once, daily, weekly
    case everyOtherWeek = "every_other_week"
    case everyThreeWeeks = "every_three_weeks"
    case everyFourWeeks = "every_four_weeks"
    case twiceAMonth = "twice_a_month"
    case monthly
    case everyOtherMonth = "every_other_month"
    case quarterly
    case everyFourMonths = "every_four_months"
    case twiceAYear = "twice_a_year"
    case yearly
    case everyOtherYear = "every_other_year"

    var calendarIcon: KualiaIcon { self == .once ? .calendarFilled : .calendarRepeating }

    var id: String { rawValue }
    var title: String {
        switch self {
        case .once: L10n.string("Does not repeat")
        case .daily: L10n.string("Daily")
        case .weekly: L10n.string("Weekly")
        case .everyOtherWeek: L10n.string("Every other week")
        case .everyThreeWeeks: L10n.string("Every 3 weeks")
        case .everyFourWeeks: L10n.string("Every 4 weeks")
        case .twiceAMonth: L10n.string("Twice a month")
        case .monthly: L10n.string("Monthly")
        case .everyOtherMonth: L10n.string("Every other month")
        case .quarterly: L10n.string("Quarterly")
        case .everyFourMonths: L10n.string("Every 4 months")
        case .twiceAYear: L10n.string("Twice a year")
        case .yearly: L10n.string("Yearly")
        case .everyOtherYear: L10n.string("Every other year")
        }
    }
}

enum TransactionEditorEntryMode: String, Codable, CaseIterable, Identifiable {
    case automatic = "auto"
    case manual

    var id: String { rawValue }
    var title: String {
        self == .automatic ? L10n.string("Enter automatically") : L10n.string("Enter manually")
    }
}

struct TransactionEditorAllocation: Identifiable, Equatable {
    var id: String = UUID().uuidString
    /// Signed minor units retain refunds and adjustments inside an existing split.
    var amount: Int64
    var categoryID: String?
    var readyToAssign: Bool = false
    var notes: String = ""

    mutating func setSplitAmount(_ magnitude: Int64, transactionAmount: Int64) {
        guard magnitude >= 0 else { return }
        let isInflow = amount == 0 ? transactionAmount > 0 : amount > 0
        amount = isInflow ? magnitude : -magnitude
    }
}

/// Category selection is a local draft until the split amounts are applied.
struct TransactionSplitCategorySelection {
    private(set) var selectedIDs: Set<String>

    init(allocations: [TransactionEditorAllocation], includesUncategorized: Bool = true) {
        selectedIDs = Set(
            allocations.compactMap { allocation in
                if allocation.readyToAssign { return "rta" }
                if let id = allocation.categoryID { return id }
                return includesUncategorized ? "none" : nil
            })
    }

    var canContinue: Bool { selectedIDs.count >= 2 }

    mutating func toggle(_ id: String) {
        if !selectedIDs.insert(id).inserted { selectedIDs.remove(id) }
    }

    func allocations(
        from original: [TransactionEditorAllocation], orderedIDs: [String], total: Int64,
        startAtZero: Bool = false
    )
        -> [TransactionEditorAllocation]
    {
        var result = original.filter { selectedIDs.contains(Self.key(for: $0)) }
        var included = Set(result.map(Self.key))
        for id in orderedIDs where selectedIDs.contains(id) && included.insert(id).inserted {
            result.append(
                TransactionEditorAllocation(
                    amount: result.isEmpty ? total : 0,
                    categoryID: id == "none" || id == "rta" ? nil : id,
                    readyToAssign: id == "rta"))
        }
        if startAtZero {
            for index in result.indices { result[index].amount = 0 }
        }
        return result
    }

    static func key(for allocation: TransactionEditorAllocation) -> String {
        allocation.readyToAssign ? "rta" : allocation.categoryID ?? "none"
    }
}

struct TransactionSplitFunding {
    let target: Int64
    let allocations: [TransactionEditorAllocation]

    var total: Int64? { sum(allocations) }

    var remaining: Int64? {
        guard let total else { return nil }
        return subtract(total, from: target)
    }

    /// Expenses show a positive amount left to allocate, and a negative excess.
    var displayRemaining: Int64? {
        guard let remaining else { return nil }
        if target >= 0 { return remaining }
        return subtract(remaining, from: 0)
    }

    func amountFillingRemaining(for id: String) -> Int64? {
        guard allocations.contains(where: { $0.id == id }),
            let otherTotal = sum(allocations.filter { $0.id != id }),
            let amount = subtract(otherTotal, from: target), amount != Int64.min
        else { return nil }
        return amount
    }

    private func sum(_ allocations: [TransactionEditorAllocation]) -> Int64? {
        var total: Int64 = 0
        for allocation in allocations {
            let result = total.addingReportingOverflow(allocation.amount)
            guard !result.overflow else { return nil }
            total = result.partialValue
        }
        return total
    }

    private func subtract(_ amount: Int64, from total: Int64) -> Int64? {
        let result = total.subtractingReportingOverflow(amount)
        return result.overflow ? nil : result.partialValue
    }
}

/// Shared form state for transaction creation and editing.
struct TransactionEditorDraft: Equatable {
    var flow: TransactionEditorFlow
    var amount: Int64
    var merchantID: String?
    var accountID: String
    /// The other account, relative to the transaction side opened from the feed.
    var transferAccountID: String?
    var dateKey: String
    var status: TransactionFeedStatus
    var reviewStatus: TransactionFeedReviewStatus
    var notes: String
    var allocations: [TransactionEditorAllocation]
    var scheduledTransactionID: String? {
        didSet {
            if scheduledTransactionID != oldValue { scheduledOccurrenceDate = nil }
        }
    }
    var scheduledOccurrenceDate: String?
    var recurrence: TransactionEditorRecurrence = .once
    var entryMode: TransactionEditorEntryMode = .manual
    var wantsToSchedule = false
    var useOriginalStatement = false
    var pendingMerchantName: String?
    var acknowledgesTransferSuggestionRejection = false
    /// Editing an incoming transfer must retain the incoming side's sign.
    var transferIsInflow: Bool = false
    /// Account direction remains independent from transfer mode.
    var createsTransfer = false

    var isTransfer: Bool { flow == .transfer || createsTransfer }
    var isIncomingTransfer: Bool { flow == .transfer ? transferIsInflow : flow == .inflow }

    mutating func setCreatesTransfer(_ enabled: Bool) {
        if flow == .transfer { flow = transferIsInflow ? .inflow : .outflow }
        createsTransfer = enabled
        // A transfer has one budget allocation, attached to its on-budget side.
        if enabled && allocations.count > 1 {
            allocations = [TransactionEditorAllocation(amount: signedAmount)]
        }
    }

    var signedAmount: Int64 {
        flow == .inflow || (flow == .transfer && transferIsInflow) ? amount : -amount
    }

    var allocatedAmount: Int64? {
        var sum: Int64 = 0
        for allocation in allocations {
            let next = sum.addingReportingOverflow(allocation.amount)
            guard !next.overflow else { return nil }
            sum = next.partialValue
        }
        return sum
    }

    /// Valid keypad edits immediately become part of the transaction draft.
    /// Pending operators and errors retain the last valid field value.
    mutating func setAmount(from calculator: AmountCalculator) {
        guard let amount = calculator.amount else { return }
        setAmount(amount)
    }

    mutating func setAmount(_ magnitude: Int64) {
        guard magnitude >= 0 else { return }
        amount = magnitude
        if allocations.count == 1 { allocations[0].amount = signedAmount }
    }

    mutating func setFlow(_ newFlow: TransactionEditorFlow) {
        let wasPositive = signedAmount > 0
        flow = newFlow
        if (signedAmount > 0) != wasPositive {
            for index in allocations.indices where allocations[index].amount != Int64.min {
                allocations[index].amount = -allocations[index].amount
            }
        }
    }

    mutating func setCategory(_ id: String?, readyToAssign: Bool = false) {
        if allocations.isEmpty {
            allocations = [TransactionEditorAllocation(amount: signedAmount)]
        }
        guard allocations.count == 1 else { return }
        allocations[0].categoryID = readyToAssign ? nil : id
        allocations[0].readyToAssign = readyToAssign
    }

    init(workspace: TransactionFeedWorkspace, now: Date) {
        flow = .outflow
        amount = 0
        accountID = ""
        dateKey = TransactionEditorDate.today(workspace: workspace, now: now)
        status = .cleared
        reviewStatus = .reviewed
        notes = ""
        allocations = [TransactionEditorAllocation(amount: 0)]
    }

    init(detail: TransactionEditorDetail) throws {
        guard detail.totalAmount != Int64.min else { throw TransactionEditorError.amountOutOfRange }
        flow = detail.type == .transfer ? .transfer : detail.totalAmount < 0 ? .outflow : .inflow
        amount = abs(detail.totalAmount)
        merchantID = detail.merchantId
        accountID = detail.bankAccountId
        transferAccountID = detail.transferPairBankAccountId
        dateKey = detail.date
        status = detail.status
        reviewStatus = detail.reviewStatus
        notes = detail.notes ?? ""
        allocations = detail.movements.enumerated().map { index, movement in
            TransactionEditorAllocation(
                id: "movement-\(index)", amount: movement.amount,
                categoryID: movement.categoryId, readyToAssign: movement.readyToAssign,
                notes: movement.notes ?? ""
            )
        }
        scheduledTransactionID = detail.scheduledTransactionId
        scheduledOccurrenceDate = detail.scheduledOccurrenceDate
        transferIsInflow = detail.totalAmount > 0
    }
}

struct TransactionEditorMerchant: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    var logoUrl: String?
    var isDeleted: Bool?
    var suggestedCategoryIds: [String]?
    var suggestedBankAccountId: String?

    var pickerGroup: String {
        let normalized = name.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.diacriticInsensitive, .widthInsensitive], locale: .current)
            .uppercased()
        guard let first = normalized.first else { return L10n.string("Other") }
        if first.isNumber { return "0–9" }
        return first.isLetter ? String(first) : L10n.string("Other")
    }

    static func pickerChoices(_ merchants: [Self]) -> [TransactionEditorChoice] {
        // Normalization and localization belong outside the sort comparator.
        // A large merchant list otherwise repeats this work thousands of times.
        let other = L10n.string("Other")
        return merchants.map { (merchant: $0, group: $0.pickerGroup) }.sorted { lhs, rhs in
            let left = lhs.group
            let right = rhs.group
            if left != right {
                if left == "0–9" { return true }
                if right == "0–9" { return false }
                if left == other { return false }
                if right == other { return true }
                return left.localizedStandardCompare(right) == .orderedAscending
            }
            let comparison = lhs.merchant.name.localizedStandardCompare(rhs.merchant.name)
            return comparison == .orderedSame
                ? lhs.merchant.id < rhs.merchant.id : comparison == .orderedAscending
        }.map {
            TransactionEditorChoice(
                id: $0.merchant.id, title: $0.merchant.name, symbol: .shop,
                groupID: "merchant-\($0.group)", groupTitle: $0.group,
                logoURL: $0.merchant.logoUrl.flatMap { URL(string: $0) }, circularIcon: true)
        }
    }

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, logoUrl, isDeleted, suggestedCategoryIds, suggestedBankAccountId
    }
}

struct TransactionEditorCategory: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    var groupName: String?
    var categoryGroupId: String?
    var categoryType: String?
    var type: String?
    var isDeleted: Bool?
    var isArchived: Bool?

    var isSelectable: Bool {
        isDeleted != true && isArchived != true && categoryType != "credit_card"
            && categoryType != "credit_card_payment" && type != "credit_card"
            && type != "credit_card_payment"
    }

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, groupName, categoryGroupId, categoryType, type, isDeleted, isArchived
    }
}

struct TransactionEditorCategoryHierarchy: Decodable {
    struct Group: Decodable {
        let _id: String
        let name: String
    }
    let group: Group
    let categories: [TransactionEditorCategory]

    var selectableCategories: [TransactionEditorCategory] {
        categories.filter(\.isSelectable).map { category in
            var category = category
            category.categoryGroupId = group._id
            category.groupName = group.name
            return category
        }
    }
}

struct TransactionEditorAccount: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let accountType: String
    var isDeleted: Bool?
    var isClosed: Bool?

    var resolvedLogoUrl: String?

    var pickerGroup: String {
        switch accountType.split(separator: "_").first {
        case "banking": L10n.string("Banking")
        case "credit": L10n.string("Credit")
        case "loan": L10n.string("Loans")
        case "investment": L10n.string("Investments")
        default: L10n.string("Other accounts")
        }
    }

    var pickerChoice: TransactionEditorChoice {
        TransactionEditorChoice(
            id: id, title: name,
            symbol: accountType.hasPrefix("credit_") ? .creditCard : .bank,
            groupID: pickerGroup, groupTitle: pickerGroup,
            logoURL: resolvedLogoUrl.flatMap { URL(string: $0) }, circularIcon: true
        )
    }

    var isOnBudget: Bool { accountType.hasPrefix("banking_") || accountType.hasPrefix("credit_") }

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, accountType, isDeleted, isClosed, resolvedLogoUrl
    }
}

struct TransactionEditorPlannedTransaction: Decodable, Identifiable, Equatable {
    let id: String
    let nextDate: String
    let bankAccountId: String
    var merchantName: String?
    var transferToAccountName: String?
    var transferToAccountId: String?
    var transactionType: String?
    var recurrence: TransactionEditorRecurrence? = nil
    var merchantId: String?
    var movements: [PlannedSchedule.Movement]?
    var notes: String?
    var status: String?
    var entryMode: TransactionEditorEntryMode?

    var isTransfer: Bool { transactionType == "transfer" }
    var isLinkable: Bool { status == nil || status == "active" }
    var amount: Decimal? {
        guard let movements, !movements.isEmpty else { return nil }
        return movements.reduce(0) { $0 + Decimal($1.amount) }
    }
    var name: String {
        if isTransfer {
            return L10n.string(
                "Transfer to \(transferToAccountName ?? L10n.string("another account"))")
        }
        return merchantName ?? movements?.first?.categoryName
            ?? (movements?.first?.readyToAssign == true ? L10n.string("Ready to Assign") : nil)
            ?? notes?.nonEmptyPlannedText ?? L10n.string("Planned transaction")
    }

    func matches(_ draft: TransactionEditorDraft) -> Bool {
        guard (transactionType == "transfer") == draft.isTransfer else { return false }
        if draft.isTransfer {
            let fromID = draft.isIncomingTransfer ? draft.transferAccountID : draft.accountID
            let toID = draft.isIncomingTransfer ? draft.accountID : draft.transferAccountID
            return bankAccountId == fromID && transferToAccountId == toID
        }
        guard bankAccountId == draft.accountID else { return false }
        if let amount, amount != 0 {
            return (amount > 0) == (draft.flow == .inflow)
        }
        return true
    }

    func isSuggested(for draft: TransactionEditorDraft) -> Bool {
        guard isLinkable, matches(draft) else { return false }
        // Match the planned-link suggestions in the web and legacy iOS pickers.
        if let merchantID = draft.merchantID, merchantId == merchantID { return true }
        guard let amount else { return false }
        // Sum splits and compare in Decimal so even extreme minor-unit values
        // cannot overflow when taking magnitudes or calculating the difference.
        let expected = abs(amount)
        let actual = abs(Decimal(draft.amount))
        guard expected > 0, actual > 0 else { return false }
        return abs(actual - expected) <= expected / 10
    }

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case nextDate, bankAccountId, merchantName, transferToAccountName, transferToAccountId,
            transactionType,
            recurrence, merchantId, movements, notes, status, entryMode
    }
}

extension String {
    fileprivate var nonEmptyPlannedText: String? {
        let text = trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }
}

/// One presentation for both the planned picker and the selected link in the editor.
struct TransactionPlannedLinkDetails {
    let plan: TransactionEditorPlannedTransaction
    let choices: TransactionEditorChoices
    let workspace: TransactionFeedWorkspace
    var occurrenceDate: String? = nil

    var name: String {
        if plan.isTransfer {
            return L10n.string("Transfer to \(destinationName)")
        }
        return merchant?.name ?? plan.merchantName
            ?? plan.movements?.first.flatMap { categoryName($0) }
            ?? plan.name
    }
    private var merchant: TransactionEditorMerchant? {
        choices.merchants.first { $0.id == plan.merchantId }
    }
    var logoURL: URL? { merchant?.logoUrl.flatMap(URL.init(string:)) }
    private var destinationName: String {
        choices.accounts.first { $0.id == plan.transferToAccountId }?.name
            ?? plan.transferToAccountName ?? L10n.string("another account")
    }
    var accountName: String {
        choices.accounts.first { $0.id == plan.bankAccountId }?.name ?? L10n.string("Account")
    }
    var categorySummary: String? {
        guard let movements = plan.movements, !movements.isEmpty else { return nil }
        let names = movements.map { categoryName($0) ?? L10n.string("Uncategorized") }
        var unique: [String] = []
        for name in names where !unique.contains(name) { unique.append(name) }
        return unique.joined(separator: " · ")
    }
    private func categoryName(_ movement: PlannedSchedule.Movement) -> String? {
        if movement.readyToAssign == true { return L10n.string("Ready to Assign") }
        return choices.categories.first { $0.id == movement.categoryId }?.name
            ?? movement.categoryName
    }
    var recurrenceTitle: String {
        plan.recurrence == .once ? L10n.string("Once") : plan.recurrence?.title ?? ""
    }
    func dueTitle(today: String) -> String {
        if let occurrenceDate {
            let date = PlannedDates.dueLabel(occurrenceDate, today: today, workspace: workspace)
            return L10n.string("Due \(date)")
        }
        let date = PlannedDates.dueLabel(plan.nextDate, today: today, workspace: workspace)
        if plan.status == "completed" { return L10n.string("Completed") }
        if plan.status == "paused" { return L10n.string("Paused") }
        if plan.nextDate < today { return L10n.string("Overdue · \(date)") }
        if plan.nextDate == today { return L10n.string("Due today") }
        return L10n.string("Due \(date)")
    }
    @MainActor
    var amountTitle: String? {
        guard let amount = plan.amount else { return nil }
        return MoneyAmountFormatter.string(
            decimalMinorUnits: amount, currencyCode: workspace.currencyCode,
            minorUnit: workspace.minorUnit, showsPositiveSign: !plan.isTransfer,
            usesAbsoluteValue: plan.isTransfer)
    }
    @MainActor
    func matches(search: String) -> Bool {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty
            || [
                name, accountName, destinationName, categorySummary ?? "",
                plan.notes ?? "", recurrenceTitle, plan.nextDate, amountTitle ?? "",
            ]
            .contains { $0.localizedStandardContains(query) }
    }
}

struct TransactionEditorDefaults: Decodable, Equatable {
    var transactionDefaultAccountId: String?
    var transactionDefaultPendingStatus: Bool?
}

struct TransactionEditorChoices {
    var merchants: [TransactionEditorMerchant] = []
    var categories: [TransactionEditorCategory] = []
    var accounts: [TransactionEditorAccount] = []
    var plannedTransactions: [TransactionEditorPlannedTransaction] = []
    var defaults = TransactionEditorDefaults()
}

struct TransactionEditorMovement: Decodable {
    @ConvexInt var amount: Int64
    let categoryId: String?
    let categoryName: String?
    let readyToAssign: Bool
    let notes: String?
    let sortOrder: Double?
    let category: TransactionEditorCategory?
}

struct TransactionEditorImportDetails: Decodable {
    let provider: String
    let originalStatement: String?
    let merchantName: String?
    let date: String
    let postedDate: String?
    @ConvexInt var amount: Int64
}

struct TransactionEditorTransferSuggestion: Decodable, Equatable {
    let status: String
    let detectionReason: String?
    var suggestedCounterpartAccountId: String?
    var matchedTransactionId: String?
    var accountConfidence: Double?
    var counterpartAccountName: String?

    var reliableAccountID: String? {
        guard status == "linked_pending_approval" || (accountConfidence ?? 0) >= 70 else {
            return nil
        }
        return suggestedCounterpartAccountId
    }

    var isActionable: Bool { status == "pending" || status == "linked_pending_approval" }
}

struct TransactionEditorDetail: Decodable, Identifiable {
    let id: String
    let workspaceId: String
    let bankAccountId: String
    let date: String
    let type: TransactionFeedItemType
    let status: TransactionFeedStatus
    let reviewStatus: TransactionFeedReviewStatus
    @ConvexInt var totalAmount: Int64
    let movements: [TransactionEditorMovement]
    let merchantId: String?
    let merchantName: String?
    let notes: String?
    let transferPairId: String?
    let transferPairBankAccountId: String?
    let transferPairAccountName: String?
    let isCrossBudgetTransfer: Bool?
    let isCreditCardPayment: Bool?
    let scheduledTransactionId: String?
    var scheduledOccurrenceDate: String? = nil
    let importDetails: TransactionEditorImportDetails?
    let linkedRawTransactionId: String?
    let source: String?
    let isDeleted: Bool
    let merchant: TransactionEditorMerchant?
    let bankAccount: TransactionEditorAccount?
    let suggestedTransfer: TransactionEditorTransferSuggestion?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case workspaceId, bankAccountId, date, type, status, reviewStatus, totalAmount
        case movements, merchantId, merchantName, notes, transferPairId, transferPairBankAccountId
        case transferPairAccountName, isCrossBudgetTransfer, isCreditCardPayment,
            scheduledTransactionId, scheduledOccurrenceDate
        case importDetails, linkedRawTransactionId, source, isDeleted, merchant, bankAccount,
            suggestedTransfer
    }
}

enum TransactionEditorDate {
    static func calendar(workspace: TransactionFeedWorkspace) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        // Match the backend scheduling boundary when a workspace has no valid timezone.
        calendar.timeZone = workspace.timezoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .gmt
        return calendar
    }

    static func date(from key: String, workspace: TransactionFeedWorkspace) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, key.count == 10 else { return nil }
        let calendar = calendar(workspace: workspace)
        guard
            let date = calendar.date(
                from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)),
            self.key(from: date, workspace: workspace) == key
        else { return nil }
        return date
    }

    static func key(from date: Date, workspace: TransactionFeedWorkspace) -> String {
        let parts = calendar(workspace: workspace).dateComponents(
            [.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func today(workspace: TransactionFeedWorkspace, now: Date = Date()) -> String {
        key(from: now, workspace: workspace)
    }
}

enum TransactionEditorError: LocalizedError {
    case notFound, amountOutOfRange, connectionTimedOut, endedWithoutResponse, saveFailed

    var errorDescription: String? {
        switch self {
        case .notFound: L10n.string("This transaction is no longer available.")
        case .amountOutOfRange: L10n.string("This amount is too large to edit.")
        case .connectionTimedOut: L10n.string("The connection timed out. Please try again.")
        case .endedWithoutResponse:
            L10n.string("We couldn't load this transaction. Please try again.")
        case .saveFailed: L10n.string("We couldn't save your changes. Please try again.")
        }
    }
}

/// The server captures these balances atomically with the saved transaction.
struct TransactionBudgetChange: Decodable, Identifiable, Equatable {
    let categoryId: String?
    let name: String
    var yearMonth: Int?
    @ConvexInt var before: Int64
    @ConvexInt var after: Int64

    var id: String { "\(categoryId ?? "ready-to-assign"):\(yearMonth ?? 0)" }
    var delta: Decimal { Decimal(after) - Decimal(before) }
    var isOverspent: Bool { after < 0 }
}

struct TransactionCreationResult: Decodable {
    let transactionId: String?
    let scheduledTransactionId: String?
    let budgetChanges: [TransactionBudgetChange]

    var isScheduledOnly: Bool { transactionId == nil && scheduledTransactionId != nil }
}

enum TransactionMutationKind {
    case created, updated, deleted, restored, accountCreated
    case accountClosed, accountDeleted, accountReopened, accountRestored

    var title: String {
        switch self {
        case .created: L10n.string("Transaction added")
        case .updated: L10n.string("Transaction updated")
        case .deleted: L10n.string("Transaction deleted")
        case .restored: L10n.string("Transaction restored")
        case .accountCreated: L10n.string("Account created")
        case .accountClosed: L10n.string("Account closed")
        case .accountDeleted: L10n.string("Account deleted")
        case .accountReopened: L10n.string("Account reopened")
        case .accountRestored: L10n.string("Account restored")
        }
    }
}

struct TransactionMutationReceipt: Identifiable {
    let id = UUID()
    let workspace: TransactionFeedWorkspace
    let dateKey: String
    var kind: TransactionMutationKind = .created
    var budgetChanges: [TransactionBudgetChange]
    var isPending = false
    var isUpdating: Bool { kind == .updated && isPending }
    var isScheduledOnly = false
    var transactionID: String?
    var accountCreation: AccountCreationSummary?
    var accountLifecycle: AccountLifecycleSummary?
    var canUndoAccountChange: Bool {
        accountLifecycle != nil && (kind == .accountClosed || kind == .accountDeleted)
    }
}

struct TransactionCreationRequest {
    var mutationName: String {
        draft.isTransfer
            ? "transactions:createTransferFromEditor" : "transactions:createTransactionFromEditor"
    }
    let workspaceID: String
    let draft: TransactionEditorDraft
    var includesCategories = true

    var arguments: [String: ConvexEncodable?] {
        if draft.isTransfer {
            var arguments: [String: ConvexEncodable?] = [
                "workspaceId": workspaceID,
                "fromAccountId": draft.isIncomingTransfer
                    ? draft.transferAccountID : draft.accountID,
                "toAccountId": draft.isIncomingTransfer ? draft.accountID : draft.transferAccountID,
                "amount": draft.amount, "date": draft.dateKey, "status": draft.status.rawValue,
                "recurrence": draft.recurrence.rawValue, "entryMode": draft.entryMode.rawValue,
            ]
            if !draft.notes.isEmpty { arguments["notes"] = draft.notes }
            if includesCategories, let allocation = draft.allocations.first {
                if let categoryID = allocation.categoryID { arguments["categoryId"] = categoryID }
                arguments["readyToAssign"] = allocation.readyToAssign
            }
            if let plannedID = draft.scheduledTransactionID {
                arguments["linkedScheduledTransactionId"] = plannedID
                if let date = draft.scheduledOccurrenceDate {
                    arguments["linkedScheduledOccurrenceDate"] = date
                }
            }
            return arguments
        }
        var arguments: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID,
            "bankAccountId": draft.accountID,
            "date": draft.dateKey,
            "status": draft.status.rawValue,
            "recurrence": draft.recurrence.rawValue,
            "entryMode": draft.entryMode.rawValue,
            "movements": draft.allocations.map { allocation -> ConvexEncodable? in
                var movement: [String: ConvexEncodable?] = [
                    "amount": allocation.amount, "readyToAssign": allocation.readyToAssign,
                ]
                if let categoryID = allocation.categoryID { movement["categoryId"] = categoryID }
                if !allocation.notes.isEmpty { movement["notes"] = allocation.notes }
                return movement
            },
        ]
        if let plannedID = draft.scheduledTransactionID {
            arguments["linkedScheduledTransactionId"] = plannedID
            if let date = draft.scheduledOccurrenceDate {
                arguments["linkedScheduledOccurrenceDate"] = date
            }
        }
        if let merchantID = draft.merchantID { arguments["merchantId"] = merchantID }
        if !draft.notes.isEmpty { arguments["notes"] = draft.notes }
        return arguments
    }
}
