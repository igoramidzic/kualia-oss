import Combine
import ConvexMobile
import Foundation
import Observation

@MainActor
struct RulesClient {
    var watchRules: (String) -> AnyPublisher<[TransactionRule], Error>
    var watchChoices: (String) -> AnyPublisher<RuleChoices, Error>
    var save: (String, RuleDraft, String?) async throws -> String
    var setActive: (String, String, Bool) async throws -> Void
    var delete: (String, String) async throws -> Void
    var apply: (String, String) async throws -> Int
    var count: (String, RuleConditions) -> AnyPublisher<Int, Error>

    static func live(_ client: ConvexClientWithAuth<String>) -> Self {
        .init(
            watchRules: { workspaceID in
                client.subscribe(
                    to: "transactionRules:listRules", with: ["workspaceId": workspaceID],
                    yielding: [TransactionRule].self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            watchChoices: { workspaceID in
                let arguments: [String: ConvexEncodable?] = ["workspaceId": workspaceID]
                let merchants = client.subscribe(
                    to: "merchants:listMerchants", with: arguments,
                    yielding: [TransactionEditorMerchant].self)
                let categories = client.subscribe(
                    to: "categories:listCategoriesHierarchical", with: arguments,
                    yielding: [TransactionEditorCategoryHierarchy].self)
                let accounts = client.subscribe(
                    to: "bankAccounts:listBankAccounts", with: arguments,
                    yielding: [TransactionEditorAccount].self)
                return Publishers.CombineLatest3(merchants, categories, accounts).map {
                    merchants, categories, accounts in
                    RuleChoices(
                        merchants: TransactionEditorMerchant.pickerChoices(
                            merchants.filter { $0.isDeleted != true }
                        ).map {
                            .init(
                                id: $0.id, name: $0.title, groupName: $0.groupTitle,
                                logoURL: $0.logoURL?.absoluteString)
                        },
                        categories: categories.flatMap(\.selectableCategories).map {
                            .init(id: $0.id, name: $0.name, groupName: $0.groupName)
                        },
                        accounts: accounts.filter { $0.isDeleted != true }.map {
                            .init(
                                id: $0.id, name: $0.name,
                                groupName: $0.isClosed == true
                                    ? L10n.string("Closed accounts") : $0.pickerGroup,
                                logoURL: $0.resolvedLogoUrl, accountType: $0.accountType)
                        })
                }.mapError { $0 as Error }.eraseToAnyPublisher()
            },
            save: { workspaceID, draft, id in
                let request = RuleSaveRequest(workspaceID: workspaceID, draft: draft, ruleID: id)
                if let id {
                    let _: String? = try await client.mutation(
                        request.function, with: request.arguments)
                    return id
                }
                return try await client.mutation(request.function, with: request.arguments)
            },
            setActive: { workspaceID, id, active in
                let _: String? = try await client.mutation(
                    "transactionRules:updateRule",
                    with: ["workspaceId": workspaceID, "id": id, "isActive": active])
            },
            delete: { workspaceID, id in
                let _: String? = try await client.mutation(
                    "transactionRules:deleteRule", with: ["workspaceId": workspaceID, "id": id])
            },
            apply: { workspaceID, id in
                try await client.mutation(
                    "transactionRules:applyRuleToExisting",
                    with: ["workspaceId": workspaceID, "id": id])
            },
            count: { workspaceID, conditions in
                client.subscribe(
                    to: "transactionRules:countMatchingTransactions",
                    with: ["workspaceId": workspaceID, "conditions": conditions.arguments],
                    yielding: Int.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            })
    }
}

@MainActor
@Observable
final class RulesStore {
    let workspaceID: String
    let currency: String
    let minorUnit: Int
    private(set) var rules: [TransactionRule] = []
    private(set) var choices = RuleChoices()
    private(set) var hasLoaded = false
    private(set) var loadError: String?
    private(set) var choicesError: String?
    private(set) var isSaving = false
    var actionError: String?
    private(set) var notice: String?
    private(set) var matchCount: Int?
    private(set) var previewError: String?
    private(set) var isLoadingPreview = false
    @ObservationIgnored private let client: RulesClient
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var ruleGeneration = UUID()
    @ObservationIgnored private var choicesGeneration = UUID()
    @ObservationIgnored private var previewGeneration = UUID()
    @ObservationIgnored private var ruleSubscription: AnyCancellable?
    @ObservationIgnored private var choicesSubscription: AnyCancellable?
    @ObservationIgnored private var previewSubscription: AnyCancellable?
    @ObservationIgnored private var ruleDeadline: Task<Void, Never>?
    @ObservationIgnored private var choicesDeadline: Task<Void, Never>?
    @ObservationIgnored private var previewTask: Task<Void, Never>?
    @ObservationIgnored private var previewDeadline: Task<Void, Never>?
    @ObservationIgnored private var previewConditions: RuleConditions?

    init(workspaceID: String, currency: String, minorUnit: Int? = nil, client: RulesClient) {
        self.workspaceID = workspaceID
        self.currency = currency
        self.minorUnit = minorUnit ?? RuleMoney.minorUnit(currency: currency)
        self.client = client
    }

    convenience init(
        workspaceID: String, currency: String, minorUnit: Int? = nil,
        convexClient: ConvexClientWithAuth<String>
    ) {
        self.init(
            workspaceID: workspaceID, currency: currency, minorUnit: minorUnit,
            client: .live(convexClient))
    }

    func start() {
        guard !isActive else { return }
        isActive = true
        reload()
    }

    func stop() {
        isActive = false
        generation = UUID()
        ruleGeneration = UUID()
        choicesGeneration = UUID()
        ruleSubscription = nil
        choicesSubscription = nil
        ruleDeadline?.cancel()
        choicesDeadline?.cancel()
        isSaving = false
        clearPreview()
    }

    func reload() {
        guard isActive else { return }
        ruleSubscription = nil
        ruleGeneration = UUID()
        let request = ruleGeneration
        loadError = nil
        ruleDeadline?.cancel()
        ruleDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.ruleGeneration == request else { return }
            self.loadError = L10n.string("Your rules are taking longer to load. Try again.")
        }
        ruleSubscription = client.watchRules(workspaceID).sink { [weak self] completion in
            guard let self, self.ruleGeneration == request else { return }
            if case .failure = completion {
                self.ruleDeadline?.cancel()
                self.loadError = L10n.string(
                    "Couldn't refresh your rules. Check your connection and try again.")
            }
        } receiveValue: { [weak self] rules in
            guard let self, self.ruleGeneration == request else { return }
            self.ruleDeadline?.cancel()
            self.rules = rules.enumerated().filter {
                $0.element.workspaceId == self.workspaceID && !$0.element.isDeleted
            }.sorted {
                $0.element.priority == $1.element.priority
                    ? $0.offset < $1.offset : $0.element.priority < $1.element.priority
            }.map(\.element)
            self.hasLoaded = true
            self.loadError = nil
        }
        reloadChoices()
    }

    func reloadChoices() {
        guard isActive else { return }
        choicesSubscription = nil
        choicesGeneration = UUID()
        let request = choicesGeneration
        choicesError = nil
        choicesDeadline?.cancel()
        choicesDeadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            guard let self, self.choicesGeneration == request else { return }
            self.choicesError =
                L10n.string(
                    "Merchants, categories, and accounts are taking longer to load. Try again.")
        }
        choicesSubscription = client.watchChoices(workspaceID).sink { [weak self] completion in
            guard let self, self.choicesGeneration == request else { return }
            if case .failure = completion {
                self.choicesDeadline?.cancel()
                self.choicesError =
                    L10n.string("Couldn't refresh merchants, categories, and accounts. Try again.")
            }
        } receiveValue: { [weak self] choices in
            guard let self, self.choicesGeneration == request else { return }
            self.choicesDeadline?.cancel()
            self.choices = choices
            self.choicesError = nil
        }
    }

    func clearFeedback() {
        actionError = nil
        notice = nil
    }

    func clearPreview() {
        previewGeneration = UUID()
        previewTask?.cancel()
        previewDeadline?.cancel()
        previewSubscription = nil
        previewConditions = nil
        matchCount = nil
        previewError = nil
        isLoadingPreview = false
    }

    func preview(conditions: RuleConditions?) {
        if conditions == previewConditions, previewError == nil { return }
        clearPreview()
        guard isActive, let conditions else { return }
        previewConditions = conditions
        isLoadingPreview = true
        let request = previewGeneration
        previewTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            guard let self, self.previewGeneration == request, self.isActive else { return }
            self.previewDeadline = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                guard let self, self.previewGeneration == request else { return }
                self.isLoadingPreview = false
                self.previewError = L10n.string(
                    "The match count is taking longer to load. Try again.")
            }
            self.previewSubscription = self.client.count(self.workspaceID, conditions).sink {
                [weak self] completion in
                guard let self, self.previewGeneration == request else { return }
                if case .failure = completion {
                    self.previewDeadline?.cancel()
                    self.isLoadingPreview = false
                    self.previewError = L10n.string(
                        "Couldn't count matching transactions. Try again.")
                }
            } receiveValue: { [weak self] count in
                guard let self, self.previewGeneration == request else { return }
                self.previewDeadline?.cancel()
                self.matchCount = count
                self.previewError = nil
                self.isLoadingPreview = false
            }
        }
    }

    @discardableResult
    func save(draft: RuleDraft, ruleID: String? = nil) async -> Bool {
        guard draft.isValid, draft.currency == currency, draft.minorUnit == minorUnit else {
            actionError =
                draft.validationMessage
                ?? L10n.string("The workspace currency changed. Open this rule again.")
            return false
        }
        if let ruleID, !rules.contains(where: { $0.id == ruleID }) {
            actionError = L10n.string("This rule is no longer available.")
            return false
        }
        return await perform(
            success: ruleID == nil ? L10n.string("Rule created.") : L10n.string("Rule updated.")
        ) {
            _ = try await self.client.save(self.workspaceID, draft, ruleID)
        }
    }

    /// Saving and applying are separate backend operations. Keep their receipt for safe retries.
    func saveFromEditor(draft: RuleDraft, submission: RuleEditorSubmission) async -> Bool {
        guard isActive, hasLoaded, loadError == nil, !isSaving else { return false }
        guard draft.isValid, draft.currency == currency, draft.minorUnit == minorUnit else {
            actionError =
                draft.validationMessage
                ?? L10n.string("Open the rule again to refresh its currency.")
            return false
        }
        if submission.applyExisting,
            previewConditions != draft.conditions || isLoadingPreview || previewError != nil
                || matchCount == nil
        {
            actionError = L10n.string("Wait for the match count, or turn off Apply now.")
            return false
        }
        if let id = submission.ruleID, submission.savedDraft == nil,
            !rules.contains(where: { $0.id == id })
        {
            actionError = L10n.string("This rule is no longer available.")
            return false
        }
        let request = generation
        let shouldApply = submission.applyExisting
        isSaving = true
        clearFeedback()
        defer { if generation == request { isSaving = false } }
        do {
            if submission.savedDraft != draft {
                let id = try await client.save(workspaceID, draft, submission.ruleID)
                guard generation == request, isActive else { return false }
                submission.ruleID = id
                submission.savedDraft = draft
            }
            if shouldApply, let id = submission.ruleID {
                let count = try await client.apply(workspaceID, id)
                guard generation == request, isActive else { return false }
                notice =
                    L10n.string(
                        "Rule saved. Applied to \(count) matching \(count == 1 ? L10n.string("transaction") : L10n.string("transactions"))."
                    )
            } else {
                notice = L10n.string("Rule saved.")
            }
            return true
        } catch {
            guard generation == request, isActive else { return false }
            actionError =
                submission.savedDraft == draft
                ? L10n.string(
                    "Rule saved, but applying to existing transactions wasn't confirmed. Retry Save, or turn off Apply now to finish."
                )
                : L10n.string("Couldn't save this rule. Please try again.")
            return false
        }
    }

    @discardableResult
    func setActive(_ active: Bool, rule: TransactionRule) async -> Bool {
        guard contains(rule) else { return false }
        return await perform(
            success: active ? L10n.string("Rule enabled.") : L10n.string("Rule paused.")
        ) {
            try await self.client.setActive(self.workspaceID, rule.id, active)
        }
    }

    @discardableResult
    func delete(rule: TransactionRule) async -> Bool {
        guard contains(rule) else { return false }
        return await perform(success: L10n.string("Rule deleted.")) {
            try await self.client.delete(self.workspaceID, rule.id)
        }
    }

    func applyToExisting(rule: TransactionRule) async -> Int? {
        guard let current = rules.first(where: { $0.id == rule.id }), contains(rule),
            current.conditions == rule.conditions, current.actions == rule.actions
        else {
            actionError =
                L10n.string(
                    "This rule changed or was deleted. Open it again to review the latest version.")
            return nil
        }
        var count: Int?
        let succeeded = await perform(success: nil) {
            count = try await self.client.apply(self.workspaceID, rule.id)
        }
        guard succeeded, let count else { return nil }
        notice = L10n.string(
            "Rule applied to \(count) matching \(count == 1 ? L10n.string("transaction") : L10n.string("transactions"))."
        )
        return count
    }

    private func contains(_ rule: TransactionRule) -> Bool {
        rule.workspaceId == workspaceID && rules.contains { $0.id == rule.id }
    }

    private func perform(success: String?, operation: () async throws -> Void) async -> Bool {
        guard isActive, hasLoaded, loadError == nil, !isSaving else { return false }
        let request = generation
        isSaving = true
        clearFeedback()
        defer { if generation == request { isSaving = false } }
        do {
            try await operation()
            guard generation == request, isActive else { return false }
            notice = success
            return true
        } catch {
            guard generation == request, isActive else { return false }
            actionError = L10n.string(
                "Couldn't complete this change. \(error.localizedDescription)")
            return false
        }
    }
}

