import AppIntents
import SwiftUI
import UserNotifications

struct SettingsShortcutsView: View {
    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 12) {
                KualiaIconImage(icon: .transactions, size: 38)
                Text(L10n.string("Your transactions, fewer taps")).font(.title.bold())
                    .fontDesign(.rounded)
                Text(
                    L10n.string(
                        "Long-press the Kualia app icon and choose Add Transaction to open a fresh transaction."
                    )
                )
                .foregroundStyle(KualiaPalette.mutedInk)
            }
            SettingsGroup(title: L10n.string("Add Transaction")) {
                Text(
                    L10n.string(
                        "Set the amount, expense or income, merchant, account, category, date, notes, and repeat schedule. For transfers, choose Transfer and a destination account."
                    )
                )
                .padding(20)
                SettingsDivider()
                Text(
                    L10n.string(
                        "Use a fixed value, Ask Each Time, or a variable from another action. Kualia opens for review; tap Add or Schedule to save."
                    )
                )
                .padding(20)
            }
            SettingsGroup(title: L10n.string("Open Transactions")) {
                Text(
                    L10n.string(
                        "Open all transactions, items needing review, pending transactions, or transfers. Edit, categorize, approve, and delete using the usual controls."
                    )
                )
                .padding(20)
            }
            SettingsGroup(title: L10n.string("Workspace")) {
                Text(
                    L10n.string(
                        "Choices come from the last workspace opened in Kualia. Set Workspace in your shortcut to require a specific workspace; leave it empty to use the active one."
                    )
                )
                .padding(20)
            }
            Text(
                L10n.string(
                    "In Shortcuts, create a shortcut or personal automation and add a Kualia action. For example, prepare your usual coffee purchase or a monthly transfer."
                )
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            ShortcutsLink()
                .accessibilityIdentifier("settings-open-shortcuts")
        }
        .navigationTitle(L10n.string("Shortcuts"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SettingsNotificationsView: View {
    let store: SettingsStore
    @Environment(\.openURL) private var openURL

    private var isBusy: Bool { store.isSaving }
    private var enabled: Bool { store.profile?.notificationsEnabled == true }

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 12) {
                KualiaIconImage(icon: .bell, size: 38)
                    .foregroundStyle(KualiaPalette.mutedInk)
                Text(L10n.string("A nudge, on your terms.")).font(.title.bold()).fontDesign(
                    .rounded)
                Text(
                    L10n.string(
                        "Decide what you'd like to hear about. You can change your mind anytime.")
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            if let error = store.profileError { SettingsRetry(message: error, retry: store.reload) }
            SettingsGroup(title: L10n.string("On this device")) {
                Button {
                    if store.notifications.authorization == .notDetermined {
                        store.setNotificationsEnabled(true)
                    } else if let url = URL(string: UIApplication.openNotificationSettingsURLString)
                    {
                        openURL(url)
                    }
                } label: {
                    SettingsRow(
                        L10n.string("iOS notification permission"),
                        detail: store.notifications.statusLabel,
                        icon: .phone,
                        external: store.notifications.authorization != .notDetermined)
                }.disabled(isBusy || store.profile == nil)
            }
            if let error = store.notifications.registrationError {
                Text(error).font(.subheadline).foregroundStyle(KualiaPalette.budgetNegative)
            }
            if store.profile != nil {
                SettingsGroup(title: L10n.string("Your notifications")) {
                    preferenceToggle(
                        L10n.string("Allow notifications"),
                        detail: L10n.string("The main switch for Kualia alerts and reminders."),
                        value: enabled
                    ) {
                        let value = $0
                        store.setNotificationsEnabled(value)
                    }
                    .disabled(
                        !enabled && !store.notifications.isAuthorized
                            && store.notifications.authorization != .notDetermined)
                }
                SettingsGroup(title: L10n.string("What matters to you")) {
                    preferenceToggle(
                        L10n.string("New bank transactions"),
                        detail: L10n.string("Know when transactions arrive from linked accounts."),
                        value: store.preferences.newTransactionsEnabled
                    ) {
                        let value = $0
                        store.setPreference("newTransactionsEnabled", value: value)
                    }
                }
                .disabled(!enabled)
            } else if store.profileError == nil {
                ProgressView(L10n.string("Loading your preferences…"))
            }
        }
        .navigationTitle(L10n.string("Notifications")).navigationBarTitleDisplayMode(.inline)
        .task { store.notifications.refresh() }
    }

    private func preferenceToggle(
        _ title: String, detail: String, value: Bool, onChange: @escaping (Bool) -> Void
    ) -> some View {
        Toggle(isOn: Binding(get: { value }, set: onChange)) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.body.weight(.medium))
                Text(detail).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
        }.padding(20).disabled(isBusy)
    }
}

