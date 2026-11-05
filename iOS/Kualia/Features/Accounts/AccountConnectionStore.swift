import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
@Observable
final class AccountConnectionStore {
    typealias Subscription = (String) -> AnyPublisher<[BankConnectionSnapshot], Error>
    typealias Authorize = (String) async throws -> PlaidConnectionResult?
    typealias Exchange = (String, PlaidConnectionResult, String) async throws -> String
    typealias Disconnect = (BankConnectionDisconnectRequest) async throws -> Void
    typealias DisconnectAccount = (BankConnectionAccountDisconnectRequest) async throws -> Void
    typealias Save = (AccountConnectionMutationRequest) async throws -> String

    let workspace: TransactionFeedWorkspace
    let purpose: AccountConnectionPurpose
    var initialBalanceDate: String
    private(set) var connections: [BankConnectionSnapshot] = []
    private(set) var hasLoaded = false
    private(set) var errorMessage: String?
    private(set) var failedDuringBankSignIn = false
    private(set) var phase: AccountConnectionPhase = .idle
    private(set) var highlightedConnectionID: String?
    private(set) var connectionToReviewID: String?
    private(set) var savingSourceID: String?
    private(set) var completionName: String?
    private(set) var repairingConnectionID: String?
    private(set) var disconnectedConnectionID: String?
    private(set) var disconnectingAccountID: String?
    private(set) var disconnectedAccountID: String?
    var hasSavedAccount: Bool { phase == .completed && completionName != nil }
    var isBusy: Bool { phase.isBusy }

    var statusTitle: String {
        if purpose == .manageConnections {
            switch phase {
            case .idle: return L10n.string("Your bank connections")
            case .preparing, .authorizing: return L10n.string("Connecting to Plaid")
            case .exchanging:
                return repairingConnectionID == nil
                    ? L10n.string("Saving your connection")
                    : L10n.string("Updating your connection")
            case .completed:
                if disconnectedConnectionID != nil { return L10n.string("Connection disconnected") }
                return repairingConnectionID == nil
                    ? L10n.string("Connection ready") : L10n.string("Bank sign-in updated")
            case .disconnecting: return L10n.string("Disconnecting your bank")
            case .saving: return L10n.string("Saving")
            }
        }
        return switch phase {
        case .idle: L10n.string("Ready when you are")
        case .preparing, .authorizing: L10n.string("Connecting to Plaid")
        case .exchanging: L10n.string("Preparing your account choices")
        case .disconnecting: L10n.string("Disconnecting your bank")
        case .saving: L10n.string("Connecting your account")
        case .completed:
            completionName == nil
                ? L10n.string("Connection ready") : L10n.string("Account connected")
        }
    }
    var statusDetail: String {
        if purpose == .manageConnections {
            switch phase {
            case .idle: return L10n.string("See connection health and linked accounts.")
            case .preparing, .authorizing:
                return L10n.string("Complete the steps in Plaid to continue.")
            case .exchanging: return L10n.string("Keep this page open while we finish.")
            case .completed:
                if disconnectedConnectionID != nil {
                    return L10n.string("Your Kualia accounts and history are still here.")
                }
                return repairingConnectionID == nil
                    ? L10n.string("Choose the accounts you want to add to your budget.")
                    : L10n.string(
                        "Bank updates have been requested. Check the latest health below.")
            case .disconnecting:
                return L10n.string("Stopping bank updates while keeping your accounts and history.")
            case .saving: return L10n.string("Keep this page open while we finish.")
            }
        }
        return switch phase {
        case .idle: L10n.string("Choose the accounts you want in Kualia.")
        case .preparing, .authorizing: L10n.string("Complete the steps in Plaid to continue.")
        case .exchanging: L10n.string("Saving your connection so you can choose an account.")
        case .disconnecting:
            L10n.string("Stopping bank updates while keeping your accounts and history.")
        case .saving: L10n.string("Giving bank activity a home in Kualia.")
        case .completed:
            completionName.map {
                L10n.string("\($0) is ready. Bank activity will sync separately.")
            }
                ?? L10n.string("Choose which accounts to add to Kualia.")
        }
    }

