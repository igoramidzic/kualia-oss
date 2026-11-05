import ConvexMobile
import Foundation

struct BudgetPlanGroupIdentity: Decodable {
    let _id: String
}

/// One edit is one server mutation. Done only dismisses the plan.
enum BudgetPlanChange: Equatable {
    case addGroup(name: String)
    case addCategory(groupID: String, name: String)
    case renameGroup(id: String, name: String)
    case renameCategory(id: String, name: String)
    case moveGroup(id: String, position: Int)
    case moveCategory(id: String, sourceGroupID: String, groupID: String, position: Int)

    var function: String {
        switch self {
        case .addGroup: "categoryGroups:createCategoryGroup"
        case .addCategory: "categories:createCategory"
        case .renameGroup: "categoryGroups:updateCategoryGroup"
        case .renameCategory: "categories:updateCategory"
        case .moveGroup: "categoryGroups:updateCategoryGroupSortOrder"
        case .moveCategory(_, let source, let destination, _):
            source == destination
                ? "categories:updateCategorySortOrder" : "categories:moveCategoryToGroup"
        }
    }

    var createsItem: Bool {
        switch self {
        case .addGroup, .addCategory: true
        default: false
        }
    }

    var isMove: Bool {
        switch self {
        case .moveGroup, .moveCategory: true
        default: false
        }
    }

    func arguments(workspaceID: String) -> [String: ConvexEncodable?] {
        var args: [String: ConvexEncodable?] = ["workspaceId": workspaceID]
        switch self {
        case .addGroup(let name):
            args["name"] = name
            args["type"] = "expense"
        case .addCategory(let groupID, let name):
            args["name"] = name
            args["categoryGroupId"] = groupID
        case .renameGroup(let id, let name):
            args["categoryGroupId"] = id
            args["name"] = name
        case .renameCategory(let id, let name):
            args["categoryId"] = id
            args["name"] = name
        case .moveGroup(let id, let position):
            args["categoryGroupId"] = id
            args["newPosition"] = Double(position)
        case .moveCategory(let id, let source, let destination, let position):
            args["categoryId"] = id
            args["newPosition"] = Double(position)
            if source != destination { args["targetGroupId"] = destination }
        }
        return args
    }

    func isValid(in groups: [BudgetCategoryGroup]) -> Bool {
        switch self {
        case .addGroup(let name): return !name.isEmpty
        case .addCategory(let groupID, let name):
            return !name.isEmpty
                && groups.contains {
                    $0.id == groupID && $0.categoryGroup.type != "credit_card"
                }
        case .renameGroup(let id, let name):
            return !name.isEmpty && groups.contains { $0.id == id }
        case .renameCategory(let id, let name):
            return !name.isEmpty && groups.contains { $0.categories.contains { $0.id == id } }
        case .moveGroup(let id, let position):
            return groups.contains { $0.id == id } && groups.indices.contains(position)
        case .moveCategory(let id, let source, let destination, let position):
            guard let origin = groups.first(where: { $0.id == source }),
                let target = groups.first(where: { $0.id == destination }),
                origin.categories.contains(where: { $0.id == id }),
                (origin.categoryGroup.type == "credit_card")
                    == (target.categoryGroup.type == "credit_card")
            else { return false }
            let count = target.categories.filter { $0.id != id }.count
            return (0...count).contains(position)
        }
    }

    /// Idempotent so a live subscription can confirm a move before its response arrives.
    func applying(to groups: [BudgetCategoryGroup], createdID: String? = nil)
        -> [BudgetCategoryGroup]
    {
        var result = groups
        switch self {
        case .addGroup(let name):
            guard let createdID, !result.contains(where: { $0.id == createdID }) else {
                return result
            }
            result.insert(
                .init(
                    categoryGroup: .init(_id: createdID, name: name, type: "expense"),
                    categories: []),
                at: 0)
        case .addCategory(let groupID, let name):
            guard let createdID,
                !result.flatMap(\.categories).contains(where: { $0.id == createdID }),
                let index = result.firstIndex(where: { $0.id == groupID })
            else { return result }
            let group = result[index]
            result[index] = .init(
                categoryGroup: group.categoryGroup,
                categories: [.init(_id: createdID, name: name, iconName: nil, type: "expense")]
                    + group.categories)
        case .renameGroup(let id, let name):
            result = result.map { group in
                guard group.id == id else { return group }
                return .init(
                    categoryGroup: .init(_id: id, name: name, type: group.categoryGroup.type),
                    categories: group.categories)
            }
        case .renameCategory(let id, let name):
            result = result.map { group in
                .init(
                    categoryGroup: group.categoryGroup,
                    categories: group.categories.map { category in
                        guard category.id == id else { return category }
                        return .init(
                            _id: id, name: name, iconName: category.iconName, type: category.type)
                    })
            }
        case .moveGroup(let id, let position):
            guard let index = result.firstIndex(where: { $0.id == id }) else { return result }
            let group = result.remove(at: index)
            result.insert(group, at: min(max(0, position), result.count))
        case .moveCategory(let id, _, let groupID, let position):
            guard let category = result.flatMap(\.categories).first(where: { $0.id == id }),
                result.contains(where: { $0.id == groupID })
            else { return result }
            result = result.map { group in
                var categories = group.categories.filter { $0.id != id }
                if group.id == groupID {
                    categories.insert(category, at: min(max(0, position), categories.count))
                }
                return .init(categoryGroup: group.categoryGroup, categories: categories)
            }
        }
        return result
    }
}

