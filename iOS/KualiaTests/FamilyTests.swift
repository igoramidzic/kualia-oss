import Combine
import Foundation
import Testing

@testable import Kualia

@MainActor
struct FamilyTests {
    @Test func familyNamesUsePossessiveForLegacyDefaultsAndPreserveCustomNames() {
        let members = fixture().members
        for (stored, expected) in [
            ("Person 0 Family", "Person 0's Family"),
            ("Person 0's Family", "Person 0's Family"),
            ("Our family", "Our family"),
        ] {
            let group = FamilyGroup(
                _id: "family", name: stored, currentUserRole: "owner",
                members: members, pendingInvites: [], inviteEmailQuota: nil)
            #expect(group.displayName == expected)
        }
    }

    @Test func backendPayloadDecodesRolesQuotaAndReservedSeats() throws {
        let group = try JSONDecoder().decode(
            FamilyGroup.self,
            from: Data(
                #"{"_id":"family","name":"Our family","currentUserRole":"owner","members":[{"_id":"owner","name":"Alex","email":"alex@example.com","role":"owner","isCurrentUser":true,"joinedAt":"2026-01-01T00:00:00Z"}],"pendingInvites":[{"_id":"invite","invitedName":"Sam","invitedEmail":"sam@example.com","status":"pending","expiresAt":"2026-10-01T00:00:00.000Z"}],"inviteEmailQuota":{"limit":10,"remaining":4,"windowEndsAt":null}}"#
                    .utf8))
        #expect(group.availableSeats == 4)
        #expect(group.canInvite)
        #expect(group.canLeave)
        #expect(group.members[0].initials == "A")
    }

    @Test func memberCannotManageFamilyAndOwnerCannotLeaveOthersBehind() {
        let member = fixture(role: "member", memberCount: 3)
        #expect(!member.canInvite)
        #expect(!member.canSendEmail)
        #expect(member.canLeave)
        #expect(!fixture(memberCount: 2).canLeave)
        #expect(fixture(memberCount: 1).canLeave)
        #expect(!fixture(remaining: 0).canInvite)
    }

    @Test func fullFamilyCanResendButCannotReserveAnotherSeat() async {
        let mock = FamilyMock(group: fixture(memberCount: 5, invites: [invite]))
        let store = mock.makeStore()
        #expect(store.group?.availableSeats == 0)
        #expect(store.group?.canInvite == false)
        #expect(store.group?.canSendEmail == true)
        let extra = await store.perform(.invite(.init(name: "Other", email: "other@example.com")))
        let resend = await store.perform(.invite(.init(name: "Sam", email: "sam@example.com")))
        #expect(!extra)
        #expect(resend)
        #expect(mock.changes.count == 1)
    }

    @Test func invitationDraftNormalizesNameAndEmail() {
        let draft = FamilyInviteDraft(name: "  Sam   Jones \n", email: " SAM@example.COM ")
        #expect(draft.normalizedName == "Sam Jones")
        #expect(draft.normalizedEmail == "sam@example.com")
        #expect(draft.isValid)
        for email in ["", "sam", "sam@", "a b@example.com", "a@@example.com"] {
            #expect(!FamilyInviteDraft(name: "Sam", email: email).isValid)
        }
        #expect(!FamilyInviteDraft(name: "  ", email: "sam@example.com").isValid)
    }

