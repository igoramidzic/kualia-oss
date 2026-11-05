import ConvexMobile
import Foundation

struct BankConnectionAccountReference: Codable, Equatable, ConvexEncodable {
    let provider: String
    let accountId: String

    func convexEncode() throws -> String {
        String(decoding: try JSONEncoder().encode(self), as: UTF8.self)
    }
}

struct BankConnectionReference: Codable, Equatable, ConvexEncodable {
    let provider: String
    let connectionId: String

    func convexEncode() throws -> String {
        String(decoding: try JSONEncoder().encode(self), as: UTF8.self)
    }
}

struct BankConnectionDisconnectRequest {
    let workspaceID: String
    let connection: BankConnectionReference
    var name: String { "bankConnections:disconnectConnection" }
    var arguments: [String: ConvexEncodable?] {
        ["workspaceId": workspaceID, "connection": connection]
    }
}

struct BankConnectionAccountDisconnectRequest {
    let workspaceID: String
    let bankAccountID: String
    var name: String { "bankConnections:unlinkAccount" }
    var arguments: [String: ConvexEncodable?] {
        ["workspaceId": workspaceID, "bankAccountId": bankAccountID]
    }
}

struct ConnectedBankAccount: Decodable, Equatable {
    let id: String
    let name: String
    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
    }
}

struct BankConnectionAccount: Decodable, Identifiable, Equatable {
    let id: String
    let ref: BankConnectionAccountReference
    let name: String
    let accountType: String?
    let accountNumberMask: String?
    let initialBalance: Int64?
    var isLinked: Bool
    var linkedToBankAccount: ConnectedBankAccount?
    var hasCompletedInitialSync: Bool?

    var isAddedToWorkspace: Bool { isLinked || linkedToBankAccount != nil }

    var typeTitle: String {
        AccountTypeOption.all.first { $0.rawValue == accountType }?.title ?? L10n.string("Account")
    }
    var isSupported: Bool {
        guard ref.provider == "plaid", let accountType else { return false }
        let category = AccountCategory.from(accountType)
        return category == .banking || category == .credit
    }

    func canLink(to account: AccountSnapshot) -> Bool {
        isSupported && !isLinked && linkedToBankAccount == nil
            && !account.isClosed && !account.isDeleted && !account.isLinked
            && accountType.flatMap { AccountCategory.from($0) } == account.category
    }
}

struct BankConnectionSnapshot: Decodable, Identifiable {
    let id: String
    let provider: String
    let displayName: String
    let logoUrl: String?
    let status: String
    let statusLabel: String
    let canManageConnection: Bool
    let isOwnedByCurrentUser: Bool
    var accounts: [BankConnectionAccount]
    var owner: Owner?
    var lastSyncedAt: String? = nil
    var reauthorization: Reauthorization? = nil

    struct Reauthorization: Decodable {
        let reason: String
        var requiredBy: String? = nil
        var providerReason: String? = nil

        var needsReview: Bool {
            reason == "consent_expiring" || reason == "connection_expiring"
        }
    }

    var review: BankConnectionReview? {
        switch health {
        case .disconnected: return .disconnected
        case .needsAttention: return .needsAttention
        case .unknown: return .unavailable
        case .connected, .pending:
            return reauthorization?.needsReview == true ? .reauthorizationSoon : nil
        }
    }

    struct Owner: Decodable {
        var name: String?
        var firstName: String?
        var lastName: String?
        var email: String?
    }

    var ownerName: String? {
        if let name = owner?.name, !name.isEmpty { return name }
        let fullName = [owner?.firstName, owner?.lastName].compactMap { $0 }.joined(separator: " ")
        return fullName.isEmpty ? owner?.email : fullName
    }
    var canUseAccounts: Bool {
        canManageConnection && isOwnedByCurrentUser && status == "connected"
    }

    var addedAccounts: [BankConnectionAccount] { accounts.filter(\.isAddedToWorkspace) }
    var unlinkedAccounts: [BankConnectionAccount] { accounts.filter { !$0.isAddedToWorkspace } }

