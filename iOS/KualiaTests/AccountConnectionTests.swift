import Combine
import ConvexMobile
import Foundation
import Testing

@testable import Kualia

@Suite(.serialized)
@MainActor
struct AccountConnectionTests {
    @Test
    func matchingRequiresAnAvailableSourceAndOpenManualAccountInTheSameCategory() {
        let source = Self.source()
        #expect(source.canLink(to: Self.manual))
        #expect(
            source.canLink(
                to: .init(id: "savings", name: "Savings", accountType: "banking_savings")))
        #expect(
            !source.canLink(to: .init(id: "card", name: "Card", accountType: "credit_credit_card")))
        #expect(
            !source.canLink(
                to: .init(
                    id: "closed", name: "Closed", accountType: "banking_checking", isClosed: true)))
        #expect(
            !source.canLink(
                to: .init(
                    id: "deleted", name: "Deleted", accountType: "banking_checking", isDeleted: true
                )))
        #expect(
            !source.canLink(
                to: .init(
                    id: "linked", name: "Linked", accountType: "banking_checking", isLinked: true)))
        #expect(!Self.source(type: "investment_brokerage").isSupported)
        #expect(!Self.source(type: "loan_mortgage").isSupported)
        #expect(Self.source(type: "credit_credit_card").isSupported)
        #expect(!Self.source(provider: "apple_wallet").isSupported)
        var alreadyUsed = source
        alreadyUsed.linkedToBankAccount = .init(id: "another", name: "Another")
        #expect(!alreadyUsed.canLink(to: Self.manual))
    }

    @Test
    func creationExistingMappingAndDisconnectUseDistinctBackendContracts() throws {
        let creation = AccountConnectionMutationRequest(
            workspaceID: "personal", source: Self.source().ref,
            existingAccountID: nil, initialBalanceDate: "2026-09-01")
        #expect(creation.name == "bankConnections:createBankAccountFromConnectionAccount")
        #expect(
            Set(creation.arguments.keys) == [
                "workspaceId", "connectionAccount", "initialBalanceDate",
            ])
        #expect(try creation.arguments["workspaceId"]??.convexEncode() == "\"personal\"")
        #expect(try creation.arguments["initialBalanceDate"]??.convexEncode() == "\"2026-09-01\"")
        let referenceJSON = try creation.arguments["connectionAccount"]??.convexEncode()
        let reference = try #require(referenceJSON)
        #expect(
            try JSONDecoder().decode(
                BankConnectionAccountReference.self, from: Data(reference.utf8))
                == Self.source().ref)

        let mapping = AccountConnectionMutationRequest(
            workspaceID: "personal", source: Self.source().ref,
            existingAccountID: "manual", initialBalanceDate: "2026-09-01")
        #expect(mapping.name == "bankConnections:linkAccount")
        #expect(
            Set(mapping.arguments.keys) == ["workspaceId", "connectionAccount", "bankAccountId"])
        #expect(try mapping.arguments["bankAccountId"]??.convexEncode() == "\"manual\"")

        let disconnect = BankConnectionAccountDisconnectRequest(
            workspaceID: "personal", bankAccountID: "manual")
        #expect(disconnect.name == "bankConnections:unlinkAccount")
        #expect(Set(disconnect.arguments.keys) == ["workspaceId", "bankAccountId"])
        #expect(try disconnect.arguments["workspaceId"]??.convexEncode() == "\"personal\"")
        #expect(try disconnect.arguments["bankAccountId"]??.convexEncode() == "\"manual\"")
    }

    @Test
    func connectionPayloadDecodesExistingMappingsAndSignedProviderBalance() throws {
        let data = Data(
            """
            {"id":"connection","provider":"plaid","displayName":"Bank","logoUrl":null,
             "status":"connected","statusLabel":"Connected","canManageConnection":true,
             "isOwnedByCurrentUser":true,"owner":{"firstName":"Alex","lastName":"Example"},
             "accounts":[{"id":"source","ref":{"provider":"plaid","accountId":"source"},
             "name":"Card","accountType":"credit_credit_card","accountNumberMask":"1234",
             "initialBalance":-12500,"isLinked":true,"hasCompletedInitialSync":false,
             "linkedToBankAccount":{"_id":"manual","name":"Everyday card"}}]}
            """.utf8)
        let connection = try JSONDecoder().decode(BankConnectionSnapshot.self, from: data)
        #expect(connection.ownerName == "Alex Example")
        #expect(connection.canUseAccounts)
        #expect(connection.accounts.first?.initialBalance == -12_500)
        #expect(connection.accounts.first?.linkedToBankAccount?.id == "manual")
        #expect(connection.accounts.first?.hasCompletedInitialSync == false)
    }

    @Test
    func connectionFlowExchangesOnlyAfterAuthorizationAndReturnsToAccountSelection() async {
        var received: [String] = []
        let store = Self.store(
            createToken: { "new-link-token" },
            authorize: { token in
                received.append(token)
                return Self.authorization
            },
            exchange: { workspace, result, date in
                received += [workspace, result.publicToken, result.institutionID, date]
                return "connection"
            })
        store.initialBalanceDate = "2026-09-01"
        store.start()
        await store.connectBank()
        await waitUntil { store.phase == .completed }
        #expect(
            received == [
                "new-link-token", "workspace", "public-token", "institution", "2026-09-01",
            ])
        #expect(store.highlightedConnectionID == "connection")
        #expect(store.phase == .completed)
        #expect(store.completionName == nil)
        #expect(!store.hasSavedAccount)
        store.stop()
    }

    @Test
    func cancellingPlaidDoesNotExchangeOrShowAnError() async {
        var exchanges = 0
        let store = Self.store(
            authorize: { _ in nil },
            exchange: { _, _, _ in
                exchanges += 1
                return "connection"
            })
        store.start()
        await store.connectBank()
        #expect(exchanges == 0)
        #expect(store.errorMessage == nil)
        store.stop()
    }

    @Test(arguments: [false, true])
    func bankSignInFailureRetriesWithAFreshTokenAndClearsTheRetryFlag(
        duringTokenCreation: Bool
    ) async {
        var tokenRequests = 0
        var authorizedTokens: [String] = []
        var retryToken: CheckedContinuation<String, Error>?
        var shouldFail = true
        let store = Self.store(
            createToken: {
                tokenRequests += 1
                if duringTokenCreation && shouldFail { throw AccountStoreError.loadFailed }
                if tokenRequests == 2 {
                    return try await withCheckedThrowingContinuation { retryToken = $0 }
                }
                return "first-token"
            },
            authorize: { token in
                authorizedTokens.append(token)
                if shouldFail { throw AccountStoreError.loadFailed }
                return nil
            })
        store.start()
        await store.connectBank()
        #expect(store.failedDuringBankSignIn)
        #expect(store.errorMessage != nil)
        #expect(store.phase == .idle)

        shouldFail = false
        let retry = Task { await store.connectBank() }
        await waitUntil { retryToken != nil }
        #expect(!store.failedDuringBankSignIn)
        #expect(store.errorMessage == nil)
        #expect(store.phase == .preparing)
        retryToken?.resume(returning: "fresh-token")
        await retry.value
        #expect(tokenRequests == 2)
        #expect(
            authorizedTokens
                == (duringTokenCreation ? ["fresh-token"] : ["first-token", "fresh-token"]))
        #expect(!store.failedDuringBankSignIn)
        #expect(store.phase == .idle)
        store.stop()
    }

    @Test
    func bankConnectionPeekWaitsForItsAccountsInsteadOfAnUnrelatedSnapshot() async {
        let snapshots = CurrentValueSubject<[BankConnectionSnapshot], Error>([])
        let store = AccountConnectionStore(
            workspace: Self.workspace,
            subscription: { _ in snapshots.eraseToAnyPublisher() },
            createToken: { "token" }, authorize: { _ in Self.authorization },
            exchange: { _, _, _ in "new-connection" }, save: { _ in "unused" })
        store.start()
        await store.connectBank()
        snapshots.send([Self.connection()])
        await waitUntil { store.connections.count == 1 }
        #expect(store.phase == .exchanging)
        #expect(store.connectionToReviewID == nil)
        snapshots.send([Self.connection(id: "new-connection")])
        await waitUntil { store.phase == .completed }
        #expect(store.statusTitle == "Connection ready")
        #expect(store.consumeConnectionToReview() == "new-connection")
        #expect(store.consumeConnectionToReview() == nil)
        #expect(store.connections.first?.accounts.first?.hasCompletedInitialSync == false)
        store.stop()
    }

    @Test
    func cancelledCallerClearsBusyPeekAndCannotContinueToAuthorization() async {
        var continuation: CheckedContinuation<String, Error>?
        var authorizations = 0
        let store = Self.store(
            createToken: { try await withCheckedThrowingContinuation { continuation = $0 } },
            authorize: { _ in
                authorizations += 1
                return Self.authorization
            })
        store.start()
        let operation = Task { await store.connectBank() }
        await waitUntil { continuation != nil }
        #expect(store.phase == .preparing)
        operation.cancel()
        continuation?.resume(returning: "late-token")
        await operation.value
        #expect(authorizations == 0)
        #expect(store.phase == .idle)
        #expect(store.errorMessage == nil)
        store.stop()
    }

    @Test
    func stoppingInvalidatesLatePlaidSuccessEvenAfterRestart() async {
        var continuation: CheckedContinuation<PlaidConnectionResult?, Error>?
        var exchanges = 0
        var cancellations = 0
        let store = Self.store(
            authorize: { _ in try await withCheckedThrowingContinuation { continuation = $0 } },
            exchange: { _, _, _ in
                exchanges += 1
                return "late"
            },
            cancelAuthorization: { cancellations += 1 })
        store.start()
        let operation = Task { await store.connectBank() }
        await waitUntil { continuation != nil }
        store.stop()
        store.start()
        continuation?.resume(returning: Self.authorization)
        await operation.value
        #expect(cancellations == 1)
        #expect(exchanges == 0)
        #expect(store.highlightedConnectionID == nil)
        #expect(store.phase == .idle)
        store.stop()
    }

    @Test
    func cancellingAnActionKeepsTheWorkspaceConnectionSubscriptionAlive() async {
        let updates = CurrentValueSubject<[BankConnectionSnapshot], Error>([Self.connection()])
        var requests = 0
        var subscriptionCancellations = 0
        var authorization: CheckedContinuation<PlaidConnectionResult?, Error>?
        var exchanges = 0
        let store = AccountConnectionStore(
            workspace: Self.workspace, purpose: .manageConnections,
            subscription: { _ in
                requests += 1
                return updates.handleEvents(receiveCancel: { subscriptionCancellations += 1 })
                    .eraseToAnyPublisher()
            },
            createToken: { "token" },
            authorize: { _ in
                try await withCheckedThrowingContinuation { authorization = $0 }
            },
            exchange: { _, _, _ in
                exchanges += 1
                return "late"
            },
            save: { _ in "account" })
        store.start()
        await waitUntil { store.hasLoaded }
        let operation = Task { await store.connectBank() }
        await waitUntil { authorization != nil }
        store.cancelActivity()
        authorization?.resume(returning: Self.authorization)
        await operation.value
        #expect(exchanges == 0)
        #expect(store.phase == .idle)
        updates.send([])
        await waitUntil { store.connections.isEmpty }
        #expect(requests == 1)
        #expect(subscriptionCancellations == 0)
        store.stop()
        #expect(subscriptionCancellations == 1)
    }

    @Test
    func workspaceChangeDiscardsTokenBeforeOpeningBankSignIn() async {
        var continuation: CheckedContinuation<String, Error>?
        var isCurrent = true
        var authorizations = 0
        let store = Self.store(
            createToken: { try await withCheckedThrowingContinuation { continuation = $0 } },
            authorize: { _ in
                authorizations += 1
                return Self.authorization
            },
            isWorkspaceCurrent: { isCurrent })
        store.start()
        let operation = Task { await store.connectBank() }
        await waitUntil { continuation != nil }
        isCurrent = false
        continuation?.resume(returning: "old-workspace-token")
        await operation.value
        #expect(authorizations == 0)
        #expect(store.highlightedConnectionID == nil)
        store.stop()
    }

    @Test
    func busyAndAlreadyMappedSourcesCannotBeSubmittedTwice() async {
        var continuation: CheckedContinuation<String, Error>?
        var writes = 0
        let store = Self.store(save: { _ in
            writes += 1
            return try await withCheckedThrowingContinuation { continuation = $0 }
        })
        store.start()
        await waitUntil { store.hasLoaded }
        let operation = Task { await store.save(source: Self.source(), existingAccountID: nil) }
        await waitUntil { continuation != nil }
        #expect(store.phase == .saving)
        #expect(await store.save(source: Self.source(), existingAccountID: nil) == false)
        continuation?.resume(returning: "created")
        #expect(await operation.value)
        #expect(store.phase == .completed)
        #expect(store.connections.first?.accounts.first?.linkedToBankAccount?.id == "created")
        #expect(await store.save(source: Self.source(), existingAccountID: nil) == false)
        #expect(writes == 1)
        store.stop()
    }

    @Test
    func existingAccountMappingPreservesTheAccountNameAndOmitsOpeningBalanceInputs() async {
        var requests: [AccountConnectionMutationRequest] = []
        let store = Self.store(save: { request in
            requests.append(request)
            return "manual"
        })
        store.initialBalanceDate = "invalid-date-is-not-used-for-existing-accounts"
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.save(source: Self.source(), existingAccountID: "manual"))
        #expect(requests.count == 1)
        #expect(requests.first?.name == "bankConnections:linkAccount")
        #expect(requests.first?.arguments.keys.contains("initialBalanceDate") == false)
        #expect(store.completionName == "My everyday account")
        #expect(store.hasSavedAccount)
        store.stop()
    }

    @Test
    func accountDetailsResolveItsConnectionAndDisconnectOnlyThatAccount() async {
        var source = Self.source()
        source.isLinked = true
        source.linkedToBankAccount = .init(id: "manual", name: "My everyday account")
        let linkedAccount = AccountSnapshot(
            id: "manual", name: "My everyday account", accountType: "banking_checking",
            isLinked: true)
        var requests: [BankConnectionAccountDisconnectRequest] = []
        let store = Self.store(
            connections: [Self.connection(accounts: [source])],
            currentAccounts: [linkedAccount], purpose: .accountDetails,
            disconnectAccount: { requests.append($0) })
        store.start()
        await waitUntil { store.hasLoaded }

        let details = store.connectionDetails(for: linkedAccount.id)
        #expect(details?.connection.id == "connection")
        #expect(details?.source.id == source.id)
        #expect(await store.disconnectAccount(id: linkedAccount.id))
        #expect(requests.count == 1)
        #expect(requests.first?.bankAccountID == linkedAccount.id)
        #expect(store.disconnectedAccountID == linkedAccount.id)
        #expect(store.connectionDetails(for: linkedAccount.id) == nil)
        #expect(store.phase == .completed)

        store.acknowledgeAccountState(id: linkedAccount.id, isLinked: false)
        #expect(store.disconnectedAccountID == nil)
        store.stop()
    }

    @Test
    func accountDisconnectFailureKeepsItsConnectionAndCanRetry() async {
        var source = Self.source()
        source.isLinked = true
        source.linkedToBankAccount = .init(id: "manual", name: "My everyday account")
        let linkedAccount = AccountSnapshot(
            id: "manual", name: "My everyday account", accountType: "banking_checking",
            isLinked: true)
        var attempts = 0
        let store = Self.store(
            connections: [Self.connection(accounts: [source])],
            currentAccounts: [linkedAccount], purpose: .accountDetails,
            disconnectAccount: { _ in
                attempts += 1
                if attempts == 1 { throw AccountStoreError.saveFailed }
            })
        store.start()
        await waitUntil { store.hasLoaded }

        #expect(await store.disconnectAccount(id: linkedAccount.id) == false)
        #expect(store.connectionDetails(for: linkedAccount.id)?.source.id == source.id)
        #expect(store.errorMessage != nil)
        #expect(await store.disconnectAccount(id: linkedAccount.id))
        #expect(attempts == 2)
        store.stop()
    }

    @Test
    func sharedUnmanageableAndDisconnectedConnectionsNeverMutate() async {
        for connection in [
            Self.connection(owned: false), Self.connection(manageable: false),
            Self.connection(status: "needs_attention"), Self.connection(status: "disconnected"),
        ] {
            var writes = 0
            let store = Self.store(
                connections: [connection],
                save: { _ in
                    writes += 1
                    return "unexpected"
                })
            store.start()
            await waitUntil { store.hasLoaded }
            #expect(await store.save(source: Self.source(), existingAccountID: nil) == false)
            #expect(writes == 0)
            #expect(store.errorMessage != nil)
            store.stop()
        }
    }

    @Test
    func unsupportedSourcesAndFutureStartDatesCannotCreateAccounts() async {
        var writes = 0
        let unsupported = Self.source(type: "investment_ira")
        let store = Self.store(
            connections: [Self.connection(accounts: [Self.source(), unsupported])],
            save: { _ in
                writes += 1
                return "unexpected"
            })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.save(source: unsupported, existingAccountID: nil) == false)
        store.initialBalanceDate = "2999-01-01"
        #expect(await store.save(source: Self.source(), existingAccountID: nil) == false)
        #expect(writes == 0)
        store.stop()
    }

    @Test
    func missingBankBalanceRequiresAnExistingAccountInsteadOfInventingAnOpeningBalance() async {
        let source = Self.source(balance: nil)
        var requests: [AccountConnectionMutationRequest] = []
        let store = Self.store(
            connections: [Self.connection(accounts: [source])],
            save: { request in
                requests.append(request)
                return "manual"
            })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.save(source: source, existingAccountID: nil) == false)
        #expect(requests.isEmpty)
        #expect(store.errorMessage != nil)
        #expect(await store.save(source: source, existingAccountID: "manual"))
        #expect(requests.count == 1)
        #expect(requests.first?.name == "bankConnections:linkAccount")
        store.stop()
    }

    @Test
    func completionReturnsToIdleAfterSaving() async {
        let store = Self.store(completionDuration: .milliseconds(20))
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.save(source: Self.source(), existingAccountID: nil))
        await waitUntil { store.phase == .idle }
        store.stop()
    }

    @Test
    func oldCompletionTimerCannotResetANewConnectionInProgress() async {
        var continuation: CheckedContinuation<String, Error>?
        let store = Self.store(
            completionDuration: .milliseconds(20),
            createToken: { try await withCheckedThrowingContinuation { continuation = $0 } },
            authorize: { _ in nil })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.save(source: Self.source(), existingAccountID: nil))
        let operation = Task { await store.connectBank() }
        await waitUntil { continuation != nil }
        try? await Task.sleep(for: .milliseconds(50))
        #expect(store.phase == .preparing)
        continuation?.resume(returning: "next-token")
        await operation.value
        store.stop()
    }

    @Test
    func workspaceChangeDiscardsSaveConfirmationAndLocalMapping() async {
        var continuation: CheckedContinuation<String, Error>?
        var isCurrent = true
        let store = Self.store(
            save: { _ in try await withCheckedThrowingContinuation { continuation = $0 } },
            isWorkspaceCurrent: { isCurrent })
        store.start()
        await waitUntil { store.hasLoaded }
        let operation = Task { await store.save(source: Self.source(), existingAccountID: nil) }
        await waitUntil { continuation != nil }
        isCurrent = false
        continuation?.resume(returning: "old-workspace-account")
        #expect(await operation.value == false)
        #expect(store.completionName == nil)
        #expect(store.connections.first?.accounts.first?.isLinked == false)
        store.stop()
    }

    @Test
    func cancelledSaveClearsPeekWithoutPublishingAStaleConfirmation() async {
        var continuation: CheckedContinuation<String, Error>?
        let store = Self.store(
            save: { _ in try await withCheckedThrowingContinuation { continuation = $0 } })
        store.start()
        await waitUntil { store.hasLoaded }
        let operation = Task { await store.save(source: Self.source(), existingAccountID: nil) }
        await waitUntil { continuation != nil }
        operation.cancel()
        continuation?.resume(returning: "created")
        #expect(await operation.value == false)
        #expect(store.phase == .idle)
        #expect(store.completionName == nil)
        #expect(store.connections.first?.accounts.first?.isLinked == false)
        store.stop()
    }

    @Test
    func newConnectionPushesBankDetailsWithTheLibraryUnderneath() {
        var navigation = AccountSetupNavigation(startsWithConnections: false)
        navigation.path.append(.manual)
        #expect(!navigation.showsConnections)
        navigation.path.removeLast()
        #expect(navigation.path.isEmpty)
        navigation.path.append(.connections)
        #expect(navigation.showsConnections)
        navigation.reviewNewConnection("bank")
        #expect(navigation.path == [.connections, .bank("bank")])
        #expect(navigation.bankID == "bank")
        navigation.path.removeLast()
        #expect(navigation.path == [.connections])
        navigation.path.removeLast()
        #expect(!navigation.showsConnections)

        var existingAccountFlow = AccountSetupNavigation(startsWithConnections: true)
        existingAccountFlow.reviewNewConnection("bank")
        #expect(existingAccountFlow.path == [.bank("bank")])
        existingAccountFlow.path.removeLast()
        #expect(existingAccountFlow.showsConnections)
    }

    @Test
    func bankAuthorizationNeverAddsAccountsUntilTheUserChoosesOne() async {
        let checking = Self.source()
        let savings = Self.source(type: "banking_savings")
        var requests: [AccountConnectionMutationRequest] = []
        let store = Self.store(
            connections: [Self.connection(accounts: [checking, savings])],
            save: { request in
                requests.append(request)
                return "added-checking"
            })
        store.start()
        await store.connectBank()
        await waitUntil { store.connectionToReviewID != nil }
        #expect(requests.isEmpty)
        #expect(store.connections.first?.addedAccounts.isEmpty == true)
        #expect(store.connections.first?.unlinkedAccounts.count == 2)
        #expect(store.consumeConnectionToReview() == "connection")

        #expect(await store.save(source: checking, existingAccountID: nil))
        #expect(requests.count == 1)
        #expect(requests.first?.source == checking.ref)
        #expect(requests.first?.name == "bankConnections:createBankAccountFromConnectionAccount")
        #expect(store.connections.first?.addedAccounts.map(\.id) == [checking.id])
        #expect(store.connections.first?.unlinkedAccounts.map(\.id) == [savings.id])
        #expect(store.connectionToReviewID == nil)
        #expect(store.savingSourceID == nil)
        store.stop()
    }

    @Test
    func reviewNavigationWaitsUntilBankSignInReturnsAndDismisses() async {
        var finishSignIn: CheckedContinuation<PlaidConnectionResult?, Error>?
        var exchanges = 0
        let store = Self.store(
            authorize: { _ in
                try await withCheckedThrowingContinuation { finishSignIn = $0 }
            },
            exchange: { _, _, _ in
                exchanges += 1
                return "connection"
            })
        store.start()
        let operation = Task { await store.connectBank() }
        await waitUntil { finishSignIn != nil }
        #expect(store.connectionToReviewID == nil)
        #expect(exchanges == 0)
        finishSignIn?.resume(returning: Self.authorization)
        await operation.value
        await waitUntil { store.connectionToReviewID != nil }
        #expect(exchanges == 1)
        #expect(store.consumeConnectionToReview() == "connection")
        store.stop()
    }

    @Test
    func pendingAndFailedSelectionsDoNotMoveAccountsIntoTheAddedSection() async {
        var finishSave: CheckedContinuation<String, Error>?
        let store = Self.store(save: { _ in
            try await withCheckedThrowingContinuation { finishSave = $0 }
        })
        store.start()
        await waitUntil { store.hasLoaded }
        let operation = Task { await store.save(source: Self.source(), existingAccountID: nil) }
        await waitUntil { finishSave != nil }
        #expect(store.savingSourceID == Self.source().id)
        #expect(store.connections.first?.addedAccounts.isEmpty == true)
        finishSave?.resume(throwing: AccountStoreError.saveFailed)
        #expect(await operation.value == false)
        #expect(store.savingSourceID == nil)
        #expect(store.connections.first?.unlinkedAccounts.count == 1)
        #expect(store.errorMessage != nil)
        store.stop()
    }

    @Test
    func staleManualSnapshotCannotLinkTheSameDestinationToTwoBankAccounts() async {
        var writes = 0
        let checking = Self.source()
        let savings = Self.source(type: "banking_savings")
        let store = Self.store(
            connections: [Self.connection(accounts: [checking, savings])],
            save: { _ in
                writes += 1
                return "manual"
            })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.save(source: checking, existingAccountID: "manual"))
        #expect(await store.save(source: savings, existingAccountID: "manual") == false)
        #expect(writes == 1)
        #expect(store.connections.first?.unlinkedAccounts.map(\.id) == [savings.id])
        store.stop()
    }

    @Test
    func peekStaysOnBankDetailsButOnlyShowsConnectionProgressOnTheLibrary() {
        var navigation = AccountSetupNavigation(startsWithConnections: false)
        let phases: [AccountConnectionPhase] = [
            .idle, .preparing, .authorizing, .exchanging, .saving, .completed,
        ]
        for phase in phases { #expect(!navigation.showsPeek(during: phase)) }
        navigation.path = [.connections]
        for phase in phases {
            #expect(
                navigation.showsPeek(during: phase)
                    == (phase == .preparing || phase == .authorizing || phase == .exchanging))
        }
        navigation.path.append(.bank("bank"))
        for phase in phases { #expect(navigation.showsPeek(during: phase)) }
        navigation.path.removeLast()
        #expect(!navigation.showsPeek(during: .completed))
        #expect(!navigation.showsPeek(during: .idle))
    }

    @Test
    func accountAdditionChangesPeekToneWithoutDismissingItsSurface() {
        var navigation = AccountSetupNavigation(startsWithConnections: false)
        navigation.reviewNewConnection("bank")
        for phase in [AccountConnectionPhase.idle, .saving, .completed] {
            let presentation = AccountConnectionPeekPresentation(
                phase: phase, completionName: phase == .idle ? nil : "Checking",
                connection: Self.connection(), isLinkingExisting: false)
            #expect(navigation.showsPeek(during: phase))
            #expect(presentation.isPositive == (phase != .idle))
            #expect(presentation.showsProgress == (phase == .saving))
            #expect(presentation.canFinish == (phase != .saving))
        }
        let bankReady = AccountConnectionPeekPresentation(
            phase: .completed, completionName: nil, connection: Self.connection(),
            isLinkingExisting: false)
        #expect(!bankReady.isPositive)
    }

    @Test
    func addingAMiddleAccountPreservesEveryRowAndItsBalance() async {
        let accounts = [
            Self.source(type: "banking_savings"), Self.source(),
            Self.source(type: "credit_credit_card"),
        ]
        let store = Self.store(connections: [Self.connection(accounts: accounts)])
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(await store.save(source: accounts[1], existingAccountID: nil))
        let updated = store.connections.first?.accounts ?? []
        #expect(updated.map(\.id) == accounts.map(\.id))
        #expect(updated.map(\.initialBalance) == accounts.map(\.initialBalance))
        #expect(updated.map(\.isAddedToWorkspace) == [false, true, false])
        store.stop()
    }

    @Test
    func multipleAccountsCanBeAddedWhileTheBankPeekRemainsOpen() async {
        let accounts = [Self.source(), Self.source(type: "banking_savings")]
        var writes = 0
        let store = Self.store(
            connections: [Self.connection(accounts: accounts)],
            save: { _ in
                writes += 1
                return "created-\(writes)"
            })
        var navigation = AccountSetupNavigation(startsWithConnections: false)
        navigation.reviewNewConnection("connection")
        store.start()
        await waitUntil { store.hasLoaded }

        for (index, account) in accounts.enumerated() {
            #expect(await store.save(source: account, existingAccountID: nil))
            #expect(store.hasSavedAccount)
            #expect(store.connections.first?.addedAccounts.count == index + 1)
            #expect(navigation.bankID == "connection")
            #expect(navigation.showsPeek(during: store.phase))
            let presentation = AccountConnectionPeekPresentation(
                phase: store.phase, completionName: store.completionName,
                connection: store.connections.first, isLinkingExisting: false)
            #expect(presentation.canFinish)
        }
        #expect(writes == 2)
        store.stop()
    }

    @Test
    func retirementAccountRemainsVisibleButCannotBeAdded() async {
        let retirement = Self.source(type: "investment_401k")
        var writes = 0
        let store = Self.store(
            connections: [Self.connection(accounts: [retirement])],
            save: { _ in
                writes += 1
                return "unexpected"
            })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(store.connections.first?.accounts.first?.id == retirement.id)
        #expect(!retirement.isSupported)
        #expect(await store.save(source: retirement, existingAccountID: nil) == false)
        #expect(writes == 0)
        store.stop()
    }

    @Test
    func settingsKeepsAllProvidersAndCannotCreateOrLinkAccounts() async {
        // The facade's Wallet payload shares the same contract, including account mappings.
        let wallet = BankConnectionSnapshot(
            id: "wallet", provider: "apple_wallet", displayName: "Apple Wallet", logoUrl: nil,
            status: "connected", statusLabel: "Connected", canManageConnection: true,
            isOwnedByCurrentUser: true, accounts: [Self.source(provider: "apple_wallet")])
        var writes = 0
        let store = Self.store(
            connections: [Self.connection(), wallet], purpose: .manageConnections,
            save: { _ in
                writes += 1
                return "unexpected"
            })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(store.connections.map(\.id) == ["connection", "wallet"])
        #expect(await store.save(source: Self.source(), existingAccountID: nil) == false)
        #expect(await store.save(source: Self.source(), existingAccountID: "manual") == false)
        #expect(writes == 0)
        store.stop()
    }

    @Test
    func settingsConnectionOnlyExchangesTheBankAndOpensItsReview() async {
        var writes = 0
        let store = Self.store(
            purpose: .manageConnections,
            save: { _ in
                writes += 1
                return "unexpected"
            })
        store.start()
        await store.connectBank()
        await waitUntil { store.connectionToReviewID != nil }
        #expect(store.consumeConnectionToReview() == "connection")
        #expect(store.completionName == nil)
        #expect(writes == 0)
        #expect(store.statusDetail.contains("Choose the accounts"))
        store.stop()
    }

    @Test
    func repairUpdatesExistingConnectionWithoutExchangingOrChangingMappings() async {
        var source = Self.source()
        source.isLinked = true
        source.linkedToBankAccount = .init(id: "existing", name: "Everyday")
        var repairs: [String] = []
        var exchanges = 0
        let store = Self.store(
            connections: [Self.connection(status: "needs_attention", accounts: [source])],
            purpose: .manageConnections,
            exchange: { _, _, _ in
                exchanges += 1
                return "unexpected"
            },
            createRepairToken: { id in
                #expect(id == "connection")
                return "update-token"
            },
            completeRepair: { repairs.append($0) })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.repairConnection(id: "connection")
        #expect(repairs == ["connection"])
        #expect(exchanges == 0)
        #expect(store.phase == .completed)
        #expect(store.connectionToReviewID == nil)
        #expect(store.connections.first?.accounts == [source])
        // A successful authorization is not proof that a fresh bank sync completed.
        #expect(store.connections.first?.health == .needsAttention)
        #expect(store.statusTitle == "Bank sign-in updated")
        store.stop()
    }

    @Test
    func repairCancellationDoesNotConfirmOrExchange() async {
        var completions = 0
        let store = Self.store(
            connections: [Self.connection(status: "needs_attention")], purpose: .manageConnections,
            authorize: { _ in nil }, createRepairToken: { _ in "update" },
            completeRepair: { _ in completions += 1 })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.repairConnection(id: "connection")
        #expect(store.phase == .idle)
        #expect(store.errorMessage == nil)
        #expect(completions == 0)
        store.stop()
    }

    @Test
    func onlyAnOwnedManageableUnhealthyPlaidConnectionCanBeRepaired() async {
        for bank in [
            Self.connection(owned: false, status: "needs_attention"),
            Self.connection(manageable: false, status: "needs_attention"),
            Self.connection(status: "connected"), Self.connection(status: "pending"),
            Self.connection(status: "disconnected"), Self.connection(status: "future-status"),
        ] {
            var tokens = 0
            let store = Self.store(
                connections: [bank], purpose: .manageConnections,
                createRepairToken: { _ in
                    tokens += 1
                    return "unexpected"
                })
            store.start()
            await waitUntil { store.hasLoaded }
            await store.repairConnection(id: bank.id)
            #expect(tokens == 0)
            #expect(store.phase == .idle)
            store.stop()
        }
        let wallet = BankConnectionSnapshot(
            id: "wallet", provider: "apple_wallet", displayName: "Wallet", logoUrl: nil,
            status: "needs_attention", statusLabel: "Needs attention", canManageConnection: true,
            isOwnedByCurrentUser: true, accounts: [])
        #expect(!wallet.canRepair)
    }

    @Test
    func workspaceChangeAndStoppingDiscardPendingRepairBeforeBankSignIn() async {
        for stopsStore in [true, false] {
            var pending: CheckedContinuation<String, Error>?
            var current = true
            var authorizations = 0
            let store = Self.store(
                connections: [Self.connection(status: "needs_attention")],
                purpose: .manageConnections,
                authorize: { _ in
                    authorizations += 1
                    return Self.authorization
                },
                createRepairToken: { _ in
                    try await withCheckedThrowingContinuation { pending = $0 }
                }, isWorkspaceCurrent: { current })
            store.start()
            await waitUntil { store.hasLoaded }
            let operation = Task { await store.repairConnection(id: "connection") }
            await waitUntil { pending != nil }
            if stopsStore { store.stop() } else { current = false }
            pending?.resume(returning: "stale-token")
            await operation.value
            #expect(authorizations == 0)
            #expect(store.highlightedConnectionID == nil)
            store.stop()
        }
    }

    @Test
    func repairFailureRetainsHealthAndAllowsRetry() async {
        var attempts = 0
        let store = Self.store(
            connections: [Self.connection(status: "needs_attention")], purpose: .manageConnections,
            createRepairToken: { _ in "update-token" },
            completeRepair: { _ in
                attempts += 1
                if attempts == 1 { throw AccountStoreError.saveFailed }
            })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.repairConnection(id: "connection")
        #expect(store.phase == .idle)
        #expect(store.errorMessage != nil)
        #expect(store.connections.first?.health == .needsAttention)
        await store.repairConnection(id: "connection")
        #expect(attempts == 2)
        #expect(store.phase == .completed)
        store.stop()
    }

    @Test func reviewCardsOnlyIncludeConnectionsThatNeedAttention() {
        #expect(Self.connection().review == nil)
        #expect(Self.connection(status: "pending").review == nil)
        #expect(Self.connection(status: "disconnected").review == .disconnected)
        #expect(Self.connection(status: "needs_attention").review == .needsAttention)
        #expect(Self.connection(status: "unknown").review == .unavailable)
        #expect(Self.connection(owned: false, status: "disconnected").review == .disconnected)
    }

    @Test
    func liveReauthorizationPayloadShowsReviewWithoutDisablingLinkedAccounts() throws {
        for reason in ["consent_expiring", "connection_expiring"] {
            let payload = """
                {"id":"connection","provider":"plaid","displayName":"Bank","status":"connected",
                 "statusLabel":"Connected","canManageConnection":true,"isOwnedByCurrentUser":true,
                 "accounts":[],"reauthorization":{"reason":"\(reason)",
                 "requiredBy":"2026-09-19T12:00:00.000Z","providerReason":"INSTITUTION_TOKEN_EXPIRATION"}}
                """
            let bank = try JSONDecoder().decode(
                BankConnectionSnapshot.self, from: Data(payload.utf8))
            #expect(bank.review == .reauthorizationSoon)
            #expect(bank.health == .connected)
            #expect(bank.canUseAccounts)
            #expect(bank.canRepair)
            #expect(bank.canReauthorize)
            #expect(bank.reauthorization?.requiredBy == "2026-09-19T12:00:00.000Z")
            #expect(BankConnectionsOverview(connections: [bank]).reviewCount == 1)
        }
    }

    @Test
    func reauthorizationPayloadIsBackwardCompatibleAndKeepsMoreSevereReviews() throws {
        let base = """
            {"id":"connection","provider":"plaid","displayName":"Bank","status":"pending",
             "statusLabel":"Pending","canManageConnection":true,"isOwnedByCurrentUser":true,"accounts":[]
            """
        for suffix in [
            "}", ",\"reauthorization\":null}",
            ",\"reauthorization\":{\"reason\":\"future_reason\"}}",
        ] {
            let bank = try JSONDecoder().decode(
                BankConnectionSnapshot.self, from: Data((base + suffix).utf8))
            #expect(bank.review == nil)
        }
        for (status, expected) in [
            ("disconnected", BankConnectionReview.disconnected),
            ("needs_attention", .needsAttention), ("unknown", .unavailable),
        ] {
            var bank = Self.connection(status: status)
            bank.reauthorization = .init(reason: "consent_expiring")
            #expect(bank.review == expected)
        }
        var shared = Self.connection(owned: false)
        shared.reauthorization = .init(reason: "consent_expiring")
        #expect(shared.review == .reauthorizationSoon)
        #expect(!shared.canRepair)
        #expect(!shared.canReauthorize)
    }

    @Test
    func repairingUpcomingReauthorizationUsesUpdateModeOnTheExistingConnection() async {
        var bank = Self.connection()
        bank.reauthorization = .init(reason: "connection_expiring")
        var repaired: [String] = []
        var exchanged = false
        let store = Self.store(
            connections: [bank], purpose: .manageConnections,
            exchange: { _, _, _ in
                exchanged = true
                return "new-item"
            },
            completeRepair: { repaired.append($0) })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.repairConnection(id: bank.id)
        #expect(repaired == [bank.id])
        #expect(!exchanged)
        #expect(store.phase == .completed)
        store.stop()
    }

    @Test
    func overviewDistinguishesConnectionHealthFromLinkedAccountAndImportStatus() {
        var linked = Self.source()
        linked.isLinked = true
        linked.hasCompletedInitialSync = false
        let connected = Self.connection(accounts: [linked, Self.source(type: "banking_savings")])
        let overview = BankConnectionsOverview(connections: [
            connected, Self.connection(status: "pending"),
            Self.connection(status: "needs_attention"),
            Self.connection(status: "disconnected"), Self.connection(status: "new-provider-status"),
        ])
        #expect(overview.connectedCount == 1)
        #expect(overview.reviewCount == 3)
        #expect(overview.linkedAccountCount == 1)
        #expect(overview.title == "A little attention needed.")
        #expect(BankConnectionsOverview(connections: [connected]).title == "You're well connected.")
        #expect(
            BankConnectionsOverview(connections: [Self.connection(status: "pending")]).title
                == "Getting connected.")
        #expect(BankConnectionsOverview(connections: []).connectedCount == 0)
    }

    @Test
    func syncDatesSupportBothServerTimestampFormatsAndMissingData() throws {
        var bank = Self.connection()
        #expect(bank.lastSyncDate == nil)
        bank.lastSyncedAt = "2026-09-07T10:30:00.000Z"
        let milliseconds = try #require(bank.lastSyncDate)
        bank.lastSyncedAt = "2026-09-07T10:30:00Z"
        #expect(bank.lastSyncDate != nil)
        #expect(bank.lastSyncDate == milliseconds)
        bank.lastSyncedAt = "2026-09-07T06:30:00-04:00"
        #expect(bank.lastSyncDate == milliseconds)
        bank.lastSyncedAt = "2026-09-07T10:30:00.123Z"
        let fractional = try #require(bank.lastSyncDate)
        #expect(abs(fractional.timeIntervalSince(milliseconds) - 0.123) < 0.000001)
        bank.lastSyncedAt = "unavailable"
        #expect(bank.lastSyncDate == nil)
        bank.lastSyncedAt = ""
        #expect(bank.lastSyncDate == nil)
    }

    @Test
    func liveDisconnectionDuringRepairPreventsConfirmationAndDuplicateSignIn() async {
        let updates = CurrentValueSubject<[BankConnectionSnapshot], Error>([
            Self.connection(status: "needs_attention")
        ])
        var authorization: CheckedContinuation<PlaidConnectionResult?, Error>?
        var tokenRequests = 0
        var completions = 0
        let store = AccountConnectionStore(
            workspace: Self.workspace, purpose: .manageConnections,
            subscription: { _ in updates.eraseToAnyPublisher() },
            createToken: { "new-token" },
            authorize: { _ in
                try await withCheckedThrowingContinuation { authorization = $0 }
            },
            exchange: { _, _, _ in "unexpected" }, save: { _ in "unexpected" },
            createRepairToken: { _ in
                tokenRequests += 1
                return "update-token"
            },
            completeRepair: { _ in completions += 1 })
        store.start()
        await waitUntil { store.hasLoaded }
        let operation = Task { await store.repairConnection(id: "connection") }
        await waitUntil { authorization != nil }
        await store.repairConnection(id: "connection")
        #expect(tokenRequests == 1)
        updates.send([Self.connection(status: "disconnected")])
        await waitUntil { store.connections.first?.health == .disconnected }
        authorization?.resume(returning: Self.authorization)
        await operation.value
        #expect(completions == 0)
        #expect(store.phase == .idle)
        store.stop()
    }

    @Test
    func settingsPeekAndLeaveConfirmationFollowEveryConnectionPhase() {
        for phase in [AccountConnectionPhase.preparing, .authorizing, .exchanging, .saving] {
            let presentation = BankConnectionActivityPresentation(phase: phase, hasError: false)
            #expect(presentation.showsPeek)
            #expect(presentation.requiresLeaveConfirmation)
        }
        let completed = BankConnectionActivityPresentation(phase: .completed, hasError: false)
        #expect(completed.showsPeek)
        #expect(!completed.requiresLeaveConfirmation)
        let idle = BankConnectionActivityPresentation(phase: .idle, hasError: false)
        #expect(!idle.showsPeek)
        #expect(!idle.requiresLeaveConfirmation)
        let failed = BankConnectionActivityPresentation(phase: .idle, hasError: true)
        #expect(failed.showsPeek)
        #expect(!failed.requiresLeaveConfirmation)
        #expect(
            BankConnectionActivityPresentation(phase: .exchanging, hasError: false)
                .leaveMessage.contains("may still finish"))
        #expect(
            BankConnectionActivityPresentation(phase: .authorizing, hasError: false)
                .leaveMessage.contains("isn't finished"))
    }

    @Test
    func confirmedLeaveDuringExchangeDiscardsLateNavigationAndAllowsReopening() async {
        var exchange: CheckedContinuation<String, Error>?
        let store = Self.store(
            purpose: .manageConnections,
            exchange: { _, _, _ in
                try await withCheckedThrowingContinuation { exchange = $0 }
            })
        store.start()
        let operation = Task { await store.connectBank() }
        await waitUntil { exchange != nil }
        #expect(store.phase == .exchanging)
        store.stop()
        store.start()
        exchange?.resume(returning: "connection")
        await operation.value
        #expect(store.phase == .idle)
        #expect(store.connectionToReviewID == nil)
        #expect(store.highlightedConnectionID == nil)
        #expect(store.completionName == nil)
        store.stop()
    }

    @Test
    func settingsConnectionHandsOffToAccountCreationWithoutAnotherBankSignIn() async {
        let updates = CurrentValueSubject<[BankConnectionSnapshot], Error>([])
        var authorizations = 0
        var requests: [AccountConnectionMutationRequest] = []
        func makeStore(purpose: AccountConnectionPurpose) -> AccountConnectionStore {
            AccountConnectionStore(
                workspace: Self.workspace, purpose: purpose,
                subscription: { _ in updates.eraseToAnyPublisher() },
                createToken: { "token" },
                authorize: { _ in
                    authorizations += 1
                    return Self.authorization
                },
                exchange: { _, _, _ in
                    updates.send([
                        Self.connection(accounts: [
                            Self.source(), Self.source(type: "banking_savings"),
                        ])
                    ])
                    return "connection"
                },
                save: { request in
                    requests.append(request)
                    var banks = updates.value
                    banks[0].accounts[0].isLinked = true
                    banks[0].accounts[0].linkedToBankAccount = .init(
                        id: "created", name: "Bank checking")
                    updates.send(banks)
                    return "created"
                })
        }
        let overview = makeStore(purpose: .manageConnections)
        overview.start()
        await overview.connectBank()
        await waitUntil { overview.connectionToReviewID != nil }
        let bankID = overview.consumeConnectionToReview()
        #expect(bankID == "connection")
        #expect(requests.isEmpty)

        let picker = makeStore(purpose: .addAccounts)
        picker.start()
        await waitUntil { picker.hasLoaded }
        #expect(picker.connections.first?.id == bankID)
        picker.initialBalanceDate = "2026-09-01"
        #expect(await picker.save(source: Self.source(), existingAccountID: nil))
        await waitUntil { overview.connections.first?.addedAccounts.count == 1 }
        #expect(authorizations == 1)
        #expect(requests.count == 1)
        #expect(requests.first?.name == "bankConnections:createBankAccountFromConnectionAccount")
        #expect(requests.first?.initialBalanceDate == "2026-09-01")
        #expect(
            overview.connections.first?.addedAccounts.first?.linkedToBankAccount?.id == "created")
        #expect(picker.connections.first?.unlinkedAccounts.count == 1)
        #expect(await picker.save(source: Self.source(), existingAccountID: nil) == false)
        picker.stop()
        overview.stop()
    }

    @Test
    func reconnectCanReauthorizeAHealthyConnectionWithoutCreatingADuplicate() async {
        var completed: [String] = []
        var exchanged = 0
        let store = Self.store(
            purpose: .manageConnections,
            exchange: { _, _, _ in
                exchanged += 1
                return "unexpected"
            },
            completeRepair: { completed.append($0) })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.reconnectConnection(id: "connection")
        #expect(completed == ["connection"])
        #expect(exchanged == 0)
        #expect(store.phase == .completed)
        #expect(store.connectionToReviewID == nil)
        store.stop()
    }

    @Test
    func reconnectingDisconnectedBankStartsNewConnectionForAccountSelection() async {
        var repaired = 0
        let store = Self.store(
            connections: [Self.connection(status: "disconnected")], purpose: .manageConnections,
            completeRepair: { _ in repaired += 1 })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.reconnectConnection(id: "connection")
        await waitUntil { store.connectionToReviewID != nil }
        #expect(store.consumeConnectionToReview() == "connection")
        #expect(repaired == 0)
        store.stop()
    }

    @Test
    func disconnectUsesTheProviderNeutralActionAndRemovesOnlyTheSelectedConnection() async throws {
        var requests: [BankConnectionDisconnectRequest] = []
        let store = Self.store(
            connections: [Self.connection(), Self.connection(id: "other")],
            purpose: .manageConnections,
            disconnect: { requests.append($0) })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.disconnectConnection(id: "connection")
        let request = try #require(requests.first)
        #expect(request.name == "bankConnections:disconnectConnection")
        #expect(Set(request.arguments.keys) == ["workspaceId", "connection"])
        #expect(request.workspaceID == "workspace")
        #expect(request.connection == .init(provider: "plaid", connectionId: "connection"))
        let encoded = try request.connection.convexEncode()
        #expect(
            try JSONDecoder().decode(BankConnectionReference.self, from: Data(encoded.utf8))
                == request.connection)
        #expect(store.connections.map(\.id) == ["other"])
        #expect(store.disconnectedConnectionID == "connection")
        #expect(store.statusTitle == "Connection disconnected")
        #expect(store.statusDetail.contains("accounts and history"))
        store.stop()
    }

    @Test
    func sharedAndUnmanageableConnectionsCannotBeDisconnectedOrReconnected() async {
        for bank in [Self.connection(owned: false), Self.connection(manageable: false)] {
            var actions = 0
            let store = Self.store(
                connections: [bank], purpose: .manageConnections,
                createRepairToken: { _ in
                    actions += 1
                    return "unexpected"
                },
                disconnect: { _ in actions += 1 })
            store.start()
            await waitUntil { store.hasLoaded }
            await store.disconnectConnection(id: bank.id)
            await store.reconnectConnection(id: bank.id)
            #expect(actions == 0)
            #expect(store.disconnectedConnectionID == nil)
            #expect(!bank.canDisconnect)
            #expect(!bank.canReconnect)
            store.stop()
        }
    }

    @Test
    func disconnectFailureKeepsTheConnectionAndAllowsRetry() async {
        var attempts = 0
        let store = Self.store(
            purpose: .manageConnections,
            disconnect: { _ in
                attempts += 1
                if attempts == 1 { throw AccountStoreError.saveFailed }
            })
        store.start()
        await waitUntil { store.hasLoaded }
        await store.disconnectConnection(id: "connection")
        #expect(store.connections.count == 1)
        #expect(store.errorMessage != nil)
        #expect(store.disconnectedConnectionID == nil)
        #expect(store.phase == .idle)
        await store.disconnectConnection(id: "connection")
        #expect(attempts == 2)
        #expect(store.connections.isEmpty)
        #expect(store.errorMessage == nil)
        store.stop()
    }

    @Test
    func pendingDisconnectRejectsDuplicateActionsAndIgnoresCompletionAfterLeaving() async {
        var pending: CheckedContinuation<Void, Error>?
        var calls = 0
        let store = Self.store(
            purpose: .manageConnections,
            disconnect: { _ in
                calls += 1
                try await withCheckedThrowingContinuation { pending = $0 }
            })
        store.start()
        await waitUntil { store.hasLoaded }
        let operation = Task { await store.disconnectConnection(id: "connection") }
        await waitUntil { pending != nil }
        #expect(store.phase == .disconnecting)
        let activity = BankConnectionActivityPresentation(phase: store.phase, hasError: false)
        #expect(activity.showsPeek)
        #expect(activity.requiresLeaveConfirmation)
        #expect(activity.leaveMessage.contains("may still finish"))
        await store.disconnectConnection(id: "connection")
        #expect(calls == 1)
        store.stop()
        pending?.resume()
        await operation.value
        #expect(store.disconnectedConnectionID == nil)
        #expect(store.phase == .idle)
        #expect(store.connections.count == 1)
    }

    @Test
    func walletDisconnectUsesItsProviderAndCannotOpenPlaidReconnect() async {
        let wallet = BankConnectionSnapshot(
            id: "wallet", provider: "apple_wallet", displayName: "Wallet", logoUrl: nil,
            status: "connected", statusLabel: "Connected", canManageConnection: true,
            isOwnedByCurrentUser: true, accounts: [])
        var requests: [BankConnectionDisconnectRequest] = []
        let store = Self.store(
            connections: [wallet], purpose: .manageConnections,
            disconnect: { requests.append($0) })
        store.start()
        await waitUntil { store.hasLoaded }
        #expect(!wallet.canReconnect)
        #expect(wallet.canDisconnect)
        #expect(wallet.disconnectMessage.contains("this workspace"))
        #expect(Self.connection().disconnectMessage.contains("every workspace"))
        await store.disconnectConnection(id: "wallet")
        #expect(requests.first?.connection.provider == "apple_wallet")
        #expect(store.connections.isEmpty)
        store.stop()
    }

    @Test
    func peekKeepsLoadingContentWhileClosingAndNeverTreatsIdleAsSuccess() {
        let loading = BankConnectionStatusSnapshot(
            phase: .authorizing, title: "Over to your bank", detail: "Finish sign-in", error: nil)
        let idle = BankConnectionStatusSnapshot(
            phase: .idle, title: "Your bank connections", detail: "Overview", error: nil)
        #expect(idle.indicator == .idle)
        #expect(idle.retainingDuringDismissal(loading, isPresented: false) == loading)
        #expect(idle.retainingDuringDismissal(nil, isPresented: false) == idle)
    }

    @Test
    func reopeningPeekImmediatelyUsesLoadingInsteadOfRetainedSuccess() {
        let completed = BankConnectionStatusSnapshot(
            phase: .completed, title: "Connection ready", detail: "Choose accounts", error: nil)
        let opening = BankConnectionStatusSnapshot(
            phase: .preparing, title: "Opening secure bank sign-in", detail: "Preparing", error: nil
        )
        #expect(completed.indicator == .success)
        #expect(opening.retainingDuringDismissal(completed, isPresented: true) == opening)
        #expect(opening.indicator == .progress)
        let failure = BankConnectionStatusSnapshot(
            phase: .idle, title: "Idle", detail: "Overview", error: "Please retry")
        #expect(failure.indicator == .error)
        #expect(failure.detail == "Please retry")
        let accounts = BankConnectionStatusSnapshot(
            phase: .idle, title: "Idle", detail: "Overview", error: nil, isLoadingAccounts: true)
        #expect(accounts.indicator == .progress)
    }

    private static let workspace = TransactionFeedWorkspace(
        id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
        timezoneIdentifier: "America/New_York")
    private static let manual = AccountSnapshot(
        id: "manual", name: "My everyday account", accountType: "banking_checking")
    private static let authorization = PlaidConnectionResult(
        publicToken: "public-token", institutionID: "institution", institutionName: "Bank",
        accounts: [
            .init(
                id: "plaid-account", name: "Checking", type: "depository", subtype: "checking",
                mask: "1234")
        ])

    private static func source(
        type: String = "banking_checking", provider: String = "plaid", balance: Int64? = 12_500
    )
        -> BankConnectionAccount
    {
        .init(
            id: type, ref: .init(provider: provider, accountId: type), name: "Bank checking",
            accountType: type, accountNumberMask: "1234", initialBalance: balance,
            isLinked: false, linkedToBankAccount: nil, hasCompletedInitialSync: false)
    }

    private static func connection(
        id: String = "connection",
        owned: Bool = true, manageable: Bool = true, status: String = "connected",
        accounts: [BankConnectionAccount]? = nil
    ) -> BankConnectionSnapshot {
        .init(
            id: id, provider: "plaid", displayName: "Bank", logoUrl: nil,
            status: status, statusLabel: status, canManageConnection: manageable,
            isOwnedByCurrentUser: owned, accounts: accounts ?? [source()], owner: nil)
    }

    private static func store(
        connections: [BankConnectionSnapshot]? = nil,
        currentAccounts: [AccountSnapshot]? = nil,
        completionDuration: Duration = .seconds(3),
        purpose: AccountConnectionPurpose = .addAccounts,
        createToken: @escaping () async throws -> String = { "token" },
        authorize: @escaping AccountConnectionStore.Authorize = { _ in authorization },
        exchange: @escaping AccountConnectionStore.Exchange = { _, _, _ in "connection" },
        save: @escaping AccountConnectionStore.Save = { _ in "created" },
        createRepairToken: @escaping (String) async throws -> String = { _ in "update-token" },
        completeRepair: @escaping (String) async throws -> Void = { _ in },
        disconnect: @escaping AccountConnectionStore.Disconnect = { _ in },
        disconnectAccount: @escaping AccountConnectionStore.DisconnectAccount = { _ in },
        cancelAuthorization: @escaping () -> Void = {},
        isWorkspaceCurrent: @escaping () -> Bool = { true }
    ) -> AccountConnectionStore {
        AccountConnectionStore(
            workspace: workspace, purpose: purpose, completionDuration: completionDuration,
            subscription: { _ in
                Just(connections ?? [connection()]).setFailureType(to: Error.self)
                    .eraseToAnyPublisher()
            },
            createToken: createToken, authorize: authorize, exchange: exchange, save: save,
            createRepairToken: createRepairToken, completeRepair: completeRepair,
            disconnect: disconnect, disconnectAccount: disconnectAccount,
            cancelAuthorization: cancelAuthorization,
            currentAccounts: { currentAccounts ?? [manual] },
            isWorkspaceCurrent: isWorkspaceCurrent)
    }

    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<100 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        #expect(condition())
    }
}
