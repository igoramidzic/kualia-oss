import Combine
import ConvexMobile
import CoreGraphics
import Foundation
import Observation
import Synchronization
import Testing

@testable import Kualia

@Suite(.serialized)
@MainActor
struct BudgetStoreTests {
    @Test
    func archivedCountTracksRestoresAndWorkspaceChanges() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        let first = PassthroughSubject<[BudgetGroupDeletionDetails], Error>()
        let second = PassthroughSubject<[BudgetGroupDeletionDetails], Error>()
        var requests: [String] = []
        fixture.archivedSubscription = { workspaceID in
            requests.append(workspaceID)
            return (workspaceID == "workspace" ? first : second).eraseToAnyPublisher()
        }
        await load(fixture)
        #expect(fixture.store.archivedCategoryCount == nil)
        let group = BudgetGroupDeletionDetails(
            group: .init(_id: "group", name: "Group", type: "expense", isDeleted: false),
            categories: [
                .init(
                    _id: "archived", name: "Archived", iconName: nil, type: "expense",
                    isArchived: true),
                .init(_id: "active", name: "Active", iconName: nil, type: "expense"),
                .init(
                    _id: "system", name: "System", iconName: nil, type: "expense", isArchived: true,
                    isSystemCategory: true),
                .init(
                    _id: "card", name: "Card", iconName: nil, type: "credit_card", isArchived: true),
            ])
        first.send([group])
        await waitUntil { fixture.store.archivedCategoryCount == 1 }
        first.send([])
        await waitUntil { fixture.store.archivedCategoryCount == 0 }
        fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "second"))
        await waitUntil { requests == ["workspace", "second"] }
        #expect(fixture.store.archivedCategoryCount == nil)
        first.send([group])
        second.send([])
        await waitUntil { fixture.store.archivedCategoryCount == 0 }
        fixture.store.stop()
        second.send([group])
        await drainMainQueue()
        #expect(fixture.store.archivedCategoryCount == 0)
        fixture.store.reset()
        #expect(fixture.store.archivedCategoryCount == nil)
    }

    @Test
    func archivedCountDoesNotShowZeroWhenItsQueryFailsAndCanRetry() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        let subject = PassthroughSubject<[BudgetGroupDeletionDetails], Error>()
        fixture.archivedSubscription = { _ in subject.eraseToAnyPublisher() }
        await load(fixture)
        subject.send([])
        await waitUntil { fixture.store.archivedCategoryCount == 0 }
        subject.send(completion: .failure(BudgetSaveError.rejected))
        await waitUntil { fixture.store.archivedCategoryCount == nil }
        fixture.archivedSubscription = { _ in
            Just([]).setFailureType(to: Error.self).eraseToAnyPublisher()
        }
        fixture.store.retry()
        await waitUntil { fixture.store.archivedCategoryCount == 0 }
    }

    @Test
    func widgetRefreshRevisionTracksServerChangesWhileBrowsingAnotherMonth() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        #expect(fixture.store.snapshotRevision == 0)
        await load(fixture)
        let revision = fixture.store.snapshotRevision
        #expect(revision == 1)
        fixture.store.selectMonth(202608)
        #expect(fixture.store.snapshotRevision == revision)

        let changed = Mutex(false)
        withObservationTracking {
            _ = fixture.store.snapshotRevision
        } onChange: {
            changed.withLock { $0 = true }
        }
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 2_000))
        await waitUntil { fixture.store.snapshotRevision == revision + 1 }
        #expect(changed.withLock { $0 })
        #expect(fixture.store.categoryPickerBalances(for: 202609)?["groceries"] == 1_400)

        // Reconnects can repeat the same snapshot without needing another reload.
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 2_000))
        await drainMainQueue()
        #expect(fixture.store.snapshotRevision == revision + 1)
        fixture.store.reset()
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 3_000))
        await drainMainQueue()
        #expect(fixture.store.snapshotRevision == revision + 1)
    }

    @Test(arguments: [true, false])
    func widgetRefreshWaitsForAuthoritativeAssignmentAmounts(success: Bool) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        let revision = fixture.store.snapshotRevision
        fixture.assignmentHandler = { _ in
            if !success { throw BudgetSaveError.rejected }
            return BudgetAssignmentResult(success: true)
        }
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 2_000, minorUnit: 2), editorID: editor.id)
        #expect(fixture.store.snapshotRevision == revision)
        fixture.store.finishEditing()
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.store.snapshotRevision == revision)

        if success {
            await waitUntil { fixture.snapshotSubjects.count == 2 }
            fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot(assigned: 2_000))
            await waitUntil { fixture.store.snapshotRevision == revision + 1 }
            #expect(fixture.store.snapshotRevision == revision + 1)
        } else {
            await waitUntil { fixture.store.saveError != nil }
            #expect(fixture.store.snapshotRevision == revision)
        }
    }

    @Test
    func categoryPickerBalancesFollowTheRequestedMonthAndLiveUpdates() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        #expect(fixture.store.categoryPickerBalances(for: 202609) == nil)
        await load(fixture)
        fixture.store.selectMonth(202608)
        #expect(fixture.store.categoryPickerBalances(for: 202609)?["groceries"] == 400)
        #expect(fixture.store.categoryPickerBalances(for: 202609)?["unfunded"] == 0)
        #expect(fixture.store.categoryPickerBalances(for: 202608)?["groceries"] == 0)
        #expect(fixture.store.categoryPickerBalances(for: 202610)?["groceries"] == 0)
        #expect(fixture.store.categoryPickerBalances(for: 202609)?["none"] == nil)
        #expect(fixture.store.categoryPickerBalances(for: 202609)?["rta"] == nil)
        #expect(fixture.store.categoryPickerBalances(for: 202609)?["missing"] == nil)
        #expect(fixture.store.categoryPickerBalances(for: 202607) == nil)
        #expect(fixture.store.categoryPickerBalances(for: 202611) == nil)

        let changed = Mutex(false)
        withObservationTracking {
            _ = fixture.store.categoryPickerBalances(for: 202609)
        } onChange: {
            changed.withLock { $0 = true }
        }
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 100))
        await waitUntil {
            fixture.store.categoryPickerBalances(for: 202609)?["groceries"] == -500
        }
        #expect(changed.withLock { $0 })
        fixture.store.reset()
        #expect(fixture.store.categoryPickerBalances(for: 202609) == nil)
    }

    @Test
    func categoryPickerBalancesExcludeUnfinishedAssignmentEdits() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        var calculator = try #require(fixture.store.assignmentCalculator)
        calculator.appendDigit(9)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.categoryPickerBalances(for: 202609)?["groceries"] == 400)
        fixture.store.finishEditing()
        await waitUntil { fixture.assignmentRequests.count == 1 }
        let assigned = try #require(fixture.assignmentRequests.first?.assignedAmount)
        #expect(
            fixture.store.categoryPickerBalances(for: 202609)?["groceries"]
                == Decimal(assigned) - 600)
    }

    @Test
    func categoryPickerMonthUsesTheTransactionCalendarKey() {
        #expect(BudgetMonth.fromDateKey("2026-01-01") == 202601)
        #expect(BudgetMonth.fromDateKey("2025-12-31") == 202512)
        #expect(BudgetMonth.fromDateKey("2028-02-29") == 202802)
        #expect(BudgetMonth.fromDateKey("2026-00-01") == nil)
        #expect(BudgetMonth.fromDateKey("2026-13-01") == nil)
        #expect(BudgetMonth.fromDateKey("") == nil)
    }

    @Test
    func categoryProgressDecodesServerRatiosWithoutRecalculatingFromMonthlyAmounts() throws {
        let payload = """
            {"targetAmount":\(try Int64(1_200_000).convexEncode()),
             "assignmentNeeded":\(try Int64(100_000).convexEncode()),
             "remainingToAssign":\(try Int64(20_000).convexEncode()),
             "fundedRatio":0.75,"spentRatio":0.25}
            """
        let target = try JSONDecoder().decode(BudgetCategoryTarget.self, from: Data(payload.utf8))
        let progress = BudgetCategoryProgress(target: target, available: 60_000)
        #expect(target.fundedRatio == 0.75)
        #expect(target.spentRatio == 0.25)
        #expect(progress.state == .underfunded)
        #expect(progress.spent == 0.25)
        #expect(progress.available == 0.5)
        #expect(progress.unfunded == 0.25)
        #expect(abs(progress.spentOfFunded - 1.0 / 3.0) < 0.000_001)

        let legacy = try JSONDecoder().decode(BudgetCategoryTarget.self, from: Data("{}".utf8))
        #expect(BudgetCategoryProgress(target: legacy) == BudgetCategoryProgress())
    }

    @Test
    func categoryProgressDecodesOptimisticInputsFromBudgetSnapshot() throws {
        let payload = """
            {"assignedAmount":\(try Int64(1_000).convexEncode()),
             "available":\(try Int64(200).convexEncode()),
             "carryoverFromPrevious":\(try Int64(-200).convexEncode()),
             "totalSpent":\(try Int64(-600).convexEncode()),
             "outflowAmount":\(try Int64(800).convexEncode()),
             "fundedSpending":\(try Int64(650).convexEncode()),
             "target":{"cumulativeAssigned":\(try Int64(4_000).convexEncode()),
                       "cumulativeTargetNeeded":\(try Int64(6_000).convexEncode())}}
            """
        let amounts = try JSONDecoder().decode(BudgetCategoryAmounts.self, from: Data(payload.utf8))
        #expect(amounts.carryoverFromPrevious == -200)
        #expect(amounts.totalSpent == -600)
        #expect(amounts.outflowAmount == 800)
        #expect(amounts.fundedSpending == 650)
        #expect(amounts.target?.cumulativeAssigned == 4_000)
        #expect(amounts.target?.cumulativeTargetNeeded == 6_000)
    }

    @Test
    func categoryProgressMatchesWebTargetAndOverspendingStates() {
        let cases: [(BudgetCategoryTarget, Decimal, BudgetCategoryProgress.State)] = [
            (.init(fundedRatio: 1, spentRatio: 0.4), 600, .noTarget),
            (.init(targetAmount: 0, remainingToAssign: 100), 0, .noTarget),
            (.init(targetAmount: 1_000, remainingToAssign: 100), 0, .underfunded),
            (.init(targetAmount: 1_000, remainingToAssign: 0), 0, .fullyFunded),
            // The web uses remainingToAssign for the bar, including snoozed targets.
            (.init(targetAmount: 1_000, isSnoozed: true, remainingToAssign: 100), 0, .underfunded),
            (.init(targetAmount: 1_000, remainingToAssign: 100), -1, .overspent),
            (.init(), -1, .overspent),
        ]
        for (target, available, state) in cases {
            #expect(BudgetCategoryProgress(target: target, available: available).state == state)
        }
    }

    @Test
    func categoryFundingCaptionsCoverEveryStatus() {
        typealias Status = BudgetCategoryFunding.Status
        let cases: [(BudgetCategoryAmounts, BudgetTargetKind?, Status?)] = [
            (.init(), nil, nil),
            (.init(assignedAmount: 500, available: 500), nil, nil),
            (.init(available: -150), nil, .overspent(150)),
            (.init(available: Int64.min), nil, .overspent(-Decimal(Int64.min))),
            (.init(target: .init(targetAmount: 0)), nil, nil),
            (.init(target: .init(isSnoozed: true)), .setAside, .snoozed),
            (.init(available: -100, target: .init(isSnoozed: true)), .setAside, .overspent(100)),
            (
                .init(available: -100, target: .init(targetAmount: 500, overfundedByAmount: 200)),
                .setAside, .overspent(100)
            ),
            (
                .init(available: 700, target: .init(targetAmount: 500, overfundedByAmount: 200)),
                .setAside, .extraFunded(200)
            ),
            (.init(target: .init(targetAmount: 500)), .setAside, .fullyFunded(0)),
            (.init(target: .init(targetAmount: 500)), .spending, .fullyFunded(0)),
            (.init(available: 200, target: .init(targetAmount: 500)), .oneTime, .onTrack),
            (.init(available: 200, target: .init(targetAmount: 500)), .maintainBalance, .onTrack),
            (.init(available: 500, target: .init(targetAmount: 500)), .oneTime, .fullyFunded(0)),
            (
                .init(available: 500, target: .init(targetAmount: 500)), .maintainBalance,
                .fullyFunded(0)
            ),
            (
                .init(target: .init(targetAmount: 500, remainingToAssign: 150)),
                .setAside, .neededThisMonth(150)
            ),
            (
                .init(target: .init(targetAmount: 500, remainingToAssign: 150)),
                .maintainBalance, .neededThisMonth(150)
            ),
            (
                .init(target: .init(targetAmount: 500, remainingToAssign: 150)),
                .oneTime, .needed(150)
            ),
        ]
        for (amounts, kind, expected) in cases {
            let settings = kind.map { BudgetTarget(categoryId: "category", targetType: $0) }
            #expect(
                BudgetCategoryFunding(amounts: amounts).status(target: settings, month: 202609)
                    == expected)
        }
        #expect(Status.fullyFunded(0).title(currencyCode: "USD", minorUnit: 2) == "Fully funded")
        #expect(Status.onTrack.title(currencyCode: "USD", minorUnit: 2) == "On track")
        #expect(Status.snoozed.title(currencyCode: "USD", minorUnit: 2) == "Target snoozed")
        let titles: [(Status, String)] = [
            (.fullyFunded(15_000), "$150.00 spent"),
            (.overspent(15_000), "Overspent by $150.00"),
            (.extraFunded(15_000), "$150.00 extra funded"),
            (.neededThisMonth(15_000), "$150.00 more needed this month"),
            (.needed(15_000), "$150.00 needed"),
        ]
        for (status, expected) in titles {
            #expect(
                status.title(currencyCode: "USD", minorUnit: 2, locale: Locale(identifier: "en_US"))
                    == expected)
        }
        #expect(
            Status.overspent(150).title(
                currencyCode: "JPY", minorUnit: 0, locale: Locale(identifier: "en_US"))
                == "Overspent by ¥150")
    }

    @Test
    func fullyFundedCategoryCaptionUsesMonthlySpending() {
        let cases: [(Int64?, Int64, Decimal)] = [
            (-12_345, -20_000, 12_345),
            (0, -20_000, 0),
            (500, 500, 0),
            (nil, -900, 900),
            (nil, 500, 0),
            (Int64.min, 0, -Decimal(Int64.min)),
        ]
        for (totalSpent, activity, expected) in cases {
            let amounts = BudgetCategoryAmounts(
                available: 500, activity: activity,
                target: .init(targetAmount: 500), totalSpent: totalSpent)
            #expect(
                BudgetCategoryFunding(amounts: amounts).status(
                    target: .init(categoryId: "category", targetType: .spending), month: 202610)
                    == .fullyFunded(expected))
        }
        #expect(
            BudgetCategoryFunding.Status.fullyFunded(150).title(
                currencyCode: "JPY", minorUnit: 0, locale: Locale(identifier: "en_US"))
                == "¥150 spent")
    }

    @Test
    func overspentCategoryCaptionsShowTheRemainingTargetContribution() {
        let settings = BudgetTarget(categoryId: "category", targetType: .setAside)
        let amounts = BudgetCategoryAmounts(
            assignedAmount: 20_000, available: -5_000,
            target: .init(
                targetAmount: 50_000, underfundedAmount: 35_000,
                assignmentNeeded: 50_000, remainingToAssign: 30_000))

        for (assigned, remaining): (Int64, Decimal) in [
            (20_000, 30_000), (22_000, 28_000), (25_000, 25_000), (19_000, 31_000),
        ] {
            #expect(
                BudgetCategoryFunding(amounts: amounts, assigned: assigned)
                    .status(target: settings, month: 202609) == .neededThisMonth(remaining))
        }

        let legacyAmounts = BudgetCategoryAmounts(
            available: -5_000,
            target: .init(targetAmount: 50_000, underfundedAmount: 30_000))
        #expect(
            BudgetCategoryFunding(amounts: legacyAmounts).status(target: settings, month: 202609)
                == .neededThisMonth(30_000))
    }

    @Test(arguments: [Int64(0), -5_000])
    func categoryFundingCaptionsUseTheCurrentMonthsDeadlineAndTargetCadence(available: Int64) {
        for frequency in BudgetTargetFrequency.allCases {
            for dueDate in ["2026-09-15", "2026-12-15", "invalid"] {
                let funding = BudgetCategoryFunding(
                    amounts: .init(
                        available: available,
                        target: .init(
                            targetAmount: 50_000, dueDate: dueDate, remainingToAssign: 15_000)))
                let settings = BudgetTarget(
                    categoryId: "category", targetType: .setAside, frequency: frequency,
                    frequencyInterval: 3, dueDay: 15)
                let status = funding.status(target: settings, month: 202609)
                if frequency == .daily || frequency == .weekly {
                    #expect(status == .needed(15_000))
                } else if dueDate == "2026-09-15" {
                    #expect(
                        status
                            == .neededBy(
                                15_000, BudgetMonth.date(202609).addingTimeInterval(14 * 86_400)))
                    #expect(
                        status?.title(
                            currencyCode: "USD", minorUnit: 2, locale: Locale(identifier: "en_US"))
                            == "$150.00 more needed by Sep 15")
                } else {
                    #expect(status == .neededThisMonth(15_000))
                }
            }
        }
        let endOfMonth = BudgetCategoryFunding(
            amounts: .init(
                target: .init(targetAmount: 500, dueDate: "2026-09-30", remainingToAssign: 150)))
        #expect(
            endOfMonth.status(
                target: .init(
                    categoryId: "category", targetType: .spending, frequency: .monthly, dueDay: -1),
                month: 202609) == .neededThisMonth(150))
    }

    @Test
    func categoryFundingCaptionsProjectExtraFundingAndItsRemoval() {
        let settings = BudgetTarget(categoryId: "category", targetType: .setAside)
        let amounts = BudgetCategoryAmounts(
            assignedAmount: 1_200, available: 1_200,
            target: .init(
                targetAmount: 1_000, overfundedByAmount: 200,
                assignmentNeeded: 1_000, remainingToAssign: 0))
        let cases: [(Int64, BudgetCategoryFunding.Status)] = [
            (1_100, .extraFunded(100)), (1_000, .fullyFunded(0)), (900, .neededThisMonth(100)),
        ]
        for (assigned, status) in cases {
            #expect(
                BudgetCategoryFunding(amounts: amounts, assigned: assigned)
                    .status(target: settings, month: 202609) == status)
        }
        let rollover = BudgetCategoryAmounts(
            assignedAmount: 300, available: 800,
            target: .init(targetAmount: 1_000, assignmentNeeded: 500, remainingToAssign: 200))
        #expect(
            BudgetCategoryFunding(amounts: rollover, assigned: 600).status(
                target: .init(categoryId: "category", targetType: .spending), month: 202609)
                == .extraFunded(100))
        let noContributionNeeded = BudgetCategoryAmounts(
            assignedAmount: 200, available: 1_200,
            target: .init(
                targetAmount: 1_000, overfundedByAmount: 200, assignmentNeeded: 0,
                remainingToAssign: 0))
        #expect(
            BudgetCategoryFunding(amounts: noContributionNeeded, assigned: 100)
                .status(target: settings, month: 202609) == .extraFunded(100))
    }

    @Test
    func extraFundingCaptionsRespectBalanceTargetsAndSpendableMoney() {
        let settings = BudgetTarget(categoryId: "category", targetType: .maintainBalance)
        let amounts = BudgetCategoryAmounts(
            assignedAmount: 0, available: 900,
            target: .init(targetAmount: 1_000, assignmentNeeded: 100, remainingToAssign: 100))
        #expect(
            BudgetCategoryFunding(amounts: amounts, assigned: 100)
                .status(target: settings, month: 202609) == .fullyFunded(0))
        #expect(
            BudgetCategoryFunding(amounts: amounts, assigned: 200)
                .status(target: settings, month: 202609) == .extraFunded(100))
        #expect(
            BudgetCategoryFunding(amounts: amounts, assigned: 200, isFutureMonth: true)
                .status(target: settings, month: 202610) == .fullyFunded(0))
        let spent = BudgetCategoryAmounts(
            assignedAmount: 1_000, available: 0,
            target: .init(targetAmount: 1_000, assignmentNeeded: 500, remainingToAssign: 0))
        #expect(
            BudgetCategoryFunding(amounts: spent, assigned: 1_100)
                .status(target: .init(categoryId: "category", targetType: .setAside), month: 202609)
                == .extraFunded(100))
        let spendingTarget = BudgetTarget(categoryId: "category", targetType: .spending)
        let saving = BudgetCategoryAmounts(
            assignedAmount: 200, available: 400,
            target: .init(targetAmount: 1_000, assignmentNeeded: 200, remainingToAssign: 0))
        for isFuture in [true, false] {
            #expect(
                BudgetCategoryFunding(amounts: saving, assigned: 300, isFutureMonth: isFuture)
                    .status(target: spendingTarget, month: 202609) == .extraFunded(100))
        }
    }

    @Test
    func categoryProgressKeepsUnspentExtrasSolidAndFillsOverspending() {
        let target = BudgetCategoryTarget(
            targetAmount: 20_000, assignmentNeeded: 20_000, remainingToAssign: 0,
            fundedRatio: 1, spentRatio: 1)
        let cases: [(BudgetCategoryAmounts, Double, Double, Double, Double)] = [
            (
                .init(assignedAmount: 25_000, available: 5_000, activity: -20_000, target: target),
                0.8, 0.2, 0, 0
            ),
            (
                .init(assignedAmount: 2_000, available: -18_000, activity: -20_000, target: target),
                0.1, 0, 0.9, 0
            ),
            (.init(available: -20_000, activity: -20_000, target: target), 0, 0, 1, 0),
            (
                .init(assignedAmount: 2_000, available: -3_000, activity: -5_000, target: target),
                0.4, 0, 0.6, 0
            ),
            (
                .init(assignedAmount: 20_000, available: 0, activity: -20_000, target: target), 1,
                0, 0, 0
            ),
            (
                .init(
                    assignedAmount: 2_000, available: -18_000, target: target,
                    carryoverFromPrevious: -20_000), 0.1, 0, 0.9, 0
            ),
            (.init(available: -20_000, activity: -20_000), 0, 0, 1, 0),
            (
                .init(
                    assignedAmount: 10_000, available: 5_000, activity: -5_000,
                    target: .init(
                        targetAmount: 20_000, remainingToAssign: 10_000, fundedRatio: 0.5,
                        spentRatio: 1)), 0.25, 0.25, 0, 0.5
            ),
            (
                .init(
                    assignedAmount: 10_000, available: 10_000,
                    target: .init(targetAmount: 20_000, remainingToAssign: 10_000, fundedRatio: 0.5)
                ), 0, 0.5, 0, 0.5
            ),
            (
                .init(
                    assignedAmount: 10_000, available: 10_000, activity: -20_000, target: target,
                    carryoverFromPrevious: 20_000), 2.0 / 3, 1.0 / 3, 0, 0
            ),
        ]
        for (amounts, spent, available, overspent, unfunded) in cases {
            let progress = BudgetCategoryProgress(
                amounts: amounts, assigned: amounts.assignedAmount,
                targetKind: .setAside, isFutureMonth: false)
            #expect(abs(progress.spent - spent) < 0.000_001)
            #expect(abs(progress.available - available) < 0.000_001)
            #expect(abs(progress.overspent - overspent) < 0.000_001)
            #expect(abs(progress.unfunded - unfunded) < 0.000_001)
            #expect(abs(progress.filled + progress.unfunded - 1) < 0.000_001)
            if amounts.available < 0 {
                #expect(progress.state == .overspent)
                #expect(progress.filled == 1)
            }
        }
    }

    @Test
    func extraAssignmentProgressMatchesTheNextServerSnapshot() {
        let baseline = BudgetCategoryAmounts(
            assignedAmount: 2_000, available: -18_000, activity: -20_000,
            target: .init(
                targetAmount: 20_000, assignmentNeeded: 20_000,
                remainingToAssign: 18_000, fundedRatio: 0.1, spentRatio: 1))
        let preview = BudgetCategoryProgress(
            amounts: baseline, assigned: 25_000, targetKind: .setAside, isFutureMonth: false)
        let confirmed = BudgetCategoryProgress(
            amounts: .init(
                assignedAmount: 25_000, available: 5_000, activity: -20_000,
                target: .init(
                    targetAmount: 20_000, assignmentNeeded: 20_000,
                    remainingToAssign: 0, fundedRatio: 1, spentRatio: 1)),
            assigned: 25_000, targetKind: .setAside, isFutureMonth: false)
        #expect(preview == confirmed)
        #expect(preview.state == .fullyFunded)
        #expect(preview.spent == 0.8)
        #expect(abs(preview.available - 0.2) < 0.000_001)
        let removed = BudgetCategoryProgress(
            amounts: baseline, assigned: 0, targetKind: .setAside, isFutureMonth: false)
        #expect(removed.filled == 1)
        #expect(removed.spent == 0)
        #expect(removed.overspent == 1)
    }

    @Test
    func categoryProgressClipsSpendingToFundingAndKeepsEverySegmentInBounds() {
        for funded in [0, 0.000_1, 0.25, 1, 1.5, -1, Double.infinity, .nan] {
            for spent in [0, 0.1, 0.75, 1.5, -1, Double.infinity, .nan] {
                let progress = BudgetCategoryProgress(
                    target: .init(fundedRatio: funded, spentRatio: spent))
                for segment in [progress.spent, progress.available, progress.unfunded] {
                    #expect(segment.isFinite && (0...1).contains(segment))
                }
                #expect(
                    abs(progress.spent + progress.available + progress.unfunded - 1) < 0.000_001)
                #expect((0...1).contains(progress.spentOfFunded))
            }
        }
        let overspent = BudgetCategoryProgress(
            target: .init(fundedRatio: 0.5, spentRatio: 0.9), available: -100)
        #expect(overspent.spent == 0.5)
        #expect(overspent.available == 0)
        #expect(overspent.unfunded == 0)
        #expect(overspent.overspent == 0.5)
        #expect(overspent.filled == 1)
        #expect(overspent.spentOfFilled == 0.5)
        #expect(overspent.spentOfFunded == 1)
    }

    @Test(arguments: [true, false], [true, false])
    func progressUpdatesOnDoneOrNextCategoryBeforeSaveResponds(success: Bool, movesToNext: Bool)
        async throws
    {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        let baseline = BudgetStoreFixture.snapshot(
            target: .init(
                targetAmount: 2_000, assignmentNeeded: 2_000, remainingToAssign: 1_000,
                fundedRatio: 0.5, spentRatio: 0.6),
            summary: .init(
                totalTargetAmount: 2_000, totalFunded: 1_000, totalRemainingToFund: 1_000))
        fixture.snapshotSubjects[0].send(baseline)
        await drainMainQueue()
        let original = fixture.store.groups[0].rows[0].progress
        let originalFunding = fixture.store.groups[0].rows[0].funding
        #expect(originalFunding.status(target: nil, month: 202609) == .neededThisMonth(1_000))
        let editor = try #require(fixture.store.beginEditing("groceries"))
        let changes = Mutex(0)
        withObservationTracking {
            _ = fixture.store.monthlyFundingSummary(for: 202609)
        } onChange: {
            changes.withLock { $0 += 1 }
        }
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2), editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].progress == original)
        #expect(fixture.store.groups[0].rows[0].funding == originalFunding)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        #expect(fixture.store.monthlyFundingSummary(for: 202609)?.progress == 0.6)
        #expect(changes.withLock { $0 } == 0)
        #expect(fixture.assignmentRequests.isEmpty)
        #expect(fixture.store.groups(for: 202608)[0].rows[0].progress.funded == 0)

        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.assignmentHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        if movesToNext {
            _ = fixture.store.beginEditing("rent")
        } else {
            fixture.store.finishEditing()
        }
        let preview = fixture.store.groups[0].rows[0].progress
        #expect(
            fixture.store.groups[0].rows[0].funding.status(target: nil, month: 202609)
                == .neededThisMonth(500))
        #expect(preview.funded == 0.75)
        #expect(abs(preview.spent - 0.3) < 0.000_001)
        #expect(abs(preview.available - 0.45) < 0.000_001)
        #expect(fixture.store.groups[0].rows[0].available == 900)
        #expect(fixture.store.monthlyFundingSummary(for: 202609)?.progress == 0.8)
        #expect(changes.withLock { $0 } == 1)
        await waitUntil { response != nil }
        // The request is still suspended and the Assigned button is disabled.
        #expect(fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.editor(for: "groceries") == nil)
        #expect(fixture.store.groups[0].rows[0].progress == preview)
        #expect(fixture.store.monthlyFundingSummary(for: 202609)?.progress == 0.8)
        // An unrelated live update must not erase the pending preview.
        fixture.snapshotSubjects[0].send(baseline)
        await drainMainQueue()
        #expect(fixture.store.groups[0].rows[0].progress == preview)

        if success {
            response?.resume(returning: .init(success: true))
            await waitUntil { fixture.snapshotSubjects.count == 2 }
            #expect(fixture.store.groups[0].rows[0].progress == preview)
            fixture.snapshotSubjects[1].send(
                BudgetStoreFixture.snapshot(
                    assigned: 1_500,
                    target: .init(
                        targetAmount: 2_000, assignmentNeeded: 2_000, remainingToAssign: 500,
                        fundedRatio: 0.75, spentRatio: 0.4),
                    summary: .init(
                        totalTargetAmount: 2_000, totalFunded: 1_500, totalRemainingToFund: 500)))
        } else {
            response?.resume(throwing: BudgetSaveError.rejected)
        }
        await waitUntil { !fixture.store.groups[0].rows[0].isPending }
        #expect(fixture.store.groups[0].rows[0].progress == (success ? preview : original))
        #expect(
            fixture.store.groups[0].rows[0].funding.status(target: nil, month: 202609)
                == .neededThisMonth(success ? 500 : 1_000))
        #expect(
            fixture.store.monthlyFundingSummary(for: 202609)?.progress == (success ? 0.8 : 0.6))
    }

    @Test
    func arithmeticDraftAndCancellationLeaveProgressAndAvailableUnchanged() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                target: .init(
                    targetAmount: 2_000, assignmentNeeded: 2_000, remainingToAssign: 1_000,
                    fundedRatio: 0.5, spentRatio: 0.6),
                summary: .init(
                    totalTargetAmount: 2_000, totalFunded: 1_000, totalRemainingToFund: 1_000)))
        await drainMainQueue()
        let original = fixture.store.groups[0].rows[0].progress
        let editor = try #require(fixture.store.beginEditing("groceries"))
        var calculator = AmountCalculator(amount: 1_000, minorUnit: 2)
        calculator.appendOperation(.add)
        calculator.appendDigit(5)
        calculator.appendDigit(0)
        calculator.appendDigit(0)
        #expect(calculator.amount == 1_500)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_000)
        #expect(fixture.store.groups[0].rows[0].progress == original)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        #expect(fixture.store.monthlyFundingSummary(for: 202609)?.progress == 0.6)
        fixture.store.cancelEditing(editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].progress == original)
        #expect(fixture.store.monthlyFundingSummary(for: 202609)?.progress == 0.6)
        #expect(fixture.assignmentRequests.isEmpty)
    }

    @Test
    func progressPreviewUsesTargetSpecificFundingAndSpendingInputs() {
        let monthly = BudgetCategoryTarget(
            targetAmount: 2_000, assignmentNeeded: 2_000, remainingToAssign: 1_000,
            fundedRatio: 0.5, spentRatio: 0.6)
        let amounts = BudgetCategoryAmounts(
            assignedAmount: 1_000, available: 900, activity: -600, target: monthly,
            carryoverFromPrevious: 500, totalSpent: -600, outflowAmount: 800)
        let spending = BudgetCategoryProgress(
            amounts: amounts, assigned: 1_500, targetKind: .spending, isFutureMonth: false)
        #expect(spending.funded == 1)
        #expect(abs(spending.spent - 800.0 / 2_200) < 0.000_001)
        #expect(
            BudgetCategoryProgress(
                amounts: amounts, assigned: 1_500, targetKind: .maintainBalance,
                isFutureMonth: false
            ).funded == 1)
        #expect(
            BudgetCategoryProgress(
                amounts: amounts, assigned: 1_500, targetKind: .spending, isFutureMonth: true
            ).funded == 0.75)
        let authoritative = BudgetCategoryProgress(
            amounts: amounts, assigned: 1_000, targetKind: .spending, isFutureMonth: false)
        #expect(authoritative.funded == monthly.fundedRatio)
        #expect(abs(authoritative.spent - 0.5 * 800.0 / 1_700) < 0.000_001)
        let cumulative = BudgetCategoryAmounts(
            assignedAmount: 1_000, available: 4_000,
            target: .init(
                targetAmount: 24_000, assignmentNeeded: 2_000, remainingToAssign: 1_000,
                cumulativeAssigned: 4_000, cumulativeTargetNeeded: 6_000))
        #expect(
            BudgetCategoryProgress(
                amounts: cumulative, assigned: 1_500, targetKind: .setAside, isFutureMonth: false
            ).funded == 0.75)
        let credit = BudgetCategoryAmounts(
            assignedAmount: 1_000, available: 100, activity: -1_100, target: monthly,
            carryoverFromPrevious: -200, outflowAmount: 1_100, fundedSpending: 650)
        let creditProgress = BudgetCategoryProgress(
            amounts: credit, assigned: 1_500, targetKind: .oneTime, isFutureMonth: false)
        #expect(creditProgress.funded == 0.75)
        #expect(abs(creditProgress.spent - 0.75 * 850.0 / 1_450) < 0.000_001)
        let overfunded = BudgetCategoryAmounts(
            assignedAmount: 3_000, available: 3_000,
            target: .init(
                targetAmount: 2_000, assignmentNeeded: 2_000, remainingToAssign: 0,
                fundedRatio: 1))
        #expect(
            BudgetCategoryProgress(
                amounts: overfunded, assigned: 2_500, targetKind: .setAside, isFutureMonth: false
            ).funded == 1)
        #expect(
            BudgetCategoryProgress(
                amounts: overfunded, assigned: 1_500, targetKind: .setAside, isFutureMonth: false
            ).funded == 0.75)
        #expect(
            BudgetCategoryProgress(
                amounts: .init(), assigned: 500, targetKind: nil, isFutureMonth: false
            ).funded == 1)
    }

    @Test(arguments: [true, false])
    func catalogMetadataStartsAmountsImmediatelyButBothResponsesControlReadiness(
        snapshotFirst: Bool
    ) async throws {
        let fixture = BudgetStoreFixture(startsWithStructure: false)
        defer { fixture.store.reset() }
        fixture.store.prepare(workspace: BudgetStoreFixture.structure().workspace)
        fixture.store.start()
        #expect(fixture.structureSubscriptions == 1)
        #expect(fixture.snapshotRequests.count == 1)
        #expect(fixture.snapshotRequests.first?.workspaceID == "workspace")
        #expect(fixture.snapshotRequests.first?.currentMonth == 202609)
        #expect(!fixture.store.hasLoaded)
        let snapshot = try #require(fixture.snapshotSubjects.first)
        if snapshotFirst {
            snapshot.send(BudgetStoreFixture.snapshot(readyToAssign: 321))
        } else {
            fixture.structure.send(BudgetStoreFixture.structure())
        }
        await drainMainQueue()
        #expect(!fixture.store.hasLoaded)
        #expect(!fixture.store.canEdit)

        if snapshotFirst {
            fixture.structure.send(BudgetStoreFixture.structure())
        } else {
            snapshot.send(BudgetStoreFixture.snapshot(readyToAssign: 321))
        }
        await waitUntil { fixture.store.hasLoaded }
        #expect(fixture.store.canEdit)
        #expect(fixture.store.readyToAssign == 321)
        #expect(fixture.snapshotRequests.count == 1)
    }

    @Test
    func resetRejectsQueuedPrefetchedAmountsAndRestartsWithoutStaleReadiness() async throws {
        let fixture = BudgetStoreFixture(startsWithStructure: false)
        defer { fixture.store.reset() }
        fixture.store.prepare(workspace: BudgetStoreFixture.structure().workspace)
        fixture.store.start()
        let stale = try #require(fixture.snapshotSubjects.first)
        stale.send(BudgetStoreFixture.snapshot(readyToAssign: 999))
        fixture.store.reset()
        await drainMainQueue()
        #expect(fixture.store.workspace == nil)
        #expect(!fixture.store.hasLoaded)
        #expect(fixture.store.readyToAssign == 0)

        fixture.store.prepare(workspace: BudgetStoreFixture.structure().workspace)
        fixture.store.start()
        fixture.structure.send(BudgetStoreFixture.structure())
        stale.send(BudgetStoreFixture.snapshot(readyToAssign: 999))
        await drainMainQueue()
        #expect(!fixture.store.hasLoaded)
        #expect(!fixture.store.canEdit)
        #expect(fixture.snapshotRequests.count == 2)
        fixture.snapshotSubjects.last?.send(BudgetStoreFixture.snapshot(readyToAssign: 123))
        await waitUntil { fixture.store.hasLoaded }
        #expect(fixture.store.readyToAssign == 123)
    }

    @Test
    func fullyFundedRequiresTargetsAndNoRemainingFunding() {
        #expect(BudgetTargetFundingSummary(funded: 1_000, remaining: 0, total: 1_000).isFullyFunded)
        #expect(!BudgetTargetFundingSummary(funded: 999, remaining: 1, total: 1_000).isFullyFunded)
        #expect(!BudgetTargetFundingSummary(funded: 0, remaining: 0, total: 0).isFullyFunded)
        // Surplus in one category does not cover another category's unmet target.
        #expect(
            !BudgetTargetFundingSummary(funded: 1_100, remaining: 100, total: 1_000).isFullyFunded)
    }

    @Test
    func monthlyFundingIncludesTwoThousandOverspentAfterTargetsAreFunded() {
        let targets = BudgetTargetFundingSummary(funded: 100_000, remaining: 0, total: 100_000)
        var summary = BudgetMonthlyFundingSummary(targets: targets)
        summary.includeSpending(assigned: 100_000, available: -200_000, target: targets)
        #expect(summary.targets.isFullyFunded)
        #expect(!summary.isFullyFunded)
        #expect(summary.extraRemaining == 200_000)
        #expect(summary.total == 300_000)
        #expect(summary.percentage == 33)
    }

    @Test
    func monthlyFundingProgressCombinesTargetsAndExtraSpending() {
        for (targetFunded, extraFunded, expectedProgress) in [
            (Decimal(20_000), Decimal(30_000), 0.25),
            (100_000, 0, 0.5),
            (100_000, 50_000, 0.75),
            (100_000, 100_000, 1.0),
        ] {
            let summary = BudgetMonthlyFundingSummary(
                targets: .init(
                    funded: targetFunded, remaining: 100_000 - targetFunded, total: 100_000),
                extraFunded: extraFunded, extraRemaining: 100_000 - extraFunded)
            #expect(summary.progress == expectedProgress)
            #expect(summary.percentage == Int(expectedProgress * 100))
            #expect(summary.isFullyFunded == (expectedProgress == 1))
        }
        let noTargets = BudgetMonthlyFundingSummary(
            targets: .init(funded: 0, remaining: 0, total: 0),
            extraFunded: 30_000, extraRemaining: 70_000)
        #expect(noTargets.progress == 0.3)
        #expect(
            BudgetMonthlyFundingSummary(targets: .init(funded: 0, remaining: 0, total: 0)).progress
                == 0)
    }

    @Test
    func monthlyFundingDoesNotDoubleCountTargetAndOverspending() {
        let targets = BudgetTargetFundingSummary(funded: 40_000, remaining: 60_000, total: 100_000)
        for (available, extra) in [(Decimal(-20_000), Decimal.zero), (-80_000, 20_000)] {
            var summary = BudgetMonthlyFundingSummary(targets: targets)
            summary.includeSpending(assigned: 40_000, available: available, target: targets)
            #expect(summary.extraRemaining == extra)
            #expect(summary.remaining == 60_000 + extra)
        }
    }

    @Test
    func extraSpendingProgressRetainsItsTotalAsItIsCovered() {
        let targets = BudgetTargetFundingSummary(funded: 100_000, remaining: 0, total: 100_000)
        for covered: Decimal in [0, 50_000, 200_000, 250_000] {
            var summary = BudgetMonthlyFundingSummary(targets: targets)
            summary.includeSpending(
                assigned: 100_000 + covered, available: -200_000 + covered, target: targets)
            #expect(summary.total == 300_000)
            #expect(summary.extraTotal == 200_000)
            #expect(summary.extraFunded == min(200_000, covered))
            #expect(summary.extraRemaining == max(0, 200_000 - covered))
            #expect(summary.isFullyFunded == (covered >= 200_000))
            #expect(summary.targets.isFullyFunded)
        }
    }

    @Test
    func monthlyFundingIncludesSpendingWithoutActiveTargetsAndRespectsCarryover() {
        let noTargets = BudgetTargetFundingSummary(funded: 0, remaining: 0, total: 0)
        var summary = BudgetMonthlyFundingSummary(targets: noTargets)
        summary.includeSpending(assigned: 0, available: -200_000, target: nil)
        #expect(summary.remaining == 200_000)
        #expect(summary.percentage == 0)
        #expect(!summary.isFullyFunded)
        var covered = BudgetMonthlyFundingSummary(targets: noTargets)
        covered.includeSpending(assigned: 200_000, available: 0, target: nil)
        #expect(covered.total == summary.total)
        #expect(covered.isFullyFunded)
        #expect(covered.percentage == 100)
        var carryover = BudgetMonthlyFundingSummary(targets: noTargets)
        carryover.includeSpending(assigned: 0, available: 10_000, target: nil)
        #expect(carryover.total == 0)
        #expect(!carryover.isFullyFunded)
    }

    @Test
    func monthlyFundingNeverUsesAnotherCategorySurplusToHideOverspending() {
        let targets = BudgetTargetFundingSummary(funded: 100_000, remaining: 0, total: 100_000)
        var summary = BudgetMonthlyFundingSummary(targets: targets)
        summary.includeSpending(assigned: 300_000, available: 300_000, target: targets)
        summary.includeSpending(assigned: 0, available: -200_000, target: nil)
        #expect(summary.extraRemaining == 200_000)
        #expect(summary.extraFunded == 0)
        #expect(!summary.isFullyFunded)
    }

    @Test
    func monthlyFundingPreservesExactAmountsAndNegativeTargetAssignments() {
        let targets = BudgetTargetFundingSummary(funded: -100, remaining: 1_100, total: 1_000)
        var summary = BudgetMonthlyFundingSummary(targets: targets)
        summary.includeSpending(assigned: -100, available: -1_200, target: targets)
        #expect(summary.remaining == 1_200)
        #expect(summary.extraTotal == 100)
        #expect(summary.percentage == 0)
        let exact: Decimal = 9_007_199_254_740_993
        summary.includeSpending(assigned: 0, available: -exact, target: nil)
        #expect(summary.extraRemaining == exact + 100)
    }

    @Test
    func monthlyFundingProjectsCommittedAssignmentsAndReconcilesOverspending() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        func snapshot(assigned: Int64) -> BudgetSnapshot {
            BudgetSnapshot(
                months: [
                    .init(
                        yearMonth: 202609,
                        budgetData: [
                            "groceries": .init(
                                assignedAmount: assigned, available: assigned - 300_000,
                                target: .init(
                                    targetAmount: 100_000, assignmentNeeded: 100_000,
                                    remainingToAssign: 0)),
                            "unfunded": .init(
                                available: -50_000,
                                target: .init(targetAmount: 100_000, isSnoozed: true)),
                            "archived": .init(available: -999_000),
                        ],
                        summary: .init(
                            totalTargetAmount: 100_000, totalFunded: 100_000,
                            totalRemainingToFund: 0))
                ],
                availableRange: .init(minYearMonth: 202609, maxYearMonth: 202610),
                readyToAssign: 500_000)
        }
        fixture.snapshotSubjects[0].send(snapshot(assigned: 100_000))
        await drainMainQueue()
        fixture.store.categoryFilter = .funded
        let initial = try #require(fixture.store.monthlyFundingSummary(for: 202609))
        #expect(initial.extraRemaining == 250_000)
        #expect(!initial.isFullyFunded)
        #expect(fixture.store.monthlyFundingSummary(for: 202610) == nil)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 300_000, minorUnit: 2), editorID: editor.id)
        #expect(fixture.store.monthlyFundingSummary(for: 202609) == initial)
        fixture.store.finishEditing()
        let projected = try #require(fixture.store.monthlyFundingSummary(for: 202609))
        #expect(projected.extraRemaining == 50_000)
        #expect(projected.extraFunded == 200_000)
        #expect(projected.total == initial.total)
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(snapshot(assigned: 300_000))
        await waitUntil { fixture.store.editor(for: "groceries") != nil }
        #expect(fixture.store.monthlyFundingSummary(for: 202609) == projected)
        fixture.assignmentHandler = { _ in throw BudgetSaveError.rejected }
        let nextEditor = try #require(fixture.store.editor(for: "groceries"))
        await fixture.store.save(400_000, editor: nextEditor)
        #expect(fixture.store.saveError != nil)
        #expect(fixture.store.monthlyFundingSummary(for: 202609) == projected)
    }

    @Test
    func homeBudgetShortcutsSelectCurrentMonthAndReplaceThePreviousFilter() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(
                assigned: 500, target: .init(targetAmount: 1_000, underfundedAmount: 500)))
        await drainMainQueue()
        let notices = [
            HomeNotice.readyToAssign(500, formattedAmount: "$5.00", month: 202609),
            HomeNotice.overspending(
                id: "groceries", name: "Groceries", available: -100,
                formattedAmount: "$1.00", month: 202609),
            HomeNotice.readyToAssign(-500, formattedAmount: "-$5.00", month: 202609),
        ]
        for (notice, expected) in zip(
            notices, [BudgetCategoryFilter.underfunded, .overspent, .all])
        {
            fixture.store.selectMonth(202610)
            fixture.store.categoryFilter = .noTarget
            fixture.store.selectCurrentMonth(filter: try #require(notice).budgetFilter)
            #expect(fixture.store.selectedMonth == 202609)
            #expect(fixture.store.categoryFilter == expected)
            if expected != .all {
                #expect(
                    expected.applying(to: fixture.store.groups).flatMap(\.rows).map(\.id) == [
                        "groceries"
                    ])
            }
        }
        // Reopening Home's action still replaces the filter when the month is already current.
        fixture.store.selectCurrentMonth(filter: .overspent)
        #expect(fixture.store.categoryFilter == .overspent)
        #expect(fixture.assignmentRequests.isEmpty)
        #expect(fixture.quickAssignRequests.isEmpty)
        fixture.store.reset()
        #expect(fixture.store.categoryFilter == .all)
    }

    @Test
    func resolvedHomeBudgetNoticeFallsBackToAll() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        for filter in [BudgetCategoryFilter.overspent, .underfunded] {
            fixture.store.selectCurrentMonth(filter: filter)
            #expect(fixture.store.categoryFilter == .all)
        }
    }

    @Test
    func budgetFiltersHideEmptyChoicesAndKeepOverspendingFirst() {
        let rows: [BudgetCategoryRowModel] = [
            .init(
                id: "both", name: "Both", isCreditCard: false, assigned: 100, available: -50,
                activity: -150, isPending: false, hasUnmetTarget: true,
                targetFundingStatus: .underfunded),
            .init(
                id: "funded", name: "Funded", isCreditCard: false, assigned: 300, available: 200,
                activity: -100, isPending: false, targetFundingStatus: .funded),
            .init(
                id: "snoozed", name: "Snoozed", isCreditCard: false, assigned: 0, available: 0,
                activity: 0, isPending: false, targetFundingStatus: .snoozed),
            .init(
                id: "none", name: "None", isCreditCard: false, assigned: 500, available: 500,
                activity: 0, isPending: false),
            .init(
                id: "card", name: "Credit card", isCreditCard: true, assigned: 100, available: 100,
                activity: 0, isPending: false),
        ]
        let groups = rows.enumerated().map { index, row in
            BudgetGroupModel(
                id: "group-\(index)", name: row.name, rows: [row],
                assigned: Decimal(row.assigned), available: row.available)
        }
        #expect(
            BudgetCategoryFilter.visible(in: groups)
                == [.all, .overspent, .available, .underfunded, .funded, .noTarget])
        #expect(BudgetCategoryFilter.all.count(in: groups) == 5)
        #expect(BudgetCategoryFilter.overspent.matches(rows[0]))
        #expect(BudgetCategoryFilter.underfunded.matches(rows[0]))
        #expect(!BudgetCategoryFilter.noTarget.matches(rows[2]))
        #expect(!BudgetCategoryFilter.noTarget.matches(rows[4]))
        #expect(BudgetCategoryFilter.noTarget.count(in: groups) == 1)
        #expect(BudgetCategoryFilter.noTarget.count(in: [groups[4]]) == 0)
        #expect(BudgetCategoryFilter.noTarget.applying(to: [groups[4]]).isEmpty)
        #expect(BudgetCategoryFilter.visible(in: [groups[4]]) == [.all, .available])
        #expect(BudgetCategoryFilter.noTarget.resolved(in: [groups[4]]) == .all)
        #expect(!BudgetCategoryFilter.funded.matches(rows[2]))
        #expect(
            BudgetCategoryFilter.noTarget.applying(to: groups).flatMap(\.rows).map(\.id) == ["none"]
        )
        #expect(BudgetCategoryFilter.visible(in: [groups[1]]) == [.all, .available, .funded])
        #expect(BudgetCategoryFilter.overspent.resolved(in: [groups[1]]) == .all)
        #expect(BudgetCategoryFilter.funded.resolved(in: [groups[1]]) == .funded)
        #expect(BudgetCategoryFilter.visible(in: []) == [.all])
    }

    @Test
    func availableFilterIncludesOnlyPositiveBalancesRegardlessOfTargetOrAccountType() {
        let rows: [BudgetCategoryRowModel] = [
            .init(
                id: "unassigned", name: "Carryover", isCreditCard: false,
                assigned: 0, available: 1, activity: 0, isPending: false),
            .init(
                id: "underfunded", name: "Underfunded", isCreditCard: false,
                assigned: 500, available: 300, activity: -200, isPending: true,
                hasUnmetTarget: true, targetFundingStatus: .underfunded),
            .init(
                id: "card", name: "Credit card", isCreditCard: true,
                assigned: 100, available: 100, activity: 0, isPending: false),
            .init(
                id: "empty", name: "Spent", isCreditCard: false,
                assigned: 500, available: 0, activity: -500, isPending: false,
                targetFundingStatus: .funded),
            .init(
                id: "negative", name: "Overspent", isCreditCard: false,
                assigned: 100, available: -50, activity: -150, isPending: false),
        ]
        let groups = rows.map { row in
            BudgetGroupModel(
                id: row.id, name: row.name, rows: [row],
                assigned: Decimal(row.assigned), available: row.available)
        }
        let filter = BudgetCategoryFilter.available
        let filtered = filter.applying(to: groups)
        #expect(filter.count(in: groups) == 3)
        #expect(filtered.map(\.id) == ["unassigned", "underfunded", "card"])
        #expect(BudgetTotals(groups: filtered).assigned == 600)
        #expect(BudgetTotals(groups: filtered).available == 401)
        #expect(filter.resolved(in: groups) == .available)
        #expect(filter.applying(to: groups, keepingCategoryID: "empty").count == 4)
        #expect(!BudgetCategoryFilter.visible(in: Array(groups.suffix(2))).contains(.available))
        #expect(filter.resolved(in: Array(groups.suffix(2))) == .all)
    }

    @Test
    func extraFundedFilterRequiresSpendableMoneyBeyondTheTargetAndOverspending() {
        let cases: [(String, BudgetCategoryAmounts, Decimal)] = [
            (
                "extra",
                .init(
                    assignedAmount: 25_000, available: 25_000,
                    target: .init(
                        targetAmount: 20_000, overfundedByAmount: 5_000,
                        assignmentNeeded: 20_000)), 5_000
            ),
            (
                "fully-funded",
                .init(
                    assignedAmount: 20_000, available: 20_000,
                    target: .init(targetAmount: 20_000, assignmentNeeded: 20_000)), 0
            ),
            (
                "deficit-covered",
                .init(
                    assignedAmount: 30_000, available: 20_000,
                    target: .init(targetAmount: 20_000, assignmentNeeded: 30_000)), 0
            ),
            (
                "extra-after-deficit",
                .init(
                    assignedAmount: 35_000, available: 25_000,
                    target: .init(
                        targetAmount: 20_000, overfundedByAmount: 5_000,
                        assignmentNeeded: 30_000)), 5_000
            ),
            (
                "overspent",
                .init(
                    assignedAmount: 20_000, available: -5_000, activity: -25_000,
                    target: .init(targetAmount: 20_000, assignmentNeeded: 20_000)), 0
            ),
            (
                "spent-out",
                .init(
                    assignedAmount: 25_000, available: 0, activity: -25_000,
                    target: .init(targetAmount: 20_000, assignmentNeeded: 20_000)), 0
            ),
            (
                "extra-after-spending",
                .init(
                    assignedAmount: 30_000, available: 5_000, activity: -25_000,
                    target: .init(
                        targetAmount: 20_000, overfundedByAmount: 5_000,
                        assignmentNeeded: 20_000)), 5_000
            ),
            (
                "snoozed",
                .init(
                    assignedAmount: 25_000, available: 25_000,
                    target: .init(
                        targetAmount: 20_000, isSnoozed: true,
                        overfundedByAmount: 5_000, assignmentNeeded: 20_000)), 0
            ),
            ("no-target", .init(assignedAmount: 25_000, available: 25_000), 0),
        ]
        let rows = cases.map { id, amounts, expected in
            let funding = BudgetCategoryFunding(amounts: amounts)
            let extra = funding.extraFunded(targetKind: .setAside)
            #expect(extra == expected)
            let status = funding.status(
                target: .init(categoryId: id, targetType: .setAside), month: 202609)
            if expected > 0 { #expect(status == .extraFunded(expected)) }
            return BudgetCategoryRowModel(
                id: id, name: id, isCreditCard: false, assigned: amounts.assignedAmount,
                available: Decimal(amounts.available), activity: amounts.activity, isPending: false,
                targetFundingStatus: amounts.target?.fundingStatus() ?? .noTarget,
                funding: funding, extraFunded: extra)
        }
        let groups = rows.map { row in
            BudgetGroupModel(
                id: row.id, name: row.name, rows: [row],
                assigned: Decimal(row.assigned), available: row.available)
        }
        let filter = BudgetCategoryFilter.extraFunded
        let filtered = filter.applying(to: groups)
        #expect(filter.title == "Extra funded")
        #expect(filter.count(in: groups) == 3)
        #expect(filtered.map(\.id) == ["extra", "extra-after-deficit", "extra-after-spending"])
        #expect(BudgetTotals(groups: filtered).assigned == 90_000)
        #expect(BudgetTotals(groups: filtered).available == 55_000)
        #expect(BudgetCategoryFilter.visible(in: groups).contains(.extraFunded))
        #expect(filter.resolved(in: groups) == .extraFunded)
        #expect(filter.applying(to: groups, keepingCategoryID: "fully-funded").count == 4)
        let withoutExtras = groups.filter { !filter.matches($0.rows[0]) }
        #expect(!BudgetCategoryFilter.visible(in: withoutExtras).contains(.extraFunded))
        #expect(filter.resolved(in: withoutExtras) == .all)
    }

    @Test
    func extraFundingProjectsOnlyMoneyBeyondOverspendingAndTheRequiredAssignment() {
        let deficit = BudgetCategoryAmounts(
            assignedAmount: 20_000, available: 10_000,
            target: .init(
                targetAmount: 20_000, underfundedAmount: 10_000,
                assignmentNeeded: 30_000, remainingToAssign: 10_000))
        let deficitCases: [(Int64, Decimal)] = [
            (25_000, 0), (30_000, 0), (30_001, 1), (35_000, 5_000),
        ]
        for (assigned, expected) in deficitCases {
            #expect(
                BudgetCategoryFunding(amounts: deficit, assigned: assigned)
                    .extraFunded(targetKind: .setAside) == expected)
        }
        let overspent = BudgetCategoryAmounts(
            assignedAmount: 20_000, available: -5_000, activity: -25_000,
            target: .init(targetAmount: 20_000, assignmentNeeded: 20_000, remainingToAssign: 0))
        let overspentCases: [(Int64, Decimal)] = [
            (24_000, 0), (25_000, 0), (25_001, 1), (30_000, 5_000),
        ]
        for (assigned, expected) in overspentCases {
            #expect(
                BudgetCategoryFunding(amounts: overspent, assigned: assigned)
                    .extraFunded(targetKind: .setAside) == expected)
        }
    }

    @Test
    func budgetTotalsIncludeEveryGroupAndPreserveSignedAmounts() {
        let groups: [BudgetGroupModel] = [
            .init(id: "expenses", name: "Expenses", rows: [], assigned: 10_000, available: 4_000),
            .init(id: "card", name: "Card", rows: [], assigned: 2_000, available: -5_000),
            .init(id: "empty", name: "Empty", rows: [], assigned: 0, available: 0),
        ]
        #expect(BudgetTotals(groups: groups).assigned == 12_000)
        #expect(BudgetTotals(groups: groups).available == -1_000)
        #expect(BudgetTotals(groups: []).assigned == 0)
        #expect(BudgetTotals(groups: []).available == 0)
    }

    @Test
    func budgetFiltersRecalculateGroupTotalsAndRetainTheEditingCategory() {
        let rows: [BudgetCategoryRowModel] = [
            .init(
                id: "overspent", name: "Overspent", isCreditCard: false,
                assigned: 100, available: -50, activity: -150, isPending: false),
            .init(
                id: "other", name: "Other", isCreditCard: false,
                assigned: 700, available: 600, activity: -100, isPending: false),
        ]
        let group = BudgetGroupModel(
            id: "group", name: "Group", rows: rows, assigned: 800, available: 550)
        let filtered = BudgetCategoryFilter.overspent.applying(to: [group])
        #expect(filtered.first?.rows.map(\.id) == ["overspent"])
        #expect(filtered.first?.assigned == 100)
        #expect(filtered.first?.available == -50)
        #expect(BudgetTotals(groups: filtered).assigned == 100)
        #expect(BudgetTotals(groups: filtered).available == -50)
        #expect(
            BudgetCategoryFilter.overspent.applying(to: [group], keepingCategoryID: "other")
                == [group])
    }

    @Test
    func targetStatusExcludesSnoozesAndProjectsCommittedAssignments() {
        #expect(BudgetCategoryTarget().fundingStatus() == .noTarget)
        #expect(BudgetCategoryTarget(isSnoozed: true).fundingStatus() == .snoozed)
        let underfunded = BudgetCategoryTarget(targetAmount: 10_000, underfundedAmount: 500)
        #expect(underfunded.fundingStatus(assignmentDelta: 499) == .underfunded)
        #expect(underfunded.fundingStatus(assignmentDelta: 500) == .funded)
        let overfunded = BudgetCategoryTarget(targetAmount: 1_000, overfundedByAmount: 200)
        #expect(overfunded.fundingStatus(assignmentDelta: -200) == .funded)
        #expect(overfunded.fundingStatus(assignmentDelta: -201) == .underfunded)
    }

    @Test
    func monthlyFundingUsesMonthlyNeedAndPreservesOverfundingBeforeWithdrawals() throws {
        let target = BudgetCategoryTarget(
            targetAmount: 1_200_000, assignmentNeeded: 1_000, remainingToAssign: 0)
        #expect(target.remainingFunding(assigned: 1_500, assignmentDelta: -300) == 0)
        #expect(target.remainingFunding(assigned: 1_500, assignmentDelta: -700) == 200)
        #expect(target.remainingFunding(assigned: 1_500, assignmentDelta: 100) == 0)
        #expect(
            BudgetCategoryTarget(
                targetAmount: 1_200_000, isSnoozed: true,
                assignmentNeeded: 1_000, remainingToAssign: 1_000
            ).remainingFunding(assigned: 0, assignmentDelta: 500) == nil)
        #expect(
            BudgetCategoryTarget(assignmentNeeded: 1_000, remainingToAssign: 1_000)
                .remainingFunding(assigned: 0, assignmentDelta: 500) == nil)
        #expect(
            BudgetTargetFundingSummary(funded: 999, remaining: 1, total: 1_000).percentage == 99)
        #expect(
            BudgetTargetFundingSummary(funded: -200, remaining: 1_200, total: 1_000).progress == 0)
        #expect(BudgetTargetFundingSummary(funded: 0, remaining: 0, total: 0).percentage == 100)
    }

    @Test
    func monthlyFundingDecodesExactConvexIntegersAndToleratesOlderSummaryFields() throws {
        func integer(_ value: Int64) -> String {
            var littleEndian = value.littleEndian
            return withUnsafeBytes(of: &littleEndian) { Data($0).base64EncodedString() }
        }
        let amount: Int64 = 9_007_199_254_740_993
        let json = """
            {"totalTargetAmount":{"$integer":"\(integer(amount))"},
             "totalFunded":{"$integer":"\(integer(amount - 1))"},
             "totalRemainingToFund":{"$integer":"\(integer(1))"}}
            """
        let summary = try JSONDecoder().decode(BudgetPlanSummary.self, from: Data(json.utf8))
        #expect(summary.totalTargetAmount == amount)
        #expect(summary.totalFunded == amount - 1)
        #expect(summary.totalRemainingToFund == 1)
        let targetJSON = """
            {"assignmentNeeded":{"$integer":"\(integer(amount))"},
             "remainingToAssign":{"$integer":"\(integer(1))"}}
            """
        let target = try JSONDecoder().decode(
            BudgetCategoryTarget.self, from: Data(targetJSON.utf8))
        #expect(target.assignmentNeeded == amount)
        #expect(target.remainingToAssign == 1)
        let oldJSON = """
            {"totalTargetAmount":{"$integer":"\(integer(amount))"}}
            """
        let old = try JSONDecoder().decode(BudgetPlanSummary.self, from: Data(oldJSON.utf8))
        #expect(old.totalFunded == nil)
        #expect(old.totalRemainingToFund == nil)
    }

    @Test
    func targetSummaryAndFiltersProjectSavesThenReconcileWithoutCountingTwice() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        let baseline = BudgetStoreFixture.snapshot(
            target: .init(
                targetAmount: 24_000, underfundedAmount: 1_000,
                assignmentNeeded: 2_000, remainingToAssign: 1_000),
            summary: .init(
                totalTargetAmount: 2_000, totalFunded: 1_000, totalRemainingToFund: 1_000))
        fixture.snapshotSubjects[0].send(baseline)
        await drainMainQueue()
        #expect(
            fixture.store.targetFundingSummary(for: 202609)
                == .init(funded: 1_000, remaining: 1_000, total: 2_000))
        #expect(
            fixture.store.categoryFundingSummary(categoryID: "groceries", month: 202609)
                == .init(funded: 1_000, remaining: 1_000, total: 2_000))
        #expect(fixture.store.categoryFundingSummary(categoryID: "missing", month: 202609) == nil)
        #expect(fixture.store.categoryFundingSummary(categoryID: "groceries", month: 202611) == nil)
        #expect(fixture.store.targetFundingSummary(for: 202608) == nil)
        #expect(fixture.store.targetFundingSummary(for: 202611) == nil)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 2_500, minorUnit: 2), editorID: editor.id)
        #expect(
            fixture.store.categoryFundingSummary(categoryID: "groceries", month: 202609)?.funded
                == 1_000)
        #expect(fixture.store.targetFundingSummary(for: 202609)?.funded == 1_000)
        #expect(BudgetCategoryFilter.underfunded.count(in: fixture.store.groups) == 1)
        fixture.store.finishEditing()
        #expect(
            fixture.store.categoryFundingSummary(categoryID: "groceries", month: 202609)?.funded
                == 2_000)
        #expect(
            fixture.store.targetFundingSummary(for: 202609)
                == .init(funded: 2_000, remaining: 0, total: 2_000))
        #expect(BudgetCategoryFilter.underfunded.count(in: fixture.store.groups) == 0)
        #expect(BudgetCategoryFilter.funded.count(in: fixture.store.groups) == 1)
        #expect(BudgetCategoryFilter.extraFunded.count(in: fixture.store.groups) == 1)
        #expect(fixture.store.groups.first?.rows.first?.extraFunded == 500)
        #expect(fixture.store.groups.first?.rows.first?.hasUnmetTarget == true)
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(
                assigned: 2_500,
                target: .init(
                    targetAmount: 24_000, overfundedByAmount: 500,
                    assignmentNeeded: 2_000, remainingToAssign: 0),
                summary: .init(
                    totalTargetAmount: 2_000, totalFunded: 2_000, totalRemainingToFund: 0)))
        await waitUntil { fixture.store.canEdit }
        #expect(
            fixture.store.categoryFundingSummary(categoryID: "groceries", month: 202609)?.funded
                == 2_000)
        #expect(fixture.store.targetFundingSummary(for: 202609)?.funded == 2_000)
        #expect(BudgetCategoryFilter.funded.count(in: fixture.store.groups) == 1)
        #expect(BudgetCategoryFilter.extraFunded.count(in: fixture.store.groups) == 1)
        let withdrawal = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 2_000, minorUnit: 2), editorID: withdrawal.id)
        #expect(fixture.store.groups.first?.rows.first?.extraFunded == 500)
        fixture.store.cancelEditing(editorID: withdrawal.id)
        fixture.store.selectMonth(202608)
        #expect(
            fixture.store.categoryFundingSummary(categoryID: "groceries", month: 202609)?.funded
                == 2_000)
        #expect(fixture.store.targetFundingSummary(for: 202609)?.funded == 2_000)
        fixture.store.reset()
        #expect(fixture.store.targetFundingSummary(for: 202609) == nil)
    }

    @Test
    func pagedTargetSummariesStayMonthScopedAcrossSelectionAndLiveUpdates() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        for octoberFunded: Int64 in [8_000, 9_000] {
            fixture.snapshotSubjects.last?.send(
                BudgetSnapshot(
                    months: [
                        .init(
                            yearMonth: 202609, budgetData: [:],
                            summary: .init(
                                totalTargetAmount: 10_000, totalFunded: 2_000,
                                totalRemainingToFund: 8_000)),
                        .init(
                            yearMonth: 202610, budgetData: [:],
                            summary: .init(
                                totalTargetAmount: 10_000, totalFunded: octoberFunded,
                                totalRemainingToFund: 10_000 - octoberFunded)),
                    ], availableRange: .init(minYearMonth: 202609, maxYearMonth: 202610),
                    readyToAssign: 0))
            await drainMainQueue()
            for selected in [202609, 202610, 202609, 202610] {
                fixture.store.selectMonth(selected)
                // Mounted neighbors use their own totals both before and after activation.
                #expect(fixture.store.targetFundingSummary(for: 202609)?.percentage == 20)
                #expect(
                    fixture.store.targetFundingSummary(for: 202610)?.percentage
                        == Int(octoberFunded / 100))
            }
        }
    }

    @Test
    func rejectedFundingRestoresTheAuthoritativeSummaryAndFilters() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                target: .init(
                    targetAmount: 2_000, underfundedAmount: 1_000,
                    assignmentNeeded: 2_000, remainingToAssign: 1_000),
                summary: .init(
                    totalTargetAmount: 2_000, totalFunded: 1_000, totalRemainingToFund: 1_000)))
        await drainMainQueue()
        fixture.assignmentHandler = { _ in throw BudgetSaveError.rejected }
        let editor = try #require(fixture.store.editor(for: "groceries"))
        await fixture.store.save(2_500, editor: editor)
        #expect(
            fixture.store.targetFundingSummary(for: 202609)
                == .init(funded: 1_000, remaining: 1_000, total: 2_000))
        #expect(BudgetCategoryFilter.underfunded.count(in: fixture.store.groups) == 1)
        #expect(BudgetCategoryFilter.extraFunded.count(in: fixture.store.groups) == 0)
        #expect(fixture.store.saveError != nil)
    }

    @Test func keypadDraftDoesNotInvalidateCommittedBudgetSummaries() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        let summaryChanges = Mutex(0)
        withObservationTracking {
            _ = fixture.store.readyToAssign
            _ = fixture.store.currentMonthOverspent
        } onChange: {
            summaryChanges.withLock { $0 += 1 }
        }
        fixture.store.updateCalculator(
            AmountCalculator(amount: 420, minorUnit: 2), editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == 420)
        #expect(fixture.store.groups[0].assigned == 420)
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(summaryChanges.withLock { $0 } == 0)
        #expect(fixture.assignmentRequests.isEmpty)
    }

    @Test func draftOnlyChangesTheSelectedMonthAndReconcilesWithLiveSnapshots() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        let previous = fixture.store.groups(for: 202608)
        let next = fixture.store.groups(for: 202610)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 420, minorUnit: 2), editorID: editor.id)
        #expect(fixture.store.groups(for: 202608) == previous)
        #expect(fixture.store.groups(for: 202610) == next)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 1_500))
        await drainMainQueue()
        #expect(fixture.store.groups[0].rows[0].assigned == 420)
        #expect(fixture.store.groups[0].rows[0].available == 900)
        fixture.store.cancelEditing(editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_500)
    }

    @Test
    func homeOverspendingTracksTheCurrentMonthWhileBrowsingAnotherMonth() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 200))
        await drainMainQueue()
        fixture.store.selectMonth(202608)
        #expect(fixture.store.selectedMonth == 202608)
        #expect(fixture.store.currentMonthOverspent.map(\.id) == ["groceries"])
        #expect(fixture.store.currentMonthOverspent.first?.available == -400)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 900))
        await drainMainQueue()
        #expect(fixture.store.currentMonthOverspent.isEmpty)
        fixture.store.reset()
        #expect(fixture.store.currentMonthOverspent.isEmpty)
    }

    @Test(arguments: [-4_500, 0, 12_000])
    func nonzeroOnlyPeekPolicyRespectsCompletionAndVisibility(amount: Int) {
        var peek = BudgetPeekPresentation()
        peek.finishQuickAssign(
            context: .init(
                workspaceID: "workspace", readyToAssign: 0, isEditing: false, isActive: true),
            celebratesZero: true)
        let home = BudgetPeekPresentation.Context(
            workspaceID: "workspace", readyToAssign: Decimal(amount),
            isEditing: false, isActive: true, hasUndo: true, requiresNonzeroBalance: true)
        #expect(peek.isVisible(in: home) == (amount != 0))
        peek.update(home)
        #expect(peek.isVisible == (amount != 0))
        let inactive = BudgetPeekPresentation.Context(
            workspaceID: "workspace", readyToAssign: Decimal(amount),
            isEditing: false, isActive: false, requiresNonzeroBalance: true)
        #expect(!peek.isVisible(in: inactive))
    }

    @Test
    func categoryMenusOfferOnlyActionsForTheCurrentCategoryAndMonth() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        await waitUntil { fixture.store.targets.canEdit }
        #expect(
            fixture.store.categoryMenuActions(categoryID: "groceries", month: 202609)
                == [.setTarget, .editCategory])
        #expect(fixture.store.categoryMenuActions(categoryID: "missing", month: 202609).isEmpty)
        #expect(fixture.store.categoryMenuActions(categoryID: "groceries", month: 202608).isEmpty)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                target: .init(targetAmount: 2_000, underfundedAmount: 1_000)))
        await drainMainQueue()
        #expect(
            fixture.store.categoryMenuActions(categoryID: "groceries", month: 202609)
                == [.snoozeTarget, .editTarget, .editCategory])
        let editor = try #require(fixture.store.beginEditing("groceries"))
        #expect(
            !fixture.store.categoryMenuActions(categoryID: "groceries", month: 202609).contains(
                .snoozeTarget))
        fixture.store.cancelEditing(editorID: editor.id)
        fixture.store.beginMoneyMove("groceries")
        #expect(fixture.store.categoryMenuActions(categoryID: "groceries", month: 202609).isEmpty)
    }

    @Test(arguments: [false, true])
    func targetSnoozeWritesAnExplicitStateForTheCapturedMonthOnce(wasSnoozed: Bool) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                target: .init(targetAmount: 2_000, isSnoozed: wasSnoozed)))
        await drainMainQueue()
        let key = BudgetAssignmentKey(
            workspaceID: "workspace", yearMonth: 202609, categoryID: "groceries")
        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.targetSnoozeHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        let operation = Task { await fixture.store.setTargetSnoozed(!wasSnoozed, key: key) }
        await waitUntil { response != nil }
        #expect(fixture.store.targetSnoozesInFlight.contains(key))
        await fixture.store.setTargetSnoozed(!wasSnoozed, key: key)
        #expect(fixture.targetSnoozeRequests.count == 1)
        let request = try #require(fixture.targetSnoozeRequests.first)
        #expect(request.key == key)
        #expect(request.snoozed == !wasSnoozed)
        #expect(request.arguments["yearMonth"] as? Double == 202609)
        #expect(request.arguments["workspaceId"] as? String == "workspace")
        #expect(request.arguments["categoryId"] as? String == "groceries")
        #expect(request.arguments["snoozed"] as? Bool == !wasSnoozed)
        fixture.store.selectMonth(202608)
        response?.resume(returning: .init(success: true))
        await operation.value
        #expect(fixture.store.selectedMonth == 202608)
        #expect(fixture.store.targetSnoozesInFlight.isEmpty)
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(
                target: .init(targetAmount: 2_000, isSnoozed: !wasSnoozed)))
        await drainMainQueue()
        fixture.store.selectMonth(202609)
        let action: BudgetCategoryMenuAction = wasSnoozed ? .snoozeTarget : .resumeTarget
        #expect(
            fixture.store.categoryMenuActions(categoryID: "groceries", month: 202609).contains(
                action))
        #expect(fixture.store.groups[0].rows[0].isTargetSnoozed == !wasSnoozed)
    }

    @Test
    func targetSnoozeRejectsStaleMenuActionsAndSurfacesFailures() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.reset() }
        await load(fixture)
        let key = BudgetAssignmentKey(
            workspaceID: "workspace", yearMonth: 202609, categoryID: "groceries")
        await fixture.store.setTargetSnoozed(true, key: key)
        #expect(fixture.targetSnoozeRequests.isEmpty)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(target: .init(targetAmount: 2_000)))
        await drainMainQueue()
        await fixture.store.setTargetSnoozed(
            true, key: .init(workspaceID: "other", yearMonth: 202609, categoryID: "groceries"))
        await fixture.store.setTargetSnoozed(
            true, key: .init(workspaceID: "workspace", yearMonth: 202608, categoryID: "groceries"))
        #expect(fixture.targetSnoozeRequests.isEmpty)
        fixture.targetSnoozeHandler = { _ in .init(success: false) }
        await fixture.store.setTargetSnoozed(true, key: key)
        #expect(fixture.store.targetSnoozeError != nil)
        #expect(fixture.store.targetSnoozesInFlight.isEmpty)
        #expect(!fixture.store.groups[0].rows[0].isTargetSnoozed)
    }

    @Test
    func targetSnoozeIgnoresFailuresAfterWorkspaceReset() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(target: .init(targetAmount: 2_000)))
        await drainMainQueue()
        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.targetSnoozeHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        let operation = Task {
            await fixture.store.setTargetSnoozed(
                true,
                key: .init(
                    workspaceID: "workspace", yearMonth: 202609, categoryID: "groceries"))
        }
        await waitUntil { response != nil }
        fixture.store.reset()
        response?.resume(throwing: BudgetTestError.unavailable)
        await operation.value
        #expect(fixture.store.targetSnoozeError == nil)
        #expect(fixture.store.targetSnoozesInFlight.isEmpty)
    }

    @Test
    func categoryAssignmentLabelExplainsTheExactFundingAction() {
        let cases: [(BudgetCategoryAmounts, Decimal, String)] = [
            (
                .init(target: .init(targetAmount: 5_000, underfundedAmount: 500)),
                500, "Assign $5.00 to hit target"
            ),
            (.init(available: -700), 700, "Assign $7.00 to cover overspending"),
            (
                .init(available: -700, target: .init(targetAmount: 500, underfundedAmount: 200)),
                700, "Assign $7.00 to cover overspending"
            ),
            (
                .init(available: -200, target: .init(targetAmount: 1_000, underfundedAmount: 700)),
                700, "Assign $7.00 to hit target"
            ),
            (
                .init(
                    assignedAmount: 1_000, available: -700,
                    target: .init(
                        targetAmount: 1_000, underfundedAmount: 700,
                        assignmentNeeded: 1_000, remainingToAssign: 0, fundedRatio: 1)),
                700, "Assign $7.00 to cover overspending"
            ),
            (
                .init(available: -700, target: .init(targetAmount: 1_000)),
                700, "Assign $7.00 to cover overspending"
            ),
            (.init(target: .init(targetAmount: 1_000)), 0, "Fully funded"),
            (.init(available: 300, target: .init(targetAmount: 200)), 0, "Fully funded"),
            (.init(available: 300), 0, "Set a target"),
        ]
        for (amounts, expectedAmount, expectedTitle) in cases {
            let action = BudgetCategoryAssignment(amounts: amounts)
            #expect(action.amount == expectedAmount)
            #expect(action.isEnabled == (expectedTitle != "Fully funded"))
            #expect(
                action.title(
                    currencyCode: "USD", minorUnit: 2,
                    locale: Locale(identifier: "en_US")) == expectedTitle)
        }
        let yen = BudgetCategoryAssignment(amounts: .init(available: -700))
        #expect(
            yen.title(
                currencyCode: "JPY", minorUnit: 0,
                locale: Locale(identifier: "en_US")) == "Assign ¥700 to cover overspending")
        #expect(
            BudgetCategoryAssignment(amounts: .init(available: Int64.min)).amount
                == -Decimal(Int64.min))
    }

    @Test(arguments: [nil, Int64(100), Int64(400)])
    func categoryQuickAssignCoversSpendingEvenWithoutATarget(targetNeed: Int64?) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                assigned: 200,
                target: targetNeed.map { .init(targetAmount: 200, underfundedAmount: $0) }))
        await drainMainQueue()
        let editor = try #require(fixture.store.beginEditing("groceries"))
        let action = fixture.store.categoryAssignment(for: editor)
        #expect(action.purpose == .spending)
        #expect(action.amount == 400)
        #expect(fixture.store.prepareTargetAssignment(editorID: editor.id))
        fixture.store.finishEditing()
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.store.groups[0].rows[0].available == 0)
        #expect(fixture.store.readyToAssign == 7_600)
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].assignedAmount == 600)
    }

    @Test(arguments: [Int64(0), Int64(100), Int64(-100)])
    func quickAssignOpensForEveryReadyToAssignBalance(balance: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(readyToAssign: balance))
        await drainMainQueue()
        fixture.store.beginQuickAssign()
        let session = try #require(fixture.store.quickAssign)
        #expect(session.phase == .reviewing)
        #expect(session.option == (balance < 0 ? .reduceOverfunding : .underfunded))
        #expect(fixture.quickAssignRequests.isEmpty)
    }

    @Test
    func quickAssignOpensFromTheKeypadWhileItsSaveReconciles() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2),
            editorID: editor.id)
        fixture.store.beginQuickAssign()
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.store.quickAssign != nil)
        #expect(!fixture.store.canQuickAssign)
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        await fixture.store.applyQuickAssign()
        #expect(fixture.quickAssignRequests.isEmpty)
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(assigned: 1_500, readyToAssign: 7_500))
        await waitUntil { fixture.store.canQuickAssign }
        #expect(fixture.assignmentRequests.count == 1)
        #expect(
            fixture.store.quickAssign?.plan == fixture.store.quickAssignPlan(for: .zeroAssigned))
    }

    @Test(arguments: [Int64(8_000), Int64(100), Int64(0)])
    func targetAssignmentFillsOnlyTheRemainingNeedAndSavesOnClose(readyToAssign: Int64) async throws
    {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                readyToAssign: readyToAssign,
                target: .init(targetAmount: 5_000, underfundedAmount: 500)))
        await drainMainQueue()
        let editor = try #require(fixture.store.beginEditing("groceries"))
        #expect(fixture.store.hasTarget(for: editor))
        #expect(fixture.store.prepareTargetAssignment(editorID: editor.id))
        #expect(fixture.store.assignmentCalculator?.amount == 1_500)
        #expect(fixture.assignmentRequests.isEmpty)
        fixture.store.finishEditing()
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.store.readyToAssign == Decimal(readyToAssign - 500))
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].assignedAmount == 1_500)
        #expect(fixture.assignmentRequests[0].key.yearMonth == 202609)
        #expect(!fixture.store.prepareTargetAssignment(editorID: editor.id))
        fixture.store.finishEditing()
        #expect(fixture.assignmentRequests.count == 1)
    }

    @Test(arguments: [Int64(1_200), Int64(700)])
    func targetAssignmentUsesLiveFundingAndReplacesTheKeypadDraft(assigned: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 9_000, minorUnit: 2), editorID: editor.id)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                assigned: assigned, readyToAssign: 9_000 - assigned,
                target: .init(targetAmount: 5_000, underfundedAmount: 300)))
        await drainMainQueue()
        #expect(fixture.store.prepareTargetAssignment(editorID: editor.id))
        #expect(fixture.store.assignmentCalculator?.amount == assigned + 300)
        #expect(fixture.store.hasAssignmentChanges)
        fixture.store.finishEditing()
        #expect(fixture.store.readyToAssign == Decimal(8_700 - assigned))
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].assignedAmount == assigned + 300)
    }

    @Test(arguments: [nil, BudgetCategoryTarget()] as [BudgetCategoryTarget?])
    func missingTargetLeavesTheEditorAndDraftUntouched(target: BudgetCategoryTarget?) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(target: target))
        await drainMainQueue()
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_234, minorUnit: 2), editorID: editor.id)
        #expect(!fixture.store.hasTarget(for: editor))
        #expect(!fixture.store.prepareTargetAssignment(editorID: editor.id))
        #expect(fixture.store.assignmentEditor?.id == editor.id)
        #expect(fixture.store.assignmentCalculator?.amount == 1_234)
        #expect(fixture.assignmentRequests.isEmpty)
        fixture.store.cancelEditing(editorID: editor.id)
    }

    @Test(arguments: [Int64(0), Int64(-500)])
    func fundedTargetsStayDisabledWithoutChangingTheDraft(underfunded: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                target: .init(targetAmount: 500, underfundedAmount: underfunded)))
        await drainMainQueue()
        let editor = try #require(fixture.store.beginEditing("groceries"))
        #expect(fixture.store.hasTarget(for: editor))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 123, minorUnit: 2), editorID: editor.id)
        #expect(!fixture.store.categoryAssignment(for: editor).isEnabled)
        #expect(!fixture.store.prepareTargetAssignment(editorID: editor.id))
        #expect(fixture.store.assignmentEditor?.id == editor.id)
        #expect(fixture.store.assignmentCalculator?.amount == 123)
        fixture.store.cancelEditing(editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_000)
        #expect(fixture.assignmentRequests.isEmpty)
    }

    @Test
    func targetAssignmentRejectsStaleSessionsAndOverflow() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let oldEditor = try #require(fixture.store.beginEditing("groceries"))
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                target: .init(targetAmount: Int64.max, underfundedAmount: Int64.max)))
        await drainMainQueue()
        #expect(!fixture.store.prepareTargetAssignment(editorID: oldEditor.id))
        #expect(!fixture.store.prepareTargetAssignment(editorID: editor.id))
        #expect(fixture.store.assignmentCalculator?.amount == 1_000)
        #expect(fixture.store.assignmentEditor?.id == editor.id)
        #expect(fixture.store.saveError != nil)
        #expect(fixture.assignmentRequests.isEmpty)
    }

    @Test(arguments: [CGFloat(0), CGFloat(1_200)])
    func assignmentVisibilityUsesContentCoordinatesAndClearsThePeek(offset: CGFloat) throws {
        let target = CGRect(x: 120, y: offset + 480, width: 96, height: 44)
        let viewport = CGRect(x: 0, y: offset, width: 390, height: 300)
        let result = try #require(
            BudgetAssignmentVisibility.offset(
                target: target, viewport: viewport, contentHeight: 4_000))
        #expect(result == offset + 258)
        #expect(target.maxY - result == viewport.height - 34)
    }

    @Test
    func assignmentsAlreadyInsideTheViewportKeepTheirPosition() {
        let viewport = CGRect(x: 0, y: 120, width: 390, height: 300)
        for y: CGFloat in [120, 121, 125, 132, 200, 330, 342] {
            #expect(
                BudgetAssignmentVisibility.offset(
                    target: CGRect(x: 120, y: y, width: 96, height: 44),
                    viewport: viewport, contentHeight: 1_000) == nil)
        }
    }

    @Test(arguments: [CGFloat(350), CGFloat(364), CGFloat(370), CGFloat(376)])
    func assignmentsInsideTheCurvedBottomEdgeGetExtraClearance(y: CGFloat) throws {
        let target = CGRect(x: 120, y: y, width: 96, height: 44)
        let viewport = CGRect(x: 0, y: 120, width: 390, height: 300)
        #expect(target.maxY <= viewport.maxY)
        let result = try #require(
            BudgetAssignmentVisibility.offset(
                target: target, viewport: viewport, contentHeight: 1_000))
        #expect(result > viewport.minY)
        #expect(target.maxY - result == viewport.height - 34)
    }

    @Test
    func selectingAnAssignmentAboveTheViewportDoesNotScrollBackward() {
        #expect(
            BudgetAssignmentVisibility.offset(
                target: CGRect(x: 120, y: 100, width: 96, height: 44),
                viewport: CGRect(x: 0, y: 120, width: 390, height: 300),
                contentHeight: 1_000) == nil)
    }

    @Test
    func finalAssignmentUsesTheRealScrollRangeWithoutTemporaryPadding() throws {
        let target = CGRect(x: 120, y: 540, width: 96, height: 44)
        let result = try #require(
            BudgetAssignmentVisibility.offset(
                target: target, viewport: CGRect(x: 0, y: 0, width: 390, height: 300),
                contentHeight: 608))
        #expect(result == 308)
        #expect(result <= 608 - 300)
        #expect(target.maxY - result == 276)
    }

    @Test
    func assignmentVisibilityClampsAtBothEndsAndHandlesOversizedButtons() {
        #expect(
            BudgetAssignmentVisibility.offset(
                target: CGRect(x: 0, y: 0, width: 96, height: 44),
                viewport: CGRect(x: 0, y: 100, width: 390, height: 300),
                contentHeight: 600) == nil)
        #expect(
            BudgetAssignmentVisibility.offset(
                target: CGRect(x: 0, y: 580, width: 96, height: 20),
                viewport: CGRect(x: 0, y: 0, width: 390, height: 300),
                contentHeight: 600) == 300)
        #expect(
            BudgetAssignmentVisibility.offset(
                target: CGRect(x: 0, y: 100, width: 96, height: 400),
                viewport: CGRect(x: 0, y: 0, width: 390, height: 300),
                contentHeight: 600) == 100)
        #expect(
            BudgetAssignmentVisibility.offset(
                target: .zero, viewport: .zero, contentHeight: 0) == nil)
    }

    @Test(arguments: AmountCalculator.Operation.allCases)
    func inlineCalculationStartsWithTheOperatorAndFormattedZero(
        operation: AmountCalculator.Operation
    ) {
        for startingAmount: Int64 in [8_420, -8_420] {
            var calculator = AmountCalculator(
                amount: startingAmount, minorUnit: 2, allowsNegativeAmounts: true)
            #expect(budgetCalculationCaption(calculator) == nil)
            calculator.appendOperation(operation)
            #expect(budgetCalculationCaption(calculator) == operation.rawValue + "$0.00")
            #expect(calculator.amount == nil)
            #expect(calculator.error == .incompleteExpression)
            #expect(calculator.previewAmount == startingAmount)
        }
    }

    @Test
    func inlineCalculationFillsOnlyTheNewOperandAsDigitsAreTyped() {
        var calculator = AmountCalculator(amount: 8_420, minorUnit: 2)
        calculator.appendOperation(.add)
        for (digit, caption) in [(1, "+$0.01"), (2, "+$0.12"), (3, "+$1.23")] {
            calculator.appendDigit(digit)
            #expect(budgetCalculationCaption(calculator) == caption)
        }
        #expect(calculator.amount == 8_543)
        #expect(calculator.displayExpression(decimalSeparator: ".") == "84.20 + 1.23")
    }

    @Test
    func inlineCalculationTracksOperatorReplacementChainingAndBackspace() {
        var calculator = AmountCalculator(amount: 8_420, minorUnit: 2)
        calculator.appendOperation(.add)
        calculator.appendOperation(.subtract)
        #expect(budgetCalculationCaption(calculator) == "−$0.00")
        calculator.appendDigit(5)
        calculator.appendOperation(.multiply)
        #expect(budgetCalculationCaption(calculator) == "×$0.00")
        calculator.appendDigit(2)
        #expect(budgetCalculationCaption(calculator) == "×$0.02")
        calculator.deleteLast()
        #expect(budgetCalculationCaption(calculator) == "×$0.00")
        calculator.deleteLast()
        #expect(budgetCalculationCaption(calculator) == "×$0.00")
        #expect(calculator.error == .incompleteExpression)
        calculator.deleteLast()
        #expect(budgetCalculationCaption(calculator) == "−$0.05")
        calculator.resolve()
        #expect(budgetCalculationCaption(calculator) == nil)
        #expect(calculator.amount == 8_415)
    }

    @Test
    func inlineCalculationUsesTheWorkspaceCurrencyPrecisionAndLocale() {
        for (currency, minorUnit, zero, entered) in [
            ("USD", 2, "+$0.00", "+$0.05"),
            ("JPY", 0, "+¥0", "+¥5"),
            ("USD", 3, "+$0.000", "+$0.005"),
        ] {
            var calculator = AmountCalculator(amount: 500, minorUnit: minorUnit)
            calculator.appendOperation(.add)
            #expect(budgetCalculationCaption(calculator, currencyCode: currency) == zero)
            calculator.appendDigit(5)
            #expect(budgetCalculationCaption(calculator, currencyCode: currency) == entered)
        }
        var calculator = AmountCalculator(amount: 500, minorUnit: 2)
        calculator.appendOperation(.add)
        calculator.appendDigit(5)
        #expect(
            calculator.displayCurrentOperation(
                currencyCode: "EUR", locale: Locale(identifier: "de_DE")) == "+0,05 €")
    }

    private func budgetCalculationCaption(
        _ calculator: AmountCalculator, currencyCode: String = "USD"
    ) -> String? {
        calculator.displayCurrentOperation(
            currencyCode: currencyCode, locale: Locale(identifier: "en_US"))
    }

    @Test
    func monthLabelsAndOffsetsUseTheBudgetCalendarMonth() {
        #expect(BudgetMonth.title(202609, locale: Locale(identifier: "en_US")) == "September 2026")
        #expect(BudgetMonth.title(202601, locale: Locale(identifier: "en_US")) == "January 2026")
        #expect(BudgetMonth.offset(202601, by: -1) == 202512)
        #expect(BudgetMonth.offset(202612, by: 1) == 202701)
    }

    @Test
    func convexMoneyDecodesAndAssignmentRequestsKeepSignedInt64Precision() throws {
        let payload = """
            {"months":[{"yearMonth":202609,"budgetData":{"groceries":{
                "assignedAmount":\(try Int64.max.convexEncode()),
                "available":\(try Int64.min.convexEncode()),
                "target":{"targetAmount":\(try Int64.max.convexEncode()),
                    "underfundedAmount":\(try Int64(9_007_199_254_740_993).convexEncode())}}}}],
             "availableRange":{"minYearMonth":202608,"maxYearMonth":202610},
             "readyToAssign":\(try Int64(-9_007_199_254_740_993).convexEncode())}
            """
        let decoded = try JSONDecoder().decode(BudgetSnapshot.self, from: Data(payload.utf8))
        let amounts = try #require(decoded.months.first?.budgetData["groceries"])
        #expect(amounts.assignedAmount == Int64.max)
        #expect(amounts.available == Int64.min)
        #expect(amounts.activity == 0)
        #expect(amounts.target?.targetAmount == Int64.max)
        #expect(amounts.target?.underfundedAmount == 9_007_199_254_740_993)
        #expect(amounts.target?.hasUnmetTarget == true)
        #expect(decoded.readyToAssign == -9_007_199_254_740_993)

        let request = BudgetAssignmentRequest(
            key: BudgetAssignmentKey(
                workspaceID: "workspace", yearMonth: 202609, categoryID: "groceries"
            ),
            assignedAmount: Int64.min
        )
        #expect(request.arguments["workspaceId"] as? String == "workspace")
        #expect(request.arguments["categoryId"] as? String == "groceries")
        #expect(request.arguments["yearMonth"] as? Int64 == 202609)
        let encodedAmount = try #require(request.arguments["assignedAmount"] ?? nil).convexEncode()
        let roundTrip = try JSONDecoder().decode(
            ConvexInt<Int64>.self, from: Data(encodedAmount.utf8))
        #expect(roundTrip.wrappedValue == Int64.min)
    }

    @Test
    func availabilityColorsPrioritizeOverspendingThenUnmetTargets() {
        let scenarios:
            [(
                available: Decimal, target: BudgetCategoryTarget?,
                expected: BudgetAvailabilityStatus
            )] = [
                (-500, .init(targetAmount: 2_000, underfundedAmount: 1_000), .overspent),
                (-500, nil, .overspent),
                (500, .init(targetAmount: 2_000, underfundedAmount: 1_000), .underfunded),
                (0, .init(targetAmount: 2_000, underfundedAmount: 1_000), .underfunded),
                (500, .init(targetAmount: 2_000, underfundedAmount: 0), .available),
                (500, nil, .available),
                (500, .init(underfundedAmount: 1_000), .available),
                (
                    500, .init(targetAmount: 2_000, underfundedAmount: 1_000, isSnoozed: true),
                    .available
                ),
                (0, .init(targetAmount: 2_000, underfundedAmount: 0), .empty),
                (0, nil, .empty),
            ]
        for scenario in scenarios {
            let row = BudgetCategoryRowModel(
                id: "category", name: "Category", isCreditCard: false, assigned: 1_000,
                available: scenario.available, activity: 0, isPending: false,
                hasUnmetTarget: scenario.target?.hasUnmetTarget ?? false)
            #expect(row.availabilityStatus == scenario.expected)
        }
    }

    @Test
    func budgetResponsesAllowMissingNullAndSnoozedTargets() throws {
        for targetJSON in ["", ",\"target\":null", ",\"target\":{}"] {
            let payload = """
                {"assignedAmount":\(try Int64(1_000).convexEncode()),
                 "available":\(try Int64(400).convexEncode())\(targetJSON)}
                """
            let decoded = try JSONDecoder().decode(
                BudgetCategoryAmounts.self, from: Data(payload.utf8))
            #expect(decoded.target?.hasUnmetTarget != true)
        }
        let payload = """
            {"targetAmount":\(try Int64(2_000).convexEncode()),
             "underfundedAmount":\(try Int64(1_000).convexEncode()),"isSnoozed":true}
            """
        let target = try JSONDecoder().decode(BudgetCategoryTarget.self, from: Data(payload.utf8))
        #expect(target.isSnoozed)
        #expect(!target.hasUnmetTarget)
    }

    @Test
    func availableStatusRefreshesFromBackendTargetFundingAfterSaving() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(target: .init(targetAmount: 1_500, underfundedAmount: 500)))
        await waitUntil { fixture.store.groups[0].rows[0].hasUnmetTarget }
        #expect(fixture.store.groups[0].rows[0].availabilityStatus == .underfunded)

        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2, allowsNegativeAmounts: true),
            editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].availabilityStatus == .underfunded)
        fixture.store.finishEditing()
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(
                assigned: 1_500, readyToAssign: 7_500,
                target: .init(targetAmount: 1_500, underfundedAmount: 0)))
        await waitUntil { !fixture.store.groups[0].rows[0].isPending }
        #expect(fixture.store.groups[0].rows[0].availabilityStatus == .available)
        #expect(fixture.store.groups[0].rows[0].available == 900)
    }

    @Test
    func initialJoinUsesStructureOrderAndSwitchesAllLoadedMonthsWithoutSubscribingAgain() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        fixture.store.start()
        await waitUntil { fixture.snapshotSubjects.count == 1 }
        #expect(!fixture.store.hasLoaded)
        #expect(!fixture.store.canEdit)
        #expect(fixture.snapshotRequests.first?.workspaceID == "workspace")
        #expect(fixture.snapshotRequests.first?.currentMonth == 202609)

        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.canEdit }
        #expect(fixture.store.groups.map(\.id) == ["everyday", "bills"])
        #expect(fixture.store.groups[0].rows.map(\.id) == ["groceries", "unfunded"])
        #expect(fixture.store.groups[0].rows[1].assigned == 0)
        #expect(fixture.store.groups[0].assigned == 1_000)
        #expect(fixture.store.groups[1].assigned == 2_000)
        #expect(fixture.store.readyToAssign == 8_000)

        fixture.store.selectMonth(202608)
        #expect(fixture.store.groups[0].rows[0].assigned == 700)
        #expect(!fixture.store.canGoBack)
        #expect(fixture.store.canGoForward)
        fixture.store.selectMonth(202610)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_300)
        #expect(!fixture.store.canGoForward)
        #expect(fixture.store.readyToAssign == 8_000)
        fixture.store.selectMonth(202612)
        #expect(fixture.store.selectedMonth == 202610)
        #expect(fixture.snapshotRequests.count == 1)
        #expect(fixture.structureSubscriptions == 1)
    }

    @Test
    func holdingAGroupTogglesAllGroupsIncludingThoseHiddenByFiltersAndPersistsTheResult()
        async throws
    {
        let suiteName = "BudgetStoreTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let fixture = BudgetStoreFixture(defaults: defaults)
        defer { fixture.store.stop() }
        #expect(!fixture.store.areAllGroupsCollapsed)
        fixture.store.toggleAllGroups(relativeTo: "everyday")
        #expect(fixture.store.collapsedGroupIDs.isEmpty)
        await load(fixture)
        fixture.store.categoryFilter = .overspent
        fixture.store.toggleGroup("everyday")
        #expect(!fixture.store.areAllGroupsCollapsed)
        // A collapsed header expands every group, even when another group is already expanded.
        fixture.store.toggleAllGroups(relativeTo: "everyday")
        #expect(fixture.store.collapsedGroupIDs.isEmpty)
        #expect(defaults.stringArray(forKey: "budget.collapsedGroups.workspace") == [])

        // An expanded header collapses every group, even when another group is already collapsed.
        fixture.store.toggleGroup("bills")
        fixture.store.toggleAllGroups(relativeTo: "everyday")
        #expect(fixture.store.areAllGroupsCollapsed)
        #expect(fixture.store.collapsedGroupIDs == ["everyday", "bills"])
        #expect(
            defaults.stringArray(forKey: "budget.collapsedGroups.workspace") == [
                "bills", "everyday",
            ])
        fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "second"))
        await waitUntil { fixture.store.workspace?.id == "second" }
        #expect(!fixture.store.areAllGroupsCollapsed)
        fixture.structure.send(BudgetStoreFixture.structure())
        await waitUntil { fixture.store.workspace?.id == "workspace" }
        #expect(fixture.store.areAllGroupsCollapsed)
        fixture.store.toggleAllGroups(relativeTo: "everyday")
        #expect(fixture.store.collapsedGroupIDs.isEmpty)
        #expect(defaults.stringArray(forKey: "budget.collapsedGroups.workspace") == [])
    }

    @Test
    func collapsePreferencesArePersistentAndSeparateForEachWorkspace() async throws {
        let suiteName = "BudgetStoreTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let fixture = BudgetStoreFixture(defaults: defaults)
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.toggleGroup("everyday")
        fixture.store.toggleGroup("missing-group")
        #expect(fixture.store.collapsedGroupIDs == ["everyday"])
        #expect(defaults.stringArray(forKey: "budget.collapsedGroups.workspace") == ["everyday"])

        fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "second"))
        await waitUntil { fixture.store.workspace?.id == "second" }
        #expect(fixture.store.collapsedGroupIDs.isEmpty)
        fixture.store.toggleGroup("bills")
        #expect(fixture.store.collapsedGroupIDs == ["bills"])
        fixture.structure.send(BudgetStoreFixture.structure())
        await waitUntil { fixture.store.workspace?.id == "workspace" }
        #expect(fixture.store.collapsedGroupIDs == ["everyday"])

        fixture.store.reset()
        fixture.store.start()
        await waitUntil { fixture.store.workspace?.id == "workspace" }
        #expect(fixture.store.collapsedGroupIDs == ["everyday"])
    }

    @Test
    func targetSummaryCollapseSurvivesRelaunchAndStaysWorkspaceScoped() async throws {
        let suiteName = "BudgetTargetSummaryTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let fixture = BudgetStoreFixture(defaults: defaults)
        defer { fixture.store.stop() }
        await load(fixture)
        #expect(fixture.store.isTargetSummaryExpanded)
        fixture.store.setTargetSummaryExpanded(false)
        fixture.store.selectMonth(202610)
        #expect(!fixture.store.isTargetSummaryExpanded)

        fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "second"))
        await waitUntil { fixture.store.workspace?.id == "second" }
        #expect(fixture.store.isTargetSummaryExpanded)
        fixture.structure.send(BudgetStoreFixture.structure())
        await waitUntil { fixture.store.workspace?.id == "workspace" }
        #expect(!fixture.store.isTargetSummaryExpanded)

        let relaunched = BudgetStoreFixture(defaults: defaults)
        defer { relaunched.store.stop() }
        await load(relaunched)
        #expect(!relaunched.store.isTargetSummaryExpanded)
        relaunched.store.setTargetSummaryExpanded(true)
        relaunched.store.reset()
        relaunched.store.start()
        await waitUntil { relaunched.store.workspace?.id == "workspace" }
        #expect(relaunched.store.isTargetSummaryExpanded)
    }

    @Test
    func unchangedAssignmentDoesNotWriteOrBecomePending() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.editor(for: "groceries"))
        await fixture.store.save(1_000, editor: editor)
        #expect(fixture.assignmentRequests.isEmpty)
        #expect(!fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.store.saveError == nil)
    }

    @Test
    func optimisticAssignmentUpdatesRowGroupAndRTAWithoutDoubleCountingStreamConfirmation()
        async throws
    {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        var completion: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.assignmentHandler = { _ in
            try await withCheckedThrowingContinuation { completion = $0 }
        }
        await load(fixture)
        let editor = try #require(fixture.store.editor(for: "groceries"))
        let save = Task { await fixture.store.save(1_500, editor: editor) }
        await waitUntil { completion != nil }
        #expect(fixture.store.groups[0].rows[0].assigned == 1_500)
        #expect(fixture.store.groups[0].rows[0].available == 900)
        #expect(fixture.store.groups[0].assigned == 1_500)
        #expect(fixture.store.groups[0].available == 900)
        #expect(fixture.store.readyToAssign == 7_500)
        #expect(fixture.store.editor(for: "groceries") == nil)
        #expect(fixture.assignmentRequests.count == 1)
        #expect(fixture.assignmentRequests[0].assignedAmount == 1_500)

        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(assigned: 1_500, readyToAssign: 7_500, activity: -650)
        )
        await waitUntil { fixture.store.groups.first?.rows.first?.activity == -650 }
        #expect(fixture.store.groups[0].assigned == 1_500)
        #expect(fixture.store.readyToAssign == 7_500)
        completion?.resume(returning: BudgetAssignmentResult(success: true))
        await save.value
        #expect(!fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.readyToAssign == 7_500)
        #expect(fixture.store.editor(for: "groceries") != nil)
        #expect(fixture.snapshotRequests.count == 1)
    }

    @Test
    func pendingAssignmentKeepsAvailableMoveInteractiveWithProjectedBalances() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        var completion: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.assignmentHandler = { _ in
            try await withCheckedThrowingContinuation { completion = $0 }
        }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2), editorID: editor.id)
        fixture.store.finishEditing()
        await waitUntil { completion != nil }

        #expect(fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.canMoveMoney)
        fixture.store.beginMoneyMove("groceries")
        #expect(fixture.store.moneyMove?.anchorAccount?.assigned == 1_500)
        #expect(fixture.store.moneyMove?.anchorAccount?.available == 900)
        #expect(
            fixture.store.moneyMove?.account(.readyToAssign)?.available
                == fixture.store.readyToAssign)
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        #expect(fixture.store.moneyMove?.counterpart == .category("rent"))
        let sessionID = try #require(fixture.store.moneyMove?.id)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: 100, minorUnit: 2), sessionID: sessionID)
        #expect(!fixture.store.canApplyMoneyMove)

        completion?.resume(returning: .init(success: true))
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: 1_500, readyToAssign: 7_500))
        await waitUntil { fixture.store.canApplyMoneyMove }
        #expect(fixture.store.moneyMove?.counterpart == .category("rent"))
    }

    @Test(arguments: [Int64(1_500), Int64(1_700)])
    func confirmedMutationWaitsForFreshSnapshotAndAcceptsLaterFamilyEdits(
        authoritativeAmount: Int64
    )
        async throws
    {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.editor(for: "groceries"))
        await fixture.store.save(1_500, editor: editor)
        #expect(fixture.snapshotSubjects.count == 2)
        #expect(fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.groups[0].assigned == 1_500)
        #expect(fixture.store.readyToAssign == 7_500)
        #expect(fixture.store.saveError == nil)

        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 100))
        await drainMainQueue()
        #expect(fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.groups[0].assigned == 1_500)

        let readyToAssign = 9_000 - authoritativeAmount
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(
                assigned: authoritativeAmount, readyToAssign: readyToAssign
            )
        )
        await waitUntil { fixture.store.groups.first?.rows.first?.isPending == false }
        #expect(fixture.store.groups[0].rows[0].assigned == authoritativeAmount)
        #expect(fixture.store.groups[0].assigned == Decimal(authoritativeAmount))
        #expect(fixture.store.readyToAssign == Decimal(readyToAssign))
        #expect(fixture.assignmentRequests.count == 1)
    }

    @Test(arguments: [false, true])
    func uncertainMutationFailureReconcilesAppliedOrUnappliedAssignmentWithoutRepeatingWrite(
        serverAppliedWrite: Bool
    ) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        fixture.assignmentHandler = { _ in throw BudgetTestError.unavailable }
        await load(fixture)
        let editor = try #require(fixture.store.editor(for: "groceries"))
        await fixture.store.save(1_500, editor: editor)
        #expect(fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.groups[0].assigned == 1_500)
        #expect(fixture.store.readyToAssign == 7_500)
        #expect(fixture.store.saveError?.contains("confirm") == true)
        #expect(fixture.store.saveError?.contains("Refreshing") == true)
        #expect(fixture.snapshotSubjects.count == 2)

        let assigned: Int64 = serverAppliedWrite ? 1_500 : 1_000
        let readyToAssign: Int64 = serverAppliedWrite ? 7_500 : 8_000
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(assigned: assigned, readyToAssign: readyToAssign)
        )
        await waitUntil { fixture.store.groups.first?.rows.first?.isPending == false }
        #expect(fixture.store.groups[0].rows[0].assigned == assigned)
        #expect(fixture.store.readyToAssign == Decimal(readyToAssign))
        #expect(fixture.store.editor(for: "groceries") != nil)
        #expect(fixture.assignmentRequests.count == 1)
    }

    @Test
    func definiteAssignmentRejectionRollsBackEveryOptimisticTotalAndExplainsFailure() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        var completion: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.assignmentHandler = { _ in
            try await withCheckedThrowingContinuation { completion = $0 }
        }
        await load(fixture)
        let editor = try #require(fixture.store.editor(for: "groceries"))
        let save = Task { await fixture.store.save(1_500, editor: editor) }
        await waitUntil { completion != nil }
        #expect(fixture.store.readyToAssign == 7_500)
        completion?.resume(throwing: BudgetSaveError.rejected)
        await save.value
        #expect(fixture.store.groups[0].rows[0].assigned == 1_000)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        #expect(fixture.store.groups[0].assigned == 1_000)
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(!fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.saveError?.contains("Groceries") == true)
        #expect(fixture.store.saveError?.contains("try again") == true)
        #expect(fixture.snapshotRequests.count == 1)
    }

    @Test(arguments: [false, true])
    func mutationCompletionFromPreviousWorkspaceCannotChangeNewWorkspace(succeeds: Bool)
        async throws
    {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        var completion: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.assignmentHandler = { _ in
            try await withCheckedThrowingContinuation { completion = $0 }
        }
        await load(fixture)
        let editor = try #require(fixture.store.editor(for: "groceries"))
        let save = Task { await fixture.store.save(1_500, editor: editor) }
        await waitUntil { completion != nil }
        fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "second"))
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(assigned: 2_200, readyToAssign: 9_000)
        )
        await waitUntil { fixture.store.canEdit }

        if succeeds {
            completion?.resume(returning: BudgetAssignmentResult(success: true))
        } else {
            completion?.resume(throwing: BudgetSaveError.rejected)
        }
        await save.value
        #expect(fixture.store.workspace?.id == "second")
        #expect(fixture.store.groups[0].rows[0].assigned == 2_200)
        #expect(fixture.store.readyToAssign == 9_000)
        #expect(!fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.saveError == nil)
        #expect(fixture.snapshotRequests.count == 2)
    }

    @Test
    func stoppedStoreRetainsSnapshotAndRejectsQueuedOrPreviousSubscriptionValues() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        // Queue the callback before cancellation to exercise the generation guard.
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 9_999))
        fixture.store.stop()
        await drainMainQueue()
        #expect(fixture.store.groups[0].rows[0].assigned == 1_000)
        #expect(fixture.store.hasLoaded)
        #expect(fixture.store.isRefreshing)
        #expect(!fixture.store.canEdit)

        fixture.store.start()
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        #expect(fixture.store.groups[0].rows[0].assigned == 1_000)
        #expect(fixture.store.isRefreshing)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 8_888))
        fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot(assigned: 1_200))
        await waitUntil { fixture.store.canEdit }
        #expect(fixture.store.groups[0].rows[0].assigned == 1_200)
        #expect(fixture.structureSubscriptions == 2)
    }

    @Test
    func retryAfterBudgetStreamFailureCreatesFreshSubscriptionAndKeepsVisibleSnapshot() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(completion: .failure(BudgetTestError.unavailable))
        await waitUntil { fixture.store.budgetError != nil }
        #expect(!fixture.store.canEdit)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_000)

        fixture.store.retry()
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        #expect(fixture.store.isRefreshing)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_000)
        fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot(assigned: 1_400))
        await waitUntil { fixture.store.canEdit }
        #expect(fixture.store.errorMessage == nil)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_400)
    }

    @Test(arguments: [false, true])
    func monthRolloverImmediatelyUsesCachedNewMonthAndPreservesHistoricalBrowsing(
        browsingHistory: Bool
    ) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        if browsingHistory { fixture.store.selectMonth(202608) }
        fixture.now = BudgetMonth.date(202610).addingTimeInterval(43_200)
        fixture.store.refreshCurrentMonth()

        let expectedMonth = browsingHistory ? 202608 : 202610
        let expectedAssigned: Int64 = browsingHistory ? 700 : 1_300
        #expect(fixture.store.currentMonth == 202610)
        #expect(fixture.store.selectedMonth == expectedMonth)
        #expect(fixture.store.groups[0].rows[0].assigned == expectedAssigned)
        #expect(fixture.store.isRefreshing)
        #expect(fixture.store.editor(for: "groceries") == nil)
        #expect(fixture.snapshotRequests.last?.currentMonth == 202610)
        #expect(fixture.snapshotRequests.count == 2)
        fixture.store.refreshCurrentMonth()
        #expect(fixture.snapshotRequests.count == 2)
        fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.canEdit }
        let editor = try #require(fixture.store.editor(for: "groceries"))
        #expect(editor.key.yearMonth == expectedMonth)
        #expect(editor.assignedAmount == expectedAssigned)
    }

    @Test(arguments: [false, true])
    func missingInitialResponseEventuallyShowsConnectionAndRetryGuidance(structureArrives: Bool)
        async
    {
        let fixture = BudgetStoreFixture(
            responseTimeout: .milliseconds(20), startsWithStructure: structureArrives
        )
        defer { fixture.store.stop() }
        fixture.store.start()
        await waitUntil { fixture.store.errorMessage != nil }
        #expect(fixture.store.errorMessage?.contains("connection") == true)
        #expect(fixture.store.errorMessage?.contains("try again") == true)
        #expect(!fixture.store.canEdit)
        if structureArrives {
            #expect(fixture.store.budgetError != nil)
            #expect(fixture.store.structureError == nil)
        } else {
            #expect(fixture.store.structureError != nil)
            #expect(fixture.snapshotRequests.isEmpty)
        }
    }

    @Test
    func typingUpdatesAssignmentButHoldsAvailableAndRTAUntilLeaving() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        var calculator = try #require(fixture.store.assignmentCalculator)
        for digit in [9, 0, 0, 0] {
            calculator.appendDigit(digit)
            fixture.store.updateCalculator(calculator, editorID: editor.id)
            #expect(fixture.store.groups[0].rows[0].assigned == calculator.amount)
            #expect(fixture.store.groups[0].assigned == Decimal(calculator.amount ?? 0))
            #expect(fixture.store.groups[0].rows[0].available == 400)
            #expect(fixture.store.groups[0].available == 400)
            #expect(fixture.store.readyToAssign == 8_000)
        }
        #expect(fixture.store.showsReadyToAssign)
        #expect(fixture.assignmentRequests.isEmpty)
        #expect(!fixture.store.groups[0].rows[0].isPending)

        fixture.store.finishEditing()
        #expect(fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.groups[0].rows[0].available == 8_400)
        #expect(fixture.store.groups[0].available == 8_400)
        #expect(fixture.store.readyToAssign == 0)
        #expect(fixture.store.showsReadyToAssign)
        fixture.store.finishEditing()
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].assignedAmount == 9_000)
    }

    @Test(arguments: [Int64(0), Int64(1_500), Int64(-500)])
    func cancelingAnAssignmentRestoresItsOriginalAmountWithoutSaving(amount: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        let calculator = AmountCalculator(amount: amount, minorUnit: 2, allowsNegativeAmounts: true)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == amount)

        fixture.store.cancelEditing(editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == editor.assignedAmount)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(!fixture.store.groups[0].rows[0].isPending)
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.store.assignmentCalculator == nil)

        // Late keypad events and the normal close path cannot save the canceled draft.
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        fixture.store.finishEditing()
        await drainMainQueue()
        #expect(fixture.assignmentRequests.isEmpty)
    }

    @Test(arguments: AmountCalculator.Operation.allCases, [false, true])
    func arithmeticKeepsTheOriginalAssignmentUntilEqualsOrDone(
        operation: AmountCalculator.Operation, pressesEquals: Bool
    ) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        var calculator = try #require(fixture.store.assignmentCalculator)
        calculator.appendOperation(operation)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        for digit in [2, 0, 0] {
            calculator.appendDigit(digit)
            fixture.store.updateCalculator(calculator, editorID: editor.id)
            #expect(fixture.store.groups[0].rows[0].assigned == editor.assignedAmount)
            #expect(fixture.store.groups[0].assigned == Decimal(editor.assignedAmount))
            #expect(fixture.store.readyToAssign == 8_000)
            #expect(fixture.assignmentRequests.isEmpty)
        }
        let result = try #require(calculator.amount)
        if pressesEquals {
            calculator.resolve()
            fixture.store.updateCalculator(calculator, editorID: editor.id)
            #expect(fixture.store.groups[0].rows[0].assigned == result)
            #expect(fixture.assignmentRequests.isEmpty)
        }
        fixture.store.finishEditing()
        #expect(fixture.store.groups[0].rows[0].assigned == result)
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].assignedAmount == result)
    }

    @Test
    func aNewOperandHoldsTheLastResolvedAmountAcrossLiveBudgetUpdates() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        var calculator = try #require(fixture.store.assignmentCalculator)
        calculator.appendOperation(.add)
        for digit in [2, 0, 0] { calculator.appendDigit(digit) }
        calculator.resolve()
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_200)
        calculator.appendOperation(.subtract)
        calculator.appendDigit(5)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == 1_200)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(assigned: 1_100, readyToAssign: 7_900, activity: -650))
        await waitUntil { fixture.store.groups[0].rows[0].activity == -650 }
        #expect(fixture.store.groups[0].rows[0].assigned == 1_200)
        fixture.store.finishEditing()
        #expect(fixture.store.groups[0].rows[0].assigned == 1_195)
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].assignedAmount == 1_195)
    }

    @Test
    func cancelingAnOldKeypadCannotDiscardTheNewCategoryEdit() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let previous = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.cancelEditing(editorID: previous.id)
        let current = try #require(fixture.store.beginEditing("rent"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 3_000, minorUnit: 2, allowsNegativeAmounts: true),
            editorID: current.id)

        fixture.store.cancelEditing(editorID: previous.id)
        #expect(fixture.store.assignmentEditor?.id == current.id)
        #expect(fixture.store.groups[1].rows[0].assigned == 3_000)
        fixture.store.finishEditing()
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].key.categoryID == "rent")
        #expect(fixture.assignmentRequests[0].assignedAmount == 3_000)
    }

    @Test(arguments: [Int64(300), Int64(600), Int64(1_500)])
    func availableCrossesZeroOnlyAfterFinishingTheAssignment(amount: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: amount, minorUnit: 2, allowsNegativeAmounts: true),
            editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == amount)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        fixture.store.finishEditing()
        #expect(fixture.store.groups[0].rows[0].available == Decimal(amount - 600))
        await waitUntil { fixture.assignmentRequests.count == 1 }
    }

    @Test
    func zeroAndNegativeRTAStillAllowCategoryEditing() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(readyToAssign: 0))
        await waitUntil { fixture.store.readyToAssign == 0 }
        #expect(fixture.store.showsReadyToAssign)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        var calculator = try #require(fixture.store.assignmentCalculator)
        calculator.appendOperation(.add)
        calculator.appendDigit(1)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.readyToAssign == 0)
        #expect(fixture.store.showsReadyToAssign)
        calculator.clear()
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.readyToAssign == 0)
        #expect(fixture.store.showsReadyToAssign)
        fixture.store.finishEditing()
        #expect(fixture.store.readyToAssign == 1_000)
        #expect(fixture.store.showsReadyToAssign)
        await waitUntil { fixture.assignmentRequests.count == 1 }
    }

    @Test(arguments: [false, true])
    func leavingMonthOrPageReservesTheEditBeforeSubscriptionsChange(leavesPage: Bool) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2, allowsNegativeAmounts: true),
            editorID: editor.id
        )
        if leavesPage { fixture.store.stop() } else { fixture.store.selectMonth(202608) }
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.store.readyToAssign == 7_500)
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].key.yearMonth == 202609)
        #expect(fixture.assignmentRequests[0].assignedAmount == 1_500)
    }

    @Test(arguments: [202608, 202610])
    func choosingMonthSavesTheOutgoingDraftAndRequiresANewEditor(month: Int) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let original = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2), editorID: original.id)

        fixture.store.selectMonth(month)
        #expect(fixture.store.selectedMonth == month)
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.store.assignmentCalculator == nil)
        let next = try #require(fixture.store.beginEditing("groceries"))
        #expect(next.id != original.id)
        #expect(next.key.categoryID == original.key.categoryID)
        #expect(next.key.yearMonth == month)
        let expected: Int64 = month == 202608 ? 700 : 1_300
        #expect(next.assignedAmount == expected)
        #expect(fixture.store.assignmentCalculator?.amount == expected)
        fixture.store.updateCalculator(
            AmountCalculator(amount: 9_999, minorUnit: 2), editorID: original.id)
        #expect(fixture.store.assignmentCalculator?.amount == expected)
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].key.yearMonth == 202609)
        #expect(fixture.assignmentRequests[0].assignedAmount == 1_500)

        fixture.store.updateCalculator(
            AmountCalculator(amount: 900, minorUnit: 2), editorID: next.id)
        fixture.store.finishEditing()
        await waitUntil { fixture.assignmentRequests.count == 2 }
        #expect(fixture.assignmentRequests[1].key.yearMonth == month)
        #expect(fixture.assignmentRequests[1].assignedAmount == 900)
    }

    @Test(arguments: [202607, 202611])
    func choosingLockedMonthEndsEditingAfterSavingTheOutgoingMonth(month: Int) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let original = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2), editorID: original.id)
        // An unavailable month (or the same month) cannot disturb editing.
        fixture.store.selectMonth(202612)
        fixture.store.selectMonth(202609)
        #expect(fixture.store.assignmentEditor?.id == original.id)
        #expect(fixture.assignmentRequests.isEmpty)

        fixture.store.selectMonth(month)
        #expect(fixture.store.selectedMonth == month)
        #expect(fixture.store.isSelectedMonthLocked)
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.store.assignmentCalculator == nil)
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].key.yearMonth == 202609)
        #expect(fixture.assignmentRequests[0].assignedAmount == 1_500)
    }

    @Test
    func switchingCategoriesSavesOnceAndRejectsStaleKeypadUpdates() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let oldEditor = try #require(fixture.store.beginEditing("groceries"))
        let calculator = AmountCalculator(amount: 1_500, minorUnit: 2, allowsNegativeAmounts: true)
        fixture.store.updateCalculator(calculator, editorID: oldEditor.id)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        let newEditor = try #require(fixture.store.beginEditing("rent"))
        fixture.store.updateCalculator(calculator, editorID: oldEditor.id)
        #expect(fixture.store.assignmentEditor?.id == newEditor.id)
        #expect(fixture.store.groups[0].rows[0].available == 900)
        #expect(fixture.store.groups[1].rows[0].assigned == 2_000)
        #expect(fixture.store.readyToAssign == 7_500)
        await waitUntil { fixture.assignmentRequests.count == 1 }
        fixture.store.finishEditing()
        await drainMainQueue()
        #expect(fixture.assignmentRequests.count == 1)
    }

    @Test
    func liveSnapshotKeepsTypedAssignmentAndRebasesRTAWithoutDoubleCounting() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2, allowsNegativeAmounts: true),
            editorID: editor.id
        )
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(assigned: 1_100, readyToAssign: 7_900, activity: -650)
        )
        await waitUntil { fixture.store.groups[0].rows[0].activity == -650 }
        #expect(fixture.store.groups[0].rows[0].assigned == 1_500)
        #expect(fixture.store.readyToAssign == 7_900)
        fixture.store.finishEditing()
        #expect(fixture.store.readyToAssign == 7_500)
        await waitUntil { fixture.assignmentRequests.count == 1 }
    }

    @Test
    func incompleteOrInvalidCalculationKeepsLastValidEditAndSavesItOnLeaving() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        var calculator = try #require(fixture.store.assignmentCalculator)
        calculator.appendDigit(5)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        calculator.appendOperation(.divide)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.groups[0].rows[0].assigned == 5)
        calculator.appendDigit(0)
        fixture.store.updateCalculator(calculator, editorID: editor.id)
        #expect(fixture.store.assignmentCalculator?.error == .divideByZero)
        #expect(fixture.store.groups[0].rows[0].assigned == 5)
        fixture.store.finishEditing()
        await waitUntil { fixture.assignmentRequests.count == 1 }
        #expect(fixture.assignmentRequests[0].assignedAmount == 5)
    }

    @Test
    func workspaceResetDropsAnUncommittedEdit() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 1_500, minorUnit: 2, allowsNegativeAmounts: true),
            editorID: editor.id
        )
        fixture.store.reset()
        fixture.store.finishEditing()
        await drainMainQueue()
        #expect(fixture.assignmentRequests.isEmpty)
        #expect(fixture.store.assignmentCalculator == nil)
        #expect(!fixture.store.showsReadyToAssign)
    }

    @Test
    func assignmentChangesTrackTheFinalValueRatherThanWhetherDigitsWereEntered() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let editor = try #require(fixture.store.beginEditing("groceries"))
        #expect(!fixture.store.hasAssignmentChanges)
        for amount in [editor.assignedAmount, editor.assignedAmount + 100, editor.assignedAmount] {
            fixture.store.updateCalculator(
                AmountCalculator(amount: amount, minorUnit: 2), editorID: editor.id)
            #expect(fixture.store.hasAssignmentChanges == (amount != editor.assignedAmount))
        }
        fixture.store.finishEditing()
        #expect(!fixture.store.hasAssignmentChanges)
        await drainMainQueue()
        #expect(fixture.assignmentRequests.isEmpty)
    }

    @Test(arguments: [Int64(9_000), Int64(10_000), Int64(5_000)])
    func doneFreezesRTABeforeTheStorePublishesItsSavedAmount(assignment: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: assignment, minorUnit: 2), editorID: editor.id)
        #expect(fixture.store.readyToAssign == 8_000)
        let id = UUID()
        peek.beginKeypadClosing(id: id, hasChanges: fixture.store.hasAssignmentChanges)
        fixture.store.finishEditing()
        let finalRTA = 9_000 - assignment
        #expect(fixture.store.readyToAssign == Decimal(finalRTA))
        // Neither an early observer nor a late observer may release the frozen UI.
        for context in [
            peekContext(finalRTA), peekContext(finalRTA, isClosing: true),
            peekContext(finalRTA, isEditing: false),
        ] {
            peek.update(context)
            #expect(peek.displayedReadyToAssign == 8_000)
            #expect(peek.tone == .positive)
            #expect(peek.completionTaskID == nil)
        }
        peek.finishKeypadClosing(id: id, context: peekContext(finalRTA, isEditing: false))
        #expect(peek.displayedReadyToAssign == Decimal(finalRTA))
        #expect(peek.tone == (finalRTA < 0 ? .negative : .positive))
        #expect((peek.completionTaskID != nil) == (finalRTA == 0))
        await waitUntil { fixture.assignmentRequests.count == 1 }
    }

    @Test
    func closingAnUnassignmentPublishesPositiveRTAWhenStartingAtZero() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(readyToAssign: 0))
        await waitUntil { fixture.store.readyToAssign == 0 }

        var peek = BudgetPeekPresentation()
        peek.update(peekContext(0, isEditing: false))
        peek.update(peekContext(0))
        let editor = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.updateCalculator(
            AmountCalculator(amount: 0, minorUnit: 2), editorID: editor.id)

        let id = UUID()
        peek.beginKeypadClosing(id: id, hasChanges: fixture.store.hasAssignmentChanges)
        fixture.store.finishEditing()
        #expect(fixture.store.readyToAssign == 1_000)
        peek.update(peekContext(1_000, isClosing: true))
        #expect(peek.displayedReadyToAssign == 0)
        #expect(peek.tone == .neutral)

        peek.finishKeypadClosing(id: id, context: peekContext(1_000, isEditing: false))
        #expect(peek.displayedReadyToAssign == 1_000)
        #expect(peek.tone == .positive)
        #expect(peek.isVisible)
        #expect(peek.completionTaskID == nil)
        await waitUntil { fixture.assignmentRequests.count == 1 }
    }

    @Test(arguments: [Int64(0), Int64(8_000), Int64(-500)])
    func unchangedDoneClosesOnlyAZeroPeekWhenTheKeypadCloses(amount: Int64) {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(amount))
        let id = UUID()
        peek.beginKeypadClosing(id: id, hasChanges: false)
        #expect(peek.isVisible == (amount != 0))
        peek.update(peekContext(amount, isClosing: true))
        #expect(peek.isVisible == (amount != 0))
        #expect(peek.displayedReadyToAssign == Decimal(amount))
        #expect(peek.completionTaskID == nil)
        peek.finishKeypadClosing(id: id, context: peekContext(amount, isEditing: false))
        peek.update(peekContext(amount, isEditing: false))
        #expect(peek.isVisible == (amount != 0))
        #expect(!peek.showsCompletion)
        peek.beginKeypadEditing()
        peek.update(peekContext(amount))
        #expect(peek.isVisible)
    }

    @Test
    func returningToTheOriginalAmountDoesNotCelebrateTheCancelledChange() {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        peek.update(peekContext(0))
        #expect(peek.completionID != nil)
        let id = UUID()
        peek.beginKeypadClosing(id: id, hasChanges: false)
        #expect(!peek.isVisible)
        // Restoring a nonzero balance in the close transaction keeps that RTA open.
        #expect(peek.isVisible(in: peekContext(8_000, isClosing: true)))
        peek.finishKeypadClosing(id: id, context: peekContext(8_000, isEditing: false))
        #expect(peek.isVisible)
        #expect(peek.completionID == nil)
        #expect(peek.displayedReadyToAssign == 8_000)
        // A subsequent external balance change updates the persistent status.
        peek.update(peekContext(4_000, isEditing: false))
        #expect(peek.isVisible)
    }

    @Test
    func completionContentSurvivesItsEntireClosingAnimation() throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        peek.update(peekContext(0, isEditing: false))
        let id = try #require(peek.completionTaskID)
        peek.showCompletion(id: id)
        peek.beginCompletionClosing(id: id)
        // The viewport closes while its measured content and green tone remain.
        #expect(!peek.isVisible)
        #expect(peek.completionTaskID == nil)
        #expect(peek.showsCompletion)
        #expect(peek.tone == .positive)
        peek.update(peekContext(0, isEditing: false))
        #expect(!peek.isVisible(in: peekContext(0, isEditing: false)))
        #expect(peek.showsCompletion)
        #expect(peek.tone == .positive)
        peek.finishCompletionClosing(id: UUID())
        #expect(peek.showsCompletion)
        #expect(peek.tone == .positive)
        peek.finishCompletionClosing(id: id)
        #expect(!peek.showsCompletion)
        #expect(!peek.isVisible)
        #expect(peek.tone == .neutral)
    }

    @Test
    func staleClosingCallbacksCannotChangeANewKeypadOrCompletion() throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        let oldKeypad = UUID()
        peek.beginKeypadClosing(id: oldKeypad, hasChanges: true)
        peek.beginKeypadEditing()
        peek.update(peekContext(-500))
        let newKeypad = UUID()
        peek.beginKeypadClosing(id: newKeypad, hasChanges: true)
        peek.finishKeypadClosing(id: oldKeypad, context: peekContext(8_000, isEditing: false))
        #expect(peek.displayedReadyToAssign == -500)
        peek.finishKeypadClosing(id: newKeypad, context: peekContext(0, isEditing: false))
        let oldCompletion = try #require(peek.completionTaskID)
        peek.showCompletion(id: oldCompletion)
        peek.beginCompletionClosing(id: oldCompletion)
        peek.beginKeypadEditing()
        peek.update(peekContext(0))
        peek.finishCompletionClosing(id: oldCompletion)
        #expect(peek.isVisible)
        #expect(!peek.showsCompletion)
        #expect(peek.tone == .neutral)
    }

    @Test
    func reachingZeroKeepsThePeekUntilCompletionFinishes() throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        #expect(peek.isVisible)
        peek.update(peekContext(0))
        let id = try #require(peek.completionID)
        #expect(peek.isVisible)
        #expect(peek.completionTaskID == nil)
        peek.showCompletion(id: id)
        #expect(!peek.showsCompletion)

        peek.update(peekContext(0, isEditing: false))
        #expect(peek.completionTaskID == id)
        #expect(peek.isVisible)
        peek.showCompletion(id: id)
        #expect(peek.showsCompletion)
        peek.beginCompletionClosing(id: id)
        #expect(peek.showsCompletion)
        peek.finishCompletionClosing(id: id)
        #expect(!peek.isVisible)
        #expect(peek.completionTaskID == nil)
        peek.update(peekContext(0, isEditing: false))
        #expect(!peek.isVisible)
    }

    @Test(arguments: [Int64(8_000), Int64(-8_000)], [Int64(0), Int64(3_000), Int64(-2_000)])
    func rtaKeepsItsAmountAndToneUntilClosingFinishes(initial: Int64, final: Int64) throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(initial))
        let originalTone = peek.tone
        // Even multiple save/subscription updates stay hidden during the close animation.
        for amount in [Int64(0), final] {
            peek.update(peekContext(amount, isClosing: true))
            #expect(peek.displayedReadyToAssign == Decimal(initial))
            #expect(peek.tone == originalTone)
            #expect(peek.isVisible)
            #expect(peek.completionTaskID == nil)
            #expect(!peek.showsCompletion)
        }

        peek.update(peekContext(final, isEditing: false))
        #expect(peek.displayedReadyToAssign == Decimal(final))
        #expect(peek.tone == (final < 0 ? .negative : .positive))
        #expect(!peek.showsCompletion)
        if final == 0 {
            let id = try #require(peek.completionTaskID)
            #expect(peek.isVisible)
            peek.showCompletion(id: id)
            #expect(peek.showsCompletion)
            #expect(peek.tone == .positive)
            peek.beginCompletionClosing(id: id)
            #expect(peek.showsCompletion)
            peek.finishCompletionClosing(id: id)
            #expect(!peek.isVisible)
            #expect(peek.tone == .neutral)
            // Opening the keypad again shows a neutral zero after the celebration.
            peek.update(peekContext(0))
            #expect(peek.tone == .neutral)
        } else {
            #expect(peek.completionID == nil)
            #expect(peek.isVisible)
        }
    }

    @Test(arguments: [Int64(0), Int64(-500)])
    func anAlreadyZeroPeekStaysNeutralUntilTheKeypadIsFullyClosed(final: Int64) {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(0, isEditing: false))
        peek.update(peekContext(0))
        #expect(peek.tone == .neutral)
        peek.update(peekContext(final, isClosing: true))
        #expect(peek.displayedReadyToAssign == 0)
        #expect(peek.tone == .neutral)
        #expect(peek.isVisible)
        peek.update(peekContext(final, isEditing: false))
        #expect(peek.displayedReadyToAssign == Decimal(final))
        #expect(peek.tone == (final < 0 ? .negative : .neutral))
        #expect(peek.isVisible == (final != 0))
        #expect(peek.completionTaskID == nil)
    }

    @Test
    func staleKeypadCloseCannotPublishRTAForAReopenedSession() throws {
        var pad = PeekPresentation(initiallyPresented: true)
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        let previousSession = try #require(pad.sessionID)
        pad.beginClosing()
        peek.update(peekContext(0, isClosing: pad.isClosing))
        #expect(peek.displayedReadyToAssign == 8_000)

        pad.open()
        let currentSession = try #require(pad.sessionID)
        peek.update(peekContext(0, isClosing: pad.isClosing))
        #expect(peek.displayedReadyToAssign == 0)
        #expect(peek.completionTaskID == nil)

        pad.beginClosing()
        peek.update(peekContext(-500, isClosing: pad.isClosing))
        pad.finishClosing(sessionID: previousSession)
        #expect(pad.sessionID == currentSession)
        peek.update(peekContext(-500, isClosing: pad.isClosing))
        #expect(peek.displayedReadyToAssign == 0)
        #expect(peek.tone == .positive)
        #expect(peek.completionTaskID == nil)

        pad.finishClosing(sessionID: currentSession)
        peek.update(peekContext(-500, isEditing: false, isClosing: pad.isClosing))
        #expect(peek.displayedReadyToAssign == -500)
        #expect(peek.tone == .negative)
        #expect(peek.completionID == nil)
    }

    @Test
    func switchingWorkspaceDuringClosingDropsThePreviousRTADisplay() {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        peek.update(peekContext(0, isClosing: true))
        peek.update(peekContext(-500, workspaceID: "other", isClosing: true))
        #expect(peek.displayedReadyToAssign == -500)
        #expect(peek.tone == .negative)
        #expect(peek.completionTaskID == nil)
    }

    @Test
    func alreadyBalancedBudgetHidesZeroAndOnlyCelebratesNewlyReachingZero() throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(0, isEditing: false))
        #expect(!peek.isVisible)
        peek.update(peekContext(0))
        #expect(peek.isVisible)
        #expect(peek.context?.readyToAssign == 0)
        #expect(!peek.showsCompletion)
        #expect(peek.completionID == nil)
        peek.update(peekContext(0, isEditing: false))
        #expect(!peek.isVisible)
        #expect(peek.completionTaskID == nil)
        peek.update(peekContext(8_000))
        peek.update(peekContext(0, isEditing: false))
        let id = try #require(peek.completionTaskID)
        #expect(!peek.showsCompletion)
        peek.showCompletion(id: id)
        #expect(peek.showsCompletion)
        peek.beginCompletionClosing(id: id)
        peek.finishCompletionClosing(id: id)
        #expect(!peek.isVisible)

        peek.update(peekContext(0))
        #expect(peek.isVisible)
        #expect(!peek.showsCompletion)
        #expect(peek.completionID == nil)
        peek.update(peekContext(0, isActive: false))
        #expect(!peek.isVisible)
    }

    @Test
    func zeroPeekStaysVisibleOnlyDuringKeypadEditing() {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(0, isEditing: false))
        peek.update(peekContext(0))
        // Preparing defers completion while the zero RTA remains visible.
        #expect(peek.isVisible)
        let closingID = UUID()
        peek.beginKeypadClosing(id: closingID, hasChanges: false)
        #expect(!peek.isVisible)
        peek.finishKeypadClosing(id: closingID, context: peekContext(0, isEditing: false))
        #expect(!peek.isVisible)
        #expect(peek.tone == .neutral)

        peek.update(peekContext(8_000))
        #expect(peek.isVisible)
        peek.update(peekContext(0))
        #expect(peek.isVisible)
        #expect(peek.completionTaskID == nil)
    }

    @Test
    func reopeningKeypadDefersCompletionAndRejectsThePreviousTimer() throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000))
        peek.update(peekContext(0, isEditing: false))
        let oldID = try #require(peek.completionTaskID)
        peek.showCompletion(id: oldID)
        peek.update(peekContext(0))
        #expect(peek.isVisible)
        #expect(!peek.showsCompletion)
        #expect(peek.completionTaskID == nil)
        peek.update(peekContext(0, isEditing: false))
        let newID = try #require(peek.completionTaskID)
        #expect(newID != oldID)
        peek.showCompletion(id: oldID)
        peek.beginCompletionClosing(id: oldID)
        peek.finishCompletionClosing(id: oldID)
        #expect(!peek.showsCompletion)
        #expect(peek.isVisible)
        peek.showCompletion(id: newID)
        peek.beginCompletionClosing(id: newID)
        peek.finishCompletionClosing(id: newID)
        #expect(!peek.isVisible)
    }

    @Test
    func newAssignmentsRollbackAndContextChangesCancelCompletion() throws {
        for next in [
            peekContext(100, isEditing: false),
            peekContext(-100, isEditing: false),
            peekContext(0, isEditing: false, workspaceID: "other"),
            peekContext(0, isEditing: false, isActive: false),
        ] {
            var peek = BudgetPeekPresentation()
            peek.update(peekContext(8_000))
            peek.update(peekContext(0, isEditing: false))
            let id = try #require(peek.completionTaskID)
            peek.showCompletion(id: id)
            peek.update(next)
            peek.beginCompletionClosing(id: id)
            peek.finishCompletionClosing(id: id)
            #expect(!peek.showsCompletion)
            #expect(peek.completionTaskID == nil)
            #expect(peek.isVisible == (next.isActive && next.readyToAssign != 0))
        }
    }

    @Test
    func onboardingQuickAssignOnlyFundsTheChosenCategory() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetSnapshot(
                months: [
                    .init(
                        yearMonth: 202609,
                        budgetData: [
                            "groceries": .init(
                                target: .init(targetAmount: 500, underfundedAmount: 500)),
                            "rent": .init(
                                target: .init(targetAmount: 1_000, underfundedAmount: 1_000)),
                        ])
                ],
                availableRange: .init(minYearMonth: 202609, maxYearMonth: 202609),
                readyToAssign: 2_000))
        await waitUntil { fixture.store.readyToAssign == 2_000 }
        fixture.store.beginQuickAssign(categoryIDs: ["groceries"])
        fixture.store.chooseQuickAssignOption(.underfunded)
        let session = try #require(fixture.store.quickAssign)
        #expect(!session.excludedCategoryIDs.contains("groceries"))
        #expect(session.excludedCategoryIDs.contains("rent"))
        #expect(session.plan.changes.map(\.id) == ["groceries"])
        #expect(session.plan.assignedAmount == 500)
        #expect(session.plan.readyToAssignAfter == 1_500)
        #expect(fixture.quickAssignRequests.isEmpty)
    }

    @Test
    func quickAssignPreviewAndCancelNeverMutateTheBudget() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        let session = try #require(fixture.store.quickAssign)
        #expect(session.plan.returnedAmount == 3_000)
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.quickAssignRequests.isEmpty)
        #expect(fixture.store.editor(for: "groceries") == nil)
        fixture.store.endQuickAssign(id: session.id)
        #expect(fixture.store.quickAssign == nil)
        #expect(fixture.store.readyToAssign == 8_000)
    }

    @Test
    func quickAssignMonthSwitchRebuildsPreviewWithoutSaving() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        fixture.store.setQuickAssignAllowsNegativeRTA(true)
        let original = try #require(fixture.store.quickAssign)
        fixture.store.selectMonth(202608)
        let changed = try #require(fixture.store.quickAssign)
        #expect(fixture.store.selectedMonth == 202608)
        #expect(changed.yearMonth == 202608)
        #expect(changed.id != original.id)
        #expect(changed.option == .zeroAssigned)
        #expect(!changed.isChoosingOption)
        #expect(changed.allowsNegativeRTA)
        #expect(changed.plan == fixture.store.quickAssignPlan(for: .zeroAssigned))
        #expect(changed.plan != original.plan)
        #expect(fixture.quickAssignRequests.isEmpty)
        fixture.store.endQuickAssign(id: original.id)
        #expect(fixture.store.quickAssign?.id == changed.id)
        fixture.store.selectMonth(202701)
        #expect(fixture.store.selectedMonth == 202608)
        fixture.store.endQuickAssign(id: changed.id)
        #expect(fixture.store.quickAssign == nil)
    }

    @Test
    func lockedBoundaryMonthsHideCategoriesAndCannotBeEdited() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        #expect(fixture.store.browsableMonths == [202607, 202608, 202609, 202610, 202611])
        for month in [202607, 202611] {
            fixture.store.selectMonth(month)
            #expect(fixture.store.selectedMonth == month)
            #expect(fixture.store.isSelectedMonthLocked)
            #expect(fixture.store.groups.isEmpty)
            #expect(!fixture.store.canEdit)
            #expect(!fixture.store.canQuickAssign)
            #expect(fixture.store.beginEditing("groceries") == nil)
            fixture.store.beginQuickAssign()
            #expect(fixture.store.quickAssign == nil)
        }
        #expect(fixture.assignmentRequests.isEmpty)
        #expect(fixture.quickAssignRequests.isEmpty)
        fixture.store.selectMonth(202609)
        #expect(!fixture.store.isSelectedMonthLocked)
        #expect(fixture.store.canEdit)
        #expect(!fixture.store.groups.isEmpty)
        #expect(fixture.snapshotRequests.count == 1)
    }

    @Test
    func lockedMonthStaysSelectedAndUnlocksWithTheLiveRange() async {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.store.selectMonth(202611)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(readyToAssign: 8_001))
        await waitUntil { fixture.store.readyToAssign == 8_001 }
        #expect(fixture.store.selectedMonth == 202611)
        let original = BudgetStoreFixture.snapshot()
        let unlocked = BudgetSnapshot(
            months: original.months,
            availableRange: .init(minYearMonth: 202608, maxYearMonth: 202611),
            readyToAssign: original.readyToAssign)
        fixture.snapshotSubjects[0].send(unlocked)
        await waitUntil { fixture.store.availableRange?.maxYearMonth == 202611 }
        #expect(fixture.store.selectedMonth == 202611)
        #expect(!fixture.store.isSelectedMonthLocked)
        #expect(fixture.store.canEdit)
        #expect(!fixture.store.groups.isEmpty)
    }

    @Test
    func adjacentMonthPreviewsUseTheirOwnAmountsWithoutChangingSelection() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        let earlier = try #require(fixture.store.groups(for: 202608).first?.rows.first)
        #expect(earlier.assigned == 700)
        #expect(fixture.store.selectedMonth == 202609)
        #expect(fixture.store.groups.first?.rows.first?.assigned == 1_000)
        #expect(fixture.store.groups(for: 202611).isEmpty)
    }

    @Test
    func consecutiveSwipesDoNotRequestASecondProgrammaticScroll() throws {
        let paging = BudgetMonthPaging()
        paging.align(to: 202609)
        for (source, destination, offset) in [(202609, 202610, 1_200.0), (202610, 202611, 1_600.0)]
        {
            paging.beginUserScroll()
            paging.update(
                .init(offset: CGFloat(offset), width: 400), firstMonth: 202607, lastMonth: 202611)
            let request = try #require(
                paging.finishUserScroll(selectedMonth: source, workspaceID: "workspace"))
            #expect(request.sourceMonth == source)
            #expect(request.destinationMonth == destination)
            #expect(!paging.selectionNeedsAlignment(destination))
            // Geometry/idle callbacks caused by the new month's layout are not new swipes.
            #expect(
                paging.finishUserScroll(selectedMonth: destination, workspaceID: "workspace") == nil
            )
        }
        #expect(paging.selectionNeedsAlignment(202609))
    }

    @Test
    func cancelledSwipesAndProgrammaticScrollsDoNotCommitMonths() {
        let paging = BudgetMonthPaging()
        paging.align(to: 202609)
        #expect(paging.finishUserScroll(selectedMonth: 202608, workspaceID: "workspace") == nil)
        paging.beginUserScroll()
        #expect(paging.finishUserScroll(selectedMonth: 202609, workspaceID: "workspace") == nil)
        paging.beginUserScroll()
        paging.cancelSwipe()
        #expect(paging.finishUserScroll(selectedMonth: 202608, workspaceID: "other") == nil)
        #expect(paging.selectionNeedsAlignment(202608))
    }

    @Test
    func monthPagingTracksTheFingerAndClampsBoundaryBounce() async {
        let paging = BudgetMonthPaging()
        paging.align(to: 202512)
        paging.isScrolling = true
        paging.update(.init(offset: 100, width: 400), firstMonth: 202512, lastMonth: 202602)
        await flushPagingUpdates()
        #expect(
            paging.titlePosition(selectedMonth: 202512) == CGFloat(BudgetMonth.index(202512)) + 0.25
        )
        #expect(paging.nearestMonth == 202512)
        paging.update(.init(offset: 240, width: 400), firstMonth: 202512, lastMonth: 202602)
        await flushPagingUpdates()
        #expect(paging.nearestMonth == 202601)
        paging.update(.init(offset: -100, width: 400), firstMonth: 202512, lastMonth: 202602)
        await flushPagingUpdates()
        #expect(paging.nearestMonth == 202512)
        paging.update(.init(offset: 1500, width: 400), firstMonth: 202512, lastMonth: 202602)
        await flushPagingUpdates()
        #expect(paging.nearestMonth == 202602)
        paging.isScrolling = false
        #expect(paging.titlePosition(selectedMonth: 202512) == CGFloat(BudgetMonth.index(202512)))
        let previous = paging.monthPosition
        paging.update(.init(offset: 100, width: 0), firstMonth: 202512, lastMonth: 202602)
        await flushPagingUpdates()
        #expect(paging.monthPosition == previous)
    }

    @Test
    func monthBadgeTracksContinuousSwipesBeforeSelectionCommits() async throws {
        let paging = BudgetMonthPaging()
        paging.align(to: 202512)
        paging.beginUserScroll()
        paging.isScrolling = true
        for (offset, expected): (CGFloat, String?) in [
            (0, "Past month"), (240, nil), (640, "Future month"),
            (400, nil), (0, "Past month"), (800, "Future month"),
        ] {
            paging.update(.init(offset: offset, width: 400), firstMonth: 202512, lastMonth: 202602)
            await flushPagingUpdates()
            #expect(paging.browsingLabel(selectedMonth: 202512, currentMonth: 202601) == expected)
        }
        let selection = try #require(
            paging.finishUserScroll(selectedMonth: 202512, workspaceID: "workspace"))
        #expect(selection.destinationMonth == 202602)
        #expect(paging.browsingLabel(selectedMonth: 202512, currentMonth: 202601) == "Future month")
        #expect(!paging.selectionNeedsAlignment(202602))
        #expect(paging.browsingLabel(selectedMonth: 202602, currentMonth: 202601) == "Future month")
        paging.cancelSwipe()
        paging.align(to: 202601)
        #expect(paging.browsingLabel(selectedMonth: 202601, currentMonth: 202601) == nil)
    }

    @Test
    func pagingMeasurementsAreImmediateButTitleUpdatesAreDeferredAndCoalesced() async throws {
        let paging = BudgetMonthPaging()
        paging.align(to: 202609)
        paging.beginUserScroll()
        paging.isScrolling = true
        paging.update(.init(offset: 240, width: 400), firstMonth: 202609, lastMonth: 202612)
        #expect(paging.nearestMonth == 202610)
        #expect(paging.monthPosition == CGFloat(BudgetMonth.index(202609)))
        paging.update(.init(offset: 800, width: 400), firstMonth: 202609, lastMonth: 202612)
        // Idle can arrive before the queued title update. Commit the final sample.
        let selection = try #require(
            paging.finishUserScroll(selectedMonth: 202609, workspaceID: "workspace"))
        #expect(selection.destinationMonth == 202611)
        await flushPagingUpdates()
        #expect(paging.monthPosition == CGFloat(BudgetMonth.index(202611)))
    }

    @Test
    func externalAlignmentAndCancellationInvalidateQueuedTitleUpdates() async {
        let paging = BudgetMonthPaging()
        paging.align(to: 202609)
        paging.update(.init(offset: 800, width: 400), firstMonth: 202609, lastMonth: 202612)
        paging.align(to: 202610)
        await flushPagingUpdates()
        #expect(paging.monthPosition == CGFloat(BudgetMonth.index(202610)))
        #expect(paging.nearestMonth == 202610)
        paging.update(.init(offset: 800, width: 400), firstMonth: 202609, lastMonth: 202612)
        paging.cancelSwipe()
        await flushPagingUpdates()
        #expect(paging.monthPosition == CGFloat(BudgetMonth.index(202610)))
    }

    private func flushPagingUpdates() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }
    }

    @Test
    func lockedMonthGuidanceUsesTheClosestAvailableMonthAcrossYears() {
        let range = BudgetMonthRange(minYearMonth: 202601, maxYearMonth: 202612)
        #expect(BudgetMonth.unlockingMonth(202512, in: range) == 202601)
        #expect(BudgetMonth.unlockingMonth(202701, in: range) == 202612)
        #expect(BudgetMonth.unlockingMonth(202609, in: range) == nil)
        #expect(BudgetMonth.browsableMonths(in: range).count == 14)
        #expect(BudgetMonth.browsableMonths(in: range).first == 202512)
        #expect(BudgetMonth.browsableMonths(in: range).last == 202701)
    }

    @Test
    func monthBrowsingLabelDistinguishesPastAndFutureAndDisappearsToday() {
        #expect(BudgetMonth.browsingLabel(202609, currentMonth: 202609) == nil)
        #expect(BudgetMonth.browsingLabel(202608, currentMonth: 202609) == "Past month")
        #expect(BudgetMonth.browsingLabel(202610, currentMonth: 202609) == "Future month")
        #expect(BudgetMonth.browsingLabel(202512, currentMonth: 202601) == "Past month")
        #expect(BudgetMonth.browsingLabel(202701, currentMonth: 202612) == "Future month")
        #expect(BudgetMonth.browsingLabel(202610, currentMonth: 202610) == nil)
    }

    @Test
    func monthPickerUsesAbbreviationsWithoutTheYear() {
        let locale = Locale(identifier: "en_US")
        let expected = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ]
        for year in [2025, 2026, 2027] {
            for month in 1...12 {
                #expect(
                    BudgetMonth.abbreviatedTitle(year * 100 + month, locale: locale)
                        == expected[month - 1])
            }
        }
    }

    @Test
    func monthNavigationTitlesUseFullNamesOnlyInTheCurrentYear() {
        let locale = Locale(identifier: "en_US")
        #expect(
            BudgetMonth.navigationTitle(202609, currentMonth: 202609, locale: locale) == "September"
        )
        #expect(
            BudgetMonth.navigationTitle(202601, currentMonth: 202609, locale: locale) == "January")
        #expect(
            BudgetMonth.navigationTitle(202501, currentMonth: 202609, locale: locale) == "Jan 2025")
        #expect(
            BudgetMonth.navigationTitle(202701, currentMonth: 202612, locale: locale) == "Jan 2027")
        #expect(
            BudgetMonth.navigationTitle(202701, currentMonth: 202701, locale: locale) == "January")
    }

    @Test
    func quickAssignTogglesCategoriesAndOnlySavesIncludedChanges() async {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        let original = fixture.store.quickAssign?.plan
        #expect(fixture.store.quickAssign?.excludedCategoryIDs.isEmpty == true)
        fixture.store.toggleQuickAssignCategory("groceries")
        #expect(fixture.store.quickAssign?.excludedCategoryIDs == ["groceries"])
        #expect(fixture.store.quickAssign?.plan.changes.map(\.id) == ["rent"])
        fixture.store.toggleQuickAssignCategory("rent")
        #expect(!fixture.store.canApplyQuickAssign)
        #expect(fixture.store.quickAssign?.plan.previewChanges.count == 2)
        fixture.store.toggleQuickAssignCategory("groceries")
        fixture.store.toggleQuickAssignCategory("rent")
        #expect(fixture.store.quickAssign?.plan == original)
        fixture.store.toggleQuickAssignCategory("groceries")
        await fixture.store.applyQuickAssign()
        #expect(fixture.quickAssignRequests.count == 1)
        #expect(fixture.quickAssignRequests.first?.changes.map(\.id) == ["rent"])
        fixture.store.toggleQuickAssignCategory("groceries")
        #expect(fixture.store.quickAssign?.excludedCategoryIDs == ["groceries"])
    }

    @Test
    func switchingQuickAssignMethodsStartsWithAllCategoriesIncluded() async {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        fixture.store.toggleQuickAssignCategory("groceries")
        fixture.store.showQuickAssignOptions()
        fixture.store.toggleQuickAssignCategory("rent")
        #expect(fixture.store.quickAssign?.excludedCategoryIDs == ["groceries"])
        fixture.store.chooseQuickAssignOption(.underfunded)
        #expect(fixture.store.quickAssign?.excludedCategoryIDs.isEmpty == true)
    }

    @Test
    func quickAssignRequiresAnExplicitMethodSelection() async {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.store.beginQuickAssign()
        #expect(!fixture.store.canApplyQuickAssign)
        fixture.store.showQuickAssignOptions()
        #expect(fixture.store.quickAssign?.isChoosingOption == true)
        await fixture.store.applyQuickAssign()
        #expect(fixture.quickAssignRequests.isEmpty)

        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        #expect(fixture.store.canApplyQuickAssign)
        fixture.store.showQuickAssignOptions()
        #expect(!fixture.store.canApplyQuickAssign)
        fixture.store.showQuickAssignOptions()
        #expect(fixture.store.quickAssign?.isChoosingOption == true)
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        #expect(fixture.store.canApplyQuickAssign)
        if let id = fixture.store.quickAssign?.id { fixture.store.endQuickAssign(id: id) }
        #expect(!fixture.store.canApplyQuickAssign)
        #expect(fixture.quickAssignRequests.isEmpty)
    }

    @Test
    func quickAssignUsesOneAtomicBatchAndWaitsForSuccessToFinish() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.quickAssignHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        let operation = Task { await fixture.store.applyQuickAssign() }
        await waitUntil { response != nil }
        #expect(fixture.store.quickAssign?.phase == .saving)
        #expect(fixture.store.isQuickAssignPresented)
        #expect(!fixture.store.canChangeMonth)
        fixture.store.selectMonth(202608)
        #expect(fixture.store.selectedMonth == 202609)
        #expect(fixture.store.readyToAssign == 11_000)
        #expect(fixture.quickAssignRequests.count == 1)
        #expect(fixture.quickAssignRequests.first?.changes.map(\.id) == ["groceries", "rent"])
        #expect(fixture.assignmentRequests.isEmpty)
        await fixture.store.applyQuickAssign()
        #expect(fixture.quickAssignRequests.count == 1)
        let sessionID = try #require(fixture.store.quickAssign?.id)
        fixture.store.endQuickAssign(id: sessionID)
        #expect(fixture.store.quickAssign != nil)
        response?.resume(returning: .init(success: true))
        await operation.value
        #expect(fixture.store.quickAssign?.phase == .finished)
        #expect(!fixture.store.isQuickAssignPresented)
    }

    @Test
    func quickAssignRejectionRollsBackAndKeepsThePreviewForRetry() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.quickAssignHandler = { _ in .init(success: false) }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        await fixture.store.applyQuickAssign()
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.store.quickAssign?.phase == .reviewing)
        #expect(fixture.store.quickAssign?.errorMessage != nil)
        #expect(fixture.store.canQuickAssign)
        fixture.quickAssignHandler = { _ in .init(success: true) }
        await fixture.store.applyQuickAssign()
        #expect(fixture.quickAssignRequests.count == 2)
        #expect(fixture.store.quickAssign?.phase == .finished)
    }

    @Test
    func uncertainQuickAssignRefreshesBeforeOfferingAnotherSave() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.quickAssignHandler = { _ in throw BudgetTestError.unavailable }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        await fixture.store.applyQuickAssign()
        #expect(fixture.store.quickAssign?.phase == .checking)
        #expect(!fixture.store.canQuickAssign)
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.quickAssign?.phase == .reviewing }
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.store.canQuickAssign)
        #expect(fixture.store.quickAssign?.errorMessage != nil)
    }

    @Test
    func anUncertainSaveThatAppearsInTheSnapshotFinishesWithoutResubmission() async {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.quickAssignHandler = { _ in throw BudgetTestError.unavailable }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.underfunded)
        // Supply a target that exactly consumes Ready to Assign.
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(
                target: .init(targetAmount: 9_000, underfundedAmount: 8_000)))
        await waitUntil { fixture.store.quickAssign?.plan.assignedAmount == 8_000 }
        await fixture.store.applyQuickAssign()
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(
            BudgetStoreFixture.snapshot(assigned: 9_000, readyToAssign: 0))
        await waitUntil { fixture.store.quickAssign?.phase == .finished }
        #expect(fixture.store.readyToAssign == 0)
        #expect(fixture.quickAssignRequests.count == 1)
    }

    @Test
    func checkingCanBeDismissedWhilePendingAssignmentsStillReconcile() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.quickAssignHandler = { _ in throw BudgetTestError.unavailable }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        let id = try #require(fixture.store.quickAssign?.id)
        await fixture.store.applyQuickAssign()
        fixture.store.endQuickAssign(id: id)
        #expect(fixture.store.quickAssign == nil)
        #expect(!fixture.store.canQuickAssign)
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.canQuickAssign }
        #expect(fixture.store.readyToAssign == 8_000)
    }

    @Test
    func batchArgumentsPreserveBigIntAmountsAndUseANumberForTheMonth() throws {
        let request = BudgetQuickAssignRequest(
            workspaceID: "workspace", yearMonth: 202609,
            changes: [
                .init(
                    id: "groceries", name: "Groceries", groupName: "Everyday",
                    previousAssigned: 0, assigned: 9_007_199_254_740_993,
                    previousAvailable: 0)
            ])
        #expect(request.arguments["yearMonth"] as? Double == 202609)
        let encoded = try #require(request.arguments["updates"] ?? nil).convexEncode()
        struct Update: Decodable {
            let categoryId: String
            @ConvexInt var assignedAmount: Int64
        }
        let updates = try JSONDecoder().decode([Update].self, from: Data(encoded.utf8))
        #expect(updates.first?.categoryId == "groceries")
        #expect(updates.first?.assignedAmount == 9_007_199_254_740_993)
    }

    @Test
    func retryUsesANewOperationSoTheOldConfirmationStreamCannotClearIt() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.quickAssignHandler = { _ in throw BudgetTestError.unavailable }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        await fixture.store.applyQuickAssign()
        await waitUntil { fixture.snapshotSubjects.count == 2 }
        fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.quickAssign?.phase == .reviewing }
        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.quickAssignHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        let operation = Task { await fixture.store.applyQuickAssign() }
        await waitUntil { response != nil }
        fixture.snapshotSubjects[1].send(BudgetStoreFixture.snapshot())
        await drainMainQueue()
        #expect(fixture.store.groups.first?.rows.first?.isPending == true)
        #expect(fixture.store.readyToAssign == 11_000)
        #expect(fixture.store.quickAssign?.phase == .saving)
        response?.resume(returning: .init(success: true))
        await operation.value
        #expect(fixture.store.quickAssign?.phase == .finished)
    }

    @Test
    func quickAssignExcludesCreditCardsEvenIfTheirTargetsAreUnderfunded() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        let original = BudgetStoreFixture.structure()
        fixture.structure.send(
            .init(
                workspace: original.workspace,
                categoryGroups: original.categoryGroups + [
                    .init(
                        categoryGroup: .init(_id: "cards", name: "Cards", type: "credit_card"),
                        categories: [
                            .init(_id: "card", name: "Card", iconName: nil, type: "credit_card")
                        ])
                ]))
        let snapshot = BudgetStoreFixture.snapshot()
        fixture.snapshotSubjects[0].send(
            .init(
                months: snapshot.months.map { month in
                    var data = month.budgetData
                    data["card"] = .init(
                        assignedAmount: 500, available: 500,
                        target: .init(targetAmount: 1_000, underfundedAmount: 500))
                    return .init(yearMonth: month.yearMonth, budgetData: data)
                }, availableRange: snapshot.availableRange, readyToAssign: snapshot.readyToAssign))
        await waitUntil { fixture.store.groups.contains(where: { $0.id == "cards" }) }
        await drainMainQueue()
        fixture.store.beginQuickAssign()
        for option in BudgetQuickAssignOption.allCases {
            fixture.store.chooseQuickAssignOption(option)
            #expect(
                fixture.store.quickAssign?.plan.changes.contains(where: { $0.id == "card" })
                    == false)
        }
    }

    @Test
    func changingWorkspaceInvalidatesAQuickAssignResponse() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.quickAssignHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        let operation = Task { await fixture.store.applyQuickAssign() }
        await waitUntil { response != nil }
        fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "other"))
        await waitUntil { fixture.store.workspace?.id == "other" }
        response?.resume(returning: .init(success: true))
        await operation.value
        #expect(fixture.store.quickAssign == nil)
        #expect(fixture.store.readyToAssign == 0)
    }

    @Test
    func zeroRTAAndAnUnchangedKeypadCanOpenQuickAssign() async throws {
        let fixture = BudgetStoreFixture()
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(readyToAssign: 0))
        await waitUntil { fixture.store.readyToAssign == 0 }
        fixture.store.beginQuickAssign()
        #expect(fixture.store.quickAssign != nil)
        let firstID = try #require(fixture.store.quickAssign?.id)
        fixture.store.endQuickAssign(id: firstID)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.readyToAssign == 8_000 }
        _ = try #require(fixture.store.beginEditing("groceries"))
        fixture.store.beginQuickAssign()
        #expect(fixture.store.quickAssign != nil)
        #expect(fixture.store.assignmentEditor == nil)
        #expect(fixture.assignmentRequests.isEmpty)
    }

    @Test(arguments: [Int64(5_000), Int64(0), Int64(-1_000)])
    func quickAssignCompletionPreservesNonzeroReadyToAssign(remaining: Int64) {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000, isEditing: false))
        peek.update(peekContext(remaining))
        peek.finishQuickAssign(context: peekContext(remaining, isEditing: false))
        #expect(peek.isVisible == (remaining != 0))
        #expect(peek.displayedReadyToAssign == Decimal(remaining))
        #expect(peek.completionTaskID == nil)
        #expect(!peek.showsCompletion)
        // An unchanged subscription must not hide the remaining balance again.
        peek.update(peekContext(remaining, isEditing: false))
        #expect(peek.isVisible == (remaining != 0))
        peek.update(peekContext(4_000, isEditing: false))
        #expect(peek.isVisible)
    }

    @Test
    func undoRestoresTheWholeQuickAssignBatchAndPreventsDuplicateWrites() async throws {
        let fixture = BudgetStoreFixture()
        _ = try await completeQuickAssign(fixture)
        let undoID = try #require(fixture.store.quickAssignUndo?.id)
        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.quickAssignHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        let operation = Task { await fixture.store.undoQuickAssign() }
        await waitUntil { response != nil }
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.store.isUndoingQuickAssign)
        #expect(!fixture.store.canChangeMonth)
        #expect(fixture.store.beginEditing("groceries") == nil)
        let request = try #require(fixture.quickAssignRequests.last)
        #expect(request.workspaceID == "workspace")
        #expect(request.yearMonth == 202609)
        #expect(request.changes.map(\.id) == ["groceries", "rent"])
        #expect(request.changes.map(\.assigned) == [1_000, 2_000])
        await fixture.store.undoQuickAssign()
        #expect(fixture.quickAssignRequests.count == 2)
        fixture.now += 9
        fixture.store.expireQuickAssignUndo(id: undoID)
        #expect(fixture.store.isUndoingQuickAssign)
        response?.resume(returning: .init(success: true))
        await operation.value
        #expect(fixture.store.quickAssignUndo == nil)
        fixture.snapshotSubjects.last?.send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.canQuickAssign }
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.store.groups.flatMap(\.rows).first { $0.id == "rent" }?.assigned == 2_000)
    }

    @Test
    func undoIsAvailableEvenWhenQuickAssignUsedAllReadyToAssign() async throws {
        let fixture = BudgetStoreFixture()
        let baseline = BudgetStoreFixture.snapshot(
            target: .init(targetAmount: 9_000, underfundedAmount: 8_000))
        _ = try await completeQuickAssign(fixture, option: .underfunded, baseline: baseline)
        #expect(fixture.store.readyToAssign == 0)
        #expect(fixture.store.canUndoQuickAssign)
        await fixture.store.undoQuickAssign()
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.quickAssignRequests.last?.changes.map(\.assigned) == [1_000])
    }

    @Test
    func undoPreservesAssignmentIntegersAboveDoublePrecision() async throws {
        let fixture = BudgetStoreFixture()
        let amount: Int64 = 9_007_199_254_740_993
        _ = try await completeQuickAssign(
            fixture, baseline: BudgetStoreFixture.snapshot(assigned: amount))
        await fixture.store.undoQuickAssign()
        #expect(fixture.quickAssignRequests.last?.changes.first?.assigned == amount)
        #expect(fixture.store.readyToAssign == 8_000)
    }

    @Test
    func undoExpiresAfterThreeAndAHalfSecondsAndAnExpiredTapCannotWrite() async throws {
        let fixture = BudgetStoreFixture()
        _ = try await completeQuickAssign(fixture)
        let id = try #require(fixture.store.quickAssignUndo?.id)
        #expect(fixture.store.quickAssignUndoTimeRemaining == 3.5)
        fixture.now += 2
        fixture.store.expireQuickAssignUndo(id: id)
        #expect(fixture.store.canUndoQuickAssign)
        fixture.now += 1
        fixture.store.expireQuickAssignUndo(id: id)
        #expect(fixture.store.canUndoQuickAssign)
        #expect(fixture.store.quickAssignUndoTimeRemaining == 0.5)
        fixture.now += 0.5
        await fixture.store.undoQuickAssign()
        #expect(fixture.quickAssignRequests.count == 1)
        fixture.store.expireQuickAssignUndo(id: UUID())
        #expect(fixture.store.quickAssignUndo != nil)
        fixture.store.expireQuickAssignUndo(id: id)
        #expect(fixture.store.quickAssignUndo == nil)
        #expect(fixture.store.canQuickAssign)
    }

    @Test
    func undoRejectionRestoresTheCompletedBudgetAndAllowsRetry() async throws {
        let fixture = BudgetStoreFixture()
        _ = try await completeQuickAssign(fixture)
        fixture.quickAssignHandler = { _ in .init(success: false) }
        await fixture.store.undoQuickAssign()
        #expect(fixture.store.readyToAssign == 11_000)
        #expect(fixture.store.canUndoQuickAssign)
        #expect(fixture.store.saveError != nil)
        fixture.quickAssignHandler = { _ in .init(success: true) }
        await fixture.store.undoQuickAssign()
        #expect(fixture.store.quickAssignUndo == nil)
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(fixture.store.saveError == nil)
    }

    @Test(arguments: [true, false])
    func uncertainUndoReconcilesBeforeAllowingAnotherWrite(wasSaved: Bool) async throws {
        let fixture = BudgetStoreFixture()
        let completed = try await completeQuickAssign(fixture)
        fixture.quickAssignHandler = { _ in throw BudgetTestError.unavailable }
        await fixture.store.undoQuickAssign()
        #expect(fixture.store.quickAssignUndo?.phase == .checking)
        #expect(!fixture.store.canUndoQuickAssign)
        await fixture.store.undoQuickAssign()
        #expect(fixture.quickAssignRequests.count == 2)
        fixture.snapshotSubjects.last?.send(wasSaved ? BudgetStoreFixture.snapshot() : completed)
        await waitUntil { !fixture.store.isUndoingQuickAssign }
        #expect(fixture.store.readyToAssign == (wasSaved ? 8_000 : 11_000))
        #expect(fixture.store.canUndoQuickAssign == !wasSaved)
        #expect((fixture.store.quickAssignUndo == nil) == wasSaved)
    }

    @Test(arguments: [
        "month", "workspace", "edit", "quickAssign", "stop", "remoteEdit", "removedCategory",
    ])
    func newerContextOrAssignmentsInvalidateUndo(change: String) async throws {
        let fixture = BudgetStoreFixture()
        _ = try await completeQuickAssign(fixture)
        switch change {
        case "month": fixture.store.selectMonth(202608)
        case "workspace":
            fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "other"))
        case "edit": _ = fixture.store.beginEditing("groceries")
        case "quickAssign": fixture.store.beginQuickAssign()
        case "stop": fixture.store.stop()
        case "remoteEdit":
            fixture.snapshotSubjects.last?.send(BudgetStoreFixture.snapshot(assigned: 500))
        default:
            let structure = BudgetStoreFixture.structure()
            fixture.structure.send(.init(workspace: structure.workspace, categoryGroups: []))
        }
        await waitUntil { fixture.store.quickAssignUndo == nil }
        await fixture.store.undoQuickAssign()
        #expect(fixture.quickAssignRequests.count == 1)
    }

    @Test
    func unrelatedActivityCanChangeWithoutChangingWhatUndoRestores() async throws {
        let fixture = BudgetStoreFixture()
        let completed = try await completeQuickAssign(fixture)
        let updated = BudgetSnapshot(
            months: completed.months.map { month in
                var data = month.budgetData
                if month.yearMonth == 202609 {
                    data["groceries"] = .init(assignedAmount: 0, available: -800, activity: -800)
                }
                return .init(yearMonth: month.yearMonth, budgetData: data)
            }, availableRange: completed.availableRange, readyToAssign: 12_000)
        fixture.snapshotSubjects.last?.send(updated)
        await waitUntil { fixture.store.readyToAssign == 12_000 }
        #expect(fixture.store.canUndoQuickAssign)
        await fixture.store.undoQuickAssign()
        #expect(fixture.store.readyToAssign == 9_000)
        #expect(
            fixture.store.groups.flatMap(\.rows).first { $0.id == "groceries" }?.available == 200)
    }

    @Test
    func changingWorkspaceWhileUndoSavesCannotRestoreTheOldReceipt() async throws {
        let fixture = BudgetStoreFixture()
        _ = try await completeQuickAssign(fixture)
        var response: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.quickAssignHandler = { _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        let operation = Task { await fixture.store.undoQuickAssign() }
        await waitUntil { response != nil }
        fixture.structure.send(BudgetStoreFixture.structure(workspaceID: "other"))
        await waitUntil { fixture.store.workspace?.id == "other" }
        response?.resume(returning: .init(success: false))
        await operation.value
        #expect(fixture.store.quickAssignUndo == nil)
        #expect(fixture.store.readyToAssign == 0)
        #expect(fixture.store.saveError == nil)
    }

    private func completeQuickAssign(
        _ fixture: BudgetStoreFixture, option: BudgetQuickAssignOption = .zeroAssigned,
        baseline: BudgetSnapshot? = nil
    ) async throws -> BudgetSnapshot {
        let baseline = baseline ?? BudgetStoreFixture.snapshot()
        await load(fixture)
        fixture.snapshotSubjects[0].send(baseline)
        await drainMainQueue()
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(option)
        let session = try #require(fixture.store.quickAssign)
        await fixture.store.applyQuickAssign()
        let completed = BudgetSnapshot(
            months: baseline.months.map { month in
                var data = month.budgetData
                if month.yearMonth == session.yearMonth {
                    for change in session.plan.changes {
                        data[change.id] = .init(
                            assignedAmount: change.assigned,
                            available: NSDecimalNumber(decimal: change.available).int64Value,
                            activity: data[change.id]?.activity ?? 0)
                    }
                }
                return .init(yearMonth: month.yearMonth, budgetData: data)
            }, availableRange: baseline.availableRange,
            readyToAssign: NSDecimalNumber(decimal: session.plan.readyToAssignAfter).int64Value)
        // The undo receipt is kept while the batch's confirming subscription arrives.
        fixture.store.endQuickAssign(id: session.id)
        #expect(fixture.store.quickAssignUndo != nil)
        #expect(!fixture.store.canUndoQuickAssign)
        fixture.snapshotSubjects.last?.send(completed)
        await waitUntil { fixture.store.canUndoQuickAssign }
        return completed
    }

    @Test
    func underfundedPriorityReplansImmediatelyAndIsRememberedOnDevice() async throws {
        let suite = "BudgetUnderfundedOrderTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let fixture = BudgetStoreFixture(defaults: defaults)
        await load(fixture)
        let original = BudgetStoreFixture.snapshot()
        fixture.snapshotSubjects[0].send(
            .init(
                months: original.months.map { month in
                    guard month.yearMonth == 202609 else { return month }
                    return .init(
                        yearMonth: month.yearMonth,
                        budgetData: [
                            "groceries": .init(
                                target: .init(
                                    targetAmount: 3_000, underfundedAmount: 3_000,
                                    dueDate: "2026-09-01")),
                            "rent": .init(
                                target: .init(
                                    targetAmount: 1_000, underfundedAmount: 1_000,
                                    dueDate: "2026-09-15")),
                        ])
                }, availableRange: original.availableRange, readyToAssign: 1_500))
        await waitUntil { fixture.store.readyToAssign == 1_500 }
        fixture.store.beginQuickAssign()
        fixture.store.chooseQuickAssignOption(.underfunded)
        #expect(fixture.store.underfundedOrder == .dueDate)
        #expect(fixture.store.quickAssign?.plan.changes.map(\.id) == ["groceries"])
        fixture.store.setUnderfundedOrder(.smallestAmount)
        #expect(fixture.store.quickAssign?.plan.changes.map(\.id) == ["rent", "groceries"])
        #expect(fixture.store.quickAssign?.plan.changes.map(\.assigned) == [1_000, 500])
        #expect(fixture.store.readyToAssign == 1_500)
        #expect(defaults.string(forKey: BudgetUnderfundedOrder.defaultsKey) == "smallestAmount")
        fixture.store.selectMonth(202610)
        #expect(fixture.store.underfundedOrder == .smallestAmount)
        let reopened = BudgetStoreFixture(defaults: defaults)
        await load(reopened)
        reopened.store.beginQuickAssign()
        reopened.store.chooseQuickAssignOption(.underfunded)
        #expect(reopened.store.underfundedOrder == .smallestAmount)
        reopened.store.setUnderfundedOrder(.dueDate)
        #expect(BudgetStoreFixture(defaults: defaults).store.underfundedOrder == .dueDate)
    }

    @Test
    func unknownSavedPriorityFallsBackAndOtherMethodsCannotChangeIt() async throws {
        let suite = "BudgetUnderfundedOrderTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("obsolete", forKey: BudgetUnderfundedOrder.defaultsKey)
        let fixture = BudgetStoreFixture(defaults: defaults)
        await load(fixture)
        #expect(fixture.store.underfundedOrder == .dueDate)
        fixture.store.beginQuickAssign()
        fixture.store.setUnderfundedOrder(.smallestAmount)
        #expect(fixture.store.underfundedOrder == .dueDate)
        fixture.store.chooseQuickAssignOption(.zeroAssigned)
        fixture.store.setUnderfundedOrder(.smallestAmount)
        #expect(fixture.store.underfundedOrder == .dueDate)
    }

    @Test
    func targetDueDateDecodesWithoutBreakingOlderBudgetResponses() throws {
        let decoder = JSONDecoder()
        let dated = try decoder.decode(
            BudgetCategoryTarget.self, from: Data(#"{"dueDate":"2026-09-15"}"#.utf8))
        #expect(dated.dueDate == "2026-09-15")
        let undated = try decoder.decode(BudgetCategoryTarget.self, from: Data("{}".utf8))
        #expect(undated.dueDate == nil)
    }

    @Test
    func quickAssignCelebratesZeroOnTheRegularBudgetUntilUndoExpires() throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000, isEditing: false))
        peek.update(peekContext(0))
        peek.finishQuickAssign(context: peekContext(0, isEditing: false), celebratesZero: true)
        let id = try #require(peek.completionTaskID)
        #expect(peek.displayedReadyToAssign == 0)
        #expect(peek.tone == .positive)
        #expect(peek.isQuickAssignCompletion)
        #expect(peek.isVisible)
        #expect(!peek.showsCompletion)
        peek.showCompletion(id: id)
        #expect(peek.showsCompletion)
        peek.beginQuickAssignCompletionClosing(id: id)
        #expect(!peek.isVisible)
        #expect(peek.showsCompletion)
        #expect(peek.tone == .positive)
        // The success content survives until its completion is cleared.
        #expect(peek.isQuickAssignCompletion)
        peek.finishCompletionClosing(id: id)
        #expect(!peek.showsCompletion)
        #expect(!peek.isQuickAssignCompletion)
        #expect(!peek.isVisible)
        #expect(peek.tone == .neutral)
        #expect(peek.displayedReadyToAssign == 0)
    }

    @Test(arguments: [Int64(2_000), Int64(-1_000)])
    func quickAssignDoesNotCelebrateANonzeroRemainingBalance(amount: Int64) {
        var peek = BudgetPeekPresentation()
        peek.finishQuickAssign(context: peekContext(amount, isEditing: false), celebratesZero: true)
        #expect(peek.isVisible)
        #expect(peek.displayedReadyToAssign == Decimal(amount))
        #expect(!peek.isQuickAssignCompletion)
        #expect(peek.completionTaskID == nil)
    }

    @Test
    func interruptedQuickAssignCompletionCannotHideANewerResult() throws {
        var peek = BudgetPeekPresentation()
        peek.finishQuickAssign(context: peekContext(0, isEditing: false), celebratesZero: true)
        let oldID = try #require(peek.completionTaskID)
        // A receipt can disappear before the delayed message is shown.
        peek.beginQuickAssignCompletionClosing(id: oldID)
        #expect(!peek.isVisible)
        peek.finishQuickAssign(context: peekContext(0, isEditing: false), celebratesZero: true)
        let newID = try #require(peek.completionTaskID)
        peek.finishCompletionClosing(id: oldID)
        #expect(peek.isVisible)
        #expect(peek.completionTaskID == newID)
        peek.update(peekContext(3_000, isEditing: false))
        #expect(!peek.isQuickAssignCompletion)
        #expect(peek.isVisible)
        #expect(peek.displayedReadyToAssign == 3_000)
    }

    @Test
    func zeroPeekKeepsUndoVisibleUntilItExpires() {
        var peek = BudgetPeekPresentation()
        var context = peekContext(0, isEditing: false)
        context.hasUndo = true
        peek.update(context)
        #expect(peek.isVisible)
        #expect(peek.completionID == nil)
        context.hasUndo = false
        #expect(!peek.isVisible(in: context))
        peek.update(context)
        #expect(!peek.isVisible)
    }

    @Test(arguments: [Int64(0), Int64(2_000), Int64(-500)])
    func workspaceHandoffResolvesNewPeekBeforeUpdatingPresentation(amount: Int64) throws {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000, isEditing: false))
        peek.update(peekContext(0, isEditing: false))
        let completion = try #require(peek.completionID)
        peek.showCompletion(id: completion)
        let next = peekContext(amount, isEditing: false, workspaceID: "other")
        #expect(peek.isVisible(in: next) == (amount != 0))
        peek.update(next)
        #expect(peek.isVisible == (amount != 0))
        #expect(peek.completionID == nil)
    }

    @Test
    func incomingZeroKeepsCompletionVisibleBeforeContextSynchronization() {
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000, isEditing: false))
        #expect(peek.isVisible(in: peekContext(0, isEditing: false)))
        #expect(!peek.isVisible(in: peekContext(0, isEditing: false, isActive: false)))
    }

    private func peekContext(
        _ amount: Int64, isEditing: Bool = true, workspaceID: String = "workspace",
        isActive: Bool = true, isClosing: Bool = false
    ) -> BudgetPeekPresentation.Context {
        .init(
            workspaceID: workspaceID, readyToAssign: Decimal(amount),
            isEditing: isEditing, isActive: isActive, isClosing: isClosing)
    }

    @Test
    func partialCoverageContinuesWithFreshBalancesAndUndoForEachStep() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(assigned: 200, readyToAssign: 100))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        #expect(fixture.store.moneyMove?.counterpart == .readyToAssign)
        #expect(fixture.store.moneyMove?.remaining == 300)
        #expect(fixture.quickAssignRequests.isEmpty)
        #expect(fixture.store.groups[0].rows[0].available == -400)
        await fixture.store.applyMoneyMove()
        #expect(fixture.quickAssignRequests[0].changes.map(\.assigned) == [300])
        #expect(fixture.store.groups[0].rows[0].available == -300)
        #expect(fixture.store.readyToAssign == 0)
        #expect(!fixture.store.canChooseMoneyMoveAccount(.category("rent")))
        fixture.snapshotSubjects.last?.send(moneyMoveSnapshot(assigned: 300, rent: 2_000, rta: 0))
        await drainMainQueue()
        #expect(fixture.store.moneyMove?.phase == .choosing)
        #expect(fixture.store.moneyMove?.counterpart == nil)
        #expect(fixture.store.moneyMove?.coverNeed == 300)
        #expect(fixture.store.canUndoMoneyMove)
        #expect(!fixture.store.canChooseMoneyMoveAccount(.readyToAssign))
        #expect(!fixture.store.canChooseMoneyMoveAccount(.category("groceries")))
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        #expect(fixture.store.moneyMove?.amount == 300)
        #expect(fixture.store.groups[0].rows[0].available == -300)
        await fixture.store.applyMoneyMove()
        #expect(fixture.quickAssignRequests.count == 2)
        #expect(fixture.quickAssignRequests[1].changes.map(\.assigned) == [600, 1_700])
        #expect(fixture.store.groups[0].rows[0].available == 0)
        fixture.snapshotSubjects.last?.send(moneyMoveSnapshot(assigned: 600, rent: 1_700, rta: 0))
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt?.didCoverOverspending == true)
        #expect(fixture.store.canMoveMoney)
        #expect(fixture.store.canChangeMonth)
        #expect(fixture.store.canUndoMoneyMove)
        await fixture.store.undoMoneyMove()
        #expect(fixture.quickAssignRequests[2].changes.map(\.assigned) == [300, 2_000])
        #expect(fixture.store.groups[0].rows[0].available == -300)
        #expect(fixture.store.readyToAssign == 0)
        fixture.snapshotSubjects.last?.send(moneyMoveSnapshot(assigned: 300, rent: 2_000, rta: 0))
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt == nil)
        #expect(!fixture.store.canUndoMoneyMove)
        #expect(fixture.store.canMoveMoney)
    }

    @Test
    func undoingAPartialCoverRestoresRTAAndLeavesCategorySelectionOpen() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(assigned: 200, readyToAssign: 100))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        await fixture.store.applyMoneyMove()
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: 300, readyToAssign: 0))
        await drainMainQueue()
        #expect(fixture.store.moneyMove?.phase == .choosing)
        await fixture.store.undoMoneyMove()
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: 200, readyToAssign: 100))
        await drainMainQueue()
        #expect(fixture.store.moneyMove?.phase == .choosing)
        #expect(fixture.store.moneyMove?.coverNeed == 400)
        #expect(fixture.store.moneyMove?.lastMoveID == nil)
        #expect(fixture.store.canChooseMoneyMoveAccount(.readyToAssign))
        #expect(fixture.store.readyToAssign == 100)
    }

    @Test
    func moneyMoveRejectsDuplicateSubmissionAndRollsBackARejectedBatch() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        let id = try #require(fixture.store.moneyMove?.id)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: 200, minorUnit: 2), sessionID: id)
        var continuation: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.quickAssignHandler = { _ in
            try await withCheckedThrowingContinuation { continuation = $0 }
        }
        let task = Task { await fixture.store.applyMoneyMove() }
        await waitUntil { continuation != nil }
        #expect(fixture.store.groups[0].rows[0].available == 200)
        #expect(fixture.store.readyToAssign == 8_000)
        #expect(!fixture.store.canEdit)
        #expect(!fixture.store.canChangeMonth)
        await fixture.store.applyMoneyMove()
        fixture.store.endMoneyMove()
        #expect(fixture.store.moneyMove?.phase == .saving)
        continuation?.resume(throwing: BudgetSaveError.rejected)
        await task.value
        #expect(fixture.quickAssignRequests.count == 1)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        #expect(fixture.store.moneyMove?.phase == .choosing)
        #expect(fixture.store.moneyMove?.errorMessage != nil)
        #expect(fixture.store.canApplyMoneyMove)
    }

    @Test(arguments: [true, false])
    func moneyMoveReconcilesAnUncertainResponseBeforeAllowingRetry(saved: Bool) async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(
            BudgetStoreFixture.snapshot(assigned: 200, readyToAssign: 100))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        fixture.quickAssignHandler = { _ in throw BudgetTestError.unavailable }
        await fixture.store.applyMoneyMove()
        #expect(fixture.store.moneyMove?.phase == .checking)
        #expect(!fixture.store.canApplyMoneyMove)
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: saved ? 300 : 200, readyToAssign: saved ? 0 : 100)
        )
        await drainMainQueue()
        #expect(fixture.store.moneyMove?.phase == .choosing)
        #expect(fixture.store.canUndoMoneyMove == saved)
        #expect(fixture.store.canApplyMoneyMove == !saved)
    }

    @Test
    func moneyMoveLiveChangesClearCoverageAndProtectUndoFromNewerAssignments() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 200))
        await drainMainQueue()
        // Prime the month cache before a snapshot refresh updates both presentations.
        #expect(fixture.store.groups(for: fixture.store.selectedMonth) == fixture.store.groups)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 300))
        await drainMainQueue()
        let refreshedRows = fixture.store.groups(for: fixture.store.selectedMonth).flatMap(\.rows)
        #expect(refreshedRows.first { $0.id == "groceries" }?.assigned == 300)
        #expect(fixture.store.moneyMove?.counterpart == nil)
        #expect(fixture.store.moneyMove?.remaining == 300)
        #expect(!fixture.store.canApplyMoneyMove)
        fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        await fixture.store.applyMoneyMove()
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: 600, readyToAssign: 7_700))
        await drainMainQueue()
        #expect(fixture.store.canUndoMoneyMove)
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: 700, readyToAssign: 7_600))
        await drainMainQueue()
        #expect(!fixture.store.canUndoMoneyMove)
        await fixture.store.undoMoneyMove()
        #expect(fixture.quickAssignRequests.count == 1)
    }

    @Test
    func moneyMoveCancellationAndStaleKeypadCallbacksCannotWrite() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        let id = try #require(fixture.store.moneyMove?.id)
        #expect(fixture.store.beginEditing("rent") == nil)
        fixture.store.beginQuickAssign()
        #expect(fixture.store.quickAssign == nil)
        fixture.store.beginQuickAssign(categoryIDs: ["groceries"])
        #expect(fixture.store.quickAssign == nil)
        #expect(fixture.store.moneyMove?.id == id)
        fixture.store.selectMonth(202608)
        #expect(fixture.store.selectedMonth == 202609)
        fixture.store.endMoneyMove()
        fixture.store.beginMoneyMove("unfunded")
        #expect(fixture.store.moneyMove?.direction == .incoming)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: 200, minorUnit: 2), sessionID: id)
        #expect(fixture.store.moneyMove?.amount == 8_000)
        #expect(fixture.store.moneyMove?.counterpart == .readyToAssign)
        fixture.store.reset()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.quickAssignRequests.isEmpty)
    }

    @Test(arguments: [true, false])
    func moneyMoveUndoFailuresReconcileWithoutRepeatingTheOriginalMove(rejected: Bool) async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 200))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        await fixture.store.applyMoneyMove()
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: 600, readyToAssign: 7_600))
        await drainMainQueue()
        fixture.quickAssignHandler = { _ in
            if rejected { throw BudgetSaveError.rejected }
            throw BudgetTestError.unavailable
        }
        await fixture.store.undoMoneyMove()
        #expect(
            (fixture.store.moneyMove ?? fixture.store.moneyMoveReceipt)?.phase
                == (rejected ? .finished : .checkingUndo))
        #expect(fixture.store.canUndoMoneyMove == rejected)
        if !rejected {
            fixture.snapshotSubjects.last?.send(BudgetStoreFixture.snapshot(assigned: 200))
            await drainMainQueue()
            #expect(fixture.store.moneyMove == nil)
            #expect(fixture.store.moneyMoveReceipt == nil)
            #expect(fixture.store.readyToAssign == 8_000)
        }
        #expect(fixture.quickAssignRequests.count == 2)
    }

    @Test
    func moneyMoveAcknowledgementCannotResurrectAResetWorkspace() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot(assigned: 200))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        var continuation: CheckedContinuation<BudgetAssignmentResult, Never>?
        fixture.quickAssignHandler = { _ in
            await withCheckedContinuation { continuation = $0 }
        }
        let task = Task { await fixture.store.applyMoneyMove() }
        await waitUntil { continuation != nil }
        fixture.store.reset()
        continuation?.resume(returning: .init(success: true))
        await task.value
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.workspace == nil)
        #expect(fixture.store.readyToAssign == 0)
        #expect(fixture.store.groups.isEmpty)
    }

    @Test
    func closingThePeekDiscardsTheAmountDraftWithoutMovingMoney() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        let id = try #require(fixture.store.moneyMove?.id)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: 200, minorUnit: 2), sessionID: id)
        #expect(fixture.store.moneyMove?.isEnteringAmount == false)
        fixture.store.setMoneyMoveAmountEditing(true)
        #expect(fixture.store.moneyMove?.isEnteringAmount == true)
        fixture.store.setMoneyMoveAmountEditing(false)
        #expect(fixture.store.moneyMove != nil)
        #expect(fixture.store.moneyMove?.isEnteringAmount == false)
        fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        #expect(fixture.store.moneyMove?.isEnteringAmount == false)
        fixture.store.endMoneyMove()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.quickAssignRequests.isEmpty)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        #expect(fixture.store.readyToAssign == 8_000)
    }

    @Test(arguments: [200, 400])
    func outgoingMovesExitEvenWhenTheSourceHasMoneyLeft(amount: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        let id = try #require(fixture.store.moneyMove?.id)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: amount, minorUnit: 2), sessionID: id)
        await fixture.store.applyMoneyMove()
        // Do not close on an optimistic balance before the subscription confirms it.
        #expect(fixture.store.moneyMove != nil)
        #expect(fixture.store.moneyMoveReceipt == nil)
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: 1_000 - amount, rent: 2_000 + amount, rta: 8_000))
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt != nil)
        #expect(fixture.store.canUndoMoneyMove)
        await fixture.store.undoMoneyMove()
        #expect(fixture.store.moneyMove == nil)
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: 1_000, rent: 2_000, rta: 8_000))
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt == nil)
        #expect(fixture.store.groups[0].rows[0].available == 400)
        #expect(!fixture.store.canUndoMoneyMove)
    }

    @Test(arguments: [true, false])
    func exhaustedFundingExitsEvenWhenThereIsMoreToCover(covering: Bool) async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        let assigned: Int64 = covering ? 200 : 600
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: assigned, rent: 500, rta: 100))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        await fixture.store.applyMoneyMove()
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: assigned + 100, rent: 500, rta: 0))
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt != nil)
        #expect(fixture.store.canUndoMoneyMove)
        #expect(fixture.store.canMoveMoney)
        #expect(fixture.store.beginEditing("groceries") != nil)
        #expect(fixture.store.moneyMoveReceipt == nil)
    }

    @Test
    func anUncertainFullMoveExitsOnlyAfterConfirmationAndReceiptResetsWithWorkspace() async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        fixture.quickAssignHandler = { _ in throw BudgetTestError.unavailable }
        await fixture.store.applyMoneyMove()
        #expect(fixture.store.moneyMove?.phase == .checking)
        #expect(fixture.store.moneyMoveReceipt == nil)
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: 600, rent: 2_400, rta: 8_000))
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt != nil)
        #expect(fixture.store.canUndoMoneyMove)
        fixture.store.stop()
        #expect(fixture.store.moneyMoveReceipt == nil)
        #expect(!fixture.store.canUndoMoneyMove)
    }

    @Test(arguments: [200, 400])
    func completedMoveReceiptsExpireWithMoneyLeftInTheSource(amount: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        let sessionID = try #require(fixture.store.moneyMove?.id)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: amount, minorUnit: 2), sessionID: sessionID)
        await fixture.store.applyMoneyMove()
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: 1_000 - amount, rent: 2_000 + amount, rta: 8_000))
        await drainMainQueue()
        let id = try #require(
            (fixture.store.moneyMove ?? fixture.store.moneyMoveReceipt)?.lastMoveID)
        #expect(fixture.store.moneyMoveReceiptTimeRemaining == 2.5)
        fixture.store.expireMoneyMoveReceipt(id: id)
        #expect(fixture.store.canUndoMoneyMove)
        fixture.now = fixture.now.addingTimeInterval(2.5)
        #expect(!fixture.store.canUndoMoneyMove)
        fixture.store.expireMoneyMoveReceipt(id: UUID())
        #expect((fixture.store.moneyMove ?? fixture.store.moneyMoveReceipt)?.lastMoveID == id)
        fixture.store.expireMoneyMoveReceipt(id: id)
        #expect(fixture.store.moneyMoveReceipt == nil)
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMove?.lastMoveID == nil)
    }

    @Test(arguments: [true, false])
    func assigningAllRTAByMovingMoneyClosesWithTheUndoReceipt(fromRTA: Bool) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        var peek = BudgetPeekPresentation()
        peek.update(peekContext(8_000, isEditing: false))

        if fromRTA {
            fixture.store.beginMoneyMove(at: .readyToAssign)
            fixture.store.chooseMoneyMoveAccount(.category("groceries"))
        } else {
            fixture.store.beginMoneyMove("groceries")
            fixture.store.flipMoneyMoveDirection()
            fixture.store.chooseMoneyMoveAccount(.readyToAssign)
        }
        fixture.store.useMoneyMoveMaximum()
        #expect(fixture.store.moneyMove?.amount == 8_000)
        await fixture.store.applyMoneyMove()

        var context = peekContext(0)
        context.hasMoneyMove = true
        peek.update(context)
        #expect(peek.completionID == nil)
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(assigned: 9_000, readyToAssign: 0))
        await drainMainQueue()
        let receipt = try #require(fixture.store.moneyMoveReceipt)
        let id = try #require(receipt.lastMoveID)
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.canUndoMoneyMove)
        context = peekContext(0, isEditing: false)
        context.hasMoneyMove = true
        context.hasUndo = true
        peek.update(context)
        #expect(peek.isVisible)
        #expect(peek.completionTaskID == nil)
        #expect(!peek.showsCompletion)

        fixture.now = fixture.now.addingTimeInterval(2.5)
        fixture.store.expireMoneyMoveReceipt(id: id)
        #expect(fixture.store.moneyMoveReceipt?.isClosingReceipt == true)
        #expect(fixture.store.moneyMoveReceipt?.lastMoveID == id)
        #expect(fixture.store.moneyMoveReceipt?.savedAmount == receipt.savedAmount)
        #expect(
            fixture.store.moneyMoveReceipt?.savedDestinationName == receipt.savedDestinationName)
        #expect(!fixture.store.canUndoMoneyMove)
        context.hasUndo = false
        peek.update(context)
        #expect(!peek.isVisible)
        #expect(!peek.showsCompletion)

        fixture.store.finishMoneyMoveReceiptClosing(id: UUID())
        #expect(fixture.store.moneyMoveReceipt != nil)
        fixture.store.finishMoneyMoveReceiptClosing(id: id)
        #expect(fixture.store.moneyMoveReceipt == nil)
        context.hasMoneyMove = false
        peek.update(context)
        #expect(!peek.isVisible)
        #expect(peek.completionTaskID == nil)
        #expect(!peek.showsCompletion)
    }

    @Test
    func receiptUndoStaysClosedAndCannotExpireWhileSaving() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        await fixture.store.applyMoneyMove()
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: 600, rent: 2_400, rta: 8_000))
        await drainMainQueue()
        let id = try #require(fixture.store.moneyMoveReceipt?.lastMoveID)
        var continuation: CheckedContinuation<BudgetAssignmentResult, Error>?
        fixture.quickAssignHandler = { _ in
            try await withCheckedThrowingContinuation { continuation = $0 }
        }
        let task = Task { await fixture.store.undoMoneyMove() }
        await waitUntil { continuation != nil }
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt?.phase == .undoing)
        #expect(!fixture.store.canEdit)
        #expect(!fixture.store.canMoveMoney)
        #expect(!fixture.store.canChangeMonth)
        fixture.now = fixture.now.addingTimeInterval(10)
        fixture.store.expireMoneyMoveReceipt(id: id)
        #expect(fixture.store.moneyMoveReceipt != nil)
        continuation?.resume(returning: .init(success: true))
        await task.value
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.isConfirmingMoneyMove)
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: 1_000, rent: 2_000, rta: 8_000))
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt == nil)
        #expect(fixture.store.canMoveMoney)
    }

    @Test(arguments: [true, false])
    func fundingAnEmptyCategoryEndsWithoutSuggestingAnotherSource(useRTA: Bool) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(assigned: 600, rent: 2_000, rta: 8_000))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        #expect(fixture.store.moneyMove?.direction == .incoming)
        fixture.store.chooseMoneyMoveAccount(useRTA ? .readyToAssign : .category("rent"))
        let id = try #require(fixture.store.moneyMove?.id)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: 200, minorUnit: 2), sessionID: id)
        await fixture.store.applyMoneyMove()
        #expect(fixture.store.moneyMove != nil)
        #expect(fixture.store.isConfirmingMoneyMove)
        let updated = moneyMoveSnapshot(
            assigned: 800, rent: useRTA ? 2_000 : 1_800, rta: useRTA ? 7_800 : 8_000)
        fixture.snapshotSubjects.last?.send(updated)
        await drainMainQueue()
        #expect(fixture.store.groups[0].rows[0].available == 200)
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.store.moneyMoveReceipt?.savedAmount == 200)
        #expect(fixture.store.moneyMoveReceipt?.savedDestinationName == "Groceries")
        #expect(fixture.store.canUndoMoneyMove)
        #expect(!fixture.store.canApplyMoneyMove)
        #expect(fixture.store.canMoveMoney)
        fixture.snapshotSubjects.last?.send(updated)
        await drainMainQueue()
        #expect(fixture.store.moneyMove == nil)
        #expect(fixture.quickAssignRequests.count == 1)
    }

    @Test(arguments: [200, 600])
    func targetAwareIncomingMovesContinueOnlyUntilTheTargetIsFunded(sourceAvailable: Int64) async {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(
                assigned: 600, readyToAssign: sourceAvailable,
                target: .init(targetAmount: 1_100, underfundedAmount: 500)))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        let amount = min(sourceAvailable, 500)
        #expect(fixture.store.moneyMove?.amount == Decimal(amount))
        #expect(fixture.quickAssignRequests.isEmpty)
        await fixture.store.applyMoneyMove()
        #expect(fixture.quickAssignRequests[0].changes.map(\.assigned) == [600 + amount])
        fixture.snapshotSubjects.last?.send(
            BudgetStoreFixture.snapshot(
                assigned: 600 + amount, readyToAssign: sourceAvailable - amount,
                target: .init(targetAmount: 1_100, underfundedAmount: 500 - amount)))
        await drainMainQueue()
        #expect((fixture.store.moneyMove == nil) == (amount == 500))
        if amount < 500 {
            fixture.store.chooseMoneyMoveAccount(.category("rent"))
            #expect(fixture.store.moneyMove?.amount == Decimal(500 - amount))
        }
    }

    @Test
    func editingAMoveKeepsItsLiveAmountAndUseAllOnlyUpdatesTheDraft() async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        let id = try #require(fixture.store.moneyMove?.id)
        fixture.store.setMoneyMoveAmountEditing(true)
        var calculator = AmountCalculator(amount: 200, minorUnit: 2)
        calculator.appendOperation(.add)
        fixture.store.updateMoneyMoveCalculator(calculator, sessionID: id)
        #expect(fixture.store.moneyMove?.isEnteringAmount == true)
        #expect(fixture.store.moneyMove?.calculator.previewAmount == 200)
        #expect(!fixture.store.canApplyMoneyMove)
        fixture.store.useMoneyMoveMaximum()
        #expect(fixture.store.moneyMove?.amount == 400)
        #expect(fixture.store.moneyMove?.calculator.previewAmount == 400)
        #expect(fixture.store.moneyMove?.isEnteringAmount == true)
        #expect(fixture.store.canApplyMoneyMove)
        #expect(fixture.quickAssignRequests.isEmpty)
        fixture.store.setMoneyMoveAmountEditing(false)
        #expect(fixture.store.moneyMove?.amount == 400)
        #expect(fixture.store.moneyMove?.isEnteringAmount == false)
    }

    @Test(arguments: [10_000, 15_000])
    func outgoingMoveEndsWhenTheDestinationTargetIsMet(amount: Int64) async throws {
        let fixture = BudgetStoreFixture()
        defer { fixture.store.stop() }
        await load(fixture)
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(
                assigned: 50_600, rent: 500, rta: 8_000,
                rentTarget: .init(targetAmount: 15_500, underfundedAmount: 15_000)))
        await drainMainQueue()
        fixture.store.beginMoneyMove("groceries")
        fixture.store.chooseMoneyMoveAccount(.category("rent"))
        #expect(fixture.store.moneyMove?.sourceLimit == 50_000)
        #expect(fixture.store.moneyMove?.amount == 15_000)
        let id = try #require(fixture.store.moneyMove?.id)
        fixture.store.updateMoneyMoveCalculator(
            AmountCalculator(amount: amount, minorUnit: 2), sessionID: id)
        await fixture.store.applyMoneyMove()
        fixture.snapshotSubjects.last?.send(
            moneyMoveSnapshot(
                assigned: 50_600 - amount, rent: 500 + amount, rta: 8_000,
                rentTarget: .init(
                    targetAmount: 15_500, underfundedAmount: 15_000 - amount)))
        await drainMainQueue()
        #expect(fixture.store.groups[0].rows[0].available == Decimal(50_000 - amount))
        #expect((fixture.store.moneyMove == nil) == (amount == 15_000))
        #expect((fixture.store.moneyMoveReceipt != nil) == (amount == 15_000))
        #expect(fixture.store.canUndoMoneyMove)
        if amount == 10_000 {
            fixture.store.chooseMoneyMoveAccount(.category("rent"))
            #expect(fixture.store.moneyMove?.amount == 5_000)
        }
    }

    private func moneyMoveSnapshot(
        assigned: Int64, rent: Int64, rta: Int64, rentTarget: BudgetCategoryTarget? = nil
    ) -> BudgetSnapshot {
        let original = BudgetStoreFixture.snapshot(assigned: assigned, readyToAssign: rta)
        return BudgetSnapshot(
            months: original.months.map { month in
                guard month.yearMonth == 202609 else { return month }
                var amounts = month.budgetData
                amounts["rent"] = .init(
                    assignedAmount: rent, available: rent - 500, target: rentTarget)
                return .init(yearMonth: month.yearMonth, budgetData: amounts)
            }, availableRange: original.availableRange, readyToAssign: rta)
    }

    private func load(_ fixture: BudgetStoreFixture) async {
        fixture.store.start()
        await waitUntil { fixture.snapshotSubjects.count == 1 }
        fixture.snapshotSubjects[0].send(BudgetStoreFixture.snapshot())
        await waitUntil { fixture.store.canEdit }
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async {
        for _ in 0..<100 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }

    private func drainMainQueue() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }
    }
}

