import Combine
import ConvexMobile
import Foundation
import Observation
import SwiftUI
import Synchronization
import Testing
import UIKit

@testable import Kualia

@Suite(.serialized)
@MainActor
struct TransactionFeedTests {
    @Test func reconciledPreferenceFiltersImmediatelyAndRestoresLoadedRows() throws {
        let pending = TransactionFeedItem(
            id: "pending", date: "2026-09-05", type: .regular, status: .pending, amount: -100)
        let reconciled = TransactionFeedItem(
            id: "reconciled", date: "2026-09-03", type: .regular, status: .reconciled,
            amount: -100)
        let transfer = TransactionFeedItem(
            id: "transfer", transferGroupId: "pair", date: "2026-09-03", type: .transfer,
            status: .reconciled, amount: 100)
        let store = TransactionFeedStore(
            previewResponse: response(
                items: [pending, item(id: "cleared"), reconciled, transfer], isDone: true))
        #expect(store.showsReconciledTransactions)
        #expect(!store.hasActiveFilters && !store.showsReconciledTransactionsPrompt)
        store.beginSelection(try #require(store.sections.last?.entries.first))

        store.setShowsReconciledTransactions(false)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["pending", "cleared"])
        #expect(store.sections.map(\.id) == ["2026-09-05", "2026-09-04"])
        #expect(!store.isSelecting && store.selectedIDs.isEmpty)
        #expect(store.hasActiveFilters && store.showsReconciledTransactionsPrompt)

        store.setShowsReconciledTransactions(true)
        #expect(
            store.sections.flatMap(\.entries).map(\.id)
                == ["pending", "cleared", "reconciled", "transfer"])
        #expect(!store.showsReconciledTransactionsPrompt)
        store.setShowsReconciledTransactions(false)
        store.reset()
        #expect(!store.showsReconciledTransactions)
        #expect(!store.showsReconciledTransactionsPrompt)
    }

    @Test func reconciledPreferenceCombinesWithFilterQueuesAndLiveStatusChanges() async {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(subscriptionFactory: { _ in source.eraseToAnyPublisher() })
        defer { store.stop() }
        store.setShowsReconciledTransactions(false)
        store.start()
        var reconciled = item(id: "reconciled")
        reconciled.status = .reconciled
        var snapshot = response(items: [item(id: "cleared"), reconciled], isDone: true)
        snapshot.filterTransactions = .init(needsReview: snapshot.transactions.page)
        source.send(snapshot)
        await waitUntil { store.hasLoaded }
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["cleared"])

        store.selectFilter(.needsReview)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["cleared"])
        store.setShowsReconciledTransactions(true)
        #expect(store.filter == .needsReview)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["cleared", "reconciled"])
        #expect(!store.showsReconciledTransactionsPrompt)
        store.setShowsReconciledTransactions(false)

        var newlyReconciled = item(id: "cleared")
        newlyReconciled.status = .reconciled
        snapshot = response(items: [newlyReconciled, reconciled], isDone: true)
        snapshot.filterTransactions = .init(needsReview: snapshot.transactions.page)
        source.send(snapshot)
        await waitUntil { store.sections.isEmpty }
        #expect(store.showsReconciledTransactionsPrompt)
        store.selectFilter(.all)
        #expect(store.sections.isEmpty)
        store.setShowsReconciledTransactions(true)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["cleared", "reconciled"])
        #expect(!store.showsReconciledTransactionsPrompt)
    }

    @Test func accountReconciledPreferenceKeepsTheAccountScopeAndUpdatesItsAction() async {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        var requests: [TransactionFeedSubscriptionRequest] = []
        let store = TransactionFeedStore(
            bankAccountID: "checking",
            subscriptionFactory: { request in
                requests.append(request)
                return source.eraseToAnyPublisher()
            })
        defer { store.stop() }
        store.start()
        var reconciled = item(id: "reconciled")
        reconciled.status = .reconciled
        source.send(response(items: [reconciled], isDone: true))
        await waitUntil { store.hasLoaded }
        #expect(
            TransactionFeedPreferences.visibilityActionTitle(
                showsReconciledTransactions: store.showsReconciledTransactions)
                == L10n.string("Hide reconciled transactions"))

        store.setShowsReconciledTransactions(false)
        #expect(store.sections.isEmpty)
        #expect(store.showsReconciledTransactionsPrompt)
        #expect(
            TransactionFeedPreferences.visibilityActionTitle(
                showsReconciledTransactions: store.showsReconciledTransactions)
                == L10n.string("Show reconciled transactions"))
        store.setShowsReconciledTransactions(true)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["reconciled"])
        #expect(!store.showsReconciledTransactionsPrompt)
        #expect(requests.count == 1 && requests.first?.bankAccountID == "checking")
    }

    @Test func reconciledOnlyPagesRemainPageableUntilTheEndPrompt()
        async
    {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        defer { store.stop() }
        store.setShowsReconciledTransactions(false)
        store.start()
        #expect(!store.showsReconciledTransactionsPrompt)
        var reconciled = item(id: "reconciled")
        reconciled.status = .reconciled
        subjects[0].send(response(items: [reconciled], isDone: false))
        await waitUntil { store.hasLoaded }
        #expect(store.sections.isEmpty)
        #expect(store.needsManualPagination && !store.showsReconciledTransactionsPrompt)
        #expect(store.canLoadMoreFromFooter)

        store.loadMoreIfNeeded()
        #expect(requests.count == 2)
        #expect(store.isLoadingMore && !store.showsReconciledTransactionsPrompt)
        #expect(!store.canLoadMoreFromFooter)
        subjects[1].send(response(items: [item(id: "visible")], isDone: false))
        await waitUntil { !store.isLoadingMore }
        #expect(!store.needsManualPagination && !store.showsReconciledTransactionsPrompt)
        #expect(store.canLoadMoreFromFooter)
        store.loadMoreIfNeeded(after: "visible")
        #expect(requests.count == 3)
        var olderReconciled = item(id: "older-reconciled")
        olderReconciled.status = .reconciled
        subjects[2].send(response(items: [olderReconciled], isDone: false))
        await waitUntil { !store.isLoadingMore }
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["visible"])
        #expect(store.needsManualPagination && !store.showsReconciledTransactionsPrompt)
        #expect(store.canLoadMoreFromFooter)
        store.loadMoreIfNeeded(after: "visible")
        #expect(requests.count == 3)

        store.loadMoreIfNeeded()
        #expect(requests.count == 4)
        subjects[3].send(completion: .failure(TestFeedError.unavailable))
        await waitUntil { store.errorMessage != nil }
        #expect(!store.showsReconciledTransactionsPrompt)
        #expect(!store.canLoadMoreFromFooter)
        store.retry()
        subjects[4].send(response(items: [item(id: "oldest")], isDone: true))
        await waitUntil { !store.isLoadingMore }
        #expect(!store.hasMore && store.showsReconciledTransactionsPrompt)
        #expect(!store.canLoadMoreFromFooter)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["visible", "oldest"])
        store.setShowsReconciledTransactions(true)
        #expect(
            store.sections.flatMap(\.entries).map(\.id)
                == ["reconciled", "visible", "older-reconciled", "oldest"])
        #expect(!store.showsReconciledTransactionsPrompt)
        #expect(requests.count == 5)
    }

    @Test(arguments: [TransactionFeedFilter.inflow, .outflow])
    func flowFiltersUseBoundedServerSearchAndPreservePagination(filter: TransactionFeedFilter)
        throws
    {
        let request = TransactionFeedSubscriptionRequest(
            numItems: 50, cursor: "older", endCursor: "end", paginationID: 7,
            workspaceID: "workspace", bankAccountID: "checking", filter: filter)
        let arguments = request.arguments
        let search = try #require(arguments["search"] as? [String: ConvexEncodable?])
        #expect(search["text"] as? String == "")
        #expect(search["flow"] as? String == filter.rawValue)
        #expect(arguments["filter"] == nil)
        #expect(arguments["workspaceId"] as? String == "workspace")
        #expect(arguments["bankAccountId"] as? String == "checking")
        #expect(arguments["includeFilterCounts"] as? Bool == false)
        #expect(arguments["includeFilterTransactions"] as? Bool == false)
        let pagination = try #require(arguments["paginationOpts"] as? [String: ConvexEncodable?])
        #expect(pagination["cursor"] as? String == "older")
        #expect(pagination["endCursor"] as? String == "end")
        #expect(pagination["id"] as? Double == 7)
        #expect(pagination["numItems"] as? Double == 50)
        #expect(pagination["maximumRowsRead"] as? Double == 200)
        #expect(pagination["maximumBytesRead"] as? Double == 1_000_000)
    }

    @Test(arguments: [TransactionFeedFilter.inflow, .outflow])
    func flowFiltersPaginatePastEmptyPagesAndRetainHistory(filter: TransactionFeedFilter)
        async throws
    {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        defer { store.stop() }
        let feed = TransactionFeedView(store: store, isActive: true, showsAgenda: true)
        store.start()
        var snapshot = response(items: [item(id: "recent")], isDone: false)
        snapshot.filterCounts = .init()
        snapshot.filterSetsComplete = true
        snapshot.filterTransactions = .init()
        subjects[0].send(snapshot)
        await waitUntil { store.hasLoaded }
        #expect(store.visibleFilters == [.all, .inflow, .outflow])
        #expect(store.filterCounts.count(for: filter) == nil)
        store.beginSelection(try #require(store.sections.first?.entries.first))
        store.selectFilter(filter)
        #expect(!store.isSelecting)
        #expect(!feed.showsPlannedSection)
        #expect(requests.count == 2 && requests[1].filter == filter)
        #expect(store.isLoading)
        subjects[1].send(response(items: [], isDone: false))
        await waitUntil { store.hasLoaded }
        #expect(store.filter == filter)
        #expect(store.needsManualPagination)
        #expect(!store.showsReconciledTransactionsPrompt)
        store.loadMoreIfNeeded()
        #expect(!store.showsReconciledTransactionsPrompt)
        #expect(requests.count == 3 && requests[2].filter == filter)
        #expect(requests[2].cursor == "next")
        #expect(requests[2].paginationID == requests[1].paginationID)
        let older = TransactionFeedItem(
            id: "older", date: "2020-02-29", type: .regular,
            amount: filter == .inflow ? 100 : -100)
        subjects[2].send(response(items: [older], isDone: true))
        await waitUntil { store.sections.flatMap(\.entries).map(\.id) == ["older"] }
        #expect(!store.hasMore)
        #expect(!store.showsReconciledTransactionsPrompt)
        store.selectFilter(.all)
        #expect(feed.showsPlannedSection)
        #expect(!store.showsReconciledTransactionsPrompt)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["recent"])
        store.selectFilter(filter)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["older"])
        #expect(requests.count == 3)
        subjects[0].send(snapshot)
        subjects[2].send(response(items: [], isDone: true))
        await waitUntil { store.sections.isEmpty }
        #expect(store.filter == filter)
        #expect(store.visibleFilters.contains(filter))
        #expect(!store.hasMore && !store.isLoading)
    }

    @Test func flowFiltersExcludeTransfersZeroAmountsAndOppositeDirectionRestorations() {
        for type in [
            TransactionFeedItemType.regular, .startingBalance, .balanceAdjustment, .transfer,
        ] {
            for amount: Int64 in [-100, 0, 100] {
                let transaction = TransactionFeedItem(
                    id: "restored", date: "2026-09-12", type: type, amount: amount)
                #expect(
                    TransactionFeedFilter.inflow.matchesFlow(of: transaction)
                        == (type != .transfer && amount > 0))
                #expect(
                    TransactionFeedFilter.outflow.matchesFlow(of: transaction)
                        == (type != .transfer && amount < 0))
            }
        }
    }

    @Test func duplicateRequiresOneSelectedTransactionAndPreparesANewEditor() async throws {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        let snapshot = response(items: [item(id: "first"), item(id: "second")], isDone: true)
        let workspace = try #require(snapshot.workspace)
        let store = TransactionFeedStore(
            creationStoreFactory: { TransactionEditorStore(workspace: workspace) },
            subscriptionFactory: { _ in source.eraseToAnyPublisher() })
        store.start()
        source.send(snapshot)
        await waitUntil { store.hasLoaded }
        #expect(!store.canDuplicateSelection)
        #expect(store.makeSelectionDuplicateEditor() == nil)
        let first = store.sections[0].entries[0]
        let second = store.sections[0].entries[1]
        store.beginSelection(first)
        #expect(store.canDuplicateSelection)
        let copy = try #require(store.makeSelectionDuplicateEditor())
        #expect(copy.isCreating)
        #expect(copy.duplicationSourceID == first.id)
        #expect(copy.draft == nil)
        store.toggleSelection(second)
        #expect(!store.canDuplicateSelection)
        #expect(store.makeSelectionDuplicateEditor() == nil)
        store.endSelection()
        #expect(!store.canDuplicateSelection)
        store.stop()
    }

    @Test func shortcutFilterRemainsVisibleWhenItsQueueIsEmpty() async {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(subscriptionFactory: { _ in source.eraseToAnyPublisher() })
        store.start()
        store.selectFilter(.needsReview, keepEmpty: true)
        var snapshot = response(items: [], isDone: true)
        snapshot.filterCounts = .init(needsReview: 0, transfers: 0, pending: 0)
        source.send(snapshot)
        await waitUntil { store.hasLoaded }
        #expect(store.filter == .needsReview)
        #expect(store.visibleFilters == [.all, .needsReview, .inflow, .outflow])
        #expect(store.sections.isEmpty)
        store.selectFilter(.all)
        #expect(store.visibleFilters == [.all, .inflow, .outflow])
        store.reset()
    }

    @Test func agendaLoadingWaitsForBothSnapshotsInEitherArrivalOrder() {
        for feedLoaded in [false, true] {
            for agendaLoaded in [false, true] {
                #expect(
                    TransactionFeedLoadingState.isLoading(
                        feedLoaded: feedLoaded, feedFailed: false, showsAgenda: true,
                        hasWorkspace: true, agendaLoaded: agendaLoaded, agendaFailed: false)
                        == !(feedLoaded && agendaLoaded))
            }
        }
    }

    @Test func initialFailuresExposeRetryAndLoadedPagesDoNotWaitForAnUnusedAgenda() {
        for feedFailed in [false, true] {
            #expect(
                !TransactionFeedLoadingState.isLoading(
                    feedLoaded: false, feedFailed: feedFailed, showsAgenda: true,
                    hasWorkspace: true, agendaLoaded: false, agendaFailed: !feedFailed))
        }
        for showsAgenda in [false, true] {
            #expect(
                !TransactionFeedLoadingState.isLoading(
                    feedLoaded: true, feedFailed: false, showsAgenda: showsAgenda,
                    hasWorkspace: false, agendaLoaded: false, agendaFailed: false))
        }
        #expect(
            !TransactionFeedLoadingState.isLoading(
                feedLoaded: true, feedFailed: false, showsAgenda: false,
                hasWorkspace: true, agendaLoaded: false, agendaFailed: false))
    }

    @Test func rowNotesAreAvailableToVoiceOver() {
        let entry = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "note", date: "2026-09-06", type: .regular, amount: -100,
                notes: "Birthday lunch"))
        #expect(
            TransactionFeedRow(entry: entry, workspace: nil).accessibilityValue.contains(
                "Notes: Birthday lunch"))
    }

    @Test func onlyTheTopmostTransactionSurfaceOwnsTheReceiptPeek() {
        let store = TransactionFeedStore.preview
        let category = UUID()
        let search = UUID()
        #expect(store.receiptPresentationOwner == nil)
        store.registerReceiptPresentation(category)
        store.registerReceiptPresentation(search)
        store.registerReceiptPresentation(category)
        #expect(store.receiptPresentationOwner == search)
        store.unregisterReceiptPresentation(search)
        #expect(store.receiptPresentationOwner == category)
        store.unregisterReceiptPresentation(category)
        #expect(store.receiptPresentationOwner == nil)
    }

    @Test func searchCanDeleteAndUndoAnUnloadedTransactionWithoutChangingMainRows() async throws {
        var actions: [TransactionFeedAction] = []
        let initial = response(items: [item(id: "recent")], isDone: true)
        let store = TransactionFeedStore(
            workspace: initial.workspace,
            mutationHandler: { workspaceID, ids, action in
                #expect(workspaceID == "workspace")
                #expect(ids == ["older-search-result"])
                actions.append(action)
                return []
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        store.start()
        await waitUntil { store.hasLoaded }
        let entry = TransactionFeedEntry(item: item(id: "older-search-result"))
        await store.perform(.delete, on: entry)
        #expect(actions.isEmpty)
        await store.perform(.delete, on: entry, searchWorkspaceID: "another-workspace")
        #expect(actions.isEmpty)
        await store.perform(.delete, on: entry, searchWorkspaceID: "workspace")
        #expect(actions == [.delete])
        #expect(store.canUndoDeletion)
        #expect(store.deletedEntries == [entry])
        let searchSections = [TransactionFeedSection(id: entry.date, entries: [entry])]
        #expect(store.visibleSections(searchSections).isEmpty)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["recent"])
        await store.undoLastDeletion()
        #expect(actions == [.delete, .restore])
        #expect(store.deletedEntries.isEmpty)
        #expect(store.visibleSections(searchSections).flatMap(\.entries) == [entry])
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["recent"])
        store.stop()
    }

    @Test func searchSwipeOnlyPerformsTheEntriesAvailableLeadingAction() async throws {
        var actions: [TransactionFeedAction] = []
        let initial = response(items: [], isDone: true)
        let store = TransactionFeedStore(
            workspace: initial.workspace,
            mutationHandler: { _, _, action in
                actions.append(action)
                return []
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        let transaction = TransactionFeedItem(
            id: "older", date: "2020-02-29", type: .regular, status: .pending, amount: -100)
        let entry = TransactionFeedEntry(item: transaction)
        await store.perform(.setStatus(.pending), on: entry, searchWorkspaceID: "workspace")
        #expect(actions.isEmpty)
        await store.perform(.setStatus(.cleared), on: entry, searchWorkspaceID: "workspace")
        #expect(actions == [.setStatus(.cleared)])
    }

    @Test func failedSearchDeletionRestoresTheResultAndAllowsRetry() async throws {
        let initial = response(items: [], isDone: true)
        let store = TransactionFeedStore(
            workspace: initial.workspace,
            mutationHandler: { _, _, _ in throw URLError(.notConnectedToInternet) },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        let entry = TransactionFeedEntry(item: item(id: "older"))
        await store.perform(.delete, on: entry, searchWorkspaceID: "workspace")
        #expect(store.deletedEntries.isEmpty)
        #expect(!store.isPerformingAction)
        #expect(!store.canUndoDeletion)
        #expect(store.latestMutationReceipt == nil)
        #expect(store.actionErrorMessage != nil)
        #expect(
            store.visibleSections([.init(id: entry.date, entries: [entry])]).flatMap(\.entries)
                == [entry])
    }

    @Test func scheduledEntriesKeepTheirBadgeAndAccessibleOrigin() {
        let entry = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "scheduled", scheduledTransactionId: "plan", date: "2026-09-04",
                type: .regular, amount: -100))
        #expect(entry.scheduledTransactionId == "plan")
        #expect(
            TransactionFeedRow(entry: entry, workspace: nil).accessibilityValue.contains(
                "From plan"))
        let manual = TransactionFeedEntry(item: item(id: "manual"))
        #expect(manual.scheduledTransactionId == nil)
        #expect(
            !TransactionFeedRow(entry: manual, workspace: nil).accessibilityValue.contains(
                "From plan"))
    }

    @Test func transferSuggestionApprovalTakesPriorityOverCategorization() {
        var suggested = TransactionFeedItem(
            id: "suggestion", date: "2026-09-04", type: .regular,
            reviewStatus: .needsReview, amount: -1200, hasUncategorized: true)
        suggested.suggestedTransfer = .init(status: "pending", detectionReason: "Bank transfer")
        let incomplete = TransactionFeedEntry(item: suggested)
        #expect(incomplete.title == "Suggested transfer")
        #expect(incomplete.fallbackIcon == .transfer)
        #expect(incomplete.swipeAction == .approve)
        #expect(incomplete.opensEditorForApproval)
        suggested.suggestedTransfer?.suggestedCounterpartAccountId = "savings"
        suggested.suggestedTransfer?.accountConfidence = 90
        let complete = TransactionFeedEntry(item: suggested)
        #expect(complete.swipeAction == .approve)
        #expect(!complete.opensEditorForApproval)
        suggested.suggestedTransfer = nil
        #expect(TransactionFeedEntry(item: suggested).swipeAction == .categorize)
    }

    @Test func filterSwitchesUseCompleteLiveSnapshotsWithoutQueriesOrLosingAllPages() async throws {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        let feed = TransactionFeedView(store: store, isActive: true, showsAgenda: true)
        #expect(!feed.isPlannedExpanded)
        #expect(!feed.isCalendarExpanded)
        store.start()
        var snapshot = response(items: [item(id: "recent")], isDone: false)
        snapshot.filterTransactions = .init(
            needsReview: (0..<85).map { item(id: "review-\($0)") },
            transfers: [item(id: "transfer")], pending: [item(id: "pending")])
        subjects[0].send(snapshot)
        await waitUntil { store.hasLoaded }
        store.loadMoreIfNeeded(after: "recent")
        subjects[1].send(response(items: [item(id: "older")], isDone: true))
        await waitUntil { store.sections.flatMap(\.entries).count == 2 }
        let transitionRevision = store.rowTransitionRevision
        #expect(feed.showsPlannedSection)
        for _ in 0..<10 {
            store.selectFilter(.needsReview)
            #expect(!feed.showsPlannedSection)
            #expect(store.hasLoaded)
            #expect(!store.isLoading)
            #expect(store.sections.flatMap(\.entries).count == 85)
            store.loadMoreIfNeeded()
            store.selectFilter(.transfers)
            #expect(!feed.showsPlannedSection)
            #expect(store.sections.flatMap(\.entries).map(\.id) == ["transfer"])
            store.selectFilter(.pending)
            #expect(!feed.showsPlannedSection)
            #expect(store.sections.flatMap(\.entries).map(\.id) == ["pending"])
            store.selectFilter(.all)
            #expect(feed.showsPlannedSection)
            #expect(store.sections.flatMap(\.entries).map(\.id) == ["recent", "older"])
        }
        #expect(requests.count == 2)
        #expect(store.rowTransitionRevision == transitionRevision)
        store.selectFilter(.needsReview)
        snapshot.filterTransactions?.needsReview = [item(id: "new-review")]
        subjects[0].send(snapshot)
        await waitUntil { store.sections.flatMap(\.entries).map(\.id) == ["new-review"] }
        #expect(requests.count == 2)
        store.reset()
        store.selectFilter(.needsReview)
        #expect(store.sections.isEmpty)
        #expect(!store.hasLoaded)
    }

    @Test func filterCountsHideEmptyChipsAndReturnToAllWhenTheSelectedQueueEmpties() async throws {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        store.start()
        var snapshot = response(items: [item(id: "review")], isDone: true)
        snapshot.filterCounts = .init(needsReview: 1, transfers: 0, pending: 2)
        subjects[0].send(snapshot)
        await waitUntil { store.hasLoaded }
        #expect(store.visibleFilters == [.all, .needsReview, .inflow, .outflow, .pending])
        #expect(store.filterCounts.count(for: .pending) == 2)
        store.selectFilter(.needsReview)
        snapshot.filterCounts = .init(needsReview: 0, transfers: 0, pending: 3)
        subjects[0].send(snapshot)
        await waitUntil { store.filter == .all }
        #expect(store.visibleFilters == [.all, .inflow, .outflow, .pending])
        #expect(requests.count == 1)
        store.reset()
        #expect(store.visibleFilters == [.all, .inflow, .outflow])
    }

    @Test func anEmptyLaterPageStopsRowTriggeredPagination() async throws {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        store.start()
        subjects[0].send(response(items: [item(id: "match")], isDone: false))
        await waitUntil { store.hasLoaded }
        store.loadMoreIfNeeded(after: "match")
        #expect(requests.count == 2)
        subjects[1].send(response(items: [], isDone: false))
        await waitUntil { !store.isLoadingMore }
        #expect(store.needsManualPagination)
        for _ in 0..<5 {
            store.loadMoreIfNeeded(after: "match")
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(requests.count == 2)
        store.loadMoreIfNeeded()
        #expect(requests.count == 3)
        subjects[2].send(response(items: [], isDone: true))
        await waitUntil { !store.isLoadingMore }
        #expect(!store.hasMore)
        #expect(!store.needsManualPagination)
        store.stop()
    }

    @Test func recommendedPaginationSplitKeepsTheUsablePage() async throws {
        var requestCount = 0
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(subscriptionFactory: { _ in
            requestCount += 1
            return subject.eraseToAnyPublisher()
        })
        store.start()
        let snapshot = response(items: [], isDone: false)
        for _ in 0..<5 {
            subject.send(
                TransactionFeedResponse(
                    workspace: snapshot.workspace,
                    transactions: .init(
                        page: [], continueCursor: "next", isDone: false,
                        splitCursor: "split", pageStatus: .splitRecommended)))
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(requestCount == 1)
        #expect(store.hasMore && store.needsManualPagination)
        #expect(store.errorMessage == nil)
        store.stop()
    }

    @Test func requiredSplitReplacesTheRangeAndKeepsItsSnapshotUntilBothHalvesArrive() async throws
    {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        store.start()
        let snapshot = response(items: [item(id: "original")], isDone: false)
        subjects[0].send(snapshot)
        await waitUntil { store.hasLoaded }
        subjects[0].send(
            TransactionFeedResponse(
                workspace: snapshot.workspace,
                transactions: .init(
                    page: [item(id: "incomplete")], continueCursor: "end", isDone: false,
                    splitCursor: "middle", pageStatus: .splitRequired)))
        await waitUntil { requests.count == 3 }
        #expect(requests[1].cursor == nil && requests[1].endCursor == "middle")
        #expect(requests[2].cursor == "middle" && requests[2].endCursor == "end")
        #expect(requests[1].paginationID == requests[0].paginationID)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["original"])
        subjects[2].send(response(items: [item(id: "second")], isDone: true))
        try await Task.sleep(for: .milliseconds(20))
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["original"])
        subjects[0].send(response(items: [item(id: "stale")], isDone: true))
        subjects[1].send(response(items: [item(id: "first")], isDone: false))
        await waitUntil { store.sections.flatMap(\.entries).map(\.id) == ["first", "second"] }
        #expect(!store.hasMore && !store.isLoadingMore)
        #expect(store.errorMessage == nil)
        store.stop()
    }

    @Test func initialAndNestedRequiredSplitsRetainTheirOriginalEndBoundaries() async throws {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        store.start()
        let snapshot = response(items: [], isDone: false)
        subjects[0].send(
            TransactionFeedResponse(
                workspace: snapshot.workspace,
                transactions: .init(
                    page: [], continueCursor: "end", isDone: false,
                    splitCursor: "middle", pageStatus: .splitRequired)))
        await waitUntil { requests.count == 3 }
        subjects[1].send(
            TransactionFeedResponse(
                workspace: snapshot.workspace,
                transactions: .init(
                    page: [], continueCursor: "middle", isDone: false,
                    splitCursor: "quarter", pageStatus: .splitRequired)))
        await waitUntil { requests.count == 6 }
        #expect(requests[3].cursor == nil && requests[3].endCursor == "quarter")
        #expect(requests[4].cursor == "quarter" && requests[4].endCursor == "middle")
        #expect(requests[5].cursor == "middle" && requests[5].endCursor == "end")
        subjects[5].send(response(items: [item(id: "third")], isDone: true))
        subjects[4].send(response(items: [item(id: "second")], isDone: false))
        subjects[3].send(response(items: [item(id: "first")], isDone: false))
        await waitUntil { store.sections.flatMap(\.entries).count == 3 }
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["first", "second", "third"])
        #expect(store.errorMessage == nil)
        store.stop()
    }

    @Test func largeFilterQueuesPaginateAndRetainAllHistoryAcrossSwitches() async throws {
        var requests: [TransactionFeedSubscriptionRequest] = []
        var subjects: [PassthroughSubject<TransactionFeedResponse, Error>] = []
        let store = TransactionFeedStore(subscriptionFactory: { request in
            requests.append(request)
            let subject = PassthroughSubject<TransactionFeedResponse, Error>()
            subjects.append(subject)
            return subject.eraseToAnyPublisher()
        })
        store.start()
        var snapshot = response(items: [item(id: "recent")], isDone: false)
        snapshot.filterSetsComplete = false
        subjects[0].send(snapshot)
        await waitUntil { store.hasLoaded }
        #expect(store.visibleFilters == TransactionFeedFilter.allCases)
        #expect(!store.filterCountsAreComplete)
        store.selectFilter(.needsReview)
        #expect(requests.count == 2 && requests[1].filter == .needsReview)
        subjects[1].send(response(items: [item(id: "review")], isDone: false))
        await waitUntil { store.sections.flatMap(\.entries).map(\.id) == ["review"] }
        store.loadMoreIfNeeded(after: "review")
        #expect(requests.count == 3 && requests[2].filter == .needsReview)
        subjects[2].send(response(items: [item(id: "older-review")], isDone: true))
        await waitUntil { store.sections.flatMap(\.entries).count == 2 }
        store.selectFilter(.all)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["recent"])
        #expect(store.hasMore)
        store.loadMoreIfNeeded(after: "recent")
        #expect(requests.count == 4 && requests[3].filter == .all)
        subjects[3].send(response(items: [item(id: "older")], isDone: true))
        await waitUntil { store.sections.flatMap(\.entries).count == 2 }
        store.selectFilter(.needsReview)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["review", "older-review"])
        #expect(!store.hasMore)
        #expect(requests.count == 4)
        subjects[2].send(completion: .failure(URLError(.notConnectedToInternet)))
        await waitUntil { store.errorMessage != nil }
        store.selectFilter(.all)
        #expect(store.errorMessage == nil)
        store.selectFilter(.needsReview)
        #expect(store.errorMessage != nil)
        store.retry()
        #expect(requests.count == 5 && requests[4] == requests[2])
        subjects[4].send(response(items: [item(id: "older-review")], isDone: true))
        await waitUntil { store.errorMessage == nil }
        store.stop()
    }

    @Test(arguments: [320.0, 390.0])
    func sharedTransactionListHasFullWidthRowsWithoutGapsBetweenDates(width: Double) async throws {
        let first = TransactionFeedEntry(
            item: .init(id: "first", date: "2026-09-12", type: .regular, amount: -100))
        let second = TransactionFeedEntry(
            item: .init(id: "second", date: "2026-09-11", type: .regular, amount: -200))
        let sections = [
            TransactionFeedSection(id: first.date, entries: [first]),
            TransactionFeedSection(id: second.date, entries: [second]),
        ]
        var inspected = false
        _ = try await HostedViewSnapshot.image(
            of: List {
                TransactionFeedRows(
                    sections: sections, workspace: nil, listWidth: width,
                    onEdit: { _ in }, onAction: { _, _ in })
            }.modifier(TransactionFeedListStyle()),
            size: CGSize(width: width, height: 740),
            inspect: { root in
                func inspect(_ view: UIView) {
                    if let collection = view as? UICollectionView {
                        let cells =
                            (collection.collectionViewLayout.layoutAttributesForElements(
                                in: collection.bounds) ?? [])
                            .filter { $0.representedElementCategory == .cell }
                            .sorted { $0.frame.minY < $1.frame.minY }
                        #expect(cells.count == 4)
                        for cell in cells {
                            #expect(abs(cell.frame.width - width) <= 1)
                            #expect(abs(cell.frame.minX) <= 1)
                        }
                        for (previous, next) in zip(cells, cells.dropFirst()) {
                            #expect(abs(previous.frame.maxY - next.frame.minY) <= 1)
                        }
                        inspected = true
                    }
                    for child in view.subviews { inspect(child) }
                }
                inspect(root)
            })
        #expect(inspected)
    }

    @Test(arguments: [1.0, 2.0, 3.0])
    func dateHeaderDrawsMatchingTopAndBottomBorders(scale: Double) throws {
        let renderer = ImageRenderer(
            content: Text("SEPTEMBER 12")
                .modifier(
                    TransactionFeedDayHeaderRow(background: PlannedStyle.transactionDateSurface)
                )
                .frame(width: 340)
                .background(PlannedStyle.transactionDateSurface)
        )
        renderer.scale = scale
        let image = try #require(renderer.uiImage?.cgImage)
        let top = try #require(
            image.cropping(to: CGRect(x: 0, y: 0, width: image.width, height: Int(scale))))
        let bottom = try #require(
            image.cropping(
                to: CGRect(
                    x: 0, y: image.height - Int(scale), width: image.width, height: Int(scale))))
        #expect(try #require(UIImage(cgImage: top).pngData()) == UIImage(cgImage: bottom).pngData())
    }

    @Test
    func metadataWrapsWholeChipsAtTheirNaturalWidths() throws {
        for (width, height) in [(250, 30), (170, 55), (100, 80)] {
            let renderer = ImageRenderer(
                content: TransactionMetadataLayout {
                    Color.red.frame(width: 100, height: 20)
                    Color.blue.frame(width: 60, height: 30)
                    Color.green.frame(width: 80, height: 20)
                }
                .frame(width: CGFloat(width))
            )
            let image = try #require(renderer.uiImage)
            #expect(image.size == CGSize(width: width, height: height))
        }
    }

    @Test
    func anOversizedChipWrapsItsTextAndTheRowGrowsToFit() throws {
        let account = "Joint Household Checking and Everyday Expenses"
        let chip = TransactionMetadataChip(title: account, icon: .bank)
        let narrowChip = try #require(ImageRenderer(content: chip.frame(width: 130)).uiImage)
        let wideChip = try #require(ImageRenderer(content: chip.frame(width: 600)).uiImage)
        #expect(narrowChip.size.height > wideChip.size.height * 2)

        let entry = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "long-details", date: "2026-09-04", type: .regular,
                amount: -1234, merchantName: "Market", bankAccountName: account,
                categoryNames: ["Groceries and Household Supplies", "Dining and Entertainment"]
            )
        )
        let row = TransactionFeedRow(entry: entry, workspace: nil)
        let narrowRow = try #require(ImageRenderer(content: row.frame(width: 284)).uiImage)
        let wideRow = try #require(ImageRenderer(content: row.frame(width: 700)).uiImage)
        #expect(narrowRow.size.height > wideRow.size.height)
    }

    @Test
    func amountWidthDoesNotReduceTheSpaceForMetadata() throws {
        var heights: [CGFloat] = []
        for amount: Int64 in [-100, -123_456_789] {
            let entry = TransactionFeedEntry(
                item: TransactionFeedItem(
                    id: "amount", date: "2026-09-04", type: .regular,
                    amount: amount, merchantName: "Market",
                    bankAccountName: "Household Checking", categoryNames: ["Groceries"]
                )
            )
            let row = TransactionFeedRow(entry: entry, workspace: nil).frame(width: 340)
            heights.append(try #require(ImageRenderer(content: row).uiImage).size.height)
        }
        #expect(heights[0] == heights[1])
    }

    @Test
    func reviewAndPendingRemainAccessibleTogetherWithoutChangingTheRowHeight() throws {
        var heights: [CGFloat] = []
        var amountImages: [Data] = []
        for reviewStatus in [TransactionFeedReviewStatus.reviewed, .needsReview] {
            for status in [TransactionFeedStatus.cleared, .pending] {
                let entry = TransactionFeedEntry(
                    item: TransactionFeedItem(
                        id: "status", date: "2026-09-04", type: .regular,
                        status: status, reviewStatus: reviewStatus,
                        amount: -1234, merchantName: "Market",
                        bankAccountName: "Checking", categoryNames: ["Groceries"]
                    )
                )
                let row = TransactionFeedRow(entry: entry, workspace: nil)
                let image = try #require(
                    ImageRenderer(content: row.frame(width: 340)).uiImage
                )
                heights.append(image.size.height)
                let amountCrop = try #require(
                    image.cgImage?.cropping(to: CGRect(x: 300, y: 0, width: 40, height: 40))
                )
                amountImages.append(try #require(UIImage(cgImage: amountCrop).pngData()))
                #expect(row.accessibilityValue.contains("Pending") == (status == .pending))
                #expect(
                    row.accessibilityValue.contains("Needs review")
                        == (reviewStatus == .needsReview)
                )
            }
        }
        #expect(Set(heights).count == 1)
        #expect(Set(amountImages).count == 1, "The amount must stay aligned with the title")
    }

    @Test
    func approvalBadgeUsesPrimaryColorAndMissingDetailsKeepTheWarning() throws {
        for reviewStatus in [TransactionFeedReviewStatus.reviewed, .needsReview] {
            for hasUncategorized in [false, true] {
                for hasMissingPayee in [false, true] {
                    let entry = TransactionFeedEntry(
                        item: TransactionFeedItem(
                            id: "badge", date: "2026-09-04", type: .regular,
                            reviewStatus: reviewStatus, amount: -100, merchantName: "Market",
                            hasUncategorized: hasUncategorized, hasMissingPayee: hasMissingPayee
                        )
                    )
                    let renderer = ImageRenderer(
                        content: TransactionFeedRow(entry: entry, workspace: nil)
                            .frame(width: 340)
                            .accentColor(.blue)
                            .environment(\.colorScheme, .light)
                    )
                    renderer.scale = 1
                    let image = try #require(renderer.uiImage?.cgImage)
                    var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
                    try pixels.withUnsafeMutableBytes { buffer in
                        let context = try #require(
                            CGContext(
                                data: buffer.baseAddress, width: image.width, height: image.height,
                                bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                            )
                        )
                        context.draw(
                            image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height)
                        )
                    }
                    var hasPrimaryBadge = false
                    var hasWarningBadge = false
                    // Only inspect the neutral merchant mark and its overlaid badge.
                    for y in 0..<image.height {
                        for x in 0..<52 {
                            let offset = (y * image.width + x) * 4
                            let red = Int(pixels[offset])
                            let green = Int(pixels[offset + 1])
                            let blue = Int(pixels[offset + 2])
                            hasPrimaryBadge = hasPrimaryBadge || (blue > 150 && blue > red + 40)
                            hasWarningBadge =
                                hasWarningBadge
                                || (red > 150 && red > green + 40 && red > blue + 40)
                        }
                    }
                    #expect(hasPrimaryBadge == (reviewStatus == .needsReview))
                    #expect(
                        hasWarningBadge
                            == (reviewStatus == .reviewed && (hasUncategorized || hasMissingPayee))
                    )
                }
            }
        }
    }

    @Test
    func categoryChipsIncludeEveryUniqueCategoryAndUncategorizedSplits() {
        let entry = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "categories", date: "2026-09-04", type: .regular, amount: -100,
                categoryNames: ["Groceries", "Dining", "Groceries", " Travel ", " "],
                hasUncategorized: true
            )
        )
        #expect(entry.categoryLabels == ["Groceries", "Dining", "Travel", "Uncategorized"])
        let row = TransactionFeedRow(entry: entry, workspace: nil)
        #expect(row.accessibilityValue.contains("Groceries, Dining, Travel, Uncategorized"))
        #expect(row.accessibilityValue.contains("Details needed"))
    }

    @Test
    func rendersTransactionRowsAcrossWidthsAndAppearance() throws {
        let items = [
            TransactionFeedItem(
                id: "regular", date: "2026-09-04", type: .regular,
                amount: -8420, merchantName: "Trader Joe's",
                merchantVisualIdentityMode: "icon", merchantIconColorId: "red",
                bankAccountName: "Chase Checking", categoryNames: ["Groceries"]
            ),
            TransactionFeedItem(
                id: "pending", date: "2026-09-04", type: .regular, status: .pending,
                amount: 342000, merchantName: "Payroll",
                bankAccountName: "Checking", categoryNames: ["Ready to Assign"]
            ),
            TransactionFeedItem(
                id: "review", date: "2026-09-04", type: .regular,
                status: .pending, reviewStatus: .needsReview,
                amount: -16432, merchantName: "Whole Foods Market",
                merchantVisualIdentityMode: "icon", merchantIconColorId: "green",
                bankAccountName: "Joint Household Checking and Everyday Expenses",
                categoryNames: ["Groceries and Household Supplies", "Dining Out", "Personal Care"]
            ),
            TransactionFeedItem(
                id: "missing-details", date: "2026-09-04", type: .regular,
                amount: -2500, merchantName: "Corner Market",
                bankAccountName: "Checking", hasUncategorized: true
            ),
            TransactionFeedItem(
                id: "transfer-out", transferGroupId: "transfer-pair", date: "2026-09-04",
                type: .transfer,
                amount: -20000, bankAccountName: "Chase Checking",
                bankAccountType: "banking_checking",
                transferPairAccountName: "Emergency Fund Savings",
                transferPairAccountType: "banking_savings"
            ),
            TransactionFeedItem(
                id: "transfer-in", transferGroupId: "transfer-pair", date: "2026-09-04",
                type: .transfer,
                amount: 20000, bankAccountName: "Emergency Fund Savings",
                bankAccountType: "banking_savings",
                transferPairAccountName: "Chase Checking",
                transferPairAccountType: "banking_checking"
            ),
            TransactionFeedItem(
                id: "payment-out", transferGroupId: "payment-pair", date: "2026-09-04",
                type: .transfer,
                amount: -35000, bankAccountName: "Chase Checking",
                bankAccountType: "banking_checking",
                transferPairAccountName: "Sapphire Preferred",
                transferPairAccountType: "credit_credit_card",
                isCreditCardPayment: true
            ),
            TransactionFeedItem(
                id: "payment-in", transferGroupId: "payment-pair", date: "2026-09-04",
                type: .transfer,
                amount: 35000, bankAccountName: "Sapphire Preferred",
                bankAccountType: "credit_credit_card",
                transferPairAccountName: "Chase Checking",
                transferPairAccountType: "banking_checking",
                isCreditCardPayment: true
            ),
            TransactionFeedItem(
                id: "long-title", date: "2026-09-04", type: .regular,
                amount: -123_456_789, merchantName: "ONLINE PAYMENT TO AMERICAN EXPRESS",
                bankAccountName: "Checking", categoryNames: ["Credit Card Payment"]
            ),
        ]
        for (width, appearance, typeSize) in [
            (393, ColorScheme.light, DynamicTypeSize.large),
            (320, ColorScheme.light, DynamicTypeSize.large),
            (393, ColorScheme.dark, DynamicTypeSize.large),
            (393, ColorScheme.light, DynamicTypeSize.accessibility3),
        ] {
            let renderer = ImageRenderer(
                content: VStack(spacing: 0) {
                    ForEach(items) { item in
                        TransactionFeedRow(entry: TransactionFeedEntry(item: item), workspace: nil)
                    }
                }
                .padding(.horizontal, 18)
                .frame(width: CGFloat(width))
                .background(KualiaPalette.transactionsPage)
                .environment(\.colorScheme, appearance)
                .environment(\.dynamicTypeSize, typeSize)
            )
            renderer.scale = 2
            let image = try #require(renderer.uiImage)
            let data = try #require(image.pngData())
            Attachment.record(
                Array(data), named: "transaction-rows-\(width)-\(appearance)-\(typeSize).png"
            )
            #expect(image.size.width == CGFloat(width))
        }
    }

    @Test func rowSwipeRejectsVerticalAndAmbiguousMotion() {
        #expect(!TransactionSwipeMotion.shouldBegin(velocity: .zero))
        #expect(!TransactionSwipeMotion.shouldBegin(velocity: CGPoint(x: 20, y: 100)))
        #expect(!TransactionSwipeMotion.shouldBegin(velocity: CGPoint(x: 100, y: 100)))
        #expect(TransactionSwipeMotion.shouldBegin(velocity: CGPoint(x: 100, y: 20)))
        #expect(TransactionSwipeMotion.shouldBegin(velocity: CGPoint(x: -100, y: 20)))
    }

    @Test func swipedContentCrossesTheRestingInsetsAndClipsAtTheListEdge() throws {
        for offset: CGFloat in [-32, 32] {
            let renderer = ImageRenderer(
                content:
                    HStack(spacing: 0) {
                        Color(red: 0, green: 0, blue: 1).frame(height: 40)
                            .modifier(TransactionSwipeTranslation(offset: offset))
                            .clipped()
                            .frame(width: 390)
                        Color.clear.frame(width: 20, height: 40)
                    }
                    .background(Color(red: 1, green: 0, blue: 0)))
            renderer.scale = 1
            let image = try #require(renderer.cgImage)
            var pixels = [UInt8](repeating: 0, count: 410 * 40 * 4)
            try pixels.withUnsafeMutableBytes { buffer in
                let context = try #require(
                    CGContext(
                        data: buffer.baseAddress, width: 410, height: 40,
                        bitsPerComponent: 8, bytesPerRow: 410 * 4,
                        space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                context.draw(image, in: CGRect(x: 0, y: 0, width: 410, height: 40))
            }
            let gutterPixel = (20 * 410 + (offset < 0 ? 4 : 385)) * 4
            #expect(pixels[gutterPixel + 2] > 200)
            #expect(pixels[gutterPixel] < 50)
            let outsidePixel = (20 * 410 + 400) * 4
            #expect(pixels[outsidePixel] > 200)
            #expect(pixels[outsidePixel + 2] < 50)
        }
    }

    @Test func settlingActionBackgroundStaysInsideTheVacatedStrip() throws {
        // Sample the actual presentation modifier across full-swipe returns,
        // partial closes, and direction reversals. Transparent content exposes
        // any action color that leaks under the row, as in the reported bug.
        for allowedEdge: TransactionSwipeMotion.Edge? in [nil, .leading, .trailing] {
            for direction: CGFloat in [-1, 1] {
                for offset: CGFloat in [-390, -280, -88, -44, -4, 0, 4, 44, 88, 280, 390] {
                    var presentation = TransactionSwipePresentation(
                        offset: 0, direction: direction, actionWidth: 88, allowedEdge: allowedEdge,
                        leading: { Color(red: 0, green: 1, blue: 0) },
                        trailing: { Color(red: 1, green: 0, blue: 0) })
                    presentation.animatableData = offset
                    let renderer = ImageRenderer(
                        content: Color.clear.frame(height: 40)
                            .modifier(presentation)
                            .frame(width: 390)
                            .background(Color.white)
                            .environment(
                                \.layoutDirection, direction < 0 ? .rightToLeft : .leftToRight)
                    )
                    renderer.scale = 1
                    let image = try #require(renderer.cgImage)
                    var pixels = [UInt8](repeating: 0, count: 390 * 40 * 4)
                    try pixels.withUnsafeMutableBytes { buffer in
                        let context = try #require(
                            CGContext(
                                data: buffer.baseAddress, width: 390, height: 40,
                                bitsPerComponent: 8, bytesPerRow: 390 * 4,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                        context.draw(image, in: CGRect(x: 0, y: 0, width: 390, height: 40))
                    }
                    for x in 0..<390 {
                        let physicalOffset = offset * direction
                        let sideAllowed =
                            offset > 0 ? allowedEdge != .trailing : allowedEdge != .leading
                        let revealed =
                            sideAllowed
                            && (physicalOffset > 0
                                ? CGFloat(x) < physicalOffset : CGFloat(x) >= 390 + physicalOffset)
                        let pixel = (20 * 390 + x) * 4
                        if !revealed {
                            #expect(
                                pixels[pixel] > 240 && pixels[pixel + 1] > 240
                                    && pixels[pixel + 2] > 240)
                        } else if offset > 0 {
                            #expect(
                                pixels[pixel] < 10 && pixels[pixel + 1] > 240
                                    && pixels[pixel + 2] < 10)
                        } else {
                            #expect(
                                pixels[pixel] > 240 && pixels[pixel + 1] < 10
                                    && pixels[pixel + 2] < 10)
                        }
                    }
                }
            }
        }
    }

    @Test func rowSwipeClampsUnavailableActionsAndPreservesDragOrigin() {
        let both = TransactionSwipeMotion(width: 354, hasLeadingAction: true)
        let deleteOnly = TransactionSwipeMotion(width: 354, hasLeadingAction: false)
        #expect(both.dragOffset(origin: -88, translation: 40) == -48)
        #expect(both.dragOffset(origin: 0, translation: 900) == 354)
        #expect(both.dragOffset(origin: 0, translation: -900) == -354)
        #expect(deleteOnly.dragOffset(origin: 0, translation: 100) == 0)
        #expect(deleteOnly.settlement(offset: 300, velocity: 0) == .closed)
        #expect(deleteOnly.settlement(offset: -300, velocity: 0) == .perform(.trailing))
    }

    @Test func shortSwipesCloseOrRevealWithoutPerformingAnAction() {
        let motion = TransactionSwipeMotion(width: 354, hasLeadingAction: true)
        #expect(motion.settlement(offset: 20, velocity: 0) == .closed)
        #expect(motion.settlement(offset: -20, velocity: 0) == .closed)
        #expect(motion.settlement(offset: 60, velocity: 0) == .open(.leading))
        #expect(motion.settlement(offset: -60, velocity: 0) == .open(.trailing))
        #expect(motion.settlement(offset: -40, velocity: 200) == .closed)
        #expect(motion.settlement(offset: -60, velocity: 5000) == .closed)
        #expect(motion.settlement(offset: 60, velocity: -5000) == .closed)
        #expect(motion.openOffset(for: .leading) == 88)
        #expect(motion.openOffset(for: .trailing) == -88)
    }

    @Test func bothActionsTriggerAtFortyPercentWithRoomToRevealTheButton() {
        let motion = TransactionSwipeMotion(width: 390, hasLeadingAction: true)
        #expect(motion.settlement(offset: 155, velocity: 0) == .open(.leading))
        #expect(motion.settlement(offset: -155, velocity: 0) == .open(.trailing))
        #expect(motion.settlement(offset: 156, velocity: 0) == .perform(.leading))
        #expect(motion.settlement(offset: -156, velocity: 0) == .perform(.trailing))

        let narrow = TransactionSwipeMotion(width: 284, hasLeadingAction: true)
        #expect(narrow.settlement(offset: narrow.actionWidth, velocity: 0) == .open(.leading))
        #expect(narrow.settlement(offset: -narrow.actionWidth, velocity: 0) == .open(.trailing))
        #expect(narrow.commitDistance - narrow.actionWidth >= 44)
    }

    @Test func swipeFeedbackArmsOnlyTheAvailableActionAtItsTriggerPoint() {
        let motion = TransactionSwipeMotion(width: 390, hasLeadingAction: true)
        #expect(motion.armedEdge(offset: 155) == nil)
        #expect(motion.armedEdge(offset: 156) == .leading)
        #expect(motion.armedEdge(offset: 250) == .leading)
        #expect(motion.armedEdge(offset: -155) == nil)
        #expect(motion.armedEdge(offset: -156) == .trailing)
        #expect(motion.armedEdge(offset: 0) == nil)
        let deleteOnly = TransactionSwipeMotion(width: 390, hasLeadingAction: false)
        #expect(deleteOnly.armedEdge(offset: 250) == nil)
        #expect(deleteOnly.armedEdge(offset: -156) == .trailing)
        #expect(
            TransactionSwipeMotion(width: 0, hasLeadingAction: true).armedEdge(offset: 250) == nil)
    }

    @Test func armedSwipeIconTracksTheFarEdgeAsTheActionAreaGrows() throws {
        for width in [160, 240, 390] {
            for edge: TransactionSwipeMotion.Edge in [.leading, .trailing] {
                for direction: CGFloat in [-1, 1] {
                    for armed in [false, true] {
                        let renderer = ImageRenderer(
                            content: Color(red: 0, green: 0, blue: 1).frame(width: 8, height: 8)
                                .modifier(
                                    TransactionSwipeActionCue(
                                        edge: edge, armed: armed, direction: direction,
                                        contentWidth: 56)
                                )
                                .frame(width: CGFloat(width), height: 20)
                                .background(Color.white))
                        renderer.scale = 1
                        let image = try #require(renderer.cgImage)
                        var pixels = [UInt8](repeating: 0, count: width * 20 * 4)
                        try pixels.withUnsafeMutableBytes { buffer in
                            let context = try #require(
                                CGContext(
                                    data: buffer.baseAddress, width: width, height: 20,
                                    bitsPerComponent: 8, bytesPerRow: width * 4,
                                    space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: 20))
                        }
                        let bluePositions = (0..<width).filter { x in
                            let pixel = (10 * width + x) * 4
                            return pixels[pixel] < 10 && pixels[pixel + 2] > 240
                        }
                        let firstBluePixel = try #require(bluePositions.first)
                        if !armed {
                            #expect(firstBluePixel == width / 2 - 4)
                        } else {
                            let movesRight = (edge == .leading) == (direction > 0)
                            #expect(firstBluePixel == (movesRight ? width - 32 : 24))
                        }
                    }
                }
            }
        }
    }

    @Test func triggerIconInterpolatesWhileTheActionAreaChangesWidth() throws {
        for width in [160, 240, 390] {
            for movesRight in [false, true] {
                for progress: CGFloat in [0, 0.25, 0.5, 0.75, 1] {
                    let center = CGFloat(width) / 2
                    let endpoint = movesRight ? CGFloat(width) - 28 : 28
                    var placement = TransactionSwipeIconPlacement(
                        progress: 0, center: center, armedCenter: endpoint, height: 20)
                    placement.animatableData = progress
                    let renderer = ImageRenderer(
                        content: Color(red: 0, green: 0, blue: 1).frame(width: 8, height: 8)
                            .modifier(placement)
                            .frame(width: CGFloat(width), height: 20)
                            .background(Color.white))
                    renderer.scale = 1
                    let image = try #require(renderer.cgImage)
                    var pixels = [UInt8](repeating: 0, count: width * 20 * 4)
                    try pixels.withUnsafeMutableBytes { buffer in
                        let context = try #require(
                            CGContext(
                                data: buffer.baseAddress, width: width, height: 20,
                                bitsPerComponent: 8, bytesPerRow: width * 4,
                                space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: 20))
                    }
                    let bluePositions = (0..<width).filter { x in
                        let pixel = (10 * width + x) * 4
                        return pixels[pixel] < 10 && pixels[pixel + 2] > 240
                    }
                    let firstBluePixel = try #require(bluePositions.first)
                    let expected = center + (endpoint - center) * progress - 4
                    #expect(abs(CGFloat(firstBluePixel) - expected) <= 1)
                }
            }
        }
    }

    @Test func reversingADragHasAnElasticStopWithoutSwitchingActions() {
        let motion = TransactionSwipeMotion(width: 390, hasLeadingAction: true)
        for edge: TransactionSwipeMotion.Edge in [.leading, .trailing] {
            let sign: CGFloat = edge == .leading ? 1 : -1
            #expect(
                motion.edgeForDrag(origin: 0, translation: sign * 10, velocity: sign * 500) == edge)
            #expect(
                motion.edgeForDrag(
                    origin: sign * 88, translation: -sign * 20, velocity: -sign * 500) == edge)
            #expect(motion.dragOffset(origin: sign * 88, translation: -sign * 88, edge: edge) == 0)
            for travel: CGFloat in [1, 20, 100, 1000] {
                let offset = motion.dragOffset(
                    origin: sign * 88, translation: -sign * (88 + travel), edge: edge)
                #expect(offset * sign < 0)
                #expect(abs(offset) < min(travel, 12))
                #expect(
                    motion.settlement(offset: offset, velocity: -sign * 5000, edge: edge) == .closed
                )
                #expect(motion.armedEdge(offset: offset) == nil)
            }
            // Reversing back toward the original action still works in this gesture.
            #expect(
                motion.dragOffset(origin: sign * 88, translation: sign * 100, edge: edge) == sign
                    * 188)
            #expect(
                motion.settlement(offset: sign * 188, velocity: 0, edge: edge) == .perform(edge))
        }
        // A fresh gesture from closed can choose either side.
        #expect(motion.edgeForDrag(origin: 0, translation: 0, velocity: 100) == .leading)
        #expect(motion.edgeForDrag(origin: 0, translation: 0, velocity: -100) == .trailing)
    }

    @Test func committedDeleteContinuesOffscreenInTheSwipeDirection() throws {
        for width: CGFloat in [284, 390, 700] {
            let motion = TransactionSwipeMotion(width: width, hasLeadingAction: true)
            let releaseOffset = -motion.commitDistance
            #expect(
                motion.settlement(offset: releaseOffset, velocity: 0, edge: .trailing)
                    == .perform(.trailing))
            let destination = motion.dismissOffset(for: .trailing)
            #expect(destination < releaseOffset)
            for direction: CGFloat in [-1, 1] {
                // The whole transaction must leave the viewport, including its
                // resting insets. The deletion callback runs after this frame.
                let renderer = ImageRenderer(
                    content: Color(red: 0, green: 0, blue: 1).frame(height: 40)
                        .modifier(TransactionSwipeTranslation(offset: destination * direction))
                        .clipped()
                        .frame(width: width)
                        .background(Color.white))
                renderer.scale = 1
                let image = try #require(renderer.cgImage)
                let pixelWidth = Int(width)
                var pixels = [UInt8](repeating: 0, count: pixelWidth * 40 * 4)
                try pixels.withUnsafeMutableBytes { buffer in
                    let context = try #require(
                        CGContext(
                            data: buffer.baseAddress, width: pixelWidth, height: 40,
                            bitsPerComponent: 8, bytesPerRow: pixelWidth * 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: 40))
                }
                for x in 0..<pixelWidth {
                    let pixel = (20 * pixelWidth + x) * 4
                    #expect(pixels[pixel] > 240 && pixels[pixel + 1] > 240)
                }
            }
        }
    }

    @Test func velocityNeverCommitsAFullSwipeWithoutSufficientFingerTravel() {
        for width: CGFloat in [284, 354, 700] {
            let motion = TransactionSwipeMotion(width: width, hasLeadingAction: true)
            #expect(motion.settlement(offset: -30, velocity: -5000) == .open(.trailing))
            #expect(motion.settlement(offset: 30, velocity: 5000) == .open(.leading))
            #expect(
                motion.settlement(offset: -motion.commitDistance, velocity: 0)
                    == .perform(.trailing))
            #expect(
                motion.settlement(offset: motion.commitDistance, velocity: 0) == .perform(.leading))
        }
        let unknownWidth = TransactionSwipeMotion(width: 0, hasLeadingAction: true)
        #expect(unknownWidth.settlement(offset: -300, velocity: -5000) == .closed)
    }

    @Test
    func loadingMerchantLogoDoesNotShowTheMissingLogo() throws {
        let url = try #require(URL(string: "https://example.com/loading.png"))
        let renderer = ImageRenderer(
            content: TransactionMerchantLogo(url: url, cache: TransactionMerchantLogoCache()) {
                Color.blue
            }
            .frame(width: 44, height: 44)
        )
        let image = try #require(renderer.uiImage?.cgImage)
        var pixel: [UInt8] = [0, 0, 0, 0]
        try pixel.withUnsafeMutableBytes { buffer in
            let context = try #require(
                CGContext(
                    data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                    bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                )
            )
            context.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        #expect(pixel[2] < 200)
    }

    @Test
    func merchantLogoRequestsAreSharedAndCached() async throws {
        let url = try #require(URL(string: "https://example.com/shared.png"))
        var requests = 0
        var completion: CheckedContinuation<Image?, Never>?
        let cache = TransactionMerchantLogoCache { _ in
            requests += 1
            return await withCheckedContinuation { completion = $0 }
        }
        let first = Task { await cache.load(url) }
        while completion == nil { await Task.yield() }
        let second = Task { await cache.load(url) }
        await Task.yield()
        first.cancel()
        completion?.resume(returning: Image(systemName: "star"))
        let firstImage = await first.value
        let secondImage = await second.value
        #expect(firstImage != nil)
        #expect(secondImage != nil)
        #expect(cache.image(for: url) != nil)
        let cachedImage = await cache.load(url)
        #expect(cachedImage != nil)
        #expect(requests == 1)
    }

    @Test
    func merchantImagesAreDecodedAtThumbnailResolution() async throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let source = UIGraphicsImageRenderer(
            size: CGSize(width: 2048, height: 1024), format: format
        ).pngData { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2048, height: 1024))
        }
        let decoded = try #require(await TransactionMerchantImageDecoder.decode(source))
        #expect(decoded.width == TransactionMerchantImageDecoder.maximumPixelSize)
        #expect(decoded.height == 66)
        #expect(decoded.bytesPerRow * decoded.height < 100_000)
        #expect(await TransactionMerchantImageDecoder.decode(Data("invalid".utf8)) == nil)
    }

    @Test
    func failedMerchantLogoCanBeRetried() async throws {
        let url = try #require(URL(string: "https://example.com/retry.png"))
        var requests = 0
        let cache = TransactionMerchantLogoCache { _ in
            requests += 1
            return requests == 1 ? nil : Image(systemName: "star")
        }
        let failedImage = await cache.load(url)
        #expect(failedImage == nil)
        #expect(cache.image(for: url) == nil)
        let retryImage = await cache.load(url)
        #expect(retryImage != nil)
        #expect(requests == 2)
    }

    @Test
    func cachedMerchantLogoIsPresentOnTheFirstFrameOfARecreatedRow() throws {
        let url = try #require(URL(string: "https://example.com/merchant.png"))
        let cache = TransactionMerchantLogoCache()
        let logo = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 20, height: 20))
        }
        cache.insert(Image(uiImage: logo), for: url)

        for _ in 0..<2 {
            let renderer = ImageRenderer(
                content: TransactionMerchantLogo(url: url, cache: cache) {
                    Color.blue
                }
                .frame(width: 44, height: 44)
            )
            let image = try #require(renderer.uiImage?.cgImage)
            var pixel: [UInt8] = [0, 0, 0, 0]
            try pixel.withUnsafeMutableBytes { buffer in
                let context = try #require(
                    CGContext(
                        data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                        bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    )
                )
                context.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            }
            #expect(pixel[0] > 240)
            #expect(pixel[2] < 20)
            #expect(pixel[3] == 255)
        }
        #expect(cache.image(for: url.appendingPathComponent("another.png")) == nil)
    }

    @Test
    func reselectingTransactionsScrollsTheMountedListToTheTop() async throws {
        let store = TransactionFeedStore(
            previewResponse: response(items: (0..<40).map { item(id: "row-\($0)") }, isDone: true)
        )
        let navigation = HomeNavigationState()
        navigation.select(.transactions)
        let content = {
            HomePageContent(
                selectedPage: navigation.selectedPage,
                mountedPages: navigation.mountedPages,
                transactionFeedStore: store,
                budgetStore: .preview,
                accountsStore: .preview,
                transactionScrollToTopRequest: navigation.transactionScrollToTopRequest
            )
        }
        let controller = UIHostingController(rootView: content())
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            store.stop()
        }

        await waitUntil { collectionView(in: controller.view)?.visibleCells.isEmpty == false }
        let list = try #require(collectionView(in: controller.view))
        for _ in 0..<2 {
            list.setContentOffset(CGPoint(x: 0, y: 900), animated: false)
            await waitUntil { list.contentOffset.y > 800 }
            #expect(list.contentOffset.y > 800)

            navigation.select(.transactions)
            controller.rootView = content()

            await waitUntil { abs(list.contentOffset.y + list.adjustedContentInset.top) < 1 }
            #expect(collectionView(in: controller.view) === list)
            #expect(list.indexPathsForVisibleItems.contains(IndexPath(item: 0, section: 0)))
            #expect(store.sections.first?.entries.count == 40)
        }
    }

    @Test
    func agendaMonthPickerStaysPresentedOnFirstAndSubsequentOpeningsDuringLiveUpdates() async throws
    {
        let initial = response(items: [], isDone: true)
        let workspace = try #require(initial.workspace)
        let feedUpdates = CurrentValueSubject<TransactionFeedResponse, Error>(initial)
        let agendaData = PlannedData(
            today: TransactionEditorDate.today(workspace: workspace),
            availableRange: .init(minYearMonth: 190001, maxYearMonth: 210012),
            allPlannedTransactions: [], plannedByMonth: [:])
        let agendaUpdates = CurrentValueSubject<PlannedData, Error>(agendaData)
        var agendaRequests = 0
        let store = TransactionFeedStore(
            workspace: workspace,
            plannedStoreFactory: { workspace in
                PlannedStore(
                    workspace: workspace,
                    subscription: { _, _ in
                        agendaRequests += 1
                        return agendaUpdates.eraseToAnyPublisher()
                    }, actionHandler: { _, _, _, _ in nil })
            }, subscriptionFactory: { _ in feedUpdates.eraseToAnyPublisher() })
        store.start()
        store.prepareAgenda()
        let plans = try #require(store.agenda)
        await waitUntil { store.hasLoaded && plans.data != nil }
        let controller = UIHostingController(
            rootView: TransactionFeedView(store: store, isActive: true, showsAgenda: true))
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            store.stop()
        }

        for opening in 0..<2 {
            plans.showsMonthPicker = true
            await waitUntil { controller.presentedViewController != nil }
            let picker = try #require(controller.presentedViewController)
            let rowID = "while-picker-open-\(opening)"
            feedUpdates.send(response(items: [item(id: rowID)], isDone: true))
            var updated = agendaData
            updated.skippedHistoryTruncated = opening == 0
            agendaUpdates.send(updated)
            await waitUntil { store.sections.first?.entries.first?.id == rowID }
            try await Task.sleep(for: .milliseconds(450))
            #expect(plans.showsMonthPicker)
            #expect(controller.presentedViewController === picker)
            #expect(!picker.isBeingDismissed)
            plans.showsMonthPicker = false
            await waitUntil { controller.presentedViewController == nil }
        }
        #expect(agendaRequests == 1)
    }

    @Test
    func statusUpdatesPreserveTheVisibleRowAndItsHeight() async throws {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore { _ in subject.eraseToAnyPublisher() }
        store.start()
        let controller = UIHostingController(
            rootView: TransactionFeedView(store: store, isActive: true)
        )
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            store.stop()
        }

        await waitUntil { store.isLoading }
        subject.send(response(items: [item(id: "updated"), item(id: "neighbor")], isDone: true))
        await waitUntil { collectionView(in: controller.view)?.visibleCells.isEmpty == false }
        let list = try #require(collectionView(in: controller.view))
        let indexPath = IndexPath(item: 1, section: 0)
        let cell = try #require(list.cellForItem(at: indexPath))
        let originalHeight = cell.frame.height

        for status in [TransactionFeedStatus.pending, .cleared, .pending] {
            let updated = TransactionFeedItem(
                id: "updated", date: "2026-09-04", type: .regular,
                status: status, amount: -100, merchantName: "updated"
            )
            subject.send(response(items: [updated, item(id: "neighbor")], isDone: true))
            await waitUntil { store.sections.first?.entries.first?.status == status }
            try await Task.sleep(for: .milliseconds(100))
            list.layoutIfNeeded()

            #expect(list.cellForItem(at: indexPath) === cell)
            #expect(abs(cell.frame.height - originalHeight) < 1)
        }
    }

    @Test
    func deletingAndRestoringTheLastRowKeepsTheNativeListMounted() async throws {
        let store = TransactionFeedStore(
            previewResponse: response(items: [item(id: "last")], isDone: true)
        )
        let entry = try #require(store.sections.first?.entries.first)
        let controller = UIHostingController(
            rootView: TransactionFeedView(store: store, isActive: true)
        )
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            store.stop()
        }

        await waitUntil { collectionView(in: controller.view)?.visibleCells.isEmpty == false }
        let list = try #require(collectionView(in: controller.view))
        await store.perform(.delete, on: entry)
        await waitUntil { list.visibleCells.isEmpty }
        #expect(collectionView(in: controller.view) === list)

        await store.undoLastDeletion()
        await waitUntil { !list.visibleCells.isEmpty }
        #expect(collectionView(in: controller.view) === list)
        #expect(list.numberOfItems(inSection: 0) == 2)
    }

    @Test
    func dateLabelsAreScrollingRowsInsteadOfPinnedSectionHeaders() async throws {
        let store = TransactionFeedStore.preview
        let controller = UIHostingController(
            rootView: TransactionFeedView(
                store: store,
                isActive: true
            )
        )
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            store.stop()
        }

        await waitUntil { collectionView(in: controller.view)?.visibleCells.isEmpty == false }
        let list = try #require(collectionView(in: controller.view))
        // The date occupies a regular cell before the day's two transaction cells.
        #expect(list.numberOfItems(inSection: 0) == 3)
        #expect(
            list.visibleSupplementaryViews(ofKind: UICollectionView.elementKindSectionHeader)
                .isEmpty)
    }

    @Test
    func showingTheLoadingViewKeepsTheSubscriptionAlive() async throws {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        var activeSubscriptions = 0
        let store = TransactionFeedStore { _ in
            subject
                .handleEvents(
                    receiveSubscription: { _ in activeSubscriptions += 1 },
                    receiveCancel: { activeSubscriptions -= 1 }
                )
                .eraseToAnyPublisher()
        }
        store.start()
        let controller = UIHostingController(
            rootView: TransactionFeedView(
                store: store,
                isActive: true
            )
        )
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            store.stop()
        }

        await waitUntil { store.isLoading }
        try? await Task.sleep(for: .milliseconds(150))
        #expect(activeSubscriptions == 1)

        subject.send(response(items: [item(id: "loaded")], isDone: true))
        await waitUntil { store.hasLoaded }
        #expect(!store.isLoading)
        #expect(store.sections.first?.entries.first?.id == "loaded")
    }

    @Test
    func aSilentSubscriptionTimesOutAndCanRecover() async {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(firstResponseTimeout: .milliseconds(30)) { _ in
            subject.eraseToAnyPublisher()
        }
        store.start()
        await waitUntil { store.errorMessage != nil }
        #expect(!store.isLoading)
        #expect(!store.hasLoaded)

        subject.send(response(items: [item(id: "reconnected")], isDone: true))
        await waitUntil { store.hasLoaded }
        #expect(store.errorMessage == nil)
        #expect(store.sections.first?.entries.first?.id == "reconnected")
        store.stop()
    }

    @Test
    func completedSubscriptionsWithoutAValueShowRetryInsteadOfLoading() async {
        let store = TransactionFeedStore { _ in
            Empty<TransactionFeedResponse, Error>().eraseToAnyPublisher()
        }
        store.start()
        await waitUntil { store.errorMessage != nil }
        #expect(!store.isLoading)
        #expect(!store.hasLoaded)
    }

    @Test
    func signingOutClearsTheFeedAndIgnoresStaleResponses() async {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore { _ in subject.eraseToAnyPublisher() }
        store.start()
        subject.send(response(items: [item(id: "private")], isDone: true))
        await waitUntil { store.hasLoaded }

        store.reset()
        subject.send(response(items: [item(id: "stale")], isDone: true))
        await Task.yield()

        #expect(store.workspace == nil)
        #expect(store.sections.isEmpty)
        #expect(!store.hasLoaded)
        #expect(!store.isLoading)
    }

    @Test
    func decodesCompactFeedAndConvexInteger() throws {
        let json = """
            {
              "workspace": {
                "id": "workspace_1",
                "name": "Personal",
                "currencyCode": "USD",
                "minorUnit": 2,
                "timezoneIdentifier": "America/New_York"
              },
              "transactions": {
                "page": [
                  {
                    "id": "transaction_1",
                    "transferGroupId": null,
                    "date": "2026-09-04",
                    "type": "regular",
                    "status": "cleared",
                    "reviewStatus": "reviewed",
                    "amount": { "$integer": "iBMAAAAAAAA=" },
                    "merchantName": "Corner Market",
                    "merchantLogoUrl": "https://example.com/logo.png",
                    "merchantVisualIdentityMode": "logo",
                    "merchantIconName": null,
                    "merchantIconColorId": null,
                    "bankAccountName": "Checking",
                    "transferPairAccountName": null,
                    "categoryNames": ["Groceries"],
                    "hasUncategorized": false,
                    "hasMissingPayee": false
                  }
                ],
                "continueCursor": "cursor_1",
                "isDone": false
              }
            }
            """

        let response = try JSONDecoder().decode(
            TransactionFeedResponse.self,
            from: Data(json.utf8)
        )

        #expect(response.workspace?.currencyCode == "USD")
        #expect(response.transactions.page.first?.amount == 5_000)
        #expect(response.transactions.page.first?.merchantName == "Corner Market")
        #expect(response.transactions.continueCursor == "cursor_1")
        #expect(!response.transactions.isDone)
    }

    @Test
    func transferSidesKeepTheirOwnIdentityAmountStatusAndAccount() throws {
        let items = [
            TransactionFeedItem(
                id: "transfer-in",
                transferGroupId: "transfer-in:transfer-out",
                date: "2026-09-04",
                type: .transfer,
                amount: 20_000,
                bankAccountName: "Savings",
                transferPairAccountName: "Checking",
                categoryNames: ["Emergency Fund"]
            ),
            TransactionFeedItem(
                id: "transfer-out",
                transferGroupId: "transfer-in:transfer-out",
                date: "2026-09-04",
                type: .transfer,
                status: .pending,
                reviewStatus: .needsReview,
                amount: -20_000,
                bankAccountName: "Checking",
                transferPairAccountName: "Savings",
                categoryNames: ["Transfer"]
            ),
            TransactionFeedItem(
                id: "ordinary-transaction",
                date: "2026-09-04",
                type: .regular,
                amount: -1_000,
                merchantName: "Coffee"
            ),
        ]

        let entries = TransactionFeedPresentation.entries(from: items)
        let incoming = try #require(entries.first)
        let outgoing = entries[1]

        #expect(entries.count == 3)
        #expect(incoming.id == "transfer-in")
        #expect(incoming.title == "From Checking")
        #expect(incoming.accountSummary == "Savings")
        #expect(incoming.amount == 20_000)
        #expect(incoming.status == .cleared)
        #expect(!incoming.needsAttention)
        #expect(outgoing.title == "To Savings")
        #expect(outgoing.accountSummary == "Checking")
        #expect(outgoing.amount == -20_000)
        #expect(outgoing.status == .pending)
        #expect(outgoing.needsAttention)
        #expect(incoming.transactionIDs == ["transfer-in"])
        #expect(outgoing.transactionIDs == ["transfer-out"])
    }

    @Test
    func sameDayPairsAreAdjacentAndDifferentDaysStaySeparate() {
        let incoming = TransactionFeedItem(
            id: "in", transferGroupId: "pair", date: "2026-09-04", type: .transfer, amount: 100
        )
        let outgoing = TransactionFeedItem(
            id: "out", transferGroupId: "pair", date: "2026-09-04", type: .transfer, amount: -100
        )
        let laterOutgoing = TransactionFeedItem(
            id: "later-out", transferGroupId: "overnight", date: "2026-09-04", type: .transfer,
            amount: -200
        )
        let laterIncoming = TransactionFeedItem(
            id: "later-in", transferGroupId: "overnight", date: "2026-09-03", type: .transfer,
            amount: 200
        )
        let sections = TransactionFeedPresentation.sections(
            from: [incoming, item(id: "coffee"), outgoing, laterOutgoing, laterIncoming, incoming]
        )
        #expect(sections.map(\.id) == ["2026-09-04", "2026-09-03"])
        #expect(sections[0].entries.map(\.id) == ["out", "in", "coffee", "later-out"])
        #expect(sections[1].entries.map(\.id) == ["later-in"])
        #expect(
            sections.flatMap(\.entries).allSatisfy {
                $0.categoryLabels.isEmpty || $0.type != .transfer
            })
    }

    @Test
    func transferPairsJoinAcrossPagesWithoutChangingTheirIdentity() async {
        let head = PassthroughSubject<TransactionFeedResponse, Error>()
        let tail = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore { request in
            (request.cursor == nil ? head : tail).eraseToAnyPublisher()
        }
        store.start()
        let incoming = TransactionFeedItem(
            id: "in", transferGroupId: "pair", date: "2026-09-04", type: .transfer, amount: 100
        )
        let outgoing = TransactionFeedItem(
            id: "out", transferGroupId: "pair", date: "2026-09-04", type: .transfer, amount: -100
        )
        head.send(response(items: [incoming, item(id: "coffee")], isDone: false))
        await waitUntil { store.hasLoaded }
        let original = store.sections[0].entries[0]
        store.loadMoreIfNeeded(after: "coffee")
        tail.send(response(items: [outgoing], isDone: true))
        await waitUntil { store.sections[0].entries.count == 3 }
        #expect(store.sections[0].entries.map(\.id) == ["out", "in", "coffee"])
        #expect(store.sections[0].entries[1] == original)
        store.stop()
    }

    @Test
    func creditAccountsAndTransferLogosUseTheCorrectAccountMetadata() {
        let outgoing = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "out", date: "2026-09-04", type: .transfer, amount: -5000,
                merchantLogoUrl: "https://example.com/merchant.png",
                bankAccountName: "Checking", bankAccountType: "banking_checking",
                bankAccountLogoUrl: "https://example.com/checking.png",
                transferPairAccountName: "Visa", transferPairAccountType: "credit_credit_card",
                transferPairAccountLogoUrl: "https://example.com/visa.png",
                isCreditCardPayment: true
            ))
        let incoming = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "in", date: "2026-09-04", type: .transfer, amount: 5000,
                bankAccountName: "Visa", bankAccountType: "credit_credit_card",
                transferPairAccountName: "Checking", transferPairAccountType: "banking_checking",
                isCreditCardPayment: true
            ))
        #expect(outgoing.displayLogoUrl == "https://example.com/visa.png")
        #expect(outgoing.bankAccountIcon == .bank)
        #expect(outgoing.transferAccountIcon == .accounts)
        #expect(incoming.displayLogoUrl == nil)
        #expect(incoming.bankAccountIcon == .accounts)
        #expect(incoming.transferAccountIcon == .bank)
        #expect(outgoing.categoryLabels.isEmpty)
        #expect(incoming.categoryLabels.isEmpty)
        #expect(
            TransactionFeedRow(entry: outgoing, workspace: nil).accessibilityValue.contains("-"))
        #expect(
            TransactionFeedRow(entry: incoming, workspace: nil).accessibilityValue.contains("+"))
        #expect(
            TransactionFeedRow(entry: outgoing, workspace: nil).accessibilityValue.contains(
                "Credit card payment"))
        let purchase = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "purchase", date: "2026-09-04", type: .regular, amount: -500,
                merchantLogoUrl: "https://example.com/merchant.png",
                bankAccountType: "credit_credit_card"
            ))
        #expect(purchase.bankAccountIcon == .accounts)
        #expect(purchase.displayLogoUrl == "https://example.com/merchant.png")
        #expect(!purchase.isCreditCardPayment)
    }

    @Test(arguments: [TransactionFeedStatus.pending, .cleared, .reconciled])
    func uncategorizedSwipeTakesPriorityOverApprovalAndStatus(status: TransactionFeedStatus) {
        for reviewStatus in [TransactionFeedReviewStatus.needsReview, .reviewed] {
            let entry = TransactionFeedEntry(
                item: TransactionFeedItem(
                    id: "uncategorized", date: "2026-09-04", type: .regular,
                    status: status, reviewStatus: reviewStatus, amount: -100,
                    hasUncategorized: true))
            #expect(entry.swipeAction == .categorize)
            #expect(entry.swipeAction?.title == "Categorize")
            #expect(entry.swipeAction?.mutationName == nil)
        }
    }

    @Test(arguments: [TransactionFeedStatus.pending, .cleared, .reconciled])
    func rightSwipeApprovesTransactionsUnderReviewBeforeChangingStatus(
        status: TransactionFeedStatus
    ) {
        let entry = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "review",
                date: "2026-09-04",
                type: .regular,
                status: status,
                reviewStatus: .needsReview,
                amount: -100
            )
        )

        #expect(entry.swipeAction == .approve)
    }

    @Test
    func rightSwipeTogglesReviewedTransactionsAndLeavesReconciledOnesAlone() {
        for status in [TransactionFeedStatus.pending, .cleared, .reconciled] {
            let entry = TransactionFeedEntry(
                item: TransactionFeedItem(
                    id: status.rawValue,
                    date: "2026-09-04",
                    type: .regular,
                    status: status,
                    amount: -100
                )
            )
            switch status {
            case .pending: #expect(entry.swipeAction == .setStatus(.cleared))
            case .cleared: #expect(entry.swipeAction == .setStatus(.pending))
            case .reconciled: #expect(entry.swipeAction == nil)
            }
        }
    }

    @Test func transactionSwipeTakesPriorityOverListAndSheetPans() {
        let sheet = UIView()
        let list = UIScrollView()
        let row = UIView()
        sheet.addSubview(list)
        list.addSubview(row)
        let sheetPan = UIPanGestureRecognizer()
        sheet.addGestureRecognizer(sheetPan)
        #expect(TransactionSwipeMotion.hasPriority(over: sheetPan, rowView: row))
        #expect(TransactionSwipeMotion.hasPriority(over: list.panGestureRecognizer, rowView: row))
        let back = UIScreenEdgePanGestureRecognizer()
        sheet.addGestureRecognizer(back)
        #expect(!TransactionSwipeMotion.hasPriority(over: back, rowView: row))
        let other = UIView()
        let unrelatedPan = UIPanGestureRecognizer()
        other.addGestureRecognizer(unrelatedPan)
        #expect(!TransactionSwipeMotion.hasPriority(over: unrelatedPan, rowView: row))
        #expect(!TransactionSwipeMotion.hasPriority(over: sheetPan, rowView: nil))
        #expect(!TransactionSwipeMotion.shouldBegin(velocity: CGPoint(x: 10, y: 100)))
        #expect(TransactionSwipeMotion.shouldBegin(velocity: CGPoint(x: 100, y: 10)))
    }

    @Test
    func deletionUndoClosesWithItsPeekWithoutASecondCountdown() async throws {
        let initialResponse = response(items: [item(id: "deleted")], isDone: true)
        let store = TransactionFeedStore(
            undoDisplayDuration: .seconds(1),
            mutationHandler: { _, _, _ in [] },
            subscriptionFactory: { _ in
                Just(initialResponse).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        store.start()
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        await store.perform(.delete, on: entry)
        #expect(store.latestMutationReceipt?.kind == .deleted)
        #expect(store.latestMutationReceipt?.workspace.id == "workspace")
        #expect(store.deletedEntries == [entry])
        let receipt = try #require(store.latestMutationReceipt)
        store.finishBudgetPeek(receiptID: receipt.id)
        #expect(store.deletedEntries.isEmpty)
        store.stop()
    }

    @Test
    func deletionOpensPeekBeforeSuccessAndRejectsDuplicateActions() async throws {
        var continuation: CheckedContinuation<Void, Error>?
        var mutationCount = 0
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(
            mutationHandler: { workspaceID, transactionIDs, action in
                #expect(workspaceID == "workspace")
                #expect(transactionIDs == ["deleted"])
                #expect(action == .delete)
                mutationCount += 1
                try await withCheckedThrowingContinuation { continuation = $0 }

                return []
            },
            subscriptionFactory: { _ in subject.eraseToAnyPublisher() }
        )
        store.start()
        subject.send(response(items: [item(id: "deleted")], isDone: true))
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        let deletion = Task { await store.perform(.delete, on: entry) }
        await waitUntil { continuation != nil }

        #expect(store.sections.isEmpty)
        #expect(store.deletedEntries == [entry])
        let pendingReceipt = try #require(store.latestMutationReceipt)
        #expect(pendingReceipt.kind == .deleted)
        #expect(pendingReceipt.isPending)
        let pendingRevision = store.mutationReceiptRevision
        #expect(store.isPerformingAction)
        await store.perform(.delete, on: entry)
        #expect(mutationCount == 1)

        continuation?.resume()
        await deletion.value
        #expect(store.deletedEntries == [entry])
        #expect(!store.isPerformingAction)
        #expect(store.latestMutationReceipt?.id == pendingReceipt.id)
        #expect(store.latestMutationReceipt?.isPending == false)
        #expect(store.mutationReceiptRevision == pendingRevision + 1)
        #expect(store.sections.isEmpty)
        store.stop()
    }

    @Test(arguments: [0, 1, 2])
    func undoWhileDeletionIsPendingReversesMoneyImmediatelyAndSerializesWrites(failure: Int)
        async throws
    {
        let values: [String: ConvexEncodable?] = [
            "categoryId": "dining", "yearMonth": Double(202609), "name": "Dining out",
            "before": Int64(2_000), "after": Int64(3_000),
        ]
        let change = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
        var reversed = change
        reversed.before = change.after
        reversed.after = change.before
        let source = TransactionFeedItem(
            id: "deleted", date: "2026-09-04", type: .regular, amount: -1_000,
            deletionBudgetChanges: [change])
        var deletion: CheckedContinuation<Void, Error>?
        var restoration: CheckedContinuation<Void, Error>?
        var actions: [TransactionFeedAction] = []
        let initial = response(items: [source], isDone: true)
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(
            mutationHandler: { _, _, action in
                actions.append(action)
                if action == .delete {
                    try await withCheckedThrowingContinuation { deletion = $0 }
                    return [change]
                }
                try await withCheckedThrowingContinuation { restoration = $0 }
                return [reversed]
            },
            subscriptionFactory: { _ in
                subject.eraseToAnyPublisher()
            })
        defer { store.stop() }
        store.start()
        subject.send(initial)
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        let action = Task { await store.perform(.delete, on: entry) }
        await waitUntil { deletion != nil }
        #expect(store.canUndoDeletion)
        #expect(store.latestMutationReceipt?.budgetChanges.first?.before == 2_000)
        #expect(store.latestMutationReceipt?.budgetChanges.first?.after == 3_000)
        await store.undoLastDeletion()
        #expect(store.sections.first?.entries == [entry])
        #expect(!store.canUndoDeletion)
        #expect(actions == [.delete])
        let restoreReceipt = try #require(store.latestMutationReceipt)
        #expect(restoreReceipt.kind == .restored)
        #expect(restoreReceipt.budgetChanges.first?.before == 3_000)
        #expect(restoreReceipt.budgetChanges.first?.after == 2_000)
        await store.undoLastDeletion()
        #expect(actions == [.delete])
        subject.send(initial)
        try await Task.sleep(for: .milliseconds(30))
        if failure == 1 {
            deletion?.resume(throwing: TestFeedError.unavailable)
        } else {
            deletion?.resume()
            await waitUntil { restoration != nil }
            subject.send(response(items: [], isDone: true))
            try await Task.sleep(for: .milliseconds(30))
            #expect(actions == [.delete, .restore])
            #expect(store.latestMutationReceipt?.id == restoreReceipt.id)
            #expect(store.sections.first?.entries == [entry])
            if failure == 2 {
                restoration?.resume(throwing: TestFeedError.unavailable)
            } else {
                restoration?.resume()
            }
        }
        await action.value
        #expect(!store.isPerformingAction)
        if failure == 2 {
            #expect(store.sections.isEmpty)
            #expect(store.canUndoDeletion)
            #expect(store.latestMutationReceipt?.kind == .deleted)
            #expect(store.latestMutationReceipt?.isPending == false)
        } else {
            #expect(store.sections.first?.entries == [entry])
            #expect(store.deletedEntries.isEmpty)
        }
        if failure == 0 {
            #expect(store.latestMutationReceipt?.id == restoreReceipt.id)
            #expect(store.actionErrorMessage == nil)
        } else {
            #expect(store.actionErrorMessage != nil)
        }
    }

    @Test
    func failedDeletionRestoresTheRowWithoutOfferingUndo() async throws {
        let initialResponse = response(items: [item(id: "kept")], isDone: true)
        let store = TransactionFeedStore(
            mutationHandler: { _, _, _ in throw TestFeedError.unavailable },
            subscriptionFactory: { _ in
                Just(initialResponse).setFailureType(to: Error.self).eraseToAnyPublisher()
            }
        )
        store.start()
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)

        await store.perform(.delete, on: entry)

        #expect(store.sections.first?.entries == [entry])
        #expect(store.deletedEntries.isEmpty)
        #expect(store.latestMutationReceipt == nil)
        #expect(store.actionErrorMessage != nil)
        #expect(!store.isPerformingAction)
        store.stop()
    }

    @Test(arguments: ["2026-09-04", "2026-09-03"])
    func undoRestoresBothTransferSidesAndCanRetryAfterFailure(incomingDate: String) async throws {
        let items = [
            TransactionFeedItem(
                id: "out", transferGroupId: "in:out", date: "2026-09-04",
                type: .transfer, amount: -100
            ),
            TransactionFeedItem(
                id: "in", transferGroupId: "in:out", date: incomingDate,
                type: .transfer, amount: 100
            ),
        ]
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        var shouldFailRestore = true
        let store = TransactionFeedStore(
            mutationHandler: { workspaceID, transactionIDs, action in
                #expect(workspaceID == "workspace")
                #expect(transactionIDs == ["out"])
                if action == .restore, shouldFailRestore {
                    throw TestFeedError.unavailable
                }

                return []
            },
            subscriptionFactory: { _ in subject.eraseToAnyPublisher() }
        )
        store.start()
        subject.send(response(items: items, isDone: true))
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)

        await store.perform(.delete, on: entry)
        #expect(store.sections.isEmpty)
        subject.send(response(items: [], isDone: true))
        await Task.yield()
        await store.undoLastDeletion()
        #expect(store.deletedEntries == [entry])
        #expect(store.actionErrorMessage != nil)

        shouldFailRestore = false
        await store.undoLastDeletion()
        subject.send(response(items: items, isDone: true))
        await waitUntil { !store.sections.isEmpty }
        #expect(store.deletedEntries.isEmpty)
        #expect(store.actionErrorMessage == nil)
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["out", "in"])
        store.stop()
    }

    @Test(arguments: [false, true])
    func undoImmediatelyRestoresTransferRowsUntilSubscriptionCatchesUp(subscriptionFirst: Bool)
        async throws
    {
        let items = [
            item(id: "first"),
            TransactionFeedItem(
                id: "out", transferGroupId: "pair", date: "2026-09-04", type: .transfer,
                amount: -100),
            item(id: "last"),
            TransactionFeedItem(
                id: "in", transferGroupId: "pair", date: "2026-09-03", type: .transfer,
                amount: 100),
        ]
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        var restoration: CheckedContinuation<Void, Error>?
        let store = TransactionFeedStore(
            mutationHandler: { _, _, action in
                if action == .restore {
                    try await withCheckedThrowingContinuation { restoration = $0 }
                }
                return []
            }, subscriptionFactory: { _ in subject.eraseToAnyPublisher() })
        defer { store.stop() }
        store.start()
        subject.send(response(items: items, isDone: true))
        await waitUntil { store.hasLoaded }
        let originalSections = store.sections
        let entry = try #require(store.sections.first?.entries.first { $0.id == "out" })
        await store.perform(.delete, on: entry)
        subject.send(response(items: [], isDone: true))
        await waitUntil { store.sections.isEmpty }
        // A subsequent snapshot contains only the surviving rows.
        subject.send(response(items: [items[0], items[2]], isDone: true))
        await waitUntil { store.sections.first?.entries.count == 2 }
        let undo = Task { await store.undoLastDeletion() }
        await waitUntil { restoration != nil }
        #expect(store.sections == originalSections)
        let receipt = try #require(store.latestMutationReceipt)
        #expect(receipt.kind == .restored)
        #expect(receipt.isPending)
        let transition = store.rowTransitionRevision
        if subscriptionFirst {
            subject.send(response(items: items, isDone: true))
            try await Task.sleep(for: .milliseconds(30))
        }
        restoration?.resume()
        await undo.value
        #expect(store.sections == originalSections)
        #expect(store.latestMutationReceipt?.id == receipt.id)
        #expect(store.latestMutationReceipt?.isPending == false)
        subject.send(response(items: items, isDone: true))
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.sections == originalSections)
        #expect(store.rowTransitionRevision == transition)
        // Once confirmed, the overlay must stop shielding rows from external deletes.
        subject.send(response(items: [], isDone: true))
        await waitUntil { store.sections.isEmpty }
    }

    @Test
    func undoSurvivesADeletionSnapshotDeliveredAfterRestoreAcknowledgement() async throws {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(
            mutationHandler: { _, _, _ in [] },
            subscriptionFactory: { _ in subject.eraseToAnyPublisher() })
        defer { store.stop() }
        store.start()
        subject.send(response(items: [item(id: "restored")], isDone: true))
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        await store.perform(.delete, on: entry)
        await store.undoLastDeletion()
        #expect(store.sections.first?.entries == [entry])
        subject.send(response(items: [], isDone: true))
        try await Task.sleep(for: .milliseconds(30))
        #expect(store.sections.first?.entries == [entry])
        subject.send(response(items: [item(id: "restored")], isDone: true))
        try await Task.sleep(for: .milliseconds(30))
        subject.send(response(items: [], isDone: true))
        await waitUntil { store.sections.isEmpty }
    }

    @Test
    func consecutiveDeletionsUndoInReverseOrderAndDismissKeepsRowsDeleted() async throws {
        let store = TransactionFeedStore(
            previewResponse: response(items: [item(id: "first"), item(id: "second")], isDone: true)
        )
        let entries = try #require(store.sections.first?.entries)
        await store.perform(.delete, on: entries[0])
        await store.perform(.delete, on: entries[1])
        #expect(store.deletedEntries.map(\.id) == ["first", "second"])

        await store.undoLastDeletion()
        #expect(store.sections.first?.entries.map(\.id) == ["second"])
        #expect(store.deletedEntries.map(\.id) == ["first"])

        store.dismissUndo()
        #expect(store.deletedEntries.isEmpty)
        #expect(store.sections.first?.entries.map(\.id) == ["second"])
        await store.undoLastDeletion()
        #expect(store.sections.first?.entries.map(\.id) == ["second"])
    }

    @Test
    func undoPeekExpiresAutomaticallyWithoutRestoringDeletedTransactions() async throws {
        let initialResponse = response(items: [item(id: "deleted")], isDone: true)
        var actions: [TransactionFeedAction] = []
        let store = TransactionFeedStore(
            undoDisplayDuration: .milliseconds(40),
            mutationHandler: { _, _, action in
                actions.append(action)
                return []
            },
            subscriptionFactory: { _ in
                Just(initialResponse).setFailureType(to: Error.self).eraseToAnyPublisher()
            }
        )
        store.start()
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        await store.perform(.delete, on: entry)
        #expect(store.deletedEntries == [entry])

        await waitUntil { store.deletedEntries.isEmpty }
        #expect(store.sections.isEmpty)
        await store.undoLastDeletion()
        #expect(actions == [.delete])
        store.stop()
    }

    @Test
    func anotherDeletionRestartsTheUndoWindow() async throws {
        let initialResponse = response(
            items: [item(id: "first"), item(id: "second")], isDone: true)
        let store = TransactionFeedStore(
            undoDisplayDuration: .milliseconds(160),
            mutationHandler: { _, _, _ in
                return []
            },
            subscriptionFactory: { _ in
                Just(initialResponse).setFailureType(to: Error.self).eraseToAnyPublisher()
            }
        )
        store.start()
        await waitUntil { store.hasLoaded }
        let entries = try #require(store.sections.first?.entries)
        await store.perform(.delete, on: entries[0])
        let firstReceipt = try #require(store.latestMutationReceipt)
        try await Task.sleep(for: .milliseconds(100))
        await store.perform(.delete, on: entries[1])
        store.finishBudgetPeek(receiptID: firstReceipt.id)
        try await Task.sleep(for: .milliseconds(100))
        #expect(store.deletedEntries == entries)

        await waitUntil { store.deletedEntries.isEmpty }
        store.stop()
    }

    @Test
    func undoDoesNotExpireDuringARestoreAndGetsAFreshWindowOnFailure() async throws {
        let initialResponse = response(items: [item(id: "retry")], isDone: true)
        var restoration: CheckedContinuation<Void, Error>?
        let store = TransactionFeedStore(
            undoDisplayDuration: .milliseconds(50),
            mutationHandler: { _, _, action in
                if action == .restore {
                    try await withCheckedThrowingContinuation { restoration = $0 }
                }

                return []
            },
            subscriptionFactory: { _ in
                Just(initialResponse).setFailureType(to: Error.self).eraseToAnyPublisher()
            }
        )
        store.start()
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        await store.perform(.delete, on: entry)
        let deletionReceipt = try #require(store.latestMutationReceipt)
        let undo = Task { await store.undoLastDeletion() }
        await waitUntil { restoration != nil }
        #expect(store.sections.first?.entries == [entry])
        #expect(store.latestMutationReceipt?.kind == .restored)
        try await Task.sleep(for: .milliseconds(100))
        #expect(store.deletedEntries == [entry])

        restoration?.resume(throwing: TestFeedError.unavailable)
        await undo.value
        #expect(store.sections.isEmpty)
        #expect(store.latestMutationReceipt?.id == deletionReceipt.id)
        #expect(store.actionErrorMessage != nil)
        #expect(store.deletedEntries == [entry])
        await waitUntil { store.deletedEntries.isEmpty }
        store.stop()
    }

    @Test
    func signingOutDuringDeletionIgnoresItsCompletion() async throws {
        var continuation: CheckedContinuation<Void, Error>?
        let initialResponse = response(items: [item(id: "private")], isDone: true)
        let store = TransactionFeedStore(
            mutationHandler: { _, _, _ in
                try await withCheckedThrowingContinuation { continuation = $0 }

                return []
            },
            subscriptionFactory: { _ in
                Just(initialResponse).setFailureType(to: Error.self).eraseToAnyPublisher()
            }
        )
        store.start()
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        let deletion = Task { await store.perform(.delete, on: entry) }
        await waitUntil { continuation != nil }

        store.reset()
        continuation?.resume()
        await deletion.value

        #expect(store.workspace == nil)
        #expect(store.sections.isEmpty)
        #expect(store.deletedEntries.isEmpty)
        #expect(!store.isPerformingAction)
        #expect(store.actionErrorMessage == nil)
        #expect(store.latestMutationReceipt == nil)
    }

    @Test
    func aTransactionRestoredElsewhereReappearsAfterDeletionIsConfirmed() async throws {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(
            mutationHandler: { _, _, _ in
                return []
            },
            subscriptionFactory: { _ in subject.eraseToAnyPublisher() }
        )
        store.start()
        subject.send(response(items: [item(id: "restored")], isDone: true))
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        await store.perform(.delete, on: entry)

        subject.send(response(items: [], isDone: true))
        // Let the subscription confirm deletion before a later restore arrives.
        try await Task.sleep(for: .milliseconds(30))
        store.dismissUndo()
        subject.send(response(items: [item(id: "restored")], isDone: true))
        await waitUntil { !store.sections.isEmpty }

        #expect(store.sections.first?.entries == [entry])
        #expect(store.deletedEntries.isEmpty)
        store.stop()
    }

    @Test
    func statusAndApprovalUseTheWorkspaceAndRefreshFromTheSubscription() async throws {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        var actions: [TransactionFeedAction] = []
        let store = TransactionFeedStore(
            mutationHandler: { workspaceID, transactionIDs, action in
                #expect(workspaceID == "workspace")
                #expect(transactionIDs == ["updated"])
                actions.append(action)

                return []
            },
            subscriptionFactory: { _ in subject.eraseToAnyPublisher() }
        )
        store.start()
        let pending = TransactionFeedItem(
            id: "updated", date: "2026-09-04", type: .regular,
            status: .pending, reviewStatus: .needsReview, amount: -100
        )
        subject.send(response(items: [pending], isDone: true))
        await waitUntil { store.hasLoaded }
        let reviewEntry = try #require(store.sections.first?.entries.first)
        await store.perform(.approve, on: reviewEntry)

        let approved = TransactionFeedItem(
            id: "updated", date: "2026-09-04", type: .regular,
            status: .pending, amount: -100
        )
        subject.send(response(items: [approved], isDone: true))
        await waitUntil { store.sections.first?.entries.first?.reviewStatus == .reviewed }
        let approvedEntry = try #require(store.sections.first?.entries.first)
        await store.perform(.setStatus(.cleared), on: approvedEntry)
        #expect(actions == [.approve, .setStatus(.cleared)])

        subject.send(response(items: [item(id: "updated")], isDone: true))
        await waitUntil { store.sections.first?.entries.first?.status == .cleared }
        #expect(store.sections.first?.entries.first?.swipeAction == .setStatus(.pending))
        store.stop()
    }

    @Test
    func buildsReadableCategorySummariesAndFallbacks() {
        let split = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "split",
                date: "2026-09-04",
                type: .regular,
                amount: -5_000,
                merchantName: "Market",
                categoryNames: ["Groceries", "Dining", "Groceries", " Travel "]
            )
        )
        let missing = TransactionFeedEntry(
            item: TransactionFeedItem(
                id: "missing",
                date: "2026-09-04",
                type: .regular,
                amount: -500,
                hasUncategorized: true,
                hasMissingPayee: true
            )
        )

        #expect(split.categorySummary == "Groceries, Dining +1")
        #expect(missing.title == "Merchant needed")
        #expect(missing.categorySummary == "Uncategorized")
        #expect(missing.needsAttention)
    }

    @Test
    func groupsTheServerOrderedWindowWithoutResortingIt() {
        let items = [
            TransactionFeedItem(
                id: "newest",
                date: "2026-09-04",
                type: .regular,
                amount: -100
            ),
            TransactionFeedItem(
                id: "second",
                date: "2026-09-04",
                type: .regular,
                amount: -200
            ),
            TransactionFeedItem(
                id: "older",
                date: "2026-09-03",
                type: .regular,
                amount: -300
            ),
        ]

        let sections = TransactionFeedPresentation.sections(from: items)

        #expect(sections.map(\.id) == ["2026-09-04", "2026-09-03"])
        #expect(sections.first?.entries.map(\.id) == ["newest", "second"])
    }

    @Test
    func labelsDatesInTheWorkspaceTimezone() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let referenceDate = try #require(
            calendar.date(from: DateComponents(year: 2026, month: 9, day: 4, hour: 12))
        )

        #expect(
            TransactionDateLabel.title(
                for: "2026-09-04",
                relativeTo: referenceDate,
                timezoneIdentifier: "America/New_York"
            ) == "Today"
        )
        #expect(
            TransactionDateLabel.title(
                for: "2026-09-03",
                relativeTo: referenceDate,
                timezoneIdentifier: "America/New_York"
            ) == "Yesterday"
        )
    }

    @Test(arguments: ["America/New_York", "Pacific/Kiritimati", "Pacific/Honolulu"])
    func yesterdayFromThePreviousYearIncludesItsYear(timezone: String) throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: timezone))
        let reference = try #require(
            calendar.date(from: DateComponents(year: 2026, month: 1, day: 1, hour: 12)))
        let title = TransactionDateLabel.title(
            for: "2025-12-31", relativeTo: reference, timezoneIdentifier: timezone,
            locale: Locale(identifier: "en_US"))

        #expect(title.contains("2025"))
        #expect(title != "Yesterday")
    }

    @Test(arguments: ["en_US", "en_GB", "fr_FR", "ko_KR", "th_TH"])
    func historicalDateLabelsPreserveLocalizedCalendarsAndWorkspaceTimezones(localeID: String)
        throws
    {
        let locale = Locale(identifier: localeID)
        for timezone in ["America/New_York", "Pacific/Kiritimati", "Pacific/Honolulu"] {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = try #require(TimeZone(identifier: timezone))
            let reference = try #require(
                calendar.date(from: DateComponents(year: 2026, month: 9, day: 7)))
            for (year, month, day) in [(2026, 1, 2), (2025, 12, 31), (2027, 1, 2)] {
                let date = try #require(
                    calendar.date(from: DateComponents(year: year, month: month, day: day)))
                let dateKey = String(format: "%04d-%02d-%02d", year, month, day)
                let expected = DateFormatter()
                expected.locale = locale
                expected.timeZone = calendar.timeZone
                expected.setLocalizedDateFormatFromTemplate(
                    year == 2026 ? "EEE MMM d" : "EEE MMM d yyyy")
                #expect(
                    TransactionDateLabel.title(
                        for: dateKey, relativeTo: reference, timezoneIdentifier: timezone,
                        locale: locale) == expected.string(from: date))
            }
        }
    }

    @Test
    func formatsZeroTwoAndThreeDecimalCurrenciesExactly() {
        let locale = Locale(identifier: "en_US")
        let usd = TransactionAmountFormatter.string(
            minorUnits: -1_234,
            currencyCode: "USD",
            minorUnit: 2,
            showsPositiveSign: false,
            usesAbsoluteValue: false,
            locale: locale
        )
        let positiveUSD = TransactionAmountFormatter.string(
            minorUnits: 1_234,
            currencyCode: "USD",
            minorUnit: 2,
            showsPositiveSign: true,
            usesAbsoluteValue: false,
            locale: locale
        )
        let jpy = TransactionAmountFormatter.string(
            minorUnits: 1_234,
            currencyCode: "JPY",
            minorUnit: 0,
            showsPositiveSign: false,
            usesAbsoluteValue: false,
            locale: locale
        )
        let kwd = TransactionAmountFormatter.string(
            minorUnits: 12_345,
            currencyCode: "KWD",
            minorUnit: 3,
            showsPositiveSign: false,
            usesAbsoluteValue: false,
            locale: locale
        )
        let absoluteTransfer = TransactionAmountFormatter.string(
            minorUnits: -1_234,
            currencyCode: "USD",
            minorUnit: 2,
            showsPositiveSign: false,
            usesAbsoluteValue: true,
            locale: locale
        )

        #expect(usd.contains("-"))
        #expect(usd.contains("12.34"))
        #expect(positiveUSD.hasPrefix("+"))
        #expect(jpy.contains("1,234"))
        #expect(!jpy.contains("."))
        #expect(kwd.contains("12.345"))
        #expect(!absoluteTransfer.contains("-"))
    }

    @Test
    func keepsTheHeadReactiveWhileAppendingCursorPages() async {
        let firstSubject = PassthroughSubject<TransactionFeedResponse, TestFeedError>()
        let expandedSubject = PassthroughSubject<TransactionFeedResponse, TestFeedError>()
        var requests: [TransactionFeedSubscriptionRequest] = []
        let store = TransactionFeedStore { request in
            requests.append(request)
            let subject = request.cursor == nil ? firstSubject : expandedSubject
            return
                subject
                .mapError { $0 as Error }
                .eraseToAnyPublisher()
        }

        store.start()
        #expect(requests.map(\.numItems) == [50])

        firstSubject.send(
            response(
                items: [item(id: "first")],
                isDone: false
            )
        )
        await waitUntil { store.hasLoaded }
        let initialTransition = store.rowTransitionRevision

        store.loadMoreIfNeeded(after: "first")
        #expect(requests.map(\.numItems) == [50, 50])
        #expect(requests.last?.cursor == "next")
        #expect(requests.first?.paginationID == requests.last?.paginationID)

        expandedSubject.send(
            response(
                items: [item(id: "older")],
                isDone: true
            )
        )
        await waitUntil { store.sections.first?.entries.count == 2 }

        #expect(store.sections.first?.entries.map(\.id) == ["first", "older"])
        #expect(!store.hasMore)
        #expect(!store.isLoadingMore)
        #expect(store.rowTransitionRevision == initialTransition)

        firstSubject.send(
            response(
                items: [item(id: "new"), item(id: "first")],
                isDone: false
            )
        )
        await waitUntil { store.sections.first?.entries.count == 3 }

        #expect(store.sections.first?.entries.map(\.id) == ["new", "first", "older"])
        #expect(store.rowTransitionRevision == initialTransition + 1)
        store.stop()
    }

    @Test
    func unchangedSubscriptionRowsDoNotInvalidateTheLedger() async {
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore { _ in subject.eraseToAnyPublisher() }
        store.start()
        defer { store.stop() }
        subject.send(response(items: [item(id: "same")], isDone: false))
        await waitUntil { store.hasLoaded }
        let updates = Mutex(0)
        withObservationTracking {
            _ = store.sections
            _ = store.workspace
            _ = store.rowTransitionRevision
        } onChange: {
            updates.withLock { $0 += 1 }
        }

        // Pagination metadata can change without changing a single rendered row.
        subject.send(response(items: [item(id: "same")], isDone: true))
        await waitUntil { !store.hasMore }
        #expect(updates.withLock { $0 } == 0)

        let changed = TransactionFeedItem(
            id: "same", date: "2026-09-04", type: .regular, amount: -9999)
        subject.send(response(items: [changed], isDone: true))
        await waitUntil { store.sections.first?.entries.first?.amount == -9999 }
        #expect(updates.withLock { $0 } == 1)
        #expect(store.rowTransitionRevision == 0, "Amount edits must not animate list membership")
    }

    @Test
    func metadataOnlyRefreshKeepsTheLatestDeletionPreview() async throws {
        let values: [String: ConvexEncodable?] = [
            "categoryId": "dining", "yearMonth": Double(202609), "name": "Dining out",
            "before": Int64(2_000), "after": Int64(3_000),
        ]
        let change = try JSONDecoder().decode(
            TransactionBudgetChange.self, from: Data(values.convexEncode().utf8))
        var continuation: CheckedContinuation<Void, Never>?
        let subject = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(
            mutationHandler: { _, _, _ in
                await withCheckedContinuation { continuation = $0 }
                return [change]
            },
            subscriptionFactory: { _ in subject.eraseToAnyPublisher() })
        store.start()
        defer { store.stop() }
        let original = TransactionFeedItem(
            id: "dining", date: "2026-09-04", type: .regular, amount: -1_000)
        subject.send(response(items: [original], isDone: false))
        await waitUntil { store.hasLoaded }
        let entry = try #require(store.sections.first?.entries.first)
        let updates = Mutex(0)
        withObservationTracking {
            _ = store.sections
        } onChange: {
            updates.withLock { $0 += 1 }
        }

        let refreshed = TransactionFeedItem(
            id: "dining", date: "2026-09-04", type: .regular, amount: -1_000,
            deletionBudgetChanges: [change])
        subject.send(response(items: [refreshed], isDone: true))
        await waitUntil { !store.hasMore }
        #expect(updates.withLock { $0 } == 0)

        let deletion = Task { await store.perform(.delete, on: entry) }
        await waitUntil { continuation != nil }
        #expect(store.latestMutationReceipt?.isPending == true)
        #expect(store.latestMutationReceipt?.budgetChanges.first?.before == 2_000)
        #expect(store.latestMutationReceipt?.budgetChanges.first?.after == 3_000)
        continuation?.resume()
        await deletion.value
    }

    @Test
    func deleteAndUndoStillRequestRowTransitions() async throws {
        let store = TransactionFeedStore(
            previewResponse: response(items: [item(id: "deleted")], isDone: true))
        let entry = try #require(store.sections.first?.entries.first)
        let initialTransition = store.rowTransitionRevision
        await store.perform(.delete, on: entry)
        #expect(store.sections.isEmpty)
        #expect(store.rowTransitionRevision == initialTransition + 1)
        await store.undoLastDeletion()
        #expect(store.sections.first?.entries == [entry])
        #expect(store.rowTransitionRevision == initialTransition + 2)
    }

    @Test
    func accountFeedKeepsItsExplicitWorkspaceAndAccountAcrossPaginationAndRestart() async {
        let workspace = TransactionFeedWorkspace(
            id: "account-workspace", name: "Household", currencyCode: "CAD", minorUnit: 2,
            timezoneIdentifier: "America/Toronto")
        let head = PassthroughSubject<TransactionFeedResponse, Error>()
        let tail = PassthroughSubject<TransactionFeedResponse, Error>()
        var requests: [TransactionFeedSubscriptionRequest] = []
        let store = TransactionFeedStore(bankAccountID: "checking", workspace: workspace) {
            request in
            requests.append(request)
            return (request.cursor == nil ? head : tail).eraseToAnyPublisher()
        }
        defer { store.stop() }

        #expect(store.workspace == workspace)
        #expect(requests.isEmpty)
        #expect(!store.hasLoaded)
        store.start()
        #expect(requests.count == 1)
        #expect(requests.first?.workspaceID == workspace.id)
        #expect(requests.first?.bankAccountID == "checking")
        #expect(requests.first?.cursor == nil)

        head.send(
            TransactionFeedResponse(
                workspace: workspace,
                transactions: response(items: [item(id: "first")], isDone: false).transactions))
        await waitUntil { store.hasLoaded }
        store.loadMoreIfNeeded(after: "first")
        #expect(requests.count == 2)
        #expect(requests.last?.workspaceID == workspace.id)
        #expect(requests.last?.bankAccountID == "checking")
        #expect(requests.last?.cursor == "next")
        #expect(requests.first?.paginationID == requests.last?.paginationID)

        tail.send(
            TransactionFeedResponse(
                workspace: workspace,
                transactions: response(items: [item(id: "older")], isDone: true).transactions))
        await waitUntil { store.sections.first?.entries.count == 2 }
        let initialRequests = requests
        store.stop()
        #expect(store.workspace == workspace)
        #expect(store.sections.first?.entries.map(\.id) == ["first", "older"])
        store.start()
        #expect(requests.count == 4)
        #expect(Array(requests.suffix(2)) == initialRequests)
        #expect(
            requests.allSatisfy {
                $0.bankAccountID == "checking" && $0.workspaceID == workspace.id
            })

        head.send(
            TransactionFeedResponse(
                workspace: workspace,
                transactions: response(
                    items: [item(id: "new"), item(id: "first")], isDone: false
                ).transactions))
        await waitUntil { store.sections.first?.entries.count == 3 }
        #expect(store.sections.first?.entries.map(\.id) == ["new", "first", "older"])
        #expect(store.workspace == workspace)
    }

    @Test
    func retainsLoadedRowsWhenAnExpandedWindowFails() async {
        let firstSubject = PassthroughSubject<TransactionFeedResponse, TestFeedError>()
        let expandedSubject = PassthroughSubject<TransactionFeedResponse, TestFeedError>()
        let store = TransactionFeedStore { request in
            let subject = request.cursor == nil ? firstSubject : expandedSubject
            return
                subject
                .mapError { $0 as Error }
                .eraseToAnyPublisher()
        }

        store.start()
        firstSubject.send(response(items: [item(id: "kept")], isDone: false))
        await waitUntil { store.hasLoaded }

        store.loadMoreIfNeeded(after: "kept")
        expandedSubject.send(completion: .failure(.unavailable))
        await waitUntil { store.errorMessage != nil }

        #expect(store.sections.first?.entries.map(\.id) == ["kept"])
        #expect(!store.isLoadingMore)
    }

    @Test
    func budgetLaunchPreparesCreationAndReceiptContextWithoutSubscribingToTransactions() throws {
        var subscriptions = 0
        let store = TransactionFeedStore { _ in
            subscriptions += 1
            return Empty<TransactionFeedResponse, Error>().eraseToAnyPublisher()
        }
        let budgetWorkspace = BudgetWorkspace(
            id: "budget-workspace", name: "Household", currencyCode: "CAD", minorUnit: 2,
            timezoneIdentifier: "America/Toronto")
        store.prepareForBudgetWorkspace(budgetWorkspace)
        let workspace = try #require(store.workspace)
        #expect(workspace.id == budgetWorkspace.id)
        #expect(workspace.currencyCode == "CAD")
        #expect(workspace.timezoneIdentifier == "America/Toronto")
        #expect(!store.hasLoaded)
        #expect(store.sections.isEmpty)
        #expect(subscriptions == 0)

        let receipt = TransactionMutationReceipt(
            workspace: workspace, dateKey: "2026-09-05", budgetChanges: [])
        store.publishReceipt(receipt)
        #expect(store.latestMutationReceipt?.id == receipt.id)
        store.prepareForBudgetWorkspace(budgetWorkspace)
        #expect(store.latestMutationReceipt?.id == receipt.id)
        #expect(subscriptions == 0)
        store.reset()
    }

    @Test
    func changingBudgetWorkspaceClearsOldTransactionsAndReceipts() {
        let snapshot = response(items: [item(id: "old")], isDone: true)
        let store = TransactionFeedStore(previewResponse: snapshot)
        let receipt = TransactionMutationReceipt(
            workspace: snapshot.workspace!, dateKey: "2026-09-05", budgetChanges: [])
        store.publishReceipt(receipt)
        store.prepareForBudgetWorkspace(
            BudgetWorkspace(
                id: "other", name: "Other", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "UTC"))
        #expect(store.workspace?.id == "other")
        #expect(store.sections.isEmpty)
        #expect(!store.hasLoaded)
        #expect(store.latestMutationReceipt == nil)
        store.publishReceipt(receipt)
        #expect(store.latestMutationReceipt == nil)
        store.prepareForBudgetWorkspace(nil)
        #expect(store.workspace == nil)
        #expect(!store.canCreateTransaction)
    }

    private func item(id: String) -> TransactionFeedItem {
        TransactionFeedItem(
            id: id,
            date: "2026-09-04",
            type: .regular,
            amount: -100,
            merchantName: id
        )
    }

    private func response(
        items: [TransactionFeedItem],
        isDone: Bool
    ) -> TransactionFeedResponse {
        TransactionFeedResponse(
            workspace: TransactionFeedWorkspace(
                id: "workspace",
                name: "Personal",
                currencyCode: "USD",
                minorUnit: 2,
                timezoneIdentifier: "America/New_York"
            ),
            transactions: TransactionFeedPage(
                page: items,
                continueCursor: isDone ? "" : "next",
                isDone: isDone
            )
        )
    }

    private func waitUntil(
        _ condition: @escaping @MainActor () -> Bool
    ) async {
        for _ in 0..<100 {
            if condition() {
                return
            }
            try? await Task.sleep(for: .milliseconds(10))
        }

        #expect(condition())
    }

    private func collectionView(in view: UIView) -> UICollectionView? {
        if let list = view as? UICollectionView { return list }
        for child in view.subviews {
            if let list = collectionView(in: child) { return list }
        }
        return nil
    }
}

