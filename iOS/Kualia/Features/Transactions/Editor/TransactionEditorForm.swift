import SwiftUI

private enum TransactionEditorDestination: String, Identifiable {
    case merchant, category, account, transferAccount, date, planned, imported, bankMatch
    var id: String { rawValue }
}

enum TransactionEditorInteraction {
    case inlineControl
    case destination
    case keyboard

    var takesOverAmountInput: Bool {
        switch self {
        case .inlineControl: false
        case .destination, .keyboard: true
        }
    }
}

struct TransactionEditorForm: View {
    @Bindable var store: TransactionEditorStore
    @Binding var draft: TransactionEditorDraft
    let onInteraction: (TransactionEditorInteraction) -> Void
    var onImportLinkSaved: () -> Void = {}
    @State private var destination: TransactionEditorDestination?
    @State private var showsMoreDetails = false
    @FocusState private var isNotesFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if store.supportsTransferToggle {
                TransactionEditorGroup {
                    Toggle(
                        isOn: Binding(
                            get: { draft.isTransfer },
                            set: {
                                onInteraction(.inlineControl)
                                store.setTransfer($0)
                            }
                        )
                    ) {
                        Label(L10n.string("Transfer between accounts"), icon: .transfer)
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    }
                    .padding(18)
                    .accessibilityIdentifier("transaction.isTransfer")
                }
            }
            TransactionEditorGroup {
                if isRegular {
                    TransactionEditorField(
                        title: L10n.string("Merchant"), value: merchantName, symbol: .shop,
                        placeholder: draft.merchantID == nil && draft.pendingMerchantName == nil
                            && !draft.useOriginalStatement,
                        logoURL: merchantLogoURL, circularIcon: true,
                        action: { present(.merchant) }
                    )
                    TransactionEditorDivider()
                } else if !draft.isTransfer {
                    TransactionEditorField(
                        title: L10n.string("Transaction"),
                        value: store.detail?.type == .startingBalance
                            ? L10n.string("Starting balance") : L10n.string("Balance adjustment"),
                        symbol: .equals
                    )
                    TransactionEditorDivider()
                }

                if store.categoryEditingAvailable {
                    TransactionEditorField(
                        title: draft.allocations.count > 1
                            ? L10n.string("Categories") : L10n.string("Category"),
                        value: categorySummary,
                        symbol: draft.allocations.count > 1 ? .split : .category,
                        placeholder: store.needsCategorySelection, circularIcon: true,
                        action: { present(.category) }
                    )
                    TransactionEditorDivider()
                }

                if draft.isTransfer {
                    transferAccountField(isFrom: true)
                    TransactionEditorDivider()
                    transferAccountField(isFrom: false)
                } else {
                    TransactionEditorField(
                        title: L10n.string("Account"), value: accountName(draft.accountID),
                        symbol: .bank,
                        placeholder: draft.accountID.isEmpty,
                        logoURL: accountLogoURL(draft.accountID), circularIcon: true,
                        action: { present(.account) })
                }

            }

            TransactionScheduleCard(
                date: dateTitle, recurrence: draft.recurrence, isPlanned: store.isPlanned,
                entryMode: draft.entryMode, summary: store.scheduleSummary,
                action: { present(.date) })

