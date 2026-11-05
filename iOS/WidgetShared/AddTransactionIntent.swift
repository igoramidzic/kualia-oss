import AppIntents
import Foundation
import os

nonisolated private let logger = Logger(
    subsystem: "com.kualia.app", category: "AddTransactionIntent")

nonisolated enum ShortcutTransactionDirection: String, AppEnum, Codable, Sendable {
    case outflow
    case inflow
    case transfer

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Transaction Type"
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .outflow: "Expense",
        .inflow: "Income",
        .transfer: "Transfer",
    ]
}

nonisolated struct TransactionShortcutDraft: Codable, Equatable, Sendable {
    let amount: Double?
    let direction: ShortcutTransactionDirection?
    let payee: String?
    let account: String?
    let category: String?
    let date: Date?
    let notes: String?
    var transferAccount: String? = nil
    var recurrence: ShortcutTransactionRecurrence? = nil
    var workspaceID: String? = nil
    var workspaceName: String? = nil

    var hasPrefilledValues: Bool {
        amount != nil || direction != nil || payee?.isEmpty == false || account?.isEmpty == false
            || category?.isEmpty == false || date != nil || notes?.isEmpty == false
            || transferAccount != nil || recurrence != nil || workspaceName != nil
    }

    func minorUnitAmount(decimalPlaces: Int) -> Int64? {
        guard let amount, amount.isFinite, amount > 0, (0...9).contains(decimalPlaces),
            let decimal = Decimal(string: String(amount), locale: Locale(identifier: "en_US_POSIX"))
        else { return nil }
        var scaled = decimal * pow(Decimal(10), decimalPlaces)
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        let value = NSDecimalNumber(decimal: rounded)
        guard value != .notANumber, value.compare(NSDecimalNumber.zero) == .orderedDescending,
            value.compare(NSDecimalNumber(value: Int64.max)) != .orderedDescending
        else {
            return nil
        }
        return value.int64Value
    }

    func matchesWorkspace(id: String, name: String) -> Bool {
        if let workspaceID, workspaceID != id { return false }
        if let workspaceName, !workspaceName.isEmpty,
            workspaceName.localizedCaseInsensitiveCompare(name) != .orderedSame
        {
            return false
        }
        return true
    }
}

nonisolated enum PendingAppAction: Equatable {
    case newTransaction(TransactionShortcutDraft?)
    case transactions(ShortcutTransactionFilter)
}

nonisolated enum ShortcutTransactionRecurrence: String, AppEnum, Codable, Sendable {
    case once, daily, weekly, monthly, yearly
    case everyOtherWeek = "every_other_week"

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Repeat"
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .once: "Does not repeat", .daily: "Daily", .weekly: "Weekly",
        .everyOtherWeek: "Every other week", .monthly: "Monthly", .yearly: "Yearly",
    ]
}

nonisolated enum ShortcutTransactionFilter: String, AppEnum, Codable, Sendable {
    case all, transfers, pending
    case needsReview = "needs_review"

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Transactions"
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .all: "All", .needsReview: "Needs Review", .transfers: "Transfers", .pending: "Pending",
    ]
}

struct ShortcutAccountOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        WidgetSharedStorage.accounts.map(\.name)
    }
}

struct ShortcutCategoryOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        WidgetSharedStorage.categories.map { "\($0.groupName) / \($0.name)" }
    }
}

struct ShortcutWorkspaceOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        WidgetSharedStorage.workspaceName.map { [$0] } ?? []
    }
}

struct OpenTransactionsIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Transactions"
    static var description: IntentDescription =
        "Open your transactions in Kualia to review, edit, categorize, or delete them."
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Filter", default: .all)
    var filter: ShortcutTransactionFilter

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$filter) transactions")
    }

    func perform() async throws -> some IntentResult {
        await MainActor.run { PendingAppActionStore.enqueueTransactions(filter: filter) }
        return .result()
    }
}