    var health: BankConnectionHealth { .init(status: status) }
    var canDisconnect: Bool {
        isOwnedByCurrentUser && canManageConnection
            && (provider == "plaid" || provider == "apple_wallet")
    }
    var canReconnect: Bool {
        provider == "plaid" && isOwnedByCurrentUser && canManageConnection && health != .unknown
    }
    var canReauthorize: Bool { canReconnect && health != .disconnected }
    var disconnectMessage: String {
        provider == "plaid"
            ? L10n.string(
                "Bank updates will stop for accounts using this connection in every workspace. Your Kualia accounts and transaction history will be kept."
            )
            : L10n.string(
                "Apple Wallet updates will stop for this workspace. Your Kualia accounts and transaction history will be kept."
            )
    }
    var canRepair: Bool {
        provider == "plaid" && isOwnedByCurrentUser && canManageConnection
            && (health == .needsAttention || review == .reauthorizationSoon)
    }
    var lastSyncDate: Date? {
        guard let lastSyncedAt else { return nil }
        return (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(lastSyncedAt))
            ?? (try? Date.ISO8601FormatStyle().parse(lastSyncedAt))
    }
    var healthDetail: String {
        if review == .reauthorizationSoon {
            return L10n.string("Sign in again soon to keep bank updates connected.")
        }
        return switch health {
        case .connected:
            L10n.string(
                "Your bank connection is available. New activity arrives as your bank shares it.")
        case .needsAttention:
            L10n.string(
                "Bank updates may be paused. Review your connection to get them flowing again.")
        case .pending:
            L10n.string(
                "Your connection is still being prepared. Its status will update here automatically."
            )
        case .disconnected:
            L10n.string(
                "This connection is no longer receiving bank updates. Your Kualia accounts remain in your budget."
            )
        case .unknown:
            L10n.string(
                "We don't have a current health status for this connection. Try refreshing.")
        }
    }
}

enum BankConnectionReview: String, Decodable {
    case disconnected
    case reauthorizationSoon
    case needsAttention
    case unavailable

    var title: String {
        switch self {
        case .disconnected: L10n.string("Disconnected")
        case .reauthorizationSoon: L10n.string("Reauthorization due soon")
        case .needsAttention: L10n.string("Needs attention")
        case .unavailable: L10n.string("Status unavailable")
        }
    }
}

struct BankAccountConnectionDetails {
    let connection: BankConnectionSnapshot
    let source: BankConnectionAccount
}

enum AccountConnectionPurpose {
    case addAccounts, manageConnections, accountDetails
}

enum BankConnectionHealth: Equatable {
    case connected, needsAttention, pending, disconnected, unknown

    init(status: String) {
        switch status {
        case "connected": self = .connected
        case "needs_attention": self = .needsAttention
        case "pending": self = .pending
        case "disconnected": self = .disconnected
        default: self = .unknown
        }
    }
    var title: String {
        switch self {
        case .connected: L10n.string("Connected")
        case .needsAttention: L10n.string("Needs attention")
        case .pending: L10n.string("Getting ready")
        case .disconnected: L10n.string("Disconnected")
        case .unknown: L10n.string("Status unavailable")
        }
    }
    var symbol: KualiaIcon {
        switch self {
        case .connected: .checkCircle
        case .needsAttention: .warning
        case .pending: .clock
        case .disconnected: .linkPlus
        case .unknown: .question
        }
    }
    var needsReview: Bool {
        self == .needsAttention || self == .disconnected || self == .unknown
    }
}

struct BankConnectionsOverview {
    let connections: [BankConnectionSnapshot]
    var connectedCount: Int { connections.filter { $0.health == .connected }.count }
    var reviewCount: Int { connections.filter { $0.review != nil }.count }
    var linkedAccountCount: Int { connections.reduce(0) { $0 + $1.addedAccounts.count } }
    var title: String {
        if connections.isEmpty { return L10n.string("Your banks, in one place.") }
        if reviewCount > 0 { return L10n.string("A little attention needed.") }
        if connectedCount == connections.count { return L10n.string("You're well connected.") }
        return L10n.string("Getting connected.")
    }
    var detail: String {
        if connections.isEmpty {
            return L10n.string("Connect a bank to see its health and the accounts it shares.")
        }
        if reviewCount > 0 {
            return
                L10n.string(
                    "\(reviewCount) \(reviewCount == 1 ? L10n.string("connection needs") : L10n.string("connections need")) a closer look. Open a bank below for the next step."
                )
        }
        if connectedCount == connections.count {
            return L10n.string(
                "Your connections are available. See where each bank account meets your budget.")
        }
        return L10n.string(
            "Some connections are still getting ready. We'll keep their status up to date here.")
    }
}

enum AccountSetupRoute: Hashable {
    case manual
    case connections
    case bank(String)
}

