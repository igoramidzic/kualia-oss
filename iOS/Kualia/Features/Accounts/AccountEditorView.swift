import SwiftUI

struct AccountEditorView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Bindable var store: AccountsStore
    let isPushed: Bool
    let onSaved: () -> Void
    let onAccountChanged: (TransactionMutationReceipt) -> Void

    @State private var confirmation: AccountConfirmation?
    @State private var hasTransactions: Bool?
    @State private var eligibilityError: String?
    @State private var account: AccountSnapshot?
    @State private var draft: AccountDraft
    @State private var balanceInput: AccountOpeningBalanceInput
    @State private var amountPadPresentation = PeekPresentation()
    @State private var amountPadContentHeight: CGFloat = 274
    @State private var toolbarHeight: CGFloat = 74
    @State private var balanceFocus = BudgetAssignmentFocus()
    @State private var padOpeningSessionID: UUID?
    @State private var pendingBalanceReveal: AccountBalanceRevealRequest?
    @State private var isKeyboardPresented = false
    @State private var opensPadAfterKeyboard = false
    @State private var showsDiscardConfirmation = false
    @State private var showsLogoPicker = false
    @State private var draftLogo = EntityLogoDraft()
    @State private var isSavingLogo = false
    @FocusState private var focusedField: Field?
    @State private var originalDraft: AccountDraft

    private enum Field: Hashable { case name, notes }

    init(
        store: AccountsStore, account: AccountSnapshot? = nil, isPushed: Bool = false,
        onAccountChanged: @escaping (TransactionMutationReceipt) -> Void = { _ in },
        onSaved: @escaping () -> Void = {}
    ) {
        self.store = store
        self.isPushed = isPushed
        _account = State(initialValue: account)
        self.onSaved = onSaved
        self.onAccountChanged = onAccountChanged
        var initial = account.map { AccountDraft(account: $0) } ?? AccountDraft()
        if account == nil, let workspace = store.workspace {
            initial.initialBalanceDate = TransactionEditorDate.today(workspace: workspace)
        }
        _balanceInput = State(
            initialValue: AccountOpeningBalanceInput(minorUnit: store.workspace?.minorUnit ?? 2))
        _originalDraft = State(initialValue: initial)
        _draft = State(initialValue: initial)
    }

    private var isCreating: Bool { account == nil }
    private var isSaving: Bool { store.isSaving || isSavingLogo }
    private var isDirty: Bool {
        draft != originalDraft || balanceInput.calculator.amount != 0 || draftLogo.hasSelection
    }
    private var selectedType: AccountTypeOption? {
        AccountTypeOption.all.first { $0.id == draft.accountType }
    }
    private var selectedCategory: AccountCategory { selectedType?.category ?? .banking }
    private var validationMessage: String? {
        if isCreating, balanceInput.amount == nil {
            return balanceInput.calculator.error?.errorDescription
                ?? L10n.string("Finish the calculation.")
        }
        return store.validationMessage(for: draft, account: account)
    }
    private var canSave: Bool {
        store.workspace != nil && !isSaving && validationMessage == nil
            && (isCreating || isDirty)
    }

    var body: some View {
        GeometryReader { geometry in
            PeekContainer(
                presentation: amountPadPresentation, expansionHeight: amountPadContentHeight
            ) {
                editorContent
                    .safeAreaPadding(.top, isPushed ? geometry.safeAreaInsets.top : 0)
                    .overlay(alignment: .top) {
                        if !isPushed {
                            toolbar
                                .onGeometryChange(for: CGFloat.self) {
                                    $0.size.height
                                } action: {
                                    toolbarHeight = $0
                                }
                        }
                    }
            } expansion: {
                if let sessionID = amountPadPresentation.sessionID {
                    AmountPad(
                        calculator: Binding(
                            get: { balanceInput.calculator },
                            set: {
                                balanceInput.calculator = $0
                                updateBalance()
                            }),
                        accessibilityIdentifierPrefix: "account",
                        onDismiss: closeAmountPad,
                        onCancel: cancelAmountPad,
                        onContentHeightChange: {
                            revealAmountPad(
                                height: $0, sessionID: sessionID,
                                containerFrame: geometry.frame(in: .global))
                        }
                    )
                    .disabled(isSaving)
                }
            }
            // The drawer container clips its foreground. Extend that boundary
            // behind the native bar while preserving the scroll view's top inset.
            .ignoresSafeArea(.container, edges: isPushed ? .top : [])
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.canvas)
        .interactiveDismissDisabled(isDirty || isSaving)
        .navigationTitle(isPushed ? L10n.string("New account") : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(isPushed ? .visible : .hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(isPushed)
        .toolbar {
            if isPushed {
                ToolbarItem(placement: .confirmationAction) { toolbarSaveButton }
                ToolbarItem(placement: .topBarLeading) { backButton }
            }
        }
        .background {
            if isPushed {
                AccountEditorBackGestureGuard(
                    isDirty: isDirty, isSaving: isSaving,
                    onAttempt: { showsDiscardConfirmation = true })
            }
            TransactionEditorDismissalObserver(
                isDirty: isDirty, isSaving: isSaving,
                onAttempt: { showsDiscardConfirmation = true }
            )
        }
        .alert(L10n.string("Discard your changes?"), isPresented: $showsDiscardConfirmation) {
            Button(L10n.string("Discard changes"), role: .destructive) { dismiss() }
            Button(L10n.string("Keep editing"), role: .cancel) {}
        }
        .alert(
            confirmation?.title ?? L10n.string("Manage account"),
            isPresented: Binding(
                get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
            presenting: confirmation
        ) { action in
            Button(action.buttonTitle, role: action == .reopen ? nil : .destructive) {
                Task { await perform(action) }
            }
            Button(L10n.string("Cancel"), role: .cancel) {}
        } message: { action in
            Text(action.message)
        }
        .task(id: account?.id) { await checkEligibility() }
        .onAppear { store.actionErrorMessage = nil }
        .sheet(isPresented: $showsLogoPicker) {
            if isCreating || draftLogo.hasSelection,
                let client = store.makeDraftLogoClient(draft: draftLogo)
            {
                EntityLogoPicker(
                    name: draft.name, currentURL: draftLogo.previewURL, defaultURL: nil,
                    state: draftLogo.choice.state(original: .automatic),
                    fallback: .bank, client: client, onSelect: draftLogo.select)
            } else if let account, let client = store.makeLogoClient(accountID: account.id) {
                EntityLogoPicker(
                    name: draft.name, currentURL: previewLogoURL,
                    defaultURL: account.institutionLogoUrl,
                    state: draft.logoChoice.state(original: account.logoState),
                    fallback: .bank, client: client
                ) { choice in
                    var updated = account
                    updated.logoState = choice.state(original: account.logoState)
                    updated.resolvedLogoUrl = choice.previewURL(
                        current: account.resolvedLogoUrl, defaultURL: account.institutionLogoUrl)
                    if case .custom(let url) = choice {
                        updated.logoUrl = url
                    } else {
                        updated.logoUrl = nil
                    }
                    self.account = updated
                    draft.acceptSavedLogo(from: updated)
                    originalDraft.acceptSavedLogo(from: updated)
                }
            }
        }
        .onChange(of: draft) { _, _ in store.actionErrorMessage = nil }
        .onChange(of: focusedField) { _, field in
            if field != nil {
                opensPadAfterKeyboard = false
                padOpeningSessionID = nil
                pendingBalanceReveal = nil
                balanceInput.finishEditing()
                amountPadPresentation.dismissForFocusChange()
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
        ) { _ in isKeyboardPresented = true }
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)
        ) { _ in
            isKeyboardPresented = false
            if opensPadAfterKeyboard {
                opensPadAfterKeyboard = false
                withTransaction(Transaction(animation: nil)) { amountPadPresentation.prepare() }
            }
        }
        .onDisappear { opensPadAfterKeyboard = false }
    }

    @ViewBuilder
    private var editorContent: some View {
        if isPushed {
            editorScroll
        } else {
            editorScroll.mask {
                TransactionEditorScrollFade(
                    topInset: toolbarHeight, fadeHeight: 32, fadesBottom: !isKeyboardPresented)
            }
        }
    }

    private var editorScroll: some View {
        BudgetScrollView(
            editingCategoryID: amountPadPresentation.sessionID == nil ? nil : "starting-balance",
            onScrollChange: applyPendingBalanceReveal
        ) {
            VStack(alignment: .leading, spacing: 28) {
                identity
                accountTypes
                if isCreating, let workspace = store.workspace {
                    startingBalance(workspace: workspace)
                } else if !isCreating {
                    additionalDetails
                    if let account {
                        AccountConnectionSection(store: store, account: account)
                        management(account)
                    }
                }
                if let message = store.actionErrorMessage {
                    TransactionEditorNotice(message: message, isError: true)
                } else if isDirty, let message = validationMessage {
                    TransactionEditorNotice(message: message, isError: true)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, isPushed ? 20 : toolbarHeight + 20)
            .padding(.bottom, 280)
            .disabled(isSaving)
        }
        .environment(\.budgetAssignmentFocus, balanceFocus)
        .environment(
            \.isBudgetAssignmentRevealReady,
            !amountPadPresentation.isPreparing && padOpeningSessionID == nil
        )
        .scrollDismissesKeyboard(.interactively)
        .kualiaScrollEdgeEffectHidden(!isPushed)
        .kualiaScrollEdges(for: .top)
    }

    private var toolbar: some View {
        HStack(spacing: 12) {
            backButton
            Text(isCreating ? L10n.string("New account") : L10n.string("Edit account"))
                .font(.system(.headline, design: .rounded, weight: .bold))
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
            saveButton
        }
        .foregroundStyle(KualiaPalette.ink)
        .padding(.horizontal, 20)
        .padding(.top, 22)
        .padding(.bottom, 8)
    }

    private var backButton: some View {
        Group {
            if isPushed {
                Button(action: requestClose) {
                    KualiaIconImage(icon: .chevronLeft, size: 15)
                        .font(.system(size: 15, weight: .semibold))
                }
                .buttonBorderShape(.circle)
                .accessibilityLabel(L10n.string("Back"))
            } else {
                KualiaCloseButton(label: L10n.string("Close account editor"), action: requestClose)
            }
        }
        .disabled(isSaving)
    }

    private func management(_ account: AccountSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Divider().overlay(KualiaPalette.border)
            Button {
                confirmation = account.isClosed ? .reopen : .close
            } label: {
                Label(
                    account.isClosed ? L10n.string("Reopen account") : L10n.string("Close account"),
                    icon: account.isClosed ? .undo : .archive
                )
                .frame(minHeight: 44)
            }
            .foregroundStyle(KualiaPalette.ink)
            .buttonStyle(.kualiaHaptic)
            .disabled(isSaving || isDirty)
            Button(role: .destructive) {
                confirmation = .delete
            } label: {
                Label(L10n.string("Delete account"), icon: .trash).frame(minHeight: 44)
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(hasTransactions != false || isSaving || isDirty)
            if hasTransactions == true {
                Text(
                    L10n.string(
                        "Only accounts with no transactions can be deleted. Close this account to keep its history."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            } else if let eligibilityError {
                AccountMessage(
                    title: L10n.string("Couldn't check deletion"), message: eligibilityError,
                    retry: {
                        Task { await checkEligibility() }
                    })
            } else if hasTransactions == nil {
                ProgressView(L10n.string("Checking account history…")).font(.caption)
            }
        }
        .font(.system(.subheadline, weight: .medium))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func checkEligibility() async {
        guard let account else { return }
        hasTransactions = nil
        eligibilityError = nil
        do {
            let result = try await store.hasTransactions(accountID: account.id)
            guard !Task.isCancelled else { return }
            hasTransactions = result
        } catch {
            guard !Task.isCancelled else { return }
            eligibilityError = L10n.string("Please try again before deleting this account.")
        }
    }

    private func perform(_ action: AccountConfirmation) async {
        guard let account, !isSaving, !isDirty else { return }
        switch action {
        case .close:
            if await store.close(account: account) {
                if let receipt = store.latestLifecycleReceipt { onAccountChanged(receipt) }
                dismiss()
                return
            }
        case .reopen:
            if await store.reopen(account: account) {
                dismiss()
                return
            }
        case .delete:
            if await store.delete(account: account) {
                if let receipt = store.latestLifecycleReceipt { onAccountChanged(receipt) }
                dismiss()
                return
            }
        }
        await checkEligibility()
    }
    private func requestClose() {
        if isDirty { showsDiscardConfirmation = true } else { dismiss() }
    }

    private var toolbarSaveButton: some View {
        Button(action: save) {
            Text(isCreating ? L10n.string("Add") : L10n.string("Save"))
                .fontWeight(.semibold)
                .opacity(isSaving ? 0 : 1)
                .overlay {
                    if isSaving { ProgressView() }
                }
        }
        .disabled(!canSave)
        .accessibilityLabel(
            isCreating ? L10n.string("Add account") : L10n.string("Save account changes")
        )
        .accessibilityIdentifier("account.save")
    }

    private var saveButton: some View {
        Button(action: save) {
            Group {
                if isSaving {
                    ProgressView().tint(KualiaPalette.canvas)
                } else {
                    Text(isCreating ? L10n.string("Add") : L10n.string("Save"))
                        .font(.system(.subheadline, weight: .bold))
                }
            }
            .foregroundStyle(KualiaPalette.canvas)
            .frame(minWidth: 62, minHeight: 44)
            .background(KualiaPalette.ink, in: Capsule())
            .opacity(canSave ? 1 : 0.3)
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(!canSave)
        .accessibilityLabel(
            isCreating ? L10n.string("Add account") : L10n.string("Save account changes")
        )
        .accessibilityIdentifier("account.save")
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 16) {
                Button {
                    focusedField = nil
                    showsLogoPicker = true
                } label: {
                    accountMark.overlay(alignment: .bottomTrailing) {
                        KualiaIconImage(icon: .pencil, size: 12)
                            .padding(7).background(KualiaPalette.canvas, in: Circle())
                    }
                }
                .buttonStyle(.kualiaHaptic)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(L10n.string("Change logo"))
                .accessibilityIdentifier("account.change-logo")

                TextField(L10n.string("Account name"), text: $draft.name, axis: .vertical)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(KualiaPalette.ink)
                    .lineLimit(1...3)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .focused($focusedField, equals: .name)
                    .onSubmit { focusedField = nil }
                    .accessibilityIdentifier("account.name")
            }
            Text(
                isCreating
                    ? L10n.string(
                        "A name that feels familiar. Your bank, your wallet, your rainy-day fund.")
                    : L10n.string(
                        "Give this account a name and identity that are easy to recognize.")
            )
            .font(.subheadline)
            .foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 12)
    }

    private var previewLogoURL: String? {
        if draftLogo.hasSelection { return draftLogo.previewURL }
        return draft.logoChoice.previewURL(
            current: draft.logoUrl == originalDraft.logoUrl
                ? (account?.resolvedLogoUrl ?? (draft.logoUrl.isEmpty ? nil : draft.logoUrl))
                : (draft.logoUrl.isEmpty ? nil : draft.logoUrl),
            defaultURL: account?.institutionLogoUrl)
    }

    @ViewBuilder
    private var accountMark: some View {
        if let data = draftLogo.photoData, let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFill()
                .frame(width: 64, height: 64).clipShape(Circle())
                .accessibilityLabel(draft.name)
        } else {
            AccountBrandMark(
                logoURL: previewLogoURL, name: draft.name, accountType: draft.accountType, size: 64)
        }
    }

    private var accountTypes: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle(L10n.string("Account type"))
            if isCreating {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(
                            [AccountCategory.banking, .credit, .investment, .loan], id: \.self
                        ) { category in
                            Button {
                                guard
                                    let type = AccountTypeOption.all.first(where: {
                                        $0.category == category
                                    })
                                else { return }
                                draft.accountType = type.id
                                balanceInput.isNegative = category.isLiability
                                updateBalance()
                                focusedField = nil
                            } label: {
                                Text(category.title)
                                    .font(
                                        .system(.subheadline, design: .rounded, weight: .semibold)
                                    )
                                    .padding(.horizontal, 16)
                                    .frame(minHeight: 44)
                                    .foregroundStyle(
                                        selectedCategory == category
                                            ? KualiaPalette.canvas : KualiaPalette.mutedInk
                                    )
                                    .background(
                                        selectedCategory == category
                                            ? KualiaPalette.ink : KualiaPalette.surface,
                                        in: Capsule())
                            }
                            .buttonStyle(.kualiaHaptic)
                            .accessibilityAddTraits(selectedCategory == category ? .isSelected : [])
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .modifier(HorizontalFilterScrollEdges(horizontalInset: 24))
            }
            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.flexible(), spacing: 10),
                    count: dynamicTypeSize.isAccessibilitySize ? 1 : 2), spacing: 10
            ) {
                ForEach(AccountTypeOption.all.filter { $0.category == selectedCategory }) { type in
                    Button {
                        draft.accountType = type.id
                        focusedField = nil
                    } label: {
                        HStack(spacing: 8) {
                            Text(type.title)
                                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            KualiaIconImage(
                                icon: draft.accountType == type.id
                                    ? .checkCircle : .circle, size: 18
                            )
                            .foregroundStyle(
                                draft.accountType == type.id
                                    ? KualiaPalette.ink : KualiaPalette.border)
                        }
                        .foregroundStyle(KualiaPalette.ink)
                        .padding(14)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                        .overlay {
                            RoundedRectangle(cornerRadius: 18)
                                .strokeBorder(
                                    draft.accountType == type.id
                                        ? KualiaPalette.ink.opacity(0.7) : .clear, lineWidth: 1.5)
                        }
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityAddTraits(draft.accountType == type.id ? .isSelected : [])
                }
            }
            if !isCreating {
                Text(
                    L10n.string(
                        "You can change the type within \(selectedCategory.title.lowercased()).")
                )
                .font(.footnote)
                .foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    private func startingBalance(workspace: TransactionFeedWorkspace) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle(L10n.string("Starting balance"))
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(workspace.currencyCode)
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(KualiaPalette.mutedInk)
                    Button(action: openAmountPad) {
                        Text(
                            balanceInput.calculator.previewAmount == nil
                                ? "—"
                                : MoneyAmountFormatter.string(
                                    minorUnits: draft.initialBalance,
                                    currencyCode: workspace.currencyCode,
                                    minorUnit: workspace.minorUnit, showsPositiveSign: false,
                                    usesAbsoluteValue: true)
                        )
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.45)
                        .foregroundStyle(KualiaPalette.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityLabel(
                        L10n.string("Starting balance in \(workspace.currencyCode)")
                    )
                    .accessibilityHint(L10n.string("Open calculator to edit starting balance"))
                    .accessibilityIdentifier("account.startingBalance")
                }
                HStack(spacing: 8) {
                    balanceSignButton(
                        title: selectedCategory.isLiability
                            ? L10n.string("Paid ahead") : L10n.string("Available"),
                        isNegative: false)
                    balanceSignButton(
                        title: selectedCategory.isLiability
                            ? L10n.string("Owed") : L10n.string("Overdrawn"),
                        isNegative: true)
                }
                if amountPadPresentation.sessionID != nil {
                    AmountCalculationCaption(
                        calculator: balanceInput.calculator,
                        accessibilityIdentifierPrefix: "account")
                }
            }
            .padding(20)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
            .background(BudgetAssignmentAnchor(categoryID: "starting-balance"))
            Text(
                draft.initialBalance == 0
                    ? L10n.string(
                        "Start at zero, or enter the balance before your first transaction.")
                    : L10n.string(
                        "This creates a starting balance transaction. \(balanceInput.isNegative ? L10n.string("The amount is recorded as money owed.") : L10n.string("The amount is recorded as money you have."))"
                    )
            )
            .font(.footnote)
            .foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func balanceSignButton(title: String, isNegative: Bool) -> some View {
        Button {
            balanceInput.isNegative = isNegative
            updateBalance()
        } label: {
            Label(title, icon: isNegative ? .minus : .plus)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .foregroundStyle(
                    balanceInput.isNegative == isNegative
                        ? KualiaPalette.ink : KualiaPalette.mutedInk
                )
                .background(
                    balanceInput.isNegative == isNegative
                        ? KualiaPalette.canvas : Color.clear, in: Capsule())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityAddTraits(balanceInput.isNegative == isNegative ? .isSelected : [])
    }

    private var additionalDetails: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle(L10n.string("Notes"))
            VStack(alignment: .leading, spacing: 18) {
                TextField(L10n.string("Notes"), text: $draft.notes, axis: .vertical)
                    .font(.body)
                    .lineLimit(3...6)
                    .focused($focusedField, equals: .notes)
                    .accessibilityIdentifier("account.notes")

            }
            .foregroundStyle(KualiaPalette.ink)
            .padding(20)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
            Text(
                L10n.string(
                    "To change the balance, edit a transaction or add a balance adjustment.")
            )
            .font(.footnote)
            .foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(.headline, design: .rounded, weight: .bold))
            .foregroundStyle(KualiaPalette.ink)
            .accessibilityAddTraits(.isHeader)
    }

    private func updateBalance() {
        if let amount = balanceInput.previewAmount { draft.initialBalance = amount }
    }

    private func openAmountPad() {
        if amountPadPresentation.isPresented {
            closeAmountPad()
            return
        }
        balanceInput.beginEditing()
        focusedField = nil
        if isKeyboardPresented {
            opensPadAfterKeyboard = true
        } else {
            withTransaction(Transaction(animation: nil)) { amountPadPresentation.prepare() }
        }
    }

    private func revealAmountPad(height: CGFloat, sessionID: UUID, containerFrame: CGRect) {
        guard amountPadPresentation.acceptsMeasurement(sessionID: sessionID) else { return }
        if abs(amountPadContentHeight - height) > 0.5 { amountPadContentHeight = height }
        guard amountPadPresentation.isPreparing else { return }
        let layout = PeekLayout(
            containerHeight: containerFrame.height, expansionHeight: height,
            isPresented: true, isCompactPresented: false, compactHeight: 0)
        let offset = balanceFocus.prepareReveal(
            categoryID: "starting-balance",
            viewportBottom: containerFrame.minY + layout.foregroundHeight - 32)
        padOpeningSessionID = sessionID
        var transaction = Transaction(animation: reduceMotion ? nil : .smooth(duration: 0.24))
        transaction.scrollContentOffsetAdjustmentBehavior = .disabled
        transaction.addAnimationCompletion(criteria: .removed) {
            guard padOpeningSessionID == sessionID else { return }
            padOpeningSessionID = nil
        }
        withTransaction(transaction) {
            amountPadPresentation.reveal(sessionID: sessionID)
            if let offset {
                let request = AccountBalanceRevealRequest(sessionID: sessionID, offset: offset)
                if let geometry = balanceFocus.geometry,
                    request.canApply(
                        contentHeight: geometry.contentSize.height,
                        viewportHeight: geometry.containerSize.height)
                {
                    balanceFocus.position.scrollTo(y: offset)
                } else {
                    pendingBalanceReveal = request
                }
            }
        }
    }

    private func applyPendingBalanceReveal() {
        guard let request = pendingBalanceReveal,
            request.sessionID == amountPadPresentation.sessionID,
            amountPadPresentation.isPresented,
            let geometry = balanceFocus.geometry,
            request.canApply(
                contentHeight: geometry.contentSize.height,
                viewportHeight: geometry.containerSize.height)
        else { return }
        pendingBalanceReveal = nil
        // At the old bottom limit SwiftUI clamps scrollTo to the old viewport.
        // Wait for the smaller viewport before sending this request for the first time.
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.24)) {
            balanceFocus.position.scrollTo(y: request.offset)
        }
    }

    private func cancelAmountPad() {
        balanceInput.cancelEditing()
        updateBalance()
        closeAmountPad()
    }

    private func closeAmountPad() {
        guard let sessionID = amountPadPresentation.sessionID else { return }
        balanceInput.finishEditing()
        pendingBalanceReveal = nil
        padOpeningSessionID = nil
        withAnimation(
            reduceMotion ? nil : .spring(duration: 0.38, bounce: 0.08),
            completionCriteria: .removed
        ) {
            amountPadPresentation.beginClosing()
        } completion: {
            amountPadPresentation.finishClosing(sessionID: sessionID)
        }
    }

    private func save() {
        guard canSave else { return }
        focusedField = nil
        if isCreating, let workspace = store.workspace {
            draft.initialBalanceDate = TransactionEditorDate.today(workspace: workspace)
        }
        Task {
            guard await store.save(draft: draft, account: account) else { return }
            if draftLogo.hasSelection {
                if account == nil, let id = store.lastCreatedAccountID {
                    // Retain the created account so a logo retry updates it instead of creating again.
                    account = AccountSnapshot(
                        id: id, name: draft.name, accountType: draft.accountType)
                    originalDraft = draft
                }
                isSavingLogo = true
                defer { isSavingLogo = false }
                do {
                    guard let account, let client = store.makeLogoClient(accountID: account.id)
                    else { throw CancellationError() }
                    try await draftLogo.persist(using: client)
                } catch {
                    store.actionErrorMessage = L10n.string(
                        "Couldn't save the logo. Please try again.")
                    return
                }
            }
            onSaved()
            dismiss()
        }
    }
}