@MainActor
private final class BudgetStoreFixture {
    let structure: CurrentValueSubject<BudgetStructure?, Error>
    var snapshotSubjects: [PassthroughSubject<BudgetSnapshot, Error>] = []
    var snapshotRequests: [(workspaceID: String, currentMonth: Int)] = []
    var assignmentRequests: [BudgetAssignmentRequest] = []
    var quickAssignRequests: [BudgetQuickAssignRequest] = []
    var targetSnoozeRequests: [BudgetTargetSnoozeRequest] = []
    var targetSnoozeHandler: BudgetStore.TargetSnoozeHandler = { _ in .init(success: true) }
    var quickAssignHandler: BudgetStore.QuickAssignHandler = { _ in .init(success: true) }
    var archivedSubscription: BudgetStore.ArchivedCategoriesSubscription = { _ in
        Just([]).setFailureType(to: Error.self).eraseToAnyPublisher()
    }
    var structureSubscriptions = 0
    var now = BudgetMonth.date(202609).addingTimeInterval(3 * 86_400 + 43_200)
    var assignmentHandler: BudgetStore.AssignmentHandler = { _ in
        BudgetAssignmentResult(success: true)
    }
    private let defaults: UserDefaults?
    private let responseTimeout: Duration

    lazy var store = BudgetStore(
        now: { [unowned self] in now },
        defaults: defaults,
        responseTimeout: responseTimeout,
        structureSubscription: { [unowned self] in
            structureSubscriptions += 1
            return structure.compactMap { $0 }.eraseToAnyPublisher()
        },
        archivedCategoriesSubscription: { [unowned self] workspaceID in
            archivedSubscription(workspaceID)
        },
        snapshotSubscription: { [unowned self] workspaceID, currentMonth in
            snapshotRequests.append((workspaceID, currentMonth))
            let subject = PassthroughSubject<BudgetSnapshot, Error>()
            snapshotSubjects.append(subject)
            return subject.eraseToAnyPublisher()
        },
        assignmentHandler: { [unowned self] request in
            assignmentRequests.append(request)
            return try await assignmentHandler(request)
        },
        quickAssignHandler: { [unowned self] request in
            quickAssignRequests.append(request)
            return try await quickAssignHandler(request)
        },
        targetSnoozeHandler: { [unowned self] request in
            targetSnoozeRequests.append(request)
            return try await targetSnoozeHandler(request)
        }
    )