struct AccountSetupNavigation {
    let startsWithConnections: Bool
    var path: [AccountSetupRoute] = []

    var showsConnections: Bool {
        if let last = path.last { return last != .manual }
        return startsWithConnections
    }

    var bankID: String? {
        if case .bank(let id)? = path.last { return id }
        return nil
    }

    func showsPeek(during phase: AccountConnectionPhase) -> Bool {
        guard showsConnections else { return false }
        if bankID != nil { return true }
        return phase == .preparing || phase == .authorizing || phase == .exchanging
    }

    mutating func reviewNewConnection(_ id: String) {
        // Return from Plaid to the same bank page used by existing connections.
        // Keep the connection library underneath so Back has a predictable home.
        path = startsWithConnections ? [.bank(id)] : [.connections, .bank(id)]
    }
}

enum AccountConnectionPhase: Equatable {
    case idle, preparing, authorizing, exchanging, saving, disconnecting, completed

    var isBusy: Bool {
        self != .idle && self != .completed
    }
}

/// Text and icon swap immediately; the previous content stays mounted while the curtain closes.
struct BankConnectionStatusSnapshot: Equatable {
    enum Indicator: Equatable { case progress, success, error, idle }
    let title: String
    let detail: String
    let indicator: Indicator

    init(
        phase: AccountConnectionPhase, title: String, detail: String,
        error: String?, isLoadingAccounts: Bool = false
    ) {
        if let error {
            self.title = L10n.string("Connection needs another try")
            self.detail = error
            indicator = .error
        } else if isLoadingAccounts {
            self.title = L10n.string("Loading your accounts")
            self.detail = L10n.string("Getting this bank's accounts ready to choose.")
            indicator = .progress
        } else {
            self.title = title
            self.detail = detail
            indicator = phase.isBusy ? .progress : (phase == .completed ? .success : .idle)
        }
    }

    func retainingDuringDismissal(_ previous: Self?, isPresented: Bool) -> Self {
        isPresented ? self : (previous ?? self)
    }
}

struct BankConnectionActivityPresentation {
    let phase: AccountConnectionPhase
    let hasError: Bool

    var showsPeek: Bool { phase.isBusy || phase == .completed || hasError }
    var requiresLeaveConfirmation: Bool { phase.isBusy }
    var leaveMessage: String {
        switch phase {
        case .preparing, .authorizing:
            L10n.string(
                "Bank sign-in isn't finished. Leaving will stop this connection flow. You can try again later."
            )
        case .exchanging, .saving:
            L10n.string(
                "Your bank connection is being saved. Changes already submitted may still finish if you leave. Check your connections before trying again."
            )
        case .disconnecting:
            L10n.string(
                "This connection is being disconnected. The request may still finish if you leave. Your Kualia accounts and transaction history will be kept."
            )
        case .idle, .completed:
            L10n.string("You can return to your connections at any time.")
        }
    }
}

struct AccountConnectionPeekPresentation {
    let phase: AccountConnectionPhase
    let completionName: String?
    let connection: BankConnectionSnapshot?
    let isLinkingExisting: Bool

    var isPositive: Bool {
        phase == .saving || (phase == .completed && completionName != nil)
    }

    var showsProgress: Bool { phase.isBusy }
    var canFinish: Bool { phase != .saving && phase != .exchanging && phase != .disconnecting }

    var idleTitle: String {
        guard let connection else { return L10n.string("Choose a connection") }
        if connection.addedAccounts.isEmpty {
            return isLinkingExisting
                ? L10n.string("Choose an account") : L10n.string("Add the accounts you want")
        }
        let count = connection.addedAccounts.count
        return L10n.string("\(count) accounts added")
    }

    var idleDetail: String {
        connection == nil
            ? L10n.string("Open a bank to see its accounts.")
            : L10n.string("Tap Done whenever you're finished.")
    }
}

struct AccountConnectionMutationRequest {
    let workspaceID: String
    let source: BankConnectionAccountReference
    let existingAccountID: String?
    let initialBalanceDate: String

    var name: String {
        existingAccountID == nil
            ? "bankConnections:createBankAccountFromConnectionAccount"
            : "bankConnections:linkAccount"
    }
    var arguments: [String: ConvexEncodable?] {
        var arguments: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "connectionAccount": source,
        ]
        if let existingAccountID {
            arguments["bankAccountId"] = existingAccountID
        } else {
            arguments["initialBalanceDate"] = initialBalanceDate
        }
        return arguments
    }
}
