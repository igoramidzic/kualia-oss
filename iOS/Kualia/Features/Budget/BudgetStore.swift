import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class BudgetStore {
    typealias StructureSubscription = () -> AnyPublisher<BudgetStructure, Error>
    typealias ArchivedCategoriesSubscription = (String) -> AnyPublisher<
        [BudgetGroupDeletionDetails], Error
    >
    typealias SnapshotSubscription = (String, Int) -> AnyPublisher<BudgetSnapshot, Error>
    typealias AssignmentHandler = (BudgetAssignmentRequest) async throws -> BudgetAssignmentResult
    typealias QuickAssignHandler = (BudgetQuickAssignRequest) async throws -> BudgetAssignmentResult
    typealias TargetSnoozeHandler = (BudgetTargetSnoozeRequest) async throws ->
        BudgetAssignmentResult
    typealias PlanChangeHandler = (String, BudgetPlanChange, [String]) async throws -> String?

    let targets: BudgetTargetStore
    let categoryLifecycleClient: BudgetCategoryLifecycleClient

    private(set) var archivedCategoryCount: Int?
    private(set) var isSavingPlan = false
    var planError: String?
    private var pendingPlanMove: BudgetPlanChange?
    private var queuedPlanMoves: [BudgetPlanOrdering.Move] = []
    private(set) var monthlyPlanAmount: Int64?

    var planGroups: [BudgetCategoryGroup] {
        _ = presentationRevision
        let base = pendingPlanMove?.applying(to: structure) ?? structure
        return queuedPlanMoves.reduce(base) { groups, move in
            move.change(in: groups)?.applying(to: groups) ?? groups
        }
    }

    var canEditPlan: Bool {
        hasLoaded && workspace != nil && structureError == nil && !isSavingPlan
            && !isRefreshing && !isUndoingQuickAssign && quickAssign == nil
    }

    var canReorderPlan: Bool {
        hasLoaded && workspace != nil && structureError == nil
            && (!isSavingPlan || !queuedPlanMoves.isEmpty)
            && !isRefreshing && !isUndoingQuickAssign && quickAssign == nil
    }

    private(set) var workspace: BudgetWorkspace?
    private(set) var groups: [BudgetGroupModel] = []
    private(set) var currentMonthOverspent: [BudgetCategoryRowModel] = []
    private(set) var selectedMonth: Int
    var categoryFilter = BudgetCategoryFilter.all
    private(set) var isTargetSummaryExpanded = true
    private(set) var currentMonth: Int
    private(set) var availableRange: BudgetMonthRange?
    private(set) var readyToAssign = Decimal.zero
    private(set) var collapsedGroupIDs: Set<String> = []
    private(set) var hasLoaded = false
    /// Changes only when server budget data arrives, never for an unfinished keypad edit.
    private(set) var snapshotRevision = 0
    private(set) var isRefreshing = true
    private(set) var structureError: String?
    private(set) var budgetError: String?
    var saveError: String?
    private(set) var assignmentEditor: BudgetAssignmentEditor?
    private(set) var assignmentCalculator: AmountCalculator?
    private(set) var quickAssign: BudgetQuickAssignSession?
    private(set) var underfundedOrder: BudgetUnderfundedOrder
    private(set) var quickAssignUndo: BudgetQuickAssignUndo?
    private(set) var moneyMove: BudgetMoneyMoveSession?
    private(set) var moneyMoveReceipt: BudgetMoneyMoveSession?
    private(set) var targetSnoozesInFlight: Set<BudgetAssignmentKey> = []
    var targetSnoozeError: String?

    var isUndoingQuickAssign: Bool { quickAssignUndo?.isBusy == true }
    var quickAssignUndoTimeRemaining: TimeInterval {
        max(0, quickAssignUndo?.expiresAt.timeIntervalSince(now()) ?? 0)
    }
    var canUndoQuickAssign: Bool {
        guard let undo = quickAssignUndo, !undo.isBusy, quickAssignUndoTimeRemaining > 0,
            quickAssign == nil, moneyMove == nil, canEdit, assignmentEditor == nil, pending.isEmpty
        else { return false }
        return quickAssignUndoMatchesBudget(undo)
    }

    var canQuickAssign: Bool {
        canEdit && pending.isEmpty && assignmentEditor == nil && moneyMove == nil
    }
    var isQuickAssignPresented: Bool { quickAssign != nil && quickAssign?.phase != .finished }

    var showsReadyToAssign: Bool { hasLoaded && workspace != nil }

    var errorMessage: String? { structureError ?? budgetError }
    var canEdit: Bool {
        hasLoaded && !isRefreshing && errorMessage == nil && workspace != nil
            && !isSelectedMonthLocked && !isUndoingQuickAssign && moneyMoveOperation?.isBusy != true
    }
    var isSelectedMonthLocked: Bool { isMonthLocked(selectedMonth) }
    var browsableMonths: [Int] {
        availableRange.map(BudgetMonth.browsableMonths) ?? [selectedMonth]
    }

    func isMonthLocked(_ month: Int) -> Bool {
        guard let availableRange else { return true }
        return BudgetMonth.unlockingMonth(month, in: availableRange) != nil
    }

    func canBrowseMonth(_ month: Int) -> Bool {
        guard canChangeMonth, browsableMonths.contains(month) else { return false }
        return quickAssign == nil || !isMonthLocked(month)
    }
    var canGoBack: Bool { selectedMonth > (availableRange?.minYearMonth ?? selectedMonth) }
    var canGoForward: Bool { selectedMonth < (availableRange?.maxYearMonth ?? selectedMonth) }

    @ObservationIgnored private let subscribeToArchivedCategories: ArchivedCategoriesSubscription
    @ObservationIgnored private let subscribeToStructure: StructureSubscription
    @ObservationIgnored private let subscribeToSnapshot: SnapshotSubscription
    @ObservationIgnored private let assignAmount: AssignmentHandler
    @ObservationIgnored private let assignBatch: QuickAssignHandler
    @ObservationIgnored private let snoozeTarget: TargetSnoozeHandler
    @ObservationIgnored private let changePlan: PlanChangeHandler
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private let responseTimeout: Duration
    @ObservationIgnored private let requestedWorkspaceID: String?
    @ObservationIgnored private var archivedCategoriesSubscription: AnyCancellable?
    @ObservationIgnored private var archivedCategoriesGeneration = UUID()
    @ObservationIgnored private var structureSubscription: AnyCancellable?
    @ObservationIgnored private var budgetSubscription: AnyCancellable?
    @ObservationIgnored private var structureDeadline: Task<Void, Never>?
    @ObservationIgnored private var budgetDeadline: Task<Void, Never>?
    @ObservationIgnored private var structureGeneration = UUID()
    @ObservationIgnored private var budgetGeneration = UUID()
    @ObservationIgnored private var workspaceGeneration = UUID()
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var structure: [BudgetCategoryGroup] = []
    @ObservationIgnored private var hasLoadedStructure = false
    @ObservationIgnored private var hasLoadedSnapshot = false
    @ObservationIgnored private var months: [Int: [String: BudgetCategoryAmounts]] = [:]
    @ObservationIgnored private var planSummaries: [Int: BudgetPlanSummary] = [:]
    @ObservationIgnored private var authoritativeReadyToAssign: Int64 = 0
    @ObservationIgnored private var editingAmount: Int64?
    @ObservationIgnored private var targetAssignmentBaseline: Int64?
    @ObservationIgnored private var displayedEditingAmount: Int64?
    @ObservationIgnored private var pending: [BudgetAssignmentKey: PendingAssignment] = [:]
    @ObservationIgnored private var monthGroups: [Int: [BudgetGroupModel]] = [:]
    private var presentationRevision = 0

    private struct PendingAssignment {
        enum State { case saving, confirmed, uncertain }
        let id: UUID
        let amount: Int64
        var state: State = .saving
    }

    convenience init(convexClient: ConvexClientWithAuth<String>, workspaceID: String? = nil) {
        self.init(
            workspaceID: workspaceID,
            targets: BudgetTargetStore(convexClient: convexClient),
            categoryLifecycleClient: BudgetCategoryLifecycleClient(convexClient: convexClient),
            structureSubscription: {
                convexClient.subscribe(
                    to: "categoryBudgets:listBudgetStructure",
                    with: workspaceID.map { ["workspaceId": $0] }, yielding: BudgetStructure.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            archivedCategoriesSubscription: { workspaceID in
                convexClient.subscribe(
                    to: "categories:listCategoriesHierarchical",
                    with: ["workspaceId": workspaceID], yielding: [BudgetGroupDeletionDetails].self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            snapshotSubscription: { workspaceID, currentMonth in
                convexClient.subscribe(
                    to: "categoryBudgets:listBudgetDataByMonth",
                    with: ["workspaceId": workspaceID, "currentYearMonth": Int64(currentMonth)],
                    yielding: BudgetSnapshot.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            assignmentHandler: { request in
                try await convexClient.mutation(
                    "categoryBudgets:upsertCategoryBudget", with: request.arguments
                )
            },
            quickAssignHandler: { request in
                try await convexClient.mutation(
                    "categoryBudgets:batchUpdateCategoryBudgets", with: request.arguments
                )
            },
            targetSnoozeHandler: { request in
                try await convexClient.mutation(
                    "categoryBudgets:toggleTargetSnooze", with: request.arguments)
            },
            planChangeHandler: { workspaceID, change, visibleGroupIDs in
                var arguments = change.arguments(workspaceID: workspaceID)
                if case .moveGroup(let id, let position) = change {
                    // The budget omits empty credit-card groups; the ordering API
                    // counts all groups. Resolve the visible neighbor in its full order.
                    let allGroups = try await convexClient.subscribe(
                        to: "categoryGroups:listCategoryGroups", with: ["workspaceId": workspaceID],
                        yielding: [BudgetPlanGroupIdentity].self
                    ).first().timeout(.seconds(15), scheduler: DispatchQueue.main)
                        .values.first(where: { _ in true })
                    guard let allGroups,
                        let serverPosition = BudgetPlanOrdering.serverGroupPosition(
                            movingID: id, position: position, visibleIDs: visibleGroupIDs,
                            allIDs: allGroups.map(\._id))
                    else { throw BudgetSaveError.rejected }
                    arguments["newPosition"] = Double(serverPosition)
                }
                if change.createsItem {
                    let id: String = try await convexClient.mutation(
                        change.function, with: arguments)
                    return id
                }
                let result: BudgetAssignmentResult = try await convexClient.mutation(
                    change.function, with: arguments)
                guard result.success else { throw BudgetSaveError.rejected }
                return nil
            }
        )
    }

    init(
        now: @escaping () -> Date = Date.init,
        defaults: UserDefaults? = .standard,
        responseTimeout: Duration = .seconds(15),
        workspaceID: String? = nil,
        targets: BudgetTargetStore? = nil,
        categoryLifecycleClient: BudgetCategoryLifecycleClient = .unavailable,
        structureSubscription: @escaping StructureSubscription,
        archivedCategoriesSubscription: @escaping ArchivedCategoriesSubscription = { _ in
            Just([]).setFailureType(to: Error.self).eraseToAnyPublisher()
        },
        snapshotSubscription: @escaping SnapshotSubscription,
        assignmentHandler: @escaping AssignmentHandler,
        quickAssignHandler: @escaping QuickAssignHandler = { _ in throw BudgetSaveError.rejected },
        targetSnoozeHandler: @escaping TargetSnoozeHandler = { _ in throw BudgetSaveError.rejected
        },
        planChangeHandler: @escaping PlanChangeHandler = { _, _, _ in throw BudgetSaveError.rejected
        }
    ) {
        self.targets = targets ?? BudgetTargetStore()
        self.categoryLifecycleClient = categoryLifecycleClient
        self.now = now
        self.defaults = defaults
        underfundedOrder =
            defaults?.string(forKey: BudgetUnderfundedOrder.defaultsKey)
            .flatMap(BudgetUnderfundedOrder.init(rawValue:)) ?? .dueDate
        self.responseTimeout = responseTimeout
        requestedWorkspaceID = workspaceID
        subscribeToStructure = structureSubscription
        subscribeToArchivedCategories = archivedCategoriesSubscription
        subscribeToSnapshot = snapshotSubscription
        assignAmount = assignmentHandler
        assignBatch = quickAssignHandler
        snoozeTarget = targetSnoozeHandler
        changePlan = planChangeHandler
        let initialMonth = BudgetMonth.current(now: now())
        currentMonth = initialMonth
        selectedMonth = initialMonth
    }

    func categoryMenuActions(categoryID: String, month: Int) -> [BudgetCategoryMenuAction] {
        guard month == selectedMonth, canEditPlan, moneyMove == nil,
            let row = groups.first(where: { $0.rows.contains(where: { $0.id == categoryID }) })?
                .rows.first(where: { $0.id == categoryID }), let workspace
        else { return [] }
        var actions: [BudgetCategoryMenuAction] = []
        if !row.isCreditCard {
            let hasTarget = row.hasTarget || targets.targets[categoryID] != nil
            let key = BudgetAssignmentKey(
                workspaceID: workspace.id, yearMonth: month, categoryID: categoryID)
            if hasTarget, !row.isPending, assignmentEditor == nil,
                !targetSnoozesInFlight.contains(key), !targets.isSaving
            {
                actions.append(row.isTargetSnoozed ? .resumeTarget : .snoozeTarget)
            }
            if targets.canEdit {
                actions.append(hasTarget ? .editTarget : .setTarget)
            }
        }
        actions.append(.editCategory)
        return actions
    }

    func setTargetSnoozed(_ snoozed: Bool, key: BudgetAssignmentKey) async {
        let action: BudgetCategoryMenuAction = snoozed ? .snoozeTarget : .resumeTarget
        guard workspace?.id == key.workspaceID,
            categoryMenuActions(categoryID: key.categoryID, month: key.yearMonth).contains(action)
        else { return }
        let generation = workspaceGeneration
        targetSnoozesInFlight.insert(key)
        targetSnoozeError = nil
        defer {
            if workspaceGeneration == generation { targetSnoozesInFlight.remove(key) }
        }
        do {
            let result = try await snoozeTarget(.init(key: key, snoozed: snoozed))
            guard workspaceGeneration == generation else { return }
            guard result.success else { throw BudgetSaveError.rejected }
            // Let the monthly query update the target, caption, filters, and totals together.
            if isActive, amounts(for: key).target?.isSnoozed != snoozed { watchBudget() }
        } catch {
            guard workspaceGeneration == generation else { return }
            targetSnoozeError = L10n.string("Couldn't update the target snooze. Please try again.")
            if isActive { watchBudget() }
        }
    }

    /// Apply each drop immediately and serialize its write in the background.
    /// A second drag does not have to wait for the first network round trip.
    @discardableResult
    func enqueuePlanMove(_ move: BudgetPlanOrdering.Move, workspaceID: String) -> Bool {
        guard canReorderPlan, workspace?.id == workspaceID,
            move.change(in: planGroups) != nil
        else { return false }
        let startsQueue = queuedPlanMoves.isEmpty
        queuedPlanMoves.append(move)
        isSavingPlan = true
        planError = nil
        guard startsQueue else { return true }
        let generation = workspaceGeneration
        Task { await saveQueuedPlanMoves(workspaceID: workspaceID, generation: generation) }
        return true
    }

    private func saveQueuedPlanMoves(workspaceID: String, generation: UUID) async {
        while workspaceGeneration == generation, let move = queuedPlanMoves.first {
            // Resolve against the confirmed result of the preceding write.
            guard let change = move.change(in: structure) else {
                queuedPlanMoves.removeFirst()
                continue
            }
            do {
                _ = try await changePlan(workspaceID, change, structure.map(\.id))
                guard workspaceGeneration == generation else { return }
                // A live query can arrive first. Stable neighbors make this
                // idempotent while preserving concurrent names and insertions.
                if let receipt = move.change(in: structure) {
                    structure = receipt.applying(to: structure)
                }
                queuedPlanMoves.removeFirst()
                rebuildPresentation()
            } catch {
                guard workspaceGeneration == generation else { return }
                queuedPlanMoves.removeAll()
                planError =
                    isDefiniteRejection(error)
                    ? L10n.string(
                        "Couldn't save the last moves. Your saved order has been restored.")
                    : L10n.string(
                        "Couldn't confirm the last moves. Refresh the plan to check its saved order."
                    )
                if !isDefiniteRejection(error) { retry() }
            }
        }
        if workspaceGeneration == generation { isSavingPlan = false }
    }

    @discardableResult
    func savePlanChange(_ change: BudgetPlanChange, workspaceID: String) async -> Bool {
        guard !isSavingPlan else { return false }
        guard canEditPlan, workspace?.id == workspaceID, change.isValid(in: structure) else {
            planError = L10n.string(
                "This item is no longer available. Reopen the budget plan and try again.")
            return false
        }
        let generation = workspaceGeneration
        let baseline = structure
        isSavingPlan = true
        planError = nil
        if change.isMove { pendingPlanMove = change }
        defer {
            if workspaceGeneration == generation {
                isSavingPlan = false
                pendingPlanMove = nil
            }
        }
        do {
            let createdID = try await changePlan(workspaceID, change, baseline.map(\.id))
            guard workspaceGeneration == generation, workspace?.id == workspaceID else {
                return false
            }
            // The live query usually arrives first. Apply the receipt only if no
            // newer structure has arrived, preserving concurrent remote edits.
            if structure == baseline {
                structure = change.applying(to: structure, createdID: createdID)
                rebuildPresentation()
            }
            return true
        } catch {
            guard workspaceGeneration == generation else { return false }
            planError =
                isDefiniteRejection(error)
                ? (change.isMove
                    ? L10n.string("Couldn't save this order. Please try again.")
                    : L10n.string("Couldn't save this change. Check the name and try again."))
                : L10n.string(
                    "Couldn't confirm this change. Check your connection and refresh the plan before trying again."
                )
            if !isDefiniteRejection(error) { retry() }
            return false
        }
    }

    /// Seed only metadata from the authenticated catalog. Both live responses
    /// still have to arrive before the budget can be displayed or edited.
    func prepare(workspace next: BudgetWorkspace?) {
        guard !isActive, workspace == nil, let next,
            requestedWorkspaceID == nil || requestedWorkspaceID == next.id
        else { return }
        workspace = next
        currentMonth = BudgetMonth.current(now: now(), timezoneIdentifier: next.timezoneIdentifier)
        selectedMonth = currentMonth
    }

    func start() {
        guard !isActive else { return }
        isActive = true
        isRefreshing = true
        watchStructure()
        if let workspace {
            targets.start(workspaceID: workspace.id)
            watchBudget()
        }
    }

    func stop() {
        stopArchivedCategories()
        targets.stop()
        moneyMove = nil
        moneyMoveReceipt = nil
        quickAssignUndo = nil
        quickAssign = nil
        finishEditing()
        isActive = false
        isRefreshing = true
        structureGeneration = UUID()
        budgetGeneration = UUID()
        structureSubscription?.cancel()
        budgetSubscription?.cancel()
        structureSubscription = nil
        budgetSubscription = nil
        structureDeadline?.cancel()
        budgetDeadline?.cancel()
    }

    func reset() {
        clearEditing()
        stop()
        clearWorkspace()
        workspace = nil
        structureError = nil
        budgetError = nil
    }

    func retry() {
        guard isActive else { return }
        stopArchivedCategories()
        structureError = nil
        budgetError = nil
        isRefreshing = true
        budgetGeneration = UUID()
        budgetSubscription?.cancel()
        budgetSubscription = nil
        watchStructure()
    }

    func refreshCurrentMonth() {
        guard isActive, let workspace else { return }
        let next = BudgetMonth.current(now: now(), timezoneIdentifier: workspace.timezoneIdentifier)
        guard next != currentMonth else { return }
        moneyMove = nil
        moneyMoveReceipt = nil
        quickAssignUndo = nil
        quickAssign = nil
        finishEditing()
        if selectedMonth == currentMonth { selectedMonth = next }
        currentMonth = next
        isRefreshing = true
        rebuildPresentation()
        watchBudget()
    }

    var canChangeMonth: Bool {
        availableRange != nil && !isUndoingQuickAssign && moneyMove == nil
            && moneyMoveReceipt?.isBusy != true
            && (quickAssign == nil || quickAssign?.phase == .reviewing)
    }

    func selectMonth(_ month: Int) {
        guard canBrowseMonth(month), month != selectedMonth
        else { return }
        finishEditing()
        quickAssignUndo = nil
        moneyMoveReceipt = nil
        selectedMonth = month
        if let session = quickAssign {
            // A new identity invalidates callbacks tied to the previous month's preview.
            quickAssign = BudgetQuickAssignSession(
                workspaceID: session.workspaceID, yearMonth: month, option: session.option,
                plan: quickAssignPlan(for: session.option),
                isChoosingOption: session.isChoosingOption,
                allowsNegativeRTA: session.allowsNegativeRTA,
                excludedCategoryIDs: session.excludedCategoryIDs)
        }
        rebuildPresentation()
    }

    var areAllGroupsCollapsed: Bool {
        !structure.isEmpty && structure.allSatisfy { collapsedGroupIDs.contains($0.id) }
    }

    func toggleAllGroups(relativeTo groupID: String) {
        guard let workspace, structure.contains(where: { $0.id == groupID }) else { return }
        collapsedGroupIDs = collapsedGroupIDs.contains(groupID) ? [] : Set(structure.map(\.id))
        defaults?.set(Array(collapsedGroupIDs).sorted(), forKey: collapseKey(workspace.id))
    }

    func toggleGroup(_ id: String) {
        guard let workspace, structure.contains(where: { $0.id == id }) else { return }
        if !collapsedGroupIDs.insert(id).inserted { collapsedGroupIDs.remove(id) }
        defaults?.set(Array(collapsedGroupIDs).sorted(), forKey: collapseKey(workspace.id))
    }

    func selectCurrentMonth(filter: BudgetCategoryFilter) {
        selectMonth(currentMonth)
        guard selectedMonth == currentMonth else { return }
        categoryFilter = filter.resolved(in: groups)
    }

    func setTargetSummaryExpanded(_ expanded: Bool) {
        guard let workspace else { return }
        isTargetSummaryExpanded = expanded
        defaults?.set(expanded, forKey: "budget.targetSummaryExpanded.\(workspace.id)")
    }

    func editor(for categoryID: String) -> BudgetAssignmentEditor? {
        guard quickAssign == nil, moneyMove == nil, canEdit, let workspace,
            let row = groups.lazy.flatMap(\.rows).first(where: { $0.id == categoryID }),
            !row.isPending
        else { return nil }
        return BudgetAssignmentEditor(
            key: BudgetAssignmentKey(
                workspaceID: workspace.id, yearMonth: selectedMonth, categoryID: categoryID
            ),
            categoryName: row.name, assignedAmount: row.assigned,
            currencyCode: workspace.currencyCode, minorUnit: workspace.minorUnit
        )
    }

    func beginEditing(_ categoryID: String) -> BudgetAssignmentEditor? {
        finishEditing()
        guard let editor = editor(for: categoryID) else { return nil }
        quickAssignUndo = nil
        moneyMoveReceipt = nil
        assignmentEditor = editor
        displayedEditingAmount = editor.assignedAmount
        assignmentCalculator = AmountCalculator(
            amount: editor.assignedAmount, minorUnit: editor.minorUnit,
            allowsNegativeAmounts: true
        )
        return editor
    }

    func updateCalculator(_ calculator: AmountCalculator, editorID: UUID) {
        guard assignmentEditor?.id == editorID else { return }
        assignmentCalculator = calculator
        if let amount = calculator.amount {
            editingAmount = amount
            if !calculator.hasOperations, displayedEditingAmount != amount {
                displayedEditingAmount = amount
                updateAssignmentPreview(amount)
            }
        }
    }

    /// A draft changes one row and its group total. Rebuilding every category,
    /// current-month summary, and cached month on each digit blocks input/layout.
    private func updateAssignmentPreview(_ amount: Int64) {
        guard let editor = assignmentEditor, editor.key.yearMonth == selectedMonth,
            let groupIndex = groups.firstIndex(where: {
                $0.rows.contains { $0.id == editor.key.categoryID }
            }),
            let rowIndex = groups[groupIndex].rows.firstIndex(where: {
                $0.id == editor.key.categoryID
            })
        else { return }
        let group = groups[groupIndex]
        let row = group.rows[rowIndex]
        guard row.assigned != amount else { return }
        var rows = group.rows
        rows[rowIndex] = BudgetCategoryRowModel(
            id: row.id, name: row.name, isCreditCard: row.isCreditCard, assigned: amount,
            available: row.available, activity: row.activity, isPending: row.isPending,
            hasUnmetTarget: row.hasUnmetTarget, targetFundingStatus: row.targetFundingStatus,
            progress: row.progress, funding: row.funding, extraFunded: row.extraFunded)
        groups[groupIndex] = BudgetGroupModel(
            id: group.id, name: group.name, rows: rows,
            assigned: group.assigned + Decimal(amount) - Decimal(row.assigned),
            available: group.available)
    }

    var hasAssignmentChanges: Bool {
        guard let assignmentEditor, let editingAmount else { return false }
        return editingAmount != (targetAssignmentBaseline ?? assignmentEditor.assignedAmount)
    }

    func hasTarget(for editor: BudgetAssignmentEditor) -> Bool {
        _ = presentationRevision
        return amounts(for: editor.key).target?.targetAmount != nil
    }

    func categoryAssignment(for editor: BudgetAssignmentEditor) -> BudgetCategoryAssignment {
        _ = presentationRevision
        return BudgetCategoryAssignment(amounts: amounts(for: editor.key))
    }

    /// Replace the keypad draft with the current month's target or overspending need.
    /// The normal keypad close path owns the optimistic update and persistence.
    func prepareTargetAssignment(editorID: UUID) -> Bool {
        guard canEdit, let editor = assignmentEditor, editor.id == editorID else { return false }
        let current = amounts(for: editor.key)
        let action = categoryAssignment(for: editor)
        guard action.purpose != .setTarget, action.isEnabled else { return false }
        let total = Decimal(current.assignedAmount) + action.amount
        guard total >= Decimal(Int64.min), total <= Decimal(Int64.max) else {
            saveError = L10n.string("This assignment would exceed the supported budget amount.")
            return false
        }
        updateCalculator(
            AmountCalculator(
                amount: NSDecimalNumber(decimal: total).int64Value, minorUnit: editor.minorUnit,
                allowsNegativeAmounts: true),
            editorID: editor.id)
        // A live update may have changed the amount since this keypad opened.
        targetAssignmentBaseline = current.assignedAmount
        return true
    }

    /// Update the page immediately, then persist one absolute assignment when focus leaves.
    /// Reserve the write synchronously so changing month or stopping cannot drop the edit.
    func finishEditing() {
        guard let editor = assignmentEditor else { return }
        let amount = editingAmount
        let previousAmount = targetAssignmentBaseline ?? editor.assignedAmount
        clearEditing()
        rebuildPresentation()
        guard let amount, amount != previousAmount else { return }
        guard canEdit else {
            saveError = L10n.string(
                "Couldn't save the assignment for \(editor.categoryName). Please try again.")
            return
        }
        guard let operationID = prepareAssignment(amount, editor: editor) else { return }
        let generation = workspaceGeneration
        Task {
            await persistAssignment(
                amount, editor: editor, operationID: operationID,
                generation: generation)
        }
    }

    /// Discard this keypad session without persisting any of its previewed values.
    func cancelEditing(editorID: UUID) {
        guard assignmentEditor?.id == editorID else { return }
        clearEditing()
        rebuildPresentation()
    }

    private func clearEditing() {
        assignmentEditor = nil
        assignmentCalculator = nil
        editingAmount = nil
        targetAssignmentBaseline = nil
        displayedEditingAmount = nil
    }

    func save(_ amount: Int64, editor: BudgetAssignmentEditor) async {
        guard let operationID = prepareAssignment(amount, editor: editor) else { return }
        await persistAssignment(
            amount, editor: editor, operationID: operationID,
            generation: workspaceGeneration)
    }

    private func prepareAssignment(_ amount: Int64, editor: BudgetAssignmentEditor) -> UUID? {
        let key = editor.key
        guard quickAssign == nil, moneyMove == nil, canEdit, workspace?.id == key.workspaceID,
            key.yearMonth == selectedMonth, pending[key] == nil,
            structure.contains(where: { $0.categories.contains(where: { $0.id == key.categoryID }) }
            )
        else { return nil }
        let previous = amounts(for: key).assignedAmount
        guard amount != previous else { return nil }
        let delta = Decimal(previous) - Decimal(amount)
        let projectedRTA = readyToAssign + delta
        guard delta >= Decimal(Int64.min), delta <= Decimal(Int64.max),
            projectedRTA >= Decimal(Int64.min), projectedRTA <= Decimal(Int64.max)
        else {
            saveError = L10n.string("This assignment would exceed the supported budget amount.")
            return nil
        }

        quickAssignUndo = nil
        moneyMoveReceipt = nil
        let operationID = UUID()
        pending[key] = PendingAssignment(id: operationID, amount: amount)
        saveError = nil
        rebuildPresentation()

        return operationID
    }

    private func persistAssignment(
        _ amount: Int64, editor: BudgetAssignmentEditor, operationID: UUID, generation: UUID
    ) async {
        let key = editor.key
        guard generation == workspaceGeneration, pending[key]?.id == operationID else { return }
        do {
            let result = try await assignAmount(
                BudgetAssignmentRequest(key: key, assignedAmount: amount))
            guard generation == workspaceGeneration, pending[key]?.id == operationID else { return }
            guard result.success else { throw BudgetSaveError.rejected }
            if amounts(for: key).assignedAmount == amount {
                pending.removeValue(forKey: key)
            } else {
                pending[key]?.state = .confirmed
                // Refresh only if the stream has not already confirmed the write. A fresh
                // subscription also lets a subsequent family edit win over our pending value.
                if isActive { watchBudget() }
            }
        } catch {
            guard generation == workspaceGeneration, pending[key]?.id == operationID else { return }
            if isDefiniteRejection(error) {
                pending.removeValue(forKey: key)
                saveError =
                    L10n.string(
                        "Couldn't save the assignment for \(editor.categoryName). Please try again."
                    )
            } else {
                pending[key]?.state = .uncertain
                saveError =
                    L10n.string(
                        "Couldn't confirm the assignment for \(editor.categoryName). Refreshing your budget to check it."
                    )
                if isActive { watchBudget() }
            }
        }
        rebuildPresentation()
    }

    var canApplyQuickAssign: Bool {
        guard canQuickAssign, let session = quickAssign else { return false }
        return session.phase == .reviewing && !session.isChoosingOption && session.plan.canApply
            && session.workspaceID == workspace?.id && session.yearMonth == selectedMonth
    }

    func beginQuickAssign(categoryIDs: Set<String>? = nil) {
        guard quickAssign == nil, moneyMove == nil, hasLoaded, !isSelectedMonthLocked,
            let workspace
        else { return }
        finishEditing()
        quickAssignUndo = nil
        moneyMoveReceipt = nil
        let option: BudgetQuickAssignOption = readyToAssign < 0 ? .reduceOverfunding : .underfunded
        quickAssign = BudgetQuickAssignSession(
            workspaceID: workspace.id, yearMonth: selectedMonth, option: option,
            plan: quickAssignPlan(for: option))
        if let categoryIDs {
            quickAssign?.excludedCategoryIDs = Set(structure.flatMap(\.categories).map(\.id))
                .subtracting(categoryIDs)
            refreshQuickAssignPlan()
        }
    }

    func chooseQuickAssignOption(_ option: BudgetQuickAssignOption) {
        guard quickAssign?.phase == .reviewing else { return }
        if quickAssign?.option != option { quickAssign?.excludedCategoryIDs = [] }
        quickAssign?.option = option
        quickAssign?.isChoosingOption = false
        quickAssign?.errorMessage = nil
        refreshQuickAssignPlan()
    }

    func toggleQuickAssignCategory(_ categoryID: String) {
        guard let session = quickAssign, session.phase == .reviewing,
            !session.isChoosingOption,
            session.plan.previewChanges.contains(where: { $0.id == categoryID })
        else { return }
        if session.excludedCategoryIDs.contains(categoryID) {
            quickAssign?.excludedCategoryIDs.remove(categoryID)
        } else {
            quickAssign?.excludedCategoryIDs.insert(categoryID)
        }
        quickAssign?.errorMessage = nil
        refreshQuickAssignPlan()
    }

    func showQuickAssignOptions() {
        guard quickAssign?.phase == .reviewing else { return }
        quickAssign?.isChoosingOption = true
    }

    func setUnderfundedOrder(_ order: BudgetUnderfundedOrder) {
        guard let session = quickAssign, session.phase == .reviewing,
            session.option == .underfunded, !session.isChoosingOption
        else { return }
        underfundedOrder = order
        defaults?.set(order.rawValue, forKey: BudgetUnderfundedOrder.defaultsKey)
        quickAssign?.errorMessage = nil
        refreshQuickAssignPlan()
    }

    func setQuickAssignAllowsNegativeRTA(_ allowed: Bool) {
        guard quickAssign?.phase == .reviewing else { return }
        quickAssign?.allowsNegativeRTA = allowed
        refreshQuickAssignPlan()
    }

    func endQuickAssign(id: UUID, undoDuration: TimeInterval = 3.5) {
        guard let session = quickAssign, session.id == id, session.phase != .saving else { return }
        if session.phase == .finished {
            quickAssignUndo = BudgetQuickAssignUndo(
                workspaceID: session.workspaceID, yearMonth: session.yearMonth,
                changes: session.plan.changes, expiresAt: now().addingTimeInterval(undoDuration))
        }
        quickAssign = nil
        validateQuickAssignUndo()
    }

    func expireQuickAssignUndo(id: UUID) {
        guard quickAssignUndo?.id == id, !isUndoingQuickAssign,
            quickAssignUndoTimeRemaining <= 0
        else { return }
        quickAssignUndo = nil
    }

    func undoQuickAssign() async {
        guard canUndoQuickAssign, let undo = quickAssignUndo else { return }
        let changes = undo.changes.map { change in
            BudgetQuickAssignChange(
                id: change.id, name: change.name, groupName: change.groupName,
                previousAssigned: change.assigned, assigned: change.previousAssigned,
                previousAvailable: months[undo.yearMonth]?[change.id]?.available ?? 0)
        }
        let projectedRTA = changes.reduce(readyToAssign) { $0 - $1.delta }
        guard
            changes.allSatisfy({ $0.delta >= Decimal(Int64.min) && $0.delta <= Decimal(Int64.max) }
            ),
            projectedRTA >= Decimal(Int64.min), projectedRTA <= Decimal(Int64.max)
        else {
            quickAssignUndo = nil
            saveError = L10n.string("Undo would exceed the supported budget amount.")
            return
        }
        let generation = workspaceGeneration
        let operationID = UUID()
        let keys = changes.map {
            BudgetAssignmentKey(
                workspaceID: undo.workspaceID, yearMonth: undo.yearMonth, categoryID: $0.id)
        }
        quickAssignUndo?.phase = .saving
        saveError = nil
        for (key, change) in zip(keys, changes) {
            pending[key] = PendingAssignment(id: operationID, amount: change.assigned)
        }
        rebuildPresentation()
        do {
            let result = try await assignBatch(
                .init(workspaceID: undo.workspaceID, yearMonth: undo.yearMonth, changes: changes))
            guard generation == workspaceGeneration else { return }
            guard result.success else { throw BudgetSaveError.rejected }
            for key in keys where pending[key]?.id == operationID {
                if amounts(for: key).assignedAmount == pending[key]?.amount {
                    pending.removeValue(forKey: key)
                } else {
                    pending[key]?.state = .confirmed
                }
            }
            if quickAssignUndo?.id == undo.id { quickAssignUndo = nil }
            if isActive, keys.contains(where: { pending[$0]?.id == operationID }) { watchBudget() }
        } catch {
            guard generation == workspaceGeneration else { return }
            let rejected = isDefiniteRejection(error)
            for key in keys where pending[key]?.id == operationID {
                if rejected {
                    pending.removeValue(forKey: key)
                } else {
                    pending[key]?.state = .uncertain
                }
            }
            if quickAssignUndo?.id == undo.id {
                quickAssignUndo?.phase = rejected ? .available : .checking
                saveError =
                    rejected
                    ? L10n.string("Couldn't undo Quick Assign. Please try again.")
                    : L10n.string("Couldn't confirm Undo. Refreshing your budget to check it.")
            }
            if !rejected, isActive { watchBudget() }
        }
        rebuildPresentation()
    }

    private func quickAssignUndoMatchesBudget(_ undo: BudgetQuickAssignUndo) -> Bool {
        guard undo.workspaceID == workspace?.id, undo.yearMonth == selectedMonth,
            !isSelectedMonthLocked
        else { return false }
        let categoryIDs = Set(
            structure.flatMap { $0.categories }.filter { $0.type != "credit_card" }.map(\.id))
        return undo.changes.allSatisfy {
            categoryIDs.contains($0.id)
                && months[undo.yearMonth]?[$0.id]?.assignedAmount == $0.assigned
        }
    }

    private func validateQuickAssignUndo() {
        guard let undo = quickAssignUndo, !undo.isBusy else { return }
        // Wait for the completed batch's subscription before comparing assignments.
        // Once reconciled, a newer edit must win over this short-lived undo receipt.
        if quickAssignUndoTimeRemaining <= 0
            || (pending.isEmpty && !quickAssignUndoMatchesBudget(undo))
        {
            quickAssignUndo = nil
        }
    }

    private func reconcileQuickAssignUndo() {
        guard let undo = quickAssignUndo, undo.phase == .checking else { return }
        let restored = undo.changes.allSatisfy {
            months[undo.yearMonth]?[$0.id]?.assignedAmount == $0.previousAssigned
        }
        if restored {
            quickAssignUndo = nil
            saveError = nil
        } else {
            quickAssignUndo?.phase = .available
            saveError = L10n.string("Undo wasn't confirmed. Your budget has been refreshed.")
        }
    }

    func quickAssignPlan(for option: BudgetQuickAssignOption) -> BudgetQuickAssignPlan {
        let monthData = months[selectedMonth] ?? [:]
        let categories = structure.flatMap { group in
            group.categories.filter { $0.type != "credit_card" }.compactMap {
                category -> BudgetQuickAssignCategory? in
                guard let amounts = monthData[category.id] else { return nil }
                let history = months.compactMapValues { $0[category.id] }.mapValues {
                    BudgetQuickAssignCategory.History(
                        assigned: $0.assignedAmount, activity: $0.activity)
                }
                return BudgetQuickAssignCategory(
                    id: category.id, name: category.name, groupName: group.categoryGroup.name,
                    assigned: amounts.assignedAmount, available: amounts.available,
                    underfunded: amounts.target?.underfundedAmount ?? 0,
                    overfunded: amounts.target?.overfundedByAmount ?? 0, history: history,
                    dueDate: amounts.target?.dueDate)
            }
        }
        return .make(
            option: option, categories: categories, currentMonth: currentMonth,
            readyToAssign: readyToAssign,
            allowsNegativeRTA: quickAssign?.allowsNegativeRTA ?? false,
            underfundedOrder: underfundedOrder,
            excludedCategoryIDs: quickAssign?.excludedCategoryIDs ?? []
        )
    }

    private func refreshQuickAssignPlan() {
        guard let session = quickAssign, session.phase == .reviewing else { return }
        let plan = quickAssignPlan(for: session.option)
        quickAssign?.plan = plan
    }

    func applyQuickAssign() async {
        guard canApplyQuickAssign, let session = quickAssign else { return }
        // Do not silently apply a different plan from the one the user reviewed.
        let latest = quickAssignPlan(for: session.option)
        guard latest == session.plan else {
            quickAssign?.plan = latest
            quickAssign?.errorMessage =
                L10n.string("Your budget changed. Review the updated amounts before applying.")
            return
        }
        let generation = workspaceGeneration
        let operationID = UUID()
        let keys = session.plan.changes.map {
            BudgetAssignmentKey(
                workspaceID: session.workspaceID, yearMonth: session.yearMonth, categoryID: $0.id)
        }
        quickAssign?.phase = .saving
        quickAssign?.errorMessage = nil
        for (key, change) in zip(keys, session.plan.changes) {
            pending[key] = PendingAssignment(id: operationID, amount: change.assigned)
        }
        rebuildPresentation()
        do {
            let result = try await assignBatch(
                .init(
                    workspaceID: session.workspaceID, yearMonth: session.yearMonth,
                    changes: session.plan.changes))
            guard generation == workspaceGeneration else { return }
            guard result.success else { throw BudgetSaveError.rejected }
            for key in keys where pending[key]?.id == operationID {
                if amounts(for: key).assignedAmount == pending[key]?.amount {
                    pending.removeValue(forKey: key)
                } else {
                    pending[key]?.state = .confirmed
                }
            }
            if quickAssign?.id == session.id { quickAssign?.phase = .finished }
            if isActive, keys.contains(where: { pending[$0]?.id == operationID }) { watchBudget() }
        } catch {
            guard generation == workspaceGeneration else { return }
            let rejected = isDefiniteRejection(error)
            for key in keys where pending[key]?.id == operationID {
                if rejected {
                    pending.removeValue(forKey: key)
                } else {
                    pending[key]?.state = .uncertain
                }
            }
            if quickAssign?.id == session.id {
                quickAssign?.phase = rejected ? .reviewing : .checking
                quickAssign?.errorMessage =
                    rejected
                    ? L10n.string(
                        "Couldn't apply these assignments. Nothing was changed. Try again.")
                    : L10n.string("Checking whether your assignments saved.")
            }
            if !rejected, isActive { watchBudget() }
        }
        rebuildPresentation()
    }

    private func reconcileQuickAssign() {
        guard let session = quickAssign, session.phase == .checking else { return }
        let confirmed = session.plan.changes.allSatisfy {
            months[session.yearMonth]?[$0.id]?.assignedAmount == $0.assigned
        }
        quickAssign?.phase = confirmed ? .finished : .reviewing
        quickAssign?.errorMessage =
            confirmed
            ? nil
            : L10n.string("Your budget has been refreshed. Review the amounts before trying again.")
    }

    private func watchStructure() {
        structureGeneration = UUID()
        let generation = structureGeneration
        structureSubscription?.cancel()
        structureDeadline?.cancel()
        structureDeadline = Task { [weak self, responseTimeout] in
            do { try await Task.sleep(for: responseTimeout) } catch { return }
            guard let self, self.isActive, self.structureGeneration == generation else { return }
            self.structureError =
                L10n.string(
                    "Your categories are taking longer to load. Check your connection and try again."
                )
        }
        structureSubscription = subscribeToStructure()
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.isActive, self.structureGeneration == generation else {
                        return
                    }
                    if case .failure = completion {
                        self.structureDeadline?.cancel()
                        self.structureError = L10n.string(
                            "Couldn't load your categories. Please try again.")
                    }
                },
                receiveValue: { [weak self] response in
                    guard let self, self.isActive, self.structureGeneration == generation else {
                        return
                    }
                    self.structureDeadline?.cancel()
                    guard
                        self.requestedWorkspaceID == nil
                            || response.workspace?.id == self.requestedWorkspaceID
                    else {
                        self.structureError =
                            L10n.string("Couldn't load the selected workspace. Please try again.")
                        return
                    }
                    self.structureError = nil
                    if self.workspace?.id != response.workspace?.id {
                        self.clearWorkspace()
                    }
                    self.workspace = response.workspace
                    self.structure = response.categoryGroups
                    self.hasLoadedStructure = true
                    self.hasLoaded = self.hasLoadedSnapshot
                    guard let workspace = response.workspace else {
                        self.hasLoaded = true
                        self.isRefreshing = false
                        return
                    }
                    self.watchArchivedCategories()
                    self.targets.start(workspaceID: workspace.id)
                    self.collapsedGroupIDs = Set(
                        self.defaults?.stringArray(forKey: self.collapseKey(workspace.id))
                            ?? Array(self.collapsedGroupIDs)
                    )
                    self.isTargetSummaryExpanded =
                        self.defaults?.object(
                            forKey: "budget.targetSummaryExpanded.\(workspace.id)")
                        as? Bool ?? self.isTargetSummaryExpanded
                    let month = BudgetMonth.current(
                        now: self.now(), timezoneIdentifier: workspace.timezoneIdentifier)
                    if self.months.isEmpty { self.selectedMonth = month }
                    let clockChanged = self.currentMonth != month
                    self.currentMonth = month
                    self.rebuildPresentation()
                    if self.budgetSubscription == nil || clockChanged { self.watchBudget() }
                }
            )
    }

    private func watchArchivedCategories() {
        guard isActive, let workspace, archivedCategoriesSubscription == nil else { return }
        let workspaceID = workspace.id
        let generation = UUID()
        archivedCategoriesGeneration = generation
        archivedCategoriesSubscription = subscribeToArchivedCategories(workspaceID)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.archivedCategoriesGeneration == generation else { return }
                    if case .failure = completion {
                        self.archivedCategoryCount = nil
                        self.archivedCategoriesSubscription = nil
                    }
                },
                receiveValue: { [weak self] groups in
                    guard let self, self.isActive, self.workspace?.id == workspaceID,
                        self.archivedCategoriesGeneration == generation
                    else { return }
                    self.archivedCategoryCount = BudgetArchivedCategoriesStore.archivedGroups(
                        in: groups
                    )
                    .reduce(0) { $0 + $1.categories.count }
                })
    }

    private func stopArchivedCategories() {
        archivedCategoriesGeneration = UUID()
        archivedCategoriesSubscription?.cancel()
        archivedCategoriesSubscription = nil
    }

    private func watchBudget() {
        guard isActive, let workspace else { return }
        budgetGeneration = UUID()
        let generation = budgetGeneration
        let workspaceID = workspace.id
        let confirmations = Set(pending.values.filter { $0.state != .saving }.map(\.id))
        budgetSubscription?.cancel()
        budgetDeadline?.cancel()
        budgetDeadline = Task { [weak self, responseTimeout] in
            do { try await Task.sleep(for: responseTimeout) } catch { return }
            guard let self, self.isActive, self.budgetGeneration == generation else { return }
            self.budgetError =
                L10n.string(
                    "Your budget is taking longer to load. Check your connection and try again.")
        }
        budgetSubscription = subscribeToSnapshot(workspaceID, currentMonth)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.isActive, self.budgetGeneration == generation else {
                        return
                    }
                    if case .failure = completion {
                        self.budgetDeadline?.cancel()
                        self.budgetError = L10n.string(
                            "Couldn't refresh your budget. Please try again.")
                    }
                },
                receiveValue: { [weak self] snapshot in
                    guard let self, self.isActive, self.budgetGeneration == generation,
                        self.workspace?.id == workspaceID
                    else { return }
                    self.budgetDeadline?.cancel()
                    self.budgetError = nil
                    let months = Dictionary(
                        snapshot.months.map { ($0.yearMonth, $0.budgetData) },
                        uniquingKeysWith: { _, new in new })
                    if !self.hasLoadedSnapshot || self.months != months {
                        self.snapshotRevision += 1
                    }
                    self.months = months
                    self.planSummaries = Dictionary(
                        snapshot.months.compactMap { month in
                            month.summary.map { (month.yearMonth, $0) }
                        }, uniquingKeysWith: { _, new in new })
                    self.availableRange = snapshot.availableRange
                    self.authoritativeReadyToAssign = snapshot.readyToAssign
                    self.pending = self.pending.filter { !confirmations.contains($0.value.id) }
                    if !self.browsableMonths.contains(self.selectedMonth) {
                        self.moneyMove = nil
                        self.moneyMoveReceipt = nil
                        self.quickAssign = nil
                        self.selectedMonth = self.currentMonth
                    }
                    if self.isSelectedMonthLocked {
                        self.quickAssign = nil
                        self.moneyMove = nil
                        self.moneyMoveReceipt = nil
                    }
                    self.hasLoadedSnapshot = true
                    self.hasLoaded = self.hasLoadedStructure
                    self.isRefreshing = false
                    self.reconcileQuickAssign()
                    self.reconcileQuickAssignUndo()
                    self.reconcileMoneyMove()
                    self.rebuildPresentation()
                }
            )
    }

    func groups(for month: Int) -> [BudgetGroupModel] {
        if month == selectedMonth { return groups }
        // Offscreen month pages observe snapshot revisions, not the calculator.
        _ = presentationRevision
        if let cached = monthGroups[month] { return cached }
        let result = buildGroups(for: month)
        monthGroups[month] = result
        return result
    }

    /// Show saved balances and committed assignments, never an unfinished keypad preview.
    /// A missing snapshot is unknown, not a zero balance.
    func categoryPickerBalances(for month: Int) -> [String: Decimal]? {
        _ = presentationRevision
        guard hasLoaded, !isRefreshing, budgetError == nil, structureError == nil,
            let workspace, let data = months[month], !isMonthLocked(month)
        else { return nil }
        return Dictionary(
            uniqueKeysWithValues: structure.flatMap(\.categories).map { category in
                let amounts = data[category.id] ?? BudgetCategoryAmounts()
                let key = BudgetAssignmentKey(
                    workspaceID: workspace.id, yearMonth: month, categoryID: category.id)
                let assigned = pending[key]?.amount ?? amounts.assignedAmount
                return (
                    category.id,
                    Decimal(amounts.available) + Decimal(assigned) - Decimal(amounts.assignedAmount)
                )
            })
    }

    /// Uses the whole month's authoritative target totals, independent of visible categories.
    /// Committed assignments project progress until Convex publishes recalculated targets.
    func targetFundingSummary(for month: Int) -> BudgetTargetFundingSummary? {
        _ = presentationRevision
        guard let workspace, !isMonthLocked(month), let summary = planSummaries[month],
            let totalFunded = summary.totalFunded,
            let totalRemaining = summary.totalRemainingToFund
        else { return nil }
        var funded = Decimal(totalFunded)
        var remaining = Decimal(totalRemaining)
        for (key, assignment) in pending
        where key.workspaceID == workspace.id && key.yearMonth == month {
            let data = amounts(for: key)
            let delta = Decimal(assignment.amount) - Decimal(data.assignedAmount)
            guard let target = data.target, let previousRemaining = target.remainingToAssign,
                let projected = target.remainingFunding(
                    assigned: data.assignedAmount, assignmentDelta: delta)
            else { continue }
            let difference = Decimal(previousRemaining) - projected
            funded += difference
            remaining -= difference
        }
        return BudgetTargetFundingSummary(
            funded: funded, remaining: remaining, total: Decimal(summary.totalTargetAmount))
    }

    func monthlyFundingSummary(for month: Int) -> BudgetMonthlyFundingSummary? {
        guard let workspace, let targets = targetFundingSummary(for: month) else { return nil }
        var result = BudgetMonthlyFundingSummary(targets: targets)
        for category in structure.flatMap(\.categories) {
            guard let data = months[month]?[category.id] else { continue }
            let key = BudgetAssignmentKey(
                workspaceID: workspace.id, yearMonth: month, categoryID: category.id)
            let assigned = Decimal(pending[key]?.amount ?? data.assignedAmount)
            let delta = assigned - Decimal(data.assignedAmount)
            result.includeSpending(
                assigned: assigned, available: Decimal(data.available) + delta,
                target: data.target?.fundingSummary(
                    assigned: data.assignedAmount, assignmentDelta: delta))
        }
        return result
    }

    func categoryFundingSummary(categoryID: String, month: Int) -> BudgetTargetFundingSummary? {
        _ = presentationRevision
        guard let workspace, !isMonthLocked(month), let data = months[month]?[categoryID]
        else { return nil }
        let key = BudgetAssignmentKey(
            workspaceID: workspace.id, yearMonth: month, categoryID: categoryID)
        let delta =
            Decimal(pending[key]?.amount ?? data.assignedAmount) - Decimal(data.assignedAmount)
        return data.target?.fundingSummary(assigned: data.assignedAmount, assignmentDelta: delta)
    }

    private func buildGroups(for month: Int) -> [BudgetGroupModel] {
        guard let workspace, !isMonthLocked(month) else { return [] }
        let monthData = months[month] ?? [:]
        let nextGroups = structure.map { group in
            let rows = group.categories.map { category in
                let key = BudgetAssignmentKey(
                    workspaceID: workspace.id, yearMonth: month, categoryID: category.id)
                let data = monthData[category.id] ?? BudgetCategoryAmounts()
                let appliedAssignment = pending[key]?.amount ?? data.assignedAmount
                let assigned =
                    assignmentEditor?.key == key
                    ? displayedEditingAmount ?? appliedAssignment : appliedAssignment
                let funding = BudgetCategoryFunding(
                    amounts: data, assigned: appliedAssignment,
                    isFutureMonth: month > currentMonth)
                return BudgetCategoryRowModel(
                    id: category.id, name: category.name,
                    isCreditCard: category.type == "credit_card",
                    assigned: assigned,
                    available: Decimal(data.available) + Decimal(appliedAssignment)
                        - Decimal(data.assignedAmount),
                    activity: data.activity, isPending: pending[key] != nil,
                    hasUnmetTarget: data.target?.hasUnmetTarget ?? false,
                    targetFundingStatus: data.target?.fundingStatus(
                        assignmentDelta: Decimal(appliedAssignment) - Decimal(data.assignedAmount))
                        ?? .noTarget,
                    progress: BudgetCategoryProgress(
                        amounts: data, assigned: appliedAssignment,
                        targetKind: targets.targets[category.id]?.targetType,
                        isFutureMonth: month > currentMonth),
                    funding: funding,
                    extraFunded: funding.extraFunded(
                        targetKind: targets.targets[category.id]?.targetType)
                )
            }
            return BudgetGroupModel(
                id: group.id, name: group.categoryGroup.name, rows: rows,
                assigned: rows.reduce(Decimal.zero) { $0 + Decimal($1.assigned) },
                available: rows.reduce(Decimal.zero) { $0 + $1.available }
            )
        }
        return nextGroups
    }

    private func rebuildPresentation() {
        monthlyPlanAmount = planSummaries[currentMonth]?.totalTargetAmount
        monthGroups.removeAll(keepingCapacity: true)
        let nextGroups = buildGroups(for: selectedMonth)
        if groups != nextGroups { groups = nextGroups }
        let currentGroups =
            currentMonth == selectedMonth ? nextGroups : buildGroups(for: currentMonth)
        let overspent = currentGroups.flatMap(\.rows).filter { $0.available < 0 }
        if currentMonthOverspent != overspent { currentMonthOverspent = overspent }
        // RTA reflects applied assignments. The active category's keystrokes only
        // preview its row and group totals until focus leaves that category.
        readyToAssign = pending.reduce(Decimal(authoritativeReadyToAssign)) { total, entry in
            total + Decimal(amounts(for: entry.key).assignedAmount) - Decimal(entry.value.amount)
        }
        refreshQuickAssignPlan()
        validateQuickAssignUndo()
        refreshMoneyMove()
        presentationRevision &+= 1
    }

    private func amounts(for key: BudgetAssignmentKey) -> BudgetCategoryAmounts {
        months[key.yearMonth]?[key.categoryID] ?? BudgetCategoryAmounts()
    }

    private func clearWorkspace() {
        stopArchivedCategories()
        archivedCategoryCount = nil
        targetSnoozesInFlight.removeAll()
        targetSnoozeError = nil
        targets.stop()
        categoryFilter = .all
        isTargetSummaryExpanded = true
        moneyMove = nil
        moneyMoveReceipt = nil
        quickAssignUndo = nil
        quickAssign = nil
        clearEditing()
        workspaceGeneration = UUID()
        budgetGeneration = UUID()
        budgetSubscription?.cancel()
        budgetSubscription = nil
        budgetDeadline?.cancel()
        structure = []
        months = [:]
        planSummaries = [:]
        monthlyPlanAmount = nil
        isSavingPlan = false
        pendingPlanMove = nil
        queuedPlanMoves.removeAll()
        planError = nil
        groups = []
        monthGroups.removeAll()
        currentMonthOverspent = []
        pending = [:]
        collapsedGroupIDs = []
        authoritativeReadyToAssign = 0
        readyToAssign = 0
        availableRange = nil
        hasLoaded = false
        hasLoadedStructure = false
        hasLoadedSnapshot = false
        isRefreshing = true
        budgetError = nil
        saveError = nil
        selectedMonth = BudgetMonth.current(now: now())
    }

    private func collapseKey(_ workspaceID: String) -> String {
        "budget.collapsedGroups.\(workspaceID)"
    }

    private func isDefiniteRejection(_ error: Error) -> Bool {
        if error is BudgetSaveError { return true }
        if let error = error as? ClientError {
            switch error {
            case .ConvexError, .ServerError: return true
            case .InternalError: return false
            }
        }
        return false
    }
}