            if store.canLinkPlannedTransaction {
                TransactionEditorGroup {
                    if let planned = store.choices.plannedTransactions.first(where: {
                        $0.id == draft.scheduledTransactionID
                    }) {
                        Button {
                            present(.planned)
                        } label: {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Label(L10n.string("Planned transaction"), icon: .link)
                                        .font(.caption.weight(.medium))
                                    Spacer()
                                    KualiaIconImage(icon: .chevronRight, size: 11)
                                }
                                .foregroundStyle(KualiaPalette.mutedInk)
                                TransactionPlannedLinkSummary(
                                    details: .init(
                                        plan: planned, choices: store.choices,
                                        workspace: store.workspace,
                                        occurrenceDate: draft.scheduledOccurrenceDate))
                            }
                            .padding(18)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.kualiaHaptic)
                        .accessibilityHint(L10n.string("Change planned transaction"))
                    } else {
                        TransactionEditorField(
                            title: L10n.string("Planned transaction"), value: plannedName,
                            symbol: .link, action: { present(.planned) })
                    }
                }
                .accessibilityIdentifier("transaction.plannedLink")
            }

            if store.hasLinkedImport {
                TransactionEditorGroup {
                    TransactionEditorField(
                        title: L10n.string("Matched bank transaction"),
                        value: store.needsApproval
                            ? L10n.string("Review match") : L10n.string("Bank details"),
                        symbol: .link, action: { present(.bankMatch) })
                }
                .accessibilityIdentifier("transaction.bankMatch")
            }

            TransactionEditorGroup { statusControl }

            notes

            if store.detail?.suggestedTransfer?.isActionable == true && draft.isTransfer {
                TransactionEditorNotice(
                    message: draft.transferAccountID == nil
                        ? L10n.string("Suggested transfer. Choose the other account to approve.")
                        : L10n.string("Suggested transfer. Approve to confirm these accounts."),
                    symbol: .transferCircle)
            }

            if !store.isCreating && !store.isEditingPlan {
                DisclosureGroup(isExpanded: editingBinding($showsMoreDetails)) {
                    VStack(spacing: 14) {
                        TransactionEditorGroup {
                            reviewControl
                            if store.detail?.importDetails != nil {
                                TransactionEditorDivider()
                                TransactionEditorField(
                                    title: L10n.string("Bank details"),
                                    value: L10n.string("Original imported information"),
                                    symbol: .fileSearch,
                                    action: { present(.imported) }
                                )
                            }
                        }
                    }
                    .padding(.top, 12)
                } label: {
                    Text(L10n.string("More details"))
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .frame(minHeight: 44)
                }

            }

            if let message = store.choicesErrorMessage {
                TransactionEditorNotice(
                    message: message, symbol: .wifiOff, isError: true)
                Button(L10n.string("Reload choices")) {
                    onInteraction(.inlineControl)
                    Task { await store.reloadChoices() }
                }
            }
        }
        .sheet(item: $destination) { destination in
            destinationView(destination)
        }
        .onChange(of: isNotesFocused) { _, isFocused in
            if isFocused { onInteraction(.keyboard) }
        }
    }

    private func present(_ destination: TransactionEditorDestination) {
        onInteraction(.destination)
        isNotesFocused = false
        self.destination = destination
    }

    private func editingBinding<Value>(_ binding: Binding<Value>) -> Binding<Value> {
        Binding(
            get: { binding.wrappedValue },
            set: {
                onInteraction(.inlineControl)
                binding.wrappedValue = $0
            }
        )
    }

    private var statusControl: some View {
        HStack(spacing: 13) {
            KualiaIconImage(icon: draft.status == .reconciled ? .lock : .circle, size: 18)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(KualiaPalette.mutedInk)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 4) {
                Text(L10n.string("Status"))
                    .font(.caption)
                    .foregroundStyle(KualiaPalette.mutedInk)
                if draft.status == .reconciled {
                    Text(L10n.string("Reconciled")).font(
                        .system(.body, design: .rounded, weight: .semibold))
                    Text(L10n.string("Locked by reconciliation")).font(.caption).foregroundStyle(
                        KualiaPalette.mutedInk)
                } else {
                    TransactionEditorStatusControl(selection: draft.status) { status in
                        onInteraction(.inlineControl)
                        store.selectStatus(status)
                    }

                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(18)
    }

    private var notes: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(L10n.string("Notes"), icon: .note)
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(KualiaPalette.mutedInk)
            TextField(
                L10n.string("What would you like to remember?"), text: $draft.notes, axis: .vertical
            )
            .focused($isNotesFocused)
            .font(.body)
            .lineLimit(2...6)
            .accessibilityLabel(L10n.string("Transaction notes"))
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
    }

    private var reviewControl: some View {
        Toggle(
            isOn: Binding(
                get: { draft.reviewStatus == .reviewed },
                set: {
                    onInteraction(.inlineControl)
                    draft.reviewStatus = $0 ? .reviewed : .needsReview
                }
            )
        ) {
            Label(L10n.string("Reviewed"), icon: .badgeCheck)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
        }
        .padding(18)
    }

    @ViewBuilder
    private func destinationView(_ destination: TransactionEditorDestination) -> some View {
        switch destination {
        case .merchant:
            TransactionEditorPicker(
                title: L10n.string("Merchants"), choices: merchantChoices,
                selectedID: draft.useOriginalStatement ? "original" : draft.merchantID ?? "none",
                isLoading: store.isLoadingChoices, errorMessage: store.choicesErrorMessage,
                onRetry: { Task { await store.reloadChoices() } },
                onCreate: { name in
                    draft.pendingMerchantName = name
                    draft.merchantID = nil
                    draft.useOriginalStatement = false
                },
                focusesSearchOnAppear: true,
                onSelect: { id in
                    store.selectMerchant(id)
                }
            )
        case .category:
            TransactionEditorCategorySheet(store: store, draft: $draft, allowsSplitting: isRegular)
        case .account, .transferAccount:
            TransactionEditorPicker(
                title: L10n.string("Accounts"), choices: accountChoices(for: destination),
                selectedID: destination == .account ? draft.accountID : draft.transferAccountID,
                isLoading: store.isLoadingChoices, errorMessage: store.choicesErrorMessage,
                onRetry: { Task { await store.reloadChoices() } },
                onSelect: { id in
                    if destination == .account {
                        store.selectAccount(id)
                    } else {
                        store.selectTransferAccount(id)
                    }
                }
            )
        case .date:
            TransactionEditorDateSheet(
                draft: $draft, workspace: store.workspace,
                allowsScheduling: isRegular || draft.isTransfer,
                isEditingPlan: store.isEditingPlan, isCreating: store.isCreating,
                anchorDate: store.plannedSchedule?.anchorDate,
                originalDate: store.plannedSchedule?.nextDate
            )
        case .planned:
            TransactionPlannedLinkPicker(
                store: store, selectedID: draft.scheduledTransactionID,
                onSelect: store.selectPlannedTransaction)
        case .bankMatch:
            TransactionImportLinkSheet(store: store, onSaved: onImportLinkSaved)
        case .imported:
            TransactionEditorImportSheet(
                details: store.detail?.importDetails, workspace: store.workspace)
        }
    }

    private func transferAccountField(isFrom: Bool) -> some View {
        let isOther = isFrom == draft.isIncomingTransfer
        let id = isOther ? draft.transferAccountID : draft.accountID
        return TransactionEditorField(
            title: isFrom ? L10n.string("From account") : L10n.string("To account"),
            value: accountName(id), symbol: .bank,
            placeholder: id?.isEmpty ?? true,
            logoURL: accountLogoURL(id), circularIcon: true,
            action: { present(isOther ? .transferAccount : .account) })
    }

    private var isRegular: Bool {
        !draft.isTransfer
            && store.supportsTransferToggle
    }

    private var merchantName: String {
        if let name = draft.pendingMerchantName { return name }
        if draft.useOriginalStatement {
            return store.detail?.importDetails?.originalStatement
                ?? L10n.string("Original statement")
        }
        guard let id = draft.merchantID else { return L10n.string("Choose a merchant") }
        return store.choices.merchants.first { $0.id == id }?.name
            ?? store.detail?.merchant?.name ?? store.detail?.merchantName
            ?? L10n.string("Selected merchant")
    }

    private var merchantLogoURL: URL? {
        guard !draft.useOriginalStatement, draft.pendingMerchantName == nil,
            let id = draft.merchantID
        else { return nil }
        let merchant =
            store.choices.merchants.first { $0.id == id }
            ?? (store.detail?.merchant?.id == id ? store.detail?.merchant : nil)
        return merchant?.logoUrl.flatMap { URL(string: $0) }
    }

    private func accountLogoURL(_ id: String?) -> URL? {
        guard let id else { return nil }
        let account =
            store.choices.accounts.first { $0.id == id }
            ?? (store.detail?.bankAccount?.id == id ? store.detail?.bankAccount : nil)
        return account?.resolvedLogoUrl.flatMap { URL(string: $0) }
    }

    private func accountName(_ id: String?) -> String {
        guard let id, !id.isEmpty else { return L10n.string("Choose an account") }
        return store.choices.accounts.first { $0.id == id }?.name
            ?? (id == store.detail?.bankAccountId
                ? store.detail?.bankAccount?.name : store.detail?.transferPairAccountName)
            ?? L10n.string("Selected account")
    }

    private var categorySummary: String {
        if draft.allocations.count > 1 {
            return L10n.string("\(draft.allocations.count) categories · Split transaction")
        }
        if store.needsCategorySelection { return L10n.string("Choose a category") }
        guard let first = draft.allocations.first else { return L10n.string("Uncategorized") }
        if first.readyToAssign { return L10n.string("Ready to Assign") }
        guard let id = first.categoryID else { return L10n.string("Uncategorized") }
        return store.choices.categories.first { $0.id == id }?.name
            ?? store.detail?.movements.first?.categoryName ?? store.detail?.movements.first?
            .category?.name
            ?? L10n.string("Selected category")
    }

    private var merchantChoices: [TransactionEditorChoice] {
        var choices = [
            TransactionEditorChoice(id: "none", title: L10n.string("No merchant"), symbol: .shop)
        ]
        if let original = store.detail?.importDetails?.originalStatement, !original.isEmpty {
            choices.append(
                TransactionEditorChoice(
                    id: "original", title: L10n.string("Use bank statement"), subtitle: original,
                    symbol: .note))
        }
        return choices + TransactionEditorMerchant.pickerChoices(store.choices.merchants)
    }

    private func accountChoices(for destination: TransactionEditorDestination)
        -> [TransactionEditorChoice]
    {
        let excluded =
            draft.isTransfer
            ? (destination == .account ? draft.transferAccountID : draft.accountID) : nil
        return store.choices.accounts.filter { $0.id != excluded }.map(\.pickerChoice)
    }

    private var dateTitle: String {
        guard let date = TransactionEditorDate.date(from: draft.dateKey, workspace: store.workspace)
        else { return draft.dateKey }
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        formatter.timeZone = TransactionEditorDate.calendar(workspace: store.workspace).timeZone
        return formatter.string(from: date)
    }

    private var plannedName: String {
        guard let id = draft.scheduledTransactionID else {
            return L10n.string("Link to a planned transaction")
        }
        return store.choices.plannedTransactions.first { $0.id == id }?.name
            ?? L10n.string("Linked planned transaction")
    }
}

private struct TransactionEditorStatusControl: View {
    let selection: TransactionFeedStatus
    let onSelect: (TransactionFeedStatus) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var selectionAnimation

    var body: some View {
        HStack(spacing: 2) {
            choice(.pending, title: L10n.string("Pending"))
            choice(.cleared, title: L10n.string("Cleared"))
        }
        .padding(4)
        .background(KualiaPalette.border.opacity(0.3), in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L10n.string("Transaction status"))
    }

    private func choice(_ status: TransactionFeedStatus, title: String) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .spring(duration: 0.25)) { onSelect(status) }
        } label: {
            Text(title)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(selection == status ? KualiaPalette.ink : KualiaPalette.mutedInk)
                .padding(.horizontal, 13)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background {
                    if selection == status {
                        Capsule().fill(KualiaPalette.surface)
                            .matchedGeometryEffect(id: "status", in: selectionAnimation)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityAddTraits(selection == status ? .isSelected : [])
        .accessibilityIdentifier("transaction.status.\(status.rawValue)")
    }
}