    @Test func invitationLinksRequireTheCorrectHostAndRoute() {
        #expect(
            FamilyPresentation.inviteToken(from: " https://app.kualia.com/family/join/abc ")
                == "abc")
        for link in [
            "abc", "http://app.kualia.com/family/join/abc", "https://evil.com/family/join/abc",
            "https://app.kualia.com.evil.com/family/join/abc", "https://app.kualia.com/family/join",
            "https://app.kualia.com/other/abc",
        ] {
            #expect(FamilyPresentation.inviteToken(from: link) == nil)
        }
    }

    @Test func expiryHandlesFractionalDatesAndBoundary() throws {
        let end = try #require(FamilyPresentation.date(invite.expiresAt))
        #expect(!invite.isExpired(at: end.addingTimeInterval(-1)))
        #expect(invite.isExpired(at: end))
        #expect(invite.isExpired(at: end.addingTimeInterval(1)))
    }

    @Test func missingFamilyIsDifferentFromLoadingFailure() {
        let mock = FamilyMock(group: nil)
        let store = mock.makeStore()
        #expect(store.hasLoaded)
        #expect(store.group == nil)
        #expect(store.loadError == nil)
        mock.family.send(completion: .failure(FamilyTestError.offline))
        #expect(store.loadError != nil)
        #expect(store.hasLoaded)
        store.reset()
        #expect(!store.hasLoaded)
        #expect(store.group == nil)
    }

    @Test func ownerOnlyActionsAreRejectedForMembers() async {
        let mock = FamilyMock(group: fixture(role: "member", memberCount: 2, invites: [invite]))
        let store = mock.makeStore()
        for change in [
            FamilyChange.create, .invite(.init(name: "Sam", email: "sam@example.com")),
            .remove("member-1"), .revoke("invite"),
        ] {
            let succeeded = await store.perform(change)
            #expect(!succeeded)
        }
        #expect(mock.changes.isEmpty)
        let left = await store.perform(.leave)
        #expect(left)
    }

    @Test func staleMemberAndInviteTargetsCannotBeChanged() async {
        let mock = FamilyMock(group: fixture(memberCount: 2))
        let store = mock.makeStore()
        for change in [
            FamilyChange.remove("owner"), .remove("missing"), .revoke("missing"), .leave,
        ] {
            let succeeded = await store.perform(change)
            #expect(!succeeded)
        }
        #expect(mock.changes.isEmpty)
    }

    @Test func failedWritePreservesRosterAndAllowsRetry() async {
        let original = fixture(memberCount: 2)
        let mock = FamilyMock(group: original)
        mock.error = FamilyTestError.offline
        let store = mock.makeStore()
        let failed = await store.perform(.remove("member-1"))
        #expect(!failed)
        #expect(store.group == original)
        #expect(store.actionError != nil)
        #expect(!store.isSaving)
        mock.error = nil
        let retried = await store.perform(.remove("member-1"))
        #expect(retried)
        #expect(store.actionError == nil)
    }

    @Test func sessionResetDiscardsLateWriteAndPreventsDuplicateSubmissions() async {
        let mock = FamilyMock(group: nil)
        mock.holdsWrite = true
        let store = mock.makeStore()
        let first = Task { await store.perform(.create) }
        while mock.continuation == nil { await Task.yield() }
        #expect(store.isSaving)
        let duplicate = await store.perform(.create)
        #expect(!duplicate)
        #expect(mock.changes.count == 1)
        store.start(sessionID: "second-session")
        mock.continuation?.resume()
        let completed = await first.value
        #expect(!completed)
        #expect(store.notice == nil)
        #expect(!store.isSaving)
    }

    @Test func sameSessionStartPreservesJoiningWhileMembershipActivates() async {
        let mock = FamilyMock(group: nil)
        mock.holdsWrite = true
        let store = mock.makeStore()
        store.loadPreview(link: "https://app.kualia.com/family/join/token")
        mock.previews.send(preview())
        let joining = Task { await store.acceptPreview() }
        while mock.continuation == nil { await Task.yield() }
        store.start(sessionID: "session")
        #expect(store.isSaving)
        #expect(store.preview != nil)
        mock.continuation?.resume()
        let succeeded = await joining.value
        #expect(succeeded)
        #expect(store.notice != nil)
    }

    @Test func previewIsInvalidatedWhenLinkChangesOrSessionEnds() async {
        let mock = FamilyMock(group: nil)
        let store = mock.makeStore()
        store.loadPreview(link: "https://app.kualia.com/family/join/first")
        mock.previews.send(preview())
        #expect(store.preview?.canAccept == true)
        store.clearPreview()
        mock.previews.send(preview())
        #expect(store.preview == nil)
        let accepted = await store.acceptPreview()
        #expect(!accepted)
        store.reset()
        #expect(store.preview == nil)
        #expect(!store.isLoadingPreview)
    }

    @Test func acceptanceUsesPreviewTokenAndCurrentBackendPermission() async {
        let mock = FamilyMock(group: nil)
        let store = mock.makeStore()
        store.loadPreview(link: "https://app.kualia.com/family/join/token")
        mock.previews.send(preview(status: "email_mismatch", canAccept: false))
        let mismatch = await store.acceptPreview()
        #expect(!mismatch)
        mock.previews.send(preview())
        let joined = await store.acceptPreview()
        #expect(joined)
        #expect(mock.changes == [.accept("token")])
    }

    @Test func expiredPreviewCannotJoinEvenIfBackendSnapshotWasAvailable() {
        let preview = FamilyInvitePreview(
            status: "available", canAccept: true,
            familyGroupName: "Family", invitedByName: "Alex", expiresAt: "2026-01-01T00:00:00Z",
            currentFamilyGroup: nil)
        #expect(!preview.canJoin(at: Date(timeIntervalSince1970: 1_800_000_000)))
    }

    @Test func previewFailureDisablesPreviouslyAvailableAcceptance() async {
        let mock = FamilyMock(group: nil)
        let store = mock.makeStore()
        store.loadPreview(link: "https://app.kualia.com/family/join/token")
        mock.previews.send(preview())
        mock.previews.send(completion: .failure(FamilyTestError.offline))
        let joined = await store.acceptPreview()
        #expect(!joined)
        #expect(store.previewError != nil)
    }

    private func preview(status: String = "available", canAccept: Bool = true)
        -> FamilyInvitePreview
    {
        .init(
            status: status, canAccept: canAccept, familyGroupName: "Family", invitedByName: "Alex",
            expiresAt: "2999-01-01T00:00:00Z", currentFamilyGroup: nil)
    }

    private var invite: FamilyInvite {
        .init(
            _id: "invite", invitedEmail: "sam@example.com", invitedName: "Sam", status: "pending",
            expiresAt: "2026-10-01T00:00:00.000Z")
    }

    private func fixture(
        role: String = "owner", memberCount: Int = 1, invites: [FamilyInvite] = [],
        remaining: Int = 10
    ) -> FamilyGroup {
        let members: [FamilyMember] = (0..<memberCount).map { index in
            let id = index == 0 ? "owner" : "member-\(index)"
            let memberRole = index == 0 ? "owner" : "member"
            let isCurrentUser = role == "owner" ? index == 0 : index == 1
            return FamilyMember(
                _id: id, name: "Person \(index)", email: "person\(index)@example.com",
                role: memberRole, isCurrentUser: isCurrentUser, joinedAt: "2026-01-01T00:00:00Z")
        }
        return FamilyGroup(
            _id: "family", name: "Our family", currentUserRole: role, members: members,
            pendingInvites: invites,
            inviteEmailQuota: .init(limit: 10, remaining: remaining, windowEndsAt: nil))
    }
}

private enum FamilyTestError: Error { case offline }

@MainActor
private final class FamilyMock {
    let family: CurrentValueSubject<FamilyGroup?, Error>
    let previews = PassthroughSubject<FamilyInvitePreview, Error>()
    var changes: [FamilyChange] = []
    var error: FamilyTestError?
    var holdsWrite = false
    var continuation: CheckedContinuation<Void, Never>?
    init(group: FamilyGroup?) { family = CurrentValueSubject(group) }
    func makeStore() -> FamilyStore {
        let store = FamilyStore(
            client: .init(
                watch: { self.family.eraseToAnyPublisher() },
                change: { change in
                    self.changes.append(change)
                    if self.holdsWrite {
                        await withCheckedContinuation { self.continuation = $0 }
                    }
                    if let error = self.error { throw error }
                },
                preview: { _ in self.previews.eraseToAnyPublisher() }))
        store.start(sessionID: "session")
        return store
    }
}
