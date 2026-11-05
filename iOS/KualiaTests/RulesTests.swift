import Combine
import ConvexMobile
import Foundation
import Testing

@testable import Kualia

@MainActor
struct RuleModelTests {
    @Test func rulesNeedNoNameAndPreserveNamesFromOtherClients() {
        var draft = RuleDraft(currency: "USD")
        draft.categoryID = "category"
        draft.merchantName = [.init(value: "coffee")]
        #expect(draft.isValid)
        #expect(draft.normalizedName == "coffee")
        draft.name = "Existing custom name"
        #expect(draft.normalizedName == "Existing custom name")
        #expect(RuleEditorSubmission().applyExisting)
        #expect(!RuleEditorSubmission(ruleID: "existing").applyExisting)
    }

    @Test(arguments: RuleConditionKind.allCases)
    func choosingAStarterOpensOnlyItsConditionWithoutCompletingIt(_ kind: RuleConditionKind) {
        var draft = RuleDraft(currency: "USD")
        draft.addCondition(kind)
        #expect(draft.conditionKinds == [kind])
        #expect(!draft.hasConfiguredConditions)
        let original = draft
        draft.addCondition(kind)
        #expect(draft == original)
    }

    @Test func conditionsMustBeValidAndNonemptyBeforeContinuing() {
        var draft = RuleDraft(currency: "USD")
        #expect(!draft.hasConfiguredConditions)
        draft.categoryID = "category"
        #expect(!draft.isValid)
        draft.merchantName = [.init(value: "   ")]
        #expect(!draft.hasConfiguredConditions)
        draft.merchantName[0].value = "Coffee"
        #expect(draft.hasConfiguredConditions)
        #expect(draft.isValid)
        draft.merchantName = []
        draft.bankAccountIDs = ["checking"]
        #expect(draft.hasConfiguredConditions)
    }

    @Test func changingBetweenTextTypesKeepsAlternativesAndMatchMode() {
        var draft = RuleDraft(currency: "USD")
        draft.merchantName = [
            .init(matchType: .exactlyMatches, value: "Coffee"), .init(value: "Cafe"),
        ]
        let original = draft.merchantName
        draft.changeConditionKind(from: .merchant, to: .statement)
        #expect(draft.merchantName.isEmpty)
        #expect(draft.originalStatement == original)
        draft.changeConditionKind(from: .statement, to: .merchant)
        #expect(draft.merchantName == original)
        #expect(draft.originalStatement.isEmpty)
    }

    @Test func changingBetweenAmountAndTextResetsValuesAndOperators() {
        var draft = RuleDraft(currency: "USD")
        draft.merchantName = [.init(matchType: .exactlyMatches, value: "Coffee")]
        draft.bankAccountIDs = ["checking"]
        draft.changeConditionKind(from: .merchant, to: .amount)
        #expect(draft.merchantName.isEmpty)
        #expect(draft.amount.count == 1)
        #expect(draft.amount.first?.value == "")
        #expect(!draft.hasConfiguredConditions)
        draft.amount = [.init(comparison: .between, value: "-20", valueTo: "-10")]
        draft.changeConditionKind(from: .amount, to: .statement)
        #expect(draft.amount.isEmpty)
        #expect(draft.originalStatement.first?.value == "")
        #expect(draft.originalStatement.first?.matchType == .contains)
        #expect(draft.bankAccountIDs == ["checking"])
    }

    @Test func switchingCannotOverwriteAnotherConditionAndCommittingKeepsActions() {
        var draft = validDraft()
        draft.merchantName = [.init(value: "Merchant")]
        draft.originalStatement = [.init(value: "Statement")]
        let original = draft
        draft.changeConditionKind(from: .merchant, to: .statement)
        #expect(draft == original)
        var working = draft
        working.merchantName[0].value = "New merchant"
        working.categoryID = "unrelated"
        draft.copyConditions(from: working)
        #expect(draft.merchantName[0].value == "New merchant")
        #expect(draft.categoryID == original.categoryID)
    }

