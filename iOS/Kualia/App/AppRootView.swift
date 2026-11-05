import ClerkKit
import Combine
import ConvexMobile
import OSLog
import SwiftUI

struct AppRootView: View {
    let convexClient: ConvexClientWithAuth<String>
    let authProvider: KualiaClerkAuthProvider

    @Environment(Clerk.self) private var clerk
    @State private var session: AppSessionStore
    @State private var widgets: WidgetSessionBridge
    @State private var widgetNavigation = WidgetNavigationStore()
    @State private var opensWidgetsSettings = false
    @State private var settings: SettingsStore
    @State private var assistant: AssistantStore
    @State private var reviewPrompt = ReviewPromptStore()
    @State private var appUpdates: AppUpdatesStore
    @State private var onboarding: OnboardingStore?
    @State private var subscription: SubscriptionStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var signOutError: String?
    @State private var showsSettings = false
    @State private var showsWorkspaceSettings = false
    @State private var showsFamilyJoin = false
    @State private var settingsWorkspaceID: String?
    @State private var authenticatedSessionID: String?
    @State private var preparedSessionID: String?
    @State private var isAuthenticated = false
    @State private var authenticationError: String?
    @State private var authenticationAttempt = 0
    @State private var sessionRecovery = SessionRecovery()
    @State private var isSuspendedForDemo = false

    init(convexClient: ConvexClientWithAuth<String>, authProvider: KualiaClerkAuthProvider) {
        self.convexClient = convexClient
        self.authProvider = authProvider
        _session = State(initialValue: AppSessionStore(convexClient: convexClient))
        let widgetBridge = WidgetSessionBridge(client: convexClient)
        let settingsStore = SettingsStore(convexClient: convexClient)
        settingsStore.prepareWidgetSignOut = { await widgetBridge.prepareForSignOut() }
        settingsStore.restoreWidgetsAfterSignOutFailure = {
            widgetBridge.resumeAfterSignOutFailure()
        }
        _widgets = State(initialValue: widgetBridge)
        _settings = State(initialValue: settingsStore)
        _assistant = State(initialValue: AssistantStore(client: .live(convexClient)))
        _subscription = State(initialValue: SubscriptionStore(convexClient: convexClient))
        _appUpdates = State(
            initialValue: AppUpdatesStore(
                client: .live(convexClient),
                currentVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
                    ?? "0.0.0"))
    }

    private var activeSessionID: String? {
        clerk.session?.status == .active ? clerk.session?.id : nil
    }

    private var clerkSessionSnapshot: SessionSnapshot {
        .init(
            isLoaded: clerk.isLoaded, id: clerk.session?.id, status: clerk.session?.status.rawValue)
    }

    private var entryRoute: AppEntryRoute {
        .resolve(
            clerkIsLoaded: clerk.isLoaded, sessionID: activeSessionID,
            authenticatedSessionID: authenticatedSessionID, isAuthenticated: isAuthenticated,
            isSigningOut: settings.isSigningOut,
            sessionRequiresRecovery: sessionRecovery.requiresRecovery(for: clerkSessionSnapshot))
    }

    private var canLoadData: Bool { entryRoute == .ready && !isSuspendedForDemo }

    private var launchRoute: AppLaunchRoute {
        .resolve(
            entry: entryRoute, hasBlocker: appUpdates.blocker != nil,
            statusLoaded: appUpdates.hasLoadedStatus, admission: admission,
            workspaceReady: session.displayedSession != nil || session.hasNoWorkspaces)
    }

    private var admission: AppAdmission {
        .resolve(
            profileLoaded: onboarding?.hasLoaded == true,
            onboardingCompleted: onboarding?.isComplete == true,
            accessAllowed: subscription.accessState == .allowed,
            accessNeedsPurchase: subscription.accessState == .paywall,
            accessFailed: subscriptionFailure != nil)
    }

    private var subscriptionFailure: String? {
        if case .failed(let message) = subscription.accessState { return message }
        return nil
    }