struct BudgetPlanNameEditor: Identifiable {
    enum Kind {
        case newGroup
        case newCategory(groupID: String)
        case group(id: String)
        case category(id: String)
    }
    let id = UUID()
    let kind: Kind
    var name = ""

    var isCreating: Bool {
        switch kind {
        case .newGroup, .newCategory: true
        default: false
        }
    }
    var isGroup: Bool {
        switch kind {
        case .newGroup, .group: true
        default: false
        }
    }
    var title: String {
        if isGroup {
            return isCreating ? L10n.string("New group") : L10n.string("Edit group")
        }
        return isCreating ? L10n.string("New category") : L10n.string("Edit category")
    }

    func change(name: String) -> BudgetPlanChange? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        switch kind {
        case .newGroup: return .addGroup(name: trimmed)
        case .newCategory(let groupID): return .addCategory(groupID: groupID, name: trimmed)
        case .group(let id): return .renameGroup(id: id, name: trimmed)
        case .category(let id): return .renameCategory(id: id, name: trimmed)
        }
    }
}

/// Stable identities keep drop destinations independent of flattened row offsets.
enum BudgetPlanOrdering {
    nonisolated enum Item: Hashable, Sendable {
        case group(String)
        case category(String)
        case empty(String)

        var isGroup: Bool {
            if case .group = self { return true }
            return false
        }
        var canDrag: Bool {
            if case .empty = self { return false }
            return true
        }
    }

    nonisolated enum Destination: Equatable, Sendable {
        case beforeGroup(String)
        case afterGroup(String)
        case category(groupID: String, beforeID: String?)
    }

    /// Keep the intended neighbor, rather than an index that an earlier save or
    /// a live update can invalidate while several moves are queued.
    struct Move: Equatable {
        let item: Item
        let destination: Destination

        func change(in groups: [BudgetCategoryGroup]) -> BudgetPlanChange? {
            BudgetPlanOrdering.change(moving: item, to: destination, in: groups)
        }
    }

    static func rowItem(in rows: [[Item]], section: Int, row: Int) -> Item? {
        guard rows.indices.contains(section), rows[section].indices.contains(row) else {
            return nil
        }
        return rows[section][row]
    }

    /// Flow layout can measure the extra incoming slot in a destination section
    /// before moveItemAt updates the data source. That slot belongs to the dragged
    /// item; it is not yet an index into the committed section's rows.
    static func sizingItem(
        in rows: [[Item]], section: Int, row: Int, moving: Item?
    ) -> Item? {
        if let item = rowItem(in: rows, section: section, row: row) { return item }
        guard rows.indices.contains(section), row == rows[section].count,
            let moving, moving.canDrag
        else { return nil }
        return moving
    }

    /// Validate both ends before removing anything. Invalid or stale callbacks
    /// must not leave a category missing from the data source.
    static func movingRow(
        in rows: [[Item]], item: Item,
        sourceSection: Int, sourceRow: Int, destinationSection: Int, destinationRow: Int
    ) -> [[Item]]? {
        guard item.canDrag,
            rowItem(in: rows, section: sourceSection, row: sourceRow) == item,
            rows.indices.contains(destinationSection)
        else { return nil }
        let countAfterRemoval =
            rows[destinationSection].count
            - (sourceSection == destinationSection ? 1 : 0)
        guard (0...countAfterRemoval).contains(destinationRow) else { return nil }
        var updated = rows
        updated[sourceSection].remove(at: sourceRow)
        updated[destinationSection].insert(item, at: destinationRow)
        return updated
    }