struct SettingsLanguageView: View {
    private let language = AppLanguageStore.shared

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 10) {
                Text(L10n.string("Make yourself at home.")).font(.title.bold()).fontDesign(.rounded)
                Text(L10n.string("Choose the language Kualia uses on this device."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            SettingsGroup(title: L10n.string("App language")) {
                ForEach(AppLanguage.allCases) { option in
                    if option != .system { SettingsDivider() }
                    Button {
                        language.preference = option
                    } label: {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(option.title).font(.body.weight(.medium))
                                if option == .system {
                                    Text(
                                        L10n.string(
                                            "Use your device's preferred supported language.")
                                    )
                                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                                }
                            }
                            Spacer(minLength: 8)
                            KualiaIconImage(icon: .checkCircle, size: 22)
                                .opacity(language.preference == option ? 1 : 0)
                        }
                        .multilineTextAlignment(.leading)
                        .padding(20).contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("settings-language-\(option.rawValue)")
                    .accessibilityAddTraits(language.preference == option ? .isSelected : [])
                }
            }
            Text(L10n.string("Your choice is saved and applies throughout the app."))
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        }
        .navigationTitle(L10n.string("Language")).navigationBarTitleDisplayMode(.inline)
    }
}

struct SettingsAppearanceView: View {
    @AppStorage(SettingsAppearance.defaultsKey) private var appearance = SettingsAppearance.system
        .rawValue
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 10) {
                Text(L10n.string("A different kind of mood.")).font(.title.bold()).fontDesign(
                    .rounded)
                Text(L10n.string("Choose how Kualia looks on this device."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            HStack(spacing: 10) {
                ForEach([SettingsAppearance.light, .dark, .system]) { option in
                    Button {
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                            appearance = option.rawValue
                        }
                    } label: {
                        SettingsAppearanceCard(
                            option: option,
                            isSelected: SettingsAppearance.resolve(appearance) == option)
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityLabel(L10n.string("\(option.title) appearance"))
                    .accessibilityAddTraits(
                        SettingsAppearance.resolve(appearance) == option ? .isSelected : []
                    )
                    .accessibilityIdentifier("settings-appearance-\(option.rawValue)")
                }
            }
            SettingsBudgetPreferencesSection()
        }
        .navigationTitle(L10n.string("Appearance")).navigationBarTitleDisplayMode(.inline)
    }
}

struct BudgetPreferencesSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            SettingsCanvas { SettingsBudgetPreferencesSection() }
                .navigationTitle(L10n.string("Budget preferences"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        KualiaCloseButton(placement: .toolbar) { dismiss() }
                    }
                }
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

struct SettingsBudgetPreferencesSection: View {
    @AppStorage(SettingsBudgetAppearance.showsCategoryProgressKey)
    private var showsCategoryProgress = SettingsBudgetAppearance.defaultShowsCategoryProgress
    @AppStorage(SettingsBudgetAppearance.usesCompactLayoutKey)
    private var usesCompactLayout = SettingsBudgetAppearance.defaultUsesCompactLayout
    @AppStorage(SettingsBudgetAppearance.showsCategoryStatusKey)
    private var showsCategoryStatus = SettingsBudgetAppearance.defaultShowsCategoryStatus

