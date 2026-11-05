import SwiftUI

struct TransactionEditorCategorySheet: View {
    @Bindable var store: TransactionEditorStore
    @Binding var draft: TransactionEditorDraft
    let allowsSplitting: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selection: TransactionSplitCategorySelection?
    @State private var splitDraft: TransactionEditorDraft?

    init(
        store: TransactionEditorStore, draft: Binding<TransactionEditorDraft>, allowsSplitting: Bool
    ) {
        self.store = store
        self._draft = draft
        self.allowsSplitting = allowsSplitting
        _selection = State(
            initialValue: allowsSplitting && draft.wrappedValue.allocations.count > 1
                ? TransactionSplitCategorySelection(allocations: draft.wrappedValue.allocations)
                : nil)
    }

    var body: some View {
        ZStack {
            if let splitBinding = Binding($splitDraft) {
                TransactionEditorSplitSheet(
                    draft: splitBinding, workspace: store.workspace,
                    categories: store.categoryPickerChoices,
                    onApply: {
                        draft = splitBinding.wrappedValue
                        store.didApplySplits()
                    }
                )
                .compositingGroup()
                .transition(.opacity)
            } else {
                categoryPicker
                    .compositingGroup()
                    .transition(.opacity)
            }
        }
        .background(KualiaPalette.canvas)
        .presentationDetents([.large])
        .presentationBackground(KualiaPalette.canvas)
    }

    private var categoryPicker: some View {
        let splitAction: (() -> Void)? = allowsSplitting ? { advanceSplit() } : nil
        let selectedID: String? =
            store.needsCategorySelection
            ? nil
            : draft.allocations.first.map { TransactionSplitCategorySelection.key(for: $0) }
        return TransactionEditorPicker(
            title: L10n.string("Categories"), choices: store.categoryPickerChoices,
            selectedID: selectedID,
            selectedIDs: selection?.selectedIDs,
            isLoading: store.isLoadingChoices,
            dismissesOnSelection: selection == nil,
            errorMessage: store.choicesErrorMessage,
            onRetry: { Task { await store.reloadChoices() } },
            onSplit: splitAction,
            splitActionTitle: selection?.canContinue == true
                ? L10n.string("Next") : L10n.string("Split"),
            isSplitActionEnabled: selection == nil || selection?.canContinue == true,
            showsSelectionControls: selection != nil,
            showsCategoryBalances: true, categoryDateKey: draft.dateKey,
            focusesSearchOnAppear: true,
            onSelect: { id in
                if selection != nil { selection?.toggle(id) } else { store.selectCategory(id) }
            })
    }

    private func advanceSplit() {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
            if let selection {
                guard selection.canContinue else { return }
                var next = draft
                next.allocations = selection.allocations(
                    from: draft.allocations, orderedIDs: store.categoryPickerChoices.map(\.id),
                    total: draft.signedAmount,
                    startAtZero: store.isCreating && draft.allocations.count <= 1)
                splitDraft = next
            } else {
                selection = TransactionSplitCategorySelection(
                    allocations: draft.allocations,
                    includesUncategorized: !store.needsCategorySelection)
            }
        }
    }
}