struct RuleSaveRequest {
    let workspaceID: String
    let draft: RuleDraft
    let ruleID: String?

    var function: String {
        ruleID == nil ? "transactionRules:createRule" : "transactionRules:updateRule"
    }
    var arguments: [String: ConvexEncodable?] {
        var arguments: [String: ConvexEncodable?] = [
            "workspaceId": workspaceID, "name": draft.normalizedName, "isActive": draft.isActive,
            "conditions": draft.conditions?.arguments ?? [:], "actions": draft.actions.arguments,
        ]
        if let ruleID { arguments["id"] = ruleID }
        if let priority = draft.priorityValue { arguments["priority"] = priority }
        return arguments
    }
}

extension RuleConditions {
    var arguments: [String: ConvexEncodable?] {
        var result: [String: ConvexEncodable?] = [:]
        for (key, conditions) in [
            ("originalStatement", originalStatement), ("merchantName", merchantName),
        ] where !conditions.isEmpty {
            result[key] = conditions.map { condition -> ConvexEncodable? in
                ["matchType": condition.matchType.rawValue, "value": condition.value]
                    as [String: ConvexEncodable?]
            }
        }
        if !amount.isEmpty {
            result["amount"] = amount.map { condition -> ConvexEncodable? in
                var value: [String: ConvexEncodable?] = [
                    "operator": condition.comparison.rawValue, "value": condition.value,
                ]
                if let upper = condition.valueTo { value["valueTo"] = upper }
                return value
            }
        }
        if !bankAccountId.isEmpty {
            result["bankAccountId"] = bankAccountId.map { $0 as ConvexEncodable? }
        }
        return result
    }
}

extension RuleActions {
    var arguments: [String: ConvexEncodable?] {
        var result: [String: ConvexEncodable?] = [:]
        if let setMerchantId { result["setMerchantId"] = setMerchantId }
        if let setCategoryId { result["setCategoryId"] = setCategoryId }
        return result
    }
}