    var body: some View {
        VStack(spacing: 20) {
            SettingsGroup(title: L10n.string("Budget")) {
                Toggle(isOn: $usesCompactLayout) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(L10n.string("Compact budget")).font(.body.weight(.medium))
                        Text(
                            L10n.string(
                                "Use shorter, edge-to-edge rows with filled amount columns.")
                        )
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                .padding(20)
                .accessibilityIdentifier("settings-budget-compact-layout")
                Divider().padding(.horizontal, 20)
                Toggle(isOn: $showsCategoryProgress) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(L10n.string("Category progress bars")).font(.body.weight(.medium))
                        Text(
                            L10n.string(
                                "Show spent, available, and unfunded portions below each category.")
                        )
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                .padding(20)
                .accessibilityIdentifier("settings-budget-category-progress")
                Divider().padding(.horizontal, 20)
                Toggle(isOn: $showsCategoryStatus) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(L10n.string("Category status")).font(.body.weight(.medium))
                        Text(
                            L10n.string(
                                "Show funding and overspending details for each category.")
                        )
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                .padding(20)
                .accessibilityIdentifier("settings-budget-category-status")
            }
            SettingsBudgetLayoutPreview(
                isCompact: usesCompactLayout, showsProgress: showsCategoryProgress,
                showsStatus: showsCategoryStatus
            )
            // Match the budget page by extending through SettingsCanvas's side insets.
            .padding(.horizontal, -22)
        }
    }
}

/// The illustration uses real budget components so all three preferences preview accurately.
struct SettingsBudgetLayoutPreview: View {
    let isCompact: Bool
    let showsProgress: Bool
    var showsStatus = SettingsBudgetAppearance.defaultShowsCategoryStatus

    private var group: BudgetGroupModel {
        let groceries = sampleRow(
            id: "groceries", name: L10n.string("Groceries"), assigned: 30_000, available: 18_000)
        let dining = sampleRow(
            id: "dining", name: L10n.string("Dining out"), assigned: 10_000, available: 6_000,
            targetAmount: 15_000)
        let coffee = sampleRow(
            id: "coffee", name: L10n.string("Coffee"), assigned: 5_000, available: -1_000)
        let rows = isCompact ? [groceries, dining, coffee] : [groceries, dining]
        return BudgetGroupModel(
            id: "preview-food", name: L10n.string("Food"), rows: rows,
            assigned: rows.reduce(Decimal.zero) { $0 + Decimal($1.assigned) },
            available: rows.reduce(Decimal.zero) { $0 + $1.available })
    }

    var body: some View {
        let group = group
        VStack(spacing: 0) {
            BudgetCategoryGroupHeader(
                group: group, currencyCode: "USD", minorUnit: 2, isCollapsed: false,
                isCompact: isCompact)
            if isCompact { BudgetRowDivider() }
            ForEach(group.rows) { row in
                BudgetCategoryRow(
                    row: row, currencyCode: "USD", minorUnit: 2, isEditing: false,
                    calculator: nil, canEdit: true, amountColumnWidth: 96, onEdit: {},
                    canMoveMoney: true, showsProgress: showsProgress, month: 202609,
                    isCompact: isCompact, showsStatus: showsStatus)
                if row.id != group.rows.last?.id { BudgetRowDivider(isCompact: isCompact) }
            }
        }
        .modifier(BudgetGroupSurface(isCompact: isCompact))
        .padding(.horizontal, isCompact ? 0 : 12)
        .fontDesign(.rounded)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            isCompact
                ? L10n.string("Compact budget preview") : L10n.string("Standard budget preview")
        )
        .accessibilityIdentifier("settings-budget-layout-preview")
    }

    private func sampleRow(
        id: String, name: String, assigned: Int64, available: Int64, targetAmount: Int64? = nil
    ) -> BudgetCategoryRowModel {
        let targetAmount = targetAmount ?? assigned
        let remaining = max(0, targetAmount - assigned)
        let amounts = BudgetCategoryAmounts(
            assignedAmount: assigned, available: available, activity: available - assigned,
            target: .init(
                targetAmount: targetAmount, remainingToAssign: remaining,
                fundedRatio: Double(assigned) / Double(targetAmount)))
        return BudgetCategoryRowModel(
            id: "appearance-\(id)", name: name, isCreditCard: false, assigned: assigned,
            available: Decimal(available), activity: amounts.activity, isPending: false,
            targetFundingStatus: remaining > 0 ? .underfunded : .funded,
            progress: .init(
                amounts: amounts, assigned: assigned, targetKind: .setAside, isFutureMonth: false),
            funding: .init(amounts: amounts))
    }
}

