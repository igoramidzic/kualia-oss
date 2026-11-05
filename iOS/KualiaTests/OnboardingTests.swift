import Foundation
import Testing

@testable import Kualia

struct OnboardingTests {
    @Test(arguments: [Int64(3_000), Int64(0), Int64(-500)])
    func assignmentUsesBudgetPeekHoldUntilTheKeypadFinishesClosing(remaining: Int64) throws {
        var accountReveal = OnboardingBalanceReveal()
        accountReveal.beginAccountSetup()
        accountReveal.update(5_000, canContinue: true)
        #expect(accountReveal.amount == 0)
        accountReveal.finishAccountSetup(balance: 5_000, canContinue: true)

        var peek = BudgetPeekPresentation()
        var pad = PeekPresentation(initiallyPresented: true)
        peek.update(
            .init(
                workspaceID: "budget", readyToAssign: accountReveal.amount,
                isEditing: true, isActive: true))
        peek.beginKeypadEditing()
        let id = try #require(pad.sessionID)
        // This happens synchronously before finishEditing publishes its optimistic balance.
        peek.beginKeypadClosing(id: id, hasChanges: true)
        pad.beginClosing()
        let updated = BudgetPeekPresentation.Context(
            workspaceID: "budget", readyToAssign: Decimal(remaining),
            isEditing: false, isActive: true)
        peek.update(updated)
        #expect(peek.displayedReadyToAssign == 5_000)
        #expect(peek.tone == .positive)
        #expect(peek.isVisible)
        #expect(peek.completionTaskID == nil)

        pad.finishClosing(sessionID: id)
        #expect(pad.sessionID == nil)
        peek.finishKeypadClosing(id: id, context: updated)
        #expect(peek.displayedReadyToAssign == Decimal(remaining))
        #expect((peek.completionTaskID != nil) == (remaining == 0))
        #expect(peek.tone == (remaining < 0 ? .negative : .positive))
    }

    @Test
    func retiredCurrencyStepPreservesAnswersAndResumesBeforeBudgetCreation() throws {
        var checkpoint = OnboardingCheckpoint(step: .household, currencyCode: "JPY")
        checkpoint.answers.housing = "own"
        let data = try JSONEncoder().encode(checkpoint)
        let legacy = String(decoding: data, as: UTF8.self).replacingOccurrences(
            of: "\"step\":\"household\"", with: "\"step\":\"currency\"")
        var restored = try JSONDecoder().decode(OnboardingCheckpoint.self, from: Data(legacy.utf8))
        restored.reconcile(workspaceID: nil)
        #expect(restored.step == .household)
        #expect(restored.currencyCode == "JPY")
        #expect(restored.answers.housing == "own")
        #expect(!OnboardingStep.allCases.map(\.rawValue).contains("currency"))
    }

    @Test
    func anExistingBudgetDoesNotReopenQuestionnaire() {
        var checkpoint = OnboardingCheckpoint(step: .household, workspaceID: "budget")
        checkpoint.reconcile(workspaceID: "budget")
        #expect(checkpoint.step == .categories)
        var missingBudget = OnboardingCheckpoint(step: .accounts)
        missingBudget.reconcile(workspaceID: nil)
        #expect(missingBudget.step == .household)
    }

    @Test
    func newOnboardingStartsWithGoalsAndMovesThroughOneQuestionAtATime() {
        var step = OnboardingCheckpoint().step
        var questions = [step]
        while let next = step.nextQuestion {
            questions.append(next)
            step = next
        }
        #expect(questions == [.priorities, .housing, .transport, .household])
        #expect(OnboardingStep.allCases.first == .priorities)
    }

    @Test
    func retiredIntroAndCombinedQuestionsPreserveTheDraft() throws {
        for (oldStep, expected): (String, OnboardingStep) in [
            ("intro", .priorities), ("envelopes", .priorities), ("lifestyle", .housing),
        ] {
            var checkpoint = OnboardingCheckpoint(step: .housing)
            checkpoint.answers.housing = "own"
            checkpoint.answers.transportation = ["transit"]
            let encoded = String(decoding: try JSONEncoder().encode(checkpoint), as: UTF8.self)
                .replacingOccurrences(of: "\"step\":\"housing\"", with: "\"step\":\"\(oldStep)\"")
            let restored = try JSONDecoder().decode(
                OnboardingCheckpoint.self, from: Data(encoded.utf8))
            #expect(restored.step == expected)
            #expect(restored.answers == checkpoint.answers)
        }
    }

    @Test
    func accountContinueAndBalanceRevealTogetherAfterDismissal() {
        var reveal = OnboardingBalanceReveal()
        reveal.beginAccountSetup()
        reveal.update(5_000, canContinue: true)
        #expect(reveal.amount == 0)
        #expect(!reveal.canContinue)
        reveal.finishAccountSetup(balance: 5_000, canContinue: true)
        #expect(reveal.amount == 5_000)
        #expect(reveal.canContinue)

        // Adding another account keeps the existing footer and peek in place.
        reveal.beginAccountSetup()
        reveal.update(8_000, canContinue: true)
        #expect(reveal.amount == 5_000)
        #expect(reveal.canContinue)
        reveal.finishAccountSetup(balance: 8_000, canContinue: true)
        #expect(reveal.amount == 8_000)
        #expect(reveal.canContinue)
    }

