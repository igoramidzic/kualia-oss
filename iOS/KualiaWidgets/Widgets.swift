import AppIntents
import SwiftUI
import WidgetKit

private enum StudioKind: String {
    case categories = "CategoryCardWidget"
    case bills = "UpcomingTransactionsWidget"
    case money = "AccountBalancesWidget"
    case capture = "LockScreenAddTransactionWidget"

    var title: String {
        switch self {
        case .categories: WidgetL10n.string("Category Balances")
        case .bills: WidgetL10n.string("Upcoming Bills")
        case .money: WidgetL10n.string("Account Balances")
        case .capture: WidgetL10n.string("Add Transaction")
        }
    }

    var icon: KualiaIcon {
        switch self {
        case .categories: .envelopeOpen
        case .bills: .calendarClock
        case .money: .accounts
        case .capture: .plus
        }
    }
}

private struct StudioEntry: TimelineEntry {
    let date: Date
    var pulse: BudgetPulseResponse?
    var categories: CategoryAvailableResponse?
    var upcoming: UpcomingTransactionsResponse?
    var accounts: AccountBalancesResponse?
    var error: String?
    var accessoryError: String?
    var categoryPhoto: Data?
    var accountRows: [AccountBalance] = []

    static var preview: StudioEntry {
        StudioEntry(
            date: Date(),
            pulse: BudgetPulseResponse(
                workspaceName: WidgetL10n.string("Personal"),
                currencyCode: "USD",
                month: "2026-09",
                today: "2026-09-08",
                daysRemaining: 23,
                totalAvailable: 184650,
                totalAssigned: 320000,
                totalActivity: -135350,
                overspentCount: 1,
                overspentAmount: 2400
            ),
            categories: CategoryAvailableResponse(
                categories: [
                    CategoryAvailableItem(
                        categoryName: WidgetL10n.string("Groceries"), available: 28750,
                        assigned: 50000, activity: -21250, hasUnmetTarget: false),
                    CategoryAvailableItem(
                        categoryName: WidgetL10n.string("Dining Out"), available: 8400,
                        assigned: 20000, activity: -11600, hasUnmetTarget: false),
                    CategoryAvailableItem(
                        categoryName: WidgetL10n.string("Transport"), available: -1800,
                        assigned: 10000, activity: -11800, hasUnmetTarget: false),
                ], currencyCode: "USD", month: "2026-09"
            ),
            upcoming: UpcomingTransactionsResponse(
                transactions: [
                    UpcomingTransaction(
                        recurringTransactionId: "preview-rent",
                        merchantName: WidgetL10n.string("Rent"),
                        amount: 145000, dueDate: "2026-09-11", isOverdue: false, isIncome: false
                    ),
                    UpcomingTransaction(
                        recurringTransactionId: "preview-internet",
                        merchantName: WidgetL10n.string("Internet"),
                        amount: 6500, dueDate: "2026-09-14", isOverdue: false, isIncome: false
                    ),
                ],
                currencyCode: "USD"
            ),
            accounts: AccountBalancesResponse(
                groups: [], totalAssets: 2_435_000, totalLiabilities: -365000,
                netWorth: 2_070_000, currencyCode: "USD"
            ),
            accountRows: [
                AccountBalance(
                    accountId: "checking", name: WidgetL10n.string("Checking"),
                    accountType: "banking_checking", balance: 245000),
                AccountBalance(
                    accountId: "savings", name: WidgetL10n.string("Savings"),
                    accountType: "banking_savings", balance: 820000),
                AccountBalance(
                    accountId: "credit", name: WidgetL10n.string("Credit card"),
                    accountType: "credit_credit_card", balance: -36500),
            ]
        )
    }

    static func failure(_ message: String, accessoryMessage: String? = nil) -> StudioEntry {
        StudioEntry(date: Date(), error: message, accessoryError: accessoryMessage)
    }
}

private struct StudioProvider: TimelineProvider {
    let kind: StudioKind

    func placeholder(in context: Context) -> StudioEntry { .preview }

