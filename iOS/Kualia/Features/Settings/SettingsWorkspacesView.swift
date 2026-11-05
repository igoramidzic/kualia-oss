import Combine
import SwiftUI

private enum WorkspaceSettingsDestination: Hashable {
    case merchants(workspaceID: String)
    case rules(workspaceID: String, workspaceName: String)

    var title: String {
        switch self {
        case .merchants: L10n.string("Merchants")
        case .rules: L10n.string("Rules")
        }
    }
}

enum WorkspaceSettingsSection: String, CaseIterable, Identifiable {
    case general
    case merchants
    case rules
    case bankConnections

    var id: Self { self }

    var title: String {
        switch self {
        case .general: L10n.string("Workspace settings")
        case .merchants: L10n.string("Merchants")
        case .rules: L10n.string("Rules")
        case .bankConnections: L10n.string("Bank connections")
        }
    }

    var detail: String {
        switch self {
        case .general: L10n.string("Currency, time zone, and transaction defaults")
        case .merchants: L10n.string("Your merchants, activity, and logos")
        case .rules: L10n.string("Teach this workspace how to sort transactions")
        case .bankConnections: L10n.string("Connection health and linked accounts")
        }
    }

    var icon: KualiaIcon {
        switch self {
        case .general: .workspace
        case .merchants: .shop
        case .rules: .bolt
        case .bankConnections: .bank
        }
    }

}

struct WorkspaceSettingsSheet: View {
    let settings: SettingsStore
    let session: AppSessionStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.switchSettingsWorkspace) private var switchWorkspace

    var body: some View {
        NavigationStack {
            Group {
                if let current = session.current {
                    SettingsCanvas {
                        SettingsGroup(title: current.workspace.name) {
                            ForEach(WorkspaceSettingsSection.allCases) { section in
                                NavigationLink(value: section) {
                                    SettingsRow(
                                        section == .general
                                            ? L10n.string("General") : section.title,
                                        detail: section.detail, icon: section.icon)
                                }
                                .accessibilityIdentifier("workspace-settings-\(section.rawValue)")
                                if section != WorkspaceSettingsSection.allCases.last {
                                    SettingsDivider()
                                }
                            }
                        }
                    }
                    .navigationDestination(for: WorkspaceSettingsSection.self) { section in
                        destination(section: section, current: current)
                    }
                }
            }
            .navigationTitle(L10n.string("Workspace settings"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.string("Close"), icon: .close) { dismiss() }
                        .accessibilityIdentifier("workspace-settings-close")
                }
            }
            .background(KualiaPalette.canvas.ignoresSafeArea())
            .alert(
                L10n.string("Something needs another try"),
                isPresented: Binding(
                    get: { settings.actionError != nil },
                    set: { if !$0 { settings.actionError = nil } })
            ) {
                Button("OK", role: .cancel) { settings.actionError = nil }
            } message: {
                Text(settings.actionError ?? L10n.string("Please try again."))
            }
        }
        .tint(KualiaPalette.ink)
        .presentationBackground(KualiaPalette.canvas)
    }

    @ViewBuilder
    private func destination(section: WorkspaceSettingsSection, current: HomeWorkspaceSession)
        -> some View
    {
        switch section {
        case .general:
            SettingsWorkspaceView(
                store: settings, workspaceID: current.workspace.id, session: session,
                onSwitch: switchWorkspace
            )
            .id(current.workspace.id)
        case .merchants:
            WorkspaceSettingsDestinationView(
                destination: .merchants(workspaceID: current.workspace.id),
                settings: settings, session: session,
                initialCurrency: current.workspace.currencyCode)
        case .rules:
            WorkspaceSettingsDestinationView(
                destination: .rules(
                    workspaceID: current.workspace.id,
                    workspaceName: settings.workspace(id: current.workspace.id)?.name
                        ?? current.workspace.name),
                settings: settings, session: session,
                initialCurrency: current.workspace.currencyCode)
        case .bankConnections:
            if let connections = settings.bankConnections,
                connections.workspace.id == current.workspace.id
            {
                SettingsBankConnectionsView(store: connections, accountsStore: current.accounts)
            } else {
                SettingsCanvas {
                    ProgressView(L10n.string("Loading settings…")).padding(20)
                }
            }
        }
    }
}