    private var unblockedContent: some View {
        // Home owns its content fade after layout. Keep route replacement
        // immediate so a new navigation/geometry hierarchy starts in place.
        Group {
            switch launchRoute {
            case .blocked:
                if let blocker = appUpdates.blocker {
                    AppStatusBlockingView(
                        blocker: blocker, currentVersion: appUpdates.currentVersion)
                }
            case .signIn:
                LoginView()
                    .disabled(settings.isSigningOut)
                    #if DEBUG
                        .safeAreaInset(edge: .bottom) {
                            ScreenshotDemoToggle().padding(.horizontal, 24).padding(.bottom, 12)
                        }
                    #endif
            case .loading:
                AppLoadingView(message: loadingError, onRetry: retry)
            case .onboarding:
                if AdTrackingStore.shared.needsOnboardingStep {
                    TrackingPermissionView(tracking: AdTrackingStore.shared)
                } else if let onboarding {
                    OnboardingFlowView(store: onboarding, onSignOut: signOut)
                }
            case .paywall:
                SubscriptionPaywallView(
                    store: subscription, onSignOut: signOut,
                    onJoinFamily: { showsFamilyJoin = true })
            case .workspace:
                workspaceContent
            }
        }
        #if DEBUG
            .environment(\.enterScreenshotDemo, enterDemo)
        #endif
        .environment(\.openWorkspaceSettings, openWorkspaceSettings)
        .environment(\.openAppSettings, openSettings)
        .environment(\.switchSettingsWorkspace, switchSettingsWorkspace)
        .environment(\.settingsProfileImage, settings.profileImageData)
        .environment(\.settingsProfileImageRemoved, settings.hasRemovedProfileImage)
        .environment(\.settingsProfileName, settings.profile?.displayName)
        .environment(\.checkInSettings, settings)
        .navigationDestination(isPresented: $showsSettings) {
            SettingsView(
                store: settings, session: session,
                initialWidgetsDestination: opensWidgetsSettings
            )
            #if DEBUG
                .environment(\.enterScreenshotDemo, enterDemo)
            #endif
            .disabled(settings.isSigningOut)
            .background(KualiaPalette.canvas.ignoresSafeArea())
        }
        .sheet(isPresented: $showsWorkspaceSettings, onDismiss: settingsDidClose) {
            WorkspaceSettingsSheet(settings: settings, session: session)
                .disabled(settings.isSigningOut)
        }
        .sheet(isPresented: $showsFamilyJoin) {
            FamilyJoinSheet(store: settings.family)
        }
        .fullScreenCover(
            isPresented: Binding(
                get: { assistant.isPresented && canLoadData && admission == .home },
                set: { if !$0 { assistant.close() } })
        ) {
            AssistantView(store: assistant) { link in
                let workspaceID = try link.resolveWorkspaceID(
                    accessibleIDs: session.workspaces.filter { !$0.isArchived }.map(\.id),
                    chatWorkspaceID: assistant.selected.workspace?.workspaceId
                        ?? assistant.workspace?.workspaceId)
                if let current = session.current, current.workspace.id == workspaceID,
                    let editor = current.transactions.makeEditor(for: link.transactionID)
                {
                    return editor
                }
                return try await link.makeEditor(client: convexClient, workspaceID: workspaceID)
            }
        }
        .onChange(of: session.current?.workspace.id, initial: true) { previousID, workspaceID in
            if previousID != nil, previousID != workspaceID {
                showsSettings = false
                showsWorkspaceSettings = false
            }
            assistant.workspace = session.current.map {
                .init(workspaceId: $0.workspace.id, workspaceName: $0.workspace.name)
            }
        }
        .onChange(of: session.current?.accounts.workspace, initial: true) { _, _ in
            settings.prepareBankConnections(accounts: session.current?.accounts)
        }
        .alert(
            L10n.string("Couldn't log out"),
            isPresented: Binding(
                get: { signOutError != nil }, set: { if !$0 { signOutError = nil } }
            )
        ) {
            Button("OK") { signOutError = nil }
        } message: {
            Text(signOutError ?? L10n.string("Please try again."))
        }
    }

