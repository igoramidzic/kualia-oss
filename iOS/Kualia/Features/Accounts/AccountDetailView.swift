import SwiftUI

struct AccountDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(TransactionFeedPreferences.showsReconciledTransactionsKey)
    private var showsReconciledTransactions = true
    let store: AccountsStore
    let accountID: String
    let onAccountChanged: (TransactionMutationReceipt) -> Void
    @State private var scrollState = AccountDetailScrollState()
    @State private var feed: TransactionFeedStore?
    @State private var showsEdit = false
    @State private var closesAfterEditing = false
    @State private var editor: TransactionEditorStore?
    @State private var categoryEditor: TransactionEditorStore?
    @State private var savedReceipt: TransactionMutationReceipt?
    @State private var activeSwipeRowID: String?
    @State private var listWidth: CGFloat = 0
    @State private var reconciliation: AccountReconciliationStore?

    init(
        store: AccountsStore, accountID: String,
        onAccountChanged: @escaping (TransactionMutationReceipt) -> Void = { _ in }
    ) {
        self.store = store
        self.accountID = accountID
        self.onAccountChanged = onAccountChanged
        _feed = State(initialValue: store.makeTransactionStore(accountID: accountID))
    }

    private var account: AccountSnapshot? { store.accounts.first { $0.id == accountID } }

    private var page: some View {
        List {
            if let account {
                VStack(spacing: 30) {
                    balanceDetails(account)
                    if let notes = account.notes, !notes.isEmpty {
                        Text(notes).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 10)
                .padding(.bottom, 30)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                transactions(account)

            } else {
                AccountMessage(
                    title: L10n.string("Account unavailable"),
                    message: L10n.string("This account may have been removed.")
                )
                .padding(24)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
        }
        .modifier(TransactionFeedListStyle())
        .onGeometryChange(for: CGFloat.self) {
            $0.size.width
        } action: {
            listWidth = $0
        }
        .onScrollPhaseChange { _, phase in
            if phase == .interacting || phase == .decelerating { activeSwipeRowID = nil }
        }
        .background {
            AccountDetailBackground(account: account, scrollState: scrollState)
                .ignoresSafeArea()
        }
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            max(0, geometry.contentOffset.y + geometry.contentInsets.top)
        } action: { _, offset in
            scrollState.updateOffset(offset)
        }
        .scrollIndicators(.hidden)
    }

    var body: some View {
        GeometryReader { geometry in
            page
                .safeAreaPadding(.top, geometry.safeAreaInsets.top)
                .modifier(TransactionActionFeedback(store: feed))
                // The peek clips its foreground. Extend that foreground behind
                // the native bar while keeping the content below its controls.
                .ignoresSafeArea(.container, edges: .top)
        }
        .navigationTitle(account?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(.automatic, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                if let account {
                    toolbarIdentity(account)
                }
            }
            ToolbarItem(placement: .topBarLeading) {
                KualiaCloseButton(placement: .toolbar) { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if let account {
                    Menu {
                        Button(L10n.string("Edit account"), icon: .pencil) { showsEdit = true }
                            .accessibilityIdentifier("accounts.editAccount")
                        if !account.isClosed {
                            Button(L10n.string("Reconcile account"), icon: .checkCircle) {
                                reconciliation = store.makeReconciliationStore(
                                    accountID: account.id)
                            }
                            .accessibilityIdentifier("accounts.reconcileAccount")
                        }
                        Button(
                            TransactionFeedPreferences.visibilityActionTitle(
                                showsReconciledTransactions: showsReconciledTransactions),
                            icon: .filter
                        ) {
                            showsReconciledTransactions.toggle()
                        }
                        .accessibilityIdentifier("accounts.toggleReconciledTransactions")
                    } label: {
                        Label(L10n.string("Manage account"), icon: .dots)
                            .labelStyle(.iconOnly)
                    }
                    .tint(KualiaPalette.ink)
                    .disabled(store.isSaving)
                    .accessibilityIdentifier("accounts.actions")
                }
            }
        }
        .onAppear {
            feed?.start()
        }
        .onChange(of: showsReconciledTransactions, initial: true) { _, showsReconciled in
            activeSwipeRowID = nil
            feed?.setShowsReconciledTransactions(showsReconciled)
        }
        .onDisappear {
            feed?.stop()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                feed?.start()
            } else {
                feed?.stop()
            }
        }
        .sheet(
            isPresented: $showsEdit,
            onDismiss: {
                store.actionErrorMessage = nil
                if closesAfterEditing { dismiss() }
            }
        ) {
            if let account {
                AccountEditorView(
                    store: store, account: account,
                    onAccountChanged: { receipt in
                        onAccountChanged(receipt)
                        closesAfterEditing = true
                    })
            }
        }
        .sheet(
            isPresented: Binding(
                get: { reconciliation != nil },
                set: {
                    if !$0 {
                        reconciliation = nil
                    }
                })
        ) {
            if let reconciliation {
                AccountReconciliationView(store: reconciliation)
            }
        }
        .sheet(
            isPresented: Binding(get: { editor != nil }, set: { if !$0 { editor = nil } }),
            onDismiss: {
                if let savedReceipt { feed?.publishReceipt(savedReceipt) }
                savedReceipt = nil
            }
        ) {
            if let editor { TransactionEditorView(store: editor) { savedReceipt = $0 } }
        }
        .sheet(
            isPresented: Binding(
                get: { categoryEditor != nil }, set: { if !$0 { categoryEditor = nil } })
        ) {
            if let categoryEditor, let feed {
                TransactionFeedCategorySheet(store: categoryEditor) { id, declinesTransfer in
                    feed.startCategorizing(
                        editor: categoryEditor, categoryID: id,
                        declinesTransfer: declinesTransfer)
                }
            }
        }
        .alert(
            L10n.string("Account couldn't be updated"),
            isPresented: Binding(
                get: { !showsEdit && store.actionErrorMessage != nil },
                set: { if !$0 { store.actionErrorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { store.actionErrorMessage = nil }
        } message: {
            Text(store.actionErrorMessage ?? L10n.string("Please try again."))
        }
        .accessibilityIdentifier("accounts.detail")
    }

    private func toolbarIdentity(_ account: AccountSnapshot) -> some View {
        HStack(spacing: 8) {
            AccountBrandMark(
                logoURL: account.resolvedLogoUrl, name: account.name,
                accountType: account.accountType, size: 28
            )
            .accessibilityHidden(true)
            Text(account.name)
                .font(.headline)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(KualiaPalette.ink)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(account.name)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("accounts.detailToolbarIdentity")
    }

    private func balanceDetails(_ account: AccountSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            AccountBalanceChart(
                points: store.balanceHistory(accountIDs: [account.id]),
                currentBalance: Decimal(account.currentBalance),
                workspace: store.workspace,
                isLoading: store.isLoadingHistory,
                error: store.historyErrorMessage,
                onRetry: store.retry
            )
            VStack(spacing: 8) {
                balanceRow(
                    L10n.string("Pending"), amount: Decimal(account.pendingBalance ?? 0),
                    identifier: "accounts.pendingBalance")
                balanceRow(
                    L10n.string("Cleared"), amount: account.resolvedClearedBalance,
                    identifier: "accounts.clearedBalance")
            }
            .padding(16)
            .background(
                KualiaPalette.surface,
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(KualiaPalette.border.opacity(0.4), lineWidth: 0.5)
                    .allowsHitTesting(false)
            }
            if account.isClosed {
                Label(L10n.string("Closed"), icon: .archive)
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    private func balanceRow(
        _ title: String, amount: Decimal, identifier: String
    ) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                Text(title).fixedSize()
                Spacer(minLength: 0)
                Text(AccountMoney.string(amount, workspace: store.workspace)).fixedSize()
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                Text(AccountMoney.string(amount, workspace: store.workspace))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.subheadline)
        .foregroundStyle(KualiaPalette.mutedInk)
        .monospacedDigit()
        .contentTransition(.numericText())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(AccountMoney.string(amount, workspace: store.workspace))
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder
    private func transactions(_ account: AccountSnapshot) -> some View {
        HStack {
            Text(L10n.string("Activity"))
                .font(.system(.title3, design: .rounded, weight: .bold))
            Spacer()
            if !account.isClosed {
                Button(action: createTransaction) {
                    KualiaIconImage(icon: .plus, size: 17)
                        .frame(width: 44, height: 44)
                        .background(KualiaPalette.surface, in: Circle())
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityLabel(L10n.string("Add transaction to \(account.name)"))
            }
        }
        .foregroundStyle(KualiaPalette.ink)
        .listRowInsets(EdgeInsets(top: 0, leading: 24, bottom: 18, trailing: 24))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        if let feed {
            if feed.hasLoaded, feed.sections.isEmpty, feed.errorMessage == nil, !feed.hasMore,
                !feed.hasActiveFilters
            {
                AccountMessage(
                    title: L10n.string("A clean start"),
                    message: L10n.string("Transactions added to this account will appear here.")
                )
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
            TransactionFeedRows(
                sections: feed.sections, workspace: store.workspace, listWidth: listWidth,
                activeSwipeRowID: $activeSwipeRowID,
                onEdit: { editor = feed.makeEditor(for: $0.id) },
                onAction: { action, entry in
                    if action == .categorize {
                        categoryEditor = feed.makeEditor(for: entry.id)
                    } else {
                        await feed.perform(action, on: entry)
                        if let pending = feed.transferReviewEditor {
                            editor = pending
                            feed.transferReviewEditor = nil
                        }
                    }
                },
                onAppear: { feed.loadMoreIfNeeded(after: $0.id) })
            TransactionFeedFooter(
                isLoadingMore: (!feed.hasLoaded && feed.errorMessage == nil) || feed.isLoadingMore,
                errorMessage: feed.errorMessage, onRetry: feed.retry,
                canLoadMore: feed.canLoadMoreFromFooter,
                onLoadMore: { feed.loadMoreIfNeeded() },
                showsReconciledTransactionsPrompt: feed.showsReconciledTransactionsPrompt,
                onShowReconciled: {
                    showsReconciledTransactions = true
                    feed.setShowsReconciledTransactions(true)
                },
                isActive: scenePhase == .active
            )
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
        }
    }

    private func createTransaction() {
        guard let newEditor = feed?.makeCreationEditor() else { return }
        newEditor.preselectAccount(accountID)
        editor = newEditor
    }

}

/// Scroll positions invalidate only the backdrop; the toolbar identity is always visible.
@MainActor
@Observable
final class AccountDetailScrollState {
    private(set) var backgroundOffset: CGFloat = 0

    func updateOffset(_ value: CGFloat) {
        let nextBackgroundOffset = min(max(0, value), AccountBrandHalo.height)
        if backgroundOffset != nextBackgroundOffset { backgroundOffset = nextBackgroundOffset }
    }
}

private struct AccountDetailBackground: View {
    let account: AccountSnapshot?
    let scrollState: AccountDetailScrollState

    var body: some View {
        ZStack(alignment: .top) {
            KualiaPalette.canvas
            if let account {
                AccountBrandHalo(
                    logoURL: account.resolvedLogoUrl,
                    primaryColor: account.logoUrl == nil ? account.institutionPrimaryColor : nil,
                    accountType: account.accountType
                )
                .offset(y: -scrollState.backgroundOffset)
            }
        }
    }
}