enum BudgetSaveError: Error { case rejected }

extension BudgetStore {
    var canMoveMoney: Bool {
        canEdit && quickAssign == nil && assignmentEditor == nil && moneyMove == nil
    }

    private var moneyMoveAccounts: [BudgetMoneyAccount] {
        guard let workspace else { return [] }
        return [
            .init(
                endpoint: .readyToAssign, name: L10n.string("Ready to Assign"),
                groupName: L10n.string("Unassigned money"),
                assigned: 0, available: readyToAssign)
        ]
            + structure.flatMap { group in
                group.categories.map { category in
                    let data = months[selectedMonth]?[category.id] ?? BudgetCategoryAmounts()
                    let key = BudgetAssignmentKey(
                        workspaceID: workspace.id, yearMonth: selectedMonth,
                        categoryID: category.id)
                    let assigned = pending[key]?.amount ?? data.assignedAmount
                    return BudgetMoneyAccount(
                        endpoint: .category(category.id), name: category.name,
                        groupName: group.categoryGroup.name, assigned: assigned,
                        available: Decimal(data.available) + Decimal(assigned)
                            - Decimal(data.assignedAmount), target: data.target)
                }
            }
    }

    /// A closed move keeps only its receipt, including while Undo is saving.
    private var moneyMoveOperation: BudgetMoneyMoveSession? {
        get { moneyMove ?? moneyMoveReceipt }
        set {
            if moneyMove != nil {
                moneyMove = newValue
            } else {
                moneyMoveReceipt = newValue
            }
        }
    }

