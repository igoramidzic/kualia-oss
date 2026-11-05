import Combine
import ConvexMobile
import Foundation
import SwiftUI
import Testing
import UIKit

@testable import Kualia

@Suite(.serialized)
@MainActor
struct TransactionEditorTests {
    @Test(arguments: [false, true])
    func bankMatchCanBeConfirmedOrUnlinked(unlink: Bool) async throws {
        let detail = try fixture(bankMatch: true)
        var requests: [TransactionImportLinkRequest] = []
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.suggestionChoices() },
            importLinkHandler: { request in
                requests.append(request)
                return TransactionEditorSaveResult(success: true)
            })
        await store.load()
        #expect(store.hasLinkedImport)
        #expect(store.canResolveImportLink)
        let action: TransactionImportLinkRequest.Action =
            unlink
            ? .unlink : .approve(useImportAmount: true, useImportDate: false)
        #expect(await store.resolveImportLink(action))
        let request = try #require(requests.first)
        #expect(
            request.mutationName
                == (unlink
                    ? "transactionLinking:unlinkTransaction"
                    : "transactionLinking:approveTransactionLink"))
        #expect(request.action == action)
        #expect(request.workspaceID == "workspace")
        #expect(request.transactionID == detail.id)
        let arguments = try request.arguments.convexEncode()
        #expect(arguments.contains("workspaceId"))
        if !unlink {
            #expect(arguments.contains("useImportAmount"))
            #expect(arguments.contains("useImportDate"))
        }
        #expect(store.savedReceipt != nil)
        #expect(!store.canResolveImportLink)
        #expect(await store.resolveImportLink(action) == false)
        #expect(requests.count == 1)
        store.stop()
    }

    @Test
    func approvedBankMatchCanStillBeRejectedAndFailurePreservesTheEntry() async throws {
        let detail = try fixture(reviewStatus: "reviewed", bankMatch: true)
        var attempts = 0
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.suggestionChoices() },
            importLinkHandler: { _ in
                attempts += 1
                throw TransactionEditorError.saveFailed
            })
        await store.load()
        #expect(!store.needsApproval)
        #expect(store.canResolveImportLink)
        let original = store.draft
        #expect(await store.resolveImportLink(.unlink) == false)
        #expect(store.saveErrorMessage != nil)
        #expect(store.savedReceipt == nil)
        #expect(store.draft == original)
        #expect(store.canResolveImportLink)
        store.draft?.notes = "Unsaved edit"
        #expect(!store.canResolveImportLink)
        #expect(await store.resolveImportLink(.unlink) == false)
        #expect(attempts == 1)
        store.stop()
    }

    @Test(arguments: [false, true])
    func creationUsesWorkspaceDefaultsAndKeepsTheDraftPristine(pending: Bool) async throws {
        let defaults = try JSONDecoder().decode(
            TransactionEditorDefaults.self,
            from: Data(
                "{\"transactionDefaultAccountId\":\"other-account\",\"transactionDefaultPendingStatus\":\(pending)}"
                    .utf8))
        var options = suggestionChoices()
        options.defaults = defaults
        let store = TransactionEditorStore(workspace: workspace(), choicesLoader: { _ in options })
        await store.load()
        #expect(store.draft?.accountID == "other-account")
        #expect(store.draft?.status == (pending ? .pending : .cleared))
        #expect(!store.isDirty)
        store.selectMerchant("first")
        #expect(store.draft?.accountID == "other-account")
        options.defaults.transactionDefaultAccountId = "account"
        options.defaults.transactionDefaultPendingStatus = !pending
        await store.reloadChoices()
        #expect(store.draft?.accountID == "other-account")
        #expect(store.draft?.status == (pending ? .pending : .cleared))
        store.stop()
    }

    @Test(arguments: [false, true])
    func pageAccountOverridesDefaultsBeforeOrAfterCachedChoices(cached: Bool) async {
        var options = suggestionChoices()
        options.defaults = .init(
            transactionDefaultAccountId: "other-account", transactionDefaultPendingStatus: true)
        let shared = TransactionEditorChoicesStore(workspaceID: workspace().id) {
            Just(options).setFailureType(to: Error.self).eraseToAnyPublisher()
        }
        if cached { shared.states.send(.init(choices: options)) }
        let store = TransactionEditorStore(workspace: workspace(), choicesStore: shared)
        store.preselectAccount("account")
        shared.states.send(.init(choices: options))
        await store.load()
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.status == .pending)
        #expect(!store.isDirty)
        store.stop()
    }

    @Test
    func lateDefaultsPreserveManualAccountAndStatusSelections() async {
        var options = suggestionChoices()
        options.defaults = .init(
            transactionDefaultAccountId: "account", transactionDefaultPendingStatus: true)
        let store = TransactionEditorStore(workspace: workspace(), choicesLoader: { _ in options })
        store.selectAccount("other-account")
        store.selectStatus(.cleared)
        store.draft?.notes = "Keep this draft"
        await store.load()
        #expect(store.draft?.accountID == "other-account")
        #expect(store.draft?.status == .cleared)
        #expect(store.draft?.notes == "Keep this draft")
        #expect(store.isDirty)
        store.stop()
    }

    @Test(arguments: ["missing", "closed", "deleted"])
    func unavailableDefaultAccountsStayUnselected(id: String) async {
        var options = suggestionChoices()
        options.accounts += [
            .init(id: "closed", name: "Closed", accountType: "banking_checking", isClosed: true),
            .init(id: "deleted", name: "Deleted", accountType: "banking_checking", isDeleted: true),
        ]
        options.defaults = .init(
            transactionDefaultAccountId: id, transactionDefaultPendingStatus: true)
        let store = TransactionEditorStore(workspace: workspace(), choicesLoader: { _ in options })
        await store.load()
        #expect(store.draft?.accountID == "")
        #expect(store.draft?.status == .pending)
        store.stop()
    }

    @Test
    func editingAndDuplicatingKeepTheirOwnAccountAndStatus() async throws {
        let source = try fixture(status: "cleared")
        var options = suggestionChoices()
        options.defaults = .init(
            transactionDefaultAccountId: "other-account", transactionDefaultPendingStatus: true)
        for duplicate in [false, true] {
            let store = TransactionEditorStore(
                workspace: workspace(), transactionID: duplicate ? nil : source.id,
                detailLoader: { _, _ in source }, choicesLoader: { _ in options })
            if duplicate { store.prepareDuplication(of: source.id) }
            await store.load()
            #expect(store.draft?.accountID == source.bankAccountId)
            #expect(store.draft?.status == .cleared)
            store.stop()
        }
    }

    @Test func duplicatePreservesSplitsAndCreatesOnlyWhenSaved() async throws {
        let source = try fixture(
            movements: [
                movement(-1_500, category: "groceries", notes: "Purchase"),
                movement(300, category: "dining", notes: "Refund"),
            ], suggestion: true, status: "reconciled")
        var creates = 0
        var updates = 0
        let store = TransactionEditorStore(
            workspace: workspace(),
            detailLoader: { _, id in
                #expect(id == source.id)
                return source
            }, choicesLoader: { _ in self.suggestionChoices() },
            creationHandler: { request in
                creates += 1
                #expect(request.draft.scheduledTransactionID == nil)
                #expect(request.draft.allocations.map(\.amount) == [-1_500, 300])
                return TransactionCreationResult(
                    transactionId: "copy", scheduledTransactionId: nil, budgetChanges: [])
            },
            saveHandler: { _ in
                updates += 1
                throw TransactionEditorError.saveFailed
            })
        store.prepareDuplication(of: source.id)
        #expect(store.draft == nil)
        #expect(!store.canSave)
        await store.load()
        store.refreshSuggestions()
        #expect(store.isCreating)
        #expect(store.transactionID == nil)
        #expect(store.detail == nil)
        #expect(store.draft?.merchantID == source.merchantId)
        #expect(store.draft?.accountID == source.bankAccountId)
        #expect(store.draft?.dateKey == source.date)
        #expect(store.draft?.notes == source.notes)
        #expect(store.draft?.allocations.map(\.notes) == ["Purchase", "Refund"])
        #expect(store.draft?.allocations.map(\.categoryID) == ["groceries", "dining"])
        #expect(store.draft?.reviewStatus == .reviewed)
        #expect(store.draft?.status == .cleared)
        #expect(store.draft?.isTransfer == false)
        #expect(store.isDirty && store.canSave)
        #expect(!store.canDelete)
        #expect(creates == 0 && updates == 0)
        #expect(await store.save())
        #expect(creates == 1 && updates == 0)
        #expect(store.savedReceipt?.transactionID == "copy")
        #expect(!(await store.save()))
        #expect(creates == 1)
        store.stop()
    }

    @Test(arguments: [-1_200, 1_200])
    func duplicateRetainsTransferDirection(amount: Int64) async throws {
        let source = try fixture(amount: amount, type: "transfer")
        let store = TransactionEditorStore(
            workspace: workspace(), detailLoader: { _, _ in source },
            choicesLoader: { _ in self.suggestionChoices() })
        store.prepareDuplication(of: source.id)
        await store.load()
        #expect(store.draft?.isTransfer == true)
        #expect(store.draft?.signedAmount == amount)
        #expect(store.draft?.isIncomingTransfer == (amount > 0))
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.transferAccountID == "other-account")
        #expect(store.draft?.scheduledTransactionID == nil)
        #expect(store.canSave)
        store.stop()
    }

    @Test func duplicateRetainsAnImportedPayeeWithoutCopyingBankLinks() async throws {
        let value: [String: ConvexEncodable?] = [
            "_id": "imported", "workspaceId": "workspace", "bankAccountId": "account",
            "date": "2026-09-04", "type": "regular", "status": "pending",
            "reviewStatus": "needs_review", "totalAmount": Int64(-1_200), "isDeleted": false,
            "merchantName": "Coffee shop", "linkedRawTransactionId": "raw-import",
            "source": "plaid", "movements": [movement(-1_200) as ConvexEncodable?],
        ]
        let source = try JSONDecoder().decode(
            TransactionEditorDetail.self,
            from: Data(value.convexEncode().utf8))
        let store = TransactionEditorStore(
            workspace: workspace(), detailLoader: { _, _ in source },
            choicesLoader: { _ in self.suggestionChoices() })
        store.prepareDuplication(of: source.id)
        await store.load()
        #expect(store.draft?.pendingMerchantName == "Coffee shop")
        #expect(store.draft?.status == .pending)
        #expect(store.detail == nil)
        #expect(store.canSave)
        store.stop()
    }

    @Test func stoppingADuplicateDiscardsALateSourceResponse() async throws {
        let source = try fixture()
        var pending: CheckedContinuation<TransactionEditorDetail?, Never>?
        let store = TransactionEditorStore(
            workspace: workspace(),
            detailLoader: { _, _ in
                await withCheckedContinuation { pending = $0 }
            })
        store.prepareDuplication(of: source.id)
        let loading = Task { await store.load() }
        await waitUntil { pending != nil }
        store.stop()
        pending?.resume(returning: source)
        await loading.value
        #expect(store.draft == nil)
        #expect(!store.canSave)
    }

    @Test func duplicateLoadFailureCanRetryWithoutCreatingABlankTransaction() async throws {
        let source = try fixture()
        var loads = 0
        let store = TransactionEditorStore(
            workspace: workspace(),
            detailLoader: { _, _ in
                loads += 1
                if loads == 1 { throw TransactionEditorError.notFound }
                return source
            }, choicesLoader: { _ in self.suggestionChoices() })
        store.prepareDuplication(of: source.id)
        await store.load()
        #expect(store.draft == nil)
        #expect(store.loadErrorMessage != nil)
        #expect(!store.canSave)
        await store.load()
        #expect(store.loadErrorMessage == nil)
        #expect(store.draft?.amount == 1_200)
        #expect(store.canSave)
        store.stop()
    }

    @Test func shortcutRetryPreservesExplicitlyClearedMerchantAndCategory() async {
        let store = TransactionEditorStore(
            workspace: workspace(), choicesLoader: { _ in self.suggestionChoices() })
        store.preselectWidgetCapture(
            .expense,
            shortcut: TransactionShortcutDraft(
                amount: 15, direction: .outflow, payee: "First", account: "Checking",
                category: "Dining", date: nil, notes: nil))
        store.selectMerchant("none")
        store.selectCategory("none")
        await store.load()
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.merchantID == nil)
        #expect(store.draft?.allocations.first?.categoryID == nil)
        #expect(store.draft?.pendingMerchantName == nil)
        store.stop()
    }

    @Test func shortcutDraftCanSaveWithoutFurtherEditsAndDoesNotSaveOnOpen() async {
        var saves = 0
        let store = TransactionEditorStore(
            workspace: workspace(), choicesLoader: { _ in self.suggestionChoices() },
            creationHandler: { _ in
                saves += 1
                throw TransactionEditorError.saveFailed
            })
        await store.load()
        store.preselectWidgetCapture(
            .expense,
            shortcut: TransactionShortcutDraft(
                amount: 12.34, direction: .outflow, payee: "First", account: "Checking",
                category: "Dining", date: nil, notes: "Coffee"))
        #expect(store.draft?.amount == 1234)
        #expect(store.draft?.merchantID == "first")
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.allocations.first?.categoryID == "dining")
        #expect(store.canSave)
        #expect(store.isDirty)
        #expect(saves == 0)
        store.refreshSuggestions()
        #expect(store.draft?.allocations.first?.categoryID == "dining")
        #expect(store.draft?.accountID == "account")
        _ = await store.save()
        #expect(saves == 1)
        store.stop()
    }

    @Test func shortcutTransferUsesBothAccountsAndKeepsRepeatSchedule() async {
        let store = TransactionEditorStore(
            workspace: workspace(), choicesLoader: { _ in self.suggestionChoices() })
        await store.load()
        store.preselectWidgetCapture(
            .transfer,
            shortcut: TransactionShortcutDraft(
                amount: 50, direction: .transfer, payee: "Ignored", account: "Checking",
                category: nil, date: nil, notes: nil,
                transferAccount: "Savings", recurrence: .monthly))
        #expect(store.draft?.isTransfer == true)
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.transferAccountID == "other-account")
        #expect(store.draft?.merchantID == nil)
        #expect(store.draft?.pendingMerchantName == nil)
        #expect(store.draft?.recurrence == .monthly)
        #expect(store.isPlanned)
        #expect(store.canSave)
        store.stop()
    }

    @Test func shortcutRejectsOtherWorkspaceAndAmbiguousNames() async {
        var choices = suggestionChoices()
        choices.accounts.append(
            .init(id: "duplicate", name: "Checking", accountType: "banking_checking"))
        let store = TransactionEditorStore(workspace: workspace(), choicesLoader: { _ in choices })
        await store.load()
        store.preselectWidgetCapture(
            .expense,
            shortcut: TransactionShortcutDraft(
                amount: 25, direction: .outflow, payee: nil, account: "Checking",
                category: nil, date: nil, notes: nil, workspaceID: "other-workspace"))
        #expect(store.draft?.amount == 0)
        #expect(!store.isDirty)
        #expect(store.shortcutNotice != nil)
        store.preselectWidgetCapture(
            .expense,
            shortcut: TransactionShortcutDraft(
                amount: 25, direction: .outflow, payee: nil, account: "Checking",
                category: nil, date: nil, notes: nil))
        #expect(store.draft?.accountID == "")
        #expect(store.shortcutNotice != nil)
        #expect(!store.canSave)
        store.stop()
    }

    @Test func shortcutChoicesSurviveLoadFailureWithoutOverwritingManualChanges() async {
        var fails = true
        let store = TransactionEditorStore(
            workspace: workspace(),
            choicesLoader: { _ in
                if fails { throw TransactionEditorError.saveFailed }
                return self.suggestionChoices()
            })
        await store.load()
        store.preselectWidgetCapture(
            .income,
            shortcut: TransactionShortcutDraft(
                amount: 100, direction: .inflow, payee: "New merchant", account: "Checking",
                category: "Dining", date: nil, notes: "Original"))
        store.selectAccount("other-account")
        store.selectCategory("groceries")
        store.draft?.notes = "Edited while offline"
        fails = false
        await store.reloadChoices()
        #expect(store.draft?.amount == 10000)
        #expect(store.draft?.signedAmount == 10000)
        #expect(store.draft?.accountID == "other-account")
        #expect(store.draft?.allocations.first?.categoryID == "groceries")
        #expect(store.draft?.pendingMerchantName == "New merchant")
        #expect(store.draft?.notes == "Edited while offline")
        store.stop()
    }

    @Test
    func merchantChoicesReplaySynchronousCachedPagesUntilCancelled() {
        var requestedCursors: [String?] = []
        var values: [[String]] = []
        var didComplete = false
        let subscription = TransactionEditorChoicesStore.merchantChoices { cursor in
            requestedCursors.append(cursor)
            let page = TransactionEditorMerchantPage(
                page: [.init(id: cursor ?? "first", name: "Merchant")],
                continueCursor: cursor == nil ? "second" : "third",
                isDone: cursor == "third")
            return Just(page).setFailureType(to: Error.self).eraseToAnyPublisher()
        }.sink(
            receiveCompletion: { _ in didComplete = true },
            receiveValue: { values.append($0.map(\.id)) })
        #expect(requestedCursors == [nil, "second", "third"])
        #expect(values == [["first", "second", "third"]])
        #expect(!didComplete)
        subscription.cancel()
    }

    @Test
    func merchantChoicesFailureCancelsEveryOtherPage() {
        let first = PassthroughSubject<TransactionEditorMerchantPage, Error>()
        let second = PassthroughSubject<TransactionEditorMerchantPage, Error>()
        var firstCancelled = false
        var failures = 0
        let subscription = TransactionEditorChoicesStore.merchantChoices { cursor in
            if cursor == nil {
                return first.handleEvents(receiveCancel: { firstCancelled = true })
                    .eraseToAnyPublisher()
            }
            return second.eraseToAnyPublisher()
        }.sink(
            receiveCompletion: { if case .failure = $0 { failures += 1 } },
            receiveValue: { _ in })
        first.send(.init(page: [], continueCursor: "second", isDone: false))
        second.send(completion: .failure(URLError(.notConnectedToInternet)))
        #expect(failures == 1)
        #expect(firstCancelled)
        subscription.cancel()
    }

    @Test
    func merchantChoicesLoadEveryPageAndReplaceChangedCursorTails() {
        let first = PassthroughSubject<TransactionEditorMerchantPage, Error>()
        let second = PassthroughSubject<TransactionEditorMerchantPage, Error>()
        let replacement = PassthroughSubject<TransactionEditorMerchantPage, Error>()
        var requestedCursors: [String?] = []
        var values: [[String]] = []
        var cancelledSecond = false
        let subscription = TransactionEditorChoicesStore.merchantChoices { cursor in
            requestedCursors.append(cursor)
            if cursor == "second" {
                return second.handleEvents(receiveCancel: { cancelledSecond = true })
                    .eraseToAnyPublisher()
            }
            if cursor == "replacement" { return replacement.eraseToAnyPublisher() }
            return first.eraseToAnyPublisher()
        }.sink(receiveCompletion: { _ in }, receiveValue: { values.append($0.map(\.id)) })
        // A page consisting entirely of deleted merchants must still advance.
        first.send(.init(page: [], continueCursor: "second", isDone: false))
        #expect(requestedCursors == [nil, "second"])
        #expect(values.isEmpty)
        second.send(.init(page: [.init(id: "b", name: "B")], continueCursor: "", isDone: true))
        #expect(values == [["b"]])
        first.send(
            .init(
                page: [.init(id: "same-cursor", name: "New")], continueCursor: "second",
                isDone: false))
        #expect(requestedCursors == [nil, "second"])
        #expect(!cancelledSecond)
        #expect(values.last == ["same-cursor", "b"])
        first.send(
            .init(page: [.init(id: "a", name: "A")], continueCursor: "replacement", isDone: false))
        #expect(cancelledSecond)
        second.send(
            .init(page: [.init(id: "stale", name: "Stale")], continueCursor: "", isDone: true))
        replacement.send(
            .init(page: [.init(id: "c", name: "C")], continueCursor: "", isDone: true))
        #expect(values == [["b"], ["same-cursor", "b"], ["a", "c"]])
        replacement.send(.init(page: [], continueCursor: "", isDone: true))
        #expect(values.last == ["a"])
        subscription.cancel()
        first.send(.init(page: [], continueCursor: "", isDone: true))
        #expect(values.last == ["a"])
    }

    @Test
    func deletionUsesSavedIdentityAndDateDespiteUnsavedEdits() async throws {
        let detail = try fixture()
        var calls = 0
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            deletionHandler: { workspaceID, transactionID in
                #expect(workspaceID == self.workspace().id)
                #expect(transactionID == detail.id)
                calls += 1
                return TransactionEditorSaveResult(success: true, budgetChanges: [])
            })
        #expect(!store.canDelete)
        await store.load()
        let originalDate = store.draft?.dateKey
        store.draft?.dateKey = "2030-01-01"
        store.draft?.amount = 0
        #expect(store.canDelete)
        #expect(await store.delete())
        #expect(store.savedReceipt?.kind == .deleted)
        #expect(store.savedReceipt?.dateKey == originalDate)
        #expect(store.savedReceipt?.transactionID == detail.id)
        #expect(!store.canDelete)
        #expect(await !store.delete())
        #expect(calls == 1)
    }

    @Test
    func failedDeletionPreservesDraftAndAllowsRetry() async throws {
        let detail = try fixture()
        var calls = 0
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            deletionHandler: { _, _ in
                calls += 1
                if calls == 1 { throw TransactionEditorError.saveFailed }
                return TransactionEditorSaveResult(success: calls > 2)
            })
        await store.load()
        store.draft?.notes = "Unsaved note"
        for _ in 0..<2 {
            #expect(await !store.delete())
            #expect(store.canDelete)
            #expect(!store.isSaving)
            #expect(store.savedReceipt == nil)
            #expect(store.draft?.notes == "Unsaved note")
            #expect(store.saveErrorMessage == TransactionFeedAction.delete.failureMessage)
        }
        #expect(await store.delete())
        #expect(store.saveErrorMessage == nil)
    }

    @Test
    func newTransactionsCannotBeDeleted() async {
        let store = TransactionEditorStore(workspace: workspace())
        #expect(!store.canDelete)
        #expect(await !store.delete())
    }

    @Test
    func plannedLinkDetailsDecodeAmountsAndResolveNamesLogosAndCategories() throws {
        let values: [String: ConvexEncodable?] = [
            "_id": "bill", "nextDate": "2026-09-09", "bankAccountId": "account",
            "merchantId": "merchant", "merchantName": "Old name", "recurrence": "monthly",
            "status": "active", "notes": "Annual subscription discount",
            "movements": [
                movement(-3_500, category: "groceries"),
                movement(500, category: "dining"),
            ].map { $0 as ConvexEncodable? },
        ]
        let plan = try JSONDecoder().decode(
            TransactionEditorPlannedTransaction.self, from: Data(values.convexEncode().utf8))
        var choices = suggestionChoices()
        choices.merchants = [
            .init(id: "merchant", name: "Merchant", logoUrl: "https://example.com/logo.png")
        ]
        let details = TransactionPlannedLinkDetails(
            plan: plan, choices: choices, workspace: workspace())
        #expect(plan.amount == -3_000)
        #expect(details.name == "Merchant")
        #expect(details.logoURL?.absoluteString == "https://example.com/logo.png")
        #expect(details.accountName == "Checking")
        #expect(details.categorySummary == "Groceries · Dining")
        #expect(details.recurrenceTitle == L10n.string("Monthly"))
        #expect(details.dueTitle(today: "2026-09-09") == L10n.string("Due today"))
        #expect(details.dueTitle(today: "2026-09-10").contains("Overdue"))
        #expect(details.amountTitle?.contains("30.00") == true)
        for search in ["merchant", "checking", "dining", "discount", "monthly", "30.00"] {
            #expect(details.matches(search: search))
        }
        #expect(!details.matches(search: "unrelated"))
    }

    @Test
    func plannedLinkSuggestionsMatchMerchantsAndSplitAmountsWithinTenPercent() throws {
        var draft = TransactionEditorDraft(workspace: workspace(), now: referenceDate())
        draft.accountID = "account"
        draft.amount = 900
        let split = try plannedLinkFixture(id: "split", amounts: [-1_500, 500])
        #expect(split.isSuggested(for: draft))
        draft.amount = 1_100
        #expect(split.isSuggested(for: draft))
        for amount: Int64 in [899, 1_101, 0] {
            draft.amount = amount
            #expect(!split.isSuggested(for: draft))
        }
        draft.amount = 8_000
        draft.merchantID = "merchant"
        let merchant = try plannedLinkFixture(id: "merchant", amounts: [], merchantID: "merchant")
        #expect(merchant.isSuggested(for: draft))
        #expect(!(try plannedLinkFixture(id: "missing", amounts: [])).isSuggested(for: draft))
        #expect(
            !(try plannedLinkFixture(id: "zero", amounts: [-100, 100])).isSuggested(for: draft))
        draft.merchantID = nil
        draft.amount = Int64.max
        #expect(
            (try plannedLinkFixture(id: "extreme", amounts: [Int64.min])).isSuggested(for: draft))
        draft.accountID = "other-account"
        #expect(!merchant.isSuggested(for: draft))
    }

    @Test
    func existingPlannedLinkShowsItsOwnDueDateAfterTheScheduleAdvances() throws {
        #expect(try fixture().scheduledOccurrenceDate == nil)
        let detail = try fixture(scheduledOccurrenceDate: "2026-09-08")
        #expect(detail.scheduledOccurrenceDate == "2026-09-08")
        #expect(try TransactionEditorDraft(detail: detail).scheduledOccurrenceDate == "2026-09-08")
        let plan = TransactionEditorPlannedTransaction(
            id: "plan", nextDate: "2026-10-08", bankAccountId: "account", status: "active")
        let linked = TransactionPlannedLinkDetails(
            plan: plan, choices: .init(), workspace: workspace(),
            occurrenceDate: detail.scheduledOccurrenceDate)
        let upcoming = TransactionPlannedLinkDetails(
            plan: plan, choices: .init(), workspace: workspace())
        let date = PlannedDates.dueLabel("2026-09-08", today: "2026-09-16", workspace: workspace())
        #expect(linked.dueTitle(today: "2026-09-16") == L10n.string("Due \(date)"))
        #expect(linked.dueTitle(today: "2026-09-16") != upcoming.dueTitle(today: "2026-09-16"))
    }

    @Test
    func selectingAPlannedLinkCapturesTheExactDueDateForEarlyPayment() async {
        for isTransfer in [false, true] {
            let store = TransactionEditorStore(
                workspace: workspace(), now: referenceDate,
                choicesLoader: { _ in
                    var choices = self.suggestionChoices()
                    choices.plannedTransactions = [
                        .init(
                            id: "future-plan", nextDate: "2026-12-16", bankAccountId: "account",
                            transferToAccountId: isTransfer ? "other-account" : nil,
                            transactionType: isTransfer ? "transfer" : "regular")
                    ]
                    return choices
                })
            await store.load()
            store.selectAccount("account")
            store.draft?.setCreatesTransfer(isTransfer)
            if isTransfer { store.selectTransferAccount("other-account") }
            store.draft?.setAmount(1200)
            store.selectPlannedTransaction("future-plan")
            #expect(store.draft?.scheduledOccurrenceDate == "2026-12-16")
            #expect(store.canSave)
            if let draft = store.draft {
                let arguments = TransactionCreationRequest(workspaceID: "workspace", draft: draft)
                    .arguments
                #expect(arguments["linkedScheduledOccurrenceDate"] as? String == "2026-12-16")
                #expect(arguments["date"] as? String == draft.dateKey)
            }
            store.selectPlannedTransaction(nil)
            #expect(store.draft?.scheduledOccurrenceDate == nil)
            store.stop()
        }
    }

    @Test
    func reassigningTheSamePlanToAnotherOccurrenceSendsItsNewDateAndUnchangedEditsKeepTheOldOne()
        throws
    {
        let original = try TransactionEditorDraft(
            detail: fixture(scheduledOccurrenceDate: "2026-09-08"))
        var edited = original
        edited.notes = "Corrected note"
        #expect(
            !request(edited, original: original).arguments.keys.contains(
                "linkedScheduledOccurrenceDate"))
        #expect(edited.scheduledOccurrenceDate == "2026-09-08")
        edited.scheduledOccurrenceDate = "2026-10-08"
        let arguments = request(edited, original: original).arguments
        #expect(arguments["linkedScheduledTransactionId"] as? String == "plan")
        #expect(arguments["linkedScheduledOccurrenceDate"] as? String == "2026-10-08")
        edited.scheduledTransactionID = "different-plan"
        #expect(edited.scheduledOccurrenceDate == nil)
        edited.scheduledOccurrenceDate = "2026-11-08"
        edited.scheduledTransactionID = nil
        #expect(edited.scheduledOccurrenceDate == nil)
        #expect(
            !request(edited, original: original).arguments.keys.contains(
                "linkedScheduledOccurrenceDate"))
    }

    @Test
    func plannedLinksKeepIncomeAndExpensesSeparateEvenForMatchingMerchantsOrAmounts() throws {
        let expense = try plannedLinkFixture(
            id: "expense", amounts: [-1500, 500], merchantID: "merchant")
        let income = try plannedLinkFixture(
            id: "income", amounts: [1500, -500], merchantID: "merchant")
        let legacy = TransactionEditorPlannedTransaction(
            id: "legacy", nextDate: "2026-09-08", bankAccountId: "account")
        var draft = TransactionEditorDraft(workspace: workspace(), now: referenceDate())
        draft.accountID = "account"
        draft.merchantID = "merchant"
        draft.setAmount(1000)
        #expect(expense.matches(draft))
        #expect(expense.isSuggested(for: draft))
        #expect(!income.matches(draft))
        #expect(!income.isSuggested(for: draft))
        draft.setFlow(.inflow)
        #expect(income.matches(draft))
        #expect(income.isSuggested(for: draft))
        #expect(!expense.matches(draft))
        #expect(!expense.isSuggested(for: draft))
        // The selected direction remains meaningful before entering an amount.
        draft.setAmount(0)
        #expect(income.matches(draft))
        #expect(!expense.matches(draft))
        #expect(legacy.matches(draft))
    }

    @Test
    func plannedLinkSuggestionsLeadTheFullListAndUpdateWithTheDraft() async throws {
        let other = try plannedLinkFixture(id: "other", amounts: [-4_000])
        let merchant = try plannedLinkFixture(
            id: "merchant", amounts: [-9_000], merchantID: "first")
        let amount = try plannedLinkFixture(id: "amount", amounts: [-1_000])
        let last = try plannedLinkFixture(id: "last", amounts: [-6_000])
        var paused = amount
        paused.status = "paused"
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in
                var choices = self.suggestionChoices()
                choices.plannedTransactions = [other, merchant, amount, last, paused]
                return choices
            })
        defer { store.stop() }
        await store.load()
        store.selectAccount("account")
        store.draft?.merchantID = "first"
        store.draft?.amount = 1_000
        #expect(
            store.linkablePlannedTransactions.map(\.id) == ["merchant", "amount", "other", "last"])
        // Search still reaches an unsuggested plan after the stable partition.
        let matches = store.linkablePlannedTransactions.filter {
            TransactionPlannedLinkDetails(
                plan: $0, choices: store.choices, workspace: store.workspace
            )
            .matches(search: "last")
        }
        #expect(matches.map(\.id) == ["last"])
        store.draft?.merchantID = nil
        store.draft?.amount = 6_000
        #expect(
            store.linkablePlannedTransactions.map(\.id) == ["last", "other", "merchant", "amount"])
        store.draft?.amount = 0
        #expect(
            store.linkablePlannedTransactions.map(\.id) == ["other", "merchant", "amount", "last"])
        store.selectAccount("other-account")
        #expect(store.linkablePlannedTransactions.isEmpty)
    }

    private func plannedLinkFixture(id: String, amounts: [Int64], merchantID: String? = nil)
        throws -> TransactionEditorPlannedTransaction
    {
        var values: [String: ConvexEncodable?] = [
            "_id": id, "nextDate": "2026-09-09", "bankAccountId": "account",
            "merchantName": id, "status": "active",
            "movements": amounts.map { movement($0) as ConvexEncodable? },
        ]
        if let merchantID { values["merchantId"] = merchantID }
        return try JSONDecoder().decode(
            TransactionEditorPlannedTransaction.self, from: Data(values.convexEncode().utf8))
    }

    @Test
    func unnamedPlansUseCategoriesAndMissingAmountsAreNotShownAsZero() throws {
        let values: [String: ConvexEncodable?] = [
            "_id": "bill", "nextDate": "2026-09-09", "bankAccountId": "account",
            "recurrence": "once",
            "movements": [movement(2_500, category: "groceries") as ConvexEncodable?],
        ]
        let plan = try JSONDecoder().decode(
            TransactionEditorPlannedTransaction.self, from: Data(values.convexEncode().utf8))
        let details = TransactionPlannedLinkDetails(
            plan: plan, choices: suggestionChoices(), workspace: workspace())
        #expect(details.name == "Groceries")
        #expect(details.amountTitle?.hasPrefix("+") == true)
        #expect(details.recurrenceTitle == L10n.string("Once"))
        let incomplete = TransactionEditorPlannedTransaction(
            id: "old", nextDate: "2026-09-09", bankAccountId: "account")
        #expect(
            TransactionPlannedLinkDetails(
                plan: incomplete, choices: .init(), workspace: workspace()
            ).amountTitle == nil)
    }

    @Test
    func completedAndPausedPlansKeepDetailsButCannotBeSelectedAsNewLinks() async throws {
        let active = TransactionEditorPlannedTransaction(
            id: "active", nextDate: "2026-09-09", bankAccountId: "account", status: "active")
        var completed = active
        completed.status = "completed"
        let details = TransactionPlannedLinkDetails(
            plan: completed, choices: suggestionChoices(), workspace: workspace())
        #expect(details.dueTitle(today: "2026-09-10") == L10n.string("Completed"))
        #expect(!completed.isLinkable)
        var paused = active
        paused.status = "paused"
        #expect(!paused.isLinkable)
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in
                var choices = self.suggestionChoices()
                choices.plannedTransactions = [completed, paused]
                return choices
            })
        await store.load()
        store.selectAccount("account")
        store.draft?.setAmount(1_200)
        #expect(store.choices.plannedTransactions.count == 2)
        #expect(store.linkablePlannedTransactions.isEmpty)
        store.draft?.scheduledTransactionID = "active"
        #expect(!store.canSave)
        store.stop()
    }

    @Test(arguments: [false, true])
    func newTransactionSavesTheSelectedPlannedLink(isTransfer: Bool) async throws {
        var savedDraft: TransactionEditorDraft?
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in
                var choices = self.suggestionChoices()
                choices.plannedTransactions = [
                    TransactionEditorPlannedTransaction(
                        id: "existing-plan", nextDate: "2026-09-05", bankAccountId: "account",
                        transferToAccountId: isTransfer ? "other-account" : nil,
                        transactionType: isTransfer ? "transfer" : "regular")
                ]
                return choices
            },
            creationHandler: { request in
                savedDraft = request.draft
                #expect(
                    request.arguments["linkedScheduledTransactionId"] as? String == "existing-plan")
                return TransactionCreationResult(
                    transactionId: "created", scheduledTransactionId: nil, budgetChanges: [])
            })
        await store.load()
        #expect(store.canLinkPlannedTransaction)
        store.draft?.setCreatesTransfer(isTransfer)
        store.selectAccount("account")
        if isTransfer { store.selectTransferAccount("other-account") }
        store.draft?.setAmount(1_200)
        store.draft?.scheduledTransactionID = "existing-plan"
        #expect(store.linkablePlannedTransactions.map(\.id) == ["existing-plan"])
        #expect(store.canSave)
        #expect(await store.save())
        #expect(savedDraft?.scheduledTransactionID == "existing-plan")
        #expect(store.savedReceipt?.isScheduledOnly == false)
        store.stop()
    }

    @Test
    func plannedTransferChoicesRespectBothAccountsAndDirection() {
        let plan = TransactionEditorPlannedTransaction(
            id: "transfer", nextDate: "2026-09-05", bankAccountId: "account",
            transferToAccountId: "other-account", transactionType: "transfer")
        var draft = TransactionEditorDraft(workspace: workspace(), now: referenceDate())
        draft.accountID = "account"
        draft.transferAccountID = "other-account"
        #expect(!plan.matches(draft))
        draft.setCreatesTransfer(true)
        #expect(plan.matches(draft))
        draft.transferAccountID = "wrong-account"
        #expect(!plan.matches(draft))
        draft.setFlow(.inflow)
        draft.accountID = "other-account"
        draft.transferAccountID = "account"
        #expect(plan.matches(draft))
    }

    @Test
    func changedAccountInvalidatesANewPlannedLinkAndRemovingItAllowsSaving() async {
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in
                var choices = self.suggestionChoices()
                choices.plannedTransactions = [
                    TransactionEditorPlannedTransaction(
                        id: "existing-plan", nextDate: "2026-09-05", bankAccountId: "account")
                ]
                return choices
            })
        await store.load()
        store.draft?.setAmount(1_200)
        store.selectAccount("account")
        store.draft?.scheduledTransactionID = "existing-plan"
        #expect(store.canSave)
        store.selectAccount("other-account")
        #expect(store.linkablePlannedTransactions.isEmpty)
        #expect(!store.canSave)
        store.draft?.scheduledTransactionID = nil
        #expect(store.canSave)
        store.stop()
    }

    @Test
    func preselectedFutureDateCannotCreateAndLinkAPlanTogether() async {
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in self.suggestionChoices() })
        store.preselectPlannedDate("2026-12-01")
        await store.load()
        store.selectAccount("account")
        store.draft?.setAmount(1_200)
        store.draft?.scheduledTransactionID = "existing-plan"
        #expect(store.validationMessage?.contains("either") == true)
        #expect(!store.canSave)
        store.stop()
    }

    @Test
    func firstNewSplitStartsAtZeroAndReopeningKeepsTheAppliedAmounts() {
        let original = [
            TransactionEditorAllocation(amount: -1_000, categoryID: "groceries", notes: "Keep note")
        ]
        var selection = TransactionSplitCategorySelection(allocations: original)
        selection.toggle("dining")
        let empty = selection.allocations(
            from: original, orderedIDs: ["groceries", "dining"],
            total: -1_000, startAtZero: true)
        #expect(empty.map(\.amount) == [0, 0])
        #expect(empty.first?.categoryID == "groceries")
        #expect(empty.first?.notes == "Keep note")
        var applied = empty
        applied[0].amount = -400
        applied[1].amount = -600
        #expect(
            selection.allocations(
                from: applied, orderedIDs: ["groceries", "dining"], total: -1_000) == applied)
    }

    @Test(arguments: [Int64(-1), Int64(1)])
    func fillRemainingIncludesTheCurrentSplitAndPreservesOtherSplits(sign: Int64) throws {
        var allocations: [TransactionEditorAllocation] = [
            .init(amount: 200 * sign, categoryID: "groceries"),
            .init(amount: 300 * sign, categoryID: "dining"),
        ]
        let funding = TransactionSplitFunding(target: 1_000 * sign, allocations: allocations)
        #expect(funding.displayRemaining == 500)
        allocations[0].amount = try #require(funding.amountFillingRemaining(for: allocations[0].id))
        #expect(allocations[0].amount == 700 * sign)
        #expect(allocations[1].amount == 300 * sign)
        #expect(
            TransactionSplitFunding(target: 1_000 * sign, allocations: allocations).remaining == 0)
    }

    @Test
    func splitRemainingHandlesRefundsExcessAndOverflow() {
        let expense = TransactionEditorAllocation(amount: -800, categoryID: "groceries")
        let refund = TransactionEditorAllocation(amount: 200, categoryID: "dining")
        let mixed = TransactionSplitFunding(target: -1_000, allocations: [expense, refund])
        #expect(mixed.displayRemaining == 400)
        #expect(mixed.amountFillingRemaining(for: expense.id) == -1_200)
        let excess = TransactionSplitFunding(target: -500, allocations: [expense, refund])
        #expect(excess.displayRemaining == -100)
        #expect(excess.amountFillingRemaining(for: expense.id) == -700)
        #expect(excess.amountFillingRemaining(for: "missing") == nil)
        let overflow = TransactionSplitFunding(
            target: 1,
            allocations: [
                .init(amount: Int64.max, categoryID: nil), .init(amount: 1, categoryID: nil),
            ])
        #expect(overflow.remaining == nil)
        let minimum = TransactionSplitFunding(target: Int64.min, allocations: [])
        #expect(minimum.displayRemaining == nil)
    }

    @Test(arguments: [CGFloat(0), CGFloat(1)])
    func splitAmountRevealReservesUpwardScrollEvenAtTheTop(initialOffset: CGFloat) throws {
        let focus = BudgetAssignmentFocus()
        func geometry(contentHeight: CGFloat) -> ScrollGeometry {
            ScrollGeometry(
                contentOffset: CGPoint(x: 0, y: initialOffset - 74),
                contentSize: CGSize(width: 390, height: contentHeight),
                contentInsets: EdgeInsets(top: 74, leading: 0, bottom: 0, trailing: 0),
                containerSize: CGSize(width: 390, height: 526))
        }
        focus.geometry = geometry(contentHeight: 340)
        focus.contentOriginY = 74 - initialOffset
        focus.frames = ["split": CGRect(x: 20, y: 270, width: 180, height: 44)]
        let offset = try #require(focus.prepareReveal(categoryID: "split", viewportBottom: 250))
        #expect(offset > initialOffset)
        var revealed = false
        focus.openAfterRevealLayout { revealed = true }
        #expect(focus.readyOpeningRequest() == nil)
        #expect(!revealed)
        focus.geometry = geometry(contentHeight: 340 + focus.revealBottomPadding)
        focus.completeOpening(try #require(focus.readyOpeningRequest()))
        #expect(revealed)
        #expect(offset <= 340 + focus.revealBottomPadding - 526)
    }

    @Test
    func splitSelectionKeepsCurrentCategoryAndRequiresMultipleChoices() {
        let original = [
            TransactionEditorAllocation(amount: -1_000, categoryID: "groceries", notes: "Keep me")
        ]
        var selection = TransactionSplitCategorySelection(allocations: original)
        #expect(selection.selectedIDs == ["groceries"])
        #expect(!selection.canContinue)
        selection.toggle("dining")
        #expect(selection.canContinue)
        let result = selection.allocations(
            from: original, orderedIDs: ["dining", "groceries"], total: -1_000)
        #expect(result.count == 2)
        #expect(result[0] == original[0])
        #expect(result[1].categoryID == "dining")
        #expect(result[1].amount == 0)
        selection.toggle("groceries")
        #expect(!selection.canContinue)
        #expect(original.count == 1)
        #expect(original[0].amount == -1_000)
    }

    @Test
    func newSplitSelectionDoesNotPreselectPlaceholderAndKeepsExistingSplitNotes() {
        let empty = TransactionSplitCategorySelection(
            allocations: [.init(amount: -1_000, categoryID: nil)], includesUncategorized: false)
        #expect(empty.selectedIDs.isEmpty)
        let original: [TransactionEditorAllocation] = [
            .init(amount: -800, categoryID: "groceries", notes: "Expense"),
            .init(amount: 200, categoryID: "groceries", notes: "Refund"),
            .init(amount: -400, categoryID: nil, readyToAssign: true),
        ]
        let selection = TransactionSplitCategorySelection(allocations: original)
        #expect(selection.selectedIDs == ["groceries", "rta"])
        #expect(
            selection.allocations(from: original, orderedIDs: ["rta", "groceries"], total: -1_000)
                == original)
    }

    @Test
    func statusChangesDoNotValidateAnUntouchedNewAmount() {
        let editor = TransactionEditorStore(workspace: workspace(), now: referenceDate)
        for status in [TransactionFeedStatus.pending, .cleared, .pending] {
            editor.draft?.status = status
            #expect(editor.inlineValidationMessage == nil)
            #expect(editor.validationMessage == L10n.string("Enter an amount greater than zero."))
            #expect(!editor.canSave)
        }
        // Once the amount itself has been edited, its validation still appears.
        editor.setAmount(from: AmountCalculator(amount: 0, minorUnit: 2))
        #expect(editor.inlineValidationMessage == L10n.string("Enter an amount greater than zero."))
        editor.setAmount(from: AmountCalculator(amount: 100, minorUnit: 2))
        #expect(editor.inlineValidationMessage == L10n.string("Choose an account."))
    }

    @Test
    func newTransactionTitleStaysTheSameWhenScheduling() {
        let editor = TransactionEditorStore(workspace: workspace(), now: referenceDate)
        #expect(editor.editorTitle == L10n.string("New transaction"))
        editor.preselectPlannedDate("2026-12-01", recurrence: .monthly)
        #expect(editor.isPlanned)
        #expect(editor.editorTitle == L10n.string("New transaction"))
        let existing = TransactionEditorStore(workspace: workspace(), transactionID: "recorded")
        #expect(existing.editorTitle == L10n.string("Edit transaction"))
    }

    @Test
    func splitPeekAmountsPreserveRefundDirectionCategoryAndNotes() {
        var refund = TransactionEditorAllocation(
            amount: 500, categoryID: "groceries", notes: "Refund")
        refund.setSplitAmount(250, transactionAmount: -1_000)
        #expect(refund.amount == 250)
        #expect(refund.categoryID == "groceries")
        #expect(refund.notes == "Refund")
        var expense = TransactionEditorAllocation(amount: -500, categoryID: nil)
        expense.setSplitAmount(800, transactionAmount: 1_000)
        #expect(expense.amount == -800)
        var empty = TransactionEditorAllocation(amount: 0, categoryID: nil)
        empty.setSplitAmount(Int64.max, transactionAmount: -1_000)
        #expect(empty.amount == -Int64.max)
        empty.setSplitAmount(-1, transactionAmount: -1_000)
        #expect(empty.amount == -Int64.max)
    }

    @Test(arguments: [false, true])
    func transactionEditorUsesNativeNavigationToolbarAndScrollEdges(isEditing: Bool)
        async throws
    {
        let editor = TransactionEditorStore(
            workspace: workspace(), transactionID: isEditing ? "recorded" : nil,
            now: referenceDate)
        // Supply a draft for both modes so this checks the full-height edit sheet
        // as well as the shorter foreground above the new-transaction keypad.
        editor.draft = TransactionEditorStore(workspace: workspace(), now: referenceDate).draft
        let expectedTitle = editor.editorTitle
        var inspected = false
        _ = try await HostedViewSnapshot.image(
            of: TransactionEditorView(store: editor), size: CGSize(width: 390, height: 844),
            inspect: { root in
                func inspect(_ view: UIView) {
                    if let scroll = view as? UIScrollView,
                        scroll.contentSize.height > scroll.bounds.height
                    {
                        inspected = true
                        if #available(iOS 26.0, *) {
                            #expect(!scroll.topEdgeEffect.isHidden)
                            #expect(!scroll.bottomEdgeEffect.isHidden)
                        }
                        var responder: UIResponder? = scroll
                        var navigation: UINavigationController?
                        while let current = responder {
                            if let controller = current as? UIViewController,
                                let owner = controller.navigationController
                            {
                                navigation = owner
                                break
                            }
                            responder = current.next
                        }
                        #expect(navigation != nil)
                        #expect(navigation?.isNavigationBarHidden == false)
                        #expect(navigation?.navigationBar.topItem?.title == expectedTitle)
                        #expect(
                            navigation?.navigationBar.topItem?.leftBarButtonItems?.isEmpty == false)
                        #expect(
                            navigation?.navigationBar.topItem?.rightBarButtonItems?.isEmpty == false
                        )
                        let topInset = scroll.adjustedContentInset.top
                        let viewport = scroll.frame
                        // The system navigation bar stays fixed while its content scrolls.
                        scroll.setContentOffset(
                            CGPoint(x: 0, y: 120 - topInset), animated: false)
                        root.layoutIfNeeded()
                        #expect(scroll.frame == viewport)
                        #expect(scroll.adjustedContentInset.top == topInset)
                        #expect(
                            abs(scroll.contentOffset.y + topInset - 120) < 1
                        )
                        if #available(iOS 26.0, *) {
                            #expect(!scroll.topEdgeEffect.isHidden)
                            #expect(!scroll.bottomEdgeEffect.isHidden)
                        }
                    }
                    for child in view.subviews { inspect(child) }
                }
                inspect(root)
            })
        #expect(inspected)
    }

    @Test
    func sharedChoicesStayLiveAcrossEditorsWithoutResubscribing() async {
        let source = PassthroughSubject<TransactionEditorChoices, Error>()
        var subscriptions = 0
        var cancellations = 0
        var sheetLoads = 0
        let shared = TransactionEditorChoicesStore(workspaceID: workspace().id) {
            subscriptions += 1
            return source.handleEvents(receiveCancel: { cancellations += 1 }).eraseToAnyPublisher()
        }
        defer { shared.stop() }
        shared.start()
        shared.start()
        source.send(suggestionChoices())
        await waitUntil { shared.states.value.choices != nil }

        for _ in 0..<3 {
            let editor = TransactionEditorStore(
                workspace: workspace(),
                choicesLoader: { _ in
                    sheetLoads += 1
                    return TransactionEditorChoices()
                }, choicesStore: shared)
            #expect(editor.choices.merchants.count == 2)
            #expect(!editor.isLoadingChoices)
            // Preloading must not prevent the account page's initial selection.
            editor.preselectAccount("other-account")
            #expect(editor.draft?.accountID == "other-account")
            #expect(!editor.isDirty)
            await editor.load()
            editor.stop()
        }
        #expect(subscriptions == 1)
        #expect(cancellations == 0)
        #expect(sheetLoads == 0)

        let editor = TransactionEditorStore(workspace: workspace(), choicesStore: shared)
        await editor.load()
        var updated = suggestionChoices()
        updated.merchants.append(.init(id: "new", name: "New merchant"))
        source.send(updated)
        await waitUntil { editor.choices.merchants.count == 3 }
        editor.stop()
        shared.stop()
        #expect(cancellations == 1)
        #expect(shared.states.value.choices == nil)
        source.send(suggestionChoices())
        #expect(shared.states.value.choices == nil)
    }

    @Test
    func openingBeforePreloadCompletesDoesNotBlockAndRetryIsShared() async {
        var source = PassthroughSubject<TransactionEditorChoices, Error>()
        var subscriptions = 0
        let shared = TransactionEditorChoicesStore(workspaceID: workspace().id) {
            subscriptions += 1
            return source.eraseToAnyPublisher()
        }
        defer { shared.stop() }
        shared.start()
        let editor = TransactionEditorStore(workspace: workspace(), choicesStore: shared)
        let loading = Task { await editor.load() }
        await waitUntil { editor.isLoadingChoices }
        #expect(editor.draft != nil)
        #expect(subscriptions == 1)
        source.send(completion: .failure(TransactionEditorError.saveFailed))
        await waitUntil { editor.choicesErrorMessage != nil }
        await loading.value
        source = PassthroughSubject<TransactionEditorChoices, Error>()
        await editor.reloadChoices()
        #expect(subscriptions == 2)
        source.send(TransactionEditorChoices())
        await waitUntil { !editor.isLoadingChoices }
        #expect(editor.choicesErrorMessage == nil)
        editor.stop()
    }

    @Test
    func newCategoryStartsAsAChoiceButExplicitUncategorizedIsPreserved() {
        let editor = TransactionEditorStore(workspace: workspace())
        #expect(editor.needsCategorySelection)
        editor.selectCategory("none")
        #expect(!editor.needsCategorySelection)
        #expect(editor.draft?.allocations.first?.categoryID == nil)
        editor.selectCategory("groceries")
        #expect(!editor.needsCategorySelection)
        #expect(editor.draft?.allocations.first?.categoryID == "groceries")
        let editing = TransactionEditorStore(workspace: workspace(), transactionID: "existing")
        #expect(!editing.needsCategorySelection)
    }

    @Test func selectingInflowDefaultsAnUnselectedNewCategoryToReadyToAssign() {
        let editor = TransactionEditorStore(workspace: workspace())
        editor.draft?.setAmount(1_200)
        editor.selectFlow(.outflow)
        #expect(editor.needsCategorySelection)
        editor.selectFlow(.inflow)
        #expect(editor.draft?.flow == .inflow)
        #expect(editor.draft?.allocations.first?.readyToAssign == true)
        #expect(editor.draft?.allocations.first?.amount == 1_200)
        #expect(!editor.needsCategorySelection)
    }

    @Test(arguments: ["groceries", "rta", "none"])
    func selectingInflowPreservesAnExplicitCategoryChoice(category: String) {
        let editor = TransactionEditorStore(workspace: workspace())
        editor.selectCategory(category)
        let allocation = editor.draft?.allocations.first
        editor.selectFlow(.inflow)
        #expect(editor.draft?.allocations.first?.categoryID == allocation?.categoryID)
        #expect(editor.draft?.allocations.first?.readyToAssign == allocation?.readyToAssign)
    }

    @Test func inflowDefaultDoesNotReplaceSuggestedCategoriesSplitsOrTransferAllocations() {
        let suggested = TransactionEditorStore(workspace: workspace())
        suggested.draft?.setCategory("groceries")
        suggested.selectFlow(.inflow)
        #expect(suggested.draft?.allocations.first?.categoryID == "groceries")
        let split = TransactionEditorStore(workspace: workspace())
        split.draft?.allocations = [.init(amount: -500), .init(amount: -700, categoryID: "dining")]
        split.selectFlow(.inflow)
        #expect(split.draft?.allocations.count == 2)
        #expect(split.draft?.allocations.first?.readyToAssign == false)
        #expect(split.draft?.allocations.last?.categoryID == "dining")
        let transfer = TransactionEditorStore(workspace: workspace())
        transfer.draft?.setCreatesTransfer(true)
        transfer.selectFlow(.inflow)
        #expect(transfer.draft?.allocations.first?.readyToAssign == false)
    }

    @Test func editingAnExistingTransactionDoesNotDefaultItsCategoryOnInflow() async throws {
        let detail = try fixture(movements: [movement(-1_200)])
        let editor = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, detailLoader: { _, _ in detail })
        await editor.load()
        editor.selectFlow(.inflow)
        #expect(editor.draft?.allocations.first?.readyToAssign == false)
        #expect(editor.draft?.allocations.first?.categoryID == nil)
    }

    @Test func widgetCapturePresetsDirectionWithoutSavingOrMakingDraftDirty() {
        let income = TransactionEditorStore(workspace: workspace(), now: referenceDate)
        income.preselectWidgetCapture(.income, shortcut: nil)
        #expect(income.draft?.flow == .inflow)
        #expect(income.draft?.isTransfer == false)
        #expect(!income.isDirty)
        #expect(income.savedReceipt == nil)

        let transfer = TransactionEditorStore(workspace: workspace(), now: referenceDate)
        transfer.preselectWidgetCapture(.transfer, shortcut: nil)
        #expect(transfer.draft?.isTransfer == true)
        #expect(transfer.draft?.flow == .outflow)
        #expect(!transfer.isDirty)
    }

    @Test func widgetShortcutPreservesAmountSignAndDoesNotOverwriteEditedDraft() async {
        let store = TransactionEditorStore(workspace: workspace(), now: referenceDate)
        let shortcut = TransactionShortcutDraft(
            amount: 12.34, direction: .inflow, payee: "A new payee", account: nil,
            category: nil, date: nil, notes: "From a shortcut")
        store.preselectWidgetCapture(.income, shortcut: shortcut)
        await store.load()
        #expect(store.draft?.amount == 1234)
        #expect(store.draft?.signedAmount == 1234)
        #expect(store.draft?.pendingMerchantName == "A new payee")
        #expect(store.draft?.notes == "From a shortcut")
        #expect(store.isDirty)
        store.draft?.notes = "My edit"
        store.preselectWidgetCapture(.expense, shortcut: nil)
        #expect(store.draft?.notes == "My edit")
        #expect(store.draft?.flow == .inflow)
        store.stop()
    }

    @Test func rulesReuseTextOnlyCategoryChoicesAndPreserveUnknownSelections() {
        let picker = RuleChoicePicker(
            title: "Categories", choices: [.init(id: "food", name: "Food", groupName: "Everyday")],
            selection: .constant(["missing"]), allowsMultiple: false,
            emptyLabel: "Leave unchanged", unavailableLabel: "Unavailable category", icon: .category
        )
        #expect(picker.pickerChoices.map(\.id) == ["", "missing", "food"])
        #expect(picker.pickerChoices.allSatisfy { $0.symbol == nil && !$0.circularIcon })
        #expect(picker.pickerChoices.last?.groupTitle == "Everyday")
    }

    @Test func ruleAccountsUseTransactionLogoTreatment() {
        let picker = RuleChoicePicker(
            title: "Accounts",
            choices: [
                .init(
                    id: "card", name: "Card", groupName: "Credit",
                    logoURL: "https://example.com/bank.png", accountType: "credit_card")
            ],
            selection: .constant(["card"]), allowsMultiple: true,
            emptyLabel: "Any account", unavailableLabel: "Unavailable account", icon: .accounts)
        #expect(
            picker.pickerChoices.last?.logoURL?.absoluteString == "https://example.com/bank.png")
        #expect(picker.pickerChoices.last?.symbol == .creditCard)
        #expect(picker.pickerChoices.last?.circularIcon == true)
    }

    @Test func sharedPickerSupportsMultipleSelectionsWithoutChangingSingleSelection() {
        let single = TransactionEditorPicker(
            title: "Category", choices: [], selectedID: "one", onSelect: { _ in })
        #expect(single.isSelected("one"))
        #expect(!single.isSelected("two"))
        let multiple = TransactionEditorPicker(
            title: "Accounts", choices: [], selectedID: nil,
            selectedIDs: ["one", "two"], isEmbedded: true, dismissesOnSelection: false,
            onSelect: { _ in })
        #expect(multiple.isSelected("one"))
        #expect(multiple.isSelected("two"))
        #expect(!multiple.isSelected("three"))
    }

    @Test
    func sheetHandoffWaitsForCompletedAppearanceAndOnlyRunsOnce() {
        let observer = TransactionEditorDismissalObserver.Controller()
        var handoffs = 0
        observer.onPresented = { handoffs += 1 }
        observer.loadViewIfNeeded()
        observer.viewWillAppear(true)
        observer.viewDidLayoutSubviews()
        #expect(handoffs == 0)

        observer.viewDidAppear(true)
        #expect(handoffs == 1)
        // A nested picker returning, or SwiftUI updating the callback, cannot
        // dismiss a newer keypad session on the underlying budget page.
        observer.onPresented = { handoffs += 10 }
        observer.viewWillAppear(true)
        observer.viewDidAppear(true)
        #expect(handoffs == 1)
    }

    @Test
    func dismissalAttachmentMaintainsNativeLockAcrossEditsAndDelegateReplacement() {
        let observer = TransactionEditorDismissalObserver.Controller()
        let sheet = UIViewController()
        let presentation = UIPresentationController(
            presentedViewController: sheet, presenting: UIViewController())
        observer.attach(to: presentation)
        #expect(presentation.delegate === observer)
        #expect(!sheet.isModalInPresentation)

        observer.isDirty = true
        observer.attach(to: presentation)
        #expect(sheet.isModalInPresentation)
        presentation.delegate = nil
        observer.attach(to: presentation)
        #expect(presentation.delegate === observer)
        #expect(!observer.presentationControllerShouldDismiss(presentation))

        observer.isDirty = false
        observer.isSaving = true
        observer.attach(to: presentation)
        #expect(sheet.isModalInPresentation)
        observer.isSaving = false
        observer.attach(to: presentation)
        #expect(!sheet.isModalInPresentation)
        observer.detach()
        #expect(presentation.delegate == nil)
    }

    @Test
    func swipeDismissalPromptsOnlyForUnsavedEditsAndBlocksSaving() {
        let observer = TransactionEditorDismissalObserver.Controller()
        let presentation = UIPresentationController(
            presentedViewController: UIViewController(), presenting: UIViewController())
        var attempts = 0
        observer.onAttempt = { attempts += 1 }
        #expect(observer.presentationControllerShouldDismiss(presentation))
        observer.presentationControllerDidAttemptToDismiss(presentation)
        #expect(attempts == 0)

        observer.isDirty = true
        #expect(!observer.presentationControllerShouldDismiss(presentation))
        observer.presentationControllerDidAttemptToDismiss(presentation)
        #expect(attempts == 1)

        observer.isSaving = true
        #expect(!observer.presentationControllerShouldDismiss(presentation))
        observer.presentationControllerDidAttemptToDismiss(presentation)
        #expect(attempts == 1)
        observer.isDirty = false
        #expect(!observer.presentationControllerShouldDismiss(presentation))
        observer.isSaving = false
        #expect(observer.presentationControllerShouldDismiss(presentation))
    }

    @Test
    func merchantCardsSortNumbersThenLettersAndRetainSearchGroups() {
        let merchants = [
            TransactionEditorMerchant(id: "z", name: "Zebra"),
            TransactionEditorMerchant(
                id: "a", name: "amazon", logoUrl: "https://example.com/a.png"),
            TransactionEditorMerchant(id: "7", name: "7-Eleven"),
            TransactionEditorMerchant(id: "1", name: "1Password"),
            TransactionEditorMerchant(id: "e", name: " Éclair"),
            TransactionEditorMerchant(id: "symbol", name: "#Shop"),
            TransactionEditorMerchant(id: "b", name: "Best Buy"),
        ]
        let choices = TransactionEditorMerchant.pickerChoices(merchants)
        let sections = TransactionEditorChoiceSection.build(choices, search: "")
        #expect(sections.map(\.title) == ["0–9", "A", "B", "E", "Z", "Other"])
        #expect(sections[0].choices.map(\.id) == ["1", "7"])
        #expect(
            choices.first { $0.id == "a" }?.logoURL?.absoluteString == "https://example.com/a.png")
        let filtered = TransactionEditorChoiceSection.build(choices, search: "Best Buy")
        #expect(filtered.map(\.title) == ["B"])
        #expect(filtered[0].choices.map(\.id) == ["b"])
    }

    @Test
    func merchantPickerKeepsEveryRowAndStableTiesInLargeGroups() {
        let merchants = (0..<576).reversed().map { index in
            TransactionEditorMerchant(
                id: String(format: "%04d", index), name: "Amazon",
                logoUrl: "https://example.com/\(index).png")
        }
        let choices = TransactionEditorMerchant.pickerChoices(merchants)
        let sections = TransactionEditorChoiceSection.build(choices, search: "")
        #expect(sections.count == 1)
        #expect(sections.first?.title == "A")
        #expect(sections.first?.choices.count == 576)
        #expect(choices.map(\.id) == (0..<576).map { String(format: "%04d", $0) })
        #expect(choices.first?.logoURL?.absoluteString == "https://example.com/0.png")
        #expect(choices.last?.logoURL?.absoluteString == "https://example.com/575.png")
        #expect(TransactionEditorChoiceSection.build(choices, search: "missing").isEmpty)
    }

    @Test
    func pickerGroupingPreservesUngroupedRowsAndSearchesSubtitles() {
        let choices = [
            TransactionEditorChoice(id: "first", title: "First"),
            TransactionEditorChoice(
                id: "bill", title: "Bill", groupID: "bills", groupTitle: "Bills"),
            TransactionEditorChoice(id: "second", title: "Second", subtitle: "Coffee"),
            TransactionEditorChoice(
                id: "rent", title: "Rent", groupID: "bills", groupTitle: "Bills"),
        ]
        let sections = TransactionEditorChoiceSection.build(choices, search: "")
        #expect(sections.map(\.id) == [nil, "bills"])
        #expect(sections[0].choices.map(\.id) == ["first", "second"])
        #expect(sections[1].choices.map(\.id) == ["bill", "rent"])
        let subtitleMatch = TransactionEditorChoiceSection.build(choices, search: " coffee ")
        #expect(subtitleMatch.count == 1)
        #expect(subtitleMatch.first?.choices.map(\.id) == ["second"])
        let groupMatch = TransactionEditorChoiceSection.build(choices, search: "Bills")
        #expect(groupMatch.first?.choices.map(\.id) == ["bill", "rent"])
    }

    @Test
    func hierarchyPreservesGroupIdentityAndCategoryOrder() throws {
        let data = Data(
            """
            [{"group":{"_id":"g1","name":"Bills"},"categories":[
                {"_id":"c2","name":"Rent"},{"_id":"c1","name":"Electricity"},
                {"_id":"hidden","name":"Old","isArchived":true}]},
             {"group":{"_id":"g2","name":"Bills"},"categories":[
                {"_id":"c3","name":"Insurance"}]}]
            """.utf8)
        let hierarchy = try JSONDecoder().decode(
            [TransactionEditorCategoryHierarchy].self, from: data)
        let categories = hierarchy.flatMap(\.selectableCategories)
        #expect(categories.map(\.id) == ["c2", "c1", "c3"])
        let choices = categories.map {
            TransactionEditorChoice(
                id: $0.id, title: $0.name,
                groupID: $0.categoryGroupId, groupTitle: $0.groupName)
        }
        let sections = TransactionEditorChoiceSection.build(choices, search: "Bills")
        #expect(sections.map(\.id) == ["g1", "g2"])
        #expect(sections[0].choices.map(\.id) == ["c2", "c1"])
        let filtered = TransactionEditorChoiceSection.build(choices, search: "insurance")
        #expect(filtered.map(\.id) == ["g2"])
    }

    @Test
    func accountsDecodeResolvedLogosAndKeepManualFallback() throws {
        let data = Data(
            """
            [{"_id":"a1","name":"Checking","accountType":"banking_checking",
              "resolvedLogoUrl":"https://example.com/bank.png"},
             {"_id":"a2","name":"Card","accountType":"credit_credit_card"}]
            """.utf8)
        let accounts = try JSONDecoder().decode([TransactionEditorAccount].self, from: data)
        #expect(accounts[0].pickerChoice.logoURL?.absoluteString == "https://example.com/bank.png")
        #expect(accounts[1].pickerChoice.logoURL == nil)
        #expect(accounts.allSatisfy { $0.pickerChoice.circularIcon })
        #expect(accounts[1].pickerChoice.symbol == .creditCard)
        #expect(accounts.map(\.pickerGroup) == ["Banking", "Credit"])
    }

    @Test
    func initiallyOpenKeypadCanCloseAndReopenWithAnIndependentSession() throws {
        var presentation = PeekPresentation(initiallyPresented: true)
        let initialSessionID = try #require(presentation.sessionID)
        #expect(presentation.isPresented)

        presentation.dismissForFocusChange()
        #expect(!presentation.isPresented)
        #expect(presentation.sessionID == nil)

        presentation.open()
        #expect(presentation.sessionID != initialSessionID)
        presentation.finishClosing(sessionID: initialSessionID)
        #expect(presentation.isPresented)
    }

    @Test
    func closedKeypadHasNoBackLayerForTheKeyboardToReveal() throws {
        var presentation = PeekPresentation()
        #expect(!presentation.isPresented)
        #expect(presentation.sessionID == nil)

        presentation.open()
        let sessionID = try #require(presentation.sessionID)
        #expect(presentation.isPresented)
        presentation.beginClosing()
        #expect(!presentation.isPresented)
        #expect(presentation.sessionID == sessionID)
        presentation.finishClosing(sessionID: sessionID)
        #expect(presentation.sessionID == nil)
    }

    @Test(arguments: [false, true])
    func anotherFieldImmediatelyRemovesAnOpenOrClosingKeypad(alreadyClosing: Bool) throws {
        var presentation = PeekPresentation()
        presentation.open()
        let sessionID = try #require(presentation.sessionID)
        if alreadyClosing { presentation.beginClosing() }

        presentation.dismissForFocusChange()
        #expect(!presentation.isPresented)
        #expect(presentation.sessionID == nil)
        presentation.finishClosing(sessionID: sessionID)
        #expect(presentation.sessionID == nil)
    }

    @Test
    func onlyInputTakeoversDismissTheTransactionAmountPad() {
        #expect(!TransactionEditorInteraction.inlineControl.takesOverAmountInput)
        #expect(TransactionEditorInteraction.destination.takesOverAmountInput)
        #expect(TransactionEditorInteraction.keyboard.takesOverAmountInput)
    }

    @Test
    func oldDismissalCannotRemoveAReopenedKeypadEvenIfItIsClosingAgain() throws {
        var presentation = PeekPresentation()
        presentation.open()
        let oldSessionID = try #require(presentation.sessionID)
        presentation.beginClosing()
        presentation.open()
        let newSessionID = try #require(presentation.sessionID)
        #expect(newSessionID != oldSessionID)
        presentation.finishClosing(sessionID: oldSessionID)
        #expect(presentation.isPresented)
        #expect(presentation.sessionID == newSessionID)

        presentation.beginClosing()
        presentation.finishClosing(sessionID: oldSessionID)
        #expect(presentation.sessionID == newSessionID)
        presentation.finishClosing(sessionID: newSessionID)
        #expect(presentation.sessionID == nil)
    }

    @Test
    func notesOnlyEditPreservesSplitsImportedMetadataAndReviewStatus() throws {
        let original = try TransactionEditorDraft(
            detail: fixture(
                movements: [
                    movement(-1_000, category: "groceries", notes: "food"),
                    movement(-200, readyToAssign: true, notes: "rounding"),
                ]
            ))
        var edited = original
        edited.notes = "Weekly shop"
        let arguments = request(edited, original: original).arguments
        #expect(arguments["notes"] as? String == "Weekly shop")
        #expect(arguments["preserveReviewStatus"] as? Bool == true)
        #expect(!arguments.keys.contains("movements"))
        #expect(!arguments.keys.contains("reviewStatus"))
        #expect(!arguments.keys.contains("status"))
        #expect(!arguments.keys.contains("date"))
        #expect(!arguments.keys.contains("linkedScheduledTransactionId"))
        #expect(!arguments.keys.contains("importDetails"))
        #expect(
            TransactionEditorSaveRequest.mutationName == "transactions:updateTransactionFromEditor")
    }

    @Test
    func changedSplitRetainsSignedAmountsReadyToAssignAndLineNotes() throws {
        let original = try TransactionEditorDraft(
            detail: fixture(
                movements: [
                    movement(-1_400, category: "groceries", notes: "food"),
                    movement(200, readyToAssign: true, notes: "refund"),
                ]
            ))
        var edited = original
        edited.allocations[0].categoryID = "dining"
        let payload = try #require(request(edited, original: original).arguments["movements"])
        let json = try #require(payload).convexEncode()
        let decoded = try JSONDecoder().decode(
            [TransactionEditorMovement].self, from: Data(json.utf8))
        #expect(decoded.map(\.amount) == [-1_400, 200])
        #expect(decoded.map(\.notes) == ["food", "refund"])
        #expect(decoded[0].categoryId == "dining")
        #expect(decoded[1].readyToAssign)
        #expect(edited.allocatedAmount == -1_200)
    }

    @Test
    func amountChangeDoesNotCollapseExistingSplit() throws {
        var draft = try TransactionEditorDraft(
            detail: fixture(
                movements: [
                    movement(-1_000, category: "groceries", notes: "food"),
                    movement(-200, category: "dining"),
                ]
            ))
        draft.setAmount(2_000)
        #expect(draft.amount == 2_000)
        #expect(draft.allocations.map(\.amount) == [-1_000, -200])
        draft.setFlow(.inflow)
        #expect(draft.allocations.map(\.amount) == [1_000, 200])
        #expect(draft.allocations[0].notes == "food")
    }

    @Test
    func singleAmountEditKeepsCategoryAndNotes() throws {
        var draft = try TransactionEditorDraft(
            detail: fixture(movements: [movement(-1_200, category: "groceries", notes: "food")]))
        draft.setAmount(2_345)
        #expect(draft.allocations[0].amount == -2_345)
        #expect(draft.allocations[0].categoryID == "groceries")
        #expect(draft.allocations[0].notes == "food")
    }

    @Test
    func keypadEditsUpdateTheDraftAndAllocationWithoutAnApplyStep() throws {
        var draft = try TransactionEditorDraft(
            detail: fixture(movements: [movement(-1_200, category: "groceries", notes: "food")]))
        var calculator = AmountCalculator(amount: draft.amount, minorUnit: 2)
        for digit in [2, 3, 4, 5] {
            calculator.appendDigit(digit)
            draft.setAmount(from: calculator)
            #expect(draft.amount == calculator.amount)
            #expect(draft.allocations[0].amount == -draft.amount)
        }
        #expect(draft.amount == 2_345)
        #expect(draft.allocations[0].categoryID == "groceries")
        #expect(draft.allocations[0].notes == "food")
        calculator.appendOperation(.subtract)
        draft.setAmount(from: calculator)
        #expect(draft.amount == 2_345)
        for digit in [9, 9, 9, 9] { calculator.appendDigit(digit) }
        draft.setAmount(from: calculator)
        #expect(calculator.error == .negativeAmount)
        #expect(draft.amount == 2_345)
        calculator.clear()
        draft.setAmount(from: calculator)
        #expect(draft.amount == 0)
        #expect(draft.allocations[0].amount == 0)
    }

    @Test
    func optionalClearsEncodeExplicitNullInsteadOfOmittingTheField() throws {
        let original = try TransactionEditorDraft(detail: fixture())
        var edited = original
        edited.merchantID = nil
        edited.notes = ""
        edited.scheduledTransactionID = nil
        let arguments = request(edited, original: original).arguments
        for field in ["merchantId", "notes", "linkedScheduledTransactionId"] {
            #expect(arguments.keys.contains(field))
            #expect(try arguments[field]??.convexEncode() == "null")
        }
    }

    @Test
    func incomingTransferKeepsItsSideAndCombinesMetadataIntoOnePatch() throws {
        let original = try TransactionEditorDraft(detail: fixture(amount: 1_200, type: "transfer"))
        var edited = original
        edited.setAmount(5_000)
        edited.accountID = "new-destination"
        edited.transferAccountID = "new-source"
        edited.setCategory("vacation")
        edited.status = .pending
        edited.notes = "Savings transfer"
        edited.scheduledTransactionID = "new-plan"
        let arguments = request(edited, original: original).arguments
        #expect(arguments["toAccountId"] as? String == "new-destination")
        #expect(arguments["fromAccountId"] as? String == "new-source")
        #expect(arguments["categoryId"] as? String == "vacation")
        #expect(arguments["readyToAssign"] as? Bool == false)
        #expect(arguments["status"] as? String == "pending")
        #expect(arguments["notes"] as? String == "Savings transfer")
        #expect(arguments["linkedScheduledTransactionId"] as? String == "new-plan")
        let movements = try #require(arguments["movements"] as? [ConvexEncodable?])
        let movement = try #require(movements[0] as? [String: ConvexEncodable?])
        #expect(movement["amount"] as? Int64 == 5_000)
    }

    @Test
    func outgoingTransferCategoryCanBeClearedWithoutChangingAmount() throws {
        var original = try TransactionEditorDraft(detail: fixture(type: "transfer"))
        original.setCategory("vacation")
        var edited = original
        edited.setCategory(nil)
        let arguments = request(edited, original: original).arguments
        #expect(arguments["readyToAssign"] as? Bool == false)
        #expect(!arguments.keys.contains("categoryId"))
        #expect(!arguments.keys.contains("movements"))
    }

    @Test
    func workspaceDateRoundTripsAcrossTimezonesAndRejectsImpossibleDates() throws {
        let workspace = workspace(timezone: "Australia/Sydney")
        let instant = try #require(ISO8601DateFormatter().date(from: "2026-09-04T23:30:00Z"))
        #expect(TransactionEditorDate.today(workspace: workspace, now: instant) == "2026-09-05")
        let date = try #require(
            TransactionEditorDate.date(from: "2026-09-05", workspace: workspace))
        #expect(TransactionEditorDate.key(from: date, workspace: workspace) == "2026-09-05")
        #expect(TransactionEditorDate.date(from: "2026-02-30", workspace: workspace) == nil)
        #expect(
            TransactionEditorDate.today(
                workspace: self.workspace(timezone: "invalid/timezone"), now: instant)
                == "2026-09-04")
    }

    @Test
    func futureDateRequiresExplicitScheduleConsentAndReportsConversion() async throws {
        let detail = try fixture()
        var captured: TransactionEditorSaveRequest?
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail },
            saveHandler: { request in
                captured = request
                return TransactionEditorSaveResult(success: true, convertedToScheduled: true)
            }
        )
        await store.load()
        store.draft?.dateKey = "2026-09-06"
        #expect(store.validationMessage?.contains("Confirm") == true)
        #expect(!store.canSave)
        store.draft?.wantsToSchedule = true
        store.draft?.recurrence = .monthly
        store.draft?.entryMode = .manual
        #expect(store.canSave)
        #expect(await store.save())
        #expect(store.didConvertToScheduled)
        #expect(captured?.arguments["recurrence"] as? String == "monthly")
        #expect(captured?.arguments["entryMode"] as? String == "manual")
    }

    @Test
    func choicesFailureKeepsTransactionEditableAndRetryDoesNotReplaceDraft() async throws {
        let detail = try fixture()
        var calls = 0
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            choicesLoader: { _ in
                calls += 1
                if calls == 1 { throw TransactionEditorError.connectionTimedOut }
                return TransactionEditorChoices(accounts: [
                    TransactionEditorAccount(
                        id: "account", name: "Checking", accountType: "banking_checking")
                ])
            }
        )
        await store.load()
        #expect(store.draft != nil)
        #expect(store.loadErrorMessage == nil)
        #expect(store.choicesErrorMessage != nil)
        store.draft?.notes = "Unsaved note"
        await store.reloadChoices()
        #expect(store.draft?.notes == "Unsaved note")
        #expect(store.choicesErrorMessage == nil)
        #expect(store.choices.accounts.first?.name == "Checking")
    }

    @Test
    func failedSaveRetainsDraftAndNewMerchantIsCreatedOnlyOnceAcrossRetries() async throws {
        let detail = try fixture()
        var creates = 0
        var saves = 0
        var requests: [TransactionEditorSaveRequest] = []
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            merchantCreator: { _, name in
                creates += 1
                #expect(name == "New cafe")
                return "new-merchant"
            },
            saveHandler: { request in
                saves += 1
                requests.append(request)
                if saves == 1 { throw TransactionEditorError.saveFailed }
                return TransactionEditorSaveResult(success: true)
            }
        )
        await store.load()
        store.draft?.pendingMerchantName = "  New cafe  "
        store.draft?.notes = "Keep this note"
        #expect(!(await store.save()))
        #expect(store.isDirty)
        #expect(store.saveErrorMessage != nil)
        #expect(store.draft?.merchantID == "new-merchant")
        #expect(store.draft?.pendingMerchantName == nil)
        #expect(store.draft?.notes == "Keep this note")
        #expect(await store.save())
        #expect(!store.isDirty)
        #expect(creates == 1)
        #expect(requests.count == 2)
        #expect(requests.allSatisfy { $0.arguments["merchantId"] as? String == "new-merchant" })
    }

    @Test
    func staleDetailResponseAfterStopCannotOverwriteNewLoad() async throws {
        let detail = try fixture()
        var first: CheckedContinuation<TransactionEditorDetail?, Never>?
        var calls = 0
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in
                calls += 1
                if calls == 1 { return await withCheckedContinuation { first = $0 } }
                return detail
            }
        )
        let oldLoad = Task { await store.load() }
        await waitUntil { first != nil }
        store.stop()
        await store.load()
        store.draft?.notes = "New draft"
        first?.resume(returning: detail)
        await oldLoad.value
        #expect(store.draft?.notes == "New draft")
        #expect(!store.isLoading)
    }

    @Test
    func stoppingWhileMerchantCreationIsInFlightDoesNotMutateOrSaveStaleDraft() async throws {
        let detail = try fixture()
        var creation: CheckedContinuation<String, Never>?
        var saveCalls = 0
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            merchantCreator: { _, _ in await withCheckedContinuation { creation = $0 } },
            saveHandler: { _ in
                saveCalls += 1
                return TransactionEditorSaveResult(success: true)
            }
        )
        await store.load()
        store.draft?.pendingMerchantName = "New cafe"
        let saving = Task { await store.save() }
        await waitUntil { creation != nil }
        store.stop()
        creation?.resume(returning: "stale-merchant")
        #expect(!(await saving.value))
        #expect(saveCalls == 0)
        #expect(store.draft?.merchantID == "merchant")
        #expect(store.draft?.pendingMerchantName == "New cafe")
        #expect(store.choices.merchants.isEmpty)
    }

    @Test
    func schedulingConfirmationDoesNotBypassOtherValidation() async throws {
        let detail = try fixture()
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail })
        await store.load()
        store.draft?.dateKey = "2026-09-06"
        #expect(store.canSaveAfterScheduleConfirmation)
        store.draft?.allocations.append(TransactionEditorAllocation(amount: -500))
        #expect(!store.canSaveAfterScheduleConfirmation)
    }

    @Test
    func changedPlannedLinkCannotBeSilentlyReplacedByOneTimeFutureSchedule() async throws {
        let detail = try fixture()
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail })
        await store.load()
        store.draft?.scheduledTransactionID = "different-plan"
        store.draft?.dateKey = "2026-09-06"
        #expect(store.draft?.recurrence == .once)
        #expect(store.validationMessage?.contains("either") == true)
        #expect(!store.canSaveAfterScheduleConfirmation)
        store.draft?.wantsToSchedule = true
        #expect(!store.canSave)
    }

    @Test(arguments: [Int64(-1200), Int64(1200)])
    func suggestedTransferPreselectsAccountsAndApprovesWithoutEdits(amount: Int64) async throws {
        let detail = try fixture(
            amount: amount, suggestion: true, counterpart: "other-account", confidence: 90)
        var requests: [TransactionEditorSaveRequest] = []
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.transferChoices() },
            saveHandler: { request in
                requests.append(request)
                return .init(success: true)
            })
        await store.load()
        #expect(store.draft?.isTransfer == true)
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.transferAccountID == "other-account")
        #expect(store.draft?.signedAmount == amount)
        #expect(!store.isDirty)
        #expect(store.needsApproval && store.canSave)
        #expect(await store.save())
        let request = try #require(requests.first)
        #expect(request.arguments["type"] as? String == "transfer")
        #expect(request.arguments["reviewStatus"] as? String == "reviewed")
        #expect(
            request.arguments[amount > 0 ? "toAccountId" : "fromAccountId"] as? String == "account")
        #expect(
            request.arguments[amount > 0 ? "fromAccountId" : "toAccountId"] as? String
                == "other-account")
    }

    @Test(arguments: [Double(40), Double(69), Double(70), Double(95)])
    func transferAccountPreselectionRequiresReliableAvailableChoices(confidence: Double)
        async throws
    {
        let detail = try fixture(
            suggestion: true, counterpart: "other-account", confidence: confidence)
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.transferChoices() })
        await store.load()
        #expect(store.draft?.isTransfer == true)
        #expect(store.draft?.transferAccountID == (confidence >= 70 ? "other-account" : nil))
        #expect(store.canSave == (confidence >= 70))
    }

    @Test
    func unknownTransferAccountOpensAsTransferAndCanBeDeclinedWithoutLosingSplits() async throws {
        let detail = try fixture(
            movements: [
                movement(-800, category: "groceries"),
                movement(-400, category: "dining", notes: "Keep split note"),
            ], suggestion: true)
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.transferChoices() })
        await store.load()
        #expect(store.draft?.isTransfer == true)
        #expect(store.draft?.transferAccountID == nil)
        #expect(!store.canSave)
        store.setTransfer(false)
        #expect(store.draft?.isTransfer == false)
        #expect(store.draft?.allocations.map(\.amount) == [-800, -400])
        #expect(store.draft?.allocations.last?.notes == "Keep split note")
        #expect(store.canSave)
        await store.reloadChoices()
        #expect(store.draft?.isTransfer == false)
    }

    @Test func cancelingTransferModePreservesPlannedLinkAndUnchangedDraft() async throws {
        let detail = try fixture(reviewStatus: "reviewed")
        var requests: [TransactionEditorSaveRequest] = []
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.transferChoices() },
            saveHandler: { request in
                requests.append(request)
                return .init(success: true)
            })
        await store.load()
        let original = try #require(store.draft)
        #expect(original.scheduledTransactionID == "plan")
        for _ in 0..<2 {
            store.setTransfer(true)
            #expect(store.draft?.scheduledTransactionID == nil)
            store.setTransfer(false)
            #expect(store.draft == original)
            #expect(!store.isDirty)
        }
        store.draft?.notes = "Updated note"
        #expect(await store.save())
        let request = try #require(requests.first)
        #expect(!request.arguments.keys.contains("linkedScheduledTransactionId"))
    }

    @Test(arguments: [Int64(-1200), Int64(1200)])
    func existingTransfersCanBecomeRegularWithoutChangingTheirSign(amount: Int64) async throws {
        let detail = try fixture(amount: amount, type: "transfer", reviewStatus: "reviewed")
        var requests: [TransactionEditorSaveRequest] = []
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.transferChoices() },
            saveHandler: { request in
                requests.append(request)
                return .init(success: true)
            })
        await store.load()
        #expect(store.supportsTransferToggle)
        store.setTransfer(false)
        #expect(store.draft?.signedAmount == amount)
        #expect(store.draft?.isTransfer == false)
        #expect(await store.save())
        let request = try #require(requests.first)
        #expect(request.arguments["type"] as? String == "regular")
        #expect(request.arguments["movements"] != nil)
    }

    @Test
    func untouchedRegularReviewCanBeApprovedAndFailedApprovalKeepsItsDraft() async throws {
        let detail = try fixture()
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, detailLoader: { _, _ in detail },
            saveHandler: { _ in throw TransactionEditorError.saveFailed })
        await store.load()
        #expect(store.canSave && store.needsApproval && !store.isDirty)
        #expect(await !store.save())
        #expect(store.draft?.reviewStatus == .needsReview)
        #expect(store.canSave)
        #expect(store.saveErrorMessage != nil)
    }

    private func transferChoices() -> TransactionEditorChoices {
        .init(accounts: [
            .init(id: "account", name: "Checking", accountType: "banking_checking"),
            .init(id: "other-account", name: "Savings", accountType: "banking_savings"),
        ])
    }

    @Test
    func invalidSplitTotalsAndSameTransferAccountPreventSave() async throws {
        let regular = try fixture()
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: regular.id, detailLoader: { _, _ in regular })
        await store.load()
        store.draft?.allocations.append(TransactionEditorAllocation(amount: -500))
        #expect(store.validationMessage?.contains("add up") == true)
        let transfer = try fixture(type: "transfer")
        let transferStore = TransactionEditorStore(
            workspace: workspace(), transactionID: transfer.id, detailLoader: { _, _ in transfer })
        await transferStore.load()
        let accountID = transferStore.draft?.accountID
        transferStore.draft?.transferAccountID = accountID
        #expect(transferStore.validationMessage?.contains("different accounts") == true)
    }

    @Test
    func queryTimeoutAndCancellationReleaseSubscription() async throws {
        var cancellations = 0
        var subscriptions = 0
        let publisher = Empty<Int, Error>(completeImmediately: false).handleEvents(
            receiveSubscription: { _ in subscriptions += 1 },
            receiveCancel: { cancellations += 1 }
        ).eraseToAnyPublisher()
        do {
            _ = try await TransactionEditorQuery<Int>().read(publisher, timeout: .milliseconds(10))
            Issue.record("Expected a timeout")
        } catch {
            #expect(error is TransactionEditorError)
        }
        #expect(cancellations == 1)
        let task = Task { try await TransactionEditorQuery<Int>().read(publisher) }
        await waitUntil { subscriptions == 2 }
        task.cancel()
        do {
            _ = try await task.value
            Issue.record("Expected cancellation")
        } catch {
            #expect(error is CancellationError)
        }
        #expect(cancellations == 2)
    }

    @Test
    func queryReturnsFirstValueAndDoesNotTreatCompletionAsAnError() async throws {
        let result = try await TransactionEditorQuery<Int>().read(
            Just(42).setFailureType(to: Error.self).eraseToAnyPublisher()
        )
        #expect(result == 42)
    }

    @Test
    func categoryPickerExcludesArchivedAndReservedCreditCardCategories() {
        #expect(TransactionEditorCategory(id: "groceries", name: "Groceries").isSelectable)
        #expect(
            !TransactionEditorCategory(id: "archived", name: "Archived", isArchived: true)
                .isSelectable)
        #expect(
            !TransactionEditorCategory(
                id: "card", name: "Card payment", categoryType: "credit_card_payment"
            ).isSelectable)
        #expect(
            !TransactionEditorCategory(id: "legacy-card", name: "Card payment", type: "credit_card")
                .isSelectable)
    }

    @Test
    func creationStartsEmptyOnTheWorkspaceDateAndNeverLoadsAnExistingEntry() async {
        var detailLoads = 0
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            detailLoader: { _, _ in
                detailLoads += 1
                return nil
            })
        await store.load()
        #expect(store.isCreating)
        #expect(
            store.draft?.dateKey
                == TransactionEditorDate.today(workspace: workspace(), now: referenceDate()))
        #expect(store.draft?.flow == .outflow)
        #expect(store.draft?.reviewStatus == .reviewed)
        #expect(!store.isDirty)
        #expect(!store.canSave)
        #expect(detailLoads == 0)
    }

    @Test
    func transferCreationKeepsDirectionIndependentAndEncodesBothAccountDirections() throws {
        var draft = TransactionEditorDraft(workspace: workspace(), now: referenceDate())
        draft.accountID = "checking"
        draft.transferAccountID = "savings"
        draft.setAmount(2_500)
        draft.setCategory("dining")
        draft.setCreatesTransfer(true)
        #expect(draft.flow == .outflow)
        #expect(draft.signedAmount == -2_500)
        let outgoing = TransactionCreationRequest(workspaceID: "workspace", draft: draft)
        #expect(outgoing.mutationName == "transactions:createTransferFromEditor")
        #expect(try outgoing.arguments["fromAccountId"]??.convexEncode() == "\"checking\"")
        #expect(try outgoing.arguments["toAccountId"]??.convexEncode() == "\"savings\"")
        #expect(try outgoing.arguments["amount"]??.convexEncode() == Int64(2_500).convexEncode())
        #expect(outgoing.arguments["movements"] == nil)
        #expect(outgoing.arguments["merchantId"] == nil)

        draft.setFlow(.inflow)
        #expect(draft.isTransfer)
        #expect(draft.signedAmount == 2_500)
        let incoming = TransactionCreationRequest(
            workspaceID: "workspace", draft: draft, includesCategories: false)
        #expect(try incoming.arguments["fromAccountId"]??.convexEncode() == "\"savings\"")
        #expect(try incoming.arguments["toAccountId"]??.convexEncode() == "\"checking\"")
        #expect(incoming.arguments["categoryId"] == nil)
        #expect(incoming.arguments["readyToAssign"] == nil)
        draft.setCreatesTransfer(false)
        #expect(draft.flow == .inflow)
        #expect(!draft.isTransfer)
    }

    @Test
    func regularCreationPreservesSignedSplitsAndRecurrence() throws {
        var draft = TransactionEditorDraft(workspace: workspace(), now: referenceDate())
        draft.accountID = "checking"
        draft.setAmount(3_000)
        draft.allocations = [
            TransactionEditorAllocation(amount: -3_500, categoryID: "dining"),
            TransactionEditorAllocation(amount: 500, categoryID: "groceries"),
        ]
        draft.recurrence = .monthly
        let request = TransactionCreationRequest(workspaceID: "workspace", draft: draft)
        #expect(request.mutationName == "transactions:createTransactionFromEditor")
        #expect(try request.arguments["recurrence"]??.convexEncode() == "\"monthly\"")
        #expect(
            try request.arguments["movements"]??.convexEncode().contains(
                Int64(-3_500).convexEncode()) == true)
        #expect(request.arguments["transactionId"] == nil)
        draft.setCreatesTransfer(true)
        #expect(draft.allocations.count == 1)
        #expect(draft.allocations[0].amount == -3_000)
    }

    @Test
    func failedCreationRetainsDraftAndOnlySuccessfulCreationProducesAReceipt() async {
        var attempts = 0
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in
                TransactionEditorChoices(accounts: [
                    TransactionEditorAccount(
                        id: "account", name: "Checking", accountType: "banking_checking")
                ])
            },
            creationHandler: { _ in
                attempts += 1
                if attempts == 1 { throw TransactionEditorError.saveFailed }
                return TransactionCreationResult(
                    transactionId: "created", scheduledTransactionId: nil, budgetChanges: [])
            })
        await store.load()
        store.draft?.accountID = "account"
        store.draft?.setAmount(1_200)
        #expect(store.canSave)
        #expect(await store.save() == false)
        #expect(store.savedReceipt == nil)
        #expect(store.draft?.amount == 1_200)
        #expect(store.isDirty)
        #expect(await store.save())
        #expect(store.savedReceipt?.transactionID == "created")
        #expect(!store.isDirty)
        #expect(await store.save() == false)
        #expect(attempts == 2)
    }

    @Test
    func transferCreationValidatesAccountsAndOnlyOffersCategoriesAcrossBudgetBoundary() async {
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in
                TransactionEditorChoices(accounts: [
                    TransactionEditorAccount(
                        id: "checking", name: "Checking", accountType: "banking_checking"),
                    TransactionEditorAccount(
                        id: "savings", name: "Savings", accountType: "banking_savings"),
                    TransactionEditorAccount(
                        id: "investing", name: "Investing", accountType: "investment_brokerage"),
                ])
            })
        await store.load()
        store.draft?.setAmount(1_000)
        store.draft?.accountID = "checking"
        store.draft?.setCreatesTransfer(true)
        #expect(!store.canSave)
        store.draft?.transferAccountID = "checking"
        #expect(!store.canSave)
        store.draft?.transferAccountID = "savings"
        #expect(store.canSave)
        #expect(!store.supportsCategories)
        store.draft?.transferAccountID = "investing"
        #expect(store.supportsCategories)
        store.draft?.setFlow(.inflow)
        #expect(store.canSave)
        #expect(store.supportsCategories)
    }

    @Test
    func futureCreationRequiresConfirmationAndReportsScheduledOnly() async {
        let store = TransactionEditorStore(
            workspace: workspace(), now: referenceDate,
            choicesLoader: { _ in
                TransactionEditorChoices(accounts: [
                    TransactionEditorAccount(
                        id: "account", name: "Checking", accountType: "banking_checking")
                ])
            },
            creationHandler: { _ in
                TransactionCreationResult(
                    transactionId: nil, scheduledTransactionId: "planned", budgetChanges: [])
            })
        await store.load()
        store.draft?.accountID = "account"
        store.draft?.setAmount(1_200)
        store.draft?.dateKey = "2099-01-01"
        #expect(store.requiresScheduleConfirmation)
        #expect(!store.canSave)
        #expect(store.canSaveAfterScheduleConfirmation)
        store.draft?.wantsToSchedule = true
        #expect(await store.save())
        #expect(store.savedReceipt?.isScheduledOnly == true)
    }

    @Test
    func recategorizingPublishesBothBalancesFromTheDecodedSaveResponse() async throws {
        let detail = try fixture()
        let values: [String: ConvexEncodable?] = [
            "success": true,
            "budgetChanges": [
                [
                    "categoryId": "groceries", "yearMonth": Double(202609), "name": "Groceries",
                    "before": Int64(1_000), "after": Int64(2_200),
                ] as [String: ConvexEncodable?],
                [
                    "categoryId": "dining", "yearMonth": Double(202609), "name": "Dining out",
                    "before": Int64(1_000), "after": Int64(-200),
                ] as [String: ConvexEncodable?],
            ],
        ]
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail },
            saveHandler: { request in
                #expect(request.arguments["includeBudgetChanges"] as? Bool == true)
                #expect(request.original.allocations.first?.categoryID == "groceries")
                #expect(request.draft.allocations.first?.categoryID == "dining")
                return try JSONDecoder().decode(
                    TransactionEditorSaveResult.self, from: Data(values.convexEncode().utf8))
            })
        await store.load()
        store.draft?.setCategory("dining")
        #expect(store.savedReceipt == nil)
        #expect(await store.save())
        #expect(store.savedReceipt?.kind == .updated)
        #expect(store.savedReceipt?.budgetChanges.map(\.categoryId) == ["groceries", "dining"])
        #expect(store.savedReceipt?.budgetChanges.map(\.delta) == [1_200, -1_200])
        #expect(store.savedReceipt?.budgetChanges.last?.after == -200)
        #expect(store.savedReceipt?.budgetChanges.first?.yearMonth == 202609)
    }

    @Test(arguments: ["success", "failure", "workspace-changed"])
    func quickCategorizationOutlivesPickerAndPublishesOnePendingReceipt(outcome: String)
        async throws
    {
        let detail = try fixture(movements: [movement(-1200)])
        var response: CheckedContinuation<TransactionEditorSaveResult, Error>?
        var writes = 0
        let editor = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail },
            saveHandler: { _ in
                writes += 1
                return try await withCheckedThrowingContinuation { response = $0 }
            })
        let feed = TransactionFeedStore(
            workspace: workspace(),
            subscriptionFactory: { _ in
                Empty<TransactionFeedResponse, Error>().eraseToAnyPublisher()
            })
        await editor.load()
        #expect(!feed.startCategorizing(editor: editor, categoryID: "none"))
        #expect(feed.latestMutationReceipt == nil)
        #expect(feed.startCategorizing(editor: editor, categoryID: "rta"))
        let pending = try #require(feed.latestMutationReceipt)
        #expect(pending.isUpdating)
        #expect(feed.isPerformingAction)
        #expect(!feed.startCategorizing(editor: editor, categoryID: "rta"))
        await waitUntil { response != nil }
        #expect(writes == 1)
        if outcome == "workspace-changed" { feed.reset() }
        if outcome == "failure" {
            response?.resume(throwing: TransactionEditorError.saveFailed)
        } else {
            response?.resume(returning: .init(success: true))
        }
        await waitUntil { !editor.isSaving && !feed.isPerformingAction }
        if outcome == "success" {
            #expect(feed.latestMutationReceipt?.id == pending.id)
            #expect(feed.latestMutationReceipt?.isPending == false)
            #expect(feed.actionErrorMessage == nil)
        } else {
            #expect(feed.latestMutationReceipt == nil)
            #expect((feed.actionErrorMessage != nil) == (outcome == "failure"))
        }
    }

    @Test func pendingCategoryPeekWaitsForTheServerBeforeStartingItsDismissalTimer() {
        var receipt = TransactionMutationReceipt(
            workspace: workspace(), dateKey: "2026-09-08", kind: .updated,
            budgetChanges: [], isPending: true)
        var presentation = TransactionPeekPresentation()
        presentation.present(receipt)
        presentation.revealContent(receiptID: receipt.id)
        let session = presentation.reveal.sessionID
        #expect(presentation.reveal.isPresented)
        #expect(presentation.animationID == nil)
        receipt.isPending = false
        presentation.present(receipt)
        #expect(presentation.animationID == receipt.id)
        #expect(presentation.reveal.sessionID == session)
        #expect(!presentation.showsFinalAmount)
    }

    @Test(arguments: ["needs_review", "reviewed"])
    func quickCategorizeSavesCategoryAndApprovalTogether(reviewStatus: String) async throws {
        let detail = try fixture(
            movements: [movement(-1200, notes: "Keep this note")],
            reviewStatus: reviewStatus)
        var requests: [TransactionEditorSaveRequest] = []
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail },
            choicesLoader: { _ in
                TransactionEditorChoices(categories: [
                    TransactionEditorCategory(id: "dining", name: "Dining Out")
                ])
            },
            saveHandler: { request in
                requests.append(request)
                return TransactionEditorSaveResult(success: true)
            })
        await store.load()
        #expect(await store.categorizeAndApprove("dining"))
        let saved = try #require(requests.first)
        #expect(requests.count == 1)
        #expect(saved.draft.allocations.first?.categoryID == "dining")
        #expect(saved.draft.allocations.first?.notes == "Keep this note")
        #expect(saved.draft.reviewStatus == .reviewed)
        #expect(saved.draft.status == saved.original.status)
        #expect(
            saved.arguments["reviewStatus"] as? String
                == (reviewStatus == "needs_review" ? "reviewed" : nil))
        #expect(saved.arguments["movements"] != nil)
        #expect(store.savedReceipt?.transactionID == detail.id)
        #expect(await !store.categorizeAndApprove("dining"))
        #expect(requests.count == 1)
    }

    @Test
    func quickCategorizeRequiresAcknowledgmentBeforeDecliningATransferSuggestion() async throws {
        let detail = try fixture(movements: [movement(-1200)], suggestion: true)
        var saves = 0
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail },
            saveHandler: { _ in
                saves += 1
                return TransactionEditorSaveResult(success: true)
            })
        await store.load()
        #expect(await !store.categorizeAndApprove("rta"))
        #expect(saves == 0)
        #expect(
            await store.categorizeAndApprove("rta", acknowledgesTransferSuggestionRejection: true))
        #expect(saves == 1)
    }

    @Test
    func quickCategorizePreservesOtherSplitsAndCanRetryWithADifferentChoice() async throws {
        let detail = try fixture(movements: [
            movement(-400, category: "groceries", notes: "Already categorized"),
            movement(-300, readyToAssign: true),
            movement(-500, notes: "Missing category"),
        ])
        var requests: [TransactionEditorSaveRequest] = []
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail },
            choicesLoader: { _ in
                TransactionEditorChoices(categories: [
                    TransactionEditorCategory(id: "dining", name: "Dining Out")
                ])
            },
            saveHandler: { request in
                requests.append(request)
                if requests.count == 1 { throw TransactionEditorError.saveFailed }
                return TransactionEditorSaveResult(success: true)
            })
        await store.load()
        #expect(await !store.categorizeAndApprove("none"))
        #expect(await !store.categorizeAndApprove("unknown"))
        #expect(requests.isEmpty)
        #expect(await !store.categorizeAndApprove("dining"))
        #expect(store.savedReceipt == nil)
        #expect(store.saveErrorMessage != nil)
        #expect(await store.categorizeAndApprove("rta"))
        let saved = try #require(requests.last)
        #expect(saved.draft.allocations[0] == saved.original.allocations[0])
        #expect(saved.draft.allocations[1] == saved.original.allocations[1])
        #expect(saved.draft.allocations[2].readyToAssign)
        #expect(saved.draft.allocations[2].categoryID == nil)
        #expect(saved.draft.allocations[2].amount == -500)
        #expect(saved.draft.allocations[2].notes == "Missing category")
        #expect(saved.draft.reviewStatus == .reviewed)
    }

    private func request(_ draft: TransactionEditorDraft, original: TransactionEditorDraft)
        -> TransactionEditorSaveRequest
    {
        TransactionEditorSaveRequest(
            workspaceID: "workspace", transactionID: "transaction", draft: draft, original: original
        )
    }

    @Test
    func accountPagePreselectionRemainsPristineWhenChoicesLoad() async {
        let store = TransactionEditorStore(workspace: workspace(), now: referenceDate)
        store.preselectAccount("account")
        #expect(store.draft?.accountID == "account")
        #expect(!store.isDirty)
        await store.load()
        #expect(store.draft?.accountID == "account")
        #expect(!store.isDirty)

        store.draft?.setAmount(1_200)
        store.preselectAccount("other")
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.amount == 1_200)
        #expect(store.isDirty)
    }

    @Test
    func accountPagePreselectionCannotReplaceAnEditOrAnExistingSelection() async throws {
        let creation = TransactionEditorStore(workspace: workspace(), now: referenceDate)
        creation.preselectAccount(" ")
        #expect(creation.draft?.accountID == "")
        creation.preselectAccount("first")
        creation.preselectAccount("second")
        #expect(creation.draft?.accountID == "first")
        #expect(!creation.isDirty)

        let detail = try fixture()
        let editing = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id, now: referenceDate,
            detailLoader: { _, _ in detail })
        await editing.load()
        editing.preselectAccount("other")
        #expect(editing.draft?.accountID == detail.bankAccountId)
        #expect(!editing.isDirty)
    }

    @Test
    func merchantSuggestionsDecodeAndFollowSelectionUntilEachFieldIsManuallyChosen() async throws {
        let merchant = try JSONDecoder().decode(
            TransactionEditorMerchant.self,
            from: Data(
                """
                {"_id":"first","name":"First","suggestedCategoryIds":["groceries"],
                 "suggestedBankAccountId":"account"}
                """.utf8))
        let store = TransactionEditorStore(
            workspace: workspace(), choicesLoader: { _ in self.suggestionChoices(first: merchant) })
        await store.load()
        store.selectMerchant("first")
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.allocations.first?.categoryID == "groceries")
        store.selectMerchant("second")
        #expect(store.draft?.accountID == "other-account")
        #expect(store.draft?.allocations.first?.categoryID == "dining")
        store.selectCategory("rta")
        store.selectMerchant("first")
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.allocations.first?.readyToAssign == true)
        store.selectAccount("other-account")
        store.selectCategory("none")
        store.selectMerchant("second")
        store.selectMerchant("first")
        #expect(store.draft?.accountID == "other-account")
        #expect(store.draft?.allocations.first?.categoryID == nil)
        #expect(store.draft?.allocations.first?.readyToAssign == false)
        await store.reloadChoices()
        #expect(store.draft?.accountID == "other-account")
        #expect(store.draft?.allocations.first?.categoryID == nil)
    }

    @Test
    func manualAccountStillAllowsCategorySuggestionsAndNewSessionsResetLocks() async {
        for _ in 0..<2 {
            let store = TransactionEditorStore(
                workspace: workspace(), choicesLoader: { _ in self.suggestionChoices() })
            await store.load()
            store.selectMerchant("first")
            #expect(store.draft?.accountID == "account")
            store.selectAccount("account")
            store.selectMerchant("second")
            #expect(store.draft?.accountID == "account")
            #expect(store.draft?.allocations.first?.categoryID == "dining")
        }
    }

    @Test
    func suggestionsRespectAccountContextSplitsAndUnavailableChoices() async {
        var choices = suggestionChoices()
        choices.merchants.append(
            TransactionEditorMerchant(
                id: "invalid", name: "Invalid", suggestedCategoryIds: ["archived", "dining"],
                suggestedBankAccountId: "closed"))
        choices.categories.append(
            TransactionEditorCategory(
                id: "archived", name: "Archived", isArchived: true))
        choices.accounts.append(
            TransactionEditorAccount(
                id: "closed", name: "Closed", accountType: "banking_checking", isClosed: true))
        let loaded = choices
        let store = TransactionEditorStore(
            workspace: workspace(), choicesLoader: { _ in loaded })
        store.preselectAccount("account")
        await store.load()
        store.selectMerchant("second")
        #expect(store.draft?.accountID == "account")
        store.selectMerchant("invalid")
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.allocations.first?.categoryID == "dining")
        store.didApplySplits()
        store.draft?.allocations = [TransactionEditorAllocation(amount: -100, categoryID: "dining")]
        store.selectMerchant("first")
        #expect(store.draft?.allocations.first?.categoryID == "dining")
    }

    @Test
    func merchantSuggestionsDoNotRecategorizeExistingTransactions() async throws {
        let detail = try fixture()
        let store = TransactionEditorStore(
            workspace: workspace(), transactionID: detail.id,
            detailLoader: { _, _ in detail },
            choicesLoader: { _ in self.suggestionChoices() })
        await store.load()
        store.selectMerchant("second")
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.allocations.first?.categoryID == "groceries")
    }

    @Test(arguments: [false, true])
    func transferHistorySuggestsTheMatchingDirectionAndPreservesManualCategories(inflow: Bool)
        async throws
    {
        let previous = try fixture(
            amount: inflow ? -1_200 : 1_200, type: "transfer", reviewStatus: "reviewed")
        var choices = suggestionChoices()
        choices.accounts[1] = TransactionEditorAccount(
            id: "other-account", name: "Investing", accountType: "investment_brokerage")
        let loaded = choices
        let store = TransactionEditorStore(
            workspace: workspace(), choicesLoader: { _ in loaded },
            transferHistoryLoader: { _, _ in [previous] })
        await store.load()
        store.draft?.setCreatesTransfer(true)
        store.draft?.setFlow(inflow ? .inflow : .outflow)
        store.selectTransferAccount("account")
        await waitUntil { store.draft?.accountID == "other-account" }
        #expect(store.draft?.allocations.first?.categoryID == "groceries")
        store.selectCategory("none")
        store.refreshSuggestions()
        await Task.yield()
        #expect(store.draft?.allocations.first?.categoryID == nil)
        store.stop()
    }

    @Test
    func delayedTransferHistoryCannotOverwriteALaterMerchantOrManualSelection() async throws {
        let previous = try fixture(amount: 1_200, type: "transfer", reviewStatus: "reviewed")
        var pending: CheckedContinuation<[TransactionEditorDetail], Never>?
        let store = TransactionEditorStore(
            workspace: workspace(), choicesLoader: { _ in self.suggestionChoices() },
            transferHistoryLoader: { _, _ in
                await withCheckedContinuation { pending = $0 }
            })
        await store.load()
        store.draft?.setCreatesTransfer(true)
        store.selectTransferAccount("account")
        await waitUntil { pending != nil }
        store.selectCategory("rta")
        store.draft?.setCreatesTransfer(false)
        store.selectMerchant("first")
        pending?.resume(returning: [previous])
        await Task.yield()
        #expect(store.draft?.accountID == "account")
        #expect(store.draft?.allocations.first?.readyToAssign == true)
        store.stop()
    }

    private func suggestionChoices(first: TransactionEditorMerchant? = nil)
        -> TransactionEditorChoices
    {
        TransactionEditorChoices(
            merchants: [
                first
                    ?? TransactionEditorMerchant(
                        id: "first", name: "First", suggestedCategoryIds: ["groceries"],
                        suggestedBankAccountId: "account"),
                TransactionEditorMerchant(
                    id: "second", name: "Second", suggestedCategoryIds: ["dining"],
                    suggestedBankAccountId: "other-account"),
            ],
            categories: [
                TransactionEditorCategory(id: "groceries", name: "Groceries"),
                TransactionEditorCategory(id: "dining", name: "Dining"),
            ],
            accounts: [
                TransactionEditorAccount(
                    id: "account", name: "Checking", accountType: "banking_checking"),
                TransactionEditorAccount(
                    id: "other-account", name: "Savings", accountType: "banking_savings"),
            ])
    }

    private func workspace(timezone: String = "America/New_York") -> TransactionFeedWorkspace {
        TransactionFeedWorkspace(
            id: "workspace", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: timezone)
    }

    private func referenceDate() -> Date { Date(timeIntervalSince1970: 1_788_559_200) }

    private func movement(
        _ amount: Int64, category: String? = nil, readyToAssign: Bool = false, notes: String? = nil
    ) -> [String: ConvexEncodable?] {
        var value: [String: ConvexEncodable?] = ["amount": amount, "readyToAssign": readyToAssign]
        if let category { value["categoryId"] = category }
        if let notes { value["notes"] = notes }
        return value
    }

    private func fixture(
        amount: Int64 = -1_200, type: String = "regular",
        movements: [[String: ConvexEncodable?]]? = nil, suggestion: Bool = false,
        reviewStatus: String = "needs_review", counterpart: String? = nil,
        confidence: Double? = nil,
        status: String = "cleared", scheduledOccurrenceDate: String? = nil, bankMatch: Bool = false
    ) throws -> TransactionEditorDetail {
        var value: [String: ConvexEncodable?] = [
            "_id": "transaction", "workspaceId": "workspace", "bankAccountId": "account",
            "date": "2026-09-04", "type": type, "status": status, "reviewStatus": reviewStatus,
            "totalAmount": amount, "isDeleted": false, "merchantId": "merchant",
            "notes": "Original note",
            "scheduledTransactionId": "plan",
            "movements": (movements ?? [movement(amount, category: "groceries")]).map {
                $0 as ConvexEncodable?
            },
            "bankAccount": [
                "_id": "account", "name": "Checking", "accountType": "banking_checking",
            ] as [String: ConvexEncodable?],
        ]
        if bankMatch {
            value["linkedRawTransactionId"] = "bank-import"
            value["importDetails"] =
                [
                    "provider": "plaid", "amount": Int64(-1_300), "date": "2026-09-05",
                    "merchantName": "Bank cafe",
                ] as [String: ConvexEncodable?]
        }
        if let scheduledOccurrenceDate {
            value["scheduledOccurrenceDate"] = scheduledOccurrenceDate
        }
        if type == "transfer" {
            value["transferPairId"] = "pair"
            value["transferPairBankAccountId"] = "other-account"
        }
        if suggestion {
            var suggestionValue: [String: ConvexEncodable?] = [
                "status": "pending", "detectionReason": "Matching amount",
            ]
            if let counterpart { suggestionValue["suggestedCounterpartAccountId"] = counterpart }
            if let confidence { suggestionValue["accountConfidence"] = confidence }
            value["suggestedTransfer"] = suggestionValue
        }
        return try JSONDecoder().decode(
            TransactionEditorDetail.self, from: Data(value.convexEncode().utf8))
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async {
        for _ in 0..<100 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }
}