    @Test func backendRuleDecodesEveryConditionAndSignedInt64Values() throws {
        let rule = try JSONDecoder().decode(TransactionRule.self, from: Data(ruleJSON.utf8))
        #expect(rule.id == "rule")
        #expect(rule.conditions.originalStatement == [.init(matchType: .contains, value: "COFFEE")])
        #expect(rule.conditions.merchantName == [.init(matchType: .exactlyMatches, value: "Cafe")])
        #expect(
            rule.conditions.amount == [.init(comparison: .between, value: -2500, valueTo: -500)])
        #expect(rule.conditions.bankAccountId == ["checking", "card"])
        #expect(rule.actions == .init(setMerchantId: "merchant", setCategoryId: "category"))
        #expect(rule.usageCount == 12)
        #expect(rule.priority == 2.5)
    }

    @Test func malformedInt64PayloadIsRejectedWithoutCrashing() {
        let json = #"{"operator":"equals","value":{"$integer":"AA=="}}"#
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(RuleAmountCondition.self, from: Data(json.utf8))
        }
    }

    @Test func exactSignedParsingCoversCurrencyPrecisionAndInt64Bounds() {
        #expect(RuleMoney.parse("-25.00", minorUnit: 2) == -2500)
        #expect(RuleMoney.parse("+5.25", minorUnit: 2) == 525)
        #expect(RuleMoney.parse("−0.01", minorUnit: 2) == -1)
        #expect(RuleMoney.parse("12", minorUnit: 0) == 12)
        #expect(RuleMoney.parse("1.234", minorUnit: 3) == 1234)
        #expect(RuleMoney.parse("-92233720368547758.08", minorUnit: 2) == Int64.min)
        #expect(RuleMoney.parse("92233720368547758.07", minorUnit: 2) == Int64.max)
        for text in ["", ".", "--1", "1.234", "1e3", "nan", "1,234.00", "92233720368547758.08"] {
            #expect(RuleMoney.parse(text, minorUnit: 2) == nil)
        }
        #expect(RuleMoney.input(Int64.min, minorUnit: 2) == "-92233720368547758.08")
        #expect(RuleMoney.minorUnit(currency: "JPY") == 0)
        #expect(RuleMoney.minorUnit(currency: "KWD") == 3)
    }

    @Test func editingRoundTripsAllAlternativesAndUnavailableSelections() throws {
        let rule = try JSONDecoder().decode(TransactionRule.self, from: Data(ruleJSON.utf8))
        let draft = RuleDraft(rule: rule, currency: "USD", minorUnit: 2)
        #expect(draft.isValid)
        #expect(draft.conditions == rule.conditions)
        #expect(draft.actions == rule.actions)
        #expect(draft.priorityValue == 2.5)
        #expect(draft.bankAccountIDs == ["checking", "card"])
        #expect(draft.amount.first?.value == "-25.00")
        #expect(draft.amount.first?.valueTo == "-5.00")
    }

    @Test func draftValidationExplainsIncompleteConditionsAndInvalidRanges() {
        var draft = validDraft()
        #expect(draft.isValid)
        draft.merchantName = [.init(value: "  ")]
        #expect(draft.conditions == nil)
        #expect(draft.validationMessage?.contains("text") == true)
        draft.merchantName = []
        draft.amount = [.init(comparison: .between, value: "-5", valueTo: "-25")]
        #expect(draft.validationMessage?.contains("less than or equal") == true)
        draft.amount[0].valueTo = ""
        #expect(draft.validationMessage?.contains("both ends") == true)
        draft.amount[0].valueTo = "-5"
        #expect(draft.isValid)
        draft.priority = "nan"
        #expect(!draft.isValid)
        draft.priority = "-1"
        #expect(draft.isValid)
        #expect(RulePresentation.parsePriority("1,25", locale: Locale(identifier: "de_DE")) == 1.25)
        draft.priority = "0"
        draft.categoryID = nil
        #expect(draft.validationMessage?.contains("merchant or category") == true)
    }

    @Test func emptyConditionRulesRemainReadableButCannotBeSaved() {
        var draft = validDraft()
        draft.bankAccountIDs = []
        #expect(draft.conditions?.isEmpty == true)
        #expect(!draft.isValid)
        #expect(
            RulePresentation.conditionLines(fixture(), choices: .init(), currency: "USD") == [
                "Every transaction"
            ])
    }

    @Test func savePayloadKeepsConvexIntsAndReplacesClearedConditionsAndActions() throws {
        var draft = validDraft()
        draft.amount = [.init(comparison: .between, value: "-25.00", valueTo: "-5.00")]
        draft.bankAccountIDs = ["checking", "card"]
        let request = RuleSaveRequest(workspaceID: "workspace", draft: draft, ruleID: "rule")
        let encoded = try request.arguments.convexEncode()
        let object = try #require(
            JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String: NSObject])
        let conditions = try #require(object["conditions"] as? [String: NSObject])
        let amount = try #require((conditions["amount"] as? [[String: NSObject]])?.first)
        #expect(amount["operator"] as? String == "between")
        #expect(amount["value"] is [String: String])
        #expect(conditions["bankAccountId"] as? [String] == ["checking", "card"])
        #expect(object["priority"] == nil)
        #expect(request.function == "transactionRules:updateRule")
        draft.amount = []
        draft.bankAccountIDs = []
        draft.categoryID = nil
        draft.merchantID = "merchant"
        let cleared = RuleSaveRequest(workspaceID: "workspace", draft: draft, ruleID: "rule")
        let reset =
            try JSONSerialization.jsonObject(with: Data(cleared.arguments.convexEncode().utf8))
            as? [String: NSObject]
        #expect((reset?["conditions"] as? [String: NSObject])?.isEmpty == true)
        #expect((reset?["actions"] as? [String: String]) == ["setMerchantId": "merchant"])
    }

    @Test func summariesKeepOrAlternativesDistinctFromAndGroups() throws {
        var rule = try JSONDecoder().decode(TransactionRule.self, from: Data(ruleJSON.utf8))
        rule.conditions.merchantName.append(.init(matchType: .contains, value: "Roaster"))
        let lines = RulePresentation.conditionLines(
            rule, choices: .init(), currency: "USD", minorUnit: 2)
        #expect(lines.count == 4)
        #expect(lines[1].contains(" or "))
        #expect(lines[2].contains("inclusive"))
        #expect(lines[3] == "Account is Unavailable account or Unavailable account")
        #expect(RulePresentation.actionLines(rule, choices: .init()).count == 2)
    }
}