    var moneyMoveReceiptTimeRemaining: TimeInterval {
        max(0, moneyMoveOperation?.receiptExpiresAt?.timeIntervalSince(now()) ?? 0)
    }

    func expireMoneyMoveReceipt(id: UUID) {
        guard let receipt = moneyMoveOperation, receipt.lastMoveID == id,
            !receipt.isBusy, receipt.receiptExpiresAt != nil,
            moneyMoveReceiptTimeRemaining <= 0
        else { return }
        if moneyMove != nil {
            moneyMove?.lastMoveID = nil
            moneyMove?.receiptExpiresAt = nil
        } else if readyToAssign == 0 {
            // Remove the visibility hold while retaining the receipt until the
            // foreground has fully covered its content and background.
            moneyMoveReceipt?.isClosingReceipt = true
        } else {
            moneyMoveReceipt = nil
        }
    }

    func finishMoneyMoveReceiptClosing(id: UUID) {
        guard moneyMoveReceipt?.lastMoveID == id, moneyMoveReceipt?.isClosingReceipt == true
        else { return }
        moneyMoveReceipt = nil
    }

    func beginMoneyMove(_ categoryID: String) {
        beginMoneyMove(at: .category(categoryID))
    }

    func beginMoneyMove(at endpoint: BudgetMoneyEndpoint) {
        guard canMoveMoney, let workspace,
            moneyMoveAccounts.contains(where: { $0.endpoint == endpoint })
        else { return }
        quickAssignUndo = nil
        moneyMoveReceipt = nil
        moneyMove = BudgetMoneyMoveSession(
            workspaceID: workspace.id, yearMonth: selectedMonth, anchor: endpoint,
            accounts: moneyMoveAccounts, minorUnit: workspace.minorUnit)
    }

