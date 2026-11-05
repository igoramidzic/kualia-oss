import ClerkKit
import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class SettingsStore {
    @ObservationIgnored var prepareWidgetSignOut: () async -> Void = {}
    @ObservationIgnored var restoreWidgetsAfterSignOutFailure: () -> Void = {}

    private var serverProfile: SettingsProfile?
    private var serverWorkspaces: [String: SettingsWorkspace] = [:]
    private(set) var workspaceCatalog: [SettingsWorkspaceSummary] = []
    private(set) var hasLoadedWorkspaces = false
    private(set) var workspaceError: String?
    private(set) var writes = SettingsOptimisticWrites()
    private(set) var profileImageData: Data?
    private(set) var hasRemovedProfileImage = false
    private(set) var isUpdatingImage = false
    private(set) var subscription: SettingsSubscription?
    var membershipSubscription: SettingsSubscription? {
        membershipLoad.hasSubscriptionSnapshot ? subscription : appAccess?.ownSubscription
    }
    private(set) var appAccess: SettingsAppAccess?
    private(set) var hasLoadedProfile = false
    private(set) var membershipLoad = SettingsMembershipLoadState()
    var hasLoadedPlan: Bool { membershipLoad.hasSnapshot }
    private(set) var profileError: String?
    var planError: String? { membershipLoad.error }
    private(set) var isSigningOut = false
    private(set) var isSaving = false
    private(set) var isAccountDeleted = false
    var actionError: String?
    var browser: SettingsBrowserDestination?
    private(set) var bankConnections: AccountConnectionStore?

    func prepareBankConnections(accounts: AccountsStore?) {
        guard bankConnections?.workspace != accounts?.workspace else { return }
        stopBankConnections()
        bankConnections = accounts?.makeConnectionStore(purpose: .manageConnections)
        bankConnections?.start()
    }

    func stopBankConnections() {
        bankConnections?.stop()
        bankConnections = nil
    }

    let family: FamilyStore
    let notifications = SettingsNotifications.shared
    @ObservationIgnored private let client: ConvexClientWithAuth<String>?
    var isDemo: Bool { client == nil }
    #if DEBUG
        @ObservationIgnored private var demo: ScreenshotDemoData?
    #endif
    @ObservationIgnored private var subscriptions: Set<AnyCancellable> = []
    @ObservationIgnored private var sessionID: String?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var planSubscriptions: Set<AnyCancellable> = []
    @ObservationIgnored private var planGeneration = UUID()
    @ObservationIgnored private var planDeadline: Task<Void, Never>?
    @ObservationIgnored private var loadingDeadline: Task<Void, Never>?
    @ObservationIgnored private var writeTask: Task<Void, Never>?
    @ObservationIgnored private var checkInTask: Task<Void, Never>?
    @ObservationIgnored private var recordedCheckIn: HomeCheckIn?
    var isApplicationActive = false
    private(set) var checkInError: String?

    init(convexClient: ConvexClientWithAuth<String>) {
        client = convexClient
        family = FamilyStore(client: .live(convexClient))
    }

    #if DEBUG
        init(demo: ScreenshotDemoData) {
            client = nil
            self.demo = demo
            family = demo.makeFamily()
            serverProfile = .init(
                name: "Alex Morgan", email: "alex@example.com", clerkId: "screenshot-demo",
                notificationsEnabled: true, notificationPreferences: .init(),
                checkIn: .init(
                    days: 42, lastDate: demo.today, timezone: "America/New_York",
                    startedAt: ReportDates.key(ReportDates.add(.day, -70, to: demo.now))))
            hasLoadedProfile = true
            serverWorkspaces[demo.workspace.id] = .init(
                _id: demo.workspace.id, name: demo.workspace.name,
                currency: demo.workspace.currencyCode ?? "USD", timezone: "America/New_York",
                canManage: true, owner: nil,
                transactionDefaultPendingStatus: false, transactionDefaultAccountId: "chase")
            workspaceCatalog = [
                .init(
                    _id: demo.workspace.id, name: demo.workspace.name, isArchived: false,
                    canManage: true, accessKind: "owned", owner: nil)
            ]
            hasLoadedWorkspaces = true
            subscription = .init(
                subscriptionType: "yearly", status: "active", isActive: true,
                expiresAt: ReportDates.key(ReportDates.add(.year, 1, to: demo.now)) + "T12:00:00Z",
                periodType: "normal", store: "app_store")
            appAccess = .init(
                hasAppAccess: true, accessSource: "own_subscription", familyAccess: nil)
            membershipLoad.receivedSubscription()
            membershipLoad.receivedAccess()
        }
    #endif

    func makeRulesStore(workspaceID: String, currency: String, minorUnit: Int? = nil) -> RulesStore
    {
        #if DEBUG
            if let demo { return demo.makeRules() }
        #endif
        guard let client else { preconditionFailure("A live settings store requires a client") }
        return RulesStore(
            workspaceID: workspaceID, currency: currency, minorUnit: minorUnit, convexClient: client
        )
    }

    func makeMerchantsStore(
        workspaceID: String, currency: String, isWorkspaceCurrent: @escaping () -> Bool
    ) -> MerchantsStore {
        #if DEBUG
            if let demo { return demo.makeMerchants() }
        #endif
        guard let client else { preconditionFailure("A live settings store requires a client") }
        let sessionID = sessionID
        return MerchantsStore(
            workspaceID: workspaceID, currency: currency, convexClient: client,
            isAvailable: { [weak self] in
                sessionID != nil && self?.sessionID == sessionID && isWorkspaceCurrent()
            })
    }

    var profile: SettingsProfile? {
        guard var value = serverProfile else { return nil }
        value.name = writes[.name]?.text ?? value.name
        value.notificationsEnabled =
            writes[.notificationsEnabled]?.flag ?? value.notificationsEnabled
        var preferences = value.notificationPreferences ?? .init()
        preferences.newTransactionsEnabled =
            writes[.newTransactionsEnabled]?.flag ?? preferences.newTransactionsEnabled
        preferences.remindersEnabled =
            writes[.remindersEnabled]?.flag ?? preferences.remindersEnabled
        preferences.reminderFrequency =
            writes[.reminderFrequency]?.text ?? preferences.reminderFrequency
        value.notificationPreferences = preferences
        return value
    }

    func workspace(id: String) -> SettingsWorkspace? {
        guard var value = serverWorkspaces[id] else { return nil }
        if case .workspace(let settings) = writes[.workspaceSettings(id)] {
            value.name = settings.name
            value.currency = settings.currency
            value.transactionDefaultPendingStatus = settings.pending
            value.transactionDefaultAccountId = settings.defaultAccountID
        }
        value.timezone = writes[.workspaceTimezone(id)]?.text ?? value.timezone
        return value
    }

    var preferences: SettingsNotificationPreferences {
        profile?.notificationPreferences ?? .init()
    }
    func start(sessionID: String) {
        guard !isDemo else { return }
        guard self.sessionID != sessionID else { return }
        // A family invitation can activate membership before Settings starts.
        // Keep that same-session operation alive as the home screen becomes ready.
        reset(resetFamily: false)
        self.sessionID = sessionID
        family.start(sessionID: sessionID)
        notifications.onDeviceToken = { [weak self] token in
            guard let self, self.sessionID == sessionID else { return }
            Task { await self.saveDeviceToken(token, sessionID: sessionID) }
        }
        reload()
    }

    func reload() {
        guard let client else { return }
        guard sessionID != nil else { return }
        subscriptions.removeAll()
        generation = UUID()
        let generation = generation
        profileError = nil
        reloadMembership()
        hasLoadedWorkspaces = false
        workspaceError = nil
        loadingDeadline?.cancel()
        loadingDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.generation == generation else { return }
            if !self.hasLoadedProfile {
                self.profileError = L10n.string("Your account is taking longer to load. Try again.")
            }
            if !self.hasLoadedWorkspaces {
                self.workspaceError = L10n.string(
                    "Workspaces are taking longer to load. Try again.")
            }
        }
        client.subscribe(to: "userProfiles:getCurrentProfile", yielding: SettingsProfile?.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                guard let self, self.generation == generation else { return }
                if case .failure = completion {
                    self.profileError = L10n.string("Couldn't load your account. Try again.")
                }
            } receiveValue: { [weak self] profile in
                guard let self, self.generation == generation else { return }
                self.serverProfile = profile
                self.observeProfile(profile)
                self.hasLoadedProfile = true
                self.profileError =
                    profile == nil
                    ? L10n.string("Your account details aren't available yet. Try again.") : nil
                self.notifications.apply(profile: self.profile)
                self.recordCheckIn()
            }.store(in: &subscriptions)
        client.subscribe(
            to: "workspaces:getUserWorkspaces", yielding: [SettingsWorkspaceSummary].self
        )
        .receive(on: DispatchQueue.main)
        .sink { [weak self] completion in
            guard let self, self.generation == generation else { return }
            if case .failure = completion {
                self.workspaceError = L10n.string("Couldn't load workspaces. Try again.")
            }
        } receiveValue: { [weak self] values in
            guard let self, self.generation == generation else { return }
            self.workspaceCatalog = values
            self.hasLoadedWorkspaces = true
            self.workspaceError = nil
        }.store(in: &subscriptions)
    }

    func reloadMembership() {
        guard let client else { return }
        guard sessionID != nil else { return }
        planSubscriptions.removeAll()
        planGeneration = UUID()
        let generation = planGeneration
        membershipLoad.beginRefresh()
        planDeadline?.cancel()
        planDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.planGeneration == generation else { return }
            self.membershipLoad.timedOut()
        }
        // This is a reactive Convex table query, not a call to the RevenueCat SDK/API.
        client.subscribe(to: SettingsSubscription.query, yielding: SettingsSubscription?.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                guard let self, self.planGeneration == generation else { return }
                if case .failure = completion {
                    self.membershipLoad.subscriptionError =
                        L10n.string("Couldn't refresh membership details. Try again.")
                }
            } receiveValue: { [weak self] subscription in
                guard let self, self.planGeneration == generation else { return }
                self.subscription = subscription
                self.membershipLoad.receivedSubscription()
            }.store(in: &planSubscriptions)
        client.subscribe(to: "appAccess:getCurrentAppAccess", yielding: SettingsAppAccess.self)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                guard let self, self.planGeneration == generation else { return }
                if case .failure = completion {
                    self.membershipLoad.accessError = L10n.string(
                        "Couldn't refresh family access. Try again.")
                }
            } receiveValue: { [weak self] access in
                guard let self, self.planGeneration == generation else { return }
                self.appAccess = access
                self.membershipLoad.receivedAccess()
            }.store(in: &planSubscriptions)
    }

    func reset(resetFamily: Bool = true) {
        guard !isDemo else { return }
        stopBankConnections()
        if resetFamily { family.reset() }
        planGeneration = UUID()
        planSubscriptions.removeAll()
        planDeadline?.cancel()
        generation = UUID()
        sessionID = nil
        loadingDeadline?.cancel()
        subscriptions.removeAll()
        serverProfile = nil
        serverWorkspaces = [:]
        workspaceCatalog = []
        hasLoadedWorkspaces = false
        workspaceError = nil
        writeTask?.cancel()
        writeTask = nil
        checkInTask?.cancel()
        checkInTask = nil
        recordedCheckIn = nil
        checkInError = nil
        writes = SettingsOptimisticWrites()
        profileImageData = nil
        hasRemovedProfileImage = false
        isUpdatingImage = false
        subscription = nil
        appAccess = nil
        hasLoadedProfile = false
        membershipLoad = SettingsMembershipLoadState()
        profileError = nil
        isSaving = false
        isAccountDeleted = false
        actionError = nil
        browser = nil
        notifications.reset()
    }

    func saveName(_ name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, profile != nil else { return }
        enqueue(.text(name), for: .name)
    }

    func recordCheckIn(now: Date = .now) {
        guard let client else { return }
        guard isApplicationActive, let sessionID, profile != nil, checkInTask == nil else { return }
        if recordedCheckIn?.includes(now) == true || profile?.checkIn?.includes(now) == true {
            checkInError = nil
            return
        }
        checkInTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if !Task.isCancelled, self.sessionID == sessionID { self.checkInTask = nil }
            }
            guard !Task.isCancelled, self.sessionID == sessionID, isApplicationActive else {
                return
            }
            do {
                let result: HomeCheckIn = try await client.mutation(
                    "userProfiles:recordCheckIn", with: ["timezone": TimeZone.current.identifier])
                guard self.sessionID == sessionID, !Task.isCancelled else { return }
                recordedCheckIn = result
                checkInError = nil
                // The reactive profile also carries visits recorded on the web.
                if let current = serverProfile, (current.checkIn?.days ?? 0) <= result.days {
                    serverProfile?.checkIn = result
                }
            } catch {
                guard self.sessionID == sessionID, !Task.isCancelled else { return }
                checkInError = L10n.string("Your day count will update when you're connected.")
            }
        }
    }

    func setNotificationsEnabled(_ enabled: Bool) {
        guard !isDemo else { return }
        guard profile != nil else { return }
        enqueue(.flag(enabled), for: .notificationsEnabled)
    }

    func setPreference(_ key: String, value: Bool) {
        guard profile != nil else { return }
        switch key {
        case "newTransactionsEnabled": enqueue(.flag(value), for: .newTransactionsEnabled)
        case "remindersEnabled": enqueue(.flag(value), for: .remindersEnabled)
        default: break
        }
    }

    func setFrequency(_ frequency: SettingsReminderFrequency) {
        guard profile != nil else { return }
        enqueue(.text(frequency.rawValue), for: .reminderFrequency)
    }

    func workspacePublisher(id: String) -> AnyPublisher<SettingsWorkspace, Error> {
        if let workspace = serverWorkspaces[id], isDemo {
            return Just(workspace).setFailureType(to: Error.self).eraseToAnyPublisher()
        }
        guard let client else {
            return Fail(error: SettingsOperationError.unavailable).eraseToAnyPublisher()
        }
        let sessionID = sessionID
        return client.subscribe(
            to: "workspaces:getWorkspace", with: ["workspaceId": id],
            yielding: SettingsWorkspace.self
        )
        .mapError { $0 as Error }.receive(on: DispatchQueue.main)
        .handleEvents(receiveOutput: { [weak self] value in
            guard let self, self.sessionID == sessionID else { return }
            self.serverWorkspaces[id] = value
            self.observeWorkspace(value)
        }).eraseToAnyPublisher()
    }

    func accountsPublisher(id: String) -> AnyPublisher<[SettingsDefaultAccount], Error> {
        #if DEBUG
            if let demo {
                return ScreenshotDemoData.publisher(
                    demo.accounts.map {
                        .init(
                            _id: $0.id, name: $0.name, accountType: $0.accountType, isClosed: false,
                            resolvedLogoUrl: $0.resolvedLogoUrl)
                    })
            }
        #endif
        guard let client else {
            return Fail(error: SettingsOperationError.unavailable).eraseToAnyPublisher()
        }
        return client.subscribe(
            to: "bankAccounts:listBankAccounts", with: ["workspaceId": id],
            yielding: [SettingsDefaultAccount].self
        )
        .map { $0.filter(\.isEligible) }.mapError { $0 as Error }.eraseToAnyPublisher()
    }

    func saveWorkspaceName(id: String, name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, workspace(id: id)?.canManage == true else { return }
        updateWorkspace(id: id) { $0.name = name }
    }

    func saveWorkspaceCurrency(id: String, currency: String) {
        guard Locale.commonISOCurrencyCodes.contains(currency), workspace(id: id)?.canManage == true
        else { return }
        updateWorkspace(id: id) { $0.currency = currency }
    }

    func saveWorkspaceTimezone(id: String, timezone: String) {
        guard TimeZone(identifier: timezone) != nil, workspace(id: id)?.canManage == true else {
            return
        }
        enqueue(.text(timezone), for: .workspaceTimezone(id))
    }

    func saveTransactionDefault(id: String, pending: Bool) {
        guard workspace(id: id)?.canManage == true else { return }
        updateWorkspace(id: id) { $0.pending = pending }
    }

    func saveDefaultAccount(id: String, accountID: String?) {
        guard workspace(id: id)?.canManage == true else { return }
        updateWorkspace(id: id) { $0.defaultAccountID = accountID }
    }

    private func updateWorkspace(id: String, change: (inout SettingsWorkspaceValues) -> Void) {
        guard let workspace = workspace(id: id), workspace.canManage else { return }
        var settings = SettingsWorkspaceValues(workspace)
        change(&settings)
        enqueue(.workspace(settings), for: .workspaceSettings(id))
    }

    func createWorkspace(_ draft: SettingsWorkspaceDraft) async -> SettingsCreatedWorkspace? {
        guard let client else { return nil }
        guard draft.isValid, !isSaving, let sessionID else { return nil }
        isSaving = true
        actionError = nil
        defer { if self.sessionID == sessionID { isSaving = false } }
        var createdID: String?
        do {
            var arguments: [String: ConvexEncodable?] = [
                "name": draft.trimmedName, "currency": draft.currency,
                "categoryOption": draft.sourceWorkspaceID == nil ? "default" : "copy",
            ]
            if let source = draft.sourceWorkspaceID { arguments["sourceWorkspaceId"] = source }
            let id: String = try await client.mutation(
                "workspaces:createWorkspaceWithOptions", with: arguments)
            guard self.sessionID == sessionID else { return nil }
            createdID = id
            let result: SettingsResult = try await client.mutation(
                "workspaces:updateWorkspaceTimezone",
                with: ["workspaceId": id, "timezone": draft.timezone])
            guard result.success else { throw SettingsOperationError.unavailable }
            return self.sessionID == sessionID ? SettingsCreatedWorkspace(id: id) : nil
        } catch {
            guard self.sessionID == sessionID else { return nil }
            if let createdID {
                return SettingsCreatedWorkspace(
                    id: createdID,
                    warning:
                        L10n.string(
                            "Your workspace was created. Its time zone couldn't be saved; set it in workspace settings."
                        )
                )
            }
            actionError = L10n.string("Couldn't create the workspace. Please try again.")
            return nil
        }
    }

    func archiveWorkspace(id: String, archived: Bool) async -> Bool {
        guard workspaceCatalog.first(where: { $0.id == id })?.canManage == true else {
            return false
        }
        return await mutate(
            "workspaces:archiveWorkspaces",
            arguments: ["workspaceIds": [id], "isArchived": archived])
    }

    func deleteWorkspace(id: String) async -> Bool {
        guard workspaceCatalog.first(where: { $0.id == id })?.canManage == true else {
            return false
        }
        let success = await mutate("workspaces:deleteWorkspace", arguments: ["workspaceId": id])
        if success {
            writes.removeWorkspace(id)
            serverWorkspaces[id] = nil
        }
        return success
    }

    func removeProfileImage() async {
        guard !isDemo else { return }
        guard !isUpdatingImage, let sessionID, let user = Clerk.shared.user else { return }
        isUpdatingImage = true
        defer { if self.sessionID == sessionID { isUpdatingImage = false } }
        do {
            _ = try await user.deleteProfileImage()
            guard self.sessionID == sessionID else { return }
            profileImageData = nil
            hasRemovedProfileImage = true
            _ = try? await user.reload()
        } catch {
            guard self.sessionID == sessionID else { return }
            actionError = L10n.string("Couldn't remove your photo. Please try again.")
        }
    }

    func updateProfileImage(_ data: Data) async {
        guard !isDemo else { return }
        guard !isUpdatingImage, let sessionID, let user = Clerk.shared.user else { return }
        isUpdatingImage = true
        let previous = profileImageData
        profileImageData = data
        defer { if self.sessionID == sessionID { isUpdatingImage = false } }
        do {
            _ = try await user.setProfileImage(imageData: data)
            guard self.sessionID == sessionID else { return }
            hasRemovedProfileImage = false
            // Keep the uploaded image visible while Clerk refreshes its remote URL.
            _ = try? await user.reload()
        } catch {
            guard self.sessionID == sessionID else { return }
            profileImageData = previous
            actionError = L10n.string("Couldn't update your photo. Please try again.")
        }
    }

    private func enqueue(_ value: SettingsWriteValue, for key: SettingsWriteKey) {
        guard !isDemo else { return }
        guard !isSaving, sessionID != nil else { return }
        writes.set(value, for: key)
        actionError = nil
        if key.workspaceID == nil { notifications.apply(profile: profile) }
        drainWrites()
    }

    private func drainWrites() {
        guard writeTask == nil, let sessionID else { return }
        writeTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.sessionID == sessionID { self.writeTask = nil } }
            while self.sessionID == sessionID, !Task.isCancelled, let change = self.writes.next() {
                do {
                    try await self.send(change)
                    guard self.sessionID == sessionID else { return }
                    self.writes.acknowledge(change)
                } catch {
                    guard self.sessionID == sessionID else { return }
                    if self.writes.fail(change) {
                        self.actionError =
                            error is SettingsPermissionError
                            ? L10n.string(
                                "Notifications are blocked on this device. You can enable them in iOS Settings."
                            )
                            : L10n.string(
                                "Couldn't save your change. The previous setting has been restored. Please try again."
                            )
                    }
                }
                self.notifications.apply(profile: self.profile)
            }
        }
    }

    private func send(_ change: SettingsOptimisticWrites.Change) async throws {
        guard let client else { throw SettingsOperationError.unavailable }
        let sessionID = sessionID
        var function: String
        var arguments: [String: ConvexEncodable?]
        switch change.key {
        case .name:
            function = "userProfiles:updateProfile"
            arguments = ["name": change.value.text]
        case .notificationsEnabled:
            if change.value.flag == true {
                guard await notifications.requestPermission() else {
                    throw SettingsPermissionError.denied
                }
            }
            function = "userProfiles:updateNotificationPreference"
            arguments = ["notificationsEnabled": change.value.flag]
        case .newTransactionsEnabled:
            function = "userProfiles:updateNotificationPreferences"
            arguments = ["newTransactionsEnabled": change.value.flag]
        case .remindersEnabled:
            function = "userProfiles:updateNotificationPreferences"
            arguments = ["remindersEnabled": change.value.flag]
        case .reminderFrequency:
            function = "userProfiles:updateNotificationPreferences"
            arguments = ["reminderFrequency": change.value.text]
        case .workspaceTimezone(let id):
            function = "workspaces:updateWorkspaceTimezone"
            arguments = ["workspaceId": id, "timezone": change.value.text]
        case .workspaceSettings(let id):
            guard case .workspace(let settings) = change.value,
                workspace(id: id)?.canManage == true
            else { throw SettingsOperationError.unavailable }
            function = "workspaces/update:updateWorkspaceSettings"
            arguments = [
                "workspaceId": id, "name": settings.name, "currency": settings.currency,
                "transactionDefaultPendingStatus": settings.pending,
            ]
            if let account = settings.defaultAccountID {
                arguments["transactionDefaultAccountId"] = account
            }

        }
        guard self.sessionID == sessionID, !Task.isCancelled else { throw CancellationError() }
        let result: SettingsResult = try await client.mutation(function, with: arguments)
        guard result.success else { throw SettingsOperationError.unavailable }
    }

    private func observeProfile(_ profile: SettingsProfile?) {
        guard let profile else { return }
        let preferences = profile.notificationPreferences ?? .init()
        writes.observe(.text(profile.name ?? ""), for: .name)
        writes.observe(.flag(profile.notificationsEnabled), for: .notificationsEnabled)
        writes.observe(.flag(preferences.newTransactionsEnabled), for: .newTransactionsEnabled)
        writes.observe(.flag(preferences.remindersEnabled), for: .remindersEnabled)
        writes.observe(.text(preferences.frequency.rawValue), for: .reminderFrequency)
    }

    private func observeWorkspace(_ value: SettingsWorkspace) {
        writes.observe(
            .workspace(SettingsWorkspaceValues(value)), for: .workspaceSettings(value._id))
        writes.observe(.text(value.timezone ?? ""), for: .workspaceTimezone(value._id))
    }

    func signOut() async {
        guard let client else { return }
        guard !isSaving, let sessionID else { return }
        isSigningOut = true
        isSaving = true
        defer { isSigningOut = false }
        actionError = nil
        // Finish queued preferences before ending the session so a late save cannot
        // re-register notifications after the local logout cleanup.
        await writeTask?.value
        guard self.sessionID == sessionID else { return }
        actionError = nil
        do {
            // Unregister locally even if the best-effort server cleanup cannot connect.
            notifications.reset()
            let _: SettingsResult? = try? await client.mutation(
                "userProfiles:updateApnsDeviceToken", with: ["apnsDeviceToken": ""])
            guard self.sessionID == sessionID else { return }
            await prepareWidgetSignOut()
            try await Clerk.shared.auth.signOut()
        } catch {
            guard self.sessionID == sessionID else { return }
            restoreWidgetsAfterSignOutFailure()
            actionError = L10n.string("Couldn't log out. Check your connection and try again.")
            notifications.onDeviceToken = { [weak self] token in
                Task { await self?.saveDeviceToken(token, sessionID: sessionID) }
            }
            notifications.apply(profile: profile)
        }
        if self.sessionID == sessionID { isSaving = false }
    }

    func deleteAccount(confirmation: String) async {
        guard let client else { return }
        guard confirmation == "DELETE", !isSaving, !isAccountDeleted, let sessionID else { return }
        isSaving = true
        actionError = nil
        // Finish queued preferences before ending the session so a late save cannot
        // re-register notifications after the local logout cleanup.
        await writeTask?.value
        guard self.sessionID == sessionID else { return }
        actionError = nil
        do {
            await prepareWidgetSignOut()
            let result: SettingsResult = try await client.action(
                "accountDeletion:deleteAccount", with: ["confirmation": confirmation])
            guard result.success else { throw SettingsOperationError.unavailable }
            guard self.sessionID == sessionID else { return }
            isAccountDeleted = true
            notifications.reset()
            // The backend also revokes sessions. Clear the local Clerk session immediately.
            try await Clerk.shared.auth.signOut()
        } catch {
            guard self.sessionID == sessionID else { return }
            if !isAccountDeleted { restoreWidgetsAfterSignOutFailure() }
            actionError =
                isAccountDeleted
                ? L10n.string(
                    "Your account was deleted, but this device couldn't finish signing out. Tap Finish signing out."
                )
                : L10n.string(
                    "Couldn't finish deleting your account. Please try again or contact support.")
        }
        if self.sessionID == sessionID { isSaving = false }
    }

    private func mutate(_ function: String, arguments: [String: ConvexEncodable?]) async -> Bool {
        guard let client else { return false }
        guard !isSaving, let sessionID else { return false }
        isSaving = true
        actionError = nil
        defer { if self.sessionID == sessionID { isSaving = false } }
        do {
            let result: SettingsResult = try await client.mutation(function, with: arguments)
            guard result.success else { throw SettingsOperationError.unavailable }
            return self.sessionID == sessionID
        } catch {
            if self.sessionID == sessionID {
                actionError = L10n.string(
                    "Couldn't save your changes. Check your connection and try again.")
            }
            return false
        }
    }

    private func saveDeviceToken(_ token: String, sessionID: String) async {
        guard let client else { return }
        guard self.sessionID == sessionID else { return }
        do {
            let result: SettingsResult = try await client.mutation(
                "userProfiles:updateApnsDeviceToken", with: ["apnsDeviceToken": token])
            if self.sessionID == sessionID, result.success { notifications.registrationError = nil }
        } catch {
            if self.sessionID == sessionID {
                notifications.registrationError =
                    L10n.string(
                        "Couldn't register this device for bank alerts. Try enabling notifications again."
                    )
            }
        }
    }
}

private enum SettingsOperationError: Error { case unavailable }

private enum SettingsPermissionError: Error { case denied }