struct TransactionEditorSplitSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var draft: TransactionEditorDraft
    let workspace: TransactionFeedWorkspace
    let categories: [TransactionEditorChoice]
    let onApply: () -> Void

    @State private var allocations: [TransactionEditorAllocation]
    @State private var targetAmount: Int64
    @State private var picker: AllocationDestination?
    @State private var amountPadPresentation = PeekPresentation()
    @State private var remainingRowHeight: CGFloat = 80
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var amountPadHeight: CGFloat = 274
    @State private var amountFocus = BudgetAssignmentFocus()
    @State private var padOpeningSessionID: UUID?
    @State private var amountAllocationID: String?
    @FocusState private var focusedNoteID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        draft: Binding<TransactionEditorDraft>, workspace: TransactionFeedWorkspace,
        categories: [TransactionEditorChoice], onApply: @escaping () -> Void = {}
    ) {
        _draft = draft
        self.workspace = workspace
        self.categories = categories
        self.onApply = onApply
        _allocations = State(initialValue: draft.wrappedValue.allocations)
        _targetAmount = State(initialValue: draft.wrappedValue.signedAmount)
    }

    var body: some View {
        GeometryReader { geometry in
            PeekContainer(
                presentation: amountPadPresentation, expansionHeight: amountPadHeight,
                isCompactPresented: true, compactHeight: remainingRowHeight,
                foregroundColor: KualiaPalette.peekBackground
            ) {
                NavigationStack {
                    BudgetScrollView(
                        editingCategoryID: amountPadPresentation.sessionID == nil
                            ? nil : amountAllocationID
                    ) {
                        VStack(alignment: .leading, spacing: 18) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(L10n.string("Divide this transaction"))
                                    .font(.system(.title2, design: .rounded, weight: .bold))
                                Text(
                                    L10n.string(
                                        "Split \(formatted(targetAmount)) between categories. Each part can have its own note."
                                    )
                                )
                                .font(.subheadline)
                                .foregroundStyle(KualiaPalette.mutedInk)
                            }

                            ForEach($allocations) { $allocation in
                                allocationCard($allocation).id(allocation.id)
                            }

                            Button {
                                allocations.append(
                                    TransactionEditorAllocation(amount: 0, categoryID: nil)
                                )
                            } label: {
                                Label {
                                    Text(L10n.string("Add a category"))
                                } icon: {
                                    KualiaIconImage(icon: .plusCircle, size: 22)
                                }
                                .font(.system(.body, design: .rounded, weight: .semibold))
                                .frame(maxWidth: .infinity, minHeight: 48)
                            }
                            .buttonStyle(.kualiaHaptic)

                            if let total, total != targetAmount,
                                allocations.contains(where: { $0.amount != 0 })
                            {
                                TransactionEditorNotice(
                                    message:
                                        L10n.string(
                                            "The split adds up to \(formatted(total)). Match the transaction total or use this new total."
                                        ),
                                    symbol: .equals)
                                if total != Int64.min, total != 0 {
                                    Button(
                                        L10n.string(
                                            "Use \(formatted(total)) as the transaction total")
                                    ) {
                                        targetAmount = total
                                    }
                                    .font(.subheadline)
                                    .frame(minHeight: 44)
                                }
                            } else if total == nil {
                                TransactionEditorNotice(
                                    message: L10n.string(
                                        "The split total is too large. Reduce an amount to continue."
                                    ),
                                    isError: true)
                            }
                        }
                        .padding(20)
                        .padding(.bottom, 100)
                    }
                    .environment(\.budgetAssignmentFocus, amountFocus)
                    .environment(
                        \.isBudgetAssignmentRevealReady,
                        amountPadPresentation.isPresented && padOpeningSessionID == nil
                    )
                    .scrollDismissesKeyboard(.interactively)
                    .background(KualiaPalette.canvas)
                    .navigationTitle(L10n.string("Split transaction"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            KualiaCloseButton(placement: .toolbar, label: L10n.string("Cancel")) {
                                dismiss()
                            }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button(L10n.string("Apply")) {
                                draft.setFlow(targetAmount < 0 ? .outflow : .inflow)
                                draft.setAmount(abs(targetAmount))
                                draft.allocations = allocations
                                onApply()
                                dismiss()
                            }
                            .fontWeight(.semibold)
                            .disabled(
                                total != targetAmount || targetAmount == 0
                                    || targetAmount == Int64.min
                                    || allocations.isEmpty
                                    || allocations.contains { $0.amount == 0 })
                        }
                    }
                }
                .background(KualiaPalette.canvas)
            } expansion: {
                if let id = amountAllocationID,
                    let allocation = allocations.first(where: { $0.id == id }),
                    let sessionID = amountPadPresentation.sessionID
                {
                    TransactionAmountPad(
                        amount: allocation.amount == Int64.min ? 0 : abs(allocation.amount),
                        minorUnit: workspace.minorUnit,
                        onChange: { amount in
                            guard amountPadPresentation.sessionID == sessionID,
                                amountAllocationID == id,
                                let index = allocations.firstIndex(where: { $0.id == id })
                            else { return }
                            allocations[index].setSplitAmount(
                                amount, transactionAmount: targetAmount)
                        },
                        onDismiss: closeAmountPad,
                        onContentHeightChange: { height in
                            revealAmountPad(
                                height: height, sessionID: sessionID,
                                allocationID: id, containerFrame: geometry.frame(in: .global))
                        })
                }
            } compact: {
                remainingRow
            }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
        ) { _ in
            dismissAmountPadForFocusChange()
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .interactiveDismissDisabled(
            allocations != draft.allocations || targetAmount != draft.signedAmount
        )
        .sheet(item: $picker) { destination in
            if let index = allocations.firstIndex(where: { $0.id == destination.allocationID }) {
                TransactionEditorPicker(
                    title: L10n.string("Categories"), choices: categories,
                    selectedID: allocations[index].readyToAssign
                        ? "rta" : allocations[index].categoryID ?? "none",
                    showsCategoryBalances: true, categoryDateKey: draft.dateKey,
                    focusesSearchOnAppear: true,
                    onSelect: { id in
                        if let current = allocations.firstIndex(where: {
                            $0.id == destination.allocationID
                        }) {
                            allocations[current].categoryID =
                                id == "rta" || id == "none" ? nil : id
                            allocations[current].readyToAssign = id == "rta"
                        }
                    }
                )
            }
        }
    }

    private var padAnimation: Animation? {
        reduceMotion ? nil : .spring(duration: 0.38, bounce: 0.08)
    }

    private func openAmountPad(for id: String) {
        focusedNoteID = nil
        padOpeningSessionID = nil
        amountAllocationID = id
        if amountPadPresentation.isPresented {
            amountPadPresentation.open(hasVisiblePeek: true)
        } else {
            withTransaction(Transaction(animation: nil)) {
                amountPadPresentation.prepare(hasVisiblePeek: true)
            }
        }
    }

    private func revealAmountPad(
        height: CGFloat, sessionID: UUID, allocationID: String, containerFrame: CGRect
    ) {
        guard amountPadPresentation.acceptsMeasurement(sessionID: sessionID),
            amountAllocationID == allocationID
        else { return }
        amountPadHeight = height
        guard amountPadPresentation.isPreparing else { return }
        let layout = PeekLayout(
            containerHeight: containerFrame.height, expansionHeight: height,
            isPresented: true, isCompactPresented: true, compactHeight: remainingRowHeight)
        let offset = amountFocus.prepareReveal(
            categoryID: allocationID,
            viewportBottom: containerFrame.minY + layout.foregroundHeight)
        padOpeningSessionID = sessionID
        var transaction = Transaction(animation: padAnimation)
        transaction.scrollContentOffsetAdjustmentBehavior = .disabled
        transaction.addAnimationCompletion(criteria: .removed) {
            guard padOpeningSessionID == sessionID else { return }
            padOpeningSessionID = nil
        }
        // Match Budget: reserve the final range before animating the scroll and drawer.
        amountFocus.openAfterRevealLayout {
            guard amountPadPresentation.isPreparing,
                amountPadPresentation.sessionID == sessionID,
                amountAllocationID == allocationID
            else { return }
            withTransaction(transaction) {
                amountPadPresentation.reveal(sessionID: sessionID)
                if let offset { amountFocus.position.scrollTo(y: offset) }
            }
        }
    }

    private func closeAmountPad() {
        guard let sessionID = amountPadPresentation.sessionID else { return }
        padOpeningSessionID = nil
        withAnimation(padAnimation, completionCriteria: .removed) {
            amountPadPresentation.beginClosing()
        } completion: {
            amountPadPresentation.finishClosing(sessionID: sessionID)
            if amountPadPresentation.sessionID == nil { amountAllocationID = nil }
        }
    }

    private func dismissAmountPadForFocusChange() {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            amountPadPresentation.dismissForFocusChange()
            padOpeningSessionID = nil
            amountFocus.select(nil)
            amountAllocationID = nil
        }
    }

    private func allocationCard(_ allocation: Binding<TransactionEditorAllocation>) -> some View {
        TransactionEditorGroup {
            HStack(spacing: 8) {
                Button {
                    openAmountPad(for: allocation.wrappedValue.id)
                } label: {
                    Text(formatted(allocation.wrappedValue.amount))
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .monospacedDigit()
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.kualiaHaptic)
                .background { BudgetAssignmentAnchor(categoryID: allocation.wrappedValue.id) }
                .accessibilityLabel(
                    L10n.string("Split amount \(formatted(allocation.wrappedValue.amount))"))
                Button {
                    if allocation.wrappedValue.amount != Int64.min {
                        allocation.wrappedValue.amount = -allocation.wrappedValue.amount
                    }
                } label: {
                    KualiaIconImage(icon: .plusMinus, size: 22).frame(width: 44, height: 44)
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityLabel(L10n.string("Switch this split between inflow and outflow"))
                Button(role: .destructive) {
                    if amountAllocationID == allocation.wrappedValue.id {
                        dismissAmountPadForFocusChange()
                    }
                    allocations.removeAll { $0.id == allocation.wrappedValue.id }
                } label: {
                    KualiaIconImage(icon: .minusCircle, size: 22).frame(width: 44, height: 44)
                }
                .buttonStyle(.kualiaHaptic)
                .disabled(allocations.count < 2)
                .accessibilityLabel(L10n.string("Remove split"))
            }
            .padding(.horizontal, 18)
            .padding(.top, 10)
            TransactionEditorField(
                title: L10n.string("Category"), value: categoryName(allocation.wrappedValue),
                symbol: .category, circularIcon: true, iconSize: 22,
                action: {
                    dismissAmountPadForFocusChange()
                    picker = AllocationDestination(allocationID: allocation.wrappedValue.id)
                }
            )
            TransactionEditorDivider()
            TextField(L10n.string("Note for this part"), text: allocation.notes, axis: .vertical)
                .focused($focusedNoteID, equals: allocation.wrappedValue.id)
                .font(.subheadline)
                .lineLimit(1...4)
                .padding(18)
                .accessibilityLabel(L10n.string("Split note"))
        }
    }

    private var funding: TransactionSplitFunding {
        TransactionSplitFunding(target: targetAmount, allocations: allocations)
    }

    private var total: Int64? { funding.total }

    private var fillAmount: Int64? {
        guard let id = amountAllocationID, funding.remaining != 0 else { return nil }
        return funding.amountFillingRemaining(for: id)
    }

    private var remainingRow: some View {
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 16))
        return layout {
            VStack(alignment: .leading, spacing: 3) {
                Text(L10n.string("Remaining")).font(.caption)
                    .foregroundStyle(KualiaPalette.peekMutedInk)
                Text(
                    funding.displayRemaining.map {
                        TransactionAmountFormatter.string(
                            minorUnits: $0, currencyCode: workspace.currencyCode,
                            minorUnit: workspace.minorUnit, showsPositiveSign: false,
                            usesAbsoluteValue: false)
                    } ?? L10n.string("Unavailable")
                )
                .font(.system(.title3, design: .rounded, weight: .bold))
                .monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
                .foregroundStyle(
                    (funding.displayRemaining ?? 0) < 0
                        ? KualiaPalette.budgetNegative : KualiaPalette.peekInk)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("transaction.split.remaining")
            Button {
                guard let amount = fillAmount, let id = amountAllocationID,
                    let index = allocations.firstIndex(where: { $0.id == id })
                else { return }
                allocations[index].amount = amount
            } label: {
                Text(L10n.string("Fill remaining"))
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .padding(.horizontal, 16).frame(minHeight: 44)
                    .foregroundStyle(KualiaPalette.peekInk.opacity(fillAmount == nil ? 0.55 : 1))
                    .background(KualiaPalette.peekControlSurface, in: Capsule())
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: 0.2), value: fillAmount == nil)
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(fillAmount == nil)
            .accessibilityIdentifier("transaction.split.fill-remaining")
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .environment(\.colorScheme, .dark)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: {
            if abs(remainingRowHeight - $0) > 0.5 { remainingRowHeight = $0 }
        }
    }

    private func formatted(_ amount: Int64) -> String {
        TransactionAmountFormatter.string(
            minorUnits: amount, currencyCode: workspace.currencyCode,
            minorUnit: workspace.minorUnit,
            showsPositiveSign: true, usesAbsoluteValue: false
        )
    }

    private func categoryName(_ allocation: TransactionEditorAllocation) -> String {
        let id = allocation.readyToAssign ? "rta" : allocation.categoryID ?? "none"
        return categories.first { $0.id == id }?.title ?? L10n.string("Selected category")
    }

    private struct AllocationDestination: Identifiable {
        let allocationID: String
        var id: String { allocationID }
    }
}

