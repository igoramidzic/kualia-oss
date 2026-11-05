import Combine
import ConvexMobile
import Foundation
import Observation

struct AppWorkspace: Decodable, Identifiable, Equatable {
    let _id: String
    let name: String
    var isArchived = false
    var accessKind: String? = nil
    var currencyCode: String? = nil
    var minorUnit: Int? = nil
    var timezoneIdentifier: String? = nil

    var id: String { _id }
    var isShared: Bool { accessKind == "family" }

    var budgetWorkspace: BudgetWorkspace? {
        guard let currencyCode, let minorUnit else { return nil }
        return BudgetWorkspace(
            id: id, name: name, currencyCode: currencyCode, minorUnit: minorUnit,
            timezoneIdentifier: timezoneIdentifier)
    }
}

struct AppWorkspaceProfile: Decodable {
    let activeWorkspaceId: String?
}

private struct WorkspaceSelectionResult: Decodable { let success: Bool }
private enum WorkspaceSelectionError: Error { case rejected }

/// A page reports first-data readiness, including a valid empty result. Future
/// pages can add their own preparation here without adding another launch screen.
enum PageReadiness: Equatable {
    case loading
    case ready
    case failed(String)
}

struct AppPreparationState: Equatable {
    let transitionID: UUID?
    let readiness: PageReadiness
}

@MainActor
final class HomeWorkspaceSession: Identifiable {
    let id = UUID()
    let workspace: AppWorkspace
    let budget: BudgetStore
    let transactions: TransactionFeedStore
    let accounts: AccountsStore
    let home: HomeDashboardStore
    let reports: ReportsStore
    let editorChoices: TransactionEditorChoicesStore?

    private var isPrepared = false
    private var observationID = UUID()
    private var receiptRevision = 0

    init(
        workspace: AppWorkspace, budget: BudgetStore, transactions: TransactionFeedStore,
        accounts: AccountsStore, home: HomeDashboardStore, reports: ReportsStore? = nil,
        editorChoices: TransactionEditorChoicesStore? = nil
    ) {
        self.editorChoices = editorChoices
        self.workspace = workspace
        self.budget = budget
        self.transactions = transactions
        self.accounts = accounts
        self.home = home
        self.reports = reports ?? .preview
    }

    func prepare() {
        guard !isPrepared else { return }
        isPrepared = true
        observationID = UUID()
        // The catalog already contains the authorized workspace's currency and
        // timezone. Start dependent queries before a page response comes back.
        budget.prepare(workspace: workspace.budgetWorkspace)
        observeWorkspace()
        // Page visibility never owns data lifetime. Prepare all primary pages
        // here; calendar/report queries begin as soon as workspace metadata lands.
        home.start()
        budget.start()
        transactions.start()
        accounts.start()
        reports.start()
        transactions.prepareAgenda()
        editorChoices?.start()
    }

    private func observeWorkspace() {
        let token = observationID
        let (budgetWorkspace, feedWorkspace, revision) = withObservationTracking {
            (budget.workspace, transactions.workspace, transactions.mutationReceiptRevision)
        } onChange: { [weak self] in
            // Observation fires before the write. Reconcile after it completes,
            // and reject callbacks from stopped or replaced workspace sessions.
            Task { @MainActor [weak self] in
                guard let self, self.isPrepared, self.observationID == token else { return }
                self.observeWorkspace()
            }
        }
        if let budgetWorkspace, budgetWorkspace.id == workspace.id {
            accounts.prepareForBudgetWorkspace(budgetWorkspace)
            transactions.prepareForBudgetWorkspace(budgetWorkspace)
        } else if let feedWorkspace, feedWorkspace.id == workspace.id {
            accounts.prepare(workspace: feedWorkspace)
        }
        let metadata = transactions.workspace
        if let metadata, metadata.id == workspace.id {
            reports.prepare(
                .init(
                    id: metadata.id, currencyCode: metadata.currencyCode,
                    minorUnit: metadata.minorUnit, timezone: metadata.timezoneIdentifier))
            transactions.prepareAgenda()
        }
        if revision != receiptRevision {
            receiptRevision = revision
            if transactions.latestMutationReceipt?.isPending == false { reports.reload() }
        }
    }

