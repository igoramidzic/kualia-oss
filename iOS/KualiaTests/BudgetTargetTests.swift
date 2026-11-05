import Combine
import ConvexMobile
import Foundation
import Testing

@testable import Kualia

@MainActor
struct BudgetTargetTests {
    private let today = "2026-09-07"

    @Test
    func decodesSavedAmountsInMinorUnitsAndKeepsTheOriginalCadence() throws {
        let amount = try Int64(12_345).convexEncode()
        let json = """
            {"categoryId":"food","targetType":"recurring_rollover","amount":\(amount),
            "frequency":"weekly","frequencyInterval":2,"dayOfWeek":5,"firstDueDate":"2026-08-14"}
            """
        let target = try JSONDecoder().decode(BudgetTarget.self, from: Data(json.utf8))
        let draft = BudgetTargetDraft(target: target, today: today)
        #expect(draft.kind == .spending)
        #expect(draft.amount == 12_345)
        #expect(draft.frequency == .weekly)
        #expect(draft.interval == 2)
        #expect(draft.dayOfWeek == 5)
        #expect(draft.firstDueDate == "2026-08-14")
        #expect(target.cadence == "Every 2 weeks")
        #expect(draft.target(categoryID: "food") == target)
    }

    @Test(arguments: BudgetTargetKind.allCases)
    func encodesEachTargetKindWithOnlyItsApplicableSettings(kind: BudgetTargetKind) throws {
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.kind = kind
        draft.amount = 12_345
        draft.monthlyContribution = 1_000
        draft.frequency = .weekly
        draft.interval = 2
        draft.dayOfWeek = 5
        draft.targetDate = "2027-03-01"
        let target = draft.target(categoryID: "food")
        let request = BudgetTargetRequest(workspaceID: "personal", target: target, isCreating: true)
        let json = try encoded(request)
        #expect(request.function == "categoryTargets:createCategoryTarget")
        #expect(json["amount"] == .number(12_345))
        #expect(json["targetType"] == .string(kind.rawValue))
        #expect(json["workspaceId"] == .string("personal"))
        #expect(json["categoryId"] == .string("food"))
        #expect(draft.validationMessage(today: today, existing: nil) == nil)
        if kind.repeats {
            #expect(json["frequency"] == .string("weekly"))
            #expect(json["frequencyInterval"] == .number(2))
            #expect(json["dayOfWeek"] == .number(5))
            #expect(json["firstDueDate"] == .string("2026-09-01"))
        } else if kind == .oneTime {
            #expect(json["targetDate"] == .string("2027-03-01"))
            #expect(json["frequency"] == nil)
            #expect(json["frequencyInterval"] == nil)
        } else {
            #expect(json["targetBalance"] == .number(12_345))
            #expect(json["monthlyContribution"] == .number(1_000))
            #expect(json["frequency"] == .string("monthly"))
            #expect(json["frequencyInterval"] == .number(1))
        }
        if kind != .maintainBalance {
            #expect(json["monthlyContribution"] == nil)
            #expect(json["targetBalance"] == nil)
        }
        if kind != .oneTime { #expect(json["targetDate"] == nil) }
        if !kind.repeats { #expect(json["dayOfWeek"] == nil) }
    }

    @Test
    func changingOnlyTheAmountKeepsAnImplicitMonthlyDueDate() {
        let saved = BudgetTarget(
            categoryId: "rent", targetType: .setAside, amount: 150_000,
            frequency: .monthly, frequencyInterval: 1, firstDueDate: "2026-09-15")
        var draft = BudgetTargetDraft(target: saved, today: today)
        #expect(draft.target(categoryID: "rent") == saved)
        draft.amount = 160_000
        let updated = draft.target(categoryID: "rent")
        #expect(updated.dueDay == nil)
        #expect(updated.firstDueDate == "2026-09-15")
        #expect(updated.amount == 160_000)
    }

    @Test
    func updatesExplicitlyClearSettingsFromOtherTypes() throws {
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 5_000
        let request = BudgetTargetRequest(
            workspaceID: "personal", target: draft.target(categoryID: "food"), isCreating: false)
        let json = try encoded(request)
        #expect(request.function == "categoryTargets:updateCategoryTarget")
        #expect(json["dayOfWeek"] == .null)
        #expect(json["targetDate"] == .null)
        #expect(json["targetBalance"] == .null)
        #expect(json["monthlyContribution"] == .null)
        #expect(json["dueDay"] == .number(-1))
    }

    @Test
    func rejectsInvalidMoneyAndPreservesExactSafeIntegerBoundary() throws {
        var draft = BudgetTargetDraft(target: nil, today: today)
        for amount: Int64? in [nil, 0, -1, BudgetTargetDraft.maximumAmount + 1] {
            draft.amount = amount
            #expect(draft.validationMessage(today: today, existing: nil) != nil)
        }
        draft.amount = BudgetTargetDraft.maximumAmount
        #expect(draft.validationMessage(today: today, existing: nil) == nil)
        let json = try encoded(
            .init(
                workspaceID: "personal", target: draft.target(categoryID: "food"), isCreating: true)
        )
        #expect(json["amount"] == .number(BudgetTargetDraft.maximumAmount))
        draft.kind = .maintainBalance
        for amount: Int64? in [nil, 0, -1, BudgetTargetDraft.maximumAmount + 1] {
            draft.monthlyContribution = amount
            #expect(draft.validationMessage(today: today, existing: nil) != nil)
        }
        draft.monthlyContribution = 1
        #expect(draft.validationMessage(today: today, existing: nil) == nil)
    }

    @Test
    func validatesDatesAndAllowsEditingAnExistingExpiredGoal() {
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 100
        draft.kind = .oneTime
        for key in ["2026-02-30", "invalid", today, "2026-09-06"] {
            draft.targetDate = key
            #expect(draft.validationMessage(today: today, existing: nil) != nil)
        }
        let existing = BudgetTarget(
            categoryId: "trip", targetType: .oneTime, amount: 100, targetDate: "2026-08-01")
        draft.targetDate = "2026-08-01"
        #expect(draft.validationMessage(today: today, existing: existing) == nil)
        draft.targetDate = "2026-09-08"
        #expect(draft.validationMessage(today: today, existing: nil) == nil)
        #expect(BudgetTargetDraft.isDateKey("2028-02-29"))
        #expect(!BudgetTargetDraft.isDateKey("2027-02-29"))
    }

    @Test
    func validatesRepeatSettingsAndLoadsBalanceTargetInsteadOfContribution() {
        let target = BudgetTarget(
            categoryId: "buffer", targetType: .maintainBalance, amount: 10_000,
            monthlyContribution: 2_500, targetBalance: 100_000)
        var draft = BudgetTargetDraft(target: target, today: today)
        #expect(draft.amount == 100_000)
        #expect(draft.monthlyContribution == 2_500)
        draft.kind = .setAside
        draft.interval = 0
        #expect(draft.validationMessage(today: today, existing: target) != nil)
        draft.interval = 2
        draft.dayOfWeek = 7
        #expect(draft.validationMessage(today: today, existing: target) != nil)
        draft.dayOfWeek = 0
        draft.dueDay = 32
        #expect(draft.validationMessage(today: today, existing: target) != nil)
        draft.dueDay = -1
        #expect(draft.validationMessage(today: today, existing: target) == nil)
    }

    @Test
    func createsThenUpdatesAndPublishesSavedSettingsImmediately() async throws {
        let source = CurrentValueSubject<[BudgetTarget], Error>([])
        var requests: [BudgetTargetRequest] = []
        let store = BudgetTargetStore(
            subscription: { _ in source.eraseToAnyPublisher() },
            save: {
                requests.append($0)
                return $0.target.categoryId
            })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        await settle()
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 50_000
        #expect(
            await store.save(
                draft: draft, categoryID: "food", workspaceID: "personal", expected: nil,
                today: today))
        let saved = try #require(store.targets["food"])
        #expect(saved.amount == 50_000)
        draft.amount = 60_000
        #expect(
            await store.save(
                draft: draft, categoryID: "food", workspaceID: "personal", expected: saved,
                today: today))
        #expect(store.targets["food"]?.amount == 60_000)
        #expect(requests.map(\.isCreating) == [true, false])
        #expect(!store.isSaving)
    }

