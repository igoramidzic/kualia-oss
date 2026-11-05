import Combine
import ConvexMobile
import Foundation

extension FamilyClient {
    static func live(_ client: ConvexClientWithAuth<String>) -> Self {
        Self(
            watch: {
                client.subscribe(to: "familyGroups:getMine", yielding: FamilyGroup?.self)
                    .mapError { $0 as Error }.receive(on: DispatchQueue.main).eraseToAnyPublisher()
            },
            change: { change in
                do {
                    switch change {
                    case .create:
                        let _: String = try await client.mutation(
                            "familyGroups:createGroup", with: [:])
                    case .invite(let draft):
                        let _: InviteResult = try await client.action(
                            "familyGroups:createInvite",
                            with: [
                                "invitedName": draft.normalizedName,
                                "invitedEmail": draft.normalizedEmail,
                            ])
                    case .remove(let id):
                        let _: RemovedResult = try await client.mutation(
                            "familyGroups:removeMember", with: ["memberId": id])
                    case .revoke(let id):
                        let _: RevokedResult = try await client.mutation(
                            "familyGroups:revokeInvite", with: ["inviteId": id])
                    case .leave:
                        let _: LeftResult = try await client.mutation(
                            "familyGroups:leaveGroup", with: [:])
                    case .accept(let token):
                        let _: AcceptedResult = try await client.mutation(
                            "familyGroups:acceptInvite", with: ["inviteToken": token])
                    }
                } catch {
                    if let clientError = error as? ClientError,
                        case .ConvexError(let data) = clientError,
                        let message = try? JSONDecoder().decode(String.self, from: Data(data.utf8))
                    {
                        throw FamilyOperationError(message: message)
                    }
                    throw FamilyOperationError(
                        message: L10n.string(
                            "Couldn't finish that change. Check your connection and try again.")
                    )
                }
            },
            preview: { token in
                client.subscribe(
                    to: "familyGroups:getInvitePreview", with: ["inviteToken": token],
                    yielding: FamilyInvitePreview.self
                ).mapError { $0 as Error }.receive(on: DispatchQueue.main).eraseToAnyPublisher()
            })
    }
}

private struct InviteResult: Decodable { let invitedEmail: String }
private struct RemovedResult: Decodable { let removed: Bool }
private struct RevokedResult: Decodable { let revoked: Bool }
private struct LeftResult: Decodable { let left: Bool }
private struct AcceptedResult: Decodable { let accepted: Bool }

private struct FamilyOperationError: LocalizedError {
    let message: String
    nonisolated var errorDescription: String? { message }
}
