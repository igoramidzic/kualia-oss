import SwiftUI

struct OnboardingFlowView: View {
    @Bindable var store: OnboardingStore
    let onSignOut: () async -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale
    @State private var showsAccounts = false
    @State private var signingOut = false
    @State private var showsCategoryPicker = false
    @State private var showsCurrencyPicker = false
    @State private var balanceReveal = OnboardingBalanceReveal()
    @State private var budgetPeek = BudgetPeekPresentation()
    @State private var targetCalculator: AmountCalculator?
    @State private var assignmentEditor: BudgetAssignmentEditor?
    @State private var amountPadPresentation = PeekPresentation()
    @State private var amountPadHeight: CGFloat = 274
    @State private var peekHeight: CGFloat = 86
    @State private var footerHeight: CGFloat = 84

    private var steps: [OnboardingStep] { OnboardingStep.allCases }
    private var stepIndex: Int { store.step.index }
    private var isBusy: Bool {
        store.isSaving || store.selectedAssignment?.isPending == true || signingOut
    }
    private var motion: Animation? {
        reduceMotion ? nil : .spring(duration: 0.38, bounce: 0.08)
    }
    private var keypadMotion: Animation? {
        // A finite curve finishes at the visible endpoint, without a spring's
        // settling tail delaying the RTA handoff and drawer removal.
        reduceMotion ? nil : .easeInOut(duration: 0.3)
    }
    private var peekUpdateMotion: Animation? {
        amountPadPresentation.sessionID == nil ? motion : keypadMotion
    }
    private var showsPeek: Bool {
        budgetPeek.isVisible(in: budgetPeekContext)
    }
    private var budgetPeekContext: BudgetPeekPresentation.Context {
        .init(
            workspaceID: store.budget?.workspace?.id,
            readyToAssign: balanceReveal.isHolding || store.step == .accounts
                ? balanceReveal.amount : store.readyToAssign,
            isEditing: amountPadPresentation.isPresented || amountPadPresentation.isClosing,
            isActive: stepIndex >= OnboardingStep.accounts.index && dataReady
                && store.accounts?.activeAccounts.isEmpty == false,
            isClosing: amountPadPresentation.isClosing)
    }
    private var dataReady: Bool {
        store.hasReadyWorkspace
    }