    func refreshDates(now: Date = .now, refreshStaleReports: Bool = false) {
        guard isPrepared else { return }
        home.refreshIfNeeded(now: now)
        budget.refreshCurrentMonth()
        accounts.refreshCurrentMonth()
        transactions.agenda?.refreshDay()
        reports.refreshIfNeeded(refreshStaleContent: refreshStaleReports)
    }

    func refreshForNavigation(to page: HomePage) {
        guard isPrepared, page == .reports else { return }
        // Reports are cached request/response summaries. Revalidate a stale
        // summary at this boundary without tying its task to a view's lifetime.
        reports.refreshIfNeeded(refreshStaleContent: true)
    }

    func readiness(for page: HomePage) -> PageReadiness {
        switch page {
        case .budget:
            if budget.hasLoaded, budget.workspace?.id == workspace.id { return .ready }
            return budget.errorMessage.map(PageReadiness.failed) ?? .loading
        case .transactions:
            if transactions.hasLoaded, transactions.workspace?.id == workspace.id { return .ready }
            return transactions.errorMessage.map(PageReadiness.failed) ?? .loading
        case .accounts:
            if accounts.hasLoaded, accounts.workspace?.id == workspace.id { return .ready }
            return accounts.errorMessage.map(PageReadiness.failed) ?? .loading
        case .home:
            return home.isLoading(budget: budget) ? .loading : .ready
        case .planned, .reports:
            return .ready
        }
    }

    func retry(_ page: HomePage) {
        switch page {
        case .budget: budget.retry()
        case .transactions: transactions.retry()
        case .accounts: accounts.retry()
        case .home:
            home.retry()
            budget.retry()
        case .planned: transactions.agenda?.retry()
        case .reports: reports.reload()
        }
    }

    func stop() {
        isPrepared = false
        observationID = UUID()
        editorChoices?.stop()
        home.stop()
        budget.stop()
        transactions.stop()
        accounts.stop()
        reports.stop()
    }

    func reset() {
        stop()
        home.reset()
        budget.reset()
        transactions.reset()
        accounts.reset()
        reports.reset()
    }
}

/// Authentication, workspace selection and first-page preparation share one
/// admission boundary. A candidate never replaces the visible session until its
/// requested page is ready, and each candidate uses explicitly scoped queries.
@MainActor
@Observable
final class AppSessionStore {
    typealias WorkspaceSubscription = () -> AnyPublisher<[AppWorkspace], Error>
    typealias ProfileSubscription = () -> AnyPublisher<AppWorkspaceProfile?, Error>
    typealias SessionFactory = (AppWorkspace) -> HomeWorkspaceSession
    typealias SelectionHandler = (String) async throws -> Void

    let navigation = HomeNavigationState()
    let navigationAttention: HomeNavigationAttentionStore
    private(set) var workspaces: [AppWorkspace] = []
    private(set) var current: HomeWorkspaceSession?
    private(set) var pending: HomeWorkspaceSession?
    private(set) var transitionID: UUID?
    private(set) var isFadingOut = false
    private(set) var targetWorkspace: AppWorkspace?
    private(set) var targetPage: HomePage?
    private var workspaceListError: String?
    private var profileError: String?
    private var catalogTimeoutError: String?
    private var hasElapsedMinimumSwitchDuration = true
    private var isReplacingRemovedWorkspace = false
    @ObservationIgnored private var isWorkspaceSwitchPeekCovered = false
    @ObservationIgnored private var isApplicationActive = true
    private(set) var hasLoadedWorkspaces = false
    var selectionSaveError: String?

