import Foundation
import Testing

@testable import Kualia

@MainActor
struct BudgetQuickAssignTests {
    @Test
    func coversGapsInBudgetOrderAndStopsAtZero() {
        let plan = make(
            .underfunded,
            [category("first", underfunded: 800), category("second", underfunded: 500)], rta: 1_000)
        #expect(plan.changes.map(\.id) == ["first", "second"])
        #expect(plan.changes.map(\.assigned) == [800, 200])
        #expect(plan.readyToAssignAfter == 0)
        #expect(plan.unfilledAmount == 300)
    }

    @Test
    func overspendingIsCoveredWithoutAnActiveTarget() {
        let plan = make(.underfunded, [category("one", assigned: 100, available: -250)], rta: 300)
        #expect(plan.changes.first?.assigned == 350)
        #expect(plan.changes.first?.available == 0)
        #expect(plan.readyToAssignAfter == 50)
    }

    @Test
    func negativeRTARequiresOptInToAddMoreMoney() {
        let categories = [category("one", underfunded: 500)]
        #expect(make(.underfunded, categories, rta: -200).changes.isEmpty)
        let unrestricted = make(.underfunded, categories, rta: -200, allowsNegative: true)
        #expect(unrestricted.assignedAmount == 500)
        #expect(unrestricted.readyToAssignAfter == -700)
    }

    @Test
    func reducesOnlyUnspentOverfunding() {
        let plan = make(
            .reduceOverfunding,
            [
                category("spent", assigned: 1_000, available: 150, overfunded: 500),
                category("overspent", assigned: 1_000, available: -100, overfunded: 500),
            ], rta: -300)
        #expect(plan.changes.map(\.assigned) == [850])
        #expect(plan.changes.first?.available == 0)
        #expect(plan.readyToAssignAfter == -150)
    }

    @Test
    func releasedMoneyFundsEarlierCategoriesRegardlessOfOrder() {
        let add = category("add", history: [202608: .init(assigned: 500, activity: 0)])
        let release = category(
            "release", assigned: 700, history: [202608: .init(assigned: 0, activity: 0)])
        for categories in [[add, release], [release, add]] {
            let plan = make(.assignedLastMonth, categories, rta: 0)
            #expect(plan.assignedAmount == 500)
            #expect(plan.returnedAmount == 700)
            #expect(plan.readyToAssignAfter == 200)
            #expect(plan.unfilledAmount == 0)
        }
    }

    @Test
    func lastMonthMeansTheLastCompletedMonthIncludingAcrossYears() {
        let plan = BudgetQuickAssignPlan.make(
            option: .assignedLastMonth,
            categories: [
                category(
                    "one",
                    history: [
                        202512: .init(assigned: 333, activity: -200),
                        202601: .init(assigned: 999, activity: -999),
                    ])
            ], currentMonth: 202601, readyToAssign: 1_000, allowsNegativeRTA: false)
        #expect(plan.changes.first?.assigned == 333)
    }

    @Test
    func spendingIgnoresInflowAndMissingHistoryPreservesAssignments() {
        let plan = make(
            .spentLastMonth,
            [
                category(
                    "inflow", assigned: 200, history: [202608: .init(assigned: 0, activity: 500)]),
                category("spending", history: [202608: .init(assigned: 0, activity: -400)]),
                category("missing", assigned: 300),
            ])
        #expect(plan.changes.map(\.assigned) == [0, 400])
        #expect(!plan.changes.contains(where: { $0.id == "missing" }))
    }