    var body: some View {
        GeometryReader { geometry in
            PeekContainer(
                presentation: amountPadPresentation, expansionHeight: amountPadHeight,
                isCompactPresented: showsPeek, compactHeight: peekHeight,
                animation: motion,
                compactAlignment: .top, bottomCornerRadius: 0,
                foregroundBottomCornerRadius: 34,
                foregroundColor: showsPeek || amountPadPresentation.sessionID != nil
                    ? peekBackground : KualiaPalette.canvas,
                expansionColor: peekBackground
            ) {
                page(bottomInset: showsPeek ? 0 : geometry.safeAreaInsets.bottom)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(KualiaPalette.canvas)
            } expansion: {
                amountPad
            } compact: {
                peek
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: { height in
                        if abs(peekHeight - height) > 0.5 { peekHeight = height }
                    }
            }
            .ignoresSafeArea(.container, edges: .bottom)
        }
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .animation(motion, value: store.step)
        .sheet(
            isPresented: $showsAccounts,
            onDismiss: {
                withAnimation(motion) {
                    balanceReveal.finishAccountSetup(
                        balance: store.readyToAssign, canContinue: store.canContinueFromAccounts)
                    budgetPeek.update(budgetPeekContext)
                }
            }
        ) {
            if let accounts = store.accounts {
                AccountSetupView(store: accounts)
            }
        }
        .sheet(isPresented: $showsCategoryPicker) {
            TransactionEditorPicker(
                title: L10n.string("Choose a category"), choices: categoryChoices,
                selectedID: store.selectedCategoryID, showsCategoryBalances: true,
                focusesSearchOnAppear: true
            ) { store.selectedCategoryID = $0 }
            .environment(\.categoryPickerBudget, store.budget)
        }
        .sheet(isPresented: $showsCurrencyPicker) {
            SettingsSelectionSheet(
                title: L10n.string("Budget currency"), kind: .currency,
                selectedValue: store.currencyCode
            ) { code in
                Task {
                    if await store.saveCurrency(code) { showsCurrencyPicker = false }
                }
            }
            .disabled(isBusy)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if isBusy { ProgressView(L10n.string("Saving currency…")) }
                    if let error = store.errorMessage {
                        Text(error).foregroundStyle(KualiaPalette.budgetNegative)
                    }
                    Text(
                        L10n.string(
                            "Choose the currency of your everyday accounts. Changing it doesn't convert existing balances."
                        )
                    )
                    .foregroundStyle(KualiaPalette.mutedInk)
                }
                .font(.footnote).padding(20).frame(maxWidth: .infinity)
                .background(KualiaPalette.canvas)
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .interactiveDismissDisabled(isBusy)
        }
        .onChange(of: store.needsAccountFunding, initial: true) { _, _ in
            store.requireAccountFunding()
        }
        .onChange(of: store.isSaving) { _, saving in
            if !saving { store.requireAccountFunding() }
        }
        .onChange(of: store.readyToAssign) { _, _ in updateAccountReveal() }
        .onChange(of: store.canContinueFromAccounts) { _, _ in updateAccountReveal() }
        .onChange(of: dataReady, initial: true) { _, _ in updateAccountReveal() }
        .onChange(of: budgetPeekContext, initial: true) { _, context in
            withAnimation(peekUpdateMotion) { budgetPeek.update(context) }
        }
        .task(id: budgetPeek.completionTaskID) { await celebrateBudgetCompletion() }
        .onChange(of: store.step) { _, _ in
            cancelAssignmentDraft()
            amountPadPresentation.dismissForFocusChange()
            budgetPeek.beginKeypadEditing()
            budgetPeek.update(budgetPeekContext)
            targetCalculator = nil
            store.requireAccountFunding()
            UIAccessibility.post(notification: .screenChanged, argument: nil)
        }
        .onDisappear { cancelAssignmentDraft() }
        .accessibilityIdentifier("onboarding.flow")
    }

    private func page(bottomInset: CGFloat) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    content
                    if let error = store.errorMessage ?? store.budget?.errorMessage
                        ?? store.accounts?.errorMessage ?? store.budget?.saveError
                    {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(error).font(.subheadline)
                            Button(L10n.string("Try again")) { store.retry() }.font(
                                .subheadline.weight(.semibold))
                            if store.step == .celebration {
                                Button(L10n.string("Review my assignment")) {
                                    store.go(to: .assign)
                                }
                                .font(.subheadline.weight(.semibold))
                            }
                        }
                        .foregroundStyle(KualiaPalette.budgetNegative)
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                        .accessibilityIdentifier("onboarding.error")
                    }
                }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(.horizontal, 25).padding(.top, 18).padding(.bottom, 28)
                .frame(maxWidth: .infinity)
            }
            .id(store.step)
            .scrollIndicators(.hidden)
            .transition(.opacity.combined(with: .offset(y: reduceMotion ? 0 : 10)))
            .scrollClipDisabled()
            .kualiaScrollEdges(for: [.top, .bottom])
            .onChange(of: amountPadPresentation.isPresented) { _, presented in
                if presented {
                    withTransaction(Transaction(animation: nil)) {
                        proxy.scrollTo(
                            store.step == .assign
                                ? "onboarding.assignmentAmount" : "onboarding.targetAmount",
                            anchor: .bottom)
                    }
                }
            }
        }
        .kualiaSafeAreaBar(edge: .top, spacing: 0) { toolbar }
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
            // Keep the button mounted for both account and keypad reveals. Account
            // eligibility and the balance arrive together after the account sheet closes.
            footer
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: { height in
                    if abs(footerHeight - height) > 0.5 { footerHeight = height }
                }
                .padding(.bottom, bottomInset)
                .opacity(showsFooter ? 1 : 0)
                .frame(height: showsFooter ? footerHeight + bottomInset : 0, alignment: .bottom)
                .clipped()
                .allowsHitTesting(showsFooter)
                .accessibilityHidden(!showsFooter)
                .transaction {
                    // Only the keypad owns a separate toolbar-collapse transaction.
                    // A standalone peek must animate the footer's safe-area padding too.
                    if amountPadPresentation.sessionID != nil { $0.animation = nil }
                }
        }
        .kualiaScrollEdgeEffectHidden(amountPadPresentation.isPresented, for: .bottom)
    }

    private var showsFooter: Bool {
        !amountPadPresentation.isPresented
            && (store.step != .accounts || balanceReveal.canContinue)
            && (store.step != .assign
                || (amountPadPresentation.sessionID == nil && store.canConfirmExistingAssignment))
    }

    private var toolbar: some View {
        HStack(spacing: 16) {
            if store.canGoBack {
                Button {
                    store.back()
                } label: {
                    OnboardingIcon(icon: .chevronLeft, size: 20).frame(width: 44, height: 44)
                }
                .accessibilityLabel(L10n.string("Previous step")).disabled(isBusy)
            } else {
                Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
            }
            ProgressView(value: Double(stepIndex + 1), total: Double(steps.count))
                .tint(KualiaPalette.budgetPositive)
                .accessibilityLabel(L10n.string("Setup progress"))
                .accessibilityValue(L10n.string("Step \(stepIndex + 1) of \(steps.count)"))
            Menu {
                Button {
                    signingOut = true
                    Task {
                        await onSignOut()
                        signingOut = false
                    }
                } label: {
                    Label {
                        Text(L10n.string("Log out"))
                    } icon: {
                        OnboardingIcon(icon: .logout, size: 18)
                    }
                }
            } label: {
                OnboardingIcon(icon: .dots, size: 22).frame(width: 44, height: 44)
            }
            .accessibilityLabel(L10n.string("Setup options")).disabled(isBusy)
        }
        .padding(.horizontal, 19).padding(.top, 6).padding(.bottom, 8)
        .buttonStyle(.kualiaHaptic)
    }

    @ViewBuilder private var content: some View {
        switch store.step {
        case .priorities: priorities
        case .housing: housing
        case .transport: transport
        case .household: household
        case .categories: categories
        case .accounts: accounts
        case .readyToAssign: readyToAssign
        case .target: target
        case .assign: assignment
        case .celebration:
            OnboardingIcon(icon: .badgeCheck, size: 40)
                .foregroundStyle(KualiaPalette.budgetPositive)
            heading(
                L10n.string("Your money has\nits first job."),
                L10n.string(
                    "You added your money, set a target, and funded a category. Repeat that little loop whenever you're paid."
                )
            )
            note(
                L10n.string("Plans can change. Move money between categories whenever life does."),
                icon: .transactions)
        }
    }

    private func heading(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(.largeTitle, design: .rounded, weight: .bold))
                .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            Text(detail).font(.body).foregroundStyle(KualiaPalette.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var priorities: some View {
        VStack(alignment: .leading, spacing: 14) {
            heading(
                L10n.string("What are you\nmaking room for?"),
                L10n.string("Pick what matters. We'll give those goals their own categories.")
            )
            .padding(.bottom, 12)
            goal(
                L10n.string("A little breathing room"), .shield, "emergency",
                L10n.string("Build a cushion for surprises"))
            goal(L10n.string("A trip to look forward to"), .plane, "vacation")
            goal(L10n.string("Less debt"), .arrowDownRight, "debt")
            goal(L10n.string("A place of my own"), .house, "home")
            goal(L10n.string("Future me"), .leaf, "retirement")
        }
    }

    private func goal(_ title: String, _ icon: KualiaIcon, _ key: String, _ detail: String? = nil)
        -> some View
    {
        OnboardingChoice(
            title: title, icon: icon, detail: detail,
            selected: store.answers.financialGoals.contains(key)
        ) {
            toggle(key, in: &store.answers.financialGoals)
        }
    }

    private var housing: some View {
        VStack(alignment: .leading, spacing: 14) {
            heading(L10n.string("At home"), L10n.string("Which best describes where you live?"))
                .padding(.bottom, 12)
            housingChoice(L10n.string("I rent"), .key, "rent")
            housingChoice(L10n.string("I own my home"), .house, "own")
            housingChoice(L10n.string("I live with family"), .family, "family")
        }
    }

    private func housingChoice(_ title: String, _ icon: KualiaIcon, _ value: String) -> some View {
        OnboardingChoice(title: title, icon: icon, selected: store.answers.housing == value) {
            store.answers.housing = value
        }
    }

    private var transport: some View {
        VStack(alignment: .leading, spacing: 14) {
            heading(
                L10n.string("Getting around"),
                L10n.string("Choose all the ways you get from here to there.")
            ).padding(
                .bottom, 12)
            transportChoice(L10n.string("Car"), .car, "car")
            transportChoice(L10n.string("Public transit"), .bus, "transit")
            transportChoice(L10n.string("Walk or bike"), .bicycle, "walk_bike")
        }
    }

    private func transportChoice(_ title: String, _ icon: KualiaIcon, _ value: String) -> some View
    {
        OnboardingChoice(
            title: title, icon: icon, selected: store.answers.transportation.contains(value)
        ) {
            toggle(value, in: &store.answers.transportation)
        }
    }

    private var household: some View {
        VStack(alignment: .leading, spacing: 14) {
            heading(
                L10n.string("Who else is in\nthe picture?"),
                L10n.string("Choose everyone your budget makes room for.")
            )
            .padding(.bottom, 12)
            OnboardingChoice(
                title: L10n.string("Just me"), icon: .user,
                selected: store.answers.household.contains("just_me")
            ) {
                store.answers.household = ["just_me"]
            }
            householdChoice(L10n.string("Partner"), .users, "partner")
            householdChoice(L10n.string("Children"), .child, "children")
            householdChoice(L10n.string("Pets"), .paw, "pets")
        }
    }

    private func householdChoice(_ title: String, _ icon: KualiaIcon, _ value: String) -> some View
    {
        OnboardingChoice(
            title: title, icon: icon, selected: store.answers.household.contains(value)
        ) {
            toggle(value, in: &store.answers.household)
            store.answers.household.remove("just_me")
            if store.answers.household.isEmpty { store.answers.household.insert("just_me") }
        }
    }

    private var categories: some View {
        VStack(alignment: .leading, spacing: 24) {
            heading(
                L10n.string("Meet your\ncategories."),
                L10n.string(
                    "Categories work like envelopes: set money aside for each one, then see what's left to spend. Here's a starting point you can make your own."
                )
            )
            if let budget = store.budget, budget.hasLoaded {
                VStack(spacing: 16) {
                    ForEach(budget.groups.filter { $0.rows.contains { !$0.isCreditCard } }) {
                        group in
                        BudgetCategoryGroupPreview(
                            group: group, currencyCode: store.currencyCode,
                            minorUnit: store.minorUnit)
                    }
                }
            } else {
                ProgressView(L10n.string("Preparing your envelopes…")).frame(maxWidth: .infinity)
            }
            note(
                L10n.string("No perfect budget required. Start here, adjust as you go."),
                icon: .sparkles)
        }
    }

    private var accounts: some View {
        VStack(alignment: .leading, spacing: 24) {
            heading(
                L10n.string("Bring your\nmoney into view."),
                L10n.string(
                    "Add a checking, savings, or other banking account with money in it. Connect your bank, or enter a balance yourself."
                )
            )
            if let accounts = store.accounts {
                VStack(spacing: 8) {
                    ForEach(accounts.activeAccounts) { account in
                        HStack {
                            Label {
                                Text(account.name)
                            } icon: {
                                OnboardingIcon(
                                    icon: account.category == .banking
                                        ? .bank
                                        : account.category == .credit ? .creditCard : .accounts)
                            }
                            Spacer()
                            Text(money(Decimal(account.currentBalance))).fontWeight(.semibold)
                        }
                        .font(.subheadline).padding(18)
                        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                    }
                }
                if !accounts.activeAccounts.isEmpty && !store.canContinueFromAccounts {
                    note(
                        store.hasFundedBankingAccount
                            ? L10n.string(
                                "We need money in Ready to Assign for the next step. Add another checking or savings account with money available to budget."
                            )
                            : L10n.string(
                                "Your account is saved. To continue, add a checking, savings, or other banking account with a positive balance. Credit cards, loans, and investments don't add money to Ready to Assign."
                            ),
                        icon: .info)
                }
            }
            Button(action: presentAccounts) {
                Label {
                    Text(L10n.string("Add an account"))
                } icon: {
                    OnboardingIcon(icon: .plus, size: 20)
                }
                .font(.headline).frame(maxWidth: .infinity, minHeight: 56)
                .foregroundStyle(
                    balanceReveal.canContinue ? KualiaPalette.ink : KualiaPalette.canvas
                )
                .background(
                    balanceReveal.canContinue ? KualiaPalette.surface : KualiaPalette.ink,
                    in: Capsule())
            }
            .buttonStyle(.kualiaHaptic).disabled(isBusy || !dataReady)
            .opacity(isBusy || !dataReady ? 0.45 : 1)
            .accessibilityIdentifier("onboarding.addAccount")
            Button {
                showsCurrencyPicker = true
            } label: {
                HStack(spacing: 6) {
                    Text(L10n.string("Budget currency · \(store.currencyCode)"))
                    OnboardingIcon(icon: .chevronDown, size: 12)
                }
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.kualiaHaptic).disabled(isBusy || !dataReady)
            .accessibilityLabel(L10n.string("Change budget currency, \(store.currencyCode)"))
            .accessibilityIdentifier("onboarding.currency")

        }
    }

    private var readyToAssign: some View {
        VStack(alignment: .leading, spacing: 22) {
            OnboardingIcon(icon: .budget, size: 32)
                .foregroundStyle(KualiaPalette.budgetPositive)
            heading(
                L10n.string("This is your\nstarting point."),
                L10n.string(
                    "\(money(store.readyToAssign)) is ready for a job. Ready to Assign is the money in your budget that hasn't gone into categories yet."
                )
            )
            note(
                L10n.string(
                    "Only plan with money you have. When new money arrives, give that a job too."),
                icon: .checkCircle)
        }
    }

    private var target: some View {
        VStack(alignment: .leading, spacing: 24) {
            heading(
                L10n.string("What should your\nfirst category hold?"),
                L10n.string(
                    "A target is the amount you want to set aside each month. It guides your plan; it doesn't move money."
                )
            )
            TransactionEditorGroup {
                TransactionEditorField(
                    title: L10n.string("Choose a category"),
                    value: store.selectedCategory?.name ?? L10n.string("Choose a category"),
                    symbol: .category, icon: .category, placeholder: store.selectedCategory == nil
                ) {
                    amountPadPresentation.dismissForFocusChange()
                    showsCategoryPicker = true
                }
                .disabled(isBusy)
                .accessibilityIdentifier("onboarding.chooseCategory")
                Divider().padding(.horizontal, 18)
                VStack(alignment: .leading, spacing: 8) {
                    Text(L10n.string("Monthly target · \(store.currencyCode)")).font(.headline)
                    Button(action: openAmountPad) {
                        HStack {
                            Text(targetAmountLabel)
                                .font(
                                    .system(size: 42, weight: .semibold, design: .rounded)
                                        .monospacedDigit()
                                )
                                .contentTransition(reduceMotion ? .opacity : .numericText())
                                .lineLimit(1).minimumScaleFactor(0.5)
                            Spacer(minLength: 12)
                            OnboardingIcon(icon: .newEntry, size: 20)
                                .foregroundStyle(KualiaPalette.mutedInk)
                        }
                        .padding(12)
                        .background(KualiaPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12).strokeBorder(
                                amountPadPresentation.isPresented
                                    ? KualiaPalette.ink.opacity(0.45) : KualiaPalette.border,
                                lineWidth: 1)
                        }
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(isBusy)
                    .accessibilityLabel(
                        L10n.string("Monthly target amount in \(store.currencyCode)")
                    )
                    .accessibilityValue(targetAmountLabel)
                    .accessibilityHint(L10n.string("Open calculator to edit amount"))
                    .accessibilityIdentifier("onboarding.targetAmount")
                    if let targetCalculator {
                        AmountCalculationCaption(
                            calculator: targetCalculator,
                            accessibilityIdentifierPrefix: "onboarding-target")
                    }
                    Text(L10n.string("Start small. You can change it anytime."))
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                }
                .padding(18)
                .id("onboarding.targetAmount")
            }
        }
    }

    @ViewBuilder private var assignment: some View {
        if let budget = store.budget, let row = store.selectedAssignment {
            VStack(alignment: .leading, spacing: 24) {
                heading(
                    L10n.string("Give that target\nsome money."),
                    L10n.string(
                        "Tap the amount with the pencil to assign money. Enter an amount, or use the shortcut to fill your target."
                    )
                )
                BudgetCategoryRow(
                    row: row, currencyCode: store.currencyCode, minorUnit: store.minorUnit,
                    isEditing: assignmentEditor != nil, calculator: budget.assignmentCalculator,
                    canEdit: !isBusy && budget.canEdit, amountColumnWidth: 96,
                    onEdit: openAssignmentPad,
                    emphasizesAssignment: assignmentEditor == nil && row.assigned == 0
                        && !row.isPending && !isBusy && budget.canEdit,
                    showsAssignmentEditIcon: true
                )
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                .id("onboarding.assignmentAmount")
                if store.readyToAssign < 0 {
                    note(
                        L10n.string(
                            "You've assigned more than you have. Lower the amount until Ready to Assign is zero or above."
                        ),
                        icon: .info)
                } else if store.canConfirmExistingAssignment {
                    note(
                        L10n.string(
                            "Your money has a job. You can keep building this category as more money arrives."
                        ),
                        icon: .checkCircle)
                } else {
                    note(
                        L10n.string(
                            "Start with the money you have. You can finish funding the target later."
                        ),
                        icon: .bolt)
                }
            }
        } else {
            ProgressView(L10n.string("Loading your category…"))
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            Button {
                performPrimary()
            } label: {
                HStack(spacing: 10) {
                    if isBusy { ProgressView().tint(KualiaPalette.canvas) }
                    Text(primaryTitle)
                    if !isBusy { OnboardingIcon(icon: .arrowRight, size: 20) }
                }
                .font(.headline).frame(maxWidth: .infinity, minHeight: 56)
                .foregroundStyle(KualiaPalette.canvas)
                .background(KualiaPalette.ink, in: Capsule())
            }
            .buttonStyle(.kualiaHaptic).disabled(primaryDisabled)
            .opacity(primaryDisabled ? 0.45 : 1)
            .accessibilityIdentifier("onboarding.continue")

        }
        .frame(maxWidth: 520).padding(.horizontal, 25).padding(.vertical, 14)
        .frame(maxWidth: .infinity)
    }

    private var primaryTitle: String {
        switch store.step {
        case .priorities: L10n.string("That's what matters")
        case .housing, .transport: L10n.string("Continue")
        case .household:
            store.isSaving
                ? L10n.string("Making your categories…") : L10n.string("Build my categories")
        case .categories: L10n.string("Looks like me")
        case .accounts: L10n.string("Continue")
        case .readyToAssign: L10n.string("Set one small target")
        case .target: L10n.string("Save my target")
        case .assign: L10n.string("Continue")
        case .celebration: L10n.string("See what comes next")
        }
    }

    private var primaryDisabled: Bool {
        if isBusy { return true }
        switch store.step {
        case .categories: return store.categories.isEmpty || !dataReady
        case .celebration: return !dataReady
        case .accounts, .readyToAssign: return !store.canContinueFromAccounts
        case .target:
            return store.selectedCategoryID == nil || store.targetAmount == nil || !dataReady
                || (targetCalculator != nil && targetCalculator?.amount == nil)
        case .assign:
            return !store.canConfirmExistingAssignment
        default: return false
        }
    }

    private func performPrimary() {
        switch store.step {
        case .household: Task { _ = await store.prepareBudget() }
        case .target: Task { _ = await store.saveTarget() }
        case .assign:
            _ = store.confirmExistingAssignment()
        case .celebration: Task { _ = await store.finish() }
        default: store.advance()
        }
    }

    private var peekAmount: Decimal { budgetPeek.displayedReadyToAssign }

    private var peekBackground: Color {
        KualiaPalette.budgetInputBackground(tone: budgetPeek.tone)
    }

    private var peek: some View {
        BudgetReadyToAssignPeek(
            readyToAssign: peekAmount, currencyCode: store.currencyCode,
            minorUnit: store.minorUnit,
            isAmountPadPresented: amountPadPresentation.isPresented,
            showsCompletion: budgetPeek.showsCompletion,
            usesFullContrast: true
        )
        .redacted(reason: dataReady ? [] : .placeholder)
        .padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 18)
        .frame(minHeight: 68)
        .fixedSize(horizontal: false, vertical: true)
        .background(peekBackground)
        .accessibilityIdentifier("onboarding.readyToAssign")
    }

    private var categoryChoices: [TransactionEditorChoice] {
        store.budget?.groups.flatMap { group in
            group.rows.filter { !$0.isCreditCard }.map { row in
                TransactionEditorChoice(
                    id: row.id, title: row.name, symbol: nil,
                    groupID: group.id, groupTitle: group.name)
            }
        } ?? []
    }

    private var targetAmountLabel: String {
        if let targetCalculator {
            return targetCalculator.previewAmount.map { money(Decimal($0)) } ?? "—"
        }
        return money(Decimal(store.targetAmount ?? 0))
    }

    @ViewBuilder private var amountPad: some View {
        if let sessionID = amountPadPresentation.sessionID {
            if let editor = assignmentEditor, let budget = store.budget {
                AmountPad(
                    calculator: Binding(
                        get: {
                            budget.assignmentCalculator
                                ?? AmountCalculator(
                                    amount: editor.assignedAmount, minorUnit: editor.minorUnit,
                                    allowsNegativeAmounts: true)
                        },
                        set: { budget.updateCalculator($0, editorID: editor.id) }),
                    accessibilityIdentifierPrefix: "onboarding-assignment",
                    onDismiss: closeAmountPad,
                    onCancel: { closeAssignmentPad(cancelling: true) },
                    onContentHeightChange: { revealAmountPad(height: $0, sessionID: sessionID) },
                    backgroundColor: peekBackground, topPadding: 0,
                    headerAction: .init(
                        title: budget.categoryAssignment(for: editor).title(
                            currencyCode: editor.currencyCode, minorUnit: editor.minorUnit,
                            locale: locale),
                        isEnabled: budget.hasTarget(for: editor)
                            && budget.categoryAssignment(for: editor).isEnabled,
                        perform: {
                            if budget.prepareTargetAssignment(editorID: editor.id) {
                                closeAmountPad()
                            }
                        })
                )
                .disabled(isBusy)
            } else {
                AmountPad(
                    calculator: targetCalculatorBinding,
                    accessibilityIdentifierPrefix: "onboarding-target",
                    onDismiss: closeAmountPad,
                    onContentHeightChange: { revealAmountPad(height: $0, sessionID: sessionID) },
                    backgroundColor: peekBackground, topPadding: 0
                )
                .disabled(isBusy)
            }
        }
    }

    private func revealAmountPad(height: CGFloat, sessionID: UUID) {
        guard amountPadPresentation.acceptsMeasurement(sessionID: sessionID) else { return }
        if abs(amountPadHeight - height) > 0.5 { amountPadHeight = height }
        guard amountPadPresentation.isPreparing else { return }
        var transaction = Transaction(animation: keypadMotion)
        transaction.scrollContentOffsetAdjustmentBehavior = .disabled
        withTransaction(transaction) { amountPadPresentation.reveal(sessionID: sessionID) }
    }

    private func openAssignmentPad() {
        let hasVisiblePeek = showsPeek
        guard !isBusy, let budget = store.budget else { return }
        if amountPadPresentation.isPresented {
            closeAmountPad()
            return
        }
        guard let categoryID = store.selectedCategory?.id,
            let editor = budget.beginEditing(categoryID)
        else { return }
        budgetPeek.beginKeypadEditing()
        assignmentEditor = editor
        withTransaction(Transaction(animation: nil)) {
            amountPadPresentation.prepare(hasVisiblePeek: hasVisiblePeek)
        }
    }

    private func cancelAssignmentDraft() {
        if let editor = assignmentEditor { store.budget?.cancelEditing(editorID: editor.id) }
        assignmentEditor = nil
    }

    private func closeAssignmentPad(cancelling: Bool) {
        guard let editor = assignmentEditor, let sessionID = amountPadPresentation.sessionID,
            !amountPadPresentation.isClosing
        else { return }
        if !cancelling && store.budget?.assignmentCalculator?.amount == nil { return }
        budgetPeek.beginKeypadClosing(
            id: sessionID,
            hasChanges: !cancelling && store.budget?.hasAssignmentChanges == true)
        withAnimation(keypadMotion, completionCriteria: .removed) {
            amountPadPresentation.beginClosing()
        } completion: {
            amountPadPresentation.finishClosing(sessionID: sessionID)
            if amountPadPresentation.sessionID == nil {
                assignmentEditor = nil
                budgetPeek.finishKeypadClosing(id: sessionID, context: budgetPeekContext)
            }
        }
        // Saving publishes row and balance changes independently of the drawer
        // animation. Only the drawer's movement should determine its completion.
        if cancelling {
            store.budget?.cancelEditing(editorID: editor.id)
        } else {
            store.budget?.finishEditing()
        }
    }

    private var targetCalculatorBinding: Binding<AmountCalculator> {
        Binding(
            get: {
                targetCalculator
                    ?? AmountCalculator(
                        amount: store.targetAmount ?? 0, minorUnit: store.minorUnit)
            },
            set: {
                targetCalculator = $0
                if let amount = $0.amount {
                    store.targetAmountText = OnboardingAmount.text(
                        minorUnits: amount, minorUnit: store.minorUnit)
                }
            })
    }

    private func openAmountPad() {
        let hasVisiblePeek = showsPeek
        if amountPadPresentation.isPresented {
            closeAmountPad()
        } else {
            budgetPeek.beginKeypadEditing()
            if targetCalculator == nil { targetCalculator = targetCalculatorBinding.wrappedValue }
            withTransaction(Transaction(animation: nil)) {
                amountPadPresentation.prepare(hasVisiblePeek: hasVisiblePeek)
            }
        }
    }

    private func closeAmountPad() {
        if assignmentEditor != nil {
            closeAssignmentPad(cancelling: false)
            return
        }
        guard let sessionID = amountPadPresentation.sessionID,
            !amountPadPresentation.isClosing
        else { return }
        budgetPeek.beginKeypadClosing(id: sessionID, hasChanges: false)
        withAnimation(keypadMotion, completionCriteria: .removed) {
            amountPadPresentation.beginClosing()
        } completion: {
            amountPadPresentation.finishClosing(sessionID: sessionID)
            if amountPadPresentation.sessionID == nil {
                budgetPeek.finishKeypadClosing(id: sessionID, context: budgetPeekContext)
            }
        }
    }

    private func celebrateBudgetCompletion() async {
        guard let id = budgetPeek.completionTaskID else { return }
        do {
            try await Task.sleep(for: BudgetCompletionTiming.beforeMessage)
            try Task.checkCancellation()
            withAnimation(
                reduceMotion ? nil : .smooth(duration: BudgetCompletionTiming.messageTransition)
            ) {
                budgetPeek.showCompletion(id: id)
            }
            try await Task.sleep(for: .seconds(2))
            try Task.checkCancellation()
            withAnimation(motion, completionCriteria: .removed) {
                budgetPeek.beginCompletionClosing(id: id)
            } completion: {
                budgetPeek.finishCompletionClosing(id: id)
            }
        } catch { return }
    }

    private func updateAccountReveal() {
        guard dataReady else { return }
        withAnimation(peekUpdateMotion) {
            balanceReveal.update(
                store.readyToAssign, canContinue: store.canContinueFromAccounts)
            budgetPeek.update(budgetPeekContext)
        }
    }

    private func presentAccounts() {
        balanceReveal.beginAccountSetup()
        showsAccounts = true
    }

    private func note(_ text: String, icon: KualiaIcon) -> some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            OnboardingIcon(icon: icon, size: 20)
        }
        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
    }
    private func toggle(_ value: String, in selection: inout Set<String>) {
        if selection.contains(value) { selection.remove(value) } else { selection.insert(value) }
    }
    private func money(_ value: Decimal) -> String {
        MoneyAmountFormatter.string(
            decimalMinorUnits: value, currencyCode: store.currencyCode, minorUnit: store.minorUnit,
            showsPositiveSign: false, usesAbsoluteValue: false, locale: locale)
    }
}
