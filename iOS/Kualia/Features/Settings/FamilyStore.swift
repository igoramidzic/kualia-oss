import Combine
import Foundation
import Observation

@MainActor
struct FamilyClient {
    var watch: () -> AnyPublisher<FamilyGroup?, Error>
    var change: (FamilyChange) async throws -> Void
    var preview: (String) -> AnyPublisher<FamilyInvitePreview, Error>
}

@MainActor
@Observable
final class FamilyStore {
    private(set) var group: FamilyGroup?
    private(set) var hasLoaded = false
    private(set) var loadError: String?
    private(set) var isSaving = false
    private(set) var actionError: String?
    private(set) var notice: String?
    private(set) var preview: FamilyInvitePreview?
    private(set) var previewError: String?
    private(set) var isLoadingPreview = false
    @ObservationIgnored private let client: FamilyClient
    @ObservationIgnored private var subscription: AnyCancellable?
    @ObservationIgnored private var previewSubscription: AnyCancellable?
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var previewDeadline: Task<Void, Never>?
    @ObservationIgnored private var sessionID: String?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var watchGeneration = UUID()
    @ObservationIgnored private var previewGeneration = UUID()
    @ObservationIgnored private var previewToken: String?

    init(client: FamilyClient) { self.client = client }

    func start(sessionID: String) {
        guard self.sessionID != sessionID else { return }
        reset()
        self.sessionID = sessionID
        reload()
    }

    func reset() {
        generation = UUID()
        watchGeneration = UUID()
        sessionID = nil
        subscription = nil
        deadline?.cancel()
        clearPreview()
        group = nil
        hasLoaded = false
        loadError = nil
        isSaving = false
        actionError = nil
        notice = nil
    }

    func reload() {
        guard sessionID != nil else { return }
        subscription = nil
        watchGeneration = UUID()
        let request = watchGeneration
        loadError = nil
        deadline?.cancel()
        deadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.watchGeneration == request else { return }
            self.loadError = L10n.string("Your family is taking longer to load. Try again.")
        }
        subscription = client.watch().sink { [weak self] completion in
            guard let self, self.watchGeneration == request else { return }
            if case .failure = completion {
                self.deadline?.cancel()
                self.loadError =
                    L10n.string(
                        "Couldn't refresh your family. Check your connection and try again.")
            }
        } receiveValue: { [weak self] group in
            guard let self, self.watchGeneration == request else { return }
            self.deadline?.cancel()
            self.group = group
            self.hasLoaded = true
            self.loadError = nil
        }
    }

    func clearFeedback() {
        actionError = nil
        notice = nil
    }

    func clearPreview() {
        previewGeneration = UUID()
        previewSubscription = nil
        previewDeadline?.cancel()
        preview = nil
        previewError = nil
        previewToken = nil
        isLoadingPreview = false
    }

    func loadPreview(link: String) {
        clearPreview()
        guard sessionID != nil, let token = FamilyPresentation.inviteToken(from: link) else {
            previewError = L10n.string("Paste the full Kualia invitation link from your email.")
            return
        }
        previewToken = token
        isLoadingPreview = true
        let request = previewGeneration
        previewDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.previewGeneration == request else { return }
            self.isLoadingPreview = false
            self.previewError = L10n.string("The invitation is taking longer to load. Try again.")
        }
        previewSubscription = client.preview(token).sink { [weak self] completion in
            guard let self, self.previewGeneration == request else { return }
            if case .failure = completion {
                self.previewDeadline?.cancel()
                self.isLoadingPreview = false
                self.previewError = L10n.string("Couldn't check this invitation. Try again.")
            }
        } receiveValue: { [weak self] preview in
            guard let self, self.previewGeneration == request else { return }
            self.previewDeadline?.cancel()
            self.preview = preview
            self.previewError = nil
            self.isLoadingPreview = false
        }
    }

    func acceptPreview() async -> Bool {
        guard preview?.canJoin(at: .now) == true, previewError == nil, let previewToken else {
            return false
        }
        return await perform(.accept(previewToken))
    }

    @discardableResult
    func perform(_ change: FamilyChange) async -> Bool {
        guard sessionID != nil, !isSaving, hasLoaded, loadError == nil else { return false }
        // These guards protect stale sheets; the backend remains authoritative.
        switch change {
        case .create: guard group == nil else { return false }
        case .invite(let draft):
            guard let group, group.canSendEmail, draft.isValid,
                group.availableSeats > 0
                    || group.pendingInvites.contains(where: {
                        $0.invitedEmail.lowercased() == draft.normalizedEmail
                    })
            else { return false }
        case .remove(let id):
            guard group?.isOwner == true,
                group?.members.contains(where: {
                    $0.id == id && $0.role != "owner" && !$0.isCurrentUser
                }) == true
            else { return false }
        case .revoke(let id):
            guard group?.isOwner == true,
                group?.pendingInvites.contains(where: { $0.id == id }) == true
            else { return false }
        case .leave: guard group?.canLeave == true else { return false }
        case .accept(let token):
            guard preview?.canJoin(at: .now) == true, previewError == nil, token == previewToken
            else {
                return false
            }
        }
        let request = generation
        isSaving = true
        clearFeedback()
        defer { if generation == request { isSaving = false } }
        do {
            try await client.change(change)
            guard generation == request else { return false }
            switch change {
            case .create: notice = L10n.string("Your family is ready. Make room for your people.")
            case .invite(let draft):
                notice = L10n.string("Invitation sent to \(draft.normalizedEmail).")
            case .remove:
                notice = L10n.string("Member removed. Their own workspaces stay with them.")
            case .revoke: notice = L10n.string("Invitation revoked. The link no longer works.")
            case .leave:
                notice = L10n.string("You've left the family. Your own workspaces stay with you.")
            case .accept: notice = L10n.string("You're in. Welcome to the family.")
            }
            return true
        } catch {
            guard generation == request else { return false }
            actionError = error.localizedDescription
            return false
        }
    }
}
