import SwiftUI

struct SettingsBankConnectionsView: View {
    @Bindable var store: AccountConnectionStore
    let accountsStore: AccountsStore
    @State private var selectedConnection: BankConnectionDestination?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                overview
                ForEach(store.connections.filter { $0.review != nil }) { bank in
                    if let review = bank.review {
                        reviewCard(bank, review: review)
                    }
                }
                connectButton
                Label(L10n.string("Bank sign-in is handled securely by Plaid."), icon: .shield)
                    .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                if store.hasLoaded {
                    connectionGroup(L10n.string("Your connections"), owned: true)
                    connectionGroup(L10n.string("Shared with you"), owned: false)
                } else {
                    connectionsPlaceholder
                }
            }
            .frame(maxWidth: 600)
            .padding(.horizontal, 22).padding(.top, 16).padding(.bottom, 32)
            .frame(maxWidth: .infinity)
        }
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .foregroundStyle(KualiaPalette.ink)
        .navigationTitle(L10n.string("Bank connections"))
        .navigationBarTitleDisplayMode(.inline)
        .kualiaScrollEdges(for: .top)
        .onChange(of: store.connectionToReviewID) { _, id in
            if let id = store.consumeConnectionToReview() {
                selectedConnection = .addAccounts(id)
            }
        }
        .navigationDestination(item: $selectedConnection) { destination in
            switch destination {
            case .details(let id):
                SettingsBankConnectionDetailView(store: store, connectionID: id) { bankID in
                    selectedConnection = .addAccounts(bankID)
                }
            case .addAccounts(let id):
                SettingsConnectionAccountCreationView(
                    accountsStore: accountsStore, connectionID: id)
            }
        }
        .modifier(BankConnectionActivityModifier(store: store))
        .accessibilityIdentifier("settings.bankConnections")
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L10n.string("Your banks, in one place."))
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            Text(
                L10n.string("See connection health and where each bank account meets your budget.")
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 28)
                .fill(AccountConnectionStyle.blue.opacity(0.08))
                .overlay(alignment: .topTrailing) {
                    Circle().fill(AccountConnectionStyle.blue.opacity(0.06))
                        .frame(width: 160, height: 160).offset(x: 60, y: -60)
                }
                .clipShape(RoundedRectangle(cornerRadius: 28))
        }
    }

    private func reviewCard(_ bank: BankConnectionSnapshot, review: BankConnectionReview)
        -> some View
    {
        let tint =
            review == .disconnected
            ? KualiaPalette.budgetNegative : KualiaPalette.budgetUnderfunded
        return Button {
            selectedConnection = .details(bank.id)
        } label: {
            HStack(alignment: .top, spacing: 14) {
                AccountBrandMark(
                    logoURL: bank.logoUrl, name: bank.displayName,
                    accountType: "banking_checking", size: 44)
                VStack(alignment: .leading, spacing: 7) {
                    Text(bank.displayName).font(.headline).fontDesign(.rounded)
                    Label(review.title, icon: review == .disconnected ? .linkPlus : .warning)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(tint)
                    Text(
                        review == .reauthorizationSoon
                            ? L10n.string("Sign in again soon to keep bank updates connected.")
                            : bank.healthDetail
                    )
                    .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .foregroundStyle(tint).padding(.top, 4)
            }
            .padding(18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .foregroundStyle(KualiaPalette.ink)
        .multilineTextAlignment(.leading)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22).strokeBorder(tint.opacity(0.18), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .disabled(store.isBusy)
        .accessibilityHint(L10n.string("View connection health and account mappings"))
        .accessibilityIdentifier("settings.bankConnections.review.\(bank.id)")
    }

    private var connectionsPlaceholder: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L10n.string("Your connections")).font(.headline).fontDesign(.rounded)
                .padding(.horizontal, 4)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    RoundedRectangle(cornerRadius: 14).frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 10) {
                        Capsule().frame(width: 140, height: 16)
                        Capsule().frame(width: 100, height: 12)
                    }
                    Spacer(minLength: 0)
                }
                .padding(18).background(AccountConnectionStyle.blue.opacity(0.09))
                VStack(alignment: .leading, spacing: 14) {
                    Capsule().frame(height: 14).frame(maxWidth: 180)
                    Capsule().frame(height: 12).frame(maxWidth: 120)
                }
                .padding(18)
            }
            .foregroundStyle(KualiaPalette.border.opacity(0.4))
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
            .clipShape(RoundedRectangle(cornerRadius: 26))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            store.errorMessage == nil
                ? L10n.string("Loading connections") : L10n.string("Connections haven't loaded yet")
        )
        .accessibilityIdentifier("settings.bankConnections.loading")
    }

    private var connectButton: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                Task { await store.connectBank() }
            } label: {
                HStack(spacing: 12) {
                    KualiaIconImage(icon: .plusCircle, size: 20).font(.title3)
                    Text(L10n.string("Connect a bank")).font(.headline).fontDesign(.rounded)
                    Spacer(minLength: 0)
                    KualiaIconImage(icon: .arrowUpRight, size: 15).font(
                        .subheadline.weight(.semibold))
                }
                .padding(20).foregroundStyle(.white)
                .background(
                    AccountConnectionStyle.buttonBlue, in: RoundedRectangle(cornerRadius: 24))
            }
            .buttonStyle(.kualiaHaptic).disabled(store.isBusy)
            .accessibilityIdentifier("settings.bankConnections.connect")
            Text(
                L10n.string("Connect securely, then choose which accounts to add to your budget.")
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4)
        }
    }

    @ViewBuilder
    private func connectionGroup(_ title: String, owned: Bool) -> some View {
        let banks = store.connections.filter { $0.isOwnedByCurrentUser == owned }
        if !banks.isEmpty {
            LazyVStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text(title).font(.headline).fontDesign(.rounded)
                    Spacer()
                    Text(banks.count, format: .number).font(.caption.weight(.semibold))
                        .foregroundStyle(KualiaPalette.mutedInk)
                }.accessibilityAddTraits(.isHeader).padding(.horizontal, 4)
                ForEach(banks) { bank in
                    Button {
                        selectedConnection = .details(bank.id)
                    } label: {
                        BankConnectionHealthCard(bank: bank)
                    }
                    .buttonStyle(.kualiaHaptic).disabled(store.isBusy)
                    .accessibilityHint(L10n.string("View connection health and account mappings"))
                    .accessibilityIdentifier("settings.bankConnections.bank.\(bank.id)")
                }
            }
        }
    }
}