    func endMoneyMove() {
        guard moneyMoveOperation?.isBusy != true else { return }
        moneyMove = nil
        moneyMoveReceipt = nil
    }

    func setMoneyMoveAmountEditing(_ editing: Bool) {
        guard moneyMove?.phase == .choosing else { return }
        moneyMove?.isEditingAmount = editing
    }

    func canChooseMoneyMoveAccount(_ endpoint: BudgetMoneyEndpoint) -> Bool {
        canEdit && moneyMove?.phase == .choosing
            && moneyMove?.choices.contains(where: { $0.endpoint == endpoint }) == true
    }

    func chooseMoneyMoveAccount(_ endpoint: BudgetMoneyEndpoint) {
        guard canChooseMoneyMoveAccount(endpoint) else { return }
        refreshMoneyMove()
        moneyMove?.choose(endpoint)
    }

    func flipMoneyMoveDirection() { moneyMove?.flipDirection() }

    func updateMoneyMoveCalculator(_ calculator: AmountCalculator, sessionID: UUID) {
        guard moneyMove?.id == sessionID, moneyMove?.phase == .choosing else { return }
        moneyMove?.calculator = calculator
        moneyMove?.errorMessage = nil
    }

    func useMoneyMoveMaximum() {
        guard let session = moneyMove, session.phase == .choosing,
            let amount = BudgetMoneyMoveSession.int64(session.sourceLimit)
        else { return }
        updateMoneyMoveCalculator(
            AmountCalculator(amount: amount, minorUnit: session.calculator.minorUnit),
            sessionID: session.id)
    }