private struct WorkspaceSettingsDestinationView: View {
    let destination: WorkspaceSettingsDestination
    let settings: SettingsStore
    let session: AppSessionStore
    @State private var currency: String?
    @State private var loadError: String?
    @State private var attempt = 0

    init(
        destination: WorkspaceSettingsDestination, settings: SettingsStore,
        session: AppSessionStore, initialCurrency: String?
    ) {
        self.destination = destination
        self.settings = settings
        self.session = session
        _currency = State(initialValue: initialCurrency)
    }

    var body: some View {
        Group {
            if let currency {
                destinationView(currency: currency)
            } else {
                SettingsCanvas {
                    if let loadError {
                        SettingsRetry(message: loadError, retry: { attempt += 1 })
                    } else {
                        ProgressView(L10n.string("Loading settings…")).padding(20)
                    }
                }
            }
        }
        .navigationTitle(destination.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task(id: attempt) {
            guard currency == nil else { return }
            loadError = nil
            do {
                for try await workspace in settings.workspacePublisher(id: workspaceID).values {
                    guard !Task.isCancelled else { return }
                    currency = workspace.currency
                    return
                }
            } catch {
                guard !Task.isCancelled else { return }
                loadError = L10n.string("Couldn't load workspace settings. Try again.")
            }
        }
    }

    private var workspaceID: String {
        switch destination {
        case .merchants(let workspaceID), .rules(let workspaceID, _): workspaceID
        }
    }

    @ViewBuilder
    private func destinationView(currency: String) -> some View {
        switch destination {
        case .merchants(let workspaceID):
            MerchantsView(
                store: settings.makeMerchantsStore(
                    workspaceID: workspaceID, currency: currency,
                    isWorkspaceCurrent: {
                        session.current?.workspace.id == workspaceID
                    })
            )
            .id(workspaceID)
        case .rules(let workspaceID, let workspaceName):
            RulesView(
                store: settings.makeRulesStore(workspaceID: workspaceID, currency: currency),
                workspaceName: workspaceName
            )
            .id(workspaceID)
        }
    }
}

struct SettingsWorkspacesView: View {
    let store: SettingsStore
    let session: AppSessionStore
    let onSwitch: (String) -> Void
    @State private var showsCreate = false
    @State private var createdID: String?

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 10) {
                Text(L10n.string("Room for every part of life.")).font(.title.bold()).fontDesign(
                    .rounded)
                Text(L10n.string("Separate budgets for personal plans and shared life."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            Button {
                showsCreate = true
            } label: {
                HStack(spacing: 12) {
                    KualiaIconImage(icon: .plus, size: 20)
                    Text(L10n.string("Create a workspace")).font(.body.weight(.semibold))
                    Spacer()
                }.padding(20).frame(maxWidth: .infinity)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 22))
            }.buttonStyle(.kualiaHaptic).accessibilityIdentifier("settings-create-workspace")
            if let error = store.workspaceError {
                SettingsRetry(message: error, retry: store.reload)
            }
            if !store.hasLoadedWorkspaces, store.workspaceError == nil {
                ProgressView(L10n.string("Loading workspaces…"))
            }
            if store.hasLoadedWorkspaces, store.workspaceCatalog.isEmpty {
                Text(
                    L10n.string(
                        "Your first workspace starts here. Give it a name and make it yours.")
                )
                .foregroundStyle(KualiaPalette.mutedInk)
            }
            workspaceGroup(
                L10n.string("Your spaces"),
                values: store.workspaceCatalog.filter { !$0.isShared && !$0.isArchived })
            workspaceGroup(
                L10n.string("Shared with you"),
                values: store.workspaceCatalog.filter { $0.isShared && !$0.isArchived })
            workspaceGroup(
                L10n.string("Archived"), values: store.workspaceCatalog.filter(\.isArchived))
        }
        .navigationTitle(L10n.string("Workspaces")).navigationBarTitleDisplayMode(.inline)
        .sheet(
            isPresented: $showsCreate,
            onDismiss: {
                if let createdID {
                    self.createdID = nil
                    onSwitch(createdID)
                }
            },
            content: {
                SettingsCreateWorkspaceView(store: store) { id in
                    createdID = id
                    showsCreate = false
                }
            })
    }

    @ViewBuilder
    private func workspaceGroup(_ title: String, values: [SettingsWorkspaceSummary]) -> some View {
        if !values.isEmpty {
            SettingsGroup(title: title) {
                ForEach(values) { workspace in
                    if workspace.id != values.first?.id { SettingsDivider() }
                    NavigationLink {
                        SettingsWorkspaceView(
                            store: store, workspaceID: workspace.id, session: session,
                            onSwitch: onSwitch)
                    } label: {
                        SettingsRow(
                            workspace.name,
                            detail: workspace.isArchived
                                ? L10n.string("Syncing paused")
                                : (workspace.isShared
                                    ? L10n.string("Shared workspace")
                                    : L10n.string("Personal workspace")),
                            icon: workspace.isArchived ? .archive : .workspace,
                            value: workspace.id == session.current?.workspace.id
                                ? L10n.string("Current") : nil)
                    }
                }
            }
        }
    }
}

