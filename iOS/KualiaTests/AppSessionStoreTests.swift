import ClerkKit
import Combine
import Foundation
import SwiftUI
import Synchronization
import Testing
import UIKit

@testable import Kualia

@Suite(.serialized)
@MainActor
struct AppSessionStoreTests {
    @Test
    func catalogMetadataStartsDependentQueriesBeforeAnyPageResponds() async throws {
        let workspace = AppWorkspace(
            _id: "personal", name: "Personal", currencyCode: "USD", minorUnit: 2,
            timezoneIdentifier: "UTC")
        let data = WorkspaceDataFixture(workspace: workspace)
        defer { data.session.reset() }
        data.session.prepare()
        await waitUntil { data.reportRequests == 1 }
        #expect(data.queryCounts == [1, 1, 1, 1, 1, 1, 1, 1])
        #expect(!data.session.budget.hasLoaded)
        #expect(!data.session.transactions.hasLoaded)
        #expect(data.session.transactions.agenda?.workspace.timezoneIdentifier == "UTC")
        #expect(data.session.readiness(for: .home) == .loading)

        // Budget amounts arriving first must not reveal a falsely empty budget.
        let month = data.session.budget.currentMonth
        data.snapshot.send(
            .init(
                months: [], availableRange: .init(minYearMonth: month, maxYearMonth: month),
                readyToAssign: 150))
        await waitUntil { !data.session.budget.isRefreshing }
        #expect(!data.session.budget.hasLoaded)
        #expect(!data.session.budget.canEdit)
        data.structure.send(data.budgetStructure())
        await waitUntil { data.session.budget.hasLoaded }
        #expect(data.session.budget.readyToAssign == 150)
        #expect(data.queryCounts == [1, 1, 1, 1, 1, 1, 1, 1])
    }

    @Test
    func catalogMetadataUsesServerPrecisionAndSupportsOlderResponses() throws {
        let metadata = try JSONDecoder().decode(
            AppWorkspace.self,
            from: Data(
                #"{"_id":"kuwait","name":"Kuwait","isArchived":false,"currencyCode":"KWD","minorUnit":3,"timezoneIdentifier":"Asia/Kuwait"}"#
                    .utf8))
        #expect(metadata.budgetWorkspace?.minorUnit == 3)
        #expect(metadata.budgetWorkspace?.timezoneIdentifier == "Asia/Kuwait")
        let legacy = try JSONDecoder().decode(
            AppWorkspace.self,
            from: Data(#"{"_id":"legacy","name":"Legacy","isArchived":false}"#.utf8))
        #expect(legacy.budgetWorkspace == nil)
    }

    @Test
    func allMainPageQueriesWarmBeforeMountAndSurviveNavigation() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.launch()
        let data = try #require(fixture.data.last)
        await waitUntil {
            data.session.reports.hasLoaded && data.session.transactions.agenda != nil
                && HomePage.navigationPages.allSatisfy { data.session.readiness(for: $0) == .ready }
        }
        let agenda = try #require(data.session.transactions.agenda)
        #expect(fixture.store.navigation.mountedPages == [.budget])
        // Launch is ready even though transaction choices have not emitted yet.
        #expect(data.editorChoicesRequests == 1)
        #expect(data.editorChoices.states.value.isLoading)
        #expect(data.queryCounts == [1, 1, 1, 1, 1, 1, 1, 1])
        #expect(data.session.reports.context?.id == data.workspace.id)
        agenda.selectMonth(202612)

        for _ in 0..<5 {
            for page in HomePage.navigationPages {
                fixture.store.requestPage(page)
                #expect(!fixture.store.isTransitioning)
            }
            data.session.prepare()
        }
        #expect(data.queryCounts == [1, 1, 1, 1, 1, 1, 1, 1])
        #expect(data.cancellations.withLock { $0 } == 0)
        #expect(data.session.transactions.agenda === agenda)
        #expect(agenda.selectedMonth == 202612)

        fixture.store.requestPage(.home)
        data.agendaData.send(
            PlannedData(
                today: agenda.today,
                availableRange: .init(minYearMonth: 190001, maxYearMonth: 210012),
                allPlannedTransactions: [], plannedByMonth: [:], skippedHistoryTruncated: true))
        await waitUntil { agenda.data?.skippedHistoryTruncated == true }
        fixture.store.reset()
        #expect(data.cancellations.withLock { $0 } == 7)
        #expect(data.session.transactions.agenda == nil)
        #expect(data.session.reports.context == nil)
        #expect(data.editorChoicesCancellations == 1)
        #expect(data.editorChoices.states.value.choices == nil)
    }

    @Test
    func reportRefreshIsOwnedByTheSessionForEditsAndStaleNavigation() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.launch()
        let data = try #require(fixture.data.last)
        await waitUntil { data.session.reports.hasLoaded }
        let workspace = try #require(data.session.transactions.workspace)
        data.session.transactions.publishReceipt(
            .init(
                workspace: workspace, dateKey: "2026-09-08", budgetChanges: []))
        await waitUntil { data.reportRequests == 2 && !data.session.reports.isLoading }
        #expect(fixture.store.navigation.mountedPages == [.budget])
        data.reportNow = data.reportNow.addingTimeInterval(120)
        fixture.store.requestPage(.reports)
        await waitUntil { data.reportRequests == 3 && !data.session.reports.isLoading }
        fixture.store.requestPage(.home)
        fixture.store.requestPage(.reports)
        #expect(data.reportRequests == 3)
        #expect(data.cancellations.withLock { $0 } == 0)
    }