    @Test
    func averagesUseOnlyCompletedMonthsWithDataAndTruncateTowardZero() {
        let history: [Int: BudgetQuickAssignCategory.History] = [
            202607: .init(assigned: -101, activity: -101),
            202608: .init(assigned: -200, activity: 400),
            202609: .init(assigned: 9_999, activity: -9_999),
            202610: .init(assigned: 9_999, activity: -9_999),
        ]
        #expect(
            make(.averageAssigned, [category("one", history: history)]).changes.first?.assigned
                == -150)
        #expect(
            make(.averageSpent, [category("one", history: history)]).changes.first?.assigned == 50)
    }

    @Test
    func resetsShowRealNetMovementAndSkipUnchangedCategories() {
        let categories = [category("one", assigned: 500, available: 200), category("zero")]
        let assigned = make(.zeroAssigned, categories, rta: 100)
        #expect(assigned.changes.count == 1)
        #expect(assigned.returnedAmount == 500)
        #expect(assigned.readyToAssignAfter == 600)
        let available = make(.zeroAvailable, categories, rta: 100)
        #expect(available.changes.first?.assigned == 300)
        #expect(available.changes.first?.available == 0)
        #expect(available.readyToAssignAfter == 300)
    }

    @Test
    func resettingNegativeAssignmentsStillRespectsTheAvailableMoneyLimit() {
        let plan = make(.zeroAssigned, [category("one", assigned: -500)], rta: 300)
        #expect(plan.changes.first?.assigned == -200)
        #expect(plan.unfilledAmount == 200)
        #expect(plan.readyToAssignAfter == 0)
    }

    @Test
    func veryLargeAmountsAndOverspendingNeverOverflow() {
        let tooLarge = make(
            .underfunded, [category("one", assigned: Int64.max, underfunded: 1)], rta: 100)
        #expect(!tooLarge.canApply)
        #expect(tooLarge.errorMessage != nil)
        let reset = make(
            .zeroAvailable, [category("one", assigned: Int64.max, available: Int64.min)],
            allowsNegative: true)
        #expect(!reset.canApply)
        #expect(reset.errorMessage != nil)
        let extremeSpending = make(
            .spentLastMonth,
            [category("one", history: [202608: .init(assigned: 0, activity: Int64.min)])], rta: 101)
        #expect(extremeSpending.changes.first?.assigned == 101)
        #expect(extremeSpending.readyToAssignAfter == 0)
    }

    @Test
    func netRTAOverflowRejectsTheEntirePlan() {
        let plan = make(.zeroAssigned, [category("one", assigned: 10)], rta: Decimal(Int64.max))
        #expect(!plan.canApply)
        #expect(plan.changes.isEmpty)
    }

    @Test
    func emptyStrategiesNeverBecomeApplyable() {
        for option in BudgetQuickAssignOption.allCases {
            let plan = make(option, [category("one")])
            #expect(!plan.canApply)
            #expect(plan.readyToAssignAfter == 10_000)
        }
    }

    @Test
    func earliestDeadlinesTakePriorityAndUndatedCategoriesFollow() {
        let categories = [
            category("undated", underfunded: 100),
            category("later", underfunded: 200, dueDate: "2026-10-01"),
            category("first", underfunded: 300, dueDate: "2026-09-05"),
            category("same-date", underfunded: 100, dueDate: "2026-09-05"),
        ]
        let plan = make(.underfunded, categories, rta: 450)
        #expect(plan.changes.map(\.id) == ["first", "same-date", "later"])
        #expect(plan.changes.map(\.assigned) == [300, 100, 50])
        #expect(plan.readyToAssignAfter == 0)
        #expect(plan.unfilledAmount == 250)
        let unlimited = make(.underfunded, categories, rta: 450, allowsNegative: true)
        #expect(unlimited.changes.map(\.id) == ["first", "same-date", "later", "undated"])
        #expect(unlimited.readyToAssignAfter == -250)
    }

    @Test
    func snowballFillsTheMostSmallGapsThenPartiallyFundsTheNext() {
        let categories = [
            category("large", underfunded: 900, dueDate: "2026-09-01"),
            category("small", assigned: 8_000, underfunded: 100, dueDate: "2026-12-01"),
            category("medium", underfunded: 200),
            category("same-gap", underfunded: 100),
        ]
        let plan = make(.underfunded, categories, rta: 450, order: .smallestAmount)
        #expect(plan.changes.map(\.id) == ["small", "same-gap", "medium", "large"])
        #expect(plan.changes.map(\.delta) == [100, 100, 200, 50])
        #expect(plan.readyToAssignAfter == 0)
        #expect(plan.unfilledAmount == 850)
    }

    @Test
    func snowballUsesTheWholeGapIncludingOverspending() {
        let plan = make(
            .underfunded,
            [
                category("overspent", available: -800, underfunded: 100),
                category("smaller", underfunded: 500),
                category("funded", underfunded: 0),
            ], rta: 600, order: .smallestAmount)
        #expect(plan.changes.map(\.id) == ["smaller", "overspent"])
        #expect(plan.changes.map(\.delta) == [500, 100])
        #expect(plan.unfilledAmount == 700)
    }

    @Test
    func savedUnderfundedPriorityDoesNotReorderOtherMethods() {
        let categories = [
            category("first", assigned: 1_000, dueDate: "2027-01-01"),
            category("second", assigned: 100, dueDate: "2026-09-01"),
        ]
        for order in BudgetUnderfundedOrder.allCases {
            let plan = make(.zeroAssigned, categories, order: order)
            #expect(plan.changes.map(\.id) == ["first", "second"])
        }
    }

    @Test
    func skippingACategoryRedistributesFundsAndKeepsEveryCandidateVisible() {
        let categories = [
            category("first", underfunded: 800), category("second", underfunded: 500),
        ]
        let original = make(.underfunded, categories, rta: 800)
        #expect(original.previewChanges.map(\.id) == ["first", "second"])
        #expect(original.previewChanges.map(\.delta) == [800, 0])
        let skipped = make(.underfunded, categories, rta: 800, excluded: ["first"])
        #expect(skipped.changes.map(\.id) == ["second"])
        #expect(skipped.changes.first?.delta == 500)
        #expect(skipped.previewChanges.map(\.delta) == [0, 500])
        #expect(skipped.readyToAssignAfter == 300)
        #expect(skipped.unfilledAmount == 0)
        #expect(make(.underfunded, categories, rta: 800) == original)
    }

    @Test
    func skippingAllCategoriesPreservesMoneyAndDisablesApply() {
        let plan = make(.zeroAssigned, [category("one", assigned: 500)], excluded: ["one"])
        #expect(!plan.canApply)
        #expect(plan.previewChanges.map(\.id) == ["one"])
        #expect(plan.previewChanges.first?.assigned == 500)
        #expect(plan.readyToAssignAfter == 10_000)
    }

    @Test
    func skippedReleasesCannotFundOtherCategories() {
        let categories = [
            category("add", history: [202608: .init(assigned: 500, activity: 0)]),
            category("release", assigned: 700, history: [202608: .init(assigned: 0, activity: 0)]),
        ]
        let plan = make(.assignedLastMonth, categories, rta: 100, excluded: ["release"])
        #expect(plan.changes.map(\.id) == ["add"])
        #expect(plan.assignedAmount == 100)
        #expect(plan.returnedAmount == 0)
        #expect(plan.readyToAssignAfter == 0)
        #expect(plan.unfilledAmount == 400)
    }

    private func make(
        _ option: BudgetQuickAssignOption, _ categories: [BudgetQuickAssignCategory],
        rta: Decimal = 10_000, allowsNegative: Bool = false,
        order: BudgetUnderfundedOrder = .dueDate, excluded: Set<String> = []
    ) -> BudgetQuickAssignPlan {
        .make(
            option: option, categories: categories, currentMonth: 202609,
            readyToAssign: rta, allowsNegativeRTA: allowsNegative, underfundedOrder: order,
            excludedCategoryIDs: excluded)
    }

    private func category(
        _ id: String, assigned: Int64 = 0, available: Int64 = 0,
        underfunded: Int64 = 0, overfunded: Int64 = 0,
        history: [Int: BudgetQuickAssignCategory.History] = [:], dueDate: String? = nil
    ) -> BudgetQuickAssignCategory {
        .init(
            id: id, name: id, groupName: "Everyday", assigned: assigned, available: available,
            underfunded: underfunded, overfunded: overfunded, history: history, dueDate: dueDate)
    }
}
