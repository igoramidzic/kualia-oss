import CoreGraphics
import Foundation
import Testing

@testable import Kualia

@MainActor
struct AccountEditorTests {
    @Test
    func draftPhotoWaitsForAccountCreationAndReusesItsUploadAfterSaveFailure() async throws {
        let draft = EntityLogoDraft()
        let data = Data([1, 2, 3])
        let reference = draft.stagePhoto(data)
        draft.select(.custom(reference))
        #expect(draft.photoData == data)
        #expect(draft.previewURL == nil)
        var uploads = 0
        var saves = 0
        let client = EntityLogoClient(
            search: { _ in [] },
            upload: { uploaded in
                #expect(uploaded == data)
                uploads += 1
                return "https://example.com/photo.jpg"
            },
            save: { choice in
                #expect(choice == .custom("https://example.com/photo.jpg"))
                saves += 1
                if saves == 1 { throw CancellationError() }
            })
        #expect(uploads == 0)
        do {
            try await draft.persist(using: client)
            Issue.record("Expected the first logo save to fail")
        } catch {}
        try await draft.persist(using: client)
        #expect(uploads == 1)
        #expect(saves == 2)
    }

    @Test
    func choosingASearchedLogoReplacesTheStagedPhotoWithoutUploadingIt() async throws {
        let draft = EntityLogoDraft()
        draft.select(.custom(draft.stagePhoto(Data([1]))))
        draft.select(.custom("https://example.com/bank.png"))
        #expect(draft.photoData == nil)
        #expect(draft.previewURL == "https://example.com/bank.png")
        var saved: EntityLogoChoice?
        try await draft.persist(
            using: EntityLogoClient(
                search: { _ in [] },
                upload: { _ in
                    Issue.record("A searched logo must not upload a photo")
                    return "unexpected"
                }, save: { saved = $0 }))
        #expect(saved == .custom("https://example.com/bank.png"))
        draft.select(.remove)
        #expect(draft.previewURL == nil)
        #expect(draft.photoData == nil)
    }