private enum TestFeedError: Error {
    case unavailable
}

@Suite(.serialized)
@MainActor
struct TransactionSelectionTests {
    @Test func selectionUndoRestoresTransferCounterpartsAndOnlyTheOriginalSelection() async {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        var actions: [TransactionFeedAction] = []
        let store = TransactionFeedStore(
            mutationHandler: { _, ids, action in
                #expect(Set(ids) == ["from", "other"])
                actions.append(action)
                return []
            },
            subscriptionFactory: { _ in source.eraseToAnyPublisher() })
        store.start()
        source.send(
            response([
                item("from", transfer: "pair"), item("to", transfer: "pair"), item("other"),
            ]))
        await waitUntil { store.hasLoaded }
        for row in store.sections.flatMap(\.entries) where row.id != "to" {
            store.beginSelection(row)
        }
        await store.performSelection(.delete)
        #expect(store.hasSelectionDeletionUndo)
        #expect(store.selectionSummary.count == 0)
        source.send(response([]))
        // Deliver the deletion snapshot before requesting restoration.
        await Task.yield()
        await store.undoSelectionDeletion()
        #expect(actions == [.delete, .restore])
        #expect(Set(store.sections.flatMap(\.entries).map(\.id)) == ["from", "to", "other"])
        #expect(store.selectedIDs == ["from", "other"])
        #expect(store.isSelecting)
        #expect(!store.hasSelectionDeletionUndo)
        #expect(!store.isSavingSelection)
        #expect(store.selectionConfirmationMessage == L10n.string("Transactions restored"))
        store.stop()
    }

