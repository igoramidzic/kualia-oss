import SwiftUI

struct AccountConnectionView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var store: AccountConnectionStore
    let accountsStore: AccountsStore
    let route: AccountSetupRoute
    let targetAccountID: String?
    let onClose: () -> Void
    let onOpenConnection: (String) -> Void

    private var connection: BankConnectionSnapshot? {
        guard case .bank(let id) = route else { return nil }
        return store.connections.first { $0.id == id }
    }

    private var targetAccount: AccountSnapshot? {
        accountsStore.activeAccounts.first { $0.id == targetAccountID }
    }

    private var title: String {
        if case .bank = route {
            return targetAccountID == nil
                ? L10n.string("Choose accounts") : L10n.string("Connect account")
        }
        return L10n.string("Connections")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                switch route {
                case .connections:
                    library
                case .bank:
                    if let connection { bankDetails(connection) } else { unavailableConnection }
                case .manual:
                    EmptyView()
                }
                if let error = store.errorMessage { errorNotice(error) }
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 36)
        }
        .scrollIndicators(.hidden)
        .kualiaScrollEdges(for: .top)
        .background(KualiaPalette.canvas)
        .foregroundStyle(KualiaPalette.ink)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            if route == .connections {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar, action: onClose)
                        .disabled(store.phase == .saving || store.phase == .exchanging)
                }
            }
        }
        .accessibilityIdentifier("account.connection")
    }

    private var library: some View {
        VStack(alignment: .leading, spacing: 26) {
            VStack(alignment: .leading, spacing: 16) {
                Text(
                    targetAccount.map { L10n.string("Choose a bank for \($0.name).") }
                        ?? L10n.string("Choose a bank to add accounts.")
                )
                .font(.system(.title2, design: .rounded, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await store.connectBank() }
                } label: {
                    HStack(spacing: 12) {
                        KualiaIconImage(icon: .plus, size: 18)
                        Text(
                            store.connections.isEmpty
                                ? L10n.string("Connect a bank")
                                : L10n.string("Connect another bank"))
                        Spacer(minLength: 4)
                        KualiaIconImage(icon: .chevronRight, size: 18)
                    }
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    .padding(20)
                    .foregroundStyle(.white)
                    .background(
                        AccountConnectionStyle.buttonBlue, in: RoundedRectangle(cornerRadius: 24))
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(store.isBusy)
                .accessibilityIdentifier("account.connection.connectBank")
                Text(L10n.string("Secure bank sign-in with Plaid."))
                    .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
            }

            if !store.hasLoaded {
                ProgressView(L10n.string("Loading connections…"))
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else if store.connections.isEmpty {
                Text(L10n.string("After sign-in, choose which accounts to add to Kualia."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            } else {
                let owned = store.connections.filter(\.isOwnedByCurrentUser)
                let shared = store.connections.filter { !$0.isOwnedByCurrentUser }
                if !owned.isEmpty {
                    sectionHeading(L10n.string("Already connected"))
                    ForEach(owned) { bankCard($0) }
                }
                if !shared.isEmpty {
                    sectionHeading(L10n.string("Shared connections"))
                    ForEach(shared) { bankCard($0) }
                }
            }
        }
    }

    private func bankCard(_ bank: BankConnectionSnapshot) -> some View {
        VStack(spacing: 0) {
            Button {
                onOpenConnection(bank.id)
            } label: {
                HStack(spacing: 12) {
                    AccountBrandMark(
                        logoURL: bank.logoUrl, name: bank.displayName,
                        accountType: "banking_checking", size: 46)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(bank.displayName)
                            .font(.system(.headline, design: .rounded, weight: .bold))
                        status(bank)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    KualiaIconImage(icon: .chevronRight, size: 15)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AccountConnectionStyle.blue)
                }
                .padding(18)
                .background(AccountConnectionStyle.blue.opacity(0.1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(store.isBusy)
            .accessibilityHint(L10n.string("View this bank connection and choose accounts"))
            .accessibilityIdentifier("account.connection.bank.\(bank.id)")

            VStack(spacing: 0) {
                ForEach(bank.addedAccounts) { source in
                    Button {
                        onOpenConnection(bank.id)
                    } label: {
                        accountLabel(
                            source, detail: addedDescription(source), action: L10n.string("Added")
                        )
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(store.isBusy)
                }
                if bank.addedAccounts.isEmpty {
                    Text(L10n.string("No accounts added to Kualia yet"))
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 16)
                }
                if !bank.unlinkedAccounts.isEmpty {
                    Button {
                        onOpenConnection(bank.id)
                    } label: {
                        HStack {
                            Text(L10n.string("View accounts"))
                            Spacer()
                            KualiaIconImage(icon: .arrowRight, size: 18)
                        }
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(AccountConnectionStyle.blue)
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(store.isBusy)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 6)
        }
        .background(KualiaPalette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .accessibilityIdentifier("account.connection.group.\(bank.id)")
    }

    private func bankDetails(_ bank: BankConnectionSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            bankIdentity(bank)
            Text(
                targetAccount.map { L10n.string("Choose the bank account for \($0.name).") }
                    ?? L10n.string("Add the accounts you want to track in Kualia.")
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)

            if !bank.canUseAccounts {
                Text(
                    bank.isOwnedByCurrentUser
                        ? L10n.string(
                            "This connection needs attention before you can add accounts.")
                        : L10n.string(
                            "\(bank.ownerName ?? L10n.string("The connection owner")) manages these accounts."
                        )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }

            // One stable list: adding an account changes its status, never its position.
            VStack(spacing: 12) {
                ForEach(bank.accounts) { source in
                    connectionAccount(source, connection: bank)
                }
            }
            if bank.accounts.isEmpty {
                Text(L10n.string("This bank hasn't shared any accounts yet."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }

            if targetAccountID == nil && bank.canUseAccounts
                && bank.accounts.contains(where: \.isSupported)
            {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        startDatePicker
                        Text(
                            L10n.string(
                                "New accounts import available bank activity from this date.")
                        )
                        .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    .padding(.top, 12)
                } label: {
                    Text(L10n.string("Import options")).font(
                        .system(.subheadline, weight: .semibold))
                }
                .disabled(store.isBusy)
            }
        }
        .accessibilityIdentifier("account.connection.bankDetails.\(bank.id)")
    }

    private func bankIdentity(_ bank: BankConnectionSnapshot) -> some View {
        HStack(spacing: 16) {
            AccountBrandMark(
                logoURL: bank.logoUrl, name: bank.displayName,
                accountType: "banking_checking", size: 64)
            VStack(alignment: .leading, spacing: 7) {
                Text(bank.displayName)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .accessibilityAddTraits(.isHeader)
                status(bank)
                if !bank.isOwnedByCurrentUser, let owner = bank.ownerName {
                    Text(L10n.string("Connected by \(owner)"))
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func status(_ bank: BankConnectionSnapshot) -> some View {
        Label(
            bank.statusLabel,
            icon: bank.status == "connected" ? .link : .warning
        )
        .font(.system(.caption, weight: .medium))
        .foregroundStyle(
            bank.status == "connected" ? KualiaPalette.budgetPositive : KualiaPalette.mutedInk)
    }

    private func connectionAccount(
        _ source: BankConnectionAccount, connection bank: BankConnectionSnapshot
    ) -> some View {
        let reason = unavailableReason(source, connection: bank)
        let action =
            source.isAddedToWorkspace
            ? L10n.string("Added")
            : reason == nil
                ? (targetAccountID == nil ? L10n.string("Add") : L10n.string("Link")) : nil
        return Group {
            if reason == nil {
                Button {
                    save(source)
                } label: {
                    accountLabel(source, detail: sourceDescription(source), action: action)
                        .padding(18).contentShape(Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(store.isBusy)
                .accessibilityHint(
                    targetAccountID == nil
                        ? L10n.string("Create and link this account in Kualia")
                        : L10n.string("Link to your existing account")
                )
            } else {
                accountLabel(
                    source,
                    detail: source.isAddedToWorkspace || !source.isSupported
                        ? sourceDescription(source) : reason ?? sourceDescription(source),
                    action: action
                )
                .padding(18)
            }
        }
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
        .accessibilityIdentifier("account.connection.source.\(source.id)")
    }

    private func accountLabel(
        _ source: BankConnectionAccount, detail: String, action: String?
    ) -> some View {
        HStack(spacing: 12) {
            KualiaIconImage(
                icon: AccountBrandStyle.symbol(for: source.accountType ?? "banking_checking"),
                size: 16
            )
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(
                source.isSupported ? AccountConnectionStyle.blue : KualiaPalette.mutedInk
            )
            .frame(width: 38, height: 38)
            .background(
                (source.isSupported ? AccountConnectionStyle.blue : KualiaPalette.mutedInk).opacity(
                    0.1),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(source.name).font(.system(.subheadline, weight: .semibold))
                Text(detail)
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                // Preserve this line after adding so neighboring rows never shift.
                if let balance = source.initialBalance {
                    Text(AccountMoney.string(Decimal(balance), workspace: store.workspace))
                        .font(.system(.caption, weight: .medium))
                        .foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            accountStatus(source, action: action)
                .frame(width: 96)
                .frame(minHeight: 44)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func accountStatus(_ source: BankConnectionAccount, action: String?) -> some View {
        if store.savingSourceID == source.id {
            ProgressView().accessibilityLabel(L10n.string("Adding account"))
        } else if source.isAddedToWorkspace {
            Label(L10n.string("Added"), icon: .checkCircle)
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(KualiaPalette.budgetPositive)
                .accessibilityIdentifier("account.connection.added.\(source.id)")
        } else if !source.isSupported {
            Text(L10n.string("Not supported"))
                .font(.system(.caption2, weight: .semibold))
                .foregroundStyle(KualiaPalette.mutedInk)
                .padding(.horizontal, 8).padding(.vertical, 7)
                .background(KualiaPalette.border.opacity(0.28), in: Capsule())
                .accessibilityLabel(L10n.string("This account type isn't supported by Kualia yet"))
                .accessibilityIdentifier("account.connection.unsupported.\(source.id)")
        } else if let action {
            Label(action, icon: .plusCircle)
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(AccountConnectionStyle.blue)
        } else {
            Text(L10n.string("Unavailable"))
                .font(.system(.caption2, weight: .medium))
                .foregroundStyle(KualiaPalette.mutedInk)
        }
    }

    private var unavailableConnection: some View {
        ContentUnavailableView(
            L10n.string("Connection unavailable"), icon: .bank,
            description: Text(L10n.string("Go back to choose another connection.")))
    }

    private func errorNotice(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TransactionEditorNotice(message: error, isError: true)
            Button(
                store.failedDuringBankSignIn
                    ? L10n.string("Try bank sign-in again") : L10n.string("Refresh connections")
            ) {
                if store.failedDuringBankSignIn {
                    Task { await store.connectBank() }
                } else {
                    store.retry()
                }
            }
            .font(.system(.subheadline, weight: .semibold))
            .frame(minHeight: 44)
            .buttonStyle(.kualiaHaptic)
            .disabled(store.isBusy)
        }
    }

    private func sectionHeading(_ title: String) -> some View {
        Text(title).font(.system(.headline, design: .rounded, weight: .bold))
            .accessibilityAddTraits(.isHeader)
    }

    private func sourceDescription(_ source: BankConnectionAccount) -> String {
        source.accountNumberMask.map { L10n.string("\(source.typeTitle) · Ending in \($0)") }
            ?? source.typeTitle
    }

    private func addedDescription(_ source: BankConnectionAccount) -> String {
        source.linkedToBankAccount.map { L10n.string("Linked to \($0.name)") }
            ?? L10n.string("Added to Kualia")
    }

    private func unavailableReason(
        _ source: BankConnectionAccount, connection bank: BankConnectionSnapshot
    ) -> String? {
        if source.isAddedToWorkspace { return addedDescription(source) }
        if !bank.isOwnedByCurrentUser || !bank.canManageConnection {
            return L10n.string("Managed by the connection owner")
        }
        if !bank.canUseAccounts { return L10n.string("Connection needs attention") }
        if !source.isSupported { return L10n.string("Account type not supported yet") }
        if let targetAccountID {
            guard let targetAccount, targetAccount.id == targetAccountID,
                source.canLink(to: targetAccount), store.completionName == nil
            else { return L10n.string("Choose a matching manual account") }
        } else if source.initialBalance == nil {
            return L10n.string("Waiting for a bank balance")
        }
        return nil
    }

    private var latestStartDate: Date {
        TransactionEditorDate.date(
            from: TransactionEditorDate.today(workspace: store.workspace),
            workspace: store.workspace) ?? Date()
    }

    private var startDate: Binding<Date> {
        Binding(
            get: {
                TransactionEditorDate.date(
                    from: store.initialBalanceDate, workspace: store.workspace) ?? latestStartDate
            },
            set: {
                store.initialBalanceDate = TransactionEditorDate.key(
                    from: $0, workspace: store.workspace)
            })
    }

    private var startDatePicker: some View {
        DatePicker(
            L10n.string("Import from"), selection: startDate, in: ...latestStartDate,
            displayedComponents: .date
        )
        .font(.subheadline)
        .environment(\.calendar, TransactionEditorDate.calendar(workspace: store.workspace))
        .environment(
            \.timeZone, TransactionEditorDate.calendar(workspace: store.workspace).timeZone
        )
        .accessibilityIdentifier("account.connection.startDate")
    }

    private func save(_ source: BankConnectionAccount) {
        Task { _ = await store.save(source: source, existingAccountID: targetAccountID) }
    }
}

struct AccountConnectionPeek: View {
    let store: AccountConnectionStore
    let presentation: AccountConnectionPeekPresentation
    let onDone: () -> Void

    private var title: String {
        store.phase == .idle ? presentation.idleTitle : store.statusTitle
    }

    private var detail: String {
        store.phase == .idle ? presentation.idleDetail : store.statusDetail
    }

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(title)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Group {
                        if presentation.showsProgress {
                            ProgressView().controlSize(.mini).tint(.white)
                        } else if presentation.isPositive {
                            AccountConnectionCompletionMark()
                        } else {
                            KualiaIconImage(icon: .checklist, size: 15).font(.subheadline)
                        }
                    }
                    .accessibilityHidden(true)
                }
                Text(detail)
                    .font(.caption).foregroundStyle(KualiaPalette.peekMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title). \(detail)")

            Button(L10n.string("Done"), action: onDone)
                .font(.system(.subheadline, weight: .bold))
                .foregroundStyle(KualiaPalette.peekBackground)
                .padding(.horizontal, 17).frame(minHeight: 46)
                .background(.white.opacity(presentation.canFinish ? 1 : 0.5), in: Capsule())
                .buttonStyle(.kualiaHaptic)
                .disabled(!presentation.canFinish)
                .accessibilityIdentifier("account.connection.done")
        }
        .foregroundStyle(KualiaPalette.peekInk)
        .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 22)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("account.connection.peek")
    }
}

private struct AccountConnectionCompletionMark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hasAppeared = false

    var body: some View {
        KualiaIconImage(icon: .checkCircle, size: 15)
            .font(.subheadline.weight(.medium))
            .scaleEffect(hasAppeared || reduceMotion ? 1 : 0.55)
            .opacity(hasAppeared || reduceMotion ? 1 : 0)
            .onAppear {
                withAnimation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.58)) {
                    hasAppeared = true
                }
            }
    }
}

struct BankConnectionHealthLabel: View {
    let health: BankConnectionHealth
    var title: String? = nil

    var body: some View {
        Label(title ?? health.title, icon: health.symbol)
            .font(.caption.weight(.semibold)).foregroundStyle(health.tint)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(health.tint.opacity(0.09), in: Capsule())
            .fixedSize(horizontal: false, vertical: true)
    }
}

extension BankConnectionHealth {
    var tint: Color {
        switch self {
        case .connected: KualiaPalette.budgetPositive
        case .needsAttention, .disconnected: KualiaPalette.budgetUnderfunded
        case .pending: AccountConnectionStyle.blue
        case .unknown: KualiaPalette.mutedInk
        }
    }
}

enum AccountConnectionStyle {
    static let blue = Color(
        uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.44, green: 0.70, blue: 1, alpha: 1)
                : UIColor(red: 0.12, green: 0.38, blue: 0.75, alpha: 1)
        })
    static let buttonBlue = Color(red: 0.12, green: 0.34, blue: 0.70)
}

struct AccountConnectionSection: View {
    @Environment(\.scenePhase) private var scenePhase
    let store: AccountsStore
    let account: AccountSnapshot
    @State private var connectionFlowStore: AccountConnectionStore?
    @State private var connectionDetailsStore: AccountConnectionStore?
    @State private var confirmsDisconnect = false
    @State private var connectionActionError: String?

    private var accountID: String { account.id }
    private var currentAccount: AccountSnapshot { store.account(id: accountID) ?? account }

    var body: some View {
        connectionDetails(currentAccount)
            .onAppear { prepareConnectionDetails() }
            .onDisappear { connectionDetailsStore?.stop() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    connectionDetailsStore?.start()
                } else {
                    connectionDetailsStore?.stop()
                }
            }
            .onChange(of: currentAccount.isLinked) { _, isLinked in
                connectionDetailsStore?.acknowledgeAccountState(id: accountID, isLinked: isLinked)
            }
            .sheet(
                isPresented: Binding(
                    get: { connectionFlowStore != nil },
                    set: { if !$0 { connectionFlowStore = nil } })
            ) {
                if let connectionFlowStore {
                    AccountSetupView(
                        store: store, connectionStore: connectionFlowStore,
                        targetAccountID: accountID)
                }
            }
            .alert(
                L10n.string("Disconnect \(currentAccount.name)?"),
                isPresented: $confirmsDisconnect
            ) {
                Button(L10n.string("Cancel"), role: .cancel) {}
                Button(L10n.string("Disconnect"), role: .destructive) {
                    disconnectAccount()
                }
            } message: {
                Text(L10n.string("Stopping bank updates while keeping your accounts and history."))
            }
            .alert(
                L10n.string("Account couldn't be updated"),
                isPresented: Binding(
                    get: { connectionActionError != nil },
                    set: { if !$0 { connectionActionError = nil } })
            ) {
                Button(L10n.string("OK"), role: .cancel) { connectionActionError = nil }
            } message: {
                Text(connectionActionError ?? L10n.string("Please try again."))
            }
    }

    private func connectionDetails(_ account: AccountSnapshot) -> some View {
        Group {
            if account.isLinked,
                connectionDetailsStore?.disconnectedAccountID != account.id
            {
                if let details = connectionDetailsStore?.connectionDetails(for: account.id) {
                    connectedAccountCard(account, details: details)
                } else {
                    connectedAccountPlaceholder(account)
                }
            } else {
                connectionInvitationCard(account)
            }
        }
        .accessibilityIdentifier("accounts.connectionCard")
    }

    private func connectedAccountCard(
        _ account: AccountSnapshot, details: BankAccountConnectionDetails
    ) -> some View {
        let bank = details.connection
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                AccountBrandMark(
                    logoURL: bank.logoUrl, name: bank.displayName,
                    accountType: account.accountType, size: 32)
                Text(bank.displayName)
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                BankConnectionHealthLabel(
                    health: bank.health,
                    title: bank.health == .connected ? L10n.string("Healthy") : nil)
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L10n.string("Last bank sync"))
                        .font(.caption2).foregroundStyle(KualiaPalette.mutedInk)
                    if let date = bank.lastSyncDate {
                        Text(date, format: .dateTime.month(.abbreviated).day().hour().minute())
                    } else {
                        Text(L10n.string("No sync recorded yet"))
                    }
                }
                .font(.caption)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                Button(role: .destructive) {
                    confirmsDisconnect = true
                } label: {
                    HStack(spacing: 9) {
                        if connectionDetailsStore?.disconnectingAccountID == account.id {
                            ProgressView().controlSize(.small).tint(.red)
                        } else {
                            KualiaIconImage(icon: .unlink, size: 17)
                        }
                        Text(L10n.string("Disconnect"))
                            .font(.system(.subheadline, weight: .semibold))
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(connectionDetailsStore?.isBusy != false)
                .accessibilityHint(
                    L10n.string("Stopping bank updates while keeping your accounts and history.")
                )
                .accessibilityIdentifier("accounts.disconnectConnection")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            connectionCardSurface(cornerRadius: 20, accent: bank.health.tint)
        }
    }

    private func connectedAccountPlaceholder(_ account: AccountSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                AccountBrandMark(
                    logoURL: account.institutionLogoUrl,
                    name: account.institutionName ?? account.name,
                    accountType: account.accountType, size: 32)
                VStack(alignment: .leading, spacing: 5) {
                    Text(account.institutionName ?? L10n.string("Connected account"))
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                    Text(
                        connectionDetailsStore?.errorMessage == nil
                            ? L10n.string("Loading connections…")
                            : L10n.string("Status unavailable")
                    )
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
                Spacer(minLength: 0)
                if connectionDetailsStore?.errorMessage == nil {
                    ProgressView().controlSize(.small)
                }
            }
            if let error = connectionDetailsStore?.errorMessage {
                Text(error).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                Button(L10n.string("Refresh connections")) { connectionDetailsStore?.retry() }
                    .font(.system(.subheadline, weight: .semibold))
                    .frame(minHeight: 44)
                    .buttonStyle(.kualiaHaptic)
            }
            Divider().overlay(KualiaPalette.border.opacity(0.35))
            Button(role: .destructive) {
                confirmsDisconnect = true
            } label: {
                Label(L10n.string("Disconnect"), icon: .unlink).frame(minHeight: 44)
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(connectionDetailsStore?.isBusy != false)
            .accessibilityIdentifier("accounts.disconnectConnection")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { connectionCardSurface(cornerRadius: 20) }
    }

    private func connectionInvitationCard(_ account: AccountSnapshot) -> some View {
        HStack(spacing: 12) {
            KualiaIconImage(icon: .linkPlus, size: 21)
                .font(.system(size: 21, weight: .medium))
                .foregroundStyle(AccountConnectionStyle.blue)
                .frame(width: 44, height: 44)
                .background(
                    AccountConnectionStyle.blue.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: 14))
            Text(L10n.string("Let your bank bring the updates"))
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(KualiaPalette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            if !account.isClosed && !account.isDeleted {
                Button {
                    connectionFlowStore = store.makeConnectionStore(purpose: .addAccounts)
                } label: {
                    Text(L10n.string("Connect"))
                        .font(.system(.subheadline, weight: .bold))
                        .padding(.horizontal, 15)
                        .frame(minHeight: 44)
                        .foregroundStyle(AccountConnectionStyle.blue)
                        .background(AccountConnectionStyle.blue.opacity(0.11), in: Capsule())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityHint(L10n.string("Link to your existing account"))
                .accessibilityIdentifier("accounts.connectExisting")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { connectionCardSurface(cornerRadius: 22) }
    }

    private func connectionCardSurface(cornerRadius: CGFloat, accent: Color? = nil) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return ZStack {
            shape
                .fill(KualiaPalette.surface)
                .shadow(color: .black.opacity(0.12), radius: 14, y: 7)
            if let accent {
                shape
                    .fill(KualiaPalette.surface)
                    .overlay(alignment: .topTrailing) {
                        Circle().fill(accent.opacity(0.14))
                            .frame(width: 150, height: 150).offset(x: 58, y: -70)
                    }
                    .clipShape(shape)
            }
            shape.strokeBorder(KualiaPalette.border.opacity(0.62), lineWidth: 0.75)
        }
    }

    private func prepareConnectionDetails() {
        if connectionDetailsStore == nil {
            connectionDetailsStore = store.makeConnectionStore(purpose: .accountDetails)
        }
        connectionDetailsStore?.start()
    }

    private func disconnectAccount() {
        guard let connectionDetailsStore else { return }
        Task {
            if !(await connectionDetailsStore.disconnectAccount(id: accountID)) {
                connectionActionError =
                    connectionDetailsStore.errorMessage ?? L10n.string("Please try again.")
            }
        }
    }

}
