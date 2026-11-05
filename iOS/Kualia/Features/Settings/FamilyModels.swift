import Foundation

struct FamilyGroup: Decodable, Equatable, Identifiable {
    let _id: String
    let name: String
    let currentUserRole: String
    let members: [FamilyMember]
    let pendingInvites: [FamilyInvite]
    let inviteEmailQuota: FamilyEmailQuota?
    var id: String { _id }
    var displayName: String {
        guard let owner = members.first(where: { $0.role == "owner" }) else { return name }
        let ownerName = (owner.name ?? owner.email ?? "")
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !ownerName.isEmpty, name == "\(ownerName) Family" else { return name }
        return L10n.string("\(ownerName)'s Family")
    }
    var isOwner: Bool { currentUserRole == "owner" }
    var availableSeats: Int { max(0, 6 - members.count - pendingInvites.count) }
    var canLeave: Bool { !isOwner || members.allSatisfy { $0.role == "owner" } }
    var canSendEmail: Bool { isOwner && (inviteEmailQuota?.remaining ?? 0) > 0 }
    var canInvite: Bool { canSendEmail && availableSeats > 0 }
}

struct FamilyMember: Decodable, Equatable, Identifiable {
    let _id: String
    let name: String?
    let email: String?
    let role: String
    let isCurrentUser: Bool
    let joinedAt: String
    var id: String { _id }
    var displayName: String {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? (email ?? L10n.string("Family member")) : trimmed
    }
    var initials: String { FamilyPresentation.initials(displayName) }
    var roleLabel: String {
        role == "owner" ? L10n.string("Family manager") : L10n.string("Member")
    }
}

struct FamilyInvite: Decodable, Equatable, Identifiable {
    let _id: String
    let invitedEmail: String
    let invitedName: String
    let status: String
    let expiresAt: String
    var id: String { _id }
    func isExpired(at now: Date) -> Bool {
        guard let date = FamilyPresentation.date(expiresAt) else { return true }
        return date <= now
    }
}

struct FamilyEmailQuota: Decodable, Equatable {
    let limit: Int
    let remaining: Int
    let windowEndsAt: String?
}

struct FamilyInviteDraft: Equatable {
    var name = ""
    var email = ""
    var normalizedName: String { name.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
    var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
    var isValid: Bool {
        !normalizedName.isEmpty
            && normalizedEmail.range(
                of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }
}

struct FamilyInvitePreview: Decodable, Equatable {
    let status: String
    let canAccept: Bool
    let familyGroupName: String?
    let invitedByName: String?
    let expiresAt: String?
    let currentFamilyGroup: CurrentFamily?
    struct CurrentFamily: Decodable, Equatable {
        let name: String
        let role: String
    }
    func canJoin(at now: Date) -> Bool {
        guard canAccept, let expiresAt, let expiry = FamilyPresentation.date(expiresAt) else {
            return false
        }
        return expiry > now
    }
    var message: String {
        switch status {
        case "available":
            L10n.string(
                "Join to share workspaces, budgets, accounts, and transactions with this family.")
        case "email_mismatch":
            L10n.string("Sign in with the email address this invitation was sent to.")
        case "already_in_family": L10n.string("You're already part of this family.")
        case "must_leave_current_family":
            L10n.string("Leave your current family before joining this one.")
        case "owner_must_remove_members":
            L10n.string("Remove the members of your current family before joining this one.")
        case "expired":
            L10n.string("This invitation has expired. Ask the family manager to send a new one.")
        case "revoked":
            L10n.string("This invitation was revoked. Ask the family manager for a new invitation.")
        case "accepted": L10n.string("This invitation has already been used.")
        default:
            L10n.string(
                "This invitation is unavailable. Check the link or ask the family manager for a new one."
            )
        }
    }
}

enum FamilyPresentation {
    nonisolated static func initials(_ name: String) -> String {
        let letters = name.split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
    nonisolated static func date(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }
    nonisolated static func inviteToken(from input: String) -> String? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value), url.scheme == "https",
            ["app.kualia.com", "kualia.com"].contains(url.host?.lowercased() ?? "")
        else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 3, parts[0] == "family", parts[1] == "join",
            !parts[2].isEmpty
        else { return nil }
        return parts[2]
    }
}

enum FamilyChange: Equatable {
    case create
    case invite(FamilyInviteDraft)
    case remove(String)
    case revoke(String)
    case leave
    case accept(String)
}