    @Test func failedSelectionUndoCanRetryAndExpiryPreventsFurtherRestores() async {
        let initial = response([item("one")])
        var fails = true
        var restoreCalls = 0
        let store = TransactionFeedStore(
            mutationHandler: { _, _, action in
                if action == .restore {
                    restoreCalls += 1
                    if fails { throw SelectionError.failed }
                }
                return []
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        await store.performSelection(.delete)
        await store.undoSelectionDeletion()
        #expect(store.hasSelectionDeletionUndo)
        #expect(store.actionErrorMessage != nil)
        #expect(!store.isRestoringSelection)
        #expect(store.sections.isEmpty)
        store.dismissSelectionConfirmation(revision: store.selectionSaveRevision)
        #expect(store.hasSelectionDeletionUndo)
        fails = false
        store.actionErrorMessage = nil
        await store.undoSelectionDeletion()
        #expect(store.selectedIDs == ["one"])
        #expect(restoreCalls == 2)
        await store.performSelection(.delete)
        store.dismissSelectionConfirmation(revision: store.selectionSaveRevision)
        #expect(!store.hasSelectionDeletionUndo)
        await store.undoSelectionDeletion()
        #expect(restoreCalls == 2)
        #expect(store.sections.isEmpty)
        store.stop()
    }

    @Test func confirmationDoesNotBlockAnotherEditAndOldTimersCannotClearANewerSave() async {
        let initial = response([item("one")])
        var fails = false
        let store = TransactionFeedStore(
            selectionEditHandler: { _, _, _ in
                if fails { throw SelectionError.failed }
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        await store.editSelection(.init(field: .notes, value: "First"))
        let firstRevision = store.selectionSaveRevision
        #expect(store.selectionConfirmationMessage != nil)
        #expect(!store.isSavingSelection)
        #expect(!store.isPerformingAction)
        store.presentSelectionEditor()
        #expect(store.showsSelectionEditor)
        await store.editSelection(.init(field: .notes, value: "Second"))
        store.dismissSelectionConfirmation(revision: firstRevision)
        #expect(store.selectionConfirmationMessage != nil)
        store.dismissSelectionConfirmation(revision: store.selectionSaveRevision)
        #expect(store.selectionConfirmationMessage == nil)
        #expect(store.selectionSummary.count == 1)
        fails = true
        await store.editSelection(.init(field: .notes, value: "Failed"))
        #expect(store.selectionConfirmationMessage == nil)
        #expect(store.actionErrorMessage != nil)
        #expect(!store.isPerformingAction)
        store.stop()
    }

    @Test func exitingDuringSaveDoesNotReopenSelectionOrShowALateConfirmation() async {
        let initial = response([item("one")])
        var resume: CheckedContinuation<Void, Never>?
        let store = TransactionFeedStore(
            selectionEditHandler: { _, _, _ in await withCheckedContinuation { resume = $0 } },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        let save = Task { await store.editSelection(.init(field: .notes, value: "Saved")) }
        await waitUntil { resume != nil }
        #expect(store.isSavingSelection)
        #expect(store.selectionConfirmationMessage == nil)
        store.endSelection()
        resume?.resume()
        await save.value
        #expect(!store.isSelecting)
        #expect(!store.isSavingSelection)
        #expect(store.selectionConfirmationMessage == nil)
        #expect(store.selectedIDs.isEmpty)
        store.stop()
    }

    @Test func editSheetRequiresSelectionAndClosingItPreservesTheSelectedRows() throws {
        let store = TransactionFeedStore(previewResponse: response([item("one")]))
        store.presentSelectionEditor()
        #expect(!store.showsSelectionEditor)
        let row = try #require(store.sections.first?.entries.first)
        store.beginSelection(row)
        store.presentSelectionEditor()
        #expect(store.showsSelectionEditor)
        store.showsSelectionEditor = false
        #expect(store.isSelecting)
        #expect(store.selectedIDs == ["one"])
        store.toggleSelection(row)
        store.presentSelectionEditor()
        #expect(!store.showsSelectionEditor)
        store.toggleSelection(row)
        store.presentSelectionEditor()
        store.endSelection()
        #expect(!store.showsSelectionEditor)
    }

    @Test func selectionCountsRowsAndUsesAnOverflowSafeSignedTotal() {
        let summary = TransactionSelectionSummary(entries: [
            entry("outflow", amount: -150), entry("inflow", amount: 300),
            entry("large", amount: Int64.max), entry("large-again", amount: Int64.max),
        ])
        #expect(summary.count == 4)
        #expect(summary.total == Decimal(Int64.max) * 2 + 150)
        #expect(TransactionSelectionSummary(entries: []).total == 0)
    }

    @Test func approvalOptionRequiresAtLeastOneSelectedUnapprovedTransaction() {
        let reviewed = item("reviewed")
        let unapproved = item("unapproved", reviewStatus: .needsReview)
        let missingPayee = TransactionFeedItem(
            id: "missing-payee", date: "2026-09-08", type: .regular,
            reviewStatus: .reviewed, amount: -100, hasMissingPayee: true)
        #expect(TransactionSelectionSummary(entries: []).approvalAction == nil)
        #expect(
            TransactionSelectionSummary(entries: [.init(item: reviewed), .init(item: missingPayee)])
                .approvalAction == nil)
        #expect(
            TransactionSelectionSummary(entries: [.init(item: unapproved)]).approvalAction
                == .approve)
        #expect(
            TransactionSelectionSummary(entries: [.init(item: reviewed), .init(item: unapproved)])
                .approvalAction == .approve)
    }

    @Test func bulkApprovalOnlyApprovesUnapprovedSelectionAndFollowsTheLiveReviewState() async {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        var calls = 0
        let store = TransactionFeedStore(
            mutationHandler: { workspace, ids, action in
                #expect(workspace == "workspace")
                #expect(Set(ids) == ["unapproved"])
                #expect(action == .approve)
                calls += 1
                return []
            }, subscriptionFactory: { _ in source.eraseToAnyPublisher() })
        store.start()
        source.send(response([item("reviewed"), item("unapproved", reviewStatus: .needsReview)]))
        await waitUntil { store.hasLoaded }
        for row in store.sections.flatMap(\.entries) { store.beginSelection(row) }
        store.presentSelectionEditor()
        #expect(store.selectionSummary.approvalAction == .approve)
        await store.performSelection(.approve)
        #expect(calls == 1)
        #expect(!store.showsSelectionEditor && !store.isSavingSelection)
        #expect(store.isSelecting && store.selectedIDs == ["reviewed", "unapproved"])
        #expect(store.selectionConfirmationMessage == L10n.string("Edits saved"))
        source.send(response([item("reviewed"), item("unapproved")]))
        await waitUntil { store.selectionSummary.approvalAction == nil }
        await store.performSelection(.approve)
        #expect(calls == 1)
        store.stop()
    }

    @Test func failedBulkApprovalPreservesSelectionForRetry() async {
        let initial = response([item("unapproved", reviewStatus: .needsReview)])
        var calls = 0
        let store = TransactionFeedStore(
            mutationHandler: { _, _, action in
                #expect(action == .approve)
                calls += 1
                if calls == 1 { throw SelectionError.failed }
                return []
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        await store.performSelection(.approve)
        #expect(store.actionErrorMessage != nil)
        #expect(!store.isSavingSelection && !store.isPerformingAction)
        #expect(store.selectedIDs == ["unapproved"])
        #expect(store.selectionSummary.approvalAction == .approve)
        await store.performSelection(.approve)
        #expect(calls == 2 && store.actionErrorMessage == nil)
        store.stop()
    }

    @Test func mixedStatusesClearWhileClearedRowsBecomePendingAndReconciledRowsStayLocked() {
        #expect(summary([.pending, .cleared]).statusAction == .setStatus(.cleared))
        #expect(summary([.cleared, .cleared]).statusAction == .setStatus(.pending))
        #expect(summary([.pending, .reconciled]).statusAction == .setStatus(.cleared))
        #expect(summary([.cleared, .reconciled]).statusAction == .setStatus(.pending))
        #expect(summary([.reconciled]).statusAction == nil)
        #expect(summary([]).statusAction == nil)
    }

    @Test func merchantAndAccountActionsRespectTransferSelection() {
        let outflow = entry("from", amount: -100, transfer: "pair")
        let inflow = entry("to", amount: 100, transfer: "pair")
        let pair = TransactionSelectionSummary(entries: [outflow, inflow])
        #expect(pair.count == 2)
        #expect(pair.total == 0)
        #expect(!pair.canEditAccount)
        #expect(!pair.canEditMerchant)
        #expect(TransactionSelectionSummary(entries: [outflow]).canEditAccount)
        #expect(TransactionSelectionSummary(entries: [entry("regular")]).canEditMerchant)
    }

    @Test func deselectingTheLastRowKeepsSelectionModeUntilExplicitExit() throws {
        let store = TransactionFeedStore(previewResponse: response([item("one")]))
        let row = try #require(store.sections.first?.entries.first)
        store.beginSelection(row)
        store.beginSelection(row)
        #expect(store.selectedIDs == ["one"])
        store.toggleSelection(row)
        #expect(store.isSelecting)
        #expect(store.selectionSummary.count == 0)
        store.endSelection()
        #expect(!store.isSelecting)
        store.toggleSelection(row)
        #expect(store.selectedIDs.isEmpty)
    }

    @Test func statusActionsSaveTheWholeSelectionOnceAndAllowAnotherAction() async {
        let initial = response([item("pending", status: .pending), item("cleared")])
        var actions: [TransactionFeedAction] = []
        let store = TransactionFeedStore(
            mutationHandler: { workspace, ids, action in
                #expect(workspace == "workspace")
                #expect(Set(ids) == ["pending", "cleared"])
                actions.append(action)
                return []
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        store.presentSelectionEditor()
        #expect(store.showsSelectionEditor)
        await store.performSelection(.setStatus(.cleared))
        #expect(!store.showsSelectionEditor)
        #expect(store.isSelecting)
        #expect(store.selectionSummary.count == 2)
        #expect(store.selectionSummary.statusAction == .setStatus(.pending))
        store.presentSelectionEditor()
        #expect(store.showsSelectionEditor)
        await store.performSelection(.setStatus(.pending))
        #expect(!store.showsSelectionEditor)
        #expect(actions == [.setStatus(.cleared), .setStatus(.pending)])
        #expect(store.selectionSummary.statusAction == .setStatus(.cleared))
        #expect(!store.isSavingSelection)
        #expect(store.latestMutationReceipt == nil)
        store.stop()
    }

    @Test func nextLiveSnapshotSupersedesAConfirmedStatusEvenIfServerUpdatesWereCoalesced() async {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(
            mutationHandler: { _, _, _ in [] },
            subscriptionFactory: { _ in source.eraseToAnyPublisher() })
        store.start()
        let initial = response([item("one", status: .pending)])
        source.send(initial)
        await waitUntil { store.hasLoaded }
        for row in store.sections.flatMap(\.entries) { store.beginSelection(row) }
        await store.performSelection(.setStatus(.cleared))
        #expect(store.selectionSummary.statusAction == .setStatus(.pending))
        // A second device changed it back before the next snapshot was delivered.
        source.send(initial)
        await waitUntil { store.selectionSummary.statusAction == .setStatus(.cleared) }
        #expect(store.selectedIDs == ["one"])
        store.stop()
    }

    @Test func failedEditsAndDeletesKeepRowsSelectedForRetry() async {
        let initial = response([item("one"), item("two")])
        var fails = true
        let store = TransactionFeedStore(
            mutationHandler: { _, _, _ in throw SelectionError.failed },
            selectionEditHandler: { _, ids, edit in
                #expect(Set(ids) == ["one", "two"])
                #expect(edit == .init(field: .category, value: "groceries"))
                if fails { throw SelectionError.failed }
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        await store.editSelection(.init(field: .category, value: "groceries"))
        #expect(store.actionErrorMessage != nil)
        #expect(store.selectionSummary.count == 2)
        #expect(!store.isSavingSelection)
        fails = false
        await store.editSelection(.init(field: .category, value: "groceries"))
        #expect(store.actionErrorMessage == nil)
        #expect(store.isSelecting)
        #expect(store.selectionSummary.count == 2)
        await store.performSelection(.delete)
        #expect(store.actionErrorMessage != nil)
        #expect(store.sections.flatMap(\.entries).count == 2)
        #expect(store.selectionSummary.count == 2)
        store.stop()
    }

    @Test func savingLocksSelectionAndPreventsOverlappingActions() async throws {
        let initial = response([item("one"), item("two")])
        var resume: CheckedContinuation<Void, Never>?
        var saves = 0
        let store = TransactionFeedStore(
            selectionEditHandler: { _, _, _ in
                saves += 1
                await withCheckedContinuation { resume = $0 }
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        let save = Task { await store.editSelection(.init(field: .account, value: "checking")) }
        await waitUntil { resume != nil }
        #expect(store.isSavingSelection)
        #expect(store.isPerformingAction)
        store.presentSelectionEditor()
        #expect(!store.showsSelectionEditor)
        store.toggleSelection(try #require(store.sections.first?.entries.first))
        await store.editSelection(.init(field: .notes, value: "duplicate"))
        #expect(saves == 1)
        #expect(store.selectionSummary.count == 2)
        resume?.resume()
        await save.value
        #expect(!store.isSavingSelection)
        #expect(store.selectionSummary.count == 2)
        store.stop()
    }

    @Test func resettingWorkspaceIgnoresAnOldSaveCompletion() async {
        let initial = response([item("one")])
        var resume: CheckedContinuation<Void, Never>?
        let store = TransactionFeedStore(
            selectionEditHandler: { _, _, _ in await withCheckedContinuation { resume = $0 } },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        let save = Task { await store.editSelection(.init(field: .merchant, value: "merchant")) }
        await waitUntil { resume != nil }
        store.reset()
        resume?.resume()
        await save.value
        #expect(!store.isSelecting)
        #expect(!store.isSavingSelection)
        #expect(store.selectedIDs.isEmpty)
        #expect(store.sections.isEmpty)
        #expect(store.selectionSaveRevision == 0)
    }

    @Test func deletingSelectionRemovesTransferCounterpartsAndLeavesModeOpen() async {
        let initial = response([
            item("from", transfer: "pair"), item("to", transfer: "pair"), item("other"),
        ])
        var deleted: [String] = []
        let store = TransactionFeedStore(
            mutationHandler: { _, ids, action in
                #expect(action == .delete)
                deleted = ids
                return []
            },
            subscriptionFactory: { _ in
                Just(initial).setFailureType(to: Error.self).eraseToAnyPublisher()
            })
        await selectAll(store)
        for row in store.sections.flatMap(\.entries) where row.id != "from" {
            store.toggleSelection(row)
        }
        await store.performSelection(.delete)
        #expect(deleted == ["from"])
        #expect(store.sections.flatMap(\.entries).map(\.id) == ["other"])
        #expect(store.selectedIDs.isEmpty)
        #expect(store.isSelecting)
        store.stop()
    }

    @Test func liveRemovalPrunesSelectionAndLiveAmountsUpdateTheTotal() async {
        let source = PassthroughSubject<TransactionFeedResponse, Error>()
        let store = TransactionFeedStore(subscriptionFactory: { _ in source.eraseToAnyPublisher() })
        store.start()
        source.send(response([item("one"), item("two")]))
        await waitUntil { store.hasLoaded }
        for row in store.sections.flatMap(\.entries) { store.beginSelection(row) }
        source.send(response([item("two", amount: 700)]))
        await waitUntil { store.selectionSummary.total == 700 }
        #expect(store.selectedIDs == ["two"])
        #expect(store.isSelecting)
        store.stop()
    }

    @Test func editArgumentsOnlyChangeTheChosenFieldAndEncodeClearingExplicitly() throws {
        func arguments(_ field: TransactionSelectionField, _ value: String) throws -> [String:
            String]
        {
            try TransactionSelectionEdit(field: field, value: value)
                .arguments(workspaceID: "workspace", transactionIDs: ["one", "two"])
                .compactMapValues { try $0?.convexEncode() }
        }
        let category = try arguments(.category, "groceries")
        #expect(category["categoryId"] == "\"groceries\"")
        #expect(category["readyToAssign"] == "false")
        #expect(category["merchantId"] == nil)
        let uncategorized = try arguments(.category, "none")
        #expect(uncategorized["categoryId"] == nil)
        #expect(uncategorized["readyToAssign"] == "false")
        #expect(try arguments(.category, "rta")["readyToAssign"] == "true")
        #expect(try arguments(.notes, "")["notes"] == "null")
        #expect(try arguments(.account, "checking")["bankAccountId"] == "\"checking\"")
        #expect(try arguments(.merchant, "shop")["merchantId"] == "\"shop\"")
    }

    private func summary(_ statuses: [TransactionFeedStatus]) -> TransactionSelectionSummary {
        .init(entries: statuses.enumerated().map { entry(String($0.offset), status: $0.element) })
    }

    private func entry(
        _ id: String, status: TransactionFeedStatus = .cleared,
        amount: Int64 = -100, transfer: String? = nil
    ) -> TransactionFeedEntry {
        .init(item: item(id, status: status, amount: amount, transfer: transfer))
    }

    private func item(
        _ id: String, status: TransactionFeedStatus = .cleared,
        reviewStatus: TransactionFeedReviewStatus = .reviewed,
        amount: Int64 = -100, transfer: String? = nil
    ) -> TransactionFeedItem {
        .init(
            id: id, transferGroupId: transfer, date: "2026-09-08",
            type: transfer == nil ? .regular : .transfer, status: status,
            reviewStatus: reviewStatus, amount: amount)
    }

    private func response(_ items: [TransactionFeedItem]) -> TransactionFeedResponse {
        .init(
            workspace: .init(
                id: "workspace", name: "Personal", currencyCode: "USD",
                minorUnit: 2, timezoneIdentifier: "America/New_York"),
            transactions: .init(page: items, continueCursor: "", isDone: true))
    }

    private func selectAll(_ store: TransactionFeedStore) async {
        store.start()
        await waitUntil { store.hasLoaded }
        for row in store.sections.flatMap(\.entries) { store.beginSelection(row) }
    }

    private func waitUntil(_ condition: () -> Bool) async {
        for _ in 0..<100 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }

    private enum SelectionError: Error { case failed }
}
