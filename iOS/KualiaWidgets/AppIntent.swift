import AppIntents
import SwiftUI
import WidgetKit

// MARK: - App Intent

struct CategoryEntity: AppEntity {
    let id: String
    let name: String
    let groupName: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Category"
    }

    static var defaultQuery = CategoryEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct CategoryEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [CategoryEntity] {
        let allCategories = WidgetSharedStorage.categories
        return identifiers.compactMap { id in
            guard let cat = allCategories.first(where: { $0.id == id }) else { return nil }
            return CategoryEntity(id: cat.id, name: cat.name, groupName: cat.groupName)
        }
    }

    private func groupedCollection(from categories: [WidgetSharedStorage.WidgetCategory])
        -> IntentItemCollection<CategoryEntity>
    {
        // Group by groupName, preserving order
        var groupOrder: [String] = []
        var groups: [String: [CategoryEntity]] = [:]
        for cat in categories {
            let entity = CategoryEntity(id: cat.id, name: cat.name, groupName: cat.groupName)
            if groups[cat.groupName] == nil {
                groupOrder.append(cat.groupName)
            }
            groups[cat.groupName, default: []].append(entity)
        }

        let sections = groupOrder.map { groupName in
            IntentItemSection(
                LocalizedStringResource(stringLiteral: groupName), items: groups[groupName] ?? [])
        }
        return IntentItemCollection(sections: sections)
    }

    func entities(matching string: String) async throws -> IntentItemCollection<CategoryEntity> {
        let allCategories = WidgetSharedStorage.categories
        if string.isEmpty {
            return groupedCollection(from: allCategories)
        }
        let lowered = string.lowercased()
        let filtered = allCategories.filter {
            $0.name.lowercased().contains(lowered) || $0.groupName.lowercased().contains(lowered)
        }
        return groupedCollection(from: filtered)
    }

    func suggestedEntities() async throws -> IntentItemCollection<CategoryEntity> {
        let allCategories = WidgetSharedStorage.categories
        return groupedCollection(from: allCategories)
    }

    func defaultResult() async -> CategoryEntity? {
        nil
    }
}

struct SelectSingleCategoryIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Select Category"
    static var description: IntentDescription =
        "Choose categories to display."

    @Parameter(title: "Category")
    var category: CategoryEntity?

    @Parameter(title: "Category 2")
    var category2: CategoryEntity?

    @Parameter(title: "Category 3")
    var category3: CategoryEntity?

    @Parameter(title: "Category 4")
    var category4: CategoryEntity?

    @Parameter(title: "Category 5")
    var category5: CategoryEntity?

    @Parameter(title: "Category 6")
    var category6: CategoryEntity?

    static var parameterSummary: some ParameterSummary {
        Switch(.widgetFamily) {
            Case([.accessoryCircular, .accessoryRectangular, .accessoryInline]) {
                Summary { \.$category }
            }
            DefaultCase {
                Summary {
                    \.$category
                    \.$category2
                    \.$category3
                    \.$category4
                    \.$category5
                    \.$category6
                }
            }
        }
    }
}

struct AccountEntity: AppEntity {
    let id: String
    let name: String
    let category: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Account"
    }

    static var defaultQuery = AccountEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct AccountEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [AccountEntity] {
        let allAccounts = WidgetSharedStorage.accounts
        return identifiers.compactMap { id in
            guard let acc = allAccounts.first(where: { $0.id == id }) else { return nil }
            return AccountEntity(id: acc.id, name: acc.name, category: acc.category)
        }
    }

    private func groupedCollection(from accounts: [WidgetSharedStorage.WidgetAccount])
        -> IntentItemCollection<AccountEntity>
    {
        let categoryDisplayNames = [
            "banking": WidgetL10n.string("Cash"), "credit": WidgetL10n.string("Credit"),
            "investment": WidgetL10n.string("Investment"), "loan": WidgetL10n.string("Loan"),
        ]
        let categoryOrder = ["banking", "credit", "investment", "loan"]

        var groups: [String: [AccountEntity]] = [:]
        for acc in accounts {
            let entity = AccountEntity(id: acc.id, name: acc.name, category: acc.category)
            groups[acc.category, default: []].append(entity)
        }

        let sections = categoryOrder.compactMap { cat -> IntentItemSection<AccountEntity>? in
            guard let items = groups[cat], !items.isEmpty else { return nil }
            let title = categoryDisplayNames[cat] ?? cat.capitalized
            return IntentItemSection(LocalizedStringResource("\(title)"), items: items)
        }
        return IntentItemCollection(sections: sections)
    }

    func entities(matching string: String) async throws -> IntentItemCollection<AccountEntity> {
        let allAccounts = WidgetSharedStorage.accounts
        if string.isEmpty {
            return groupedCollection(from: allAccounts)
        }
        let lowered = string.lowercased()
        let filtered = allAccounts.filter { $0.name.lowercased().contains(lowered) }
        return groupedCollection(from: filtered)
    }

    func suggestedEntities() async throws -> IntentItemCollection<AccountEntity> {
        groupedCollection(from: WidgetSharedStorage.accounts)
    }

    func defaultResult() async -> AccountEntity? {
        nil
    }
}

struct SelectAccountsIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Select Accounts"
    static var description: IntentDescription = "Choose accounts to display."

    @Parameter(title: "Account 1")
    var account1: AccountEntity?

    @Parameter(title: "Account 2")
    var account2: AccountEntity?

    @Parameter(title: "Account 3")
    var account3: AccountEntity?

    @Parameter(title: "Account 4")
    var account4: AccountEntity?

    @Parameter(title: "Account 5")
    var account5: AccountEntity?

    @Parameter(title: "Account 6")
    var account6: AccountEntity?

    static var parameterSummary: some ParameterSummary {
        Switch(.widgetFamily) {
            Case([.accessoryCircular, .accessoryRectangular, .accessoryInline]) {
                Summary { \.$account1 }
            }
            DefaultCase {
                Summary {
                    \.$account1
                    \.$account2
                    \.$account3
                    \.$account4
                    \.$account5
                    \.$account6
                }
            }
        }
    }
}