@MainActor
struct RulesStoreTests {
    @Test func constructingStoreDoesNotLoadRulesUntilItsPageStarts() {
        let mock = RulesMock(rules: [])
        let store = mock.makeStore(start: false)

        #expect(mock.ruleSubscriptions == 0)
        #expect(mock.choiceSubscriptions == 0)
        store.start()
        #expect(mock.ruleSubscriptions == 1)
        #expect(mock.choiceSubscriptions == 1)
        store.stop()
    }

    @Test func newRuleSavesThenAppliesByReturnedID() async throws {
        let mock = RulesMock(rules: [])
        let store = mock.makeStore()
        let draft = validDraft()
        let submission = RuleEditorSubmission()
        store.preview(conditions: draft.conditions)
        try await Task.sleep(for: .milliseconds(450))
        mock.countSubjects[0].send(3)
        #expect(await store.saveFromEditor(draft: draft, submission: submission))
        #expect(mock.savedIDs.count == 1)
        #expect(mock.savedIDs[0] == nil)
        #expect(mock.appliedIDs == ["created-rule"])
        #expect(submission.ruleID == "created-rule")
        #expect(store.notice?.contains("3 matching") == true)
    }

    @Test func disablingApplySavesWithoutWaitingForPreview() async {
        let mock = RulesMock(rules: [])
        let store = mock.makeStore()
        let submission = RuleEditorSubmission()
        submission.applyExisting = false
        #expect(await store.saveFromEditor(draft: validDraft(), submission: submission))
        #expect(mock.savedIDs.count == 1)
        #expect(mock.appliedIDs.isEmpty)
    }

    @Test func enabledApplyRequiresCurrentCalculatedCount() async {
        let mock = RulesMock(rules: [])
        let store = mock.makeStore()
        #expect(await store.saveFromEditor(draft: validDraft(), submission: .init()) == false)
        #expect(mock.savedIDs.isEmpty)
        #expect(store.actionError?.contains("match count") == true)
    }

    @Test func failedApplyRetriesSameRuleWithoutDuplicateCreation() async throws {
        let mock = RulesMock(rules: [])
        let store = mock.makeStore()
        let draft = validDraft()
        let submission = RuleEditorSubmission()
        store.preview(conditions: draft.conditions)
        try await Task.sleep(for: .milliseconds(450))
        mock.countSubjects[0].send(3)
        mock.applyError = RulesTestError.offline
        #expect(await store.saveFromEditor(draft: draft, submission: submission) == false)
        #expect(submission.ruleID == "created-rule")
        #expect(submission.savedDraft == draft)
        #expect(store.actionError?.contains("Rule saved") == true)
        mock.applyError = nil
        #expect(await store.saveFromEditor(draft: draft, submission: submission))
        #expect(mock.savedIDs.count == 1)
        #expect(mock.appliedIDs == ["created-rule"])
    }