    @Test(arguments: [CGFloat(90), CGFloat(89)])
    func balanceRevealWaitsForScrollCapacityAtAndNearTheBottom(currentOffset: CGFloat) throws {
        let target = CGRect(x: 24, y: 620, width: 340, height: 140)
        let offset = try #require(
            BudgetAssignmentVisibility.offset(
                target: target,
                viewport: CGRect(x: 0, y: currentOffset, width: 390, height: 454),
                contentHeight: 850))
        let request = AccountBalanceRevealRequest(sessionID: UUID(), offset: offset)
        #expect(!request.canApply(contentHeight: 850, viewportHeight: 760))
        #expect(request.canApply(contentHeight: 850, viewportHeight: 486))
        #expect(target.maxY - offset < 486 - 32)
    }

    @Test
    func cancelRestoresTheBalanceAndDirectionWhileDoneKeepsEdits() {
        var input = AccountOpeningBalanceInput(minorUnit: 2)
        input.calculator = AmountCalculator(amount: 12_345, minorUnit: 2)
        input.isNegative = true
        input.beginEditing()
        input.calculator.appendDigit(9)
        input.isNegative = false
        #expect(input.amount == 9)
        input.cancelEditing()
        #expect(input.amount == -12_345)
        #expect(input.calculator.expression == "123.45")
        input.beginEditing()
        input.calculator.appendDigit(8)
        input.finishEditing()
        input.cancelEditing()
        #expect(input.amount == -8)
    }

    @Test(arguments: [Int64(-50_000), 0, 50_000, Int64.max, Int64.min])
    func accountCreationReportsOnlyTheBankingStartingBalanceInRTA(amount: Int64) {
        for type in ["banking_checking", "banking_savings", "banking_cash"] {
            let summary = AccountCreationSummary(
                accountID: "new", name: "New", accountType: type, startingBalance: amount)
            #expect(summary.readyToAssignDelta == amount)
        }
        for type in [
            "credit_credit_card", "credit_line_of_credit", "loan_mortgage",
            "investment_brokerage", "investment_ira",
        ] {
            let summary = AccountCreationSummary(
                accountID: "new", name: "New", accountType: type, startingBalance: amount)
            #expect(summary.readyToAssignDelta == 0)
            #expect(summary.startingBalance == amount)
        }
    }

    @Test
    func startingBalanceScrollsAboveThePeekAndBottomFade() throws {
        let layout = PeekLayout(
            containerHeight: 760, expansionHeight: 274, isPresented: true,
            isCompactPresented: false, compactHeight: 0)
        let target = CGRect(x: 24, y: 620, width: 340, height: 140)
        let viewportHeight = layout.foregroundHeight - 32
        let offset = try #require(
            BudgetAssignmentVisibility.offset(
                target: target,
                viewport: CGRect(x: 0, y: 220, width: 390, height: viewportHeight),
                contentHeight: 850))
        #expect(offset > 220)
        #expect(target.maxY - offset <= viewportHeight - 12)
        #expect(
            BudgetAssignmentVisibility.offset(
                target: target,
                viewport: CGRect(x: 0, y: offset, width: 390, height: viewportHeight),
                contentHeight: 850) == nil)
    }

    @Test
    func openingBalanceUsesCentsFirstInputAndPreservesDirection() {
        var input = AccountOpeningBalanceInput(minorUnit: 2)
        for digit in [1, 2, 3, 4, 5, 6] { input.calculator.appendDigit(digit) }
        #expect(input.amount == 123_456)
        input.isNegative = true
        #expect(input.amount == -123_456)
        #expect(input.calculator.amount == 123_456)
        input.isNegative = false
        #expect(input.amount == 123_456)
        input.calculator.clear()
        #expect(input.amount == 0)
    }

    @Test
    func unfinishedAndInvalidCalculationsCannotBecomeStartingBalances() {
        var input = AccountOpeningBalanceInput(minorUnit: 2)
        input.calculator.appendDigit(5)
        input.calculator.appendDigit(0)
        input.calculator.appendOperation(.add)
        #expect(input.amount == nil)
        #expect(input.previewAmount == 50)
        input.isNegative = true
        #expect(input.previewAmount == -50)
        input.calculator.appendDigit(2)
        input.calculator.appendDigit(5)
        #expect(input.amount == -75)
        input.calculator.resolve()
        #expect(input.amount == -75)
        input.calculator.appendOperation(.divide)
        input.calculator.appendDigit(0)
        #expect(input.amount == nil)
        #expect(input.previewAmount == nil)
        #expect(input.calculator.error == .divideByZero)
    }

    @Test(arguments: [0, 2, 3, 6])
    func openingBalanceUsesWorkspacePrecision(minorUnit: Int) {
        var input = AccountOpeningBalanceInput(minorUnit: minorUnit)
        for digit in [1, 2, 3] { input.calculator.appendDigit(digit) }
        #expect(input.amount == 123)
        #expect(input.calculator.minorUnit == minorUnit)
        input.calculator.deleteLast()
        #expect(input.amount == 12)
    }

    @Test
    func openingBalanceRejectsOverflowAndNegativeCalculatorResults() {
        var input = AccountOpeningBalanceInput(minorUnit: 2)
        input.calculator = AmountCalculator(amount: Int64.max, minorUnit: 2)
        #expect(input.amount == Int64.max)
        input.isNegative = true
        #expect(input.amount == -Int64.max)
        input.calculator.appendOperation(.add)
        input.calculator.appendDigit(1)
        #expect(input.amount == nil)
        input.calculator.clear()
        input.calculator.appendOperation(.subtract)
        input.calculator.appendDigit(1)
        #expect(input.amount == nil)
        #expect(input.calculator.error == .negativeAmount)
    }
}