/// Keep direction separate from the shared cents-first calculator.
struct AccountOpeningBalanceInput {
    var calculator: AmountCalculator
    var isNegative = false
    private var editingSnapshot: Snapshot?

    private struct Snapshot {
        let calculator: AmountCalculator
        let isNegative: Bool
    }

    mutating func beginEditing() {
        editingSnapshot = Snapshot(calculator: calculator, isNegative: isNegative)
    }

    mutating func cancelEditing() {
        guard let snapshot = editingSnapshot else { return }
        calculator = snapshot.calculator
        isNegative = snapshot.isNegative
        editingSnapshot = nil
    }

    mutating func finishEditing() { editingSnapshot = nil }

    init(minorUnit: Int) {
        calculator = AmountCalculator(amount: 0, minorUnit: minorUnit)
    }

    var amount: Int64? { calculator.amount.map { isNegative ? -$0 : $0 } }
    var previewAmount: Int64? { calculator.previewAmount.map { isNegative ? -$0 : $0 } }
}

/// A reveal outside the current scroll range must wait for the keypad's resized viewport.
struct AccountBalanceRevealRequest {
    let sessionID: UUID
    let offset: CGFloat

    func canApply(contentHeight: CGFloat, viewportHeight: CGFloat) -> Bool {
        viewportHeight > 0 && offset <= max(0, contentHeight - viewportHeight) + 0.5
    }
}