    func getSnapshot(in context: Context, completion: @escaping (StudioEntry) -> Void) {
        if context.isPreview {
            completion(.preview)
        } else {
            Task { completion(await load()) }
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StudioEntry>) -> Void) {
        Task {
            let entry = await load()
            completion(
                Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60))))
        }
    }

    private func load() async -> StudioEntry {
        if kind == .capture { return StudioEntry(date: Date()) }
        guard WidgetSharedStorage.widgetToken != nil else {
            return .failure(WidgetL10n.string("Open Kualia to connect your widgets."))
        }
        do {
            switch kind {
            case .bills:
                let workspaceID = WidgetSharedStorage.workspaceId
                let token = WidgetSharedStorage.widgetToken
                let pulse = try await WidgetDataService.fetchBudgetPulse()
                let upcoming = try await WidgetDataService.fetchUpcomingTransactions(
                    localDate: pulse.today, expensesOnly: true)
                guard WidgetSharedStorage.workspaceId == workspaceID,
                    WidgetSharedStorage.widgetToken == token
                else {
                    return .failure(
                        WidgetL10n.string("Your workspace changed. Open Kualia to refresh."))
                }
                guard upcoming.transactions.allSatisfy({ $0.isIncome != nil }) else {
                    return .failure(
                        WidgetL10n.string("Bills aren't available yet. Open Kualia to refresh."))
                }
                let bills = UpcomingTransactionsResponse(
                    transactions: upcoming.transactions.filter { $0.isIncome == false },
                    currencyCode: upcoming.currencyCode
                )
                return StudioEntry(date: Date(), pulse: pulse, upcoming: bills)
            case .money, .categories:
                return .failure(WidgetL10n.string("Edit Widget to choose what to show."))
            case .capture:
                return StudioEntry(date: Date())
            }
        } catch {
            return .failure(WidgetL10n.string("Couldn't refresh. Open Kualia to reconnect."))
        }
    }
}

private struct CategoryBalancesProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> StudioEntry { .preview }

    func snapshot(for configuration: SelectSingleCategoryIntent, in context: Context) async
        -> StudioEntry
    {
        context.isPreview ? .preview : await load(configuration, family: context.family)
    }

    func timeline(for configuration: SelectSingleCategoryIntent, in context: Context) async
        -> Timeline<StudioEntry>
    {
        Timeline(
            entries: [await load(configuration, family: context.family)],
            policy: .after(Date().addingTimeInterval(1800)))
    }

    private func load(_ configuration: SelectSingleCategoryIntent, family: WidgetFamily) async
        -> StudioEntry
    {
        guard WidgetSharedStorage.widgetToken != nil else {
            return .failure(WidgetL10n.string("Open Kualia to connect your widgets."))
        }
        let ids = WidgetBalanceSelection.selectedIDs(
            [
                configuration.category?.id, configuration.category2?.id,
                configuration.category3?.id,
                configuration.category4?.id, configuration.category5?.id,
                configuration.category6?.id,
            ], layout: family.balanceLayout)
        guard !ids.isEmpty else {
            return .failure(
                WidgetL10n.string("Touch and hold, then edit this widget to choose a category."),
                accessoryMessage: WidgetL10n.string("Choose a category"))
        }
        let available = Set(WidgetSharedStorage.categories.map(\.id))
        guard ids.allSatisfy({ available.contains($0) }) else {
            return .failure(
                WidgetL10n.string(
                    "This category is no longer available. Edit the widget to choose another."),
                accessoryMessage: WidgetL10n.string("Choose a category"))
        }
        do {
            let response = try await WidgetDataService.fetchCategoryAvailable(categoryIds: ids)
            // The endpoint returns valid categories in request order. Never shift another
            // category into a missing selection after a deletion or workspace change.
            guard response.categories.count == ids.count else {
                return .failure(
                    WidgetL10n.string(
                        "This category is no longer available. Edit the widget to choose another."),
                    accessoryMessage: WidgetL10n.string("Choose a category"))
            }
            return StudioEntry(
                date: Date(), categories: response,
                categoryPhoto: family == .systemSmall || family == .systemMedium
                    ? WidgetImageStorage.loadImageData(
                        forCategoryId: ids[0], size: family == .systemSmall ? .small : .medium)
                    : nil)
        } catch {
            return .failure(WidgetL10n.string("Couldn't refresh. Open Kualia to reconnect."))
        }
    }
}