    /// Clamp incoming categories below a group's permanent header, including
    /// when UIKit has temporarily moved its last category into another section.
    static func targetRow(
        sourceGroupID: String, targetGroupID: String, proposedRow: Int,
        in groups: [BudgetCategoryGroup]
    ) -> Int? {
        guard let source = groups.first(where: { $0.id == sourceGroupID }),
            let target = groups.first(where: { $0.id == targetGroupID })
        else { return nil }
        if source.id != target.id,
            source.categoryGroup.type == "credit_card" || target.categoryGroup.type == "credit_card"
        {
            return nil
        }
        let remaining = target.categories.count - (source.id == target.id ? 1 : 0)
        return min(max(1, proposedRow), max(1, remaining + 1))
    }

    /// Translate UIKit's final row position into a stable destination. Header
    /// and empty rows are presentation only and never become category offsets.
    static func move(
        item: Item, toGroupID: String?, row: Int, in groups: [BudgetCategoryGroup]
    ) -> Move? {
        guard row >= 0 else { return nil }
        let destination: Destination
        switch item {
        case .group(let id):
            let remaining = groups.filter { $0.id != id }
            guard row <= remaining.count, let last = remaining.last else { return nil }
            destination =
                row < remaining.count
                ? .beforeGroup(remaining[row].id) : .afterGroup(last.id)
        case .category(let id):
            guard row > 0, let group = groups.first(where: { $0.id == toGroupID }) else {
                return nil
            }
            let remaining = group.categories.filter { $0.id != id }
            let position = min(row - 1, remaining.count)
            destination = .category(
                groupID: group.id,
                beforeID: position < remaining.count ? remaining[position].id : nil)
        case .empty: return nil
        }
        let move = Move(item: item, destination: destination)
        return move.change(in: groups) == nil ? nil : move
    }

    static func serverGroupPosition(
        movingID: String, position: Int, visibleIDs: [String], allIDs: [String]
    ) -> Int? {
        guard allIDs.contains(movingID), visibleIDs.contains(movingID) else { return nil }
        let visible = visibleIDs.filter { $0 != movingID }
        let all = allIDs.filter { $0 != movingID }
        guard (0...visible.count).contains(position) else { return nil }
        if position == visible.count { return all.count }
        return all.firstIndex(of: visible[position])
    }

    static func items(in group: BudgetCategoryGroup, collapsed: Bool) -> [Item] {
        let header = Item.group(group.id)
        guard !collapsed else { return [header] }
        return [header]
            + (group.categories.isEmpty
                ? [.empty(group.id)] : group.categories.map { .category($0.id) })
    }

    static func change(
        moving item: Item, to destination: Destination,
        in groups: [BudgetCategoryGroup]
    ) -> BudgetPlanChange? {
        let change: BudgetPlanChange
        switch (item, destination) {
        case (.group(let id), .beforeGroup(let target)),
            (.group(let id), .afterGroup(let target)):
            guard id != target, groups.contains(where: { $0.id == id }) else { return nil }
            let remaining = groups.filter { $0.id != id }
            guard let index = remaining.firstIndex(where: { $0.id == target }) else { return nil }
            let after: Bool
            if case .afterGroup = destination { after = true } else { after = false }
            change = .moveGroup(id: id, position: index + (after ? 1 : 0))
        case (.category(let id), .category(let groupID, let beforeID)):
            guard beforeID != id,
                let source = groups.first(where: { $0.categories.contains { $0.id == id } }),
                let destinationGroup = groups.first(where: { $0.id == groupID })
            else { return nil }
            let remaining = destinationGroup.categories.filter { $0.id != id }
            let position: Int
            if let beforeID {
                guard let index = remaining.firstIndex(where: { $0.id == beforeID }) else {
                    return nil
                }
                position = index
            } else {
                position = remaining.count
            }
            change = .moveCategory(
                id: id, sourceGroupID: source.id, groupID: groupID, position: position)
        default: return nil
        }
        guard change.isValid(in: groups), change.applying(to: groups) != groups else { return nil }
        return change
    }
}

/// The lifted header stays present while its children are collapsed. A cancelled
/// or completed session restores the categories; old completion callbacks are harmless.
struct BudgetPlanDragState {
    private(set) var sessionID: UUID?
    private(set) var item: BudgetPlanOrdering.Item?
    var collapsesCategories: Bool { item?.isGroup == true }

    mutating func begin(id: UUID, item: BudgetPlanOrdering.Item) {
        guard item.canDrag else { return }
        sessionID = id
        self.item = item
    }

    mutating func end(id: UUID) {
        guard sessionID == id else { return }
        sessionID = nil
        item = nil
    }
}