    @Test
    func accountEligibilityCanArriveAfterTheSheetCloses() {
        var reveal = OnboardingBalanceReveal()
        reveal.beginAccountSetup()
        reveal.finishAccountSetup(balance: 0, canContinue: false)
        #expect(!reveal.canContinue)
        // A positive balance alone is not proof of an eligible banking account.
        reveal.update(5_000, canContinue: false)
        #expect(!reveal.canContinue)
        reveal.update(5_000, canContinue: true)
        #expect(reveal.canContinue)
        #expect(reveal.amount == 5_000)
    }

    @Test
    func emptyRTAStaysHiddenUntilAnAccountAddsMoney() {
        var reveal = OnboardingBalanceReveal()
        #expect(!reveal.isVisible(hasAccounts: false, isEditing: false))
        #expect(!reveal.isVisible(hasAccounts: true, isEditing: false))
        reveal.beginAccountSetup()
        reveal.update(5_000, canContinue: true)
        #expect(!reveal.isVisible(hasAccounts: true, isEditing: false))
        reveal.finishAccountSetup(balance: 5_000, canContinue: true)
        #expect(reveal.isVisible(hasAccounts: true, isEditing: false))
        #expect(!reveal.isVisible(hasAccounts: false, isEditing: false))
        reveal.update(0, canContinue: false)
        #expect(!reveal.isVisible(hasAccounts: true, isEditing: false))
        #expect(reveal.isVisible(hasAccounts: true, isEditing: true))
        reveal.update(-100, canContinue: false)
        #expect(reveal.isVisible(hasAccounts: true, isEditing: false))
    }