private enum BankConnectionDestination: Hashable {
    case details(String)
    case addAccounts(String)
}

/// Reuse the same account picker, import options, save logic, and Peek as Add account.
/// Only this explicit selection page gets a store that can create Kualia accounts.
private struct SettingsConnectionAccountCreationView: View {
    let accountsStore: AccountsStore
    let connectionID: String
    @State private var creationStore: AccountConnectionStore?

    init(accountsStore: AccountsStore, connectionID: String) {
        self.accountsStore = accountsStore
        self.connectionID = connectionID
        _creationStore = State(initialValue: accountsStore.makeConnectionStore())
    }

    var body: some View {
        Group {
            if let creationStore {
                Group {
                    if creationStore.hasLoaded {
                        AccountConnectionView(
                            store: creationStore, accountsStore: accountsStore,
                            route: .bank(connectionID), targetAccountID: nil,
                            onClose: {}, onOpenConnection: { _ in })
                    } else {
                        SettingsCanvas {
                            ProgressView(L10n.string("Loading accounts…"))
                                .frame(maxWidth: .infinity, minHeight: 160)
                        }
                    }
                }
                .modifier(
                    BankConnectionActivityModifier(
                        store: creationStore, accountSelectionID: connectionID))
            } else {
                ContentUnavailableView(
                    L10n.string("Accounts unavailable"), icon: .bank,
                    description: Text(L10n.string("Open a workspace and try again.")))
            }
        }
        .navigationTitle(L10n.string("Choose accounts"))
        .navigationBarTitleDisplayMode(.inline)
        .task { creationStore?.start() }
        .onDisappear { creationStore?.stop() }
    }
}