struct SettingsWorkspaceView: View {
    let store: SettingsStore
    let workspaceID: String
    let session: AppSessionStore
    let onSwitch: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var loadError: String?
    @State private var accountsError: String?
    @State private var accounts: [SettingsDefaultAccount] = []
    @State private var hasLoadedAccounts = false
    @State private var attempt = 0
    @State private var name = ""
    @State private var initializedName = false
    @State private var picker: SettingsWorkspacePicker?
    @State private var confirmsArchive = false
    @State private var confirmsDelete = false
    @State private var deletionName = ""
    @FocusState private var isEditingName: Bool

    private var summary: SettingsWorkspaceSummary? {
        store.workspaceCatalog.first { $0.id == workspaceID }
    }
    private var details: SettingsWorkspace? { store.workspace(id: workspaceID) }
    private var isArchived: Bool { summary?.isArchived == true }
    private var isCurrent: Bool { workspaceID == session.current?.workspace.id }
    private var canManage: Bool { summary?.canManage == true }
    private var requestID: String { "\(workspaceID)-\(isArchived)-\(attempt)" }

    var body: some View {
        SettingsCanvas {
            if let summary {
                VStack(alignment: .leading, spacing: 10) {
                    Text(details?.name ?? summary.name).font(.largeTitle.bold()).fontDesign(
                        .rounded)
                    Text(
                        L10n.string(
                            "Owned by \(summary.owner?.displayName ?? (canManage ? L10n.string("you") : L10n.string("the workspace owner")))"
                        )
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    if !canManage {
                        Text(L10n.string("Only the owner can edit these settings.")).font(.caption)
                            .foregroundStyle(KualiaPalette.mutedInk)
                    }
                    if isArchived {
                        Text(
                            L10n.string(
                                "Archived. Your data is kept safe, with syncing and notifications paused."
                            )
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    } else if isCurrent {
                        Text(L10n.string("Current workspace")).font(.caption.weight(.semibold))
                    } else {
                        Button(L10n.string("Switch to this workspace")) { onSwitch(workspaceID) }
                            .buttonStyle(.borderedProminent).tint(KualiaPalette.ink)
                            .foregroundStyle(KualiaPalette.surface)
                            .disabled(session.isTransitioning || store.isSaving)
                    }
                }
                if !isArchived {
                    if let loadError { SettingsRetry(message: loadError, retry: { attempt += 1 }) }
                    if let details {
                        editableSettings(details)
                    } else if loadError == nil {
                        ProgressView(L10n.string("Loading settings…"))
                    }
                }
                if canManage { lifecycle }
            } else if let error = store.workspaceError {
                SettingsRetry(message: error, retry: store.reload)
            } else if !store.hasLoadedWorkspaces {
                ProgressView(L10n.string("Loading workspaces…"))
            } else {
                Text(L10n.string("This workspace is no longer available.")).foregroundStyle(
                    KualiaPalette.mutedInk)
            }
        }
        .navigationTitle(L10n.string("Workspace settings")).navigationBarTitleDisplayMode(.inline)
        .sheet(item: $picker) { selected in
            SettingsSelectionSheet(
                title: selected.title, kind: selected,
                selectedValue: pickerValue(selected), accounts: accounts,
                accountsError: accountsError,
                isLoadingAccounts: !hasLoadedAccounts,
                onRetryAccounts: { attempt += 1 }
            ) { value in
                switch selected {
                case .currency: store.saveWorkspaceCurrency(id: workspaceID, currency: value)
                case .timezone: store.saveWorkspaceTimezone(id: workspaceID, timezone: value)
                case .account:
                    store.saveDefaultAccount(
                        id: workspaceID, accountID: value.isEmpty ? nil : value)
                }
                picker = nil
            }
        }
        .alert(
            isArchived
                ? L10n.string("Restore this workspace?") : L10n.string("Archive this workspace?"),
            isPresented: $confirmsArchive
        ) {
            Button(L10n.string("Cancel"), role: .cancel) {}
            Button(isArchived ? L10n.string("Restore workspace") : L10n.string("Archive workspace"))
            {
                Task {
                    if await store.archiveWorkspace(id: workspaceID, archived: !isArchived) {
                        dismiss()
                    }
                }
            }
        } message: {
            Text(
                isArchived
                    ? L10n.string(
                        "Syncing and notifications will resume. Your budget and transactions will be available again."
                    )
                    : L10n.string(
                        "Your data stays intact. Syncing and notifications pause until you restore the workspace."
                    )
            )
        }
        .alert(L10n.string("Delete this workspace?"), isPresented: $confirmsDelete) {
            TextField(L10n.string("Workspace name"), text: $deletionName)
            Button(L10n.string("Cancel"), role: .cancel) {}
            Button(L10n.string("Delete workspace"), role: .destructive) {
                Task { if await store.deleteWorkspace(id: workspaceID) { dismiss() } }
            }.disabled(deletionName != summary?.name)
        } message: {
            Text(
                L10n.string(
                    "This removes the workspace and access to its financial data for everyone sharing it. Type \(summary?.name ?? L10n.string("the workspace name")) to confirm."
                )
            )
        }
        .task(id: requestID) {
            guard !isArchived else { return }
            loadError = nil
            do {
                for try await value in store.workspacePublisher(id: workspaceID).values {
                    guard !Task.isCancelled else { return }
                    loadError = nil
                    if !initializedName {
                        name = value.name
                        initializedName = true
                    }
                }
            } catch {
                if !Task.isCancelled, !isArchived {
                    loadError = L10n.string("Couldn't load workspace settings. Try again.")
                }
            }
        }
        .task(id: "accounts-\(requestID)") {
            guard !isArchived else { return }
            accountsError = nil
            do {
                for try await values in store.accountsPublisher(id: workspaceID).values {
                    guard !Task.isCancelled else { return }
                    accounts = values
                    hasLoadedAccounts = true
                    accountsError = nil
                }
            } catch {
                if !Task.isCancelled {
                    accountsError = L10n.string("Couldn't load accounts. Try again.")
                }
            }
        }
        .task(id: "deadline-\(requestID)") {
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            if !isArchived, details == nil {
                loadError = L10n.string("Workspace settings are taking longer to load. Try again.")
            }
            if !isArchived, !hasLoadedAccounts {
                accountsError = L10n.string("Accounts are taking longer to load. Try again.")
            }
        }
    }

    @ViewBuilder
    private func editableSettings(_ details: SettingsWorkspace) -> some View {
        SettingsGroup(title: L10n.string("Workspace")) {
            VStack(alignment: .leading, spacing: 22) {
                if canManage {
                    SettingsTextInput(
                        L10n.string("Name"), placeholder: L10n.string("Workspace name"), text: $name
                    )
                    .focused($isEditingName).disabled(store.isSaving)
                    if name.trimmingCharacters(in: .whitespacesAndNewlines) != details.name {
                        Button(L10n.string("Save name")) {
                            store.saveWorkspaceName(id: workspaceID, name: name)
                            isEditingName = false
                        }.buttonStyle(.bordered)
                            .disabled(
                                name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    || store.isSaving)
                    }
                    SettingsChoiceField(
                        L10n.string("Currency"), value: currencyLabel(details.currency)
                    ) {
                        picker = .currency
                    }
                    SettingsChoiceField(
                        L10n.string("Time zone"),
                        value: details.timezone?.replacingOccurrences(of: "_", with: " ")
                            ?? L10n.string("Choose a time zone")
                    ) { picker = .timezone }
                } else {
                    SettingsFact(L10n.string("Name"), value: details.name)
                    SettingsFact(L10n.string("Currency"), value: currencyLabel(details.currency))
                    SettingsFact(
                        L10n.string("Time zone"),
                        value: details.timezone ?? L10n.string("Not configured"))
                }
            }.padding(20).disabled(store.isSaving)
        }
        Text(
            L10n.string(
                "The time zone keeps budget months and planned transactions consistent when you travel. Changing currency changes how amounts are displayed; it doesn't convert balances."
            )
        )
        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        SettingsGroup(title: L10n.string("Transaction defaults")) {
            VStack(alignment: .leading, spacing: 22) {
                if canManage {
                    SettingsChoiceField(
                        L10n.string("Default account"), value: defaultAccountName(details)
                    ) {
                        picker = .account
                    }
                    Toggle(
                        isOn: Binding(
                            get: { details.transactionDefaultPendingStatus ?? false },
                            set: { store.saveTransactionDefault(id: workspaceID, pending: $0) })
                    ) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(L10n.string("Start as pending")).font(.body.weight(.medium))
                            Text(L10n.string("New manual transactions wait for approval.")).font(
                                .caption
                            )
                            .foregroundStyle(
                                KualiaPalette.mutedInk)
                        }
                    }.tint(KualiaPalette.ink).accessibilityIdentifier("settings-workspace-pending")
                } else {
                    SettingsFact(L10n.string("Default account"), value: defaultAccountName(details))
                    SettingsFact(
                        L10n.string("New transactions"),
                        value: details.transactionDefaultPendingStatus == true
                            ? L10n.string("Pending") : L10n.string("Approved"))
                }
            }.padding(20).disabled(store.isSaving)
        }
        if let accountsError { SettingsRetry(message: accountsError, retry: { attempt += 1 }) }
    }

