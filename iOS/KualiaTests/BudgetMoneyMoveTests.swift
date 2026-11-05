import Foundation
import Testing

@testable import Kualia

@MainActor
struct BudgetMoneyMoveTests {
    @Test(arguments: [-100, 0, 100])
    func availabilityChoosesTheInitialFlow(available: Int) {
        let session = make(available: Decimal(available))
        #expect(
            session.direction == (available < 0 ? .cover : available == 0 ? .incoming : .outgoing))
        #expect(!session.isEnteringAmount)
        #expect(session.counterpart == (available <= 0 ? .readyToAssign : nil))
        #expect(session.canApply == (available <= 0))
    }

    @Test(arguments: [100, 500, 800])
    func readyToAssignIsSuggestedAndCappedToTheShortfall(rta: Int) throws {
        let session = make(available: -500, rta: Decimal(rta))
        #expect(session.counterpart == .readyToAssign)
        #expect(session.amount == Decimal(min(rta, 500)))
        #expect(session.remaining == Decimal(max(500 - rta, 0)))
        #expect(session.lastMoveID == nil)
        let changes = try #require(session.changes)
        #expect(changes.count == 1)
        #expect(changes[0].assigned == 1_000 + Int64(min(rta, 500)))
    }

    @Test
    func selectingACategoryReplacesTheSuggestionWithoutStackingContributions() throws {
        var session = make(available: -500, rta: 100, otherAvailable: 150)
        session.choose(.category("other"))
        #expect(session.amount == 150)
        #expect(session.remaining == 350)
        #expect(!session.isEnteringAmount)
        let changes = try #require(session.changes)
        #expect(changes.map(\.assigned) == [1_150, 850])
        #expect(changes.reduce(Decimal.zero) { $0 + $1.delta } == 0)
        session.choose(.category("other"))
        #expect(session.amount == 150)
        #expect(session.accounts[2].available == 150)
    }

    @Test(arguments: [0, -200])
    func unfundedSourcesAreExcludedButRTAIsAlwaysADestination(rta: Int) {
        var session = make(available: -500, rta: Decimal(rta), otherAvailable: 0)
        #expect(session.choices.isEmpty)
        session.choose(.readyToAssign)
        #expect(session.counterpart == nil)
        #expect(session.amount == 0)
        session = make(available: 500, rta: Decimal(rta), otherAvailable: 0)
        #expect(session.choices.map(\.endpoint) == [.readyToAssign, .category("other")])
        session.choose(.readyToAssign)
        session.calculator = AmountCalculator(amount: 200, minorUnit: 2)
        #expect(session.changes?.map(\.assigned) == [800])
    }

    @Test(arguments: [200, 800])
    func negativeRTASuggestsOnlyEnoughToReachZeroOrTheSourceLimit(shortfall: Int) {
        let session = make(available: 500, rta: Decimal(-shortfall))
        #expect(session.counterpart == .readyToAssign)
        #expect(session.amount == Decimal(min(500, shortfall)))
        #expect(session.canApply)
        #expect(!session.isEnteringAmount)
    }

    @Test
    func negativeRTAItselfCanBeCoveredFromPositiveCategories() throws {
        let accounts = make(available: 500, rta: -800, otherAvailable: 0).accounts
        var session = BudgetMoneyMoveSession(
            workspaceID: "workspace", yearMonth: 202609, anchor: .readyToAssign,
            accounts: accounts, minorUnit: 2)
        #expect(session.direction == .cover)
        #expect(session.choices.map(\.endpoint) == [.category("anchor")])
        session.choose(.category("anchor"))
        #expect(session.amount == 500)
        #expect(session.remaining == 300)
        #expect(try #require(session.changes).map(\.assigned) == [500])
    }

    @Test
    func selectionPreviewsAnAmountAndOnlyExplicitEditingOpensTheKeypad() {
        var session = make(available: 300)
        session.choose(.category("other"))
        #expect(session.amount == 300)
        #expect(!session.isEnteringAmount)
        session.isEditingAmount = true
        #expect(session.isEnteringAmount)
        session.choose(.readyToAssign)
        #expect(!session.isEnteringAmount)
        session.flipDirection()
        #expect(session.direction == .incoming)
        #expect(session.destination == .category("anchor"))
        #expect(session.counterpart == .readyToAssign)
        #expect(session.amount == 200)
        #expect(session.source == .readyToAssign)
        #expect(session.amount == 200)
    }

    @Test
    func anOverspentDestinationGetsOnlyWhatItNeedsByDefault() {
        var session = make(available: 500, otherAvailable: -100)
        session.choose(.category("other"))
        #expect(session.amount == 100)
        #expect(session.changes?.first { $0.id == "other" }?.available == 0)
    }

    @Test(arguments: [0, 1, 2, 3])
    func transfersConserveMoneyAtEveryCurrencyPrecision(minorUnit: Int) throws {
        var session = make(available: 375, minorUnit: minorUnit)
        session.choose(.category("other"))
        session.calculator = AmountCalculator(amount: 375, minorUnit: minorUnit)
        let changes = try #require(session.changes)
        #expect(changes.reduce(Decimal.zero) { $0 + $1.delta } == 0)
        #expect(changes.first { $0.id == "anchor" }?.available == 0)
        #expect(changes.first { $0.id == "other" }?.available == 1_075)
    }

    @Test
    func invalidOrUnfinishedAmountsNeverProduceAWritablePlan() {
        var session = make(available: 300)
        session.choose(.category("anchor"))
        #expect(session.counterpart == nil)
        session.choose(.category("missing"))
        #expect(session.counterpart == nil)
        session.choose(.category("other"))
        session.calculator = AmountCalculator(amount: 301, minorUnit: 2)
        #expect(!session.canApply)
        session.calculator = AmountCalculator(amount: 200, minorUnit: 2)
        session.calculator.appendOperation(.add)
        #expect(!session.canApply)
        session.calculator = AmountCalculator(amount: 0, minorUnit: 2)
        #expect(!session.canApply)
    }

    @Test
    func overflowInEitherAssignmentOrAvailableBalanceIsRejected() {
        var session = make(available: 100)
        session.accounts[2] = .init(
            endpoint: .category("other"), name: "Other", groupName: "Everyday",
            assigned: Int64.max, available: 1)
        session.choose(.category("other"))
        session.calculator = AmountCalculator(amount: 1, minorUnit: 2)
        #expect(!session.canApply)
        session.accounts[2] = .init(
            endpoint: .category("other"), name: "Other", groupName: "Everyday",
            assigned: 0, available: Decimal(Int64.max))
        #expect(!session.canApply)
        session.choose(.readyToAssign)
        session.accounts[0] = .init(
            endpoint: .readyToAssign, name: "Ready to Assign", groupName: "",
            assigned: 0, available: Decimal(Int64.max))
        #expect(!session.canApply)
    }

    @Test
    func carriedOverMoneyCanBeMovedEvenIfTheAssignmentBecomesNegative() {
        var session = make(available: 2_000)
        session.choose(.category("other"))
        session.calculator = AmountCalculator(amount: 1_500, minorUnit: 2)
        #expect(session.changes?.first { $0.id == "anchor" }?.assigned == -500)
        #expect(session.changes?.first { $0.id == "anchor" }?.available == 500)
    }

    @Test(arguments: [-200, 0, 200])
    func outgoingMovesOnlyPreselectNegativeRTAAndCategorySelectionReplacesIt(rta: Int) {
        var session = make(available: 500, rta: Decimal(rta))
        #expect(session.destination == (rta < 0 ? .readyToAssign : nil))
        #expect(session.amount == (rta < 0 ? 200 : 0))
        #expect(session.canApply == (rta < 0))
        #expect(!session.isEnteringAmount)
        session.choose(.category("other"))
        #expect(session.destination == .category("other"))
        #expect(session.amount == 500)
        #expect(session.savedChanges.isEmpty)
    }

    @Test(arguments: [-500, 0])
    func anUnfundedRTACannotBePreselectedAsASource(available: Int) {
        let session = make(available: Decimal(available), rta: 0)
        #expect(session.counterpart == nil)
        #expect(!session.canApply)
        #expect(session.choices.map(\.endpoint) == [.category("other")])
    }

    @Test(arguments: [0, 100, 500, 800])
    func destinationSuggestionUsesTheLargerTargetGapOrOverspending(gap: Int) {
        var session = make(available: 600, otherAvailable: -300)
        session.accounts[2].target = .init(targetAmount: 1_000, underfundedAmount: Int64(gap))
        session.choose(.category("other"))
        #expect(session.amount == Decimal(min(600, max(300, gap))))
    }

    @Test(arguments: [0, 100, 800])
    func fundedDestinationsNeverSuggestMoreThanTheirRemainingTarget(gap: Int) {
        var session = make(available: 600, otherAvailable: 200)
        session.accounts[2].target = .init(targetAmount: 1_000, underfundedAmount: Int64(gap))
        session.choose(.category("other"))
        #expect(session.amount == Decimal(min(600, gap)))
        #expect(session.canApply == (gap > 0))
        // This is a suggestion, not a restriction on a deliberate manual move.
        session.calculator = AmountCalculator(amount: 600, minorUnit: 2)
        #expect(session.canApply)
    }

    @Test(arguments: [100, 500, 800])
    func coveringUsesTheTargetGapWhenItExceedsOverspending(gap: Int) {
        var session = make(available: -300, rta: 600)
        session.accounts[1].target = .init(targetAmount: 1_000, underfundedAmount: Int64(gap))
        session.choose(.readyToAssign)
        #expect(session.amount == Decimal(min(600, max(300, gap))))
        #expect(session.remaining == Decimal(max(0, gap - 600)))
    }

    @Test(arguments: [-200, 0, 200])
    func switchingBackToOutgoingRequiresADestinationUnlessRTAIsNegative(rta: Int) {
        var session = make(available: 500, rta: Decimal(rta))
        session.flipDirection()
        session.choose(.category("other"))
        session.flipDirection()
        #expect(session.direction == .outgoing)
        #expect(session.counterpart == (rta < 0 ? .readyToAssign : nil))
        #expect(session.canApply == (rta < 0))
    }

    private func make(
        available: Decimal, rta: Decimal = 200, otherAvailable: Decimal = 700, minorUnit: Int = 2
    ) -> BudgetMoneyMoveSession {
        .init(
            workspaceID: "workspace", yearMonth: 202609, anchor: .category("anchor"),
            accounts: [
                .init(
                    endpoint: .readyToAssign, name: "Ready to Assign", groupName: "Unassigned",
                    assigned: 0, available: rta),
                .init(
                    endpoint: .category("anchor"), name: "Anchor", groupName: "Everyday",
                    assigned: 1_000, available: available),
                .init(
                    endpoint: .category("other"), name: "Other", groupName: "Everyday",
                    assigned: 1_000, available: otherAvailable),
            ], minorUnit: minorUnit)
    }
}