    var canApplyMoneyMove: Bool {
        canEdit && pending.isEmpty && moneyMove?.canApply == true
            && moneyMove?.accounts == moneyMoveAccounts
    }

    /// Subscription changes invalidate a draft before it can overwrite newer assignments.
    private func refreshMoneyMove() {
        if var receipt = moneyMoveReceipt, !receipt.isBusy, pending.isEmpty {
            if receipt.phase == .undone {
                moneyMoveReceipt = nil
            } else if receipt.receiptExpiresAt == nil {
                receipt.receiptExpiresAt = now().addingTimeInterval(2.5)
                moneyMoveReceipt = receipt
            }
        }
        guard var session = moneyMove, !session.isBusy, pending.isEmpty
        else { return }
        guard moneyMoveAccounts.contains(where: { $0.endpoint == session.anchor }) else {
            moneyMove = nil
            moneyMoveReceipt = nil
            return
        }
        if session.isResult {
            session.accounts = moneyMoveAccounts
            if session.lastMoveID != nil && session.receiptExpiresAt == nil {
                session.receiptExpiresAt = now().addingTimeInterval(2.5)
            }
            if session.canContinueMoving {
                session.phase = .choosing
                session.clearSelection()
                let errorMessage = session.errorMessage
                session.chooseDefaultAccount()
                session.errorMessage = errorMessage
                moneyMove = session
            } else {
                moneyMoveReceipt = session.lastMoveID != nil ? session : nil
                moneyMove = nil
            }
            return
        }
        guard session.accounts != moneyMoveAccounts else { return }
        moneyMove?.accounts = moneyMoveAccounts
        moneyMove?.clearSelection()
        moneyMove?.errorMessage =
            L10n.string("Your budget changed. Review the updated balances before moving money.")
    }