    private var lifecycle: some View {
        SettingsGroup(title: L10n.string("Workspace management")) {
            VStack(spacing: 0) {
                SettingsActionRow(
                    title: isArchived
                        ? L10n.string("Restore workspace") : L10n.string("Archive workspace"),
                    detail: isArchived
                        ? L10n.string("Resume using this budget")
                        : L10n.string("Pause syncing and keep your data"),
                    icon: .archive
                ) {
                    confirmsArchive = true
                }
                Rectangle().fill(KualiaPalette.border.opacity(0.45))
                    .frame(height: 0.5).padding(.leading, 56)
                SettingsActionRow(
                    title: L10n.string("Delete workspace"),
                    detail: L10n.string("Remove this workspace and its data"),
                    icon: .trash, destructive: true
                ) {
                    deletionName = ""
                    confirmsDelete = true
                }
            }.disabled(store.isSaving || store.writes.hasUnsavedChanges)
        }
    }

    private func pickerValue(_ picker: SettingsWorkspacePicker) -> String {
        switch picker {
        case .currency: details?.currency ?? "USD"
        case .timezone: details?.timezone ?? ""
        case .account: details?.transactionDefaultAccountId ?? ""
        }
    }
    private func defaultAccountName(_ workspace: SettingsWorkspace) -> String {
        guard let id = workspace.transactionDefaultAccountId else {
            return L10n.string("Choose each time")
        }
        return accounts.first { $0.id == id }?.name ?? L10n.string("Saved account")
    }
    private func currencyLabel(_ code: String) -> String {
        "\(code) — \(L10n.locale.localizedString(forCurrencyCode: code) ?? code)"
    }
}