private struct BankConnectionHealthCard: View {
    let bank: BankConnectionSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                AccountBrandMark(
                    logoURL: bank.logoUrl, name: bank.displayName,
                    accountType: "banking_checking", size: 48)
                VStack(alignment: .leading, spacing: 7) {
                    Text(bank.displayName).font(.headline).fontDesign(.rounded)
                    BankConnectionHealthLabel(health: bank.health)
                }.frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 15).font(.subheadline.weight(.semibold))
                    .foregroundStyle(AccountConnectionStyle.blue)
            }
            .padding(18).background(AccountConnectionStyle.blue.opacity(0.09))
            VStack(alignment: .leading, spacing: 12) {
                if !bank.isOwnedByCurrentUser {
                    Label(
                        L10n.string(
                            "Shared by \(bank.ownerName ?? L10n.string("a workspace member"))"),
                        icon: .users
                    )
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
                if bank.addedAccounts.isEmpty {
                    Text(L10n.string("No accounts linked in this workspace"))
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                } else {
                    ForEach(bank.addedAccounts.prefix(3)) { account in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            KualiaIconImage(icon: .arrowTurnRight, size: 18)
                                .foregroundStyle(AccountConnectionStyle.blue).accessibilityHidden(
                                    true)
                            Text(
                                account.linkedToBankAccount?.name
                                    ?? L10n.string("Linked Kualia account")
                            )
                            .fontWeight(.medium)
                            Spacer(minLength: 0)
                            if let mask = account.accountNumberMask, !mask.isEmpty {
                                Text("••\(mask)").foregroundStyle(KualiaPalette.mutedInk)
                            }
                        }.font(.subheadline)
                    }
                    if bank.addedAccounts.count > 3 {
                        Text(L10n.string("+\(bank.addedAccounts.count - 3) more linked accounts"))
                            .font(.caption).foregroundStyle(AccountConnectionStyle.blue)
                    }
                }
                Divider().overlay(KualiaPalette.border.opacity(0.3))
                ViewThatFits(in: .horizontal) {
                    HStack {
                        accountCount
                        Spacer(minLength: 8)
                        BankConnectionSyncLabel(bank: bank)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        accountCount
                        BankConnectionSyncLabel(bank: bank)
                    }
                }
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }.padding(18)
        }
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .foregroundStyle(KualiaPalette.ink).multilineTextAlignment(.leading)
        .contentShape(RoundedRectangle(cornerRadius: 26))
    }

    private var accountCount: some View {
        Text(L10n.string("\(bank.addedAccounts.count) of \(bank.accounts.count) linked here"))
    }
}

private struct SettingsBankConnectionDetailView: View {
    @Bindable var store: AccountConnectionStore
    let connectionID: String
    let onAddAccounts: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var confirmsDisconnect = false
    @State private var lastKnownBank: BankConnectionSnapshot?
    private var bank: BankConnectionSnapshot? {
        store.connections.first { $0.id == connectionID }
            ?? ((store.phase == .disconnecting || store.disconnectedConnectionID == connectionID)
                ? lastKnownBank : nil)
    }