    var body: some View {
        NavigationStack {
            unblockedContent
                .toolbar(.hidden, for: .navigationBar)
        }
        // Keep public subscriptions alive when a full-screen presentation covers Home.
        .task { appUpdates.start() }
        .onChange(of: settings.notifications.handler.pendingTransactionRequest, initial: true) {
            _, request in
            guard let request else { return }
            settings.notifications.handler.pendingTransactionRequest = nil
            guard !settings.isSigningOut else { return }
            assistant.close()
            showsSettings = false
            showsWorkspaceSettings = false
            widgetNavigation.openTransactionNotification(workspaceID: request.workspaceID)
        }
        .onChange(of: appUpdates.blocker) { _, blocker in
            guard blocker != nil else { return }
            showsSettings = false
            showsWorkspaceSettings = false
            showsFamilyJoin = false
            assistant.close()
        }
        .onOpenURL { url in
            guard WidgetRoute(url: url) != nil else { return }
            assistant.close()
            widgetNavigation.open(url)
        }
        .onChange(of: settings.isSigningOut) { _, isSigningOut in
            if isSigningOut {
                withTransaction(Transaction(animation: nil)) {
                    showsSettings = false
                    showsWorkspaceSettings = false
                    showsFamilyJoin = false
                    assistant.close()
                }
            } else if let error = settings.actionError {
                signOutError = error
                settings.actionError = nil
            }
        }
        .onChange(of: showsSettings) { _, isPresented in
            if !isPresented { settingsDidClose() }
        }
        .onChange(of: widgetContext, initial: true) { _, context in
            guard !settings.isSigningOut else { return }
            // Preserve the previous widget credential while Clerk restores offline.
            // Clear once sign-out is known, or a confirmed app session loses access.
            if context != nil || (clerk.isLoaded && activeSessionID == nil) || canLoadData {
                widgets.update(context)
            }
        }
        .task(id: admission) {
            if admission == .home { widgetNavigation.consumeControlAction() }
        }
        .onReceive(NotificationCenter.default.publisher(for: PendingAppActionStore.actionEnqueued))
        {
            _ in
            if admission == .home { widgetNavigation.consumeControlAction() }
        }
        .onChange(of: AppLanguageStore.shared.locale) { _, _ in
            settings.notifications.refresh()
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            settings.isApplicationActive = phase == .active
            widgets.setApplicationActive(phase == .active)
            if phase == .active { settings.recordCheckIn() }
            session.setApplicationActive(phase != .background)
            if phase == .active, canLoadData {
                widgets.refresh()
                widgetNavigation.consumeControlAction()
                assistant.reconnect()
                settings.notifications.refresh()
                Task { await subscription.refresh() }
            }
        }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { date in
            session.refreshDates(now: date)
            settings.recordCheckIn(now: date)
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
            session.refreshDates()
        }
        .onChange(of: admission) { _, route in
            if route == .home { startSessionIfReady() }
            if route != .home {
                settingsWorkspaceID = nil
                showsSettings = false
                showsWorkspaceSettings = false
                assistant.close()
            }
        }
        .onReceive(convexClient.authState) { state in
            switch state {
            case .authenticated:
                isAuthenticated = true
                authenticatedSessionID = authProvider.authenticatedSessionID
                authenticationError = nil
                startSessionIfReady()
            case .loading:
                // A token refresh must not discard prepared pages or scroll state.
                break
            case .unauthenticated:
                isAuthenticated = false
                authenticatedSessionID = nil
                appUpdates.authenticate(sessionID: nil)
            }
        }
        .environment(\.categoryPickerBudget, session.displayedSession?.budget)
        .onChange(of: clerk.isLoaded) { _, _ in startSessionIfReady() }
        .task(id: clerkSessionSnapshot) {
            await recoverClerkSession()
        }
        .onChange(of: activeSessionID) { _, id in
            if id != preparedSessionID { resetPreparedSession() }
            if id == nil {
                isAuthenticated = false
                authenticatedSessionID = nil
            }
            startSessionIfReady()
        }
        // A replacement Home session can be ready in the same update that removes
        // the old one. Observe its transition identity as well as data readiness.
        .onChange(of: session.preparationState, initial: true) { _, _ in
            // Ready pages and replacement workspaces both install their final
            // toolbar insets immediately. Home owns the opacity-only reveal.
            withTransaction(Transaction(animation: nil)) { session.revealIfReady() }
        }
        .task(id: "\(entryRoute)-\(activeSessionID ?? "signed-out")-\(authenticationAttempt)") {
            guard entryRoute == .loading else {
                authenticationError = nil
                return
            }
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard !Task.isCancelled else { return }
            authenticationError = L10n.string(
                "Couldn't finish connecting. Check your connection and try again.")
        }
    }