enum SettingsWorkspacePicker: String, Identifiable {
    case currency, timezone, account
    var id: Self { self }
    var title: String {
        switch self {
        case .currency: L10n.string("Currency")
        case .timezone: L10n.string("Time zone")
        case .account: L10n.string("Default account")
        }
    }
}

struct SettingsSelectionSheet: View {
    let title: String
    let kind: SettingsWorkspacePicker
    let selectedValue: String
    var accounts: [SettingsDefaultAccount] = []
    var accountsError: String?
    var isLoadingAccounts = false
    var onRetryAccounts: () -> Void = {}
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var options: [(id: String, title: String)] {
        switch kind {
        case .currency:
            Locale.commonISOCurrencyCodes.map {
                ($0, "\($0) — \(L10n.locale.localizedString(forCurrencyCode: $0) ?? $0)")
            }.sorted { $0.1 < $1.1 }
        case .timezone:
            TimeZone.knownTimeZoneIdentifiers.map {
                ($0, $0.replacingOccurrences(of: "_", with: " "))
            }
        case .account:
            [("", L10n.string("Choose each time"))] + accounts.map { ($0.id, $0.name) }
        }
    }
    private var query: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var filteredOptions: [(id: String, title: String)] {
        options.filter {
            query.isEmpty || $0.title.localizedStandardContains(query)
                || (kind == .currency
                    && SettingsPickerOptions.currencySymbol($0.id).contains(query))
        }
    }
    private var popularIDs: [String] {
        kind == .currency
            ? SettingsPickerOptions.popularCurrencies : SettingsPickerOptions.popularTimezones
    }