nonisolated enum PendingAppActionStore {
    static let appGroupSuiteName = "group.com.kualia.app"
    static let actionKey = "pendingControlAction"
    static let transactionDraftKey = "pendingTransactionShortcutDraft"
    static let newTransactionAction = "new-transaction"
    static let actionEnqueued = Notification.Name("kualia.pendingAppActionEnqueued")

    static func enqueueNewTransaction(
        draft: TransactionShortcutDraft?,
        defaults: UserDefaults? = UserDefaults(suiteName: appGroupSuiteName)
    ) {
        if let draft, draft.hasPrefilledValues, let data = try? JSONEncoder().encode(draft) {
            defaults?.set(data, forKey: transactionDraftKey)
        } else {
            defaults?.removeObject(forKey: transactionDraftKey)
        }
        defaults?.set(newTransactionAction, forKey: actionKey)
        defaults?.synchronize()
        NotificationCenter.default.post(name: actionEnqueued, object: nil)
    }

    static func enqueueTransactions(
        filter: ShortcutTransactionFilter,
        defaults: UserDefaults? = UserDefaults(suiteName: appGroupSuiteName)
    ) {
        defaults?.removeObject(forKey: transactionDraftKey)
        defaults?.set("transactions:\(filter.rawValue)", forKey: actionKey)
        defaults?.synchronize()
        NotificationCenter.default.post(name: actionEnqueued, object: nil)
    }

    static func consume(
        defaults: UserDefaults? = UserDefaults(suiteName: appGroupSuiteName)
    ) -> PendingAppAction? {
        guard let action = defaults?.string(forKey: actionKey) else { return nil }
        let draft = defaults?.data(forKey: transactionDraftKey).flatMap {
            try? JSONDecoder().decode(TransactionShortcutDraft.self, from: $0)
        }
        defaults?.removeObject(forKey: actionKey)
        defaults?.removeObject(forKey: transactionDraftKey)

        switch action {
        case newTransactionAction:
            return .newTransaction(draft)
        default:
            if action.hasPrefix("transactions:"),
                let filter = ShortcutTransactionFilter(rawValue: String(action.dropFirst(13)))
            {
                return .transactions(filter)
            }
            return nil
        }
    }
}

struct AddTransactionIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Transaction"
    static var description: IntentDescription =
        "Prepare an expense, income, or transfer in your active workspace. Review the details in Kualia, then tap Add or Schedule."
    static var openAppWhenRun: Bool = true

    @Parameter(
        title: "Amount", description: "The positive transaction amount in your workspace currency.")
    var amount: Double?

    @Parameter(title: "Type")
    var direction: ShortcutTransactionDirection?

    @Parameter(title: "Merchant", description: "An existing or new payee name.")
    var payee: String?

    @Parameter(title: "Account", optionsProvider: ShortcutAccountOptions())
    var account: String?

    @Parameter(title: "Category", optionsProvider: ShortcutCategoryOptions())
    var category: String?

    @Parameter(title: "Date")
    var date: Date?

    @Parameter(title: "Notes")
    var notes: String?

    @Parameter(title: "Destination Account", optionsProvider: ShortcutAccountOptions())
    var transferAccount: String?

    @Parameter(title: "Repeat")
    var recurrence: ShortcutTransactionRecurrence?

    @Parameter(title: "Workspace", optionsProvider: ShortcutWorkspaceOptions())
    var workspace: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add transaction") {
            \.$amount
            \.$direction
            \.$payee
            \.$account
            \.$category
            \.$date
            \.$notes
            \.$transferAccount
            \.$recurrence
            \.$workspace
        }
    }

    func perform() async throws -> some IntentResult {
        if let amount, !amount.isFinite || amount <= 0 {
            throw $amount.needsValueError("Enter an amount greater than zero.")
        }
        let draft = TransactionShortcutDraft(
            amount: amount,
            direction: direction,
            payee: payee?.trimmingCharacters(in: .whitespacesAndNewlines),
            account: account?.trimmingCharacters(in: .whitespacesAndNewlines),
            category: category?.trimmingCharacters(in: .whitespacesAndNewlines),
            date: date,
            notes: notes?.trimmingCharacters(in: .whitespacesAndNewlines),
            transferAccount: transferAccount?.trimmingCharacters(in: .whitespacesAndNewlines),
            recurrence: recurrence,
            workspaceID: WidgetSharedStorage.workspaceId,
            workspaceName: workspace?.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        await MainActor.run {
            logger.info("[AddTransactionIntent] perform() called")
            PendingAppActionStore.enqueueNewTransaction(draft: draft)
            logger.info("[AddTransactionIntent] queued transaction draft and requested app launch")
        }
        return .result()
    }
}