    func applyMoneyMove() async {
        guard canApplyMoneyMove, let session = moneyMove, let changes = session.changes else {
            refreshMoneyMove()
            return
        }
        moneyMove?.savedChanges = changes
        moneyMove?.savedAmount = session.amount
        moneyMove?.savedSourceName = session.source.flatMap(session.account)?.name ?? ""
        moneyMove?.savedDestinationName = session.destination.flatMap(session.account)?.name ?? ""
        moneyMove?.lastMoveID = nil
        moneyMove?.receiptExpiresAt = nil
        moneyMove?.didCoverOverspending = session.isCovering && session.remaining == 0
        await persistMoneyMove(changes, session: session, undo: false)
    }

    var canUndoMoneyMove: Bool {
        guard let session = moneyMove ?? moneyMoveReceipt, session.lastMoveID != nil,
            session.phase == .finished || session.phase == .choosing, canEdit, pending.isEmpty,
            assignmentEditor == nil, quickAssign == nil,
            session.workspaceID == workspace?.id, session.yearMonth == selectedMonth
        else { return false }
        guard moneyMoveReceiptTimeRemaining > 0 else { return false }
        let accounts = moneyMoveAccounts
        return session.savedChanges.allSatisfy { change in
            accounts.contains {
                $0.endpoint == .category(change.id) && $0.assigned == change.assigned
            }
        }
    }