private struct BalancesProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> StudioEntry { .preview }

    func snapshot(for configuration: SelectAccountsIntent, in context: Context) async -> StudioEntry
    {
        context.isPreview ? .preview : await load(configuration, family: context.family)
    }

    func timeline(for configuration: SelectAccountsIntent, in context: Context) async -> Timeline<
        StudioEntry
    > {
        Timeline(
            entries: [await load(configuration, family: context.family)],
            policy: .after(Date().addingTimeInterval(1800)))
    }

    private func load(_ configuration: SelectAccountsIntent, family: WidgetFamily) async
        -> StudioEntry
    {
        guard WidgetSharedStorage.widgetToken != nil else {
            return .failure(WidgetL10n.string("Open Kualia to connect your widgets."))
        }
        let ids = WidgetBalanceSelection.selectedIDs(
            [
                configuration.account1?.id, configuration.account2?.id, configuration.account3?.id,
                configuration.account4?.id, configuration.account5?.id, configuration.account6?.id,
            ], layout: family.balanceLayout)
        guard !ids.isEmpty else {
            return .failure(
                WidgetL10n.string("Edit Widget to choose your accounts."),
                accessoryMessage: WidgetL10n.string("Choose an account"))
        }
        let available = Set(WidgetSharedStorage.accounts.map(\.id))
        guard ids.allSatisfy({ available.contains($0) }) else {
            return .failure(
                WidgetL10n.string(
                    "An account is no longer available. Edit this widget to choose your accounts."),
                accessoryMessage: WidgetL10n.string("Choose an account"))
        }
        do {
            let response = try await WidgetDataService.fetchAccountBalances(accountIds: ids)
            let rows = WidgetBalanceSelection.accounts(in: response, selectedIDs: ids)
            guard rows.count == ids.count else {
                return .failure(
                    WidgetL10n.string(
                        "An account is no longer available. Edit this widget to choose your accounts."
                    ), accessoryMessage: WidgetL10n.string("Choose an account"))
            }
            return StudioEntry(date: Date(), accounts: response, accountRows: rows)
        } catch {
            return .failure(WidgetL10n.string("Couldn't refresh. Open Kualia to reconnect."))
        }
    }
}

extension WidgetBalanceLayout {
    fileprivate static let supportedFamilies: [WidgetFamily] = [
        .systemSmall, .systemMedium, .systemLarge,
        .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ]
}

extension WidgetFamily {
    fileprivate var balanceLayout: WidgetBalanceLayout {
        switch self {
        case .systemLarge: .large
        case .systemMedium: .medium
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: .accessory
        default: .small
        }
    }
}

private struct StudioHeader: View {
    let kind: StudioKind
    var trailing: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            KualiaIconImage(icon: kind.icon, size: 15)
            Text(kind.title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(.caption2.weight(.medium))
                    .opacity(0.7)
            }
        }
    }
}