    @Test func editorStopDuringSavePreventsLateApplication() async {
        let mock = RulesMock(rules: [])
        let store = mock.makeStore()
        let submission = RuleEditorSubmission()
        submission.applyExisting = false
        mock.holdsWrite = true
        let saving = Task {
            await store.saveFromEditor(draft: validDraft(), submission: submission)
        }
        while mock.continuation == nil { await Task.yield() }
        store.stop()
        mock.continuation?.resume()
        #expect(await saving.value == false)
        #expect(mock.appliedIDs.isEmpty)
        #expect(submission.ruleID == nil)
        #expect(!store.isSaving)
    }

    @Test func disablingApplyAfterFailureFinishesSavedRule() async throws {
        let mock = RulesMock(rules: [])
        let store = mock.makeStore()
        let draft = validDraft()
        let submission = RuleEditorSubmission()
        store.preview(conditions: draft.conditions)
        try await Task.sleep(for: .milliseconds(450))
        mock.countSubjects[0].send(3)
        mock.applyError = RulesTestError.offline
        #expect(await store.saveFromEditor(draft: draft, submission: submission) == false)
        submission.applyExisting = false
        #expect(await store.saveFromEditor(draft: draft, submission: submission))
        #expect(mock.savedIDs.count == 1)
        #expect(mock.appliedIDs.isEmpty)
    }

    @Test func equalPriorityRulesPreserveTheBackendWinnerOrder() {
        let mock = RulesMock(rules: [fixture(id: "z-first"), fixture(id: "a-second")])
        #expect(mock.makeStore().rules.map(\.id) == ["z-first", "a-second"])
    }

    @Test func workspaceFilteringAndCatalogFailurePreserveTheRuleList() {
        var foreign = fixture(id: "foreign")
        foreign = .init(
            id: foreign.id, workspaceId: "other", name: foreign.name, isActive: true,
            priority: 0, conditions: .init(), actions: .init())
        var deleted = fixture(id: "deleted")
        deleted.isDeleted = true
        let mock = RulesMock(rules: [
            fixture(id: "later", priority: 5), foreign, fixture(), deleted,
        ])
        let store = mock.makeStore()
        #expect(store.rules.map(\.id) == ["rule", "later"])
        #expect(store.hasLoaded)
        mock.choices.send(completion: .failure(RulesTestError.offline))
        #expect(store.choicesError != nil)
        #expect(store.loadError == nil)
        #expect(store.rules.count == 2)
    }

    @Test func ruleLoadFailureDoesNotBecomeEmptyState() {
        let mock = RulesMock(rules: [fixture()])
        let store = mock.makeStore()
        mock.rules.send(completion: .failure(RulesTestError.offline))
        #expect(store.loadError != nil)
        #expect(store.rules.count == 1)
        #expect(store.hasLoaded)
    }

    @Test func mutationFailurePreservesRulesAndAllowsRetry() async {
        let mock = RulesMock(rules: [fixture()])
        let store = mock.makeStore()
        mock.error = RulesTestError.offline
        #expect(await store.delete(rule: fixture()) == false)
        #expect(store.rules.count == 1)
        #expect(store.actionError != nil)
        #expect(!store.isSaving)
        mock.error = nil
        #expect(await store.setActive(false, rule: fixture()))
        #expect(store.actionError == nil)
    }

    @Test func stoppedStoreRejectsLateWritesAndDuplicateSubmissions() async {
        let mock = RulesMock(rules: [fixture()])
        let store = mock.makeStore()
        mock.holdsWrite = true
        let first = Task { await store.save(draft: validDraft()) }
        while mock.continuation == nil { await Task.yield() }
        #expect(store.isSaving)
        #expect(await store.save(draft: validDraft()) == false)
        #expect(mock.writes == 1)
        store.stop()
        mock.continuation?.resume()
        #expect(await first.value == false)
        #expect(store.notice == nil)
        #expect(!store.isSaving)
    }

    @Test func missingTargetsAndChangedApplySnapshotsAreRejected() async {
        let mock = RulesMock(rules: [fixture()])
        let store = mock.makeStore()
        #expect(await store.save(draft: validDraft(), ruleID: "missing") == false)
        #expect(await store.delete(rule: fixture(id: "missing")) == false)
        var changed = fixture()
        changed.actions.setCategoryId = "new-category"
        mock.rules.send([changed])
        #expect(await store.applyToExisting(rule: fixture()) == nil)
        #expect(store.actionError?.contains("changed or was deleted") == true)
        #expect(mock.writes == 0)
        #expect(await store.applyToExisting(rule: changed) == 3)
    }