    @ObservationIgnored private let subscribe: Subscription
    @ObservationIgnored private let createToken: () async throws -> String
    @ObservationIgnored private let authorize: Authorize
    @ObservationIgnored private let exchange: Exchange
    @ObservationIgnored private let performSave: Save
    @ObservationIgnored private let performDisconnect: Disconnect
    @ObservationIgnored private let performAccountDisconnect: DisconnectAccount
    @ObservationIgnored private let createRepairToken: (String) async throws -> String
    @ObservationIgnored private let completeRepair: (String) async throws -> Void
    @ObservationIgnored private let cancelAuthorization: () -> Void
    @ObservationIgnored private let currentAccounts: () -> [AccountSnapshot]
    @ObservationIgnored private let isWorkspaceCurrent: () -> Bool
    @ObservationIgnored private let completionDuration: Duration
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var completionTask: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var subscriptionID = UUID()
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var completedMappings: [String: ConnectedBankAccount] = [:]
    @ObservationIgnored private var waitingForConnectionID: String?

    convenience init(
        client: ConvexClientWithAuth<String>, workspace: TransactionFeedWorkspace,
        purpose: AccountConnectionPurpose = .addAccounts,
        currentAccounts: @escaping () -> [AccountSnapshot],
        isWorkspaceCurrent: @escaping () -> Bool
    ) {
        let plaid = PlaidConnectionService()
        self.init(
            workspace: workspace, purpose: purpose,
            subscription: { id in
                client.subscribe(
                    to: "bankConnections:listConnections", with: ["workspaceId": id],
                    yielding: [BankConnectionSnapshot].self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            createToken: {
                let result: ConnectionToken = try await client.action(
                    "bankProviders/plaid/createLinkToken:createLinkToken", with: ["platform": "ios"]
                )
                return result.linkToken
            },
            authorize: { token in try await plaid.connect(linkToken: token, onEvent: { _ in }) },
            exchange: { workspaceID, result, _ in
                let accounts: [[String: String]] = result.accounts.map {
                    [
                        "id": $0.id, "name": $0.name, "type": $0.type, "subtype": $0.subtype,
                        "mask": $0.mask,
                    ]
                }
                let response: ConnectionExchangeResult = try await client.action(
                    "bankProviders/plaid/linkNewPlaidItem:linkNewPlaidItem",
                    with: [
                        "workspaceId": workspaceID, "publicToken": result.publicToken,
                        "institutionId": result.institutionID,
                        "institutionName": result.institutionName,
                        "accounts": ConnectionSelectedAccounts(accounts: accounts),
                    ])
                guard response.success else { throw AccountStoreError.saveFailed }
                return response.bankLinkId
            },
            save: { request in
                if let existingID = request.existingAccountID {
                    let result: ConnectionSaveResult = try await client.mutation(
                        request.name, with: request.arguments)
                    guard result.success else { throw AccountStoreError.saveFailed }
                    return existingID
                }
                return try await client.mutation(request.name, with: request.arguments)
            },
            createRepairToken: { id in
                let response: ConnectionToken = try await client.action(
                    "bankProviders/plaid/createUpdateLinkToken:createUpdateLinkToken",
                    with: ["bankLinkId": id, "platform": "ios"])
                return response.linkToken
            },
            completeRepair: { id in
                let response: ConnectionSaveResult = try await client.action(
                    "bankProviders/plaid/handleUpdateModeSuccess:handleUpdateModeSuccess",
                    with: ["bankLinkId": id])
                guard response.success else { throw AccountStoreError.saveFailed }
            },
            disconnect: { request in
                let _: ConnectionDisconnectResult = try await client.action(
                    request.name, with: request.arguments)
            },
            disconnectAccount: { request in
                let result: ConnectionSaveResult = try await client.mutation(
                    request.name, with: request.arguments)
                guard result.success else { throw AccountStoreError.saveFailed }
            },
            cancelAuthorization: { plaid.cancel() },
            currentAccounts: currentAccounts, isWorkspaceCurrent: isWorkspaceCurrent)
    }

    init(
        workspace: TransactionFeedWorkspace,
        purpose: AccountConnectionPurpose = .addAccounts,
        completionDuration: Duration = .seconds(3),
        subscription: @escaping Subscription,
        createToken: @escaping () async throws -> String,
        authorize: @escaping Authorize,
        exchange: @escaping Exchange,
        save: @escaping Save,
        createRepairToken: @escaping (String) async throws -> String = { _ in
            throw AccountStoreError.saveFailed
        },
        completeRepair: @escaping (String) async throws -> Void = { _ in
            throw AccountStoreError.saveFailed
        },
        disconnect: @escaping Disconnect = { _ in throw AccountStoreError.saveFailed },
        disconnectAccount: @escaping DisconnectAccount = { _ in
            throw AccountStoreError.saveFailed
        },
        cancelAuthorization: @escaping () -> Void = {},
        currentAccounts: @escaping () -> [AccountSnapshot] = { [] },
        isWorkspaceCurrent: @escaping () -> Bool = { true }
    ) {
        self.workspace = workspace
        self.purpose = purpose
        self.completionDuration = completionDuration
        initialBalanceDate = TransactionEditorDate.today(workspace: workspace)
        subscribe = subscription
        self.createToken = createToken
        self.authorize = authorize
        self.exchange = exchange
        performSave = save
        performDisconnect = disconnect
        performAccountDisconnect = disconnectAccount
        self.createRepairToken = createRepairToken
        self.completeRepair = completeRepair
        self.cancelAuthorization = cancelAuthorization
        self.currentAccounts = currentAccounts
        self.isWorkspaceCurrent = isWorkspaceCurrent
    }

    func start() {
        guard !isActive, isWorkspaceCurrent() else { return }
        isActive = true
        watch()
    }

    func stop() {
        isActive = false
        subscriptionID = UUID()
        subscription?.cancel()
        subscription = nil
        deadline?.cancel()
        cancelActivity()
    }

    /// Leaving a Plaid action cancels that operation while its workspace-owned
    /// connection list remains live for the next visit to Settings.
    func cancelActivity() {
        generation = UUID()
        completionTask?.cancel()
        cancelAuthorization()
        connectionToReviewID = nil
        waitingForConnectionID = nil
        repairingConnectionID = nil
        disconnectedConnectionID = nil
        disconnectingAccountID = nil
        disconnectedAccountID = nil
        savingSourceID = nil
        phase = .idle
    }

    func consumeConnectionToReview() -> String? {
        defer { connectionToReviewID = nil }
        return connectionToReviewID
    }

    func retry() {
        guard isActive, !isBusy else { return }
        errorMessage = nil
        watch()
    }

    func connectBank() async {
        guard isActive, !isBusy, isWorkspaceCurrent() else { return }
        let operation = begin(.preparing)
        defer { finishCancelledOperation(operation) }
        do {
            let token = try await createToken()
            guard isCurrent(operation) else { return }
            phase = .authorizing
            guard let result = try await authorize(token) else {
                if isCurrent(operation) { phase = .idle }
                return
            }
            guard isCurrent(operation) else { return }
            phase = .exchanging
            let id = try await exchange(workspace.id, result, initialBalanceDate)
            guard isCurrent(operation) else { return }
            highlightedConnectionID = id
            waitingForConnectionID = id
            finishBankConnectionIfLoaded()
            watch()
        } catch {
            finish(error: error, operation: operation)
        }
    }

    func save(source: BankConnectionAccount, existingAccountID: String?) async -> Bool {
        guard purpose == .addAccounts, isActive, !isBusy, isWorkspaceCurrent() else { return false }
        guard
            let connection = connections.first(where: {
                $0.accounts.contains { $0.id == source.id }
            }),
            connection.canUseAccounts,
            let source = connection.accounts.first(where: { $0.id == source.id }),
            source.isSupported, !source.isLinked, source.linkedToBankAccount == nil
        else {
            errorMessage =
                L10n.string(
                    "This account isn't available to connect. Refresh your connections and try again."
                )
            return false
        }
        let name: String
        if let existingAccountID {
            guard let account = currentAccounts().first(where: { $0.id == existingAccountID }),
                source.canLink(to: account),
                !completedMappings.values.contains(where: { $0.id == existingAccountID })
            else {
                errorMessage = L10n.string("Choose an open, manual account of the same type.")
                return false
            }
            name = account.name
        } else {
            guard source.initialBalance != nil else {
                errorMessage =
                    L10n.string(
                        "Your bank hasn't supplied a starting balance yet. Refresh your connections and try again."
                    )
                return false
            }
            guard TransactionEditorDate.date(from: initialBalanceDate, workspace: workspace) != nil,
                initialBalanceDate <= TransactionEditorDate.today(workspace: workspace)
            else {
                errorMessage = L10n.string("Choose a valid starting date that isn't in the future.")
                return false
            }
            name = source.name
        }
        let operation = begin(.saving)
        savingSourceID = source.id
        defer {
            if generation == operation { savingSourceID = nil }
            finishCancelledOperation(operation)
        }
        do {
            let accountID = try await performSave(
                .init(
                    workspaceID: workspace.id, source: source.ref,
                    existingAccountID: existingAccountID, initialBalanceDate: initialBalanceDate))
            guard isCurrent(operation) else { return false }
            completedMappings[source.id] = .init(id: accountID, name: name)
            applyCompletedMappings()
            completionName = name
            phase = .completed
            scheduleCompletionDismissal(operation: operation)
            return true
        } catch {
            finish(error: error, operation: operation)
            return false
        }
    }

    func repairConnection(id: String) async {
        guard connections.contains(where: { $0.id == id && $0.canRepair }) else { return }
        await reconnectConnection(id: id)
    }

    func reconnectConnection(id: String) async {
        guard isActive, !isBusy, isWorkspaceCurrent(),
            let connection = connections.first(where: { $0.id == id }), connection.canReconnect
        else { return }
        if connection.health == .disconnected {
            await connectBank()
            return
        }
        let operation = begin(.preparing)
        repairingConnectionID = id
        defer { finishCancelledOperation(operation) }
        do {
            let token = try await createRepairToken(id)
            guard isCurrent(operation),
                connections.contains(where: { $0.id == id && $0.canReauthorize })
            else {
                if isCurrent(operation) { phase = .idle }
                return
            }
            phase = .authorizing
            guard try await authorize(token) != nil else {
                if isCurrent(operation) { phase = .idle }
                return
            }
            guard isCurrent(operation),
                connections.contains(where: {
                    $0.id == id && $0.isOwnedByCurrentUser && $0.canManageConnection
                        && $0.health != .disconnected
                })
            else {
                if isCurrent(operation) { phase = .idle }
                return
            }
            phase = .exchanging
            // Update mode keeps the existing item and account mappings; it never exchanges a new item.
            try await completeRepair(id)
            guard isCurrent(operation) else { return }
            highlightedConnectionID = id
            phase = .completed
            watch()
            scheduleCompletionDismissal(operation: operation)
        } catch {
            finish(error: error, operation: operation)
        }
    }

    func disconnectConnection(id: String) async {
        guard purpose == .manageConnections, isActive, !isBusy, isWorkspaceCurrent(),
            let connection = connections.first(where: { $0.id == id }), connection.canDisconnect
        else { return }
        let operation = begin(.disconnecting)
        defer { finishCancelledOperation(operation) }
        do {
            try await performDisconnect(
                .init(
                    workspaceID: workspace.id,
                    connection: .init(provider: connection.provider, connectionId: connection.id)))
            guard isCurrent(operation) else { return }
            connections.removeAll { $0.id == id }
            disconnectedConnectionID = id
            phase = .completed
            scheduleCompletionDismissal(operation: operation)
        } catch {
            finish(error: error, operation: operation)
        }
    }

    func connectionDetails(for bankAccountID: String) -> BankAccountConnectionDetails? {
        guard disconnectedAccountID != bankAccountID else { return nil }
        for connection in connections {
            if let source = connection.accounts.first(where: {
                $0.linkedToBankAccount?.id == bankAccountID
            }) {
                return .init(connection: connection, source: source)
            }
        }
        return nil
    }

    @discardableResult
    func disconnectAccount(id: String) async -> Bool {
        guard purpose == .accountDetails, isActive, !isBusy, isWorkspaceCurrent(),
            currentAccounts().contains(where: { $0.id == id && $0.isLinked })
        else { return false }
        let operation = begin(.disconnecting)
        disconnectingAccountID = id
        defer {
            if generation == operation { disconnectingAccountID = nil }
            finishCancelledOperation(operation)
        }
        do {
            try await performAccountDisconnect(
                .init(workspaceID: workspace.id, bankAccountID: id))
            guard isCurrent(operation) else { return false }
            disconnectedAccountID = id
            phase = .completed
            scheduleCompletionDismissal(operation: operation)
            return true
        } catch {
            finish(error: error, operation: operation)
            return false
        }
    }

    func acknowledgeAccountState(id: String, isLinked: Bool) {
        if disconnectedAccountID == id, !isLinked { disconnectedAccountID = nil }
    }

    private func begin(_ phase: AccountConnectionPhase) -> UUID {
        completionTask?.cancel()
        generation = UUID()
        errorMessage = nil
        failedDuringBankSignIn = false
        completionName = nil
        waitingForConnectionID = nil
        connectionToReviewID = nil
        repairingConnectionID = nil
        disconnectedConnectionID = nil
        disconnectingAccountID = nil
        disconnectedAccountID = nil
        self.phase = phase
        return generation
    }

    private func isCurrent(_ operation: UUID) -> Bool {
        isActive && generation == operation && isWorkspaceCurrent() && !Task.isCancelled
    }

    private func finish(error: Error, operation: UUID) {
        guard isCurrent(operation) else { return }
        failedDuringBankSignIn = phase == .preparing || phase == .authorizing
        phase = .idle
        if !(error is CancellationError) { errorMessage = error.localizedDescription }
    }

    private func finishCancelledOperation(_ operation: UUID) {
        guard Task.isCancelled, generation == operation else { return }
        cancelAuthorization()
        phase = .idle
    }

    private func finishBankConnectionIfLoaded() {
        guard phase == .exchanging, let id = waitingForConnectionID,
            connections.contains(where: { $0.id == id })
        else { return }
        waitingForConnectionID = nil
        connectionToReviewID = id
        phase = .completed
        scheduleCompletionDismissal(operation: generation)
    }

    private func scheduleCompletionDismissal(operation: UUID) {
        completionTask?.cancel()
        completionTask = Task { [weak self] in
            do { try await Task.sleep(for: self?.completionDuration ?? .seconds(3)) } catch {
                return
            }
            guard let self, self.isCurrent(operation), self.phase == .completed else { return }
            self.phase = .idle
        }
    }

    private func watch() {
        subscription?.cancel()
        deadline?.cancel()
        subscriptionID = UUID()
        let id = subscriptionID
        deadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.subscriptionID == id, self.isActive else { return }
            self.errorMessage = L10n.string(
                "Connections are taking longer to load. Try refreshing.")
            if self.waitingForConnectionID != nil {
                self.waitingForConnectionID = nil
                self.phase = .idle
            }
        }
        subscription = subscribe(workspace.id).receive(on: DispatchQueue.main).sink(
            receiveCompletion: { [weak self] completion in
                guard let self, self.subscriptionID == id, self.isWorkspaceCurrent() else { return }
                self.deadline?.cancel()
                if case .failure = completion {
                    self.errorMessage = L10n.string("Couldn't refresh your connections. Try again.")
                } else if !self.hasLoaded {
                    self.errorMessage = L10n.string("Connections stopped loading. Try again.")
                }
                if self.waitingForConnectionID != nil {
                    self.waitingForConnectionID = nil
                    self.phase = .idle
                }
            },
            receiveValue: { [weak self] connections in
                guard let self, self.subscriptionID == id, self.isWorkspaceCurrent() else { return }
                self.connections =
                    self.purpose == .addAccounts
                    ? connections.filter { $0.provider == "plaid" } : connections
                self.applyCompletedMappings()
                self.hasLoaded = true
                self.finishBankConnectionIfLoaded()
                if self.waitingForConnectionID == nil { self.deadline?.cancel() }
            })
    }

    private func applyCompletedMappings() {
        for connectionIndex in connections.indices {
            for accountIndex in connections[connectionIndex].accounts.indices {
                let id = connections[connectionIndex].accounts[accountIndex].id
                if let mapping = completedMappings[id] {
                    connections[connectionIndex].accounts[accountIndex].isLinked = true
                    connections[connectionIndex].accounts[accountIndex].linkedToBankAccount =
                        mapping
                }
            }
        }
    }
}

private struct ConnectionToken: Decodable {
    let linkToken: String
    private enum CodingKeys: String, CodingKey { case linkToken = "link_token" }
}
private struct ConnectionExchangeResult: Decodable {
    let success: Bool
    let bankLinkId: String
}
private struct ConnectionSaveResult: Decodable { let success: Bool }

private struct ConnectionSelectedAccounts: ConvexEncodable {
    let accounts: [[String: String]]

    func convexEncode() throws -> String {
        String(decoding: try JSONEncoder().encode(accounts), as: UTF8.self)
    }
}

private struct ConnectionDisconnectResult: Decodable { let disconnectedAccountCount: Int? }