    var isConfirmingMoneyMove: Bool {
        moneyMoveOperation != nil && !pending.isEmpty && moneyMoveOperation?.isBusy != true
    }

    func undoMoneyMove() async {
        guard canUndoMoneyMove, let session = moneyMove ?? moneyMoveReceipt else { return }
        let changes = session.savedChanges.map { change in
            BudgetQuickAssignChange(
                id: change.id, name: change.name, groupName: change.groupName,
                previousAssigned: change.assigned, assigned: change.previousAssigned,
                previousAvailable: months[session.yearMonth]?[change.id]?.available ?? 0)
        }
        let rta = changes.reduce(readyToAssign) { $0 - $1.delta }
        guard BudgetMoneyMoveSession.int64(rta) != nil,
            changes.allSatisfy({ BudgetMoneyMoveSession.int64($0.available) != nil })
        else {
            if moneyMove != nil {
                moneyMove?.errorMessage = L10n.string(
                    "Undo would exceed the supported budget amount.")
            } else {
                moneyMoveReceipt?.errorMessage = L10n.string(
                    "Undo would exceed the supported budget amount.")
            }
            return
        }
        moneyMoveOperation?.receiptExpiresAt = nil
        await persistMoneyMove(changes, session: session, undo: true)
    }

    private func persistMoneyMove(
        _ changes: [BudgetQuickAssignChange], session: BudgetMoneyMoveSession, undo: Bool
    ) async {
        let generation = workspaceGeneration
        let operationID = UUID()
        let keys = changes.map {
            BudgetAssignmentKey(
                workspaceID: session.workspaceID, yearMonth: session.yearMonth, categoryID: $0.id)
        }
        moneyMoveOperation?.phase = undo ? .undoing : .saving
        moneyMoveOperation?.isEditingAmount = false
        moneyMoveOperation?.errorMessage = nil
        for (key, change) in zip(keys, changes) {
            pending[key] = PendingAssignment(id: operationID, amount: change.assigned)
        }
        rebuildPresentation()
        do {
            let result = try await assignBatch(
                .init(
                    workspaceID: session.workspaceID, yearMonth: session.yearMonth,
                    changes: changes))
            guard generation == workspaceGeneration else { return }
            guard result.success else { throw BudgetSaveError.rejected }
            for key in keys where pending[key]?.id == operationID {
                if amounts(for: key).assignedAmount == pending[key]?.amount {
                    pending.removeValue(forKey: key)
                } else {
                    pending[key]?.state = .confirmed
                }
            }
            if moneyMoveOperation?.id == session.id {
                moneyMoveOperation?.phase = undo ? .undone : .finished
                moneyMoveOperation?.lastMoveID = undo ? nil : UUID()
            }
            if isActive, keys.contains(where: { pending[$0]?.id == operationID }) { watchBudget() }
        } catch {
            guard generation == workspaceGeneration else { return }
            let rejected = isDefiniteRejection(error)
            for key in keys where pending[key]?.id == operationID {
                if rejected {
                    pending.removeValue(forKey: key)
                } else {
                    pending[key]?.state = .uncertain
                }
            }
            if moneyMoveOperation?.id == session.id {
                moneyMoveOperation?.phase =
                    rejected ? (undo ? .finished : .choosing) : (undo ? .checkingUndo : .checking)
                moneyMoveOperation?.errorMessage =
                    rejected
                    ? L10n.string(
                        "Couldn't \(undo ? L10n.string("undo this move") : L10n.string("move this money")). Please try again."
                    )
                    : L10n.string(
                        "Checking whether \(undo ? L10n.string("Undo") : L10n.string("your move")) saved."
                    )
            }
            if !rejected, isActive { watchBudget() }
        }
        rebuildPresentation()
    }

