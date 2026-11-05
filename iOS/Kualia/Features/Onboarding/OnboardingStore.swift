import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class OnboardingStore {
    private(set) var step: OnboardingStep = .priorities
    var answers = OnboardingAnswers() { didSet { persist() } }
    var currencyCode = Locale.current.currency?.identifier ?? "USD" { didSet { persist() } }
    var selectedCategoryID: String? {
        didSet {
            if !isRestoring, oldValue != selectedCategoryID { invalidateExercise() }
            persist()
        }
    }
    var targetAmountText = "100" {
        didSet {
            if !isRestoring, oldValue != targetAmountText { invalidateExercise() }
            persist()
        }
    }
    private(set) var workspaceID: String?
    private(set) var budget: BudgetStore?
    private(set) var accounts: AccountsStore?
    private(set) var hasLoaded = false
    private(set) var hasReconciledWorkspace = false
    private(set) var isComplete = false
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    private(set) var targetSaved = false
    private(set) var didAssignMoney = false
    private(set) var didPractice = false

    var minorUnit: Int { budget?.workspace?.minorUnit ?? 2 }
    var readyToAssign: Decimal { budget?.readyToAssign ?? .zero }
    var hasReadyWorkspace: Bool {
        budget?.hasLoaded == true && accounts?.hasLoaded == true
            && budget?.workspace?.currencyCode == currencyCode
            && accounts?.workspace?.currencyCode == currencyCode
    }
    var hasFundedBankingAccount: Bool {
        accounts?.activeAccounts.contains {
            OnboardingFunding.isFundedBankingAccount(
                type: $0.accountType, balance: $0.currentBalance)
        } == true
    }
    var canContinueFromAccounts: Bool {
        OnboardingFunding.canContinue(
            hasLoaded: hasReadyWorkspace, hasFundedBankingAccount: hasFundedBankingAccount,
            readyToAssign: readyToAssign)
    }
    var needsAccountFunding: Bool {
        hasReadyWorkspace && hasReconciledWorkspace && !canContinueFromAccounts && !didAssignMoney
            && !canConfirmExistingAssignment && budget?.quickAssign == nil
            && budget?.assignmentEditor == nil && selectedAssignment?.isPending != true
            && (selectedAssignment?.assigned ?? 0) <= 0
    }

    func requireAccountFunding() {
        guard !isSaving, needsAccountFunding, step.index > OnboardingStep.accounts.index else {
            return
        }
        didPractice = false
        step = .accounts
        persist()
    }

    @discardableResult
    func saveCurrency(_ code: String) async -> Bool {
        guard !isSaving, step == .accounts, let workspaceID,
            Locale.commonISOCurrencyCodes.contains(code)
        else { return false }
        if code == currencyCode { return true }
        isSaving = true
        errorMessage = nil
        let requestGeneration = generation
        defer { if isCurrent(requestGeneration) { isSaving = false } }
        do {
            let result: OnboardingCompletionResult = try await client.mutation(
                "workspaces:updateWorkspaceCurrency",
                with: ["workspaceId": workspaceID, "currency": code])
            guard isCurrent(requestGeneration), self.workspaceID == workspaceID, result.success
            else { return false }
            currencyCode = code
            invalidateExercise()
            configureWorkspace(workspaceID)
            return true
        } catch {
            guard isCurrent(requestGeneration) else { return false }
            errorMessage = L10n.string("Couldn't change your currency. Please try again.")
            return false
        }
    }

    var categories: [BudgetCategory] {
        budget?.groups.flatMap { group in
            group.rows.filter { !$0.isCreditCard }.map {
                BudgetCategory(_id: $0.id, name: $0.name, iconName: nil, type: "expense")
            }
        } ?? []
    }
    var selectedCategory: BudgetCategory? {
        categories.first { $0.id == selectedCategoryID } ?? categories.first
    }
    var canGoBack: Bool {
        !isSaving && budget?.quickAssign?.phase != .saving
            && budget?.quickAssign?.phase != .checking
            && step != .priorities && step != .categories && step != .celebration
    }
    var targetAmount: Int64? { OnboardingAmount.minorUnits(targetAmountText, minorUnit: minorUnit) }
    var selectedAssignment: BudgetCategoryRowModel? {
        budget?.groups.flatMap(\.rows).first { $0.id == selectedCategory?.id }
    }

    var canConfirmExistingAssignment: Bool {
        guard targetSaved, budget?.canEdit == true,
            budget?.quickAssign?.isBusy != true, let selectedID = selectedCategory?.id,
            let row = budget?.groups.flatMap(\.rows).first(where: { $0.id == selectedID })
        else { return false }
        return OnboardingAssignment.canContinue(
            assigned: row.assigned, isPending: row.isPending,
            isEditing: budget?.assignmentEditor != nil, hasError: budget?.saveError != nil,
            readyToAssign: readyToAssign)
    }

    @ObservationIgnored private let client: ConvexClientWithAuth<String>
    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private let userID: String
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var isRestoring = true
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var profileSubscription: AnyCancellable?
    @ObservationIgnored private var startTask: Task<Void, Never>?
    @ObservationIgnored private var targetLoadTask: Task<Void, Never>?
    @ObservationIgnored private var profileDeadline: Task<Void, Never>?

    init(
        convexClient: ConvexClientWithAuth<String>, userID: String,
        initialWorkspaceID: String? = nil, defaults: UserDefaults? = .standard
    ) {
        client = convexClient
        self.userID = userID
        self.defaults = defaults
        var saved =
            defaults?.data(forKey: OnboardingCheckpoint.key(userID: userID))
            .flatMap { try? JSONDecoder().decode(OnboardingCheckpoint.self, from: $0) }
            ?? OnboardingCheckpoint()
        if let initialWorkspaceID { saved.reconcile(workspaceID: initialWorkspaceID) }
        restore(saved)
        isRestoring = false
    }

    func start() {
        guard !isActive else { return }
        isActive = true
        errorMessage = nil
        let requestGeneration = generation
        profileDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.isCurrent(requestGeneration), !self.hasLoaded else { return }
            self.errorMessage = L10n.string(
                "Your account is taking longer to load. Please try again.")
        }
        startTask = Task { [weak self] in
            guard let self else { return }
            do {
                let _: OnboardingProfileBootstrap = try await self.client.mutation(
                    "userProfiles:ensureCurrentProfile")
                guard self.isCurrent(requestGeneration) else { return }
                self.watchProfile(generation: requestGeneration)
            } catch {
                guard self.isCurrent(requestGeneration) else { return }
                self.errorMessage =
                    L10n.string("Couldn't load your account. Check your connection and try again.")
            }
        }
    }

    func stop() {
        persist()
        isActive = false
        generation = UUID()
        startTask?.cancel()
        targetLoadTask?.cancel()
        profileDeadline?.cancel()
        profileSubscription?.cancel()
        profileSubscription = nil
        isSaving = false
        budget?.stop()
        accounts?.stop()
    }

    func retry() {
        stop()
        start()
        budget?.start()
        accounts?.start()
    }

    func advance() {
        guard !isSaving else { return }
        if let next = step.nextQuestion {
            go(to: next)
            return
        }
        switch step {
        case .categories: go(to: .accounts)
        case .accounts: go(to: .readyToAssign)
        case .readyToAssign: go(to: .target)
        default: break
        }
    }

    func back() {
        guard canGoBack,
            let previous = OnboardingStep.allCases.first(where: { $0.index == step.index - 1 })
        else { return }
        go(to: previous)
    }

    func go(to next: OnboardingStep) {
        guard !isSaving else { return }
        guard next.index < OnboardingStep.categories.index || workspaceID != nil else { return }
        guard next != .assign || targetSaved else { return }
        if next.index > step.index, [.readyToAssign, .target, .assign].contains(next),
            !canContinueFromAccounts && !didAssignMoney && !canConfirmExistingAssignment
        {
            requireAccountFunding()
            return
        }
        guard next != .celebration || didAssignMoney else { return }
        if step == .assign, next != .assign, next != .celebration,
            let session = budget?.quickAssign
        {
            guard session.phase == .reviewing else { return }
            budget?.endQuickAssign(id: session.id)
        }
        step = next
        errorMessage = nil
        persist()
    }

    @discardableResult
    func prepareBudget() async -> Bool {
        guard !isSaving, hasLoaded, !isComplete else { return false }
        isSaving = true
        errorMessage = nil
        let requestGeneration = generation
        defer { if isCurrent(requestGeneration) { isSaving = false } }
        do {
            let result: OnboardingWorkspaceResult = try await client.mutation(
                "userProfiles:prepareGuidedOnboarding",
                with: [
                    "onboardingAnswers": answers.arguments,
                    "currency": currencyCode,
                    "timezone": TimeZone.current.identifier,
                ])
            guard isCurrent(requestGeneration) else { return false }
            configureWorkspace(result.workspaceId)
            step = .categories
            persist()
            return true
        } catch {
            guard isCurrent(requestGeneration) else { return false }
            errorMessage =
                L10n.string(
                    "Couldn't prepare your categories. Your progress is safe. Please try again.")
            return false
        }
    }

    @discardableResult
    func saveTarget() async -> Bool {
        guard canContinueFromAccounts || canConfirmExistingAssignment else {
            requireAccountFunding()
            return false
        }
        guard !isSaving, let workspaceID, let category = selectedCategory,
            let amount = targetAmount, budget?.hasLoaded == true
        else {
            errorMessage = L10n.string(
                "Choose a category and enter a positive amount for your target.")
            return false
        }
        if targetSaved, selectedCategoryID == category.id {
            go(to: .assign)
            return true
        }
        isSaving = true
        errorMessage = nil
        let requestGeneration = generation
        defer { if isCurrent(requestGeneration) { isSaving = false } }
        do {
            let _: OnboardingTargetResult = try await client.mutation(
                "userProfiles:prepareGuidedOnboardingTarget",
                with: [
                    "workspaceId": workspaceID, "categoryId": category.id, "amount": Double(amount),
                ])
            guard isCurrent(requestGeneration) else { return false }
            selectedCategoryID = category.id
            targetSaved = true
            step = .assign
            budget?.retry()
            persist()
            return true
        } catch {
            guard isCurrent(requestGeneration) else { return false }
            errorMessage = L10n.string(
                "Couldn't save this target. Your progress is safe. Please try again.")
            return false
        }
    }

    func observeQuickAssignCompletion() {
        guard let session = budget?.quickAssign, session.phase == .finished,
            let categoryID = selectedCategory?.id,
            session.plan.changes.contains(where: { $0.id == categoryID && $0.assigned > 0 })
        else { return }
        didAssignMoney = true
        didPractice = false
        go(to: .celebration)
    }

    @discardableResult
    func confirmExistingAssignment() -> Bool {
        guard canConfirmExistingAssignment else { return false }
        didAssignMoney = true
        didPractice = false
        go(to: .celebration)
        return true
    }

    @discardableResult
    func finish() async -> Bool {
        guard !isSaving, targetSaved, didAssignMoney,
            let workspaceID, let category = selectedCategory
        else { return false }
        isSaving = true
        errorMessage = nil
        let requestGeneration = generation
        defer { if isCurrent(requestGeneration) { isSaving = false } }
        do {
            let result: OnboardingCompletionResult = try await client.mutation(
                "userProfiles:finishGuidedOnboarding",
                with: [
                    "workspaceId": workspaceID, "categoryId": category.id,
                    "practicedWithoutFunds": false,
                ])
            guard isCurrent(requestGeneration), result.success else { return false }
            isComplete = true
            AdAttributionStore.shared.record(.onboardingCompleted)
            defaults?.removeObject(forKey: OnboardingCheckpoint.key(userID: userID))
            return true
        } catch {
            guard isCurrent(requestGeneration) else { return false }
            errorMessage =
                L10n.string(
                    "Couldn't finish setup. Check your connection, or return to your assignment if your balance changed."
                )
            if let clientError = error as? ClientError, case .ConvexError = clientError {
                step = .assign
                didAssignMoney = false
                didPractice = false
                budget?.retry()
                persist()
            }
            return false
        }
    }

    private func watchProfile(generation requestGeneration: UUID) {
        profileSubscription = client.subscribe(
            to: "userProfiles:getCurrentProfile", yielding: OnboardingProfile?.self
        ).receive(on: DispatchQueue.main).sink(
            receiveCompletion: { [weak self] completion in
                guard let self, self.isCurrent(requestGeneration) else { return }
                if case .failure = completion {
                    self.profileDeadline?.cancel()
                    self.errorMessage = L10n.string("Couldn't load your account. Please try again.")
                }
            },
            receiveValue: { [weak self] profile in
                guard let self, self.isCurrent(requestGeneration), let profile else { return }
                self.profileDeadline?.cancel()
                self.hasLoaded = true
                self.isComplete = profile.onboardingCompleted
                self.errorMessage = nil
                if profile.onboardingCompleted {
                    self.defaults?.removeObject(
                        forKey: OnboardingCheckpoint.key(userID: self.userID))
                    return
                }
                var saved = self.checkpoint
                saved.reconcile(workspaceID: profile.activeWorkspaceId)
                self.isRestoring = true
                self.restore(saved)
                self.isRestoring = false
                if let workspaceID = profile.activeWorkspaceId {
                    self.configureWorkspace(workspaceID)
                } else {
                    self.budget?.reset()
                    self.accounts?.reset()
                    self.budget = nil
                    self.accounts = nil
                }
                self.persist()
            })
    }

    private func configureWorkspace(_ id: String) {
        let needsStores = budget == nil || budgetWorkspaceID != id
        workspaceID = id
        if needsStores {
            budget?.stop()
            accounts?.stop()
            budgetWorkspaceID = id
            budget = BudgetStore(convexClient: client, workspaceID: id)
            accounts = AccountsStore(convexClient: client, workspaceID: id)
        }
        budget?.start()
        accounts?.start()
        let requestGeneration = generation
        targetLoadTask?.cancel()
        hasReconciledWorkspace = false
        targetLoadTask = Task { [weak self] in
            guard let self else { return }
            // A previous assignment may have consumed the last available money.
            // Reconcile it before deciding that a resumed user needs more funds.
            defer {
                if self.isCurrent(requestGeneration), self.workspaceID == id, !Task.isCancelled {
                    self.hasReconciledWorkspace = true
                }
            }
            do {
                let structure = try await TransactionEditorQuery<BudgetStructure>().read(
                    self.client.subscribe(
                        to: "categoryBudgets:listBudgetStructure", with: ["workspaceId": id],
                        yielding: BudgetStructure.self
                    ).mapError { $0 as Error }.eraseToAnyPublisher())
                guard self.isCurrent(requestGeneration), self.workspaceID == id else { return }
                if let workspace = structure.workspace {
                    self.currencyCode = workspace.currencyCode
                    self.accounts?.prepareForBudgetWorkspace(workspace)
                }
                let ids = Set(structure.categoryGroups.flatMap(\.categories).map(\.id))
                if let selected = self.selectedCategoryID, !ids.contains(selected) {
                    self.selectedCategoryID = nil
                    self.targetSaved = false
                    self.didAssignMoney = false
                    self.didPractice = false
                    if self.step.index > OnboardingStep.target.index { self.step = .target }
                }
                if self.selectedCategoryID == nil {
                    self.selectedCategoryID =
                        structure.categoryGroups.flatMap(\.categories)
                        .first(where: {
                            $0.type != "credit_card"
                                && $0.name.localizedCaseInsensitiveContains("groceries")
                        })?.id
                        ?? structure.categoryGroups.flatMap(\.categories).first(where: {
                            $0.type != "credit_card"
                        })?.id
                }
                self.persist()
                guard self.targetSaved, let categoryID = self.selectedCategoryID,
                    let workspace = structure.workspace
                else { return }
                let targets = try await TransactionEditorQuery<[String: OnboardingExistingTarget]>()
                    .read(
                        self.client.subscribe(
                            to: "categoryTargets:getCategoryTargetMapByCategories",
                            with: [
                                "workspaceId": id,
                                "categoryIds": [categoryID as ConvexEncodable?],
                            ],
                            yielding: [String: OnboardingExistingTarget].self
                        ).mapError { $0 as Error }.eraseToAnyPublisher())
                guard self.isCurrent(requestGeneration), self.workspaceID == id,
                    self.selectedCategoryID == categoryID, self.targetSaved, !self.isSaving,
                    self.budget?.quickAssign == nil
                else { return }
                guard let amount = targets[categoryID]?.amount, amount > 0,
                    amount
                        == OnboardingAmount.minorUnits(
                            self.targetAmountText, minorUnit: workspace.minorUnit)
                else {
                    self.invalidateExercise()
                    if self.step.index > OnboardingStep.target.index { self.step = .target }
                    self.persist()
                    return
                }
                let month = BudgetMonth.current(timezoneIdentifier: workspace.timezoneIdentifier)
                let snapshot = try await TransactionEditorQuery<BudgetSnapshot>().read(
                    self.client.subscribe(
                        to: "categoryBudgets:listBudgetDataByMonth",
                        with: ["workspaceId": id, "currentYearMonth": Int64(month)],
                        yielding: BudgetSnapshot.self
                    ).mapError { $0 as Error }.eraseToAnyPublisher())
                guard self.isCurrent(requestGeneration), self.workspaceID == id,
                    self.selectedCategoryID == categoryID, self.targetSaved, !self.isSaving,
                    self.budget?.quickAssign == nil
                else { return }
                let assigned =
                    snapshot.months.first { $0.yearMonth == month }?
                    .budgetData[categoryID]?.assignedAmount ?? 0
                if assigned > 0 {
                    self.didAssignMoney = true
                    self.didPractice = false
                    if self.step == .assign { self.step = .celebration }
                } else if self.didAssignMoney || (self.didPractice && snapshot.readyToAssign > 0) {
                    self.didAssignMoney = false
                    self.didPractice = false
                    if self.step == .celebration { self.step = .assign }
                }
                self.persist()
            } catch {
                // The budget/account stores own visible loading and retry errors.
            }
        }
    }

    @ObservationIgnored private var budgetWorkspaceID: String?

    private func isCurrent(_ requestGeneration: UUID) -> Bool {
        isActive && generation == requestGeneration
    }

    private func invalidateExercise() {
        targetSaved = false
        didAssignMoney = false
        didPractice = false
    }

    private var checkpoint: OnboardingCheckpoint {
        .init(
            step: step, answers: answers, currencyCode: currencyCode, workspaceID: workspaceID,
            selectedCategoryID: selectedCategoryID, targetAmountText: targetAmountText,
            targetSaved: targetSaved, didAssignMoney: didAssignMoney, didPractice: didPractice)
    }

    private func restore(_ value: OnboardingCheckpoint) {
        step = value.step
        answers = value.answers
        currencyCode = value.currencyCode
        workspaceID = value.workspaceID
        selectedCategoryID = value.selectedCategoryID
        targetAmountText = value.targetAmountText
        targetSaved = value.targetSaved
        didAssignMoney = value.didAssignMoney
        didPractice = value.didPractice
    }

    private func persist() {
        guard !isRestoring, !isComplete,
            let encoded = try? JSONEncoder().encode(checkpoint)
        else { return }
        defaults?.set(encoded, forKey: OnboardingCheckpoint.key(userID: userID))
    }
}