struct TransactionEditorImportSheet: View {
    @Environment(\.dismiss) private var dismiss
    let details: TransactionEditorImportDetails?
    let workspace: TransactionFeedWorkspace

    var body: some View {
        NavigationStack {
            ScrollView {
                if let details {
                    VStack(alignment: .leading, spacing: 18) {
                        TransactionEditorNotice(
                            message:
                                L10n.string(
                                    "The original information from your bank is kept for reference. Your edits won't replace it."
                                ),
                            symbol: .bank)
                        TransactionEditorGroup {
                            TransactionEditorField(
                                title: L10n.string("Source"), value: details.provider.capitalized,
                                symbol: .bank)
                            TransactionEditorDivider()
                            TransactionEditorField(
                                title: L10n.string("Statement"),
                                value: details.originalStatement ?? details.merchantName
                                    ?? L10n.string("Not provided"), symbol: .note)
                            TransactionEditorDivider()
                            TransactionEditorField(
                                title: L10n.string("Original amount"),
                                value: TransactionAmountFormatter.string(
                                    minorUnits: details.amount,
                                    currencyCode: workspace.currencyCode,
                                    minorUnit: workspace.minorUnit, showsPositiveSign: true,
                                    usesAbsoluteValue: false
                                ), symbol: .money)
                            TransactionEditorDivider()
                            TransactionEditorField(
                                title: L10n.string("Transaction date"), value: details.date,
                                symbol: .calendarFilled)
                            if let posted = details.postedDate {
                                TransactionEditorDivider()
                                TransactionEditorField(
                                    title: L10n.string("Posted"), value: posted,
                                    symbol: .calendarCheck)
                            }
                        }
                    }
                    .padding(20)
                }
            }
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Bank details"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Done")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

struct TransactionImportLinkSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var store: TransactionEditorStore
    let onSaved: () -> Void
    @State private var useImportAmount = true
    @State private var useImportDate = true

    var body: some View {
        NavigationStack {
            ScrollView {
                if let entry = store.detail, let bank = entry.importDetails {
                    VStack(alignment: .leading, spacing: 18) {
                        TransactionEditorNotice(
                            message: L10n.string(
                                "This bank transaction was matched to your existing entry."),
                            symbol: .link)
                        comparison(
                            title: L10n.string("Your entry"), amount: entry.totalAmount,
                            date: entry.date,
                            payee: entry.merchantName ?? L10n.string("Not provided"))
                        comparison(
                            title: L10n.string("Bank details"), amount: bank.amount,
                            date: bank.date,
                            payee: bank.merchantName ?? bank.originalStatement
                                ?? L10n.string("Not provided"))
                        if store.needsApproval {
                            if entry.totalAmount != bank.amount {
                                Toggle(L10n.string("Use bank amount"), isOn: $useImportAmount)
                            }
                            if entry.date != bank.date {
                                Toggle(L10n.string("Use bank date"), isOn: $useImportDate)
                            }
                            Button(L10n.string("Confirm match")) {
                                resolve(
                                    .approve(
                                        useImportAmount: useImportAmount,
                                        useImportDate: useImportDate))
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!store.canResolveImportLink)
                            .accessibilityIdentifier("transaction.bankMatch.confirm")
                        }
                        Button(L10n.string("Not the same transaction")) { resolve(.unlink) }
                            .buttonStyle(.bordered)
                            .disabled(!store.canResolveImportLink)
                            .accessibilityIdentifier("transaction.bankMatch.unlink")
                        Text(
                            L10n.string(
                                "Unlinking keeps your entry and adds the bank transaction separately."
                            )
                        )
                        .font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                        if store.isDirty {
                            TransactionEditorNotice(
                                message: L10n.string("Save your edits before changing this match."),
                                symbol: .warning)
                        }
                        if store.isSaving { ProgressView() }
                        if let error = store.saveErrorMessage {
                            TransactionEditorNotice(message: error, symbol: .warning, isError: true)
                        }
                    }
                    .padding(20)
                }
            }
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Matched bank transaction"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }.disabled(store.isSaving)
                }
            }
        }
        .tint(KualiaPalette.ink)
        .interactiveDismissDisabled(store.isSaving)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func comparison(title: String, amount: Int64, date: String, payee: String) -> some View
    {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            TransactionEditorGroup {
                TransactionEditorField(
                    title: L10n.string("Amount"),
                    value: TransactionAmountFormatter.string(
                        minorUnits: amount, currencyCode: store.workspace.currencyCode,
                        minorUnit: store.workspace.minorUnit, showsPositiveSign: true,
                        usesAbsoluteValue: false), symbol: .money)
                TransactionEditorDivider()
                TransactionEditorField(
                    title: L10n.string("Transaction date"), value: date, symbol: .calendarFilled)
                TransactionEditorDivider()
                TransactionEditorField(title: L10n.string("Merchant"), value: payee, symbol: .bank)
            }
        }
    }

    private func resolve(_ action: TransactionImportLinkRequest.Action) {
        Task {
            if await store.resolveImportLink(action) { onSaved() }
        }
    }
}
