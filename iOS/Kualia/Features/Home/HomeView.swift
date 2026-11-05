import SwiftUI

struct HomeView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.locale) private var locale
    @Environment(\.openAppSettings) private var openAppSettings

    let transactionFeedStore: TransactionFeedStore
    let budgetStore: BudgetStore
    let accountsStore: AccountsStore
    var reportsStore: ReportsStore = .preview
    @State private var glowScrollState = HomeGlowScrollState()
    @State private var selectedAccount: HomeAccountDestination?
    var appSession: AppSessionStore? = nil
    var assistantStore: AssistantStore? = nil
    var reviewPrompt: ReviewPromptStore? = nil
    var appUpdates: AppUpdatesStore? = nil
    var allowsReviewPrompt = true
    var widgetNavigation: WidgetNavigationStore? = nil
    var openWidgetsSettings: () -> Void = {}
    var reloadWidgets: () -> Void = {}
    @State private var reviewTransactionSavedAt: Date?
    var isSettingsPresented = false

    @State private var isBudgetMonthPickerPresented = false
    @State private var isReportRangePresented = false
    @State private var isBudgetPreferencesPresented = false
    @State private var budgetPlanWorkspace: BudgetWorkspace?
    @State private var accountCreationRequest = 0
    @State private var accountOrderWorkspace: BudgetWorkspace?
    @State private var categoryDetails: BudgetCategoryDetailsDestination?
    @State private var budgetTargetEditor: BudgetTargetDestination?
    @State private var presentedSheet: HomeSheetDestination?
    @State private var transactionSearchStore: TransactionSearchStore?
    @State private var pendingReceipt: TransactionMutationReceipt?
    @State private var pendingAccountChange: TransactionMutationReceipt?
    @State private var transactionPeek = TransactionPeekPresentation()
    @State private var transactionPeekHeight: CGFloat = 100
    @State private var transactionSelectionPeek = PeekPresentation()
    @State private var transactionSelectionPeekHeight: CGFloat = 100
    @State private var localNavigation = HomeNavigationState()
    @State private var transitionPeekHeight: CGFloat = 68
    @State private var contentPresentation = HomeContentPresentation()
    @ScaledMetric(relativeTo: .body) private var minimumPeekHeight: CGFloat = 68
    @State private var budgetPeek = BudgetPeekPresentation()
    @State private var budgetPeekNavigation = HomeBudgetPeekNavigation()
    @State private var budgetEditor: BudgetAssignmentEditor?
    @State private var budgetPadPresentation = PeekPresentation()
    @State private var moneyMovePad = PeekPresentation()
    @State private var moneyMovePadHeight: CGFloat = 254
    @State private var budgetPadOpeningSessionID: UUID?
    @State private var budgetAssignmentFocusRegistry = BudgetAssignmentFocusRegistry()
    private var plannedStore: PlannedStore? { transactionFeedStore.agenda }
    @State private var widgetPlannedSelection: PlannedSelection?
    @State private var budgetPadContentHeight: CGFloat = 254
    @State private var budgetPeekContentHeight: CGFloat = 68

    private var budgetAssignmentFocus: BudgetAssignmentFocus {
        budgetAssignmentFocusRegistry.focus(
            workspaceID: budgetStore.workspace?.id)
    }

    private var navigationState: HomeNavigationState { appSession?.navigation ?? localNavigation }
    private var isTransitioning: Bool { appSession?.isTransitioning ?? false }

    private var presentedHome: some View {
        fullScreenHome
            .ignoresSafeArea(.keyboard)
            .sheet(item: $presentedSheet, onDismiss: revealSavedTransaction) { destination in
                HomeSheetContent(
                    destination: destination,
                    transactionFeedStore: transactionFeedStore,
                    onSaved: { pendingReceipt = $0 })
            }
            .sheet(item: $budgetTargetEditor) { destination in
                BudgetTargetView(store: budgetStore, destination: destination) {
                    guard budgetTargetEditor?.id == destination.id,
                        let editorID = destination.assignmentEditorID,
                        budgetEditor?.id == editorID
                    else { return }
                    var transaction = Transaction(animation: nil)
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { dismissBudgetPad() }
                }
            }
            .sheet(item: $categoryDetails) { destination in
                BudgetCategoryDetailsSheet(
                    budget: budgetStore, feed: transactionFeedStore, destination: destination)
            }
            .sheet(isPresented: $isBudgetPreferencesPresented) {
                BudgetPreferencesSheet()
            }
            .sheet(item: $budgetPlanWorkspace) { workspace in
                BudgetPlanView(store: budgetStore, workspaceID: workspace.id)
            }
            .sheet(item: $accountOrderWorkspace) { workspace in
                AccountsReorderSheet(store: accountsStore, workspaceID: workspace.id)
            }
            .sheet(item: $widgetPlannedSelection) { selection in
                if let plannedStore,
                    plannedStore.workspace.id == transactionFeedStore.workspace?.id
                {
                    PlannedDetailSheet(
                        store: plannedStore, feed: transactionFeedStore, selection: selection)
                }
            }
            .sheet(isPresented: $isReportRangePresented) {
                ReportRangeSheet(store: reportsStore)
            }
            .sheet(isPresented: $isBudgetMonthPickerPresented) {
                BudgetMonthPicker(
                    store: budgetStore,
                    onSelect: { month in
                        closeBudgetPad()
                        budgetStore.selectMonth(month)
                    })
            }
            .onChange(of: budgetStore.moneyMove?.isEnteringAmount == true) { _, editing in
                if editing {
                    withTransaction(Transaction(animation: nil)) {
                        moneyMovePad.prepare(hasVisiblePeek: showsBudgetReadyToAssign)
                    }
                } else if let id = moneyMovePad.sessionID {
                    withAnimation(amountPadAnimation, completionCriteria: .removed) {
                        moneyMovePad.beginClosing()
                    } completion: {
                        moneyMovePad.finishClosing(sessionID: id)
                    }
                }
            }
            .task(id: widgetRequestReadiness) { await openPendingWidgetRequest() }
            .task(id: transactionPeek.animationID) {
                await animateTransactionPeek()
            }
            // This context owns workspace changes too. A second reset when the
            // session changes can erase the new RTA after this callback runs.
            .onChange(of: budgetPeekContext, initial: true) { previous, context in
                // The initial callback runs before the first layout. Only later
                // changes should animate the Peek and the native bottom bar.
                var transaction = Transaction(animation: amountPadAnimation)
                transaction.disablesAnimations = previous == context
                if previous == context { transaction.animation = nil }
                withTransaction(transaction) { budgetPeek.update(context) }
            }
            .task(id: closingBudgetPadSessionID) { await finishBudgetPadClosing() }
            .task(id: budgetPeek.completionTaskID) { await celebrateBudgetCompletion() }
            .task(id: isTransitioning ? nil : budgetPeekNavigation.request?.id) {
                guard !isTransitioning, let id = budgetPeekNavigation.request?.id else { return }
                // Give page selection the first scheduling opportunity without
                // imposing a fixed pause on every Budget navigation.
                await Task.yield()
                guard !Task.isCancelled else { return }
                let closingBackground = budgetInputBackground
                withAnimation(amountPadAnimation, completionCriteria: .removed) {
                    budgetPeekNavigation.finish(id: id, closingBackground: closingBackground)
                } completion: {
                    budgetPeekNavigation.finishClosing(id: id)
                }
            }
            .onChange(of: finishedQuickAssignID) { _, id in
                if id != nil { closeQuickAssign() }
            }
            .onChange(of: budgetStore.quickAssignUndo?.id) { _, id in
                if id == nil { closeQuickAssignCompletion() }
            }
            .task(id: quickAssignUndoTaskID) { await expireQuickAssignUndo() }
            .task(id: moneyMoveReceiptTaskID) { await expireMoneyMoveReceipt() }
            .task(id: closingMoneyMoveReceiptID) { await finishMoneyMoveReceiptClosing() }
            .animation(stateAnimation, value: budgetStore.quickAssignUndo?.id)
            .onChange(of: presentedSheet) { _, sheet in
                if sheet != nil { closeTransactionPeek() }
            }
            .onChange(of: transactionFeedStore.workspace?.id) { _, _ in
                presentedSheet?.transactionEditor?.stop()
                transactionSearchStore?.stop()
                transactionSearchStore = nil
                pendingReceipt = nil
                transactionPeek.dismiss()
                transactionSelectionPeek.dismissForFocusChange()
                presentedSheet = nil
            }
            .onChange(of: transactionFeedStore.isSelecting) { _, selecting in
                if selecting {
                    transactionPeek.dismiss()
                    transactionSelectionPeek.prepare()
                } else {
                    closeTransactionSelectionPeek()
                }
            }
            .onChange(of: transactionFeedStore.receiptPresentationOwner) { _, owner in
                if owner != nil { transactionPeek.dismiss() }
            }
            .onChange(of: transactionFeedStore.selectionSaveRevision) { _, _ in reloadWidgets() }
            .onChange(of: transactionFeedStore.mutationReceiptRevision) { _, _ in
                reloadWidgets()
                guard !transactionFeedStore.isSelecting,
                    transactionFeedStore.receiptPresentationOwner == nil
                else { return }
                guard let receipt = transactionFeedStore.latestMutationReceipt else {
                    transactionPeek.dismiss()
                    return
                }
                dismissBudgetPad()
                let animation =
                    transactionPeek.receipt?.id == receipt.id && !reduceMotion
                    ? Animation.easeInOut(duration: TransactionPeekTiming.balanceAnimation) : nil
                withTransaction(Transaction(animation: animation)) {
                    transactionPeek.present(
                        receipt,
                        showsUndo: !transactionFeedStore.deletedEntries.isEmpty
                            && (receipt.kind == .deleted || !receipt.isPending),
                        hasVisiblePeek: showsBudgetReadyToAssign || isTransitioning)
                }
            }
    }

    private var navigationContent: some View {
        presentedHome
            .toolbar(.hidden, for: .navigationBar)
            .modifier(
                HomeAccountNavigation(
                    selection: $selectedAccount, store: accountsStore,
                    onAccountChanged: { pendingAccountChange = $0 }))
    }

    private var observedNavigation: some View {
        navigationContent
            .onChange(of: selectedAccount) { _, account in
                guard account == nil, let receipt = pendingAccountChange else { return }
                pendingAccountChange = nil
                guard receipt.workspace.id == accountsStore.workspace?.id else { return }
                withTransaction(Transaction(animation: nil)) {
                    transactionPeek.present(
                        receipt, showsUndo: receipt.canUndoAccountChange,
                        hasVisiblePeek: showsBudgetReadyToAssign || isTransitioning)
                }
            }
            .onChange(of: selectedPage, initial: true) { _, page in
                if page != .reports { isReportRangePresented = false }
                if page != .transactions {
                    transactionFeedStore.endSelection()
                    transactionSelectionPeek.dismissForFocusChange()
                }
                budgetPeekNavigation.navigate(
                    workspaceID: budgetStore.workspace?.id, isBudgetSelected: page == .budget)
            }
            .onDisappear {
                dismissBudgetPad()
                transactionPeek.dismiss()
                transactionFeedStore.endSelection()
                transactionSelectionPeek.dismissForFocusChange()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active {
                    dismissBudgetPad()
                    reviewTransactionSavedAt = nil
                } else {
                    appSession?.navigationAttention.retry()
                }
            }
            .onChange(of: budgetStore.workspace, initial: true) { _, workspace in
                if budgetPlanWorkspace?.id != workspace?.id { budgetPlanWorkspace = nil }
                if categoryDetails?.workspace.id != workspace?.id { categoryDetails = nil }
                budgetPeekNavigation.navigate(
                    workspaceID: workspace?.id, isBudgetSelected: selectedPage == .budget)
                dismissBudgetPad()
                if accountsStore.workspace?.id != workspace?.id { selectedAccount = nil }
                if accountOrderWorkspace?.id != workspace?.id { accountOrderWorkspace = nil }
            }
            .onChange(of: appSession?.current?.id) { _, _ in
                reviewTransactionSavedAt = nil
                selectedAccount = nil
                pendingAccountChange = nil
                glowScrollState = HomeGlowScrollState()
                budgetAssignmentFocusRegistry = BudgetAssignmentFocusRegistry()
                isBudgetMonthPickerPresented = false
                isReportRangePresented = false
                budgetPlanWorkspace = nil
                accountOrderWorkspace = nil
                widgetPlannedSelection = nil
                transactionPeek.dismiss()
            }
    }

    var body: some View {
        observedNavigation
            .alert(
                L10n.string("Workspace couldn't be remembered"),
                isPresented: Binding(
                    get: { appSession?.selectionSaveError != nil },
                    set: { if !$0 { appSession?.selectionSaveError = nil } })
            ) {
                Button(L10n.string("Try again")) { appSession?.retrySavingSelection() }
                Button("OK", role: .cancel) { appSession?.selectionSaveError = nil }
            } message: {
                Text(appSession?.selectionSaveError ?? L10n.string("Please try again."))
            }
            .onChange(of: budgetStore.selectedMonth) { _, month in
                if let budgetEditor, budgetEditor.key.yearMonth != month {
                    if !budgetPadPresentation.isClosing,
                        let editor = budgetStore.assignmentEditor,
                        editor.key.yearMonth == month
                    {
                        budgetPadOpeningSessionID = nil
                        self.budgetEditor = editor
                    } else {
                        closeBudgetPad()
                    }
                }
            }
            .onChange(of: editedBudgetCategoryExists) { _, exists in
                if !exists { dismissBudgetPad() }
            }
            .alert(
                L10n.string("Assignment couldn't be saved"),
                isPresented: Binding(
                    get: { budgetStore.saveError != nil },
                    set: { if !$0 { budgetStore.saveError = nil } }
                )
            ) {
                Button("OK", role: .cancel) { budgetStore.saveError = nil }
            } message: {
                Text(budgetStore.saveError ?? L10n.string("Please try again."))
            }
            .alert(
                L10n.string("Transaction couldn't be updated"),
                isPresented: Binding(
                    get: {
                        presentedSheet?.isSearch != true
                            && transactionFeedStore.actionErrorMessage != nil
                    },
                    set: { if !$0 { transactionFeedStore.actionErrorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) {
                    transactionFeedStore.actionErrorMessage = nil
                }
            } message: {
                Text(transactionFeedStore.actionErrorMessage ?? L10n.string("Please try again."))
            }
            .modifier(
                ReviewPromptModifier(
                    store: reviewPrompt, milestone: reviewMilestone,
                    isAvailable: canPresentReviewPrompt)
            )
            .modifier(AppChangelogModifier(store: appUpdates, isAvailable: canPresentHomePrompt))
    }

    private var reviewMilestone: ReviewPromptMilestone? {
        return reviewTransactionSavedAt.map { .transactionAdded($0) }
    }

    private var canPresentReviewPrompt: Bool {
        canPresentHomePrompt && appUpdates?.unreadChangelog == nil
            && appUpdates?.presentedChangelog == nil
    }

    private var canPresentHomePrompt: Bool {
        allowsReviewPrompt && scenePhase == .active && !isTransitioning
            && appSession?.current != nil && selectedAccount == nil
            && presentedSheet == nil && !isBudgetMonthPickerPresented && budgetPlanWorkspace == nil
            && !isBudgetPreferencesPresented
            && categoryDetails == nil
            && !homeDrawerPresentation.isPresented && transactionPeek.receipt == nil
            && !budgetStore.isQuickAssignPresented
            && assistantStore?.isPresented != true
            && appSession?.selectionSaveError == nil && budgetStore.saveError == nil
            && transactionFeedStore.actionErrorMessage == nil
    }

    private var fullScreenHome: some View {
        GeometryReader { safeAreaGeometry in
            GeometryReader { screenGeometry in
                let dock = HomeControlDockLayout.resolve(
                    geometry: screenGeometry, isExpanded: horizontalSizeClass == .regular)
                PeekContainer(
                    presentation: homeDrawerPresentation,
                    expansionHeight: transactionSelectionPeek.sessionID != nil
                        ? transactionSelectionPeekHeight
                        : moneyMovePad.sessionID != nil
                            ? moneyMovePadHeight
                            : budgetPadPresentation.sessionID != nil
                                ? budgetPadContentHeight : transactionPeekHeight,
                    isCompactPresented: isTransitioning || showsBudgetReadyToAssign,
                    compactHeight: isTransitioning
                        ? transitionPeekHeight
                        : budgetPeekContentHeight,
                    animation: amountPadAnimation,
                    compactAlignment: .top,
                    bottomCornerRadius: 0,
                    foregroundColor: peekBackground,
                    expansionColor: transactionSelectionPeek.sessionID != nil
                        ? KualiaPalette.peekBackground
                        : moneyMovePad.sessionID != nil
                            || budgetPadPresentation.sessionID != nil
                            ? budgetInputBackground : transactionPeek.backgroundColor,
                    persistentSide: dock.map { .init(edge: $0.edge, width: $0.width) }
                ) {
                    foregroundSheet(
                        dock: dock,
                        corners: dock == nil
                            ? HomePeekCorners.resolve(geometry: screenGeometry)
                            : HomePeekCorners(leading: 0, trailing: 0),
                        topInset: safeAreaGeometry.safeAreaInsets.top,
                        bottomInset: homeDrawerPresentation.isPresented
                            || isTransitioning || showsBudgetReadyToAssign
                            ? 0 : safeAreaGeometry.safeAreaInsets.bottom
                    )
                } expansion: {
                    expandedPeek(containerFrame: screenGeometry.frame(in: .global))
                } compact: {
                    compactPeek
                }
                .animation(
                    .easeInOut(duration: reduceMotion ? 0.18 : 0.45), value: peekBackground
                )
                .frame(
                    width: screenGeometry.size.width,
                    height: screenGeometry.size.height
                )
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder
    private func expandedPeek(containerFrame: CGRect) -> some View {
        if moneyMovePad.sessionID != nil, let session = budgetStore.moneyMove {
            AmountPad(
                calculator: Binding(
                    get: { budgetStore.moneyMove?.calculator ?? session.calculator },
                    set: {
                        budgetStore.updateMoneyMoveCalculator($0, sessionID: session.id)
                    }),
                accessibilityIdentifierPrefix: "budget-move",
                onDismiss: { Task { await budgetStore.applyMoneyMove() } },
                onCancel: { budgetStore.setMoneyMoveAmountEditing(false) },
                onContentHeightChange: { height in
                    moneyMovePadHeight = height
                    guard let id = moneyMovePad.sessionID else { return }
                    withAnimation(amountPadAnimation) {
                        moneyMovePad.reveal(sessionID: id)
                    }
                },
                backgroundColor: budgetInputBackground,
                topPadding: 0,
                primaryActionTitle: L10n.string("Move"),
                isPrimaryActionEnabled: budgetStore.canApplyMoneyMove)
        } else if budgetPadPresentation.sessionID != nil, let budgetEditor {
            HomeBudgetKeypad(
                store: budgetStore, editor: budgetEditor,
                backgroundColor: budgetInputBackground,
                onEditTarget: {
                    guard let workspace = budgetStore.workspace,
                        workspace.id == budgetEditor.key.workspaceID,
                        let category = budgetStore.planGroups.flatMap(\.categories)
                            .first(where: { $0.id == budgetEditor.key.categoryID }),
                        category.type != "credit_card"
                    else { return }
                    // Leave the source keypad still until the sheet finishes opening.
                    budgetTargetEditor = .init(
                        workspace: workspace, category: category,
                        assignmentEditorID: budgetEditor.id)
                },
                onDismiss: closeBudgetPad,
                onCancel: { cancelBudgetPad(editorID: budgetEditor.id) },
                onContentHeightChange: { height in
                    revealBudgetPad(
                        height: height, editorID: budgetEditor.id,
                        containerFrame: containerFrame)
                }
            )
            .id(budgetEditor.id)
        } else if transactionSelectionPeek.sessionID != nil {
            transactionSelectionPeekContent
        } else if let receipt = transactionPeek.receipt {
            transactionPeekContent(receipt: receipt)
        }
    }

    private var compactPeek: some View {
        ZStack(alignment: .top) {
            if isTransitioning, let appSession {
                WorkspaceTransitionPeek(
                    name: appSession.targetWorkspace?.name,
                    page: appSession.targetPage ?? selectedPage,
                    readiness: appSession.preparation,
                    onRetry: appSession.retry,
                    onCancel: appSession.current == nil
                        ? nil
                        : {
                            withAnimation(stateAnimation) {
                                appSession.cancelTransition()
                            }
                        }
                )
                .transition(.opacity)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    transitionPeekHeight = $0
                }
            } else {
                budgetReadyToAssignContent
                    .transition(.opacity)
            }
        }
        .animation(stateAnimation, value: isTransitioning)
    }

    private var budgetReadyToAssignPeek: BudgetReadyToAssignPeek {
        // Keep the finished preview until endQuickAssign installs Undo in the same update.
        let session = budgetStore.quickAssign
        let undoAction: (() -> Void)? =
            budgetStore.quickAssignUndo != nil || budgetPeek.isQuickAssignCompletion
            ? { undoQuickAssign() } : nil
        return BudgetReadyToAssignPeek(
            readyToAssign: session == nil
                ? budgetPeek.displayedReadyToAssign : budgetStore.readyToAssign,
            currencyCode: budgetStore.workspace?.currencyCode ?? "USD",
            minorUnit: budgetStore.workspace?.minorUnit ?? 2,
            isAmountPadPresented: budgetPadPresentation.isPresented,
            showsCompletion: budgetPeek.showsCompletion,
            onQuickAssign: beginQuickAssign,
            onUndo: undoAction,
            canUndo: budgetStore.canUndoQuickAssign,
            isUndoing: budgetStore.isUndoingQuickAssign,
            quickAssign: session,
            onApplyQuickAssign: { Task { await budgetStore.applyQuickAssign() } },
            canApplyQuickAssign: budgetStore.canApplyQuickAssign,
            onMoveMoney: beginReadyToAssignMove
        )
    }

    private var budgetReadyToAssignContent: some View {
        Group {
            if let session = budgetStore.moneyMove ?? budgetStore.moneyMoveReceipt {
                BudgetMoneyMovePeek(
                    store: budgetStore, session: session,
                    isReceiptOnly: budgetStore.moneyMove == nil)
            } else {
                budgetReadyToAssignPeek
            }
        }
        .allowsHitTesting(selectedPage == .budget && closingMoneyMoveReceiptID == nil)
        .accessibilityHidden(selectedPage != .budget || closingMoneyMoveReceiptID != nil)
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 18)
        .frame(minHeight: minimumPeekHeight)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: { height in
            guard abs(budgetPeekContentHeight - height) > 0.5 else { return }
            // Hidden Peek measurements must not animate the initial Home layout.
            var transaction = Transaction(animation: reduceMotion ? nil : .smooth(duration: 0.3))
            transaction.disablesAnimations = !showsBudgetReadyToAssign
            if !showsBudgetReadyToAssign { transaction.animation = nil }
            withTransaction(transaction) {
                budgetPeekContentHeight = height
            }
        }
    }

    private var isBudgetPeekActive: Bool {
        // Explicit amount editing responds immediately, even during the brief
        // navigation delay. Passive RTA follows the settled page presentation.
        !isTransitioning
            && (budgetPeekNavigation.isActive(workspaceID: budgetStore.workspace?.id)
                || (selectedPage == .budget
                    && (budgetPadPresentation.sessionID != nil || budgetStore.quickAssign != nil)))
    }

    private var showsBudgetReadyToAssign: Bool {
        // Resolve balances against the settled navigation state before onChange
        // synchronizes the amount presentation.
        budgetPeek.isVisible(in: budgetPeekContext)
    }

    private var budgetPeekContext: BudgetPeekPresentation.Context {
        // Notification Center and app switching leave the selected page mounted.
        // Keep the persistent RTA peek tied to page visibility, not scene focus.
        .init(
            workspaceID: budgetStore.workspace?.id,
            readyToAssign: budgetStore.readyToAssign,
            isEditing: budgetPadPresentation.isPresented || budgetPadPresentation.isClosing
                || budgetStore.quickAssign != nil || budgetStore.moneyMove != nil,
            isActive: isBudgetPeekActive && budgetStore.hasLoaded
                && budgetStore.workspace != nil
                && !budgetStore.isSelectedMonthLocked
                && !isTransitioning,
            isClosing: budgetPadPresentation.isClosing,
            hasUndo: budgetStore.quickAssignUndo != nil || budgetStore.isUndoingQuickAssign
                || (budgetStore.moneyMoveReceipt != nil && closingMoneyMoveReceiptID == nil),
            hasMoneyMove: budgetStore.moneyMove != nil || budgetStore.moneyMoveReceipt != nil
        )
    }

    private var peekBackground: Color {
        if isTransitioning { return KualiaPalette.peekBackground }
        if let closingBackground = budgetPeekNavigation.closingBackground(
            workspaceID: budgetStore.workspace?.id)
        {
            return closingBackground
        }
        if selectedPage == .budget || isBudgetPeekActive { return budgetInputBackground }
        return transactionSelectionPeek.sessionID != nil
            ? KualiaPalette.peekBackground : transactionPeek.backgroundColor
    }

    private var budgetInputBackground: Color {
        if budgetStore.moneyMove != nil || budgetStore.moneyMoveReceipt != nil {
            return KualiaPalette.peekBackground
        }
        if let session = budgetStore.quickAssign {
            let amount =
                session.phase != .finished && !session.isChoosingOption
                ? session.plan.readyToAssignAfter : budgetStore.readyToAssign
            return KualiaPalette.budgetInputBackground(
                readyToAssign: amount, showsCompletion: session.phase == .finished)
        }
        return KualiaPalette.budgetInputBackground(tone: budgetPeek.tone)
    }

    private var homeDrawerPresentation: PeekPresentation {
        if transactionSelectionPeek.sessionID != nil { return transactionSelectionPeek }
        return moneyMovePad.sessionID != nil
            ? moneyMovePad
            : budgetPadPresentation.sessionID != nil
                ? budgetPadPresentation : transactionPeek.reveal
    }

    private var transactionSelectionPeekContent: some View {
        HomeTransactionSelectionPeek(store: transactionFeedStore)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .frame(minHeight: minimumPeekHeight)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height
            } action: { height in
                guard let sessionID = transactionSelectionPeek.sessionID,
                    transactionSelectionPeek.acceptsMeasurement(sessionID: sessionID)
                else { return }
                withAnimation(stateAnimation) {
                    transactionSelectionPeekHeight = height
                    transactionSelectionPeek.reveal(sessionID: sessionID)
                }
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
            .id(transactionSelectionPeek.sessionID)
    }

    private func closeTransactionSelectionPeek() {
        guard let sessionID = transactionSelectionPeek.sessionID else { return }
        withAnimation(stateAnimation) {
            transactionSelectionPeek.beginClosing()
        } completion: {
            transactionSelectionPeek.finishClosing(sessionID: sessionID)
        }
    }

    private func transactionPeekContent(
        receipt: TransactionMutationReceipt
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 16) {
                HomeTransactionPeek(presentation: transactionPeek, receipt: receipt)
                if transactionPeek.showsUndo {
                    HomeTransactionUndoButton(
                        isPerformingAction: receipt.accountLifecycle == nil
                            ? !transactionFeedStore.canUndoDeletion : accountsStore.isSaving,
                        onUndo: {
                            Task {
                                if receipt.canUndoAccountChange {
                                    if let result = await accountsStore.undoLifecycleChange(
                                        receiptID: receipt.id),
                                        transactionPeek.receipt?.id == receipt.id
                                    {
                                        withAnimation(stateAnimation) {
                                            transactionPeek.present(result)
                                        }
                                    }
                                } else {
                                    await transactionFeedStore.undoLastDeletion()
                                }
                            }
                        },
                        accessibilityHint: receipt.accountLifecycle == nil
                            ? L10n.string("Restores the last deleted transaction")
                            : L10n.string("Restores this account"),
                        accessibilityIdentifier: receipt.accountLifecycle == nil
                            ? "home.undoTransactionDeletion" : "home.undoAccountChange")
                }
            }
            if receipt.accountLifecycle != nil, let error = accountsStore.actionErrorMessage {
                Text(error).font(.caption).foregroundStyle(KualiaPalette.peekInk)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .frame(minHeight: minimumPeekHeight)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: { height in
            guard transactionPeek.receipt?.id == receipt.id, !transactionPeek.isClosing else {
                return
            }
            withAnimation(stateAnimation) {
                transactionPeekHeight = height
                transactionPeek.revealContent(receiptID: receipt.id)
            }
        }
        .frame(maxHeight: .infinity, alignment: .bottom)
    }

    private func foregroundSheet(
        dock: HomeControlDockLayout?, corners: HomePeekCorners,
        topInset: CGFloat, bottomInset: CGFloat
    ) -> some View {
        let sessionID = appSession?.current?.id
        let isVisible = contentPresentation.isVisible(
            sessionID: sessionID, isTransitioning: isTransitioning)
        return ZStack {
            selectedPage.background
            homeContent(topInset: topInset, dock: dock)
                .onGeometryChange(for: UUID?.self) { geometry in
                    geometry.size.width > 0 && geometry.size.height > 0 ? sessionID : nil
                } action: { laidOutSessionID in
                    guard let laidOutSessionID else { return }
                    withTransaction(Transaction(animation: nil)) {
                        contentPresentation.didLayout(
                            sessionID: laidOutSessionID, currentSessionID: appSession?.current?.id)
                    }
                }
                // Replace every workspace-owned page and toolbar as one subtree.
                // No outgoing row or numeric-text transition may survive the swap.
                .id(sessionID)
                .transition(.identity)
                .transaction { transaction in
                    if !isVisible {
                        transaction.animation = nil
                        transaction.disablesAnimations = true
                    }
                }
                // Only opacity participates in the reveal. A value-based animation
                // here also animates descendant layout as the bars first mount.
                .animation(
                    reduceMotion
                        ? nil
                        : isVisible ? .easeInOut(duration: 0.22) : .easeOut(duration: 0.18)
                ) { content in
                    content.opacity(isVisible ? 1 : 0)
                }
                .allowsHitTesting(isVisible)
                .accessibilityHidden(!isVisible)
        }
        .kualiaBottomCorners(leadingMinimum: corners.leading, trailingMinimum: corners.trailing)
    }

    private func homeContent(topInset: CGFloat, dock: HomeControlDockLayout?) -> some View {
        HomePageContent(
            selectedPage: selectedPage,
            glowScrollState: glowScrollState,
            mountedPages: navigationState.mountedPages,
            transactionFeedStore: transactionFeedStore,
            budgetStore: budgetStore,
            homeStore: appSession?.current?.home,
            onSelectPage: selectPage,
            accountsStore: accountsStore,
            reportsStore: reportsStore,
            onSelectAccount: { selectedAccount = HomeAccountDestination(id: $0) },
            onAccountCreated: { receipt in
                guard receipt.workspace.id == accountsStore.workspace?.id,
                    selectedPage == .accounts, selectedAccount == nil
                else { return }
                dismissBudgetPad()
                withTransaction(Transaction(animation: nil)) {
                    transactionPeek.present(receipt)
                }
            },
            transactionScrollToTopRequest: navigationState.transactionScrollToTopRequest,
            budgetScrollToTopRequest: navigationState.budgetScrollToTopRequest,
            accountsScrollToTopRequest: navigationState.accountsScrollToTopRequest,
            accountCreationRequest: accountCreationRequest,
            editingBudgetCategoryID: budgetPadPresentation.isPresented
                || budgetPadPresentation.isPreparing
                ? budgetEditor?.key.categoryID : nil,
            onEditBudgetAmount: editBudgetAmount,
            onMoveBudgetMoney: beginMoneyMove,
            onOpenBudgetCategory: presentCategoryDetails,
            onChangeBudgetMonth: closeBudgetPad,
            showsTabBar: showsBottomToolbar,
            canAddTransaction: transactionFeedStore.canCreateTransaction,
            onAddTransaction: presentCreationEditor,
            onOpenAssistant: { assistantStore?.present() },
            appSession: appSession, onSelectWorkspace: selectWorkspace
        )
        .environment(\.homeControlDock, dock)
        .environment(\.homeDockActions, dock == nil ? nil : AnyView(pageTopBar(placement: .dock)))
        .environment(
            \.isBudgetAssignmentRevealReady,
            !budgetPadPresentation.isPreparing && budgetPadOpeningSessionID == nil
        )
        .environment(\.budgetAssignmentFocusRegistry, budgetAssignmentFocusRegistry)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .kualiaSafeAreaBar(edge: .top, spacing: 0) {
            pageTopBar(placement: dock == nil ? .all : .title)
                .padding(dock?.edge == .leading ? .leading : .trailing, dock?.width ?? 0)
                .padding(.horizontal, 20)
                .padding(.top, topInset + 10)
                .padding(.bottom, 8)
                .kualiaToolbarBackground()
        }
        .modifier(
            HomeScrollSurface(showsBottomToolbar: showsBottomToolbar))
    }

    private func pageTopBar(placement: HomeTopBar.Placement) -> some View {
        HomePageTopBar(
            placement: placement,
            navigation: navigationState,
            budgetStore: budgetStore,
            reportsStore: reportsStore,
            onReportRange: { isReportRangePresented = true },
            onReturnToCurrentMonth: {
                closeBudgetPad()
                budgetStore.selectMonth(budgetStore.currentMonth)
            },
            onMonthPicker: {
                closeBudgetPad()
                isBudgetMonthPickerPresented = true
            },
            onEditBudgetPlan: {
                closeBudgetPad()
                closeTransactionPeek()
                budgetPlanWorkspace = budgetStore.workspace
            },
            onBudgetPreferences: {
                closeBudgetPad()
                closeTransactionPeek()
                isBudgetPreferencesPresented = true
            },
            onAddAccount: {
                closeTransactionPeek()
                accountCreationRequest += 1
            },
            canAddAccount: accountsStore.hasLoaded && accountsStore.workspace != nil
                && !accountsStore.isSaving,
            onReorderAccounts: {
                closeTransactionPeek()
                accountOrderWorkspace = budgetStore.workspace
            },
            canReorderAccounts: accountsStore.canReorderAccounts,
            onCloseQuickAssign: closeQuickAssign,
            onNewEntry: presentCreationEditor,
            onSearch: presentTransactionSearch,
            isSearchEnabled: transactionFeedStore.canSearchTransactions,
            onTransactionPreferences: {
                closeTransactionPeek()
                presentedSheet = .init(content: .transactionPreferences)
            },
            isSelectingTransactions: transactionFeedStore.isSelecting,
            onPreferences: {
                dismissBudgetPad()
                closeTransactionPeek()
                openAppSettings()
            }
        )
    }

    private var showsBottomToolbar: Bool {
        !transactionFeedStore.isSelecting && budgetPadPresentation.sessionID == nil
            && moneyMovePad.sessionID == nil
            && !(selectedPage == .budget && budgetStore.isQuickAssignPresented)
            && !(selectedPage == .budget && budgetStore.moneyMove != nil)
    }

    private var stateAnimation: Animation {
        reduceMotion ? .easeInOut(duration: 0.18) : .easeInOut(duration: 0.34)
    }

    private func selectPage(_ page: HomePage) {
        budgetStore.endMoneyMove()
        dismissBudgetPad()
        transactionPeek.dismiss()
        performNavigation {
            if let appSession { appSession.requestPage(page) } else { navigationState.select(page) }
        }
    }

    private func selectWorkspace(_ workspace: AppWorkspace) {
        budgetStore.endMoneyMove()
        dismissBudgetPad()
        transactionPeek.dismiss()
        performNavigation {
            appSession?.requestWorkspace(workspace)
        }
    }

    private func performNavigation(_ action: () -> Void) {
        var transitionID: UUID?
        // Ready pages switch immediately beneath one stable shared bar. The
        // workspace loading fade owns its scoped animation.
        withAnimation(nil, completionCriteria: .removed) {
            action()
            transitionID = appSession?.transitionID
        } completion: {
            appSession?.finishFade(id: transitionID)
        }
    }

    private var selectedPage: HomePage {
        navigationState.selectedPage
    }

    private var editedBudgetCategoryExists: Bool {
        guard let budgetEditor else { return true }
        // Month navigation owns the handoff/animated close. An empty locked
        // month must not trigger the category-removal dismissal first.
        guard budgetEditor.key.yearMonth == budgetStore.selectedMonth else { return true }
        return budgetStore.groups.contains { group in
            group.rows.contains { $0.id == budgetEditor.key.categoryID }
        }
    }

    private var amountPadAnimation: Animation? {
        reduceMotion ? nil : .spring(duration: 0.38, bounce: 0.08)
    }

    private var closingBudgetPadSessionID: UUID? {
        budgetPadPresentation.isClosing ? budgetPadPresentation.sessionID : nil
    }

    private func beginMoneyMove(_ categoryID: String) {
        dismissBudgetPad()
        transactionPeek.dismiss()
        budgetPeek.beginKeypadEditing()
        withAnimation(amountPadAnimation) { budgetStore.beginMoneyMove(categoryID) }
    }

    private func beginReadyToAssignMove() {
        dismissBudgetPad()
        transactionPeek.dismiss()
        budgetPeek.beginKeypadEditing()
        withAnimation(amountPadAnimation) { budgetStore.beginMoneyMove(at: .readyToAssign) }
    }

    private func editBudgetAmount(_ categoryID: String) {
        let hasVisiblePeek = showsBudgetReadyToAssign || isTransitioning
        transactionPeek.dismiss()
        if budgetPadPresentation.isPresented, budgetEditor?.key.categoryID == categoryID {
            closeBudgetPad()
            return
        }
        guard let editor = budgetStore.beginEditing(categoryID) else { return }
        budgetPeek.beginKeypadEditing()
        budgetEditor = editor
        if budgetPadPresentation.isPresented {
            budgetPadPresentation.open()
        } else {
            // Measure while mounted, before either reveal or push begins.
            withTransaction(Transaction(animation: nil)) {
                budgetPadPresentation.prepare(hasVisiblePeek: hasVisiblePeek)
            }
        }
    }

    private func revealBudgetPad(height: CGFloat, editorID: UUID, containerFrame: CGRect) {
        guard let budgetEditor, budgetEditor.id == editorID else { return }
        budgetPadContentHeight = height
        guard budgetPadPresentation.isPreparing,
            let sessionID = budgetPadPresentation.sessionID
        else { return }
        let layout = PeekLayout(
            containerHeight: containerFrame.height, expansionHeight: height, isPresented: true,
            isCompactPresented: true, compactHeight: budgetPeekContentHeight)
        let offset = budgetAssignmentFocus.prepareReveal(
            categoryID: budgetEditor.key.categoryID,
            viewportBottom: containerFrame.minY + layout.foregroundHeight)
        budgetPadOpeningSessionID = sessionID
        var transaction = Transaction(animation: amountPadAnimation)
        transaction.scrollContentOffsetAdjustmentBehavior = .disabled
        transaction.addAnimationCompletion(criteria: .removed) {
            // Closing and reopening can start a new animation before this one ends.
            guard budgetPadOpeningSessionID == sessionID else { return }
            budgetPadOpeningSessionID = nil
        }
        budgetAssignmentFocus.openAfterRevealLayout {
            guard budgetPadPresentation.isPreparing,
                budgetPadPresentation.sessionID == sessionID,
                self.budgetEditor?.id == editorID
            else { return }
            withTransaction(transaction) {
                budgetPadPresentation.reveal(sessionID: sessionID)
                if let offset { budgetAssignmentFocus.position.scrollTo(y: offset) }
            }
        }
    }

    private func beginQuickAssign() {
        transactionPeek.dismiss()
        withAnimation(stateAnimation) {
            dismissBudgetPad()
            budgetPeek.beginKeypadEditing()
            budgetStore.beginQuickAssign()
        }
    }

    private var finishedQuickAssignID: UUID? {
        guard selectedPage == .budget, scenePhase == .active,
            budgetStore.quickAssign?.phase == .finished
        else { return nil }
        return budgetStore.quickAssign?.id
    }

    private func closeQuickAssign() {
        guard let session = budgetStore.quickAssign, session.phase != .saving else { return }
        withAnimation(stateAnimation) {
            budgetStore.endQuickAssign(id: session.id)
            if session.phase == .finished || session.phase == .checking {
                budgetPeek.finishQuickAssign(
                    context: budgetPeekContext, celebratesZero: session.phase == .finished)
            } else {
                budgetPeek.beginKeypadEditing()
                budgetPeek.update(budgetPeekContext)
            }
        }
    }

    private func closeQuickAssignCompletion() {
        guard budgetPeek.isQuickAssignCompletion, let id = budgetPeek.completionID else { return }
        withAnimation(amountPadAnimation, completionCriteria: .removed) {
            budgetPeek.beginQuickAssignCompletionClosing(id: id)
        } completion: {
            budgetPeek.finishCompletionClosing(id: id)
        }
    }

    private var moneyMoveReceiptTaskID: UUID? {
        guard let receipt = budgetStore.moneyMove ?? budgetStore.moneyMoveReceipt,
            !receipt.isBusy, !receipt.isClosingReceipt, receipt.receiptExpiresAt != nil
        else { return nil }
        return receipt.lastMoveID
    }

    private func expireMoneyMoveReceipt() async {
        guard let id = moneyMoveReceiptTaskID else { return }
        do {
            try await Task.sleep(for: .seconds(budgetStore.moneyMoveReceiptTimeRemaining))
            try Task.checkCancellation()
            withAnimation(amountPadAnimation) { budgetStore.expireMoneyMoveReceipt(id: id) }
        } catch { return }
    }

    private var closingMoneyMoveReceiptID: UUID? {
        guard let receipt = budgetStore.moneyMoveReceipt, receipt.isClosingReceipt else {
            return nil
        }
        return receipt.lastMoveID
    }

    private func finishMoneyMoveReceiptClosing() async {
        guard let id = closingMoneyMoveReceiptID else { return }
        do {
            if reduceMotion {
                await Task.yield()
            } else {
                try await Task.sleep(for: .milliseconds(380))
            }
            try Task.checkCancellation()
            budgetStore.finishMoneyMoveReceiptClosing(id: id)
        } catch { return }
    }

    private var quickAssignUndoTaskID: UUID? {
        guard !budgetStore.isUndoingQuickAssign else { return nil }
        return budgetStore.quickAssignUndo?.id
    }

    private func expireQuickAssignUndo() async {
        guard let id = quickAssignUndoTaskID else { return }
        do {
            try await Task.sleep(for: .seconds(budgetStore.quickAssignUndoTimeRemaining))
            try Task.checkCancellation()
            withAnimation(stateAnimation) { budgetStore.expireQuickAssignUndo(id: id) }
        } catch { return }
    }

    private func undoQuickAssign() {
        Task { await budgetStore.undoQuickAssign() }
    }

    private func celebrateBudgetCompletion() async {
        guard let id = budgetPeek.completionTaskID else { return }
        do {
            // This task starts only after the keypad's close completion. Let the
            // newly displayed amount roll to zero, then hold the zero for recognition.
            try await Task.sleep(for: BudgetCompletionTiming.beforeMessage)
            try Task.checkCancellation()
            withAnimation(
                reduceMotion
                    ? .easeInOut(duration: 0.18)
                    : .smooth(duration: BudgetCompletionTiming.messageTransition)
            ) {
                budgetPeek.showCompletion(id: id)
            }
            // Quick Assign's Undo window owns dismissal of its message.
            if budgetPeek.isQuickAssignCompletion { return }
            try await Task.sleep(for: .seconds(2))
            try Task.checkCancellation()
            withAnimation(amountPadAnimation, completionCriteria: .removed) {
                budgetPeek.beginCompletionClosing(id: id)
            } completion: {
                budgetPeek.finishCompletionClosing(id: id)
            }
        } catch { return }
    }

    private func closeBudgetPad() {
        hideBudgetPad(cancelling: nil)
    }

    private func cancelBudgetPad(editorID: UUID) {
        guard budgetEditor?.id == editorID else { return }
        hideBudgetPad(cancelling: editorID)
    }

    private func hideBudgetPad(cancelling editorID: UUID?) {
        guard let sessionID = budgetPadPresentation.sessionID, !budgetPadPresentation.isClosing
        else { return }
        // Closing is finalized by a session-keyed task. SwiftUI animation completion
        // callbacks can remain pending until an unrelated interaction invalidates the view.
        withAnimation(amountPadAnimation) {
            budgetPadOpeningSessionID = nil
            budgetPeek.beginKeypadClosing(
                id: sessionID, hasChanges: editorID == nil && budgetStore.hasAssignmentChanges)
            budgetPadPresentation.beginClosing()
            if let editorID {
                budgetStore.cancelEditing(editorID: editorID)
            } else {
                budgetStore.finishEditing()
            }
        }
    }

    private func finishBudgetPadClosing() async {
        guard let sessionID = closingBudgetPadSessionID else { return }
        do {
            if reduceMotion {
                await Task.yield()
            } else {
                try await Task.sleep(for: .milliseconds(380))
            }
            try Task.checkCancellation()
        } catch { return }
        guard closingBudgetPadSessionID == sessionID else { return }
        budgetPadPresentation.finishClosing(sessionID: sessionID)
        guard budgetPadPresentation.sessionID == nil else { return }
        budgetEditor = nil
        budgetPeek.finishKeypadClosing(id: sessionID, context: budgetPeekContext)
    }

    private func presentCategoryDetails(_ categoryID: String) {
        guard budgetStore.moneyMove == nil, let workspace = budgetStore.workspace,
            transactionFeedStore.workspace?.id == workspace.id,
            let search = transactionFeedStore.makeSearchStore(
                filters: BudgetCategoryMonth.filters(
                    categoryID: categoryID, month: budgetStore.selectedMonth),
                loadsAllPages: true),
            let history = transactionFeedStore.makeCategoryHistoryStore(
                categoryID: categoryID)
        else { return }
        dismissBudgetPad()
        closeTransactionPeek()
        categoryDetails = .init(
            workspace: workspace, categoryID: categoryID,
            month: budgetStore.selectedMonth, transactions: search, history: history)
    }

    private func presentTransactionSearch() {
        guard budgetStore.moneyMove?.isBusy != true else { return }
        budgetStore.endMoneyMove()
        dismissBudgetPad()
        if transactionSearchStore == nil {
            transactionSearchStore = transactionFeedStore.makeSearchStore()
        }
        guard let transactionSearchStore else { return }
        presentedSheet = .init(content: .search(transactionSearchStore))
    }

    private var widgetPresentationIsBlocked: Bool {
        presentedSheet != nil || budgetPlanWorkspace != nil || accountOrderWorkspace != nil
            || categoryDetails != nil
            || isBudgetMonthPickerPresented || isBudgetPreferencesPresented
            || isReportRangePresented
            || isSettingsPresented || assistantStore?.isPresented == true
            || appUpdates?.presentedChangelog != nil || appSession?.selectionSaveError != nil
            || budgetStore.saveError != nil || transactionFeedStore.actionErrorMessage != nil
            || plannedStore?.showsMonthPicker == true || widgetPlannedSelection != nil
    }

    private var widgetRequestReadiness: String {
        "\(widgetNavigation?.pending?.id.uuidString ?? "none")-\(transactionFeedStore.workspace?.id ?? "loading")-\(accountsStore.hasLoaded)-\(isTransitioning)-\(widgetPresentationIsBlocked)-\(budgetStore.moneyMove?.isBusy == true)-\(selectedPage.rawValue)-\(plannedStore?.workspace.id ?? "loading")-\(plannedStore?.data != nil)-\(plannedStore?.isLoading == true)-\(plannedStore?.errorMessage != nil)"
    }

    private func openPendingWidgetRequest() async {
        guard let request = widgetNavigation?.pending, !isTransitioning,
            !widgetPresentationIsBlocked, budgetStore.moneyMove?.isBusy != true
        else { return }
        if request.workspaceID != nil {
            guard let appSession, appSession.hasLoadedWorkspaces else { return }
            switch request.resolveWorkspace(
                currentID: transactionFeedStore.workspace?.id,
                accessibleIDs: appSession.workspaces.map(\.id))
            {
            case .ready: break
            case .switchWorkspace(let id):
                if let workspace = appSession.workspaces.first(where: { $0.id == id }) {
                    selectWorkspace(workspace)
                }
                return
            case .unavailable:
                // Never apply a removed workspace's notification to another workspace's feed.
                widgetNavigation?.pending = nil
                return
            }
        }
        switch request.route {
        case .widgets:
            widgetNavigation?.pending = nil
            openWidgetsSettings()
        case .capture(let type):
            guard let editor = transactionFeedStore.makeCreationEditor(),
                budgetStore.moneyMove?.isBusy != true
            else { return }
            // Resolve named Shortcuts inputs against this workspace's live choices.
            if request.draft != nil { await editor.load() }
            guard !Task.isCancelled, widgetNavigation?.pending?.id == request.id,
                editor.workspace.id == transactionFeedStore.workspace?.id
            else { return }
            widgetNavigation?.pending = nil
            editor.preselectWidgetCapture(type, shortcut: request.draft)
            budgetStore.endMoneyMove()
            dismissBudgetPad()
            closeTransactionPeek()
            pendingReceipt = nil
            presentedSheet = .init(content: .newEntry(editor))
        case .account(let id):
            guard accountsStore.hasLoaded else { return }
            widgetNavigation?.pending = nil
            openWidgetPage(.accounts)
            if accountsStore.accounts.contains(where: { $0.id == id && !$0.isDeleted }) {
                selectedAccount = HomeAccountDestination(id: id)
            }
        case .budget:
            widgetNavigation?.pending = nil
            openWidgetPage(.budget)
        case .accounts:
            widgetNavigation?.pending = nil
            openWidgetPage(.accounts)
        case .planned:
            widgetNavigation?.pending = nil
            openWidgetPage(.transactions)
        case .plannedTransaction(let id):
            if selectedPage != .transactions {
                openWidgetPage(.transactions)
                return
            }
            guard let plannedStore,
                plannedStore.workspace.id == transactionFeedStore.workspace?.id
            else { return }
            plannedStore.start()
            guard plannedStore.data != nil, !plannedStore.isLoading,
                plannedStore.errorMessage == nil
            else { return }
            // Resolve only against the active workspace's loaded agenda. A removed
            // or inaccessible schedule leaves the user on the Transactions page.
            widgetNavigation?.pending = nil
            if let schedule = plannedStore.schedule(id),
                schedule.workspaceId == plannedStore.workspace.id
            {
                widgetPlannedSelection = PlannedSelection(id: schedule.id)
            }
        case .transactions:
            widgetNavigation?.pending = nil
            openWidgetPage(.transactions)
        case .filteredTransactions(let filter):
            widgetNavigation?.pending = nil
            openWidgetPage(.transactions)
            transactionFeedStore.selectFilter(
                TransactionFeedFilter(rawValue: filter.rawValue) ?? .all, keepEmpty: true)
        }
    }

    private func openWidgetPage(_ page: HomePage) {
        // A previous account detail must not cover a newly requested root page.
        selectedAccount = nil
        dismissBudgetPad()
        if let appSession {
            appSession.requestPage(page)
            appSession.finishFade(id: appSession.transitionID)
            appSession.revealIfReady()
        } else {
            localNavigation.select(page)
        }
    }

    private func presentCreationEditor() {
        guard budgetStore.moneyMove?.isBusy != true else { return }
        guard let editor = transactionFeedStore.makeCreationEditor() else { return }
        budgetStore.endMoneyMove()
        dismissBudgetPad()
        closeTransactionPeek()
        pendingReceipt = nil
        presentedSheet = .init(content: .newEntry(editor))
    }

    private func revealSavedTransaction() {
        guard let receipt = pendingReceipt else { return }
        pendingReceipt = nil
        guard receipt.workspace.id == transactionFeedStore.workspace?.id else { return }
        if receipt.kind == .created && !receipt.isPending && !receipt.isScheduledOnly {
            reviewTransactionSavedAt = .now
        }
        transactionFeedStore.publishReceipt(receipt)
    }

    private func animateTransactionPeek() async {
        guard transactionPeek.animationID != nil, let receipt = transactionPeek.receipt else {
            return
        }
        do {
            try await Task.sleep(for: TransactionPeekTiming.beforeHold(for: receipt.kind))
            try Task.checkCancellation()
            guard transactionPeek.receipt?.id == receipt.id else { return }
            withAnimation(
                reduceMotion
                    ? nil : .easeInOut(duration: TransactionPeekTiming.balanceAnimation)
            ) {
                transactionPeek.applyChange(receiptID: receipt.id)
            }
            try await Task.sleep(
                for: UIAccessibility.isVoiceOverRunning
                    ? .seconds(8) : TransactionPeekTiming.resultHold(for: receipt.kind))
            try Task.checkCancellation()
        } catch { return }
        closeTransactionPeek(receiptID: receipt.id)
    }

    private func closeTransactionPeek(receiptID: UUID? = nil) {
        guard let receipt = transactionPeek.receipt,
            receiptID == nil || receiptID == receipt.id,
            !transactionPeek.isClosing, let sessionID = transactionPeek.reveal.sessionID
        else { return }
        if receipt.canUndoAccountChange,
            accountsStore.isSaving || accountsStore.actionErrorMessage != nil
        {
            return
        }
        withAnimation(stateAnimation, completionCriteria: .removed) {
            transactionPeek.beginClosing(receiptID: receipt.id)
        } completion: {
            if transactionPeek.finishClosing(receiptID: receipt.id, sessionID: sessionID) {
                transactionFeedStore.finishBudgetPeek(receiptID: receipt.id)
            }
        }
    }

    private func dismissBudgetPad() {
        let sessionID = budgetPadPresentation.sessionID
        budgetPadOpeningSessionID = nil
        budgetStore.finishEditing()
        budgetPadPresentation.dismissForFocusChange()
        budgetEditor = nil
        if let sessionID {
            budgetPeek.finishKeypadClosing(id: sessionID, context: budgetPeekContext)
        }
    }
}

/// Constructing a Binding evaluates its getter. Keep that calculator observation
/// in the keypad so each digit does not invalidate HomeView and every page builder.
private struct HomeBudgetKeypad: View {
    let store: BudgetStore
    let editor: BudgetAssignmentEditor
    let backgroundColor: Color
    let onEditTarget: () -> Void
    let onDismiss: () -> Void
    let onCancel: () -> Void
    let onContentHeightChange: (CGFloat) -> Void
    @Environment(\.locale) private var locale

    private var isTargetCategory: Bool {
        store.planGroups.flatMap(\.categories).contains {
            $0.id == editor.key.categoryID && $0.type != "credit_card"
        }
    }
    private var canEditTarget: Bool {
        isTargetCategory && store.targets.canEdit && store.canEditPlan
    }

    var body: some View {
        AmountPad(
            calculator: Binding(
                get: {
                    store.assignmentCalculator
                        ?? AmountCalculator(
                            amount: editor.assignedAmount,
                            minorUnit: editor.minorUnit,
                            allowsNegativeAmounts: true
                        )
                },
                set: { store.updateCalculator($0, editorID: editor.id) }
            ),
            accessibilityIdentifierPrefix: "budget",
            onDismiss: onDismiss,
            onCancel: onCancel,
            onContentHeightChange: onContentHeightChange,
            backgroundColor: backgroundColor,
            topPadding: 0,
            headerAction: .init(
                title: store.categoryAssignment(for: editor).purpose == .setTarget
                    ? (store.targets.targets[editor.key.categoryID] == nil
                        ? L10n.string("Set target") : L10n.string("Edit target"))
                    : store.categoryAssignment(for: editor).title(
                        currencyCode: editor.currencyCode,
                        minorUnit: editor.minorUnit, locale: locale),
                isEnabled: store.categoryAssignment(for: editor).purpose == .setTarget
                    ? canEditTarget : store.categoryAssignment(for: editor).isEnabled,
                perform: {
                    if store.categoryAssignment(for: editor).purpose == .setTarget {
                        onEditTarget()
                    } else if store.prepareTargetAssignment(
                        editorID: editor.id)
                    {
                        onDismiss()
                    }
                }
            ),
            leadingHeaderAction: isTargetCategory
                && store.categoryAssignment(for: editor).purpose != .setTarget
                ? .init(
                    title: store.targets.targets[editor.key.categoryID] == nil
                        ? L10n.string("Set target") : L10n.string("Edit target"),
                    icon: .pencil, isEnabled: canEditTarget, perform: onEditTarget) : nil
        )
    }
}

struct HomeTransactionUndoButton: View {
    let isPerformingAction: Bool
    let onUndo: () -> Void
    var accessibilityHint = L10n.string("Restores the last deleted transaction")
    var accessibilityIdentifier = "home.undoTransactionDeletion"

    var body: some View {
        Button(action: onUndo) {
            Text(L10n.string("Undo"))
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(KualiaPalette.peekInk)
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .background(KualiaPalette.peekControlSurface, in: Capsule())
        }
        .buttonStyle(.kualiaHaptic)
        .fixedSize()
        .disabled(isPerformingAction)
        .opacity(isPerformingAction ? 0.5 : 1)
        .accessibilityHint(accessibilityHint)
        .accessibilityIdentifier(accessibilityIdentifier)
    }
}

/// Keep toolbar data observations separate from the home shell and retained pages.
private struct HomePageTopBar: View {
    var placement: HomeTopBar.Placement = .all
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let navigation: HomeNavigationState
    let budgetStore: BudgetStore
    let reportsStore: ReportsStore
    let onReportRange: () -> Void
    let onReturnToCurrentMonth: () -> Void
    let onMonthPicker: () -> Void
    @Environment(\.locale) private var locale
    let onEditBudgetPlan: () -> Void
    let onBudgetPreferences: () -> Void
    let onAddAccount: () -> Void
    let canAddAccount: Bool
    let onReorderAccounts: () -> Void
    let canReorderAccounts: Bool
    let onCloseQuickAssign: () -> Void
    let onNewEntry: () -> Void
    let onSearch: () -> Void
    let isSearchEnabled: Bool
    let onTransactionPreferences: () -> Void
    var isSelectingTransactions = false
    let onPreferences: () -> Void

    private var selectedMonth: Int? {
        return navigation.selectedPage == .budget ? budgetStore.selectedMonth : nil
    }

    private var currentMonth: Int {
        budgetStore.currentMonth
    }

    var body: some View {
        // Preserve the action group's identity across pages. Only the date label
        // owns a timeline, so navigation does not recreate the avatar loader.
        HomeTopBar(
            placement: placement,
            title: selectedMonth.map {
                BudgetMonth.navigationTitle($0, currentMonth: currentMonth, locale: locale)
            } ?? navigation.selectedPage.title,
            onNewEntry: onNewEntry, onPreferences: onPreferences,
            onSearch: navigation.selectedPage == .transactions ? onSearch : nil,
            isSearchEnabled: isSearchEnabled,
            onTransactionPreferences: navigation.selectedPage == .transactions
                ? onTransactionPreferences : nil,
            onEditBudgetPlan: navigation.selectedPage == .budget ? onEditBudgetPlan : nil,
            canEditBudgetPlan: budgetStore.canEditPlan,
            onBudgetPreferences: navigation.selectedPage == .budget ? onBudgetPreferences : nil,
            onAddAccount: navigation.selectedPage == .accounts ? onAddAccount : nil,
            canAddAccount: canAddAccount,
            onReorderAccounts: navigation.selectedPage == .accounts ? onReorderAccounts : nil,
            canReorderAccounts: canReorderAccounts,
            reportRange: navigation.selectedPage == .reports ? reportsStore.range : nil,
            onReportRange: navigation.selectedPage == .reports ? onReportRange : nil,
            canChangeReportRange: reportsStore.hasLoaded,
            onTitleTap: selectedMonth != nil ? onMonthPicker : nil,
            isTitleEnabled: budgetStore.canChangeMonth,
            showsActions: !isSelectingTransactions
                && (navigation.selectedPage != .budget || !budgetStore.isQuickAssignPresented),
            monthBrowsingLabel: selectedMonth.flatMap {
                BudgetMonth.browsingLabel($0, currentMonth: currentMonth)
            },
            onReturnToCurrentMonth: onReturnToCurrentMonth,
            budgetMonth: selectedMonth,
            currentBudgetMonth: currentMonth,
            monthPickerAccessibilityPrefix: "budget",
            monthPickerAccessibilityHint: L10n.string("Choose a budget month"),
            onCloseQuickAssign: navigation.selectedPage == .budget
                && budgetStore.isQuickAssignPresented
                ? onCloseQuickAssign : nil,
            canCloseQuickAssign: budgetStore.quickAssign?.phase != .saving,
            onCloseMoneyMove: navigation.selectedPage == .budget && budgetStore.moneyMove != nil
                ? {
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                        budgetStore.endMoneyMove()
                    }
                } : nil,
            canCloseMoneyMove: budgetStore.moneyMove?.isBusy != true
        )
        .transaction(value: navigation.selectedPage) { transaction in
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
    }
}

#Preview {
    NavigationStack {
        HomeView(transactionFeedStore: .preview, budgetStore: .preview, accountsStore: .preview)
    }
}

struct HomeAccountDestination: Hashable, Identifiable {
    let id: String
}

struct HomeAccountNavigation: ViewModifier {
    @Binding var selection: HomeAccountDestination?
    let store: AccountsStore
    var onAccountChanged: (TransactionMutationReceipt) -> Void = { _ in }

    func body(content: Content) -> some View {
        content.sheet(item: $selection) { account in
            NavigationStack {
                AccountDetailView(
                    store: store, accountID: account.id, onAccountChanged: onAccountChanged
                )
                .id(store.workspace?.id)
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(34)
            .presentationBackground(KualiaPalette.canvas)
        }
    }
}