    @Test
    func rejectsAStaleDraftBeforeWriting() async {
        let remote = BudgetTarget(categoryId: "food", targetType: .setAside, amount: 12_000)
        let source = CurrentValueSubject<[BudgetTarget], Error>([remote])
        var writes = 0
        let store = BudgetTargetStore(
            subscription: { _ in source.eraseToAnyPublisher() },
            save: { request in
                writes += 1
                return request.target.categoryId
            })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        await settle()
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 50_000
        #expect(
            !(await store.save(
                draft: draft, categoryID: "food", workspaceID: "personal", expected: nil,
                today: today)))
        #expect(writes == 0)
        #expect(store.targets["food"] == remote)
        #expect(store.saveError?.contains("changed while") == true)
    }

    @Test
    func saveReceiptDoesNotOverwriteANewerLiveTarget() async {
        let source = CurrentValueSubject<[BudgetTarget], Error>([])
        let remote = BudgetTarget(categoryId: "food", targetType: .setAside, amount: 77_000)
        let store = BudgetTargetStore(
            subscription: { _ in source.eraseToAnyPublisher() },
            save: { request in
                source.send([remote])
                await settle()
                return request.target.categoryId
            })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        await settle()
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 50_000
        #expect(
            await store.save(
                draft: draft, categoryID: "food", workspaceID: "personal", expected: nil,
                today: today))
        #expect(store.targets["food"] == remote)
    }

    @Test
    func switchingWorkspaceIgnoresAnInFlightSaveAndOldSubscription() async {
        let first = CurrentValueSubject<[BudgetTarget], Error>([])
        let second = CurrentValueSubject<[BudgetTarget], Error>([])
        var continuation: CheckedContinuation<String, Never>?
        let store = BudgetTargetStore(
            subscription: {
                $0 == "first" ? first.eraseToAnyPublisher() : second.eraseToAnyPublisher()
            },
            save: { _ in
                await withCheckedContinuation { continuation = $0 }
            })
        store.start(workspaceID: "first")
        defer { store.stop() }
        await settle()
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 50_000
        let save = Task {
            await store.save(
                draft: draft, categoryID: "food", workspaceID: "first", expected: nil, today: today)
        }
        await settle()
        #expect(store.isSaving)
        store.start(workspaceID: "second")
        first.send([draft.target(categoryID: "food")])
        continuation?.resume(returning: "food")
        #expect(!(await save.value))
        await settle()
        #expect(store.targets.isEmpty)
        #expect(store.workspaceID == "second")
        #expect(!store.isSaving)
        #expect(store.saveError == nil)
    }

    @Test
    func failuresRetainTheDraftAndAllowARefreshedRetry() async {
        let source = CurrentValueSubject<[BudgetTarget], Error>([])
        var fails = true
        let store = BudgetTargetStore(
            subscription: { _ in source.eraseToAnyPublisher() },
            save: { request in
                if fails { throw BudgetTargetSaveError.unavailable }
                return request.target.categoryId
            })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        await settle()
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 50_000
        #expect(
            !(await store.save(
                draft: draft, categoryID: "food", workspaceID: "personal", expected: nil,
                today: today)))
        #expect(draft.amount == 50_000)
        #expect(store.targets.isEmpty)
        #expect(store.saveError != nil)
        await settle()
        fails = false
        #expect(
            await store.save(
                draft: draft, categoryID: "food", workspaceID: "personal", expected: nil,
                today: today))
        #expect(store.saveError == nil)
    }

    @Test
    func cannotCreateUntilTargetsAreLoadedOrWhenWorkspaceDoesNotMatch() async {
        let source = PassthroughSubject<[BudgetTarget], Error>()
        let store = BudgetTargetStore(subscription: { _ in source.eraseToAnyPublisher() })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        var draft = BudgetTargetDraft(target: nil, today: today)
        draft.amount = 50_000
        #expect(!store.canEdit)
        #expect(
            !(await store.save(
                draft: draft, categoryID: "food", workspaceID: "personal", expected: nil,
                today: today)))
        source.send([])
        await settle()
        #expect(store.canEdit)
        #expect(
            !(await store.save(
                draft: draft, categoryID: "food", workspaceID: "other", expected: nil, today: today))
        )
        source.send(completion: .failure(BudgetTargetSaveError.unavailable))
        await settle()
        #expect(!store.canEdit)
        #expect(store.loadError != nil)
    }

    @Test(arguments: [false, true])
    func deletesExistingTargetAndRetainsItOnFailure(fails: Bool) async throws {
        let saved = BudgetTarget(categoryId: "food", targetType: .setAside, amount: 5_000)
        let source = CurrentValueSubject<[BudgetTarget], Error>([saved])
        var request: BudgetTargetRequest?
        let store = BudgetTargetStore(
            subscription: { _ in source.eraseToAnyPublisher() },
            save: {
                request = $0
                if fails { throw BudgetTargetSaveError.unavailable }
                return $0.target.categoryId
            })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        await settle()
        #expect(
            await store.delete(categoryID: "food", workspaceID: "personal", expected: saved)
                == !fails)
        await settle()
        let deletion = try #require(request)
        #expect(deletion.function == "categoryTargets:deleteCategoryTarget")
        #expect(
            try encoded(deletion) == [
                "workspaceId": .string("personal"), "categoryId": .string("food"),
            ])
        #expect(store.targets["food"] == (fails ? saved : nil))
        #expect((store.saveError != nil) == fails)
        #expect(!store.isSaving)
    }

    @Test
    func deletionRejectsStaleTargetsAndWrongWorkspaces() async {
        let saved = BudgetTarget(categoryId: "food", targetType: .setAside, amount: 5_000)
        let source = CurrentValueSubject<[BudgetTarget], Error>([saved])
        var writes = 0
        let store = BudgetTargetStore(
            subscription: { _ in source.eraseToAnyPublisher() },
            save: { request in
                writes += 1
                return request.target.categoryId
            })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        await settle()
        #expect(!(await store.delete(categoryID: "food", workspaceID: "other", expected: saved)))
        var stale = saved
        stale.amount = 1
        #expect(!(await store.delete(categoryID: "food", workspaceID: "personal", expected: stale)))
        #expect(writes == 0)
    }

    @Test
    func deletionIgnoresReceiptAfterWorkspaceSwitch() async {
        let saved = BudgetTarget(categoryId: "food", targetType: .setAside, amount: 5_000)
        let source = CurrentValueSubject<[BudgetTarget], Error>([saved])
        var continuation: CheckedContinuation<String, Never>?
        let store = BudgetTargetStore(
            subscription: { _ in source.eraseToAnyPublisher() },
            save: { _ in await withCheckedContinuation { continuation = $0 } })
        store.start(workspaceID: "personal")
        defer { store.stop() }
        await settle()
        let task = Task {
            await store.delete(categoryID: "food", workspaceID: "personal", expected: saved)
        }
        await settle()
        store.start(workspaceID: "other")
        continuation?.resume(returning: "food")
        #expect(!(await task.value))
        await settle()
        #expect(store.targets["food"] == saved)
        #expect(!store.isSaving)
    }

    private func encoded(_ request: BudgetTargetRequest) throws -> [String: TargetJSONValue] {
        let text = try request.arguments.convexEncode()
        return try JSONDecoder().decode([String: TargetJSONValue].self, from: Data(text.utf8))
    }

    private func settle() async { try? await Task.sleep(for: .milliseconds(30)) }
}

private enum TargetJSONValue: Decodable, Equatable {
    case string(String)
    case number(Int64)
    case null
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .null
        } else if let number = try? value.decode(Int64.self) {
            self = .number(number)
        } else {
            self = .string(try value.decode(String.self))
        }
    }
}