    private func reconcileMoneyMove() {
        guard let session = moneyMoveOperation,
            session.phase == .checking || session.phase == .checkingUndo
        else { return }
        let undo = session.phase == .checkingUndo
        let confirmed = session.savedChanges.allSatisfy {
            (months[session.yearMonth]?[$0.id]?.assignedAmount ?? 0)
                == (undo ? $0.previousAssigned : $0.assigned)
        }
        moneyMoveOperation?.phase =
            confirmed ? (undo ? .undone : .finished) : (undo ? .finished : .choosing)
        if confirmed { moneyMoveOperation?.lastMoveID = undo ? nil : UUID() }
        moneyMoveOperation?.errorMessage =
            confirmed
            ? nil : L10n.string("Your budget has been refreshed. Review it before trying again.")
    }
}

extension BudgetStore {
    static var preview: BudgetStore {
        preview(readyToAssign: 85_000)
    }

    static func preview(readyToAssign: Int64) -> BudgetStore {
        let month = BudgetMonth.current()
        let workspace = BudgetWorkspace(
            id: "preview", name: L10n.string("Personal"), currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: nil
        )
        let structure = BudgetStructure(
            workspace: workspace,
            categoryGroups: [
                BudgetCategoryGroup(
                    categoryGroup: .init(
                        _id: "essentials", name: L10n.string("Everyday essentials"), type: "expense"
                    ),
                    categories: [
                        .init(
                            _id: "groceries", name: L10n.string("Groceries"), iconName: nil,
                            type: "expense"),
                        .init(
                            _id: "dining", name: L10n.string("Dining out"), iconName: nil,
                            type: "expense"),
                    ]
                ),
                BudgetCategoryGroup(
                    categoryGroup: .init(
                        _id: "future", name: L10n.string("Looking ahead"), type: "expense"),
                    categories: [
                        .init(
                            _id: "travel", name: L10n.string("Next adventure"), iconName: nil,
                            type: "expense")
                    ]
                ),
            ])
        let snapshot = BudgetSnapshot(
            months: [
                BudgetMonthSnapshot(
                    yearMonth: month,
                    budgetData: [
                        "groceries": .init(
                            assignedAmount: 60_000, available: 38_450, activity: -21_550,
                            target: .init(
                                targetAmount: 75_000, underfundedAmount: 15_000,
                                assignmentNeeded: 75_000, remainingToAssign: 15_000,
                                fundedRatio: 0.8, spentRatio: 21_550.0 / 60_000)),
                        "dining": .init(
                            assignedAmount: 20_000, available: -2_400, activity: -22_400,
                            target: .init(fundedRatio: 1, spentRatio: 1)),
                        "travel": .init(
                            assignedAmount: 30_000, available: 145_000,
                            target: .init(fundedRatio: 1)),
                    ],
                    summary: .init(
                        totalTargetAmount: 75_000, totalFunded: 60_000,
                        totalRemainingToFund: 15_000))
            ],
            availableRange: .init(minYearMonth: month, maxYearMonth: month),
            readyToAssign: readyToAssign
        )
        return BudgetStore(
            defaults: nil,
            structureSubscription: {
                Just(structure).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            snapshotSubscription: { _, _ in
                Just(snapshot).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            assignmentHandler: { _ in BudgetAssignmentResult(success: true) }
        )
    }
}