    @Test
    func workspaceMetadataPreparesReportsAndCalendarWithoutTheirPagesOrFeedResponse() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.start()
        let data = try #require(fixture.data.last)
        data.publishBudget()
        await waitUntil { data.session.reports.hasLoaded && data.agendaRequests == 1 }
        #expect(!data.session.transactions.hasLoaded)
        #expect(data.session.transactions.agenda?.workspace.id == data.workspace.id)
        #expect(data.session.reports.context?.id == data.workspace.id)
        #expect(fixture.store.navigation.mountedPages == [.budget])
    }

    @Test
    func replacingWorkspaceStopsEveryQueryAndQueuedMetadataCannotRestartIt() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.launch()
        let data = try #require(fixture.data.last)
        await waitUntil { data.session.reports.hasLoaded && data.agendaRequests == 1 }
        let counts = data.queryCounts
        // Queue a metadata response immediately before ending this session.
        data.publishBudget()
        fixture.store.requestWorkspace(fixture.shared)
        fixture.store.finishFade(id: fixture.store.transitionID)
        #expect(data.cancellations.withLock { $0 } == 7)
        let next = try #require(fixture.data.last)
        #expect(next !== data)
        #expect(next.agendaRequests == 0)
        data.publishTransactions()
        next.publishBudget()
        next.publishTransactions()
        await waitUntil { next.session.reports.hasLoaded && next.agendaRequests == 1 }
        #expect(data.queryCounts == counts)
        #expect(next.session.transactions.agenda?.workspace.id == fixture.shared.id)
        #expect(next.session.reports.context?.id == fixture.shared.id)
    }

    @Test
    func backgroundAndForegroundKeepCalendarIdentityAndDoNotResubscribe() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.launch()
        let data = try #require(fixture.data.last)
        await waitUntil { data.session.transactions.agenda != nil }
        let agenda = try #require(data.session.transactions.agenda)
        agenda.selectMonth(202612)
        fixture.store.setApplicationActive(false)
        fixture.store.refreshDates()
        fixture.store.setApplicationActive(true)
        fixture.store.setApplicationActive(true)
        #expect(data.agendaRequests == 1)
        #expect(data.agendaCancellations.withLock { $0 } == 0)
        #expect(data.session.transactions.agenda === agenda)
        #expect(agenda.selectedMonth == 202612)
    }

    @Test
    func preparedBudgetNavigationIsImmediateAndKeepsItsSubscriptions() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.launch()
        let data = try #require(fixture.data.last)
        await waitUntil { data.session.budget.hasLoaded }
        let budget = data.session.budget
        let structureRequests = data.budgetStructureRequests
        let snapshotRequests = data.budgetSnapshotRequests
        #expect(structureRequests == 1)
        #expect(snapshotRequests == 1)

        for _ in 0..<5 {
            fixture.store.requestPage(.budget)
            // No loading/fade completion or fresh response is needed for entry.
            #expect(fixture.store.navigation.selectedPage == .budget)
            #expect(!fixture.store.isTransitioning)
            #expect(fixture.store.current?.budget === budget)
            fixture.store.requestPage(.home)
        }
        #expect(fixture.data.count == 1)
        #expect(fixture.store.navigation.mountedPages == [.home, .budget])
        #expect(data.budgetStructureRequests == structureRequests)
        #expect(data.budgetSnapshotRequests == snapshotRequests)
    }

    @Test
    func firstLaunchWaitsOnlyForBudgetBeforeRevealing() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.start()
        let data = try #require(fixture.data.last)
        #expect(fixture.store.navigation.selectedPage == .budget)
        #expect(fixture.store.preparation == .loading)
        fixture.store.revealIfReady()
        #expect(fixture.store.current == nil)
        data.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current === data.session)
        #expect(data.session.home.snapshot == nil)
        #expect(!data.session.transactions.hasLoaded)
        #expect(fixture.store.navigation.mountedPages == [.budget])
    }

    @Test
    func failedHomeChecksSettleIntoRetryNotices() async throws {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        fixture.store.start(userID: "user")
        fixture.store.navigation.restore(.home)
        await fixture.start()
        let data = try #require(fixture.data.last)
        data.homeData.send(completion: .failure(NSError(domain: "test", code: 1)))
        data.connections.send(completion: .failure(NSError(domain: "test", code: 2)))
        await waitUntil { data.session.home.errorMessage != nil }
        #expect(fixture.store.preparation == .loading)
        data.structure.send(completion: .failure(NSError(domain: "test", code: 3)))
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current === data.session)
        #expect(!data.session.home.isLoading(budget: data.session.budget))
    }

    @Test(arguments: [
        "removed-page", "assistant", "home", "transactions", "accounts", "reports", "planned",
    ])
    func savedPageIsIgnoredOnLaunch(savedPage: String) async {
        let fixture = SessionFixture()
        fixture.defaults?.set(savedPage, forKey: "home.lastPage.user")
        await fixture.start()
        #expect(fixture.store.navigation.selectedPage == .budget)
        #expect(fixture.store.preparation == .loading)
        await fixture.prepareHome()
        #expect(fixture.store.preparation == .ready)
        fixture.store.reset()
    }

    @Test
    func backgroundingPreservesSelectionButANewSessionOpensBudget() async {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        await fixture.launch()
        for page in [HomePage.transactions, .home, .accounts, .reports] {
            await fixture.prepareHome()
            fixture.store.requestPage(page)
            #expect(fixture.store.navigation.selectedPage == page)
            #expect(fixture.defaults?.string(forKey: "home.lastPage.user") == nil)
            fixture.store.setApplicationActive(false)
            fixture.store.setApplicationActive(true)
            fixture.store.start(userID: "user")
            #expect(fixture.store.navigation.selectedPage == page)
            fixture.store.reset()
            await fixture.launch()
            #expect(fixture.store.navigation.selectedPage == .budget)
            #expect(fixture.store.navigation.mountedPages == [.budget])
        }
    }

    @Test
    func accountsWaitForTheirOwnDataAndResetWithTheWorkspaceSession() async throws {
        let data = WorkspaceDataFixture(
            workspace: AppWorkspace(_id: "accounts-workspace", name: "Accounts"))
        data.accountData.send(nil)
        data.session.prepare()
        await waitUntil { data.session.accounts.workspace != nil }
        #expect(data.session.readiness(for: .accounts) == .loading)
        data.accountData.send([])
        await waitUntil { data.session.readiness(for: .accounts) == .ready }
        #expect(data.session.accounts.workspace?.id == "accounts-workspace")
        data.session.accounts.prepare(
            workspace: TransactionFeedWorkspace(
                id: "different", name: "Different", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "UTC"))
        #expect(data.session.accounts.workspace?.id == "accounts-workspace")
        data.session.reset()
        #expect(data.session.accounts.workspace == nil)
        #expect(!data.session.accounts.hasLoaded)
    }

    @Test
    func cachedClerkSessionWaitsForItsOwnAuthentication() {
        #expect(
            AppEntryRoute.resolve(
                clerkIsLoaded: false, sessionID: nil,
                authenticatedSessionID: nil, isAuthenticated: false) == .signIn)
        #expect(
            AppEntryRoute.resolve(
                clerkIsLoaded: false, sessionID: "restored",
                authenticatedSessionID: nil, isAuthenticated: false) == .loading)
        #expect(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: "restored",
                authenticatedSessionID: nil, isAuthenticated: false) == .loading)
        #expect(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: "new",
                authenticatedSessionID: "old", isAuthenticated: true) == .loading)
        #expect(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: nil,
                authenticatedSessionID: nil, isAuthenticated: false) == .signIn)
        #expect(
            AppEntryRoute.resolve(
                clerkIsLoaded: true, sessionID: "restored",
                authenticatedSessionID: "restored", isAuthenticated: true) == .ready)
    }

    @Test
    func launchWaitsForBudgetAmountsAndAllowsAnEmptyBudget() async throws {
        let fixture = SessionFixture()
        await fixture.start()
        let data = try #require(fixture.data.last)
        #expect(fixture.store.current == nil)
        data.publishTransactions()
        data.structure.send(data.budgetStructure())
        await waitUntil { data.session.budget.workspace != nil }
        fixture.store.revealIfReady()
        #expect(fixture.store.current == nil)
        #expect(fixture.store.preparation == .loading)

        data.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == "personal")
        #expect(fixture.store.current?.budget.groups.isEmpty == true)
        #expect(!fixture.store.isTransitioning)
        #expect(fixture.savedSelections.isEmpty)
        fixture.store.reset()
    }

    @Test
    func everyUserStartsOnBudgetAndWaitsOnlyForBudget() async throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        defaults.set("transactions", forKey: "home.lastPage.user")
        let fixture = SessionFixture(defaults: defaults)
        await fixture.start()
        let data = try #require(fixture.data.last)
        #expect(fixture.store.navigation.selectedPage == .budget)
        data.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current != nil)
        #expect(!data.session.transactions.hasLoaded)
        fixture.store.start(userID: "different-user")
        #expect(fixture.store.navigation.selectedPage == .budget)
        #expect(fixture.store.current == nil)
        fixture.store.reset()
    }

    @Test
    func switchingFadesFirstAndWaitsForTheCurrentPageInTheNewWorkspace() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        let old = try #require(fixture.store.current)
        fixture.store.requestPage(.transactions)
        fixture.store.requestPage(.transactions)
        fixture.store.requestWorkspace(fixture.shared)
        #expect(fixture.store.isFadingOut)
        #expect(fixture.data.count == 1)
        #expect(fixture.store.current === old)

        fixture.store.finishFade(id: fixture.store.transitionID)
        fixture.store.finishFade(id: fixture.store.transitionID)
        #expect(fixture.data.count == 2)
        let next = try #require(fixture.data.last)
        next.publishBudget()
        await waitUntil { next.session.budget.hasLoaded }
        fixture.store.revealIfReady()
        #expect(fixture.store.current === old)
        #expect(fixture.store.preparation == .loading)

        next.publishTransactions()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == "shared")
        #expect(fixture.store.navigation.selectedPage == .transactions)
        #expect(fixture.store.navigation.transactionScrollToTopRequest == 0)
        #expect(fixture.store.navigation.mountedPages == [.transactions])
        await waitUntil { fixture.savedSelections == ["shared"] }
        fixture.store.reset()
    }

    @Test
    func readyWorkspaceInstallsWhileHiddenAndRevealsOnlyAfterItsOwnLayout() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        let original = try #require(fixture.store.current)
        var presentation = HomeContentPresentation()
        presentation.didLayout(sessionID: original.id, currentSessionID: original.id)
        #expect(presentation.isVisible(sessionID: original.id, isTransitioning: false))

        fixture.store.requestWorkspace(fixture.shared)
        #expect(
            !presentation.isVisible(
                sessionID: fixture.store.current?.id, isTransitioning: fixture.store.isTransitioning
            ))
        fixture.store.finishFade(id: fixture.store.transitionID)
        let next = try #require(fixture.data.last)
        next.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()

        #expect(fixture.store.current === next.session)
        #expect(!fixture.store.isTransitioning)
        #expect(
            !presentation.isVisible(
                sessionID: fixture.store.current?.id, isTransitioning: fixture.store.isTransitioning
            ))
        presentation.didLayout(sessionID: original.id, currentSessionID: fixture.store.current?.id)
        #expect(!presentation.isVisible(sessionID: next.session.id, isTransitioning: false))
        presentation.didLayout(
            sessionID: next.session.id, currentSessionID: fixture.store.current?.id)
        #expect(presentation.isVisible(sessionID: next.session.id, isTransitioning: false))
        #expect(fixture.store.navigation.selectedPage == .budget)
        fixture.store.reset()
    }

    @Test
    func failedSwitchCanReturnWithoutLosingTheOriginalPageOrPersistingTheFailure() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        let old = try #require(fixture.store.current)
        let selectedPage = fixture.store.navigation.selectedPage
        let mountedPages = fixture.store.navigation.mountedPages
        fixture.store.requestWorkspace(fixture.shared)
        let attempt = fixture.store.transitionID
        fixture.store.finishFade(id: attempt)
        let next = try #require(fixture.data.last)
        next.structure.send(completion: .failure(SessionTestError.failed))
        await waitUntil {
            if case .failed = fixture.store.preparation { return true }
            return false
        }
        fixture.store.revealIfReady()
        #expect(fixture.store.current === old)
        fixture.store.cancelTransition()
        fixture.store.finishFade(id: attempt)
        #expect(fixture.store.current === old)
        #expect(fixture.store.pending == nil)
        #expect(fixture.store.navigation.selectedPage == selectedPage)
        #expect(fixture.store.navigation.mountedPages == mountedPages)
        #expect(fixture.savedSelections.isEmpty)
        fixture.store.reset()
    }

    @Test
    func aLateCanceledCandidateCannotReplaceANewerSwitch() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.store.requestWorkspace(fixture.shared)
        let firstID = fixture.store.transitionID
        fixture.store.finishFade(id: firstID)
        let canceled = try #require(fixture.data.last)
        fixture.store.cancelTransition()
        fixture.store.requestWorkspace(fixture.shared)
        fixture.store.finishFade(id: firstID)
        #expect(fixture.store.pending == nil)
        fixture.store.finishFade(id: fixture.store.transitionID)
        let latest = try #require(fixture.data.last)
        canceled.publishBudget()
        await drain()
        #expect(fixture.store.preparation == .loading)
        latest.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current === latest.session)
        fixture.store.reset()
    }

    @Test
    func firstVisitToAnUnpreparedPageUsesTheSameReadinessBoundary() async throws {
        let fixture = SessionFixture()
        await fixture.start()
        let data = try #require(fixture.data.last)
        data.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        fixture.store.requestPage(.transactions)
        #expect(fixture.store.navigation.selectedPage == .budget)
        fixture.store.finishFade(id: fixture.store.transitionID)
        #expect(fixture.store.preparation == .loading)
        data.publishTransactions()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.navigation.selectedPage == .transactions)
        #expect(fixture.store.navigation.mountedPages == [.budget, .transactions])
        fixture.store.requestPage(.budget)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    @Test
    func scopedStoresRejectAnotherWorkspaceAndMetadataDoesNotRestartTheFeed() async throws {
        let data = WorkspaceDataFixture(workspace: .init(_id: "expected", name: "Expected"))
        data.session.prepare()
        #expect(data.feedRequests.first?.workspaceID == "expected")
        data.session.transactions.prepareForBudgetWorkspace(data.budgetStructure().workspace)
        #expect(data.feedRequests.count == 1)
        data.structure.send(data.budgetStructure(id: "wrong"))
        data.feed.send(data.feedResponse(id: "wrong"))
        await waitUntil {
            data.session.budget.errorMessage != nil && data.session.transactions.errorMessage != nil
        }
        #expect(!data.session.budget.hasLoaded)
        #expect(!data.session.transactions.hasLoaded)
        data.publishBudget()
        data.publishTransactions()
        await waitUntil { data.session.readiness(for: .budget) == .ready }
        await waitUntil { data.session.readiness(for: .transactions) == .ready }
        data.session.reset()
    }

    @Test
    func missingFirstResponsesTimeOutAndCanBeRetried() async throws {
        let fixture = SessionFixture(timeout: .milliseconds(30))
        await fixture.start()
        let data = try #require(fixture.data.last)
        await waitUntil {
            if case .failed = fixture.store.preparation { return true }
            return false
        }
        fixture.store.retry()
        data.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current != nil)
        fixture.store.reset()
    }

    @Test
    func catalogErrorsSurviveAnIndependentSuccessfulProfileResponse() async {
        let fixture = SessionFixture()
        fixture.store.start(userID: "user")
        fixture.catalog.send(completion: .failure(SessionTestError.failed))
        fixture.profile.send(AppWorkspaceProfile(activeWorkspaceId: "personal"))
        await waitUntil { fixture.store.catalogError != nil }
        await drain()
        if case .failed = fixture.store.preparation {
        } else {
            Issue.record("Expected catalog failure")
        }
        fixture.store.reset()
    }

    @Test
    func archivedWorkspacesAreExcludedAndRevokedAccessClearsVisibleData() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.catalog.send([
            fixture.personal, fixture.shared, .init(_id: "archive", name: "Old", isArchived: true),
        ])
        await drain()
        #expect(fixture.store.workspaces.map(\.id) == ["personal", "shared"])
        fixture.catalog.send([])
        await waitUntil { fixture.store.current == nil }
        #expect(fixture.store.hasNoWorkspaces)
        fixture.store.reset()
    }

    @Test
    func deletingActiveHomeWorkspaceSelectsNextNeighborOrPreviousAtEnd() async throws {
        for removedIndex in 0..<3 {
            let fixture = SessionFixture()
            await fixture.launch()
            let third = AppWorkspace(_id: "third", name: "Third")
            let workspaces = [fixture.personal, fixture.shared, third]
            fixture.catalog.send(workspaces)
            await waitUntil { fixture.store.workspaces.count == 3 }
            fixture.store.requestWorkspaceWhenAvailable(id: workspaces[removedIndex].id)
            await fixture.prepareHome()
            fixture.store.revealIfReady()
            let previous = try #require(fixture.store.current)
            let previousPreparation = fixture.store.preparationState
            fixture.catalog.send(workspaces.filter { $0.id != previous.workspace.id })
            await waitUntil { fixture.store.pending != nil }
            let expected =
                removedIndex == 0 ? fixture.shared : (removedIndex == 1 ? third : fixture.shared)
            #expect(fixture.store.current == nil)
            #expect(fixture.store.pending?.workspace.id == expected.id)
            await fixture.prepareHome()
            #expect(fixture.store.preparation == .ready)
            // The root must receive a new admission event even when Home was
            // ready both before and after the catalog removed the active space.
            #expect(previousPreparation.readiness == fixture.store.preparation)
            #expect(previousPreparation != fixture.store.preparationState)
            fixture.store.revealIfReady()
            #expect(fixture.store.current?.workspace.id == expected.id)
            #expect(!fixture.store.isTransitioning)
            #expect(previous.budget.workspace == nil)
            await waitUntil { fixture.savedSelections.last == expected.id }
            fixture.store.reset()
        }
    }

    @Test
    func deletingActiveWorkspaceShowsPeekForMinimumTimeAfterSettingsCloses() async throws {
        let fixture = SessionFixture(minimumSwitchDuration: .milliseconds(40))
        await fixture.launch()
        let old = try #require(fixture.store.current)
        fixture.store.setWorkspaceSwitchPeekCovered(true)
        fixture.catalog.send([fixture.shared])
        await waitUntil { fixture.store.pending != nil }
        let replacement = try #require(fixture.store.pending)
        #expect(fixture.store.current == nil)
        #expect(fixture.store.displayedSession === replacement)
        #expect(old.budget.workspace == nil)
        #expect(fixture.store.targetWorkspace?.name == fixture.shared.name)
        #expect(fixture.store.isTransitioning)
        var content = HomeContentPresentation()
        content.didLayout(sessionID: old.id, currentSessionID: old.id)
        #expect(!content.isVisible(sessionID: nil, isTransitioning: fixture.store.isTransitioning))

        // Time spent dismissing Settings must not consume the visible peek time.
        try await Task.sleep(for: .milliseconds(80))
        await fixture.prepareHome()
        fixture.store.revealIfReady()
        #expect(fixture.store.preparation == .loading)
        #expect(fixture.store.current == nil)
        fixture.store.setWorkspaceSwitchPeekCovered(false)
        fixture.store.revealIfReady()
        #expect(fixture.store.preparation == .loading)
        #expect(fixture.store.current == nil)
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current === replacement)
        #expect(fixture.store.displayedSession === replacement)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
        #expect(fixture.store.displayedSession == nil)
    }

    @Test
    func deletingActiveBudgetWorkspaceWaitsForFallbackData() async {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.catalog.send([fixture.shared])
        await waitUntil { fixture.store.pending != nil }
        #expect(fixture.store.pending?.workspace.id == fixture.shared.id)
        #expect(fixture.store.displayedSession === fixture.store.pending)
        #expect(fixture.store.preparation == .loading)
        fixture.store.revealIfReady()
        #expect(fixture.store.current == nil)
        fixture.data.last?.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.shared.id)
        #expect(fixture.store.navigation.selectedPage == .budget)
        fixture.store.reset()
    }

    @Test
    func removingOutgoingWorkspaceDuringFadeStillPreparesDestination() async {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.store.requestWorkspace(fixture.shared)
        #expect(fixture.store.isFadingOut)
        fixture.catalog.send([fixture.shared])
        await waitUntil { fixture.store.pending != nil }
        #expect(!fixture.store.isFadingOut)
        #expect(fixture.store.pending?.workspace.id == fixture.shared.id)
        await fixture.prepareHome()
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.shared.id)
        fixture.store.reset()
    }

    @Test
    func anotherLoginForTheSameUserResetsAllWorkspaceData() async {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.store.start(userID: "user", sessionID: "new-session")
        #expect(fixture.store.current == nil)
        #expect(fixture.store.pending == nil)
        fixture.store.reset()
        await drain()
        #expect(fixture.store.current == nil)
        #expect(fixture.store.pending == nil)
    }

    @Test
    func reconnectingTheSameSessionRetainsItsPagesAndData() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        let current = try #require(fixture.store.current)
        fixture.store.requestPage(.transactions)
        fixture.store.requestPage(.transactions)
        fixture.store.start(userID: "user")
        #expect(fixture.store.current === current)
        #expect(fixture.store.navigation.selectedPage == .transactions)
        #expect(fixture.store.navigation.transactionScrollToTopRequest == 1)
        fixture.store.reset()
    }

    @Test
    func missingOrArchivedDefaultFallsBackToAnAccessibleWorkspace() async {
        let fixture = SessionFixture()
        fixture.store.start(userID: "user")
        fixture.catalog.send([.init(_id: "archive", name: "Old", isArchived: true), fixture.shared])
        fixture.profile.send(AppWorkspaceProfile(activeWorkspaceId: "archive"))
        await waitUntil { fixture.store.pending != nil }
        #expect(fixture.store.targetWorkspace?.id == "shared")
        fixture.store.reset()
    }

    @Test
    func selectionPersistenceFailureDoesNotHideAnAlreadyPreparedPage() async throws {
        let fixture = SessionFixture()
        fixture.selectionHandler = { _ in throw SessionTestError.failed }
        await fixture.launch()
        fixture.store.requestWorkspace(fixture.shared)
        fixture.store.finishFade(id: fixture.store.transitionID)
        let data = try #require(fixture.data.last)
        data.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        await waitUntil { fixture.store.selectionSaveError != nil }
        #expect(fixture.store.current?.workspace.id == "shared")
        #expect(!fixture.store.isTransitioning)
        fixture.selectionHandler = { _ in }
        fixture.store.retrySavingSelection()
        await waitUntil { fixture.savedSelections.count == 2 }
        #expect(fixture.store.selectionSaveError == nil)
        fixture.store.reset()
    }

    @Test
    func returningToTheOriginalWorkspaceWhileSavingPersistsTheLastSelection() async throws {
        let fixture = SessionFixture()
        var release: CheckedContinuation<Void, Never>?
        fixture.selectionHandler = { id in
            if id == "shared" { await withCheckedContinuation { release = $0 } }
        }
        await fixture.launch()
        fixture.store.requestWorkspace(fixture.shared)
        fixture.store.finishFade(id: fixture.store.transitionID)
        let shared = try #require(fixture.data.last)
        shared.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        await waitUntil { release != nil }
        fixture.store.requestWorkspace(fixture.personal)
        fixture.store.finishFade(id: fixture.store.transitionID)
        let personal = try #require(fixture.data.last)
        personal.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        release?.resume()
        await waitUntil { fixture.savedSelections == ["shared", "personal"] }
        fixture.store.reset()
    }

    @Test
    func newlyCreatedWorkspaceIsSelectedAfterCatalogArrives() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        let created = AppWorkspace(_id: "created", name: "New budget")
        fixture.store.requestWorkspaceWhenAvailable(id: created.id)
        #expect(!fixture.store.isTransitioning)
        fixture.catalog.send([fixture.personal, fixture.shared, created])
        await waitUntil { fixture.store.pending?.workspace.id == created.id }
        await fixture.prepareHome()
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == created.id)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    @Test
    func settingsSwitchToExistingWorkspaceCompletesWithoutHomeMenuAnimation() async {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.store.requestWorkspaceWhenAvailable(id: fixture.shared.id)
        await fixture.prepareHome()
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.shared.id)
        #expect(!fixture.store.isTransitioning)
        await waitUntil { fixture.savedSelections == [fixture.shared.id] }
        fixture.store.reset()
    }

    @Test
    func settingsNavigationDismissalUncoversPeekBeforeRequestingTheSelectedWorkspace() async {
        let fixture = SessionFixture(minimumSwitchDuration: .milliseconds(40))
        await fixture.launch()
        fixture.store.setWorkspaceSwitchPeekCovered(true)
        // Leaving Settings uncovers Home before beginning the workspace transition.
        fixture.store.setWorkspaceSwitchPeekCovered(false)
        fixture.store.requestWorkspaceWhenAvailable(id: fixture.shared.id)
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        #expect(fixture.store.preparation == .loading)
        await fixture.prepareHome()
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.shared.id)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    @Test
    func homeWorkspaceSwitchKeepsPeekUntilMinimumDurationElapses() async {
        let fixture = SessionFixture(minimumSwitchDuration: .milliseconds(40))
        await fixture.launch()
        fixture.store.requestWorkspaceWhenAvailable(id: fixture.shared.id)
        await fixture.prepareHome()
        #expect(fixture.store.pending?.readiness(for: .home) == .ready)
        #expect(fixture.store.preparation == .loading)
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        #expect(fixture.store.isTransitioning)
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.shared.id)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    @Test
    func minimumSwitchDurationDoesNotRevealBeforeDataIsReady() async throws {
        let fixture = SessionFixture(minimumSwitchDuration: .milliseconds(20))
        await fixture.launch()
        fixture.store.requestWorkspace(fixture.shared)
        fixture.store.finishFade(id: fixture.store.transitionID)
        try await Task.sleep(for: .milliseconds(50))
        fixture.store.revealIfReady()
        #expect(fixture.store.preparation == .loading)
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        fixture.data.last?.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.shared.id)
        fixture.store.reset()
    }

    @Test
    func cancelledSwitchDeadlineCannotRevealAWorkspace() async throws {
        let fixture = SessionFixture(minimumSwitchDuration: .milliseconds(20))
        await fixture.launch()
        fixture.store.requestWorkspaceWhenAvailable(id: fixture.shared.id)
        fixture.store.cancelTransition()
        try await Task.sleep(for: .milliseconds(50))
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        #expect(fixture.store.pending == nil)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    @Test
    func settingsSwitchStartsLoadingAndWaitsForBudgetData() async throws {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.store.requestWorkspaceWhenAvailable(id: fixture.shared.id)
        let pending = try #require(fixture.store.pending)
        #expect(pending.workspace.id == fixture.shared.id)
        #expect(!fixture.store.isFadingOut)
        #expect(fixture.store.preparation == .loading)
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        fixture.data.last?.publishBudget()
        await waitUntil { fixture.store.preparation == .ready }
        fixture.store.revealIfReady()
        #expect(fixture.store.current === pending)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    @Test
    func queuedWorkspaceSelectionResetsWithAuthentication() async {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.store.requestWorkspaceWhenAvailable(id: "created")
        fixture.store.reset()
        await fixture.launch()
        fixture.catalog.send([fixture.personal, .init(_id: "created", name: "New budget")])
        await drain()
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    @Test
    func requestedWorkspaceWaitsForExistingTransitionToFinish() async {
        let fixture = SessionFixture()
        await fixture.launch()
        fixture.store.requestWorkspace(fixture.shared)
        fixture.store.requestWorkspaceWhenAvailable(id: fixture.personal.id)
        fixture.store.finishFade(id: fixture.store.transitionID)
        await fixture.prepareHome()
        fixture.store.revealIfReady()
        await fixture.prepareHome()
        fixture.store.revealIfReady()
        #expect(fixture.store.current?.workspace.id == fixture.personal.id)
        #expect(!fixture.store.isTransitioning)
        fixture.store.reset()
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async {
        for _ in 0..<100 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }

    private func drain() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }
    }
}

@Suite(.serialized)
@MainActor
struct AppBudgetLaunchTests {
    @Test(arguments: [CGFloat(320), CGFloat(402)], [Int64(0), Int64(8_000)])
    func budgetIsAlreadyOnTheCurrentMonthWhenLoadingRevealsIt(
        width: CGFloat, readyToAssign: Int64
    )
        async throws
    {
        let fixture = SessionFixture()
        defer { fixture.store.reset() }
        var offsetErrors: [CGFloat] = []
        _ = try await HostedViewSnapshot.image(
            of: AppBudgetLaunchRegressionView(fixture: fixture, readyToAssign: readyToAssign),
            size: CGSize(width: width, height: 874), animationSampleCount: 60,
            onAnimationSample: { root in
                func horizontalPager(in view: UIView) -> UIScrollView? {
                    if let scroll = view as? UIScrollView,
                        scroll.bounds.width > 0,
                        scroll.contentSize.width > scroll.bounds.width + 1
                    {
                        return scroll
                    }
                    return view.subviews.lazy.compactMap { horizontalPager(in: $0) }.first
                }
                guard let budget = fixture.store.current?.budget,
                    let firstMonth = budget.browsableMonths.first,
                    let scroll = horizontalPager(in: root)
                else { return }
                let pageIndex = CGFloat(
                    BudgetMonth.index(budget.currentMonth) - BudgetMonth.index(firstMonth))
                let bounds = (scroll.layer.presentation() ?? scroll.layer).bounds
                offsetErrors.append(
                    bounds.minX + scroll.adjustedContentInset.left - pageIndex * bounds.width)
            })
        let budget = try #require(fixture.store.current?.budget)
        #expect(fixture.store.navigation.selectedPage == .budget)
        #expect(budget.selectedMonth == budget.currentMonth)
        #expect(budget.readyToAssign == Decimal(readyToAssign))
        try #require(offsetErrors.count > 10)
        // The plain loading page must hand off to an already-positioned budget,
        // whether or not the destination has a Ready to Assign Peek.
        #expect(offsetErrors.allSatisfy { abs($0) < 1 })
    }
}

private struct AppBudgetLaunchRegressionView: View {
    let fixture: SessionFixture
    let readyToAssign: Int64
    var body: some View {
        Group {
            if let session = fixture.store.displayedSession {
                HomeView(
                    transactionFeedStore: session.transactions, budgetStore: session.budget,
                    accountsStore: session.accounts, reportsStore: session.reports,
                    appSession: fixture.store)
            } else {
                AppLoadingView()
            }
        }
        .environment(Clerk.shared)
        .task { await fixture.launch(readyToAssign: readyToAssign) }
    }
}

private enum SessionTestError: Error { case failed }

@MainActor
private final class SessionFixture {
    let personal = AppWorkspace(_id: "personal", name: "Personal")
    let shared = AppWorkspace(_id: "shared", name: "Household", accessKind: "family")
    let catalog = PassthroughSubject<[AppWorkspace], Error>()
    let profile = PassthroughSubject<AppWorkspaceProfile?, Error>()
    var data: [WorkspaceDataFixture] = []
    var savedSelections: [String] = []
    var selectionHandler: (String) async throws -> Void = { _ in }
    let defaults: UserDefaults?
    private let ownedDefaultsSuite: String?
    let timeout: Duration
    let minimumSwitchDuration: Duration

    lazy var store = AppSessionStore(
        defaults: defaults, responseTimeout: timeout,
        minimumWorkspaceSwitchDuration: minimumSwitchDuration,
        workspaceSubscription: { [unowned self] in catalog.eraseToAnyPublisher() },
        profileSubscription: { [unowned self] in profile.eraseToAnyPublisher() },
        sessionFactory: { [unowned self] workspace in
            let fixture = WorkspaceDataFixture(workspace: workspace, timeout: timeout)
            data.append(fixture)
            return fixture.session
        },
        selectionHandler: { [unowned self] id in
            savedSelections.append(id)
            try await selectionHandler(id)
        })

    init(
        defaults: UserDefaults? = nil, timeout: Duration = .seconds(15),
        minimumSwitchDuration: Duration = .zero
    ) {
        let suite = defaults == nil ? "home-session-tests.\(UUID().uuidString)" : nil
        ownedDefaultsSuite = suite
        self.defaults = defaults ?? suite.flatMap(UserDefaults.init(suiteName:))
        self.timeout = timeout
        self.minimumSwitchDuration = minimumSwitchDuration
    }

    deinit {
        if let ownedDefaultsSuite { defaults?.removePersistentDomain(forName: ownedDefaultsSuite) }
    }

    func start() async {
        store.start(userID: "user")
        catalog.send([personal, shared])
        profile.send(AppWorkspaceProfile(activeWorkspaceId: personal.id))
        for _ in 0..<100 {
            if store.pending != nil { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("Workspace preparation did not start")
    }

    func prepareHome() async {
        data.last?.publishHome()
        data.last?.publishBudget()
        for _ in 0..<100 {
            if data.last?.session.readiness(for: .home) == .ready { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("Home preparation did not finish")
    }

    func launch(readyToAssign: Int64 = 0) async {
        await start()
        data.last?.publishHome()
        data.last?.publishBudget(readyToAssign: readyToAssign)
        data.last?.publishTransactions()
        for _ in 0..<100 {
            if store.preparation == .ready, data.last?.session.transactions.hasLoaded == true,
                data.last?.session.readiness(for: .home) == .ready
            {
                store.revealIfReady()
                return
            }
            try? await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("Launch did not finish")
    }
}

@MainActor
private final class WorkspaceDataFixture {
    let workspace: AppWorkspace
    let timeout: Duration
    let structure = CurrentValueSubject<BudgetStructure?, Error>(nil)
    let snapshot = CurrentValueSubject<BudgetSnapshot?, Error>(nil)
    var budgetStructureRequests = 0
    var budgetSnapshotRequests = 0
    let feed = CurrentValueSubject<TransactionFeedResponse?, Error>(nil)
    var feedRequests: [TransactionFeedSubscriptionRequest] = []
    let accountData = CurrentValueSubject<[AccountSnapshot]?, Error>([])
    let homeData = CurrentValueSubject<HomeBriefing?, Error>(nil)
    let connections = CurrentValueSubject<[HomeBankConnection]?, Error>(nil)
    let agendaData = PassthroughSubject<PlannedData, Error>()
    var agendaRequests = 0
    let agendaCancellations = Mutex(0)
    let cancellations = Mutex(0)
    var accountRequests = 0
    var historyRequests = 0
    var homeRequests = 0
    var reportRequests = 0
    var reportNow = Date.now
    var queryCounts: [Int] {
        [
            budgetStructureRequests, budgetSnapshotRequests, feedRequests.count,
            accountRequests, historyRequests, homeRequests, agendaRequests, reportRequests,
        ]
    }

    private func track<Value>(_ publisher: AnyPublisher<Value, Error>) -> AnyPublisher<Value, Error>
    {
        return publisher.handleEvents(receiveCancel: { [weak self] in
            self?.cancellations.withLock { $0 += 1 }
        }).eraseToAnyPublisher()
    }

    var editorChoicesRequests = 0
    var editorChoicesCancellations = 0
    lazy var editorChoices = TransactionEditorChoicesStore(workspaceID: workspace.id) {
        [unowned self] in
        editorChoicesRequests += 1
        return Empty<TransactionEditorChoices, Error>(completeImmediately: false)
            .handleEvents(receiveCancel: { [weak self] in self?.editorChoicesCancellations += 1 })
            .eraseToAnyPublisher()
    }

    lazy var session = HomeWorkspaceSession(
        workspace: workspace,
        budget: BudgetStore(
            defaults: nil, responseTimeout: timeout, workspaceID: workspace.id,
            structureSubscription: { [unowned self] in
                budgetStructureRequests += 1
                return track(structure.compactMap { $0 }.eraseToAnyPublisher())
            },
            snapshotSubscription: { [unowned self] _, _ in
                budgetSnapshotRequests += 1
                return track(snapshot.compactMap { $0 }.eraseToAnyPublisher())
            },
            assignmentHandler: { _ in BudgetAssignmentResult(success: true) }),
        transactions: TransactionFeedStore(
            firstResponseTimeout: timeout, workspaceID: workspace.id,
            plannedStoreFactory: { [unowned self] workspace in
                PlannedStore(
                    workspace: workspace,
                    subscription: { [unowned self] _, _ in
                        agendaRequests += 1
                        return track(
                            agendaData.handleEvents(receiveCancel: { [weak self] in
                                self?.agendaCancellations.withLock { $0 += 1 }
                            }).eraseToAnyPublisher())
                    }, actionHandler: { _, _, _, _ in nil })
            },
            subscriptionFactory: { [unowned self] request in
                feedRequests.append(request)
                return track(feed.compactMap { $0 }.eraseToAnyPublisher())
            }),
        accounts: AccountsStore(
            responseTimeout: timeout, workspaceID: workspace.id,
            workspaceLoader: { [weak self] in self?.budgetStructure().workspace },
            accountsSubscription: { [unowned self] _ in
                accountRequests += 1
                return track(accountData.compactMap { $0 }.eraseToAnyPublisher())
            },
            historySubscription: { [unowned self] _, _ in
                historyRequests += 1
                return track(
                    Just(AccountHistoryReport(months: [], currentMonth: "2026-09"))
                        .setFailureType(to: Error.self)
                        .append(Empty(completeImmediately: false)).eraseToAnyPublisher())
            }),
        home: HomeDashboardStore(
            workspaceID: workspace.id,
            connections: { [unowned self] _ in connections.compactMap { $0 }.eraseToAnyPublisher() }
        ) { [unowned self] _, _ in
            homeRequests += 1
            return track(homeData.compactMap { $0 }.eraseToAnyPublisher())
        },
        reports: ReportsStore(
            workspaceID: workspace.id, now: { [unowned self] in reportNow },
            historyLoader: { [unowned self] _ in
                reportRequests += 1
                return ReportPage(page: [], continueCursor: "", isDone: true)
            }), editorChoices: editorChoices)

    init(workspace: AppWorkspace, timeout: Duration = .seconds(15)) {
        self.workspace = workspace
        self.timeout = timeout
    }

    func budgetStructure(id: String? = nil) -> BudgetStructure {
        BudgetStructure(
            workspace: .init(
                id: id ?? workspace.id, name: workspace.name, currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "UTC"), categoryGroups: [])
    }

    func publishBudget(readyToAssign: Int64 = 0) {
        structure.send(budgetStructure())
        let month = BudgetMonth.current()
        snapshot.send(
            .init(
                months: [], availableRange: .init(minYearMonth: month, maxYearMonth: month),
                readyToAssign: readyToAssign))
    }

    func feedResponse(id: String? = nil) -> TransactionFeedResponse {
        TransactionFeedResponse(
            workspace: .init(
                id: id ?? workspace.id, name: workspace.name, currencyCode: "USD",
                minorUnit: 2, timezoneIdentifier: "UTC"),
            transactions: .init(page: [], continueCursor: "", isDone: true))
    }

    func publishHome(includeConnections: Bool = true) {
        if includeConnections { connections.send([]) }
        homeData.send(try? HomeBriefingTests.snapshot(workspace: workspace.id))
    }

    func publishTransactions() { feed.send(feedResponse()) }
}