struct SettingsAppearanceCard: View {
    let option: SettingsAppearance
    let isSelected: Bool

    private var icon: KualiaIcon {
        switch option {
        case .light: .sun
        case .dark: .moon
        case .system: .systemAppearance
        }
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 16)
            .fill(KualiaPalette.surface)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                VStack(spacing: 8) {
                    KualiaIconImage(icon: icon, size: 24)
                    Text(option.title)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                .padding(12)
            }
            .overlay(alignment: .topTrailing) {
                KualiaIconImage(icon: .checkCircle, size: 14)
                    .padding(8)
                    .opacity(isSelected ? 1 : 0)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(isSelected ? KualiaPalette.ink : Color.clear, lineWidth: 2)
            }
            .contentShape(RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .ignore)
    }
}

struct SettingsSupportView: View {
    @Environment(\.openURL) private var openURL
    @State private var copiedEmail = false
    @State private var mailUnavailable = false

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 16) {
                KualiaIconImage(icon: .support, size: 44)
                    .foregroundStyle(KualiaPalette.mutedInk)
                Text(L10n.string("Let's figure it out.")).font(.largeTitle.bold()).fontDesign(
                    .rounded)
                Text(
                    L10n.string(
                        "A question, a bug, or something that doesn't feel right? Get in touch.")
                )
                .font(.body).foregroundStyle(KualiaPalette.mutedInk)
            }
            SettingsGroup(title: L10n.string("Talk to us")) {
                Button {
                    guard let url = SettingsLinks.supportMail(version: SettingsLinks.version())
                    else { return }
                    openURL(url) { accepted in mailUnavailable = !accepted }
                } label: {
                    SettingsRow(
                        L10n.string("Email support"), detail: SettingsLinks.supportEmail,
                        icon: .email,
                        external: true)
                }
                SettingsDivider()
                Button {
                    UIPasteboard.general.string = SettingsLinks.supportEmail
                    copiedEmail = true
                } label: {
                    SettingsRow(
                        copiedEmail
                            ? L10n.string("Email address copied")
                            : L10n.string("Copy email address"),
                        detail: L10n.string("Use any email app you like"),
                        icon: copiedEmail ? .check : .copy)
                }
            }
            Text(
                L10n.string(
                    "Tell us what happened and what you expected. Your app version is included in the email draft."
                )
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            SettingsFooter()
        }
        .navigationTitle(L10n.string("Contact support")).navigationBarTitleDisplayMode(.inline)
        .alert(L10n.string("No email app available"), isPresented: $mailUnavailable) {
            Button(L10n.string("Copy email address")) {
                UIPasteboard.general.string = SettingsLinks.supportEmail
                copiedEmail = true
            }
            Button("OK", role: .cancel) {}
        } message: {
            Text(
                L10n.string(
                    "Send your message to \(SettingsLinks.supportEmail) from any email app."))
        }
    }
}

struct SettingsAboutView: View {
    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 16) {
                Text(L10n.string("A home for\nyour money.")).font(.largeTitle.bold()).fontDesign(
                    .rounded)
                Text(
                    L10n.string(
                        "Kualia helps you give every dollar a purpose, with room for the life you're building."
                    )
                )
                .font(.body).foregroundStyle(KualiaPalette.mutedInk)
                Text(L10n.string("Made by Igor Amidzic")).font(.headline)
            }
            SettingsGroup(title: L10n.string("The details")) {
                Link(destination: SettingsLinks.privacy) {
                    SettingsRow(L10n.string("Privacy policy"), icon: .lock, external: true)
                }
                SettingsDivider()
                Link(destination: SettingsLinks.terms) {
                    SettingsRow(L10n.string("Terms of service"), icon: .book, external: true)
                }
            }
            SettingsFooter()
        }
        .navigationTitle(L10n.string("About Kualia")).navigationBarTitleDisplayMode(.inline)
    }
}