    @ViewBuilder private var workspaceContent: some View {
        if let current = session.displayedSession {
            HomeView(
                transactionFeedStore: current.transactions, budgetStore: current.budget,
                accountsStore: current.accounts, reportsStore: current.reports,
                appSession: session, assistantStore: assistant,
                reviewPrompt: reviewPrompt,
                appUpdates: appUpdates,
                allowsReviewPrompt: !showsSettings && !showsWorkspaceSettings
                    && signOutError == nil,
                widgetNavigation: widgetNavigation,
                openWidgetsSettings: {
                    opensWidgetsSettings = true
                    openSettings()
                },
                reloadWidgets: { widgets.reload() },
                isSettingsPresented: showsSettings || showsWorkspaceSettings
            )
            .environment(\.transactionScheduleStore, current.transactions.agenda)
        } else if session.hasNoWorkspaces {
            ContentUnavailableView {
                Label {
                    Text(L10n.string("No workspaces yet"))
                } icon: {
                    KualiaIconImage(icon: .workspace, size: 44)
                }
            } description: {
                Text(L10n.string("Create a workspace in Settings to get started."))
            } actions: {
                Button(L10n.string("Open settings"), action: openSettings)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KualiaPalette.canvas.ignoresSafeArea())
        }
    }

    private var widgetContext: WidgetSessionContext? {
        guard canLoadData, admission == .home, let sessionID = activeSessionID,
            let current = session.current
        else { return nil }
        let budget = current.budget
        return WidgetSessionContext(
            sessionID: sessionID, workspaceID: current.workspace.id,
            workspaceName: session.visibleWorkspaceName ?? current.workspace.name,
            currencyCode: budget.workspace?.currencyCode ?? "USD",
            timezoneIdentifier: budget.workspace?.timezoneIdentifier,
            categories: budget.planGroups.flatMap { group in
                group.categories.map {
                    WidgetSharedStorage.WidgetCategory(
                        id: $0.id, name: $0.name, groupName: group.categoryGroup.name)
                }
            },
            accounts: current.accounts.activeAccounts.map {
                WidgetSharedStorage.WidgetAccount(
                    id: $0.id, name: $0.name, category: $0.category.rawValue)
            },
            budgetSnapshotRevision: budget.snapshotRevision,
            accountBalances: Dictionary(
                current.accounts.activeAccounts.map { ($0.id, $0.currentBalance) },
                uniquingKeysWith: { _, balance in balance }),
            plannedData: current.transactions.agenda?.data)
    }

    private func signOut() async {
        await widgets.prepareForSignOut()
        do { try await clerk.auth.signOut() } catch {
            widgets.resumeAfterSignOutFailure()
            signOutError = L10n.string("Please check your connection and try again.")
        }
    }

    private var loadingError: String? {
        if !canLoadData { return authenticationError }
        if admission != .home { return onboarding?.errorMessage ?? subscriptionFailure }
        if case .failed(let message) = session.preparation { return message }
        return nil
    }

    private func switchSettingsWorkspace(_ workspaceID: String) {
        settingsWorkspaceID = workspaceID
        showsSettings = false
        showsWorkspaceSettings = false
    }

