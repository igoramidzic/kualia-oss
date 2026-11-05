import Combine
import ConvexMobile
import Foundation
import Testing

@testable import Kualia

@MainActor
struct MerchantsTests {
    @Test
    func immediateLogoWritesContainNoUnsavedNameOrAccountFields() throws {
        for entity in ["merchant", "bankAccount"] {
            let request = EntityLogoUpdateRequest(
                workspaceID: "workspace", entityID: "entity", entityType: entity, choice: .remove)
            #expect(
                Set(request.arguments.keys)
                    == Set([
                        "workspaceId", entity == "merchant" ? "merchantId" : "bankAccountId",
                        "logoUrl",
                    ]))
            #expect(try request.arguments["logoUrl"]??.convexEncode() == "null")
            #expect(
                request.function
                    == (entity == "merchant"
                        ? "merchants:updateMerchant" : "bankAccounts:updateBankAccount"))
        }
    }

    @Test
    func acceptingAnAutosavedLogoPreservesOtherAccountEditsWithoutDirtyingTheLogo() {
        var account = AccountSnapshot(id: "a", name: "Original", accountType: "banking_checking")
        var draft = AccountDraft(account: account)
        var baseline = draft
        draft.name = "Unsaved name"
        draft.notes = "Unsaved notes"
        account.logoUrl = "https://example.com/new.png"
        account.resolvedLogoUrl = account.logoUrl
        draft.acceptSavedLogo(from: account)
        baseline.acceptSavedLogo(from: account)
        #expect(draft.name == "Unsaved name")
        #expect(draft.notes == "Unsaved notes")
        #expect(baseline.name == "Original")
        #expect(draft.logoChoice == .unchanged)
        #expect(draft.logoUrl == baseline.logoUrl)
        let request = AccountMutationRequest(workspaceID: "w", operation: .update(account, draft))
        #expect(!request.arguments.keys.contains("logoUrl"))
    }

    @Test
    func automaticLogoSaveReportsFailuresAndAllowsRetry() async {
        var calls = 0
        let saver = EntityLogoSaveStore { _ in
            calls += 1
            if calls == 1 { throw SearchFailure.failed }
        }
        #expect(await saver.save(.reset) == false)
        #expect(saver.error != nil)
        #expect(!saver.isSaving)
        #expect(await saver.save(.reset))
        #expect(saver.error == nil)
        #expect(calls == 2)
    }

    @Test
    func resetKeepsTheResolvedDefaultWhenTheSubscriptionArrivesBeforeSaveCompletes() throws {
        var value = try merchant()
        value.logoUrl = "https://img.logo.dev/example.com?token=public-display-token"
        value.globalMerchantLogoUrl = "https://img.logo.dev/example.com"
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD", minorUnit: 2,
            client: .init(
                watch: { _ in Just([value]).setFailureType(to: Error.self).eraseToAnyPublisher() },
                update: { _ in }, isAvailable: { true }))
        let viewer = UUID()
        store.appear(viewer)
        defer { store.disappear(viewer) }
        store.acceptSavedLogo(.reset, merchantID: value.id)
        #expect(store.merchant(id: value.id)?.logoUrl == value.logoUrl)
    }

    @Test
    func ordersByCountOrAmountWithStableTiesAndSearch() throws {
        let merchants = try [
            merchant(id: "a", name: "Café", count: 12, amount: -1500),
            merchant(id: "b", name: "Bank", count: 2, amount: 500_000),
            merchant(id: "c", name: "Alpha", count: 12, amount: -1500),
            merchant(id: "deleted", name: "Deleted", count: 99, amount: -999_999, deleted: true),
        ]
        #expect(
            MerchantOrder.count.merchants(merchants, matching: "").map(\.id) == ["c", "a", "b"])
        #expect(
            MerchantOrder.amount.merchants(merchants, matching: "").map(\.id) == ["b", "c", "a"])
        #expect(MerchantOrder.amount.merchants(merchants, matching: "  cafe  ").map(\.id) == ["a"])
        #expect(MerchantOrder.count.merchants(merchants, matching: "missing").isEmpty)
    }

    @Test
    func overviewIncludesUnusedMerchantsAndPreservesLargeAmounts() throws {
        let values = try [
            merchant(id: "min", amount: Int64.min),
            merchant(id: "max", count: 1, amount: Int64.max),
            merchant(id: "unused"),
            merchant(id: "deleted", count: 100, amount: -99, deleted: true),
        ]
        let overview = MerchantOverview(merchants: values)
        #expect(overview.merchantCount == 3)
        #expect(overview.transactionCount == 1)
        #expect(overview.amount == Decimal(string: "18446744073709551615"))
        #expect(MerchantOrder.amount.merchants(values, matching: "").first?.id == "min")
    }

    @Test
    func merchantLogoDecodingDistinguishesAutomaticRemovedAndCustom() throws {
        #expect(try merchant().logoState == .automatic)
        #expect(try merchant(logoJSON: #", "rawLogoUrl": null"#).logoState == .removed)
        #expect(
            try merchant(logoJSON: #", "rawLogoUrl": "https://example.com/custom.png""#).logoState
                == .custom)
    }

    @Test
    func merchantUpdatesOnlyEditedFieldsAndEncodesResetAndRemovalDifferently() throws {
        let original = try merchant(name: "Coffee")
        var draft = MerchantDraft(name: " Coffee ")
        #expect(!draft.isDirty(comparedTo: original))
        #expect(
            draft.arguments(workspaceID: "workspace", merchant: original).keys.sorted() == [
                "merchantId", "workspaceId",
            ])
        draft.logo = .remove
        #expect(
            try draft.arguments(workspaceID: "workspace", merchant: original)["logoUrl"]??
                .convexEncode() == "null")
        draft.logo = .reset
        #expect(
            try draft.arguments(workspaceID: "workspace", merchant: original)["logoUrl"]??
                .convexEncode() == #""UNSET""#)
        draft.name = " New name "
        draft.logo = .custom("https://example.com/logo.png")
        let arguments = draft.arguments(workspaceID: "workspace", merchant: original)
        #expect(try arguments["name"]??.convexEncode() == #""New name""#)
        let encoded = try #require(try arguments["logoUrl"]??.convexEncode())
        #expect(
            try JSONDecoder().decode(String.self, from: Data(encoded.utf8))
                == "https://example.com/logo.png")
    }

    @Test
    func accountResetRemovalAndUntouchedDefaultsUseTheExistingAPIContract() throws {
        let account = AccountSnapshot(
            id: "bank", name: "Checking", accountType: "banking_checking",
            resolvedLogoUrl: "https://example.com/default.png",
            institutionLogoUrl: "https://example.com/default.png")
        var draft = AccountDraft(account: account)
        var request = AccountMutationRequest(
            workspaceID: "workspace", operation: .update(account, draft))
        #expect(!request.arguments.keys.contains("logoUrl"))
        draft.logoChoice = .remove
        request = .init(workspaceID: "workspace", operation: .update(account, draft))
        #expect(try request.arguments["logoUrl"]??.convexEncode() == "null")
        #expect(
            draft.logoChoice.previewURL(
                current: account.resolvedLogoUrl, defaultURL: account.institutionLogoUrl) == nil)
        draft.logoChoice = .reset
        request = .init(workspaceID: "workspace", operation: .update(account, draft))
        #expect(try request.arguments["logoUrl"]??.convexEncode() == #""UNSET""#)
        #expect(
            draft.logoChoice.previewURL(current: nil, defaultURL: account.institutionLogoUrl)
                == account.institutionLogoUrl)
        #expect(draft != AccountDraft(account: account))
    }

    @Test
    func accountDecodeRetainsExplicitRemovalAndInstitutionDefault() throws {
        let amount = try Int64(0).convexEncode()
        let json = """
            {"_id":"bank","name":"Checking","accountType":"banking_checking",
            "currentBalance":\(amount),"logoUrl":null,
            "institutionLogoUrl":"https://example.com/default.png"}
            """
        let account = try JSONDecoder().decode(AccountSnapshot.self, from: Data(json.utf8))
        #expect(account.logoState == .removed)
        #expect(account.resolvedLogoUrl == nil)
        #expect(account.institutionLogoUrl == "https://example.com/default.png")
    }

    @Test
    func searchClearsResultsForShortQueriesAndReportsFailure() async {
        var searches: [String] = []
        let store = EntityLogoSearchStore(debounce: .zero) { query in
            searches.append(query)
            if query == "fail" { throw SearchFailure.failed }
            return [Self.logo("coffee")]
        }
        await store.load(" coffee ")
        #expect(searches == ["coffee"])
        #expect(store.results.count == 1)
        await store.load("c")
        #expect(store.results.isEmpty)
        #expect(!store.isSearching)
        #expect(searches.count == 1)
        await store.load("fail")
        #expect(store.error != nil)
        #expect(!store.isSearching)
    }

    @Test
    func staleLogoSearchCannotReplaceNewResults() async {
        var pending: CheckedContinuation<[EntityLogoSearchResult], Never>?
        let store = EntityLogoSearchStore(debounce: .zero) { query in
            if query == "old" {
                return await withCheckedContinuation { pending = $0 }
            }
            return [Self.logo("new")]
        }
        let old = Task { await store.load("old") }
        while pending == nil { await Task.yield() }
        await store.load("new")
        pending?.resume(returning: [Self.logo("old")])
        await old.value
        #expect(store.results.map(\.domain) == ["new.com"])
        #expect(!store.isSearching)
    }

    @Test
    func searchDropsDuplicateAndInsecureResults() async {
        let store = EntityLogoSearchStore(debounce: .zero) { _ in
            [
                Self.logo("coffee"), Self.logo("coffee"),
                .init(name: "Bad", domain: "bad", logoUrl: "http://bad/logo"),
            ]
        }
        await store.load("coffee")
        #expect(store.results == [Self.logo("coffee")])
    }

    private enum SearchFailure: Error { case failed }

    @Test
    func constructingStoreDoesNotLoadMerchantsUntilItsPageAppears() {
        var subscriptions = 0
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD", minorUnit: 2,
            client: .init(
                watch: { _ in
                    subscriptions += 1
                    return Empty<[SettingsMerchant], Error>().eraseToAnyPublisher()
                }, update: { _ in }, isAvailable: { true }))

        #expect(subscriptions == 0)
        let viewer = UUID()
        store.appear(viewer)
        #expect(subscriptions == 1)
        store.disappear(viewer)
    }

    @Test
    func listAndDetailShareASubscriptionAndRejectOtherWorkspaces() throws {
        let current = try merchant()
        let subject = CurrentValueSubject<[SettingsMerchant], Error>([current])
        var subscriptions = 0
        var cancellations = 0
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD", minorUnit: 2,
            client: .init(
                watch: { _ in
                    subscriptions += 1
                    return subject.handleEvents(receiveCancel: { cancellations += 1 })
                        .eraseToAnyPublisher()
                }, update: { _ in }, isAvailable: { true }))
        let list = UUID()
        let detail = UUID()
        store.appear(list)
        store.appear(detail)
        #expect(subscriptions == 1)
        #expect(store.hasLoaded)
        store.disappear(list)
        #expect(cancellations == 0)
        let foreignJSON = """
            {"_id":"foreign","workspaceId":"other","name":"Other"}
            """
        let foreign = try JSONDecoder().decode(SettingsMerchant.self, from: Data(foreignJSON.utf8))
        subject.send([current, foreign, try merchant(id: "removed", deleted: true)])
        #expect(store.merchants.map(\.id) == [current.id])
        store.disappear(detail)
        #expect(cancellations == 1)
    }

    @Test
    func invalidNamesNeverWriteAndFailedSavesCanBeRetried() async throws {
        let current = try merchant(name: "Coffee")
        let duplicate = try merchant(id: "other", name: "Market")
        var shouldFail = true
        var writes = 0
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD", minorUnit: 2,
            client: .init(
                watch: { _ in
                    Just([current, duplicate]).setFailureType(to: Error.self).eraseToAnyPublisher()
                },
                update: { _ in
                    writes += 1
                    if shouldFail { throw SearchFailure.failed }
                }, isAvailable: { true }))
        let viewer = UUID()
        store.appear(viewer)
        defer { store.disappear(viewer) }
        #expect(await store.save(.init(name: " "), original: current) == false)
        #expect(await store.save(.init(name: " MARKET "), original: current) == false)
        #expect(writes == 0)
        let draft = MerchantDraft(name: "Coffee shop", logo: .remove)
        #expect(await store.save(draft, original: current) == false)
        #expect(store.actionError != nil)
        #expect(!store.isSaving)
        shouldFail = false
        #expect(await store.save(draft, original: current))
        #expect(writes == 2)
        #expect(store.actionError == nil)
    }

    @Test
    func saveCompletionCannotSucceedAfterWorkspaceChanges() async throws {
        let current = try merchant()
        var available = true
        var pending: CheckedContinuation<Void, Never>?
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD", minorUnit: 2,
            client: .init(
                watch: { _ in Just([current]).setFailureType(to: Error.self).eraseToAnyPublisher()
                },
                update: { _ in await withCheckedContinuation { pending = $0 } },
                isAvailable: { available }))
        let viewer = UUID()
        store.appear(viewer)
        defer { store.disappear(viewer) }
        let saving = Task { await store.save(.init(name: "Changed"), original: current) }
        while pending == nil { await Task.yield() }
        #expect(store.isSaving)
        available = false
        pending?.resume()
        #expect(await saving.value == false)
        #expect(!store.isSaving)
        #expect(await store.save(.init(name: "Again"), original: current) == false)
    }

    @Test
    func selectionPersistsAcrossFilteringAndPrunesRemovedMerchants() throws {
        let values = [try merchant(id: "a"), try merchant(id: "b"), try merchant(id: "c")]
        var selection = MerchantSelection()
        selection.begin()
        #expect(selection.isSelecting)
        #expect(selection.ids.isEmpty)
        selection.toggle("a")
        selection.toggle("b")
        #expect(selection.merchants(in: values).map(\.id) == ["a", "b"])
        // Search/order only change the visible list, never the selected identities.
        _ = MerchantOrder.count.merchants(values, matching: "no match")
        #expect(selection.ids == ["a", "b"])
        selection.reconcile([values[1], values[2]])
        #expect(selection.ids == ["b"])
        selection.toggle("b")
        #expect(selection.ids.isEmpty)
        #expect(selection.isSelecting)
        selection.end()
        #expect(!selection.isSelecting)
    }

    @Test
    func mergeEligibilityIncludesPlannedTransactionsAndAllowsKeepingASelectedMerchant() throws {
        let unused = try merchant(id: "unused")
        let used = try merchant(id: "used", count: 2)
        let planned = try merchant(id: "planned", plannedCount: 1)
        #expect(!unused.requiresMerge)
        #expect(used.requiresMerge)
        #expect(planned.requiresMerge)
        let single = MerchantMergeRequest(merchants: [used])
        #expect(!single.allowsTarget(used))
        #expect(single.allowsTarget(unused))
        let multiple = MerchantMergeRequest(merchants: [unused, used, planned])
        #expect(multiple.allowsTarget(used))
        #expect(multiple.sources(targetID: used.id).map(\.id) == ["unused", "planned"])
    }

    @Test
    func deletionRejectsTransactionsAndPlansBeforeWriting() async throws {
        let unused = try merchant(id: "unused")
        let used = try merchant(id: "used", count: 1)
        let planned = try merchant(id: "planned", plannedCount: 1)
        var deleted: [String] = []
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD",
            client: .init(
                watch: { _ in
                    Just([unused, used, planned]).setFailureType(to: Error.self)
                        .eraseToAnyPublisher()
                },
                update: { _ in }, isAvailable: { true },
                delete: { workspace, id in
                    #expect(workspace == "workspace")
                    deleted.append(id)
                }))
        let viewer = UUID()
        store.appear(viewer)
        defer { store.disappear(viewer) }
        #expect(await store.remove([unused.id, used.id]) == false)
        #expect(await store.remove([planned.id]) == false)
        #expect(deleted.isEmpty)
        #expect(await store.remove([unused.id]))
        #expect(deleted == [unused.id])
        #expect(store.merchant(id: unused.id) == nil)
    }

    @Test
    func mergeRetriesOnlyUnfinishedSourcesAndRejectsInvalidTargets() async throws {
        let a = try merchant(id: "a", count: 2)
        let b = try merchant(id: "b")
        let target = try merchant(id: "target")
        let subject = CurrentValueSubject<[SettingsMerchant], Error>([a, b, target])
        var shouldFail = true
        var merged: [String] = []
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD",
            client: .init(
                watch: { _ in subject.eraseToAnyPublisher() }, update: { _ in },
                isAvailable: { true },
                merge: { workspace, source, destination in
                    #expect(workspace == "workspace")
                    #expect(destination == target.id)
                    merged.append(source)
                    if source == b.id && shouldFail { throw SearchFailure.failed }
                }))
        let viewer = UUID()
        store.appear(viewer)
        defer { store.disappear(viewer) }
        #expect(await store.remove([a.id], mergingInto: a.id) == false)
        #expect(await store.remove([a.id], mergingInto: "missing") == false)
        #expect(await store.remove([a.id, a.id], mergingInto: target.id) == false)
        #expect(merged.isEmpty)
        #expect(await store.remove([a.id, b.id], mergingInto: target.id) == false)
        #expect(store.completedRemovalIDs == [a.id])
        #expect(store.actionError != nil)
        #expect(!store.isSaving)
        subject.send([a, b, target])
        #expect(store.merchant(id: a.id) == nil)
        shouldFail = false
        #expect(await store.remove([a.id, b.id], mergingInto: target.id))
        #expect(merged == [a.id, b.id, b.id])
        #expect(store.merchants.map(\.id) == [target.id])
        #expect(store.actionError == nil)
    }

    @Test
    func deletionFailureKeepsRemainingSelectionRetryable() async throws {
        let a = try merchant(id: "a")
        let b = try merchant(id: "b")
        var attempts: [String] = []
        var shouldFail = true
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD",
            client: .init(
                watch: { _ in Just([a, b]).setFailureType(to: Error.self).eraseToAnyPublisher() },
                update: { _ in }, isAvailable: { true },
                delete: { _, source in
                    attempts.append(source)
                    if source == b.id && shouldFail { throw SearchFailure.failed }
                }))
        let viewer = UUID()
        store.appear(viewer)
        defer { store.disappear(viewer) }
        #expect(await store.remove([a.id, b.id]) == false)
        #expect(store.merchants.map(\.id) == [b.id])
        shouldFail = false
        #expect(await store.remove([a.id, b.id]))
        #expect(attempts == [a.id, b.id, b.id])
    }

    @Test
    func mergeStopsBetweenSourcesWhenWorkspaceChangesAndRejectsDoubleSubmit() async throws {
        let a = try merchant(id: "a", count: 1)
        let b = try merchant(id: "b")
        let target = try merchant(id: "target")
        var available = true
        var pending: CheckedContinuation<Void, Never>?
        var merged: [String] = []
        let store = MerchantsStore(
            workspaceID: "workspace", currency: "USD",
            client: .init(
                watch: { _ in
                    Just([a, b, target]).setFailureType(to: Error.self).eraseToAnyPublisher()
                },
                update: { _ in }, isAvailable: { available },
                merge: { _, source, _ in
                    merged.append(source)
                    await withCheckedContinuation { pending = $0 }
                }))
        let viewer = UUID()
        store.appear(viewer)
        defer { store.disappear(viewer) }
        let task = Task { await store.remove([a.id, b.id], mergingInto: target.id) }
        while pending == nil { await Task.yield() }
        #expect(store.isSaving)
        #expect(await store.remove([a.id], mergingInto: target.id) == false)
        available = false
        pending?.resume()
        #expect(await task.value == false)
        #expect(merged == [a.id])
        #expect(!store.isSaving)
        #expect(store.completedRemovalIDs.isEmpty)
    }

    private static func logo(_ name: String) -> EntityLogoSearchResult {
        .init(name: name, domain: "\(name).com", logoUrl: "https://example.com/\(name).png")
    }

    private func merchant(
        id: String = "merchant", name: String = "Merchant", count: Int = 0, amount: Int64 = 0,
        deleted: Bool = false, logoJSON: String = "", plannedCount: Int = 0
    ) throws -> SettingsMerchant {
        let amountJSON = try amount.convexEncode()
        let json = """
            {"_id":"\(id)","workspaceId":"workspace","name":"\(name)",
            "transactionCount":\(count),"activeRecurringTransactionCount":\(plannedCount),"totalSpent":\(amountJSON),"isDeleted":\(deleted)\(logoJSON)}
            """
        return try JSONDecoder().decode(SettingsMerchant.self, from: Data(json.utf8))
    }
}