    @ObservationIgnored private let subscribeToWorkspaces: WorkspaceSubscription
    @ObservationIgnored private let subscribeToProfile: ProfileSubscription
    @ObservationIgnored private let makeSession: SessionFactory
    @ObservationIgnored private let saveSelection: SelectionHandler
    @ObservationIgnored private let responseTimeout: Duration
    @ObservationIgnored private let minimumWorkspaceSwitchDuration: Duration
    @ObservationIgnored private var workspaceSwitchDeadline: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private var userID: String?
    @ObservationIgnored private var authenticationID: String?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var catalogAttempt = UUID()
    @ObservationIgnored private var catalogSubscription: AnyCancellable?
    @ObservationIgnored private var profileSubscription: AnyCancellable?
    @ObservationIgnored private var catalogDeadline: Task<Void, Never>?
    @ObservationIgnored private var selectionTask: Task<Void, Never>?
    @ObservationIgnored private var selectionToSave: String?
    @ObservationIgnored private var profileHasLoaded = false
    @ObservationIgnored private var initialWorkspaceID: String?
    @ObservationIgnored private var requestedWorkspaceID: String?

    convenience init(convexClient: ConvexClientWithAuth<String>) {
        self.init(
            navigationAttention: HomeNavigationAttentionStore(convexClient: convexClient),
            workspaceSubscription: {
                convexClient.subscribe(
                    to: "workspaces:getUserWorkspaces", yielding: [AppWorkspace].self
                )
                .mapError { $0 as Error }.eraseToAnyPublisher()
            },
            profileSubscription: {
                convexClient.subscribe(
                    to: "userProfiles:getCurrentProfile", yielding: AppWorkspaceProfile?.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            sessionFactory: { workspace in
                let choices = TransactionEditorChoicesStore(
                    workspaceID: workspace.id, convexClient: convexClient)
                return HomeWorkspaceSession(
                    workspace: workspace,
                    budget: BudgetStore(convexClient: convexClient, workspaceID: workspace.id),
                    transactions: TransactionFeedStore(
                        convexClient: convexClient, workspaceID: workspace.id, choicesStore: choices
                    ),
                    accounts: AccountsStore(
                        convexClient: convexClient, workspaceID: workspace.id, choicesStore: choices
                    ),
                    home: HomeDashboardStore(convexClient: convexClient, workspaceID: workspace.id),
                    reports: ReportsStore(convexClient: convexClient, workspaceID: workspace.id),
                    editorChoices: choices)
            },
            selectionHandler: { workspaceID in
                let result: WorkspaceSelectionResult = try await convexClient.mutation(
                    "workspaces:updateActiveWorkspace", with: ["workspaceId": workspaceID])
                guard result.success else { throw WorkspaceSelectionError.rejected }
            })
    }

    init(
        defaults: UserDefaults? = .standard,
        responseTimeout: Duration = .seconds(15),
        minimumWorkspaceSwitchDuration: Duration = .seconds(1),
        navigationAttention: HomeNavigationAttentionStore? = nil,
        workspaceSubscription: @escaping WorkspaceSubscription,
        profileSubscription: @escaping ProfileSubscription,
        sessionFactory: @escaping SessionFactory,
        selectionHandler: @escaping SelectionHandler
    ) {
        self.defaults = defaults
        self.responseTimeout = responseTimeout
        self.minimumWorkspaceSwitchDuration = minimumWorkspaceSwitchDuration
        self.navigationAttention = navigationAttention ?? .init()
        subscribeToWorkspaces = workspaceSubscription
        subscribeToProfile = profileSubscription
        makeSession = sessionFactory
        saveSelection = selectionHandler
    }

    var isTransitioning: Bool { transitionID != nil }
    // A removed workspace must release its data immediately, but the replacement
    // session can still supply the Home shell while its content stays hidden.
    var displayedSession: HomeWorkspaceSession? {
        current ?? (isReplacingRemovedWorkspace ? pending : nil)
    }
    var preparationState: AppPreparationState {
        .init(transitionID: transitionID, readiness: preparation)
    }
    var catalogError: String? { workspaceListError ?? profileError ?? catalogTimeoutError }
    var visibleWorkspaceName: String? {
        workspaces.first { $0.id == current?.workspace.id }?.name ?? current?.workspace.name
    }
    var hasNoWorkspaces: Bool { hasLoadedWorkspaces && workspaces.isEmpty && catalogError == nil }
    var preparation: PageReadiness {
        guard !isFadingOut else { return .loading }
        if let catalogError, current == nil { return .failed(catalogError) }
        guard isTransitioning else { return current == nil ? .loading : .ready }
        let readiness =
            (pending ?? current)?.readiness(for: targetPage ?? navigation.selectedPage)
            ?? .loading
        return readiness == .ready && !hasElapsedMinimumSwitchDuration ? .loading : readiness
    }

    func setApplicationActive(_ active: Bool) {
        guard isApplicationActive != active else { return }
        isApplicationActive = active
        if active { refreshDates(refreshStaleReports: true) }
    }

    /// Backgrounding keeps the workspace subscriptions intact. Pause automatic
    /// date checks until the app returns to the foreground.
    func refreshDates(now: Date = .now, refreshStaleReports: Bool = false) {
        guard isApplicationActive else { return }
        navigationAttention.refreshIfNeeded(now: now)
        current?.refreshDates(now: now, refreshStaleReports: refreshStaleReports)
        pending?.refreshDates(now: now, refreshStaleReports: refreshStaleReports)
    }

    func start(userID: String, sessionID: String? = nil) {
        guard self.userID != userID || authenticationID != sessionID else { return }
        reset()
        self.userID = userID
        authenticationID = sessionID
        navigationAttention.start()
        watchCatalog()
    }

    func reset() {
        navigationAttention.reset()
        isWorkspaceSwitchPeekCovered = false
        generation = UUID()
        catalogSubscription?.cancel()
        profileSubscription?.cancel()
        catalogDeadline?.cancel()
        selectionTask?.cancel()
        catalogSubscription = nil
        profileSubscription = nil
        selectionTask = nil
        selectionToSave = nil
        current?.reset()
        pending?.reset()
        current = nil
        pending = nil
        workspaces = []
        userID = nil
        authenticationID = nil
        hasLoadedWorkspaces = false
        profileHasLoaded = false
        initialWorkspaceID = nil
        requestedWorkspaceID = nil
        workspaceListError = nil
        profileError = nil
        catalogTimeoutError = nil
        selectionSaveError = nil
        clearTransition()
        navigation.restore(.budget)
    }

    /// Called after Settings has closed. Creation can finish before the live
    /// catalog publishes the new workspace, so retain the request until then.
    func requestWorkspaceWhenAvailable(id: String) {
        requestedWorkspaceID = id
        resolveRequestedWorkspace()
    }

    private func resolveRequestedWorkspace() {
        guard let id = requestedWorkspaceID, !isTransitioning,
            let workspace = workspaces.first(where: { $0.id == id })
        else { return }
        requestedWorkspaceID = nil
        requestWorkspace(workspace)
        // Settings already completed the outgoing navigation animation. There
        // is no Home menu animation to call finishFade for this entry point.
        finishFade(id: transitionID)
        // Cached destinations can be ready synchronously. Other destinations
        // wait for the root to observe their first results.
        revealIfReady()
    }

    func requestWorkspace(_ workspace: AppWorkspace) {
        guard !isTransitioning, workspace.id != current?.workspace.id,
            workspaces.contains(where: { $0.id == workspace.id })
        else { return }
        targetWorkspace = workspace
        targetPage = navigation.selectedPage
        hasElapsedMinimumSwitchDuration =
            (current == nil && !isReplacingRemovedWorkspace)
            || minimumWorkspaceSwitchDuration <= .zero
        transitionID = UUID()
        isFadingOut = current != nil
        if !isFadingOut { finishFade(id: transitionID) }
    }

    func requestPage(_ page: HomePage) {
        guard !isTransitioning, let current else { return }
        if current.readiness(for: page) == .ready {
            navigation.select(page)
            current.refreshForNavigation(to: page)
        } else {
            targetPage = page
            transitionID = UUID()
            isFadingOut = true
        }
    }

    /// Called by the fade's animation completion, never by a guessed network delay.
    func finishFade(id: UUID?) {
        guard let id, transitionID == id,
            isFadingOut || (current == nil && pending == nil && targetWorkspace != nil)
        else { return }
        isFadingOut = false
        if let targetWorkspace {
            startWorkspaceSwitchDeadline()
            current?.stop()
            pending = makeSession(targetWorkspace)
            if let userID { pending?.home.configureDismissals(userID: userID, defaults: defaults) }
            pending?.prepare()
        } else if let targetPage {
            current?.retry(targetPage)
        }
    }

    func revealIfReady() {
        guard isTransitioning, preparation == .ready else { return }
        if let pending {
            let shouldRemember = current != nil || pending.workspace.id != initialWorkspaceID
            current?.stop()
            current = pending
            self.pending = nil
            navigation.restore(targetPage ?? navigation.selectedPage)
            if shouldRemember {
                rememberWorkspace(pending.workspace.id)
            }
        } else if let targetPage {
            navigation.select(targetPage)
        }
        current?.refreshForNavigation(to: navigation.selectedPage)
        clearTransition()
        resolveRequestedWorkspace()
    }

    func setWorkspaceSwitchPeekCovered(_ covered: Bool) {
        isWorkspaceSwitchPeekCovered = covered
        if covered {
            workspaceSwitchDeadline?.cancel()
            workspaceSwitchDeadline = nil
            if targetWorkspace != nil, minimumWorkspaceSwitchDuration > .zero {
                hasElapsedMinimumSwitchDuration = false
            }
        } else {
            startWorkspaceSwitchDeadline()
        }
    }

    private func startWorkspaceSwitchDeadline() {
        guard let id = transitionID, targetWorkspace != nil, !isFadingOut,
            !hasElapsedMinimumSwitchDuration, !isWorkspaceSwitchPeekCovered,
            workspaceSwitchDeadline == nil
        else { return }
        // Start the minimum visible time after Settings has actually dismissed.
        workspaceSwitchDeadline = Task { [weak self, minimumWorkspaceSwitchDuration] in
            do { try await Task.sleep(for: minimumWorkspaceSwitchDuration) } catch { return }
            guard let self, self.transitionID == id else { return }
            self.hasElapsedMinimumSwitchDuration = true
        }
    }

    func retry() {
        if catalogError != nil {
            workspaceListError = nil
            profileError = nil
            catalogTimeoutError = nil
            watchCatalog()
        } else {
            (pending ?? current)?.retry(targetPage ?? navigation.selectedPage)
        }
    }

    func cancelTransition() {
        guard current != nil else { return }
        pending?.reset()
        pending = nil
        clearTransition()
        current?.prepare()
    }

    func retrySavingSelection() {
        guard let current else { return }
        rememberWorkspace(current.workspace.id)
    }

    private func clearTransition() {
        isReplacingRemovedWorkspace = false
        workspaceSwitchDeadline?.cancel()
        workspaceSwitchDeadline = nil
        hasElapsedMinimumSwitchDuration = true
        transitionID = nil
        targetWorkspace = nil
        targetPage = nil
        isFadingOut = false
    }

    private func watchCatalog() {
        let generation = generation
        catalogAttempt = UUID()
        let attempt = catalogAttempt
        hasLoadedWorkspaces = false
        profileHasLoaded = false
        catalogSubscription?.cancel()
        profileSubscription?.cancel()
        catalogDeadline?.cancel()
        catalogDeadline = Task { [weak self, responseTimeout] in
            do { try await Task.sleep(for: responseTimeout) } catch { return }
            guard let self, self.generation == generation, self.catalogAttempt == attempt else {
                return
            }
            self.catalogTimeoutError =
                L10n.string(
                    "Your workspaces are taking longer to load. Check your connection and try again."
                )
        }
        catalogSubscription = subscribeToWorkspaces()
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.generation == generation, self.catalogAttempt == attempt
                    else { return }
                    if case .failure = completion {
                        self.catalogDeadline?.cancel()
                        self.workspaceListError = L10n.string(
                            "Couldn't load your workspaces. Please try again.")
                    }
                },
                receiveValue: { [weak self] workspaces in
                    guard let self, self.generation == generation, self.catalogAttempt == attempt
                    else { return }
                    let previousWorkspaces = self.workspaces
                    self.workspaces = workspaces.filter { !$0.isArchived }
                    self.hasLoadedWorkspaces = true
                    self.workspaceListError = nil
                    self.reconcileWorkspaceAccess(previousWorkspaces: previousWorkspaces)
                    self.resolveRequestedWorkspace()
                    self.resolveInitialWorkspace()
                })
        profileSubscription = subscribeToProfile().prefix(1)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    guard let self, self.generation == generation, self.catalogAttempt == attempt
                    else { return }
                    if case .failure = completion {
                        self.catalogDeadline?.cancel()
                        self.profileError = L10n.string(
                            "Couldn't restore your workspace. Please try again.")
                    }
                },
                receiveValue: { [weak self] profile in
                    guard let self, self.generation == generation, self.catalogAttempt == attempt
                    else { return }
                    self.initialWorkspaceID = profile?.activeWorkspaceId
                    self.profileHasLoaded = true
                    self.profileError = nil
                    self.resolveInitialWorkspace()
                })
    }

    private func resolveInitialWorkspace() {
        guard profileHasLoaded, hasLoadedWorkspaces else { return }
        catalogDeadline?.cancel()
        catalogTimeoutError = nil
        guard current == nil, pending == nil, !isTransitioning,
            let workspace = workspaces.first(where: { $0.id == initialWorkspaceID })
                ?? workspaces.first
        else { return }
        requestWorkspace(workspace)
    }

    private func reconcileWorkspaceAccess(previousWorkspaces: [AppWorkspace]) {
        let accessibleIDs = Set(workspaces.map(\.id))
        var removedWorkspaceID: String?
        if let current, !accessibleIDs.contains(current.workspace.id) {
            removedWorkspaceID = current.workspace.id
            current.reset()
            self.current = nil
        }
        if let targetWorkspace, !accessibleIDs.contains(targetWorkspace.id) {
            pending?.reset()
            pending = nil
            clearTransition()
            current?.prepare()
        }
        if removedWorkspaceID != nil, targetWorkspace != nil {
            isReplacingRemovedWorkspace = true
        }
        guard current == nil, pending == nil else { return }
        if targetWorkspace != nil {
            // The outgoing Home view may have disappeared with revoked access,
            // so its animation completion can no longer start this transition.
            finishFade(id: transitionID)
            return
        }
        clearTransition()
        guard let removedWorkspaceID,
            let index = previousWorkspaces.firstIndex(where: { $0.id == removedWorkspaceID })
        else { return }
        let neighbors =
            Array(previousWorkspaces.dropFirst(index + 1))
            + previousWorkspaces.prefix(index).reversed()
        if let next = neighbors.first(where: { accessibleIDs.contains($0.id) }) ?? workspaces.first
        {
            isReplacingRemovedWorkspace = true
            requestWorkspace(next)
        }
    }

    private func rememberWorkspace(_ id: String) {
        selectionToSave = id
        selectionSaveError = nil
        guard selectionTask == nil else { return }
        let generation = generation
        // Persistence is serialized and does not hold a ready page behind a
        // network write. Rapid selections converge on the last visible workspace.
        selectionTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == generation { self.selectionTask = nil } }
            while let id = self.selectionToSave, self.generation == generation {
                self.selectionToSave = nil
                do {
                    try await self.saveSelection(id)
                    guard self.generation == generation else { return }
                    self.initialWorkspaceID = id
                } catch {
                    guard self.generation == generation else { return }
                    if self.selectionToSave == nil {
                        self.selectionSaveError =
                            L10n.string(
                                "You're in the new workspace, but we couldn't remember it for your next visit."
                            )
                    }
                }
            }
        }
    }
}