    @Test
    func manualAssignmentsMustBeSavedAndCannotOverassign() {
        #expect(
            OnboardingAssignment.canContinue(
                assigned: 400, isPending: false, isEditing: false, hasError: false, readyToAssign: 0
            ))
        #expect(
            !OnboardingAssignment.canContinue(
                assigned: 400, isPending: true, isEditing: false, hasError: false, readyToAssign: 0)
        )
        #expect(
            !OnboardingAssignment.canContinue(
                assigned: 400, isPending: false, isEditing: true, hasError: false, readyToAssign: 0)
        )
        #expect(
            !OnboardingAssignment.canContinue(
                assigned: 400, isPending: false, isEditing: false, hasError: true, readyToAssign: 0)
        )
        #expect(
            !OnboardingAssignment.canContinue(
                assigned: 400, isPending: false, isEditing: false, hasError: false,
                readyToAssign: -1))
        for assigned: Int64 in [0, -400] {
            #expect(
                !OnboardingAssignment.canContinue(
                    assigned: assigned, isPending: false, isEditing: false, hasError: false,
                    readyToAssign: 1_000))
        }
    }

    @Test
    func bankingAccountsNeedPositiveBalancesAndOtherAssetsCannotQualify() {
        for type in ["banking_checking", "banking_savings", "banking_other", "banking_cash"] {
            #expect(OnboardingFunding.isFundedBankingAccount(type: type, balance: 1))
            #expect(!OnboardingFunding.isFundedBankingAccount(type: type, balance: 0))
            #expect(!OnboardingFunding.isFundedBankingAccount(type: type, balance: -100))
        }
        for type in ["credit_credit_card", "investment_brokerage", "loan_auto", "unknown"] {
            #expect(!OnboardingFunding.isFundedBankingAccount(type: type, balance: 100_000))
        }
    }

    @Test
    func accountsCannotBeSkippedUntilRealMoneyIsReadyToAssign() {
        #expect(
            OnboardingFunding.canContinue(
                hasLoaded: true, hasFundedBankingAccount: true, readyToAssign: 1))
        #expect(
            !OnboardingFunding.canContinue(
                hasLoaded: false, hasFundedBankingAccount: true, readyToAssign: 1))
        #expect(
            !OnboardingFunding.canContinue(
                hasLoaded: true, hasFundedBankingAccount: false, readyToAssign: 100))
        for balance: Decimal in [0, -100] {
            #expect(
                !OnboardingFunding.canContinue(
                    hasLoaded: true, hasFundedBankingAccount: true, readyToAssign: balance))
        }
    }

    @Test
    func aLegacyPracticeCompletionReturnsToFunding() {
        var checkpoint = OnboardingCheckpoint(
            step: .celebration, workspaceID: "budget", targetSaved: true, didPractice: true)
        checkpoint.reconcile(workspaceID: "budget")
        #expect(checkpoint.step == .accounts)
        #expect(!checkpoint.didPractice)
        #expect(checkpoint.targetSaved)
    }

    @Test
    func balancesWaitUntilTheAccountSheetHasDismissed() {
        var reveal = OnboardingBalanceReveal()
        reveal.update(1_000, canContinue: true)
        reveal.beginAccountSetup()
        reveal.update(10_000, canContinue: true)
        reveal.update(12_000, canContinue: true)
        #expect(reveal.amount == 1_000)
        #expect(reveal.isHolding)
        reveal.finishAccountSetup(balance: 12_000, canContinue: true)
        #expect(reveal.amount == 12_000)
        #expect(!reveal.isHolding)
        // A delayed subscription snapshot still updates after the dismissal.
        reveal.update(13_000, canContinue: true)
        #expect(reveal.amount == 13_000)
    }

    @Test
    func balanceRevealHandlesDecreasesCancellationAndRepeatedAccounts() {
        var reveal = OnboardingBalanceReveal()
        reveal.update(5_000, canContinue: true)
        reveal.beginAccountSetup()
        reveal.update(-200, canContinue: false)
        #expect(reveal.amount == 5_000)
        reveal.finishAccountSetup(balance: -200, canContinue: false)
        #expect(reveal.amount == -200)
        reveal.beginAccountSetup()
        reveal.finishAccountSetup(balance: -200, canContinue: false)
        #expect(reveal.amount == -200)
        reveal.beginAccountSetup()
        reveal.update(0, canContinue: false)
        #expect(reveal.amount == -200)
        reveal.finishAccountSetup(balance: 0, canContinue: false)
        #expect(reveal.amount == 0)
    }

    @Test
    func calculatorAmountsRoundTripWithoutLosingCurrencyPrecision() {
        for localeID in ["en_US", "de_DE", "fr_FR"] {
            let locale = Locale(identifier: localeID)
            for minorUnit in [0, 2, 3, 6] {
                for amount: Int64 in [1, 10_025, 9_007_199_254_740_991] {
                    let text = OnboardingAmount.text(
                        minorUnits: amount, minorUnit: minorUnit, locale: locale)
                    #expect(
                        OnboardingAmount.minorUnits(text, minorUnit: minorUnit, locale: locale)
                            == amount)
                }
            }
        }
        #expect(
            OnboardingAmount.minorUnits(
                OnboardingAmount.text(minorUnits: 0, minorUnit: 2), minorUnit: 2) == nil)
    }

    @Test
    func checkpointsAreScopedToTheSignedInUser() {
        #expect(
            OnboardingCheckpoint.key(userID: "first") != OnboardingCheckpoint.key(userID: "second"))
    }

    @Test
    func changedWorkspaceInvalidatesThePriorExercise() {
        var checkpoint = OnboardingCheckpoint(
            step: .celebration, workspaceID: "old", selectedCategoryID: "old-category",
            targetSaved: true, didAssignMoney: true)
        checkpoint.reconcile(workspaceID: "new")
        #expect(checkpoint.step == .accounts)
        #expect(checkpoint.selectedCategoryID == nil)
        #expect(!checkpoint.targetSaved)
        #expect(!checkpoint.didAssignMoney)
        #expect(!checkpoint.didPractice)
    }

    @Test
    func sameWorkspaceResumesAfterTheTargetWithoutLosingAnswers() {
        var checkpoint = OnboardingCheckpoint(
            step: .assign, workspaceID: "budget", selectedCategoryID: "groceries", targetSaved: true
        )
        checkpoint.answers.housing = "own"
        checkpoint.reconcile(workspaceID: "budget")
        #expect(checkpoint.step == .assign)
        #expect(checkpoint.selectedCategoryID == "groceries")
        #expect(checkpoint.answers.housing == "own")
    }

    @Test
    func checkpointsCannotSkipTheTargetOrPractice() {
        var missingTarget = OnboardingCheckpoint(step: .celebration, workspaceID: "budget")
        missingTarget.reconcile(workspaceID: "budget")
        #expect(missingTarget.step == .target)
        var missingPractice = OnboardingCheckpoint(
            step: .celebration, workspaceID: "budget", targetSaved: true)
        missingPractice.reconcile(workspaceID: "budget")
        #expect(missingPractice.step == .assign)
    }

    @Test
    func targetAmountsRespectCurrencyPrecisionAndLocale() {
        #expect(
            OnboardingAmount.minorUnits("100.25", minorUnit: 2, locale: Locale(identifier: "en_US"))
                == 10_025)
        #expect(
            OnboardingAmount.minorUnits("100,25", minorUnit: 2, locale: Locale(identifier: "de_DE"))
                == 10_025)
        #expect(OnboardingAmount.minorUnits("100", minorUnit: 0) == 100)
        #expect(
            OnboardingAmount.minorUnits("1.234", minorUnit: 3, locale: Locale(identifier: "en_US"))
                == 1_234)
        #expect(
            OnboardingAmount.minorUnits(
                "100.001", minorUnit: 2, locale: Locale(identifier: "en_US")) == nil)
        #expect(
            OnboardingAmount.minorUnits("100.50", minorUnit: 0, locale: Locale(identifier: "en_US"))
                == nil)
    }

    @Test
    func targetAmountsRejectInvalidZeroAndUnsafeValues() {
        for text in ["", ".", "-10", "0", "1a", "1e3", "NaN", "1,000", "9007199254740992"] {
            #expect(
                OnboardingAmount.minorUnits(text, minorUnit: 2, locale: Locale(identifier: "en_US"))
                    == nil)
        }
    }
}