    private func openWorkspaceSettings() {
        guard session.current != nil else { return }
        settingsWorkspaceID = nil
        session.setWorkspaceSwitchPeekCovered(true)
        showsWorkspaceSettings = true
    }

    private func openSettings() {
        presentSettings()
    }

    private func presentSettings() {
        settingsWorkspaceID = nil
        session.setWorkspaceSwitchPeekCovered(true)
        showsSettings = true
    }

    private func settingsDidClose() {
        guard !showsSettings, !showsWorkspaceSettings else { return }
        opensWidgetsSettings = false
        // Uncover Home before beginning a workspace switch selected from Settings.
        session.setWorkspaceSwitchPeekCovered(false)
        guard let workspaceID = settingsWorkspaceID else { return }
        settingsWorkspaceID = nil
        guard canLoadData, admission == .home else { return }
        session.requestWorkspaceWhenAvailable(id: workspaceID)
    }

    #if DEBUG
        private func enterDemo() {
            isSuspendedForDemo = true
            session.reset()
            settings.reset()
            assistant.reset()
            onboarding?.stop()
            subscription.reset()
            appUpdates.stop()
            widgets.suspendForPreview()
            UserDefaults.standard.set(true, forKey: ScreenshotDemoMode.defaultsKey)
        }
    #endif

    private func startSessionIfReady() {
        guard !isSuspendedForDemo else { return }
        guard canLoadData, let userID = clerk.user?.id else { return }
        if preparedSessionID != activeSessionID {
            resetPreparedSession()
            preparedSessionID = activeSessionID
        }
        if onboarding == nil {
            let store = OnboardingStore(convexClient: convexClient, userID: userID)
            onboarding = store
            store.start()
        }
        if let activeSessionID {
            appUpdates.authenticate(sessionID: activeSessionID)
            subscription.start(userID: userID, sessionID: activeSessionID)
            settings.family.start(sessionID: activeSessionID)
        }
        guard admission == .home else { return }
        reviewPrompt.configure(userID: userID)
        assistant.authenticate(userID: userID)
        session.start(userID: userID, sessionID: activeSessionID)
        if let activeSessionID { settings.start(sessionID: activeSessionID) }
    }

    private func resetPreparedSession() {
        settingsWorkspaceID = nil
        appUpdates.authenticate(sessionID: nil)
        reviewPrompt.reset()
        showsFamilyJoin = false
        settingsWorkspaceID = nil
        assistant.reset()
        showsSettings = false
        showsWorkspaceSettings = false
        widgets.update(nil)
        if preparedSessionID != nil { widgetNavigation.pending = nil }
        settings.reset()
        session.reset()
        onboarding?.stop()
        onboarding = nil
        subscription.reset()
        preparedSessionID = nil
    }

    private func retry() {
        if canLoadData {
            if admission == .home {
                session.retry()
            } else {
                onboarding?.retry()
                subscription.retry()
            }
        } else {
            authenticationError = nil
            authenticationAttempt += 1
            Task {
                await recoverClerkSession()
                guard !Task.isCancelled, clerkSessionSnapshot.isActive else { return }
                await authProvider.reconnect()
            }
        }
    }

    private func recoverClerkSession() async {
        let snapshot = clerkSessionSnapshot
        let needsRecovery = sessionRecovery.requiresRecovery(for: snapshot)
        let succeeded = await sessionRecovery.reconcile(snapshot: snapshot) {
            async let refreshedClient = clerk.refreshClient()
            async let refreshedEnvironment = clerk.refreshEnvironment()
            _ = try await (refreshedClient, refreshedEnvironment)
            return clerkSessionSnapshot
        }
        guard !Task.isCancelled, needsRecovery else { return }
        Logger(subsystem: "com.kualia.app", category: "AuthRecovery").notice(
            "Clerk recovery completed; refresh succeeded: \(succeeded, privacy: .public); still recovering: \(sessionRecovery.requiresRecovery(for: clerkSessionSnapshot), privacy: .public)"
        )
        if !succeeded {
            authenticationError = L10n.string(
                "Couldn't finish connecting. Check your connection and try again.")
        }
    }
}