private struct StudioFailureView: View {
    let kind: StudioKind
    let message: String
    var accessoryMessage: String? = nil
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family.balanceLayout == .accessory {
            Group {
                switch family {
                case .accessoryInline:
                    Label(accessoryMessage ?? WidgetL10n.string("Open Kualia"), icon: kind.icon)
                case .accessoryCircular:
                    VStack(spacing: 3) {
                        KualiaIconImage(icon: kind.icon, size: 18)
                        Text(accessoryMessage ?? WidgetL10n.string("Open Kualia"))
                            .font(.system(size: 10, weight: .semibold)).multilineTextAlignment(
                                .center)
                    }
                default:
                    VStack(alignment: .leading, spacing: 3) {
                        StudioHeader(kind: kind)
                        Text(accessoryMessage ?? message).font(.caption2).lineLimit(3)
                            .minimumScaleFactor(0.8)
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(kind.title) + Text(": ") + Text(message))
        } else {
            VStack(alignment: .leading, spacing: 9) {
                StudioHeader(kind: kind)
                Spacer(minLength: 0)
                KualiaIconImage(icon: .connection, size: 25)
                Text(message)
                    .font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

private struct AccessoryBalanceView: View {
    let kind: StudioKind
    let row: WidgetBalanceRow
    let currencyCode: String
    @Environment(\.widgetFamily) private var family

    private var balance: String {
        WidgetCurrencyFormatter.format(row.amount, currencyCode: currencyCode)
    }

    var body: some View {
        Group {
            switch family {
            case .accessoryInline:
                // Inline widgets accept a single text label with an optional image.
                Label {
                    Text(row.title) + Text(": ") + Text(balance)
                } icon: {
                    KualiaIconImage(icon: kind.icon, size: 14)
                }
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 2) {
                        KualiaIconImage(icon: kind.icon, size: 13)
                        Text(balance)
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .monospacedDigit().lineLimit(1).minimumScaleFactor(0.5)
                        Text(row.title).font(.system(size: 9, weight: .medium)).lineLimit(1)
                    }
                    .padding(.horizontal, 3)
                }
            default:
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        KualiaIconImage(icon: kind.icon, size: 13)
                        Text(row.title).font(.caption.weight(.semibold)).lineLimit(1)
                    }
                    Text(balance)
                        .font(.system(size: 23, weight: .semibold, design: .rounded))
                        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    Text(
                        kind == .categories
                            ? WidgetL10n.string("Available") : WidgetL10n.string("Balance")
                    ).font(.caption2)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(row.title) + Text(": ") + Text(balance))
    }
}

/// Lock Screen widgets use the system's tint and never load Home Screen photos.
private struct StudioWidgetAppearance: ViewModifier {
    let kind: String
    var categoryPhoto: Data? = nil
    @Environment(\.widgetFamily) private var family

    func body(content: Content) -> some View {
        content
            .foregroundStyle(
                family.balanceLayout == .accessory
                    ? .primary
                    : WidgetStudioPreferences.foreground(
                        for: kind, fallbackImageData: categoryPhoto)
            )
            .containerBackground(for: .widget) {
                if family.balanceLayout == .accessory {
                    Color.clear
                } else {
                    WidgetStudioBackground(kind: kind, fallbackImageData: categoryPhoto)
                }
            }
    }
}

/// One clear amount on small widgets; readable rows on the larger sizes.
private struct BalanceListView: View {
    let kind: StudioKind
    let rows: [WidgetBalanceRow]
    let currencyCode: String
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family.balanceLayout == .accessory, let row = rows.first {
            AccessoryBalanceView(kind: kind, row: row, currencyCode: currencyCode)
        } else if family == .systemSmall, let row = rows.first {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    KualiaIconImage(icon: kind.icon, size: 15)
                    Text(
                        kind == .categories
                            ? WidgetL10n.string("Available") : WidgetL10n.string("Balance")
                    )
                    .font(.caption.weight(.medium)).opacity(0.75)
                }
                Spacer(minLength: 0)
                Text(row.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                amount(row.amount, size: 29)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                StudioHeader(kind: kind)
                VStack(spacing: 0) {
                    ForEach(Array(rows.prefix(family.balanceLayout.capacity))) { row in
                        HStack(spacing: 12) {
                            Text(row.title).font(.subheadline.weight(.medium)).lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            amount(row.amount, size: 18)
                                .layoutPriority(1)
                        }
                        .frame(maxHeight: .infinity)
                        .accessibilityElement(children: .combine)
                        if row.id != rows.prefix(family.balanceLayout.capacity).last?.id {
                            Divider().overlay(.primary.opacity(0.1))
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func amount(_ value: Int, size: CGFloat) -> some View {
        Text(WidgetCurrencyFormatter.format(value, currencyCode: currencyCode))
            .font(.system(size: size, weight: .semibold, design: .rounded))
            .monospacedDigit().minimumScaleFactor(0.55).lineLimit(1)
    }
}

private struct CategoryBalancesView: View {
    let entry: StudioEntry
    var body: some View {
        if let error = entry.error {
            StudioFailureView(
                kind: .categories, message: error, accessoryMessage: entry.accessoryError)
        } else if let response = entry.categories {
            BalanceListView(
                kind: .categories, rows: response.balanceRows, currencyCode: response.currencyCode)
        }
    }
}

private struct BillsCountdownView: View {
    let entry: StudioEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let error = entry.error {
            StudioFailureView(kind: .bills, message: error)
        } else if family == .accessoryRectangular {
            lockScreenContent
        } else if let response = entry.upcoming, let pulse = entry.pulse {
            VStack(alignment: .leading, spacing: 8) {
                StudioHeader(kind: .bills)
                if let next = response.transactions.first {
                    HStack(alignment: .center, spacing: 16) {
                        countdown(next, today: pulse.today)
                        if family != .systemSmall {
                            VStack(alignment: .leading, spacing: 7) {
                                ForEach(
                                    response.transactions.prefix(family == .systemLarge ? 6 : 2)
                                ) { transaction in
                                    billRow(transaction, currencyCode: response.currencyCode)
                                }
                            }
                        }
                    }
                    .frame(maxHeight: .infinity)
                    if family == .systemSmall {
                        billRow(next, currencyCode: response.currencyCode)
                    } else {
                        Text(WidgetL10n.string("Planned payments · open to review"))
                            .font(.system(size: 10, weight: .medium))
                            .opacity(0.7)
                    }
                } else {
                    Spacer(minLength: 0)
                    KualiaIconImage(icon: .allClear, size: 29)
                    Text(WidgetL10n.string("A little breathing room."))
                        .font(.headline)
                    Text(WidgetL10n.string("No bills in the next 3 months"))
                        .font(.caption2)
                        .opacity(0.7)
                    Spacer(minLength: 0)
                }
            }
        }
    }

    @ViewBuilder
    private var lockScreenContent: some View {
        if let response = entry.upcoming, let pulse = entry.pulse {
            if let next = response.transactions.first {
                HStack(spacing: 10) {
                    countdown(next, today: pulse.today, compact: true)
                        .frame(maxWidth: 48)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(next.merchantName)
                            .font(.caption.weight(.semibold)).lineLimit(2)
                        Text(
                            WidgetCurrencyFormatter.formatAbsolute(
                                next.amount, currencyCode: response.currencyCode)
                        )
                        .font(.headline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Label(WidgetL10n.string("Upcoming Bills"), icon: .calendarClock)
                        .font(.caption.weight(.semibold))
                    Text(WidgetL10n.string("No bills in the next 3 months"))
                        .font(.caption2).lineLimit(2)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
    }

    private func countdown(_ transaction: UpcomingTransaction, today: String, compact: Bool = false)
        -> some View
    {
        let days = StudioDate.days(from: today, to: transaction.dueDate)
        return VStack(alignment: .leading, spacing: 0) {
            Text(days < 0 ? "!" : days.formatted(.number.locale(WidgetSharedStorage.locale)))
                .font(.system(size: compact ? 30 : 55, weight: .light, design: .rounded))
                .tracking(compact ? -1 : -3)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(
                days < 0
                    ? WidgetL10n.string("OVERDUE")
                    : days == 0
                        ? WidgetL10n.string("DUE TODAY")
                        : days == 1
                            ? WidgetL10n.string("DAY TO GO") : WidgetL10n.string("DAYS TO GO")
            )
            .font(.system(size: compact ? 7 : 8, weight: .bold, design: .rounded))
            .tracking(compact ? 0 : 1.2)
            .lineLimit(compact ? 2 : nil)
            .minimumScaleFactor(compact ? 0.8 : 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            days < 0
                ? WidgetL10n.string("Payment overdue")
                : WidgetL10n.string("Payment due in \(days) days"))
    }

    private func billRow(_ transaction: UpcomingTransaction, currencyCode: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(transaction.merchantName)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Text(
                WidgetCurrencyFormatter.formatAbsolute(
                    transaction.amount, currencyCode: currencyCode)
            )
            .font(.caption2)
            .lineLimit(1)
            .opacity(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private enum StudioDate {
    static func days(from today: String, to dueDate: String) -> Int {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let start = formatter.date(from: today), let end = formatter.date(from: dueDate)
        else { return 0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        return calendar.dateComponents([.day], from: start, to: end).day ?? 0
    }
}

private struct AccountBalancesView: View {
    let entry: StudioEntry
    var body: some View {
        if let error = entry.error {
            StudioFailureView(kind: .money, message: error, accessoryMessage: entry.accessoryError)
        } else if let response = entry.accounts {
            BalanceListView(
                kind: .money,
                rows: entry.accountRows.map {
                    WidgetBalanceRow(id: $0.id, title: $0.name, amount: $0.balance)
                }, currencyCode: response.currencyCode)
        }
    }
}

private struct QuickCaptureView: View {
    @Environment(\.widgetFamily) private var family
    @ViewBuilder var body: some View {
        switch family {
        case .systemSmall:
            VStack(spacing: 12) {
                KualiaIconImage(icon: .plus, size: 42)
                Text(WidgetL10n.string("Kualia"))
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(WidgetL10n.string("Add expense in Kualia"))
        case .accessoryInline:
            Label(WidgetL10n.string("Add Transaction"), icon: .plus)
        case .accessoryCircular:
            KualiaIconImage(icon: .plus, size: 24)
                .accessibilityHidden(false)
                .accessibilityLabel(WidgetL10n.string("Add Transaction"))
        case .accessoryRectangular:
            Label(WidgetL10n.string("Add Transaction"), icon: .plus).font(.headline)
        default:
            shortcuts
        }
    }
    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: 13) {
            StudioHeader(kind: .capture, trailing: WidgetL10n.string("Keep the day in view"))
            HStack(spacing: 9) {
                captureLink(WidgetL10n.string("Expense"), type: "expense", icon: .arrowUpRight)
                captureLink(WidgetL10n.string("Income"), type: "income", icon: .arrowDownLeft)
                captureLink(WidgetL10n.string("Transfer"), type: "transfer", icon: .transfer)
            }
        }
    }

    private func captureAccessibilityLabel(_ type: String) -> String {
        switch type {
        case "income": WidgetL10n.string("Add income in Kualia")
        case "transfer": WidgetL10n.string("Add transfer in Kualia")
        default: WidgetL10n.string("Add expense in Kualia")
        }
    }

    private func captureLink(_ title: String, type: String, icon: KualiaIcon) -> some View {
        Link(destination: URL(string: "kualia://add-transaction?type=\(type)")!) {
            VStack(spacing: 9) {
                KualiaIconImage(icon: icon, size: 25)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.vertical, 12)
            .background(.primary.opacity(0.075), in: RoundedRectangle(cornerRadius: 19))
        }
        .accessibilityLabel(captureAccessibilityLabel(type))
    }
}

struct CategoryBalancesWidget: Widget {
    let kind = "CategoryCardWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind, intent: SelectSingleCategoryIntent.self,
            provider: CategoryBalancesProvider()
        ) { entry in
            CategoryBalancesView(entry: entry)
                .environment(\.locale, WidgetSharedStorage.locale)
                .environment(
                    \.layoutDirection,
                    WidgetSharedStorage.locale.language.characterDirection == .rightToLeft
                        ? .rightToLeft : .leftToRight
                )
                .privacySensitive()
                .widgetURL(URL(string: "kualia://budget"))
                .modifier(StudioWidgetAppearance(kind: kind, categoryPhoto: entry.categoryPhoto))
        }
        .configurationDisplayName("Category Balances")
        .description(
            "Available money in your chosen categories. Small shows the first, medium up to three, and large up to six."
        )
        .supportedFamilies(WidgetBalanceLayout.supportedFamilies)
    }
}

struct UpcomingBillsWidget: Widget {
    let kind = "UpcomingTransactionsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StudioProvider(kind: .bills)) { entry in
            BillsCountdownView(entry: entry)
                .environment(\.locale, WidgetSharedStorage.locale)
                .environment(
                    \.layoutDirection,
                    WidgetSharedStorage.locale.language.characterDirection == .rightToLeft
                        ? .rightToLeft : .leftToRight
                )
                .privacySensitive()
                .widgetURL(URL(string: "kualia://planned"))
                .modifier(StudioWidgetAppearance(kind: kind))
        }
        .configurationDisplayName("Upcoming Bills")
        .description("A bold countdown to your next planned payment, with a peek at what's coming.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct BalancesWidget: Widget {
    let kind = "AccountBalancesWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind, intent: SelectAccountsIntent.self, provider: BalancesProvider()
        ) { entry in
            AccountBalancesView(entry: entry)
                .environment(\.locale, WidgetSharedStorage.locale)
                .environment(
                    \.layoutDirection,
                    WidgetSharedStorage.locale.language.characterDirection == .rightToLeft
                        ? .rightToLeft : .leftToRight
                )
                .privacySensitive()
                .widgetURL(URL(string: "kualia://accounts"))
                .modifier(StudioWidgetAppearance(kind: kind))
        }
        .configurationDisplayName("Account Balances")
        .description(
            "Individual account balances. Small shows the first, medium up to three, and large up to six."
        )
        .supportedFamilies(WidgetBalanceLayout.supportedFamilies)
    }
}

struct TransactionLauncherWidget: Widget {
    let kind = "LockScreenAddTransactionWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StudioProvider(kind: .capture)) { _ in
            TransactionLauncherContent(kind: kind)
                .environment(\.locale, WidgetSharedStorage.locale)
                .environment(
                    \.layoutDirection,
                    WidgetSharedStorage.locale.language.characterDirection == .rightToLeft
                        ? .rightToLeft : .leftToRight
                )
                .widgetURL(URL(string: "kualia://new-transaction"))
                .containerBackground(for: .widget) { WidgetStudioBackground(kind: kind) }
        }
        .configurationDisplayName("Add Transaction")
        .description(
            "A plus button for a new expense, or three shortcuts on medium. Tap to finish in Kualia."
        )
        .supportedFamilies([
            .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular,
            .accessoryInline,
        ])
    }
}

#Preview("Category Balances", as: .systemSmall) {
    CategoryBalancesWidget()
} timeline: {
    StudioEntry.preview
}

#Preview("Upcoming Bills", as: .systemMedium) {
    UpcomingBillsWidget()
} timeline: {
    StudioEntry.preview
}

#Preview("Upcoming Bills · Lock Screen", as: .accessoryRectangular) {
    UpcomingBillsWidget()
} timeline: {
    StudioEntry.preview
    StudioEntry(
        date: Date(), pulse: StudioEntry.preview.pulse,
        upcoming: UpcomingTransactionsResponse(transactions: [], currencyCode: "USD"))
    StudioEntry.failure(WidgetL10n.string("Open Kualia to connect your widgets."))
}

#Preview("Account Balances", as: .systemMedium) {
    BalancesWidget()
} timeline: {
    StudioEntry.preview
}

#Preview("Add Transaction", as: .systemMedium) {
    TransactionLauncherWidget()
} timeline: {
    StudioEntry.preview
}

#Preview("Category · Lock Screen", as: .accessoryCircular) {
    CategoryBalancesWidget()
} timeline: {
    StudioEntry.preview
}

#Preview("Account · Lock Screen", as: .accessoryRectangular) {
    BalancesWidget()
} timeline: {
    StudioEntry.preview
}

#Preview("Category · Inline", as: .accessoryInline) {
    CategoryBalancesWidget()
} timeline: {
    StudioEntry.preview
}

private struct TransactionLauncherContent: View {
    let kind: String
    @Environment(\.widgetFamily) private var family
    var body: some View {
        QuickCaptureView().foregroundStyle(
            family == .systemSmall || family == .systemMedium
                ? WidgetStudioPreferences.foreground(for: kind) : .primary)
    }
}

/// Keep the existing Control Center placement, using the new collection's artwork.
struct TransactionLauncherControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "AddTransactionControl") {
            ControlWidgetButton(action: AddTransactionIntent()) {
                Label(WidgetL10n.string("Add Transaction"), icon: .plus)
            }
        }
        .displayName("Add Transaction")
        .description("Open Kualia to add a transaction.")
    }
}