    var body: some View {
        SettingsCanvas {
            if let bank {
                identity(bank)
                healthCard(bank)
                accountMappings(bank)
            } else {
                ContentUnavailableView(
                    L10n.string("Connection unavailable"), icon: .bank,
                    description: Text(
                        L10n.string(
                            "This connection may have been removed or is no longer shared with this workspace."
                        )
                    ))
            }
        }
        .navigationTitle(L10n.string("Connection details"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let bank, bank.canDisconnect {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            Task { await store.reconnectConnection(id: connectionID) }
                        } label: {
                            Label(L10n.string("Reconnect"), icon: .refresh)
                        }
                        .disabled(!bank.canReconnect)
                        Button(role: .destructive) {
                            confirmsDisconnect = true
                        } label: {
                            Label(L10n.string("Disconnect"), icon: .unlink)
                        }
                    } label: {
                        KualiaIconImage(icon: .dots, size: 18)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(store.isBusy)
                    .accessibilityLabel(L10n.string("Connection options"))
                    .accessibilityIdentifier("settings.bankConnections.options")
                }
            }
        }
        .alert(
            L10n.string("Disconnect \(bank?.displayName ?? L10n.string("this connection"))?"),
            isPresented: $confirmsDisconnect
        ) {
            Button(L10n.string("Cancel"), role: .cancel) {}
            Button(L10n.string("Disconnect"), role: .destructive) {
                Task { await store.disconnectConnection(id: connectionID) }
            }
        } message: {
            Text(
                bank?.disconnectMessage
                    ?? L10n.string("Your Kualia accounts and transaction history will be kept."))
        }
        .onAppear { lastKnownBank = bank }
        .onChange(of: store.disconnectedConnectionID) { _, id in
            if id == connectionID { dismiss() }
        }
        .kualiaScrollEdges(for: .top)
        .refreshable { store.retry() }
        .modifier(BankConnectionActivityModifier(store: store))
        .accessibilityIdentifier("settings.bankConnections.detail.\(connectionID)")
    }

    private func identity(_ bank: BankConnectionSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            AccountBrandMark(
                logoURL: bank.logoUrl, name: bank.displayName,
                accountType: "banking_checking", size: 68)
            Text(bank.displayName).font(.system(.largeTitle, design: .rounded, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                KualiaIconImage(icon: bank.isOwnedByCurrentUser ? .user : .users, size: 18)
                Text(
                    bank.isOwnedByCurrentUser
                        ? L10n.string("Connected by you")
                        : L10n.string(
                            "Shared by \(bank.ownerName ?? L10n.string("a workspace member"))")
                )
            }.font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func healthCard(_ bank: BankConnectionSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if bank.review == .reauthorizationSoon {
                Label(BankConnectionReview.reauthorizationSoon.title, icon: .warning)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KualiaPalette.budgetUnderfunded)
            } else {
                BankConnectionHealthLabel(health: bank.health)
            }
            Text(bank.healthDetail).font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 5) {
                Text(L10n.string("Last bank sync")).font(.caption).foregroundStyle(
                    KualiaPalette.mutedInk)
                if let date = bank.lastSyncDate {
                    Text(date, format: .dateTime.month(.abbreviated).day().year().hour().minute())
                        .font(.subheadline.weight(.medium))
                } else {
                    Text(L10n.string("No sync recorded yet")).font(.subheadline.weight(.medium))
                }
            }
            if !bank.isOwnedByCurrentUser {
                Label(
                    L10n.string(
                        "\(bank.ownerName ?? L10n.string("The connection owner")) manages this connection and can resolve any issues."
                    ),
                    icon: .userCheck
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            } else if bank.canRepair {
                Button {
                    Task { await store.repairConnection(id: bank.id) }
                } label: {
                    Label(L10n.string("Fix connection"), icon: .refresh)
                        .font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                        .foregroundStyle(.white)
                        .background(AccountConnectionStyle.buttonBlue, in: Capsule())
                }
                .buttonStyle(.kualiaHaptic).disabled(store.isBusy)
                .accessibilityIdentifier("settings.bankConnections.repair")
                Text(
                    L10n.string(
                        "Sign in again with your bank. Your linked Kualia accounts stay connected.")
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            } else if bank.provider == "apple_wallet" {
                Text(
                    L10n.string(
                        "Apple Wallet access is managed on the device that shared these accounts.")
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            } else if bank.health == .disconnected && bank.canManageConnection
                && bank.provider == "plaid"
            {
                Button {
                    Task { await store.connectBank() }
                } label: {
                    Label(L10n.string("Connect again"), icon: .plusCircle)
                        .font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                        .foregroundStyle(.white)
                        .background(AccountConnectionStyle.buttonBlue, in: Capsule())
                }
                .buttonStyle(.kualiaHaptic).disabled(store.isBusy)
                Text(
                    L10n.string(
                        "After sign-in, link your existing Kualia accounts from Accounts to restore their bank updates."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            } else if bank.health.needsReview && !bank.canManageConnection {
                Text(
                    L10n.string(
                        "This connection can't be changed here. Contact support if you need help restoring bank updates."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(bank.health.tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))
    }

    private func accountMappings(_ bank: BankConnectionSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 7) {
                Text(L10n.string("Where your accounts connect")).font(.title3.weight(.bold))
                    .fontDesign(.rounded)
                    .accessibilityAddTraits(.isHeader)
                Text(L10n.string("Bank accounts and their home in \(store.workspace.name)."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            ForEach(bank.accounts) { source in
                BankConnectionAccountMapping(source: source, health: bank.health)
            }
            if bank.accounts.isEmpty {
                Text(L10n.string("This bank hasn't shared any accounts yet."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            } else if bank.canUseAccounts && bank.unlinkedAccounts.contains(where: \.isSupported) {
                Button {
                    onAddAccounts(bank.id)
                } label: {
                    Label(L10n.string("Add accounts to Kualia"), icon: .plusCircle)
                        .font(.headline).frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.bordered).tint(AccountConnectionStyle.blue)
                .disabled(store.isBusy)
                .accessibilityIdentifier("settings.bankConnections.addAccounts")
            }
        }
    }
}

private struct BankConnectionAccountMapping: View {
    let source: BankConnectionAccount
    let health: BankConnectionHealth

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.string("AT YOUR BANK")).font(.caption2.weight(.semibold)).tracking(1.1)
                    .foregroundStyle(KualiaPalette.mutedInk)
                Text(source.name).font(.headline).fontDesign(.rounded)
                Text(
                    [source.typeTitle, source.accountNumberMask.map { "••\($0)" }]
                        .compactMap { $0 }.joined(separator: " · ")
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
            HStack(alignment: .top, spacing: 12) {
                KualiaIconImage(
                    icon: source.isAddedToWorkspace ? .arrowTurnRight : .minus, size: 20
                )
                .font(.title3).foregroundStyle(AccountConnectionStyle.blue)
                .frame(width: 24).padding(.top, 5).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(L10n.string("IN KUALIA")).font(.caption2.weight(.semibold)).tracking(1.1)
                        .foregroundStyle(KualiaPalette.mutedInk)
                    Text(
                        source.linkedToBankAccount?.name
                            ?? (source.isAddedToWorkspace
                                ? L10n.string("Linked account")
                                : L10n.string("Not linked in this workspace"))
                    )
                    .font(.subheadline.weight(.semibold))
                    if source.isAddedToWorkspace {
                        Label(
                            syncDescription,
                            icon: health == .connected ? .link : health.symbol
                        )
                        .font(.caption).foregroundStyle(health.tint)
                    } else {
                        Text(
                            L10n.string(
                                "No bank activity flows into this budget from this account.")
                        )
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(14).background(
                AccountConnectionStyle.blue.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
        .accessibilityElement(children: .combine)
    }

    private var syncDescription: String {
        if health != .connected { return L10n.string("Linked · \(health.title.lowercased())") }
        if source.hasCompletedInitialSync == false {
            return L10n.string("Linked · Awaiting first import")
        }
        if source.hasCompletedInitialSync == true {
            return L10n.string("Linked · First import complete")
        }
        return L10n.string("Linked to Kualia")
    }
}

private struct BankConnectionSyncLabel: View {
    let bank: BankConnectionSnapshot
    var body: some View {
        if let date = bank.lastSyncDate {
            Text("Synced \(date, style: .relative) ago")
        } else {
            Text(L10n.string("No sync recorded"))
        }
    }
}

/// Each pushed page uses the same activity surface and navigation gate. The
/// Settings store owns the operation so pushing bank details never cancels it.
private struct BankConnectionActivityModifier: ViewModifier {
    let store: AccountConnectionStore
    var accountSelectionID: String? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var peekHeight: CGFloat = 110
    @State private var confirmsLeaving = false
    @State private var lastVisibleStatus: BankConnectionStatusSnapshot?

    private var presentation: BankConnectionActivityPresentation {
        .init(phase: store.phase, hasError: store.errorMessage != nil)
    }
    private var showsPeek: Bool { accountSelectionID != nil || presentation.showsPeek }
    private var isLoadingAccounts: Bool {
        accountSelectionID != nil && !store.hasLoaded && store.errorMessage == nil
    }
    private var accountPeek: AccountConnectionPeekPresentation {
        .init(
            phase: store.phase, completionName: store.completionName,
            connection: store.connections.first { $0.id == accountSelectionID },
            isLinkingExisting: false)
    }
    private var liveStatus: BankConnectionStatusSnapshot {
        .init(
            phase: store.phase, title: store.statusTitle, detail: store.statusDetail,
            error: store.errorMessage, isLoadingAccounts: isLoadingAccounts)
    }
    private var displayedStatus: BankConnectionStatusSnapshot {
        liveStatus.retainingDuringDismissal(lastVisibleStatus, isPresented: showsPeek)
    }
    private var peekColor: Color {
        if accountSelectionID != nil && store.hasLoaded {
            return accountPeek.isPositive
                ? KualiaPalette.peekPositiveBackground : KualiaPalette.peekBackground
        }
        if displayedStatus.indicator == .error { return KualiaPalette.peekDangerBackground }
        return displayedStatus.indicator == .success
            ? KualiaPalette.peekPositiveBackground : KualiaPalette.peekBackground
    }

    func body(content: Content) -> some View {
        GeometryReader { geometry in
            PeekContainer(
                isCompactPresented: showsPeek, compactHeight: peekHeight,
                animation: reduceMotion ? nil : .smooth(duration: 0.28),
                compactAlignment: .top, bottomCornerRadius: 0,
                foregroundBottomCornerRadius: showsPeek ? 52 : 0
            ) {
                content
                    .safeAreaPadding(.top, geometry.safeAreaInsets.top)
                    .background(KualiaPalette.canvas)
            } compact: {
                Group {
                    if accountSelectionID != nil && store.hasLoaded {
                        AccountConnectionPeek(
                            store: store, presentation: accountPeek, onDone: requestLeave)
                    } else {
                        statusPeek
                    }
                }
                .background(peekColor)
                // Animate only the container's curtain, never outgoing text/icons.
                .transaction { transaction in
                    transaction.animation = nil
                    transaction.disablesAnimations = true
                }
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: { height in
                    if abs(peekHeight - height) > 0.5 { peekHeight = height }
                }
            }
            // Keep the color behind the rounded edge outside the reveal transaction.
            .background { peekColor.transaction { $0.animation = nil } }
            // Match the pushed account editor: keep the native bar and its scroll inset.
            .ignoresSafeArea(.container, edges: .top)
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .navigationBarBackButtonHidden(presentation.requiresLeaveConfirmation)
        .toolbar {
            if presentation.requiresLeaveConfirmation {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: requestLeave) {
                        Label(L10n.string("Back"), icon: .chevronLeft)
                    }
                    .accessibilityIdentifier("settings.bankConnections.back")
                }
            }
        }
        .background {
            AccountEditorBackGestureGuard(
                isDirty: presentation.requiresLeaveConfirmation, isSaving: false,
                onAttempt: requestLeave)
        }
        .alert(L10n.string("Leave this connection?"), isPresented: $confirmsLeaving) {
            Button(L10n.string("Keep going"), role: .cancel) {}
            Button(L10n.string("Leave"), role: .destructive) {
                store.cancelActivity()
                dismiss()
            }
        } message: {
            Text(presentation.leaveMessage)
        }
        .onChange(of: presentation.requiresLeaveConfirmation) { _, required in
            if !required { confirmsLeaving = false }
        }
        .onChange(of: liveStatus, initial: true) { _, status in
            if showsPeek { lastVisibleStatus = status }
        }
        .onChange(of: store.statusTitle) { _, title in
            guard showsPeek else { return }
            UIAccessibility.post(
                notification: .announcement, argument: "\(title). \(store.statusDetail)")
        }
        .sensoryFeedback(.success, trigger: store.phase == .completed) { _, completed in completed }
    }

    private var statusPeek: some View {
        HStack(spacing: 14) {
            Group {
                switch displayedStatus.indicator {
                case .progress:
                    ProgressView().tint(.white)
                case .success:
                    KualiaIconImage(icon: .checkCircle, size: 18).font(
                        .system(size: 28, weight: .medium))
                case .error:
                    KualiaIconImage(icon: .warning, size: 18).font(
                        .system(size: 28, weight: .medium))
                case .idle:
                    KualiaIconImage(icon: .link, size: 25).font(.system(size: 25, weight: .medium))
                }
            }
            .frame(width: 29, height: 29).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(displayedStatus.title)
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                Text(displayedStatus.detail)
                    .font(.caption).foregroundStyle(KualiaPalette.peekMutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            if displayedStatus.indicator == .error && !store.isBusy {
                Button(L10n.string("Retry")) { store.retry() }
                    .font(.subheadline.weight(.bold))
                    .padding(.horizontal, 16).frame(minHeight: 44)
                    .background(KualiaPalette.peekControlSurface, in: Capsule())
                    .buttonStyle(.kualiaHaptic)
            }
        }
        .foregroundStyle(KualiaPalette.peekInk)
        .padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 30)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("settings.bankConnections.peek")
    }

    private func requestLeave() {
        if presentation.requiresLeaveConfirmation {
            confirmsLeaving = true
        } else {
            dismiss()
        }
    }
}