    var body: some View {
        NavigationStack {
            List {
                if kind == .account {
                    if isLoadingAccounts, accountsError == nil {
                        ProgressView(L10n.string("Loading accounts…"))
                    }
                    if let accountsError {
                        SettingsRetry(message: accountsError, retry: onRetryAccounts)
                    }
                    if query.isEmpty { optionRow(id: "", title: L10n.string("Choose each time")) }
                    ForEach(AccountCategory.allCases) { category in
                        let members = accounts.filter {
                            $0.isEligible && AccountCategory.from($0.accountType) == category
                                && (query.isEmpty || $0.name.localizedStandardContains(query)
                                    || category.title.localizedStandardContains(query))
                        }
                        if !members.isEmpty {
                            Section(category.title) {
                                ForEach(members) { account in
                                    Button {
                                        onSelect(account.id)
                                    } label: {
                                        HStack(spacing: 12) {
                                            AccountBrandMark(
                                                logoURL: account.resolvedLogoUrl,
                                                name: account.name,
                                                accountType: account.accountType, size: 36)
                                            SettingsOptionRow(
                                                title: account.name,
                                                selected: account.id == selectedValue)
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    if query.isEmpty {
                        if kind == .timezone {
                            Section {
                                Button {
                                    onSelect(TimeZone.current.identifier)
                                } label: {
                                    SettingsOptionRow(
                                        title: L10n.string("Use this device's time zone"),
                                        detail: TimeZone.current.identifier.replacingOccurrences(
                                            of: "_", with: " "),
                                        selected: selectedValue == TimeZone.current.identifier)
                                }
                            }
                        }
                        Section(L10n.string("Popular")) {
                            ForEach(popularIDs, id: \.self) { id in
                                if let option = options.first(where: { $0.id == id }) {
                                    optionRow(id: option.id, title: option.title)
                                }
                            }
                        }
                    }
                    if !query.isEmpty && filteredOptions.isEmpty {
                        ContentUnavailableView.search(text: query)
                    }
                    Section(
                        query.isEmpty
                            ? L10n.string(
                                "All \(kind == .currency ? L10n.string("currencies") : L10n.string("time zones"))"
                            ) : L10n.string("Results")
                    ) {
                        ForEach(
                            filteredOptions.filter {
                                !query.isEmpty || !popularIDs.contains($0.id)
                            }, id: \.id
                        ) { option in
                            optionRow(id: option.id, title: option.title)
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: L10n.string("Search \(title.lowercased())"))
            .scrollDismissesKeyboard(.interactively)
            .scrollContentBackground(.hidden)
            .background(KualiaPalette.canvas.ignoresSafeArea())
            .foregroundStyle(KualiaPalette.ink)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar, action: { dismiss() })
                }
            }
        }
        .tint(KualiaPalette.ink)
    }

    private func optionRow(id: String, title: String) -> some View {
        Button {
            onSelect(id)
        } label: {
            HStack(spacing: 12) {
                if kind == .currency {
                    Text(SettingsPickerOptions.currencySymbol(id))
                        .font(.title3.weight(.semibold)).frame(minWidth: 36)
                }
                SettingsOptionRow(title: title, selected: id == selectedValue)
            }
        }
    }
}

private struct SettingsCreateWorkspaceView: View {
    let store: SettingsStore
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft = SettingsWorkspaceDraft()
    @State private var picker: SettingsWorkspacePicker?
    @State private var created: SettingsCreatedWorkspace?
    @State private var errorMessage: String?
    private var sources: [SettingsWorkspaceSummary] {
        store.workspaceCatalog.filter { !$0.isArchived }
    }

    var body: some View {
        NavigationStack {
            SettingsCanvas {
                if let created {
                    Text(L10n.string("Workspace created")).font(.title.bold()).fontDesign(.rounded)
                    if let warning = created.warning {
                        Text(warning).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    Button(L10n.string("Open workspace")) { onCreated(created.id) }.buttonStyle(
                        .borderedProminent)
                } else {
                    Text(L10n.string("A fresh space for your plans.")).font(.title.bold())
                        .fontDesign(.rounded)
                    SettingsGroup(title: L10n.string("Make it yours")) {
                        VStack(spacing: 20) {
                            SettingsTextInput(
                                L10n.string("Name"), placeholder: L10n.string("e.g. Our home"),
                                text: $draft.name)
                            SettingsChoiceField(L10n.string("Currency"), value: draft.currency) {
                                picker = .currency
                            }
                            SettingsChoiceField(
                                L10n.string("Time zone"),
                                value: draft.timezone.replacingOccurrences(of: "_", with: " ")
                            ) { picker = .timezone }
                        }.padding(20)
                    }
                    SettingsGroup(title: L10n.string("Start your categories")) {
                        Button {
                            draft.sourceWorkspaceID = nil
                        } label: {
                            SettingsOptionRow(
                                title: L10n.string("Use starter categories"),
                                detail: L10n.string(
                                    "A ready-to-personalize set for everyday budgeting"),
                                selected: draft.sourceWorkspaceID == nil)
                        }
                        ForEach(sources) { source in
                            SettingsDivider()
                            Button {
                                draft.sourceWorkspaceID = source.id
                            } label: {
                                SettingsOptionRow(
                                    title: L10n.string("Copy from \(source.name)"),
                                    detail: L10n.string(
                                        "Categories only; balances and transactions stay put"),
                                    selected: draft.sourceWorkspaceID == source.id)
                            }
                        }
                    }
                    if let errorMessage {
                        Text(errorMessage).font(.subheadline).foregroundStyle(
                            KualiaPalette.budgetNegative)
                    }
                    Button {
                        Task {
                            errorMessage = nil
                            if let result = await store.createWorkspace(draft) {
                                if result.warning == nil {
                                    onCreated(result.id)
                                } else {
                                    created = result
                                }
                            } else {
                                errorMessage = store.actionError
                                store.actionError = nil
                            }
                        }
                    } label: {
                        HStack {
                            if store.isSaving { ProgressView() }
                            Text(
                                store.isSaving
                                    ? L10n.string("Creating workspace…")
                                    : L10n.string("Create workspace"))
                        }
                        .frame(maxWidth: .infinity, minHeight: 40)
                    }.buttonStyle(.borderedProminent).tint(KualiaPalette.ink).foregroundStyle(
                        KualiaPalette.surface
                    )
                    .disabled(!draft.isValid || store.isSaving)
                }
            }
            .disabled(store.isSaving)
            .navigationTitle(L10n.string("New workspace")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar, action: { dismiss() }).disabled(
                        store.isSaving)
                }
            }
            .sheet(item: $picker) { selected in
                SettingsSelectionSheet(
                    title: selected.title, kind: selected,
                    selectedValue: selected == .currency ? draft.currency : draft.timezone
                ) { value in
                    if selected == .currency {
                        draft.currency = value
                    } else {
                        draft.timezone = value
                    }
                    picker = nil
                }
            }
        }
        .interactiveDismissDisabled(store.isSaving)
        .tint(KualiaPalette.ink)
    }
}