    @Test func previewDebouncesAndIgnoresAnOlderConditionResult() async throws {
        let mock = RulesMock(rules: [fixture()])
        let store = mock.makeStore()
        let first = RuleConditions(merchantName: [.init(matchType: .contains, value: "First")])
        let second = RuleConditions(merchantName: [.init(matchType: .contains, value: "Second")])
        store.preview(conditions: first)
        store.preview(conditions: second)
        try await Task.sleep(for: .milliseconds(450))
        #expect(mock.countRequests == [second])
        mock.countSubjects[0].send(5)
        #expect(store.matchCount == 5)
        store.preview(conditions: first)
        #expect(store.matchCount == nil)
        mock.countSubjects[0].send(99)
        #expect(store.matchCount == nil)
        try await Task.sleep(for: .milliseconds(450))
        mock.countSubjects[1].send(2)
        #expect(store.matchCount == 2)
        store.stop()
        mock.countSubjects[1].send(100)
        #expect(store.matchCount == nil)
        #expect(!store.isLoadingPreview)
    }
}

private enum RulesTestError: Error { case offline }

@MainActor
private final class RulesMock {
    let rules: CurrentValueSubject<[TransactionRule], Error>
    let choices = CurrentValueSubject<RuleChoices, Error>(.init())
    var error: Error?
    var writes = 0
    var savedIDs: [String?] = []
    var savedDrafts: [RuleDraft] = []
    var appliedIDs: [String] = []
    var applyError: Error?
    var holdsWrite = false
    var continuation: CheckedContinuation<Void, Never>?
    var countRequests: [RuleConditions] = []
    var countSubjects: [PassthroughSubject<Int, Error>] = []
    var ruleSubscriptions = 0
    var choiceSubscriptions = 0

    init(rules: [TransactionRule]) { self.rules = .init(rules) }

    func makeStore(start: Bool = true) -> RulesStore {
        let store = RulesStore(
            workspaceID: "workspace", currency: "USD", minorUnit: 2,
            client: .init(
                watchRules: { _ in
                    self.ruleSubscriptions += 1
                    return self.rules.eraseToAnyPublisher()
                },
                watchChoices: { _ in
                    self.choiceSubscriptions += 1
                    return self.choices.eraseToAnyPublisher()
                },
                save: { _, draft, id in
                    try await self.write()
                    self.savedIDs.append(id)
                    self.savedDrafts.append(draft)
                    return id ?? "created-rule"
                },
                setActive: { _, _, _ in try await self.write() },
                delete: { _, _ in try await self.write() },
                apply: { _, id in
                    if let applyError = self.applyError { throw applyError }
                    try await self.write()
                    self.appliedIDs.append(id)
                    return 3
                },
                count: { _, conditions in
                    self.countRequests.append(conditions)
                    let subject = PassthroughSubject<Int, Error>()
                    self.countSubjects.append(subject)
                    return subject.eraseToAnyPublisher()
                }))
        if start { store.start() }
        return store
    }

    private func write() async throws {
        writes += 1
        if let error { throw error }
        if holdsWrite { await withCheckedContinuation { continuation = $0 } }
    }
}

@MainActor
private func fixture(id: String = "rule", priority: Double = 0) -> TransactionRule {
    .init(
        id: id, workspaceId: "workspace", name: "Coffee", isActive: true,
        priority: priority, conditions: .init(), actions: .init(setCategoryId: "category"))
}

@MainActor
private func validDraft() -> RuleDraft {
    var draft = RuleDraft(currency: "USD", minorUnit: 2)
    draft.name = "Coffee"
    draft.bankAccountIDs = ["checking"]
    draft.categoryID = "category"
    return draft
}

private let ruleJSON =
    #"{"_id":"rule","workspaceId":"workspace","name":"Coffee","isActive":true,"priority":2.5,"conditions":{"originalStatement":[{"matchType":"contains","value":"COFFEE"}],"merchantName":[{"matchType":"exactlyMatches","value":"Cafe"}],"amount":[{"operator":"between","value":{"$integer":"PPb////////="},"valueTo":{"$integer":"DP7////////="}}],"bankAccountId":["checking","card"]},"actions":{"setMerchantId":"merchant","setCategoryId":"category"},"usageCount":12,"lastUsedAt":"2026-09-01T12:00:00Z","isDeleted":false}"#