    init(
        defaults: UserDefaults? = nil,
        responseTimeout: Duration = .seconds(15),
        startsWithStructure: Bool = true
    ) {
        self.defaults = defaults
        self.responseTimeout = responseTimeout
        structure = CurrentValueSubject(startsWithStructure ? Self.structure() : nil)
    }

    static func structure(workspaceID: String = "workspace") -> BudgetStructure {
        BudgetStructure(
            workspace: BudgetWorkspace(
                id: workspaceID, name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "America/New_York"
            ),
            categoryGroups: [
                BudgetCategoryGroup(
                    categoryGroup: .init(_id: "everyday", name: "Everyday", type: "regular"),
                    categories: [
                        BudgetCategory(
                            _id: "groceries", name: "Groceries", iconName: nil, type: "regular"),
                        BudgetCategory(
                            _id: "unfunded", name: "Unfunded", iconName: nil, type: "regular"),
                    ]
                ),
                BudgetCategoryGroup(
                    categoryGroup: .init(_id: "bills", name: "Bills", type: "regular"),
                    categories: [
                        BudgetCategory(_id: "rent", name: "Rent", iconName: nil, type: "regular")
                    ]
                ),
            ]
        )
    }

    static func snapshot(
        assigned: Int64 = 1_000, readyToAssign: Int64 = 8_000, activity: Int64 = -600,
        target: BudgetCategoryTarget? = nil, summary: BudgetPlanSummary? = nil
    ) -> BudgetSnapshot {
        BudgetSnapshot(
            months: [
                BudgetMonthSnapshot(
                    yearMonth: 202608,
                    budgetData: ["groceries": BudgetCategoryAmounts(assignedAmount: 700)]
                ),
                BudgetMonthSnapshot(
                    yearMonth: 202609,
                    budgetData: [
                        "groceries": BudgetCategoryAmounts(
                            assignedAmount: assigned, available: assigned - 600, activity: activity,
                            target: target
                        ),
                        "rent": BudgetCategoryAmounts(assignedAmount: 2_000, available: 1_500),
                    ], summary: summary
                ),
                BudgetMonthSnapshot(
                    yearMonth: 202610,
                    budgetData: ["groceries": BudgetCategoryAmounts(assignedAmount: 1_300)]
                ),
            ],
            availableRange: BudgetMonthRange(minYearMonth: 202608, maxYearMonth: 202610),
            readyToAssign: readyToAssign
        )
    }
}

private enum BudgetTestError: Error { case unavailable }