/// A swipe with unsaved edits uses the same discard prompt as the back button,
/// scoped to this editor only.
struct AccountEditorBackGestureGuard: UIViewControllerRepresentable {
    let isDirty: Bool
    let isSaving: Bool
    let onAttempt: () -> Void

    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.isProtected = isDirty || isSaving
        controller.onAttempt = isSaving ? nil : onAttempt
        controller.attach()
        DispatchQueue.main.async { [weak controller] in controller?.attach() }
    }

    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.detach()
    }

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        var isProtected = false
        var onAttempt: (() -> Void)?
        private var isVisible = false
        private var attachments: [Attachment] = []

        private struct Attachment {
            weak var gesture: UIGestureRecognizer?
            weak var delegate: (any UIGestureRecognizerDelegate)?
            let wasEnabled: Bool
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            isVisible = true
            attach()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            attach()
        }

        override func viewWillDisappear(_ animated: Bool) {
            isVisible = false
            detach()
            super.viewWillDisappear(animated)
        }

        func attach() {
            guard isProtected else {
                detach()
                return
            }
            guard isVisible, viewIfLoaded?.window != nil, let navigationController,
                navigationController.viewControllers.count > 1
            else { return }
            var gestures = [navigationController.interactivePopGestureRecognizer].compactMap { $0 }
            if #available(iOS 26.0, *),
                let contentPop = navigationController.interactiveContentPopGestureRecognizer
            {
                gestures.append(contentPop)
            }
            for gesture in gestures {
                if gesture.delegate !== self {
                    attachments.removeAll { $0.gesture === gesture }
                    attachments.append(
                        Attachment(
                            gesture: gesture, delegate: gesture.delegate,
                            wasEnabled: gesture.isEnabled))
                    gesture.delegate = self
                }
                // Hiding the native Back item for the dirty-draft confirmation can
                // disable these gestures. Let them reach the discard gate instead.
                gesture.isEnabled = true
            }
        }

        func detach() {
            for attachment in attachments {
                guard let gesture = attachment.gesture, gesture.delegate === self else { continue }
                gesture.delegate = attachment.delegate
                gesture.isEnabled = isProtected ? attachment.wasEnabled : true
            }
            attachments.removeAll()
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            // The content-pop recognizer also sees ordinary scrolling. Only a
            // deliberate horizontal back swipe should ask about discarding edits.
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: pan.view)
            let direction: CGFloat =
                view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? -1 : 1
            guard velocity.x * direction > 0, abs(velocity.x) > abs(velocity.y) else {
                return false
            }
            onAttempt?()
            return false
        }
    }
}

private enum AccountConfirmation: Identifiable {
    case close, reopen, delete
    var id: Self { self }
    var title: String {
        switch self {
        case .close: L10n.string("Close this account?")
        case .reopen: L10n.string("Reopen this account?")
        case .delete: L10n.string("Delete this account?")
        }
    }
    var buttonTitle: String {
        switch self {
        case .close: L10n.string("Close account")
        case .reopen: L10n.string("Reopen account")
        case .delete: L10n.string("Delete account")
        }
    }
    var message: String {
        switch self {
        case .close:
            L10n.string(
                "Its balance and history will be kept, and reviewed, cleared transactions will be reconciled. Any existing bank connection for this account will be disconnected. You can reopen it later as a manual account."
            )
        case .reopen:
            L10n.string("This account will return to your active accounts as a manual account.")
        case .delete: L10n.string("This empty account will be removed from your workspace.")
        }
    }
}
