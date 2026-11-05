import Combine
import ConvexMobile
import Foundation
import Testing

@testable import Kualia

#if canImport(UIKit)
    import UIKit
#endif

@MainActor
struct BudgetPlanTests {
    #if canImport(UIKit)
        @Test
        func groupDragUsesPreparedCellsWithoutReloadingExpandedSections() async throws {
            let controller = BudgetPlanReorderController()
            controller.update(groups: BudgetPlanFixture.groups, isEnabled: true)
            let scene = try #require(
                UIApplication.shared.connectedScenes.compactMap {
                    $0 as? UIWindowScene
                }.first)
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
            controller.traitOverrides.preferredContentSizeCategory = .large
            window.rootViewController = controller
            window.isHidden = false
            defer {
                window.isHidden = true
                window.rootViewController = nil
            }
            controller.view.layoutIfNeeded()
            let collections = controller.view.subviews.compactMap { $0 as? UICollectionView }
            let expanded = try #require(
                collections.first {
                    $0.accessibilityIdentifier == "budget-plan-reorder-collection"
                })
            let collapsed = try #require(
                collections.first {
                    $0.accessibilityIdentifier == "budget-plan-reorder-groups"
                })
            controller.updateViewportInsets(top: 100, bottom: 34)
            for collection in [expanded, collapsed] {
                #expect(collection.frame == controller.view.bounds)
                #expect(collection.contentInsetAdjustmentBehavior == .never)
                #expect(collection.adjustedContentInset.top == 100)
                #expect(collection.adjustedContentInset.bottom == 58)
                if #available(iOS 26.0, *) {
                    #expect(collection.topEdgeEffect.style == .soft)
                    #expect(collection.bottomEdgeEffect.isHidden)
                }
            }
            var active = false
            controller.onDragActivity = { active = $0 }
            // Repeated drags from non-first sections exposed the cell lifecycle
            // failure when those sections were replaced inside the same list.
            for id in ["bills", "empty", "everyday"] {
                expanded.layoutIfNeeded()
                let section = try #require(BudgetPlanFixture.groups.firstIndex { $0.id == id })
                let source = IndexPath(item: 0, section: section)
                let sourceCell = try #require(expanded.cellForItem(at: source))
                // Reorder rows expose movement only, including empty groups.
                var descendants = sourceCell.subviews
                while let child = descendants.popLast() {
                    #expect(!(child is UIControl))
                    descendants.append(contentsOf: child.subviews)
                }
                let frame = sourceCell.frame
                #expect(frame.height >= 56)
                #expect(
                    controller.draggableItem(at: CGPoint(x: frame.minX + 30, y: frame.midY)) == nil)
                #expect(controller.draggableItem(at: CGPoint(x: frame.midX, y: frame.midY)) == nil)
                #expect(
                    controller.draggableItem(at: CGPoint(x: frame.maxX - 70, y: frame.midY)) == nil)
                #expect(
                    controller.draggableItem(at: CGPoint(x: frame.maxX - 24, y: frame.midY))
                        == .group(id))
                #expect(controller.beginMovement(of: .group(id)))
                #expect(active)
                #expect(!collapsed.isHidden)
                #expect(controller.contentScrollView(for: .top) === collapsed)
                // A bar/safe-area change must not move the content under a drag.
                let previousInset = collapsed.contentInset
                controller.updateViewportInsets(top: 120, bottom: 34)
                #expect(collapsed.contentInset == previousInset)
                #expect(expanded.numberOfSections == BudgetPlanFixture.groups.count)
                #expect(expanded.cellForItem(at: source) === sourceCell)
                #expect(collapsed.numberOfSections == 1)
                #expect(collapsed.numberOfItems(inSection: 0) == BudgetPlanFixture.groups.count)
                // Row size is independent of first position and spacing remains outside it.
                let heights = BudgetPlanFixture.groups.indices.map {
                    controller.collectionView(
                        collapsed, layout: collapsed.collectionViewLayout,
                        sizeForItemAt: IndexPath(item: $0, section: 0)
                    ).height
                }
                #expect(Set(heights).count == 1)
                #expect(heights.allSatisfy { $0 >= 56 })
                controller.cancelDrag()
                for _ in 0..<100 where active {
                    try await Task.sleep(for: .milliseconds(10))
                }
                #expect(!active)
                #expect(collapsed.isHidden)
                #expect(controller.contentScrollView(for: .top) === expanded)
                #expect(expanded.adjustedContentInset.top == 120)
                #expect(expanded.adjustedContentInset.bottom == 58)
                #expect(expanded.frame == controller.view.bounds)
                #expect(expanded.numberOfSections == BudgetPlanFixture.groups.count)
            }
        }
    #endif

    @Test
    func nameEditorTrimsNamesAndRejectsWhitespace() {
        let editor = BudgetPlanNameEditor(kind: .newCategory(groupID: "everyday"))
        #expect(editor.change(name: " \n ") == nil)
        #expect(
            editor.change(name: "  Coffee \n") == .addCategory(groupID: "everyday", name: "Coffee"))
        #expect(
            BudgetPlanNameEditor(kind: .newGroup).change(name: "Bills") == .addGroup(name: "Bills"))
        #expect(
            BudgetPlanNameEditor(kind: .category(id: "food")).change(name: "Groceries")
                == .renameCategory(id: "food", name: "Groceries"))
        #expect(
            BudgetPlanNameEditor(kind: .group(id: "everyday")).change(name: "Daily")
                == .renameGroup(id: "everyday", name: "Daily"))
    }

    @Test
    func createsAtTopWithoutChangingExistingItems() {
        let original = BudgetPlanFixture.groups
        let group = BudgetPlanChange.addGroup(name: "Savings")
        let withGroup = group.applying(to: original, createdID: "savings")
        #expect(withGroup.map(\.id) == ["savings", "everyday", "bills", "empty", "cards"])
        #expect(Array(withGroup.dropFirst()) == original)
        #expect(group.applying(to: withGroup, createdID: "savings") == withGroup)
        let category = BudgetPlanChange.addCategory(groupID: "everyday", name: "Coffee")
        let withCategory = category.applying(to: original, createdID: "coffee")
        #expect(withCategory[0].categories.map(\.id) == ["coffee", "food", "fuel"])
        #expect(category.applying(to: withCategory, createdID: "coffee") == withCategory)
        #expect(Array(withCategory.dropFirst()) == Array(original.dropFirst()))
    }

    @Test
    func reordersWithinAndAcrossGroupsUsingStableDestinations() throws {
        let groups = BudgetPlanFixture.groups
        let within = try #require(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "everyday", beforeID: nil),
                in: groups))
        #expect(within.applying(to: groups)[0].categories.map(\.id) == ["fuel", "food"])
        let across = try #require(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "bills", beforeID: "rent"),
                in: groups))
        #expect(across.applying(to: groups)[1].categories.map(\.id) == ["food", "rent"])
        let first = try #require(
            BudgetPlanOrdering.change(
                moving: .category("rent"), to: .category(groupID: "everyday", beforeID: "food"),
                in: groups))
        #expect(first.applying(to: groups)[0].categories.map(\.id) == ["rent", "food", "fuel"])
    }

    @Test
    func movingTheLastCategoryOutLeavesADropTargetAndAcceptsItBack() throws {
        let groups = BudgetPlanFixture.groups
        let out = try #require(
            BudgetPlanOrdering.change(
                moving: .category("rent"), to: .category(groupID: "empty", beforeID: nil),
                in: groups))
        let emptied = out.applying(to: groups)
        #expect(emptied[1].categories.isEmpty)
        #expect(
            BudgetPlanOrdering.items(in: emptied[1], collapsed: false) == [
                .group("bills"), .empty("bills"),
            ])
        #expect(!BudgetPlanOrdering.Item.empty("bills").canDrag)
        let back = try #require(
            BudgetPlanOrdering.change(
                moving: .category("rent"), to: .category(groupID: "bills", beforeID: nil),
                in: emptied))
        let restored = back.applying(to: emptied)
        #expect(restored == groups)
        #expect(
            BudgetPlanOrdering.items(in: restored[2], collapsed: false) == [
                .group("empty"), .empty("empty"),
            ])
        #expect(back.applying(to: restored) == restored)
    }

    @Test
    func refusesInvalidMovesAndCreditCardBoundaryCrossings() {
        let groups = BudgetPlanFixture.groups
        #expect(
            BudgetPlanOrdering.change(
                moving: .empty("empty"), to: .beforeGroup("bills"), in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .beforeGroup("bills"), in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "everyday", beforeID: "food"),
                in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "everyday", beforeID: "fuel"),
                in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "cards", beforeID: nil),
                in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("visa"), to: .category(groupID: "bills", beforeID: nil),
                in: groups) == nil)
        #expect(!BudgetPlanChange.addCategory(groupID: "cards", name: "New").isValid(in: groups))
    }

    @Test
    func staleDropReferencesDoNotMoveSomethingElse() throws {
        let groups = BudgetPlanFixture.groups
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("deleted"), to: .category(groupID: "bills", beforeID: nil),
                in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "deleted", beforeID: nil),
                in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "bills", beforeID: "deleted"),
                in: groups) == nil)
        #expect(
            BudgetPlanOrdering.change(
                moving: .group("bills"), to: .afterGroup("deleted"), in: groups) == nil)
        // A concurrent insertion changes row offsets, but the referenced neighbor stays exact.
        let updated = BudgetPlanChange.addCategory(groupID: "bills", name: "Electric")
            .applying(to: groups, createdID: "electric")
        let change = try #require(
            BudgetPlanOrdering.change(
                moving: .category("food"), to: .category(groupID: "bills", beforeID: "rent"),
                in: updated))
        #expect(
            change.applying(to: updated)[1].categories.map(\.id) == ["electric", "food", "rent"])
    }

    @Test
    func groupDragsCollapseAllChildrenAndRestoreAfterDropOrCancellation() throws {
        let groups = BudgetPlanFixture.groups
        var state = BudgetPlanDragState()
        let id = UUID()
        state.begin(id: id, item: .group("everyday"))
        #expect(state.collapsesCategories)
        #expect(
            groups.flatMap {
                BudgetPlanOrdering.items(in: $0, collapsed: state.collapsesCategories)
            }
                == groups.map { .group($0.id) })
        let move = try #require(
            BudgetPlanOrdering.change(
                moving: .group("everyday"), to: .afterGroup("empty"), in: groups))
        let moved = move.applying(to: groups)
        #expect(moved.map(\.id) == ["bills", "empty", "everyday", "cards"])
        #expect(moved[2].categories == groups[0].categories)
        state.end(id: UUID())
        #expect(state.collapsesCategories)
        state.end(id: id)
        #expect(!state.collapsesCategories)
        #expect(
            BudgetPlanOrdering.items(in: moved[2], collapsed: state.collapsesCategories)
                == [.group("everyday"), .category("food"), .category("fuel")])
        let next = UUID()
        state.begin(id: next, item: .category("food"))
        #expect(!state.collapsesCategories)
        state.end(id: id)
        #expect(state.sessionID == next)
        state.end(id: next)
        #expect(state.item == nil)
    }

    @Test
    func groupMovesKeepTheirCategoriesAndMapHiddenServerGroups() throws {
        let groups = BudgetPlanFixture.groups
        let change = try #require(
            BudgetPlanOrdering.change(
                moving: .group("everyday"), to: .afterGroup("cards"), in: groups))
        let reordered = change.applying(to: groups)
        #expect(reordered.map(\.id) == ["bills", "empty", "cards", "everyday"])
        #expect(reordered.last == groups.first)
        #expect(
            BudgetPlanOrdering.change(
                moving: .group("bills"), to: .beforeGroup("empty"), in: groups) == nil)
        #expect(
            BudgetPlanOrdering.serverGroupPosition(
                movingID: "b", position: 1, visibleIDs: ["b", "a", "c"],
                allIDs: ["hidden", "b", "a", "c"]) == 2)
        #expect(
            BudgetPlanOrdering.serverGroupPosition(
                movingID: "b", position: 2, visibleIDs: ["b", "a", "c"],
                allIDs: ["b", "a", "c", "hidden"]) == 3)
    }

    @Test
    func mutationArgumentsMatchExistingConvexAPIs() throws {
        let within = BudgetPlanChange.moveCategory(
            id: "food", sourceGroupID: "a", groupID: "a", position: 2)
        let cross = BudgetPlanChange.moveCategory(
            id: "food", sourceGroupID: "a", groupID: "b", position: 0)
        #expect(within.function == "categories:updateCategorySortOrder")
        #expect(cross.function == "categories:moveCategoryToGroup")
        let withinJSON = try within.arguments(workspaceID: "workspace").convexEncode()
        #expect(withinJSON.contains("\"newPosition\":2"))
        #expect(!withinJSON.contains("$integer"))
        #expect(!withinJSON.contains("targetGroupId"))
        let crossJSON = try cross.arguments(workspaceID: "workspace").convexEncode()
        #expect(crossJSON.contains("\"targetGroupId\":\"b\""))
        let groupJSON = try BudgetPlanChange.addGroup(name: "Bills").arguments(
            workspaceID: "workspace"
        ).convexEncode()
        #expect(groupJSON.contains("\"type\":\"expense\""))
    }

    @Test
    func decodesMonthlyRequirementWithoutLosingMinorUnits() throws {
        var amount = Int64(125_099).littleEndian
        let encoded = withUnsafeBytes(of: &amount) { Data($0).base64EncodedString() }
        let json = """
            {"yearMonth":202609,"budgetData":{},"summary":{"totalTargetAmount":{"$integer":"\(encoded)"}}}
            """
        let month = try JSONDecoder().decode(BudgetMonthSnapshot.self, from: Data(json.utf8))
        #expect(month.summary?.totalTargetAmount == 125_099)
        let older = try JSONDecoder().decode(
            BudgetMonthSnapshot.self,
            from: Data(
                #"{"yearMonth":202609,"budgetData":{}}"#.utf8))
        #expect(older.summary == nil)
    }

    @Test
    func monthlyNumberUsesCurrentBackendSummaryEvenWhenBrowsingOtherMonths() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        fixture.store.selectMonth(202608)
        #expect(fixture.store.monthlyPlanAmount == 125_099)
        #expect(fixture.store.readyToAssign == 5_000)
        fixture.store.selectMonth(202610)
        #expect(fixture.store.monthlyPlanAmount == 125_099)
        // Structure edits remain possible while browsing a locked month.
        fixture.store.selectMonth(202607)
        #expect(fixture.store.canEditPlan)
    }

    @Test
    func namesAndNewItemsSaveIndividuallyAndUpdateBudgetImmediately() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        #expect(
            await fixture.store.savePlanChange(.addGroup(name: "Savings"), workspaceID: "workspace")
        )
        #expect(fixture.store.planGroups.first?.id == "created")
        #expect(fixture.store.groups.first?.name == "Savings")
        #expect(
            await fixture.store.savePlanChange(
                .renameCategory(id: "food", name: "Groceries"), workspaceID: "workspace"))
        #expect(fixture.requests.count == 2)
        #expect(fixture.store.groups.flatMap(\.rows).first { $0.id == "food" }?.name == "Groceries")
        #expect(!fixture.store.isSavingPlan)
    }

    @Test
    func failedMoveRollsBackAndPreventsOverlappingWrites() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        var response: CheckedContinuation<String?, Error>?
        fixture.handler = { _, _, _ in try await withCheckedThrowingContinuation { response = $0 } }
        let operation = Task {
            await fixture.store.savePlanChange(
                .moveGroup(id: "bills", position: 0), workspaceID: "workspace")
        }
        await fixture.waitUntil { response != nil }
        #expect(fixture.store.planGroups.first?.id == "bills")
        #expect(fixture.store.isSavingPlan)
        #expect(!fixture.store.canEditPlan)
        #expect(
            !(await fixture.store.savePlanChange(
                .addGroup(name: "Another"), workspaceID: "workspace")))
        #expect(fixture.requests.count == 1)
        response?.resume(throwing: BudgetSaveError.rejected)
        #expect(!(await operation.value))
        #expect(fixture.store.planGroups == BudgetPlanFixture.groups)
        #expect(fixture.store.planError != nil)
        #expect(!fixture.store.isSavingPlan)
    }

    @Test
    func nativeDropPositionsExcludeHeadersAndEmptyRows() throws {
        let groups = BudgetPlanFixture.groups
        let down = try #require(
            BudgetPlanOrdering.move(
                item: .category("food"), toGroupID: "everyday", row: 2, in: groups))
        #expect(
            down.change(in: groups)?.applying(to: groups)[0].categories.map(\.id) == [
                "fuel", "food",
            ])
        let across = try #require(
            BudgetPlanOrdering.move(
                item: .category("food"), toGroupID: "bills", row: 1, in: groups))
        #expect(
            across.change(in: groups)?.applying(to: groups)[1].categories.map(\.id) == [
                "food", "rent",
            ])
        let append = try #require(
            BudgetPlanOrdering.move(
                item: .category("food"), toGroupID: "bills", row: 2, in: groups))
        #expect(
            append.change(in: groups)?.applying(to: groups)[1].categories.map(\.id) == [
                "rent", "food",
            ])
        let empty = try #require(
            BudgetPlanOrdering.move(
                item: .category("rent"), toGroupID: "empty", row: 1, in: groups))
        #expect(empty.change(in: groups)?.applying(to: groups)[2].categories.map(\.id) == ["rent"])
        let group = try #require(
            BudgetPlanOrdering.move(
                item: .group("everyday"), toGroupID: nil, row: 3, in: groups))
        #expect(group.change(in: groups)?.applying(to: groups).last?.id == "everyday")
        #expect(
            BudgetPlanOrdering.move(item: .empty("empty"), toGroupID: "bills", row: 1, in: groups)
                == nil)
        #expect(
            BudgetPlanOrdering.move(item: .category("food"), toGroupID: "bills", row: 0, in: groups)
                == nil)
        #expect(
            BudgetPlanOrdering.move(item: .group("everyday"), toGroupID: nil, row: 0, in: groups)
                == nil)
    }

    @Test
    func crossGroupLayoutCanMeasureIncomingSlotBeforeDrop() throws {
        let rows = BudgetPlanFixture.groups.map {
            BudgetPlanOrdering.items(in: $0, collapsed: false)
        }
        // Bills contains header + rent. UIKit asks for row 2 while previewing
        // Food below Rent, before the data-source move callback has run.
        #expect(rows[1].count == 2)
        #expect(BudgetPlanOrdering.rowItem(in: rows, section: 1, row: 2) == nil)
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: 1, row: 2, moving: .category("food")) == .category("food"))
        let moved = try #require(
            BudgetPlanOrdering.movingRow(
                in: rows, item: .category("food"), sourceSection: 0, sourceRow: 1,
                destinationSection: 1, destinationRow: 2))
        #expect(moved[0] == [.group("everyday"), .category("fuel")])
        #expect(moved[1] == [.group("bills"), .category("rent"), .category("food")])
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: moved, section: 1, row: 2, moving: nil) == .category("food"))
        // Cancelling the preview leaves the original rows and counts intact.
        #expect(rows[0] == [.group("everyday"), .category("food"), .category("fuel")])
        #expect(BudgetPlanOrdering.sizingItem(in: rows, section: 1, row: 2, moving: nil) == nil)
    }

    @Test
    func layoutSizingHandlesEmptyGroupsAndRejectsUnrelatedInvalidPaths() {
        let rows = BudgetPlanFixture.groups.map {
            BudgetPlanOrdering.items(in: $0, collapsed: false)
        }
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: 2, row: 1, moving: .category("rent")) == .empty("empty"))
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: 2, row: 2, moving: .category("rent")) == .category("rent"))
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: -1, row: 0, moving: .category("food")) == nil)
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: rows.count, row: 0, moving: .category("food")) == nil)
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: 1, row: -1, moving: .category("food")) == nil)
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: 1, row: 3, moving: .category("food")) == nil)
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: rows, section: 1, row: 2, moving: .empty("empty")) == nil)
    }

    @Test
    func rowMovesValidateBeforeRemovalAndPreserveEveryCategory() throws {
        let rows = BudgetPlanFixture.groups.map {
            BudgetPlanOrdering.items(in: $0, collapsed: false)
        }
        #expect(
            BudgetPlanOrdering.movingRow(
                in: rows, item: .category("food"), sourceSection: 0, sourceRow: 1,
                destinationSection: 1, destinationRow: 3) == nil)
        #expect(
            BudgetPlanOrdering.movingRow(
                in: rows, item: .category("food"), sourceSection: 0, sourceRow: 9,
                destinationSection: 1, destinationRow: 1) == nil)
        #expect(
            BudgetPlanOrdering.movingRow(
                in: rows, item: .category("food"), sourceSection: 0, sourceRow: 1,
                destinationSection: 9, destinationRow: 1) == nil)
        #expect(
            BudgetPlanOrdering.movingRow(
                in: rows, item: .category("fuel"), sourceSection: 0, sourceRow: 1,
                destinationSection: 1, destinationRow: 1) == nil)
        let within = try #require(
            BudgetPlanOrdering.movingRow(
                in: rows, item: .category("food"), sourceSection: 0, sourceRow: 1,
                destinationSection: 0, destinationRow: 2))
        #expect(within[0] == [.group("everyday"), .category("fuel"), .category("food")])
        let emptied = try #require(
            BudgetPlanOrdering.movingRow(
                in: rows, item: .category("rent"), sourceSection: 1, sourceRow: 1,
                destinationSection: 2, destinationRow: 1))
        #expect(emptied[1] == [.group("bills")])
        #expect(
            BudgetPlanOrdering.sizingItem(
                in: emptied, section: 1, row: 1, moving: .category("rent")) == .category("rent"))
        let restored = try #require(
            BudgetPlanOrdering.movingRow(
                in: emptied, item: .category("rent"), sourceSection: 2, sourceRow: 1,
                destinationSection: 1, destinationRow: 1))
        #expect(restored == rows)
        #expect(Set(within.flatMap { $0 }) == Set(rows.flatMap { $0 }))
    }

    @Test
    func nativeTargetsKeepHeadersAndEmptyGroupsReachable() {
        let groups = BudgetPlanFixture.groups
        #expect(
            BudgetPlanOrdering.targetRow(
                sourceGroupID: "everyday", targetGroupID: "empty", proposedRow: 0, in: groups) == 1)
        #expect(
            BudgetPlanOrdering.targetRow(
                sourceGroupID: "everyday", targetGroupID: "empty", proposedRow: 2, in: groups) == 1)
        #expect(
            BudgetPlanOrdering.targetRow(
                sourceGroupID: "bills", targetGroupID: "bills", proposedRow: 0, in: groups) == 1)
        #expect(
            BudgetPlanOrdering.targetRow(
                sourceGroupID: "everyday", targetGroupID: "bills", proposedRow: 9, in: groups) == 2)
        #expect(
            BudgetPlanOrdering.targetRow(
                sourceGroupID: "bills", targetGroupID: "everyday", proposedRow: 9, in: groups) == 3)
        #expect(
            BudgetPlanOrdering.targetRow(
                sourceGroupID: "everyday", targetGroupID: "cards", proposedRow: 1, in: groups)
                == nil)
        #expect(
            BudgetPlanOrdering.targetRow(
                sourceGroupID: "cards", targetGroupID: "bills", proposedRow: 1, in: groups) == nil)
    }

    @Test
    func consecutiveDragsUpdateImmediatelyAndSaveInOrder() async throws {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        var responses: [CheckedContinuation<String?, Error>] = []
        fixture.handler = { _, _, _ in
            try await withCheckedThrowingContinuation { responses.append($0) }
        }
        #expect(
            fixture.store.enqueuePlanMove(
                .init(
                    item: .category("rent"), destination: .category(groupID: "empty", beforeID: nil)
                ),
                workspaceID: "workspace"))
        await fixture.waitUntil { responses.count == 1 }
        #expect(fixture.store.canReorderPlan)
        #expect(fixture.store.planGroups[1].categories.isEmpty)
        // Move the same item back before its first request completes.
        #expect(
            fixture.store.enqueuePlanMove(
                .init(
                    item: .category("rent"), destination: .category(groupID: "bills", beforeID: nil)
                ),
                workspaceID: "workspace"))
        #expect(fixture.store.planGroups == BudgetPlanFixture.groups)
        #expect(fixture.requests.count == 1)
        responses[0].resume(returning: nil)
        await fixture.waitUntil { responses.count == 2 }
        #expect(
            fixture.requests[1]
                == .moveCategory(id: "rent", sourceGroupID: "empty", groupID: "bills", position: 0))
        #expect(fixture.store.planGroups == BudgetPlanFixture.groups)
        responses[1].resume(returning: nil)
        await fixture.waitUntil { !fixture.store.isSavingPlan }
        #expect(fixture.store.canEditPlan)
        #expect(fixture.store.planGroups == BudgetPlanFixture.groups)
    }

    @Test
    func failedQueuedMoveRestoresLastSavedOrderAndDiscardsDependentWrites() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        var responses: [CheckedContinuation<String?, Error>] = []
        fixture.handler = { _, _, _ in
            try await withCheckedThrowingContinuation { responses.append($0) }
        }
        let first = BudgetPlanOrdering.Move(
            item: .category("food"), destination: .category(groupID: "bills", beforeID: "rent"))
        #expect(fixture.store.enqueuePlanMove(first, workspaceID: "workspace"))
        #expect(
            fixture.store.enqueuePlanMove(
                .init(
                    item: .category("fuel"), destination: .category(groupID: "empty", beforeID: nil)
                ), workspaceID: "workspace"))
        #expect(
            fixture.store.enqueuePlanMove(
                .init(
                    item: .category("rent"),
                    destination: .category(groupID: "everyday", beforeID: nil)),
                workspaceID: "workspace"))
        await fixture.waitUntil { responses.count == 1 }
        responses[0].resume(returning: nil)
        await fixture.waitUntil { responses.count == 2 }
        responses[1].resume(throwing: BudgetSaveError.rejected)
        await fixture.waitUntil { !fixture.store.isSavingPlan }
        #expect(fixture.requests.count == 2)
        #expect(
            fixture.store.planGroups
                == first.change(in: BudgetPlanFixture.groups)?.applying(
                    to: BudgetPlanFixture.groups))
        #expect(fixture.store.planError != nil)
        #expect(fixture.store.canReorderPlan)
    }

    @Test
    func queuedMovesRebaseOnLiveConfirmationAndPreserveRemoteNames() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        let first = BudgetPlanOrdering.Move(
            item: .category("rent"), destination: .category(groupID: "empty", beforeID: nil))
        var response: CheckedContinuation<String?, Error>?
        fixture.handler = { _, _, _ in
            try await withCheckedThrowingContinuation { response = $0 }
        }
        #expect(fixture.store.enqueuePlanMove(first, workspaceID: "workspace"))
        await fixture.waitUntil { response != nil }
        var live = first.change(in: BudgetPlanFixture.groups)!.applying(
            to: BudgetPlanFixture.groups)
        live = BudgetPlanChange.renameCategory(id: "rent", name: "Mortgage").applying(to: live)
        fixture.structure.send(BudgetPlanFixture.structure(groups: live))
        await fixture.waitUntil { fixture.store.planGroups[2].categories.first?.name == "Mortgage" }
        response?.resume(returning: nil)
        await fixture.waitUntil { !fixture.store.isSavingPlan }
        #expect(fixture.store.planGroups == live)
        #expect(fixture.requests.count == 1)
    }

    @Test
    func workspaceChangeDiscardsQueueWithoutClearingNewWorkspaceMoves() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        var responses: [CheckedContinuation<String?, Error>] = []
        fixture.handler = { _, _, _ in
            try await withCheckedThrowingContinuation { responses.append($0) }
        }
        #expect(
            fixture.store.enqueuePlanMove(
                .init(item: .group("bills"), destination: .beforeGroup("everyday")),
                workspaceID: "workspace"))
        await fixture.waitUntil { responses.count == 1 }
        fixture.structure.send(BudgetPlanFixture.structure(workspaceID: "other"))
        await fixture.waitUntil {
            fixture.store.workspace?.id == "other" && fixture.store.canEditPlan
        }
        #expect(
            fixture.store.enqueuePlanMove(
                .init(item: .group("empty"), destination: .beforeGroup("everyday")),
                workspaceID: "other"))
        await fixture.waitUntil { responses.count == 2 }
        responses[0].resume(returning: nil)
        await Task.yield()
        #expect(fixture.store.isSavingPlan)
        #expect(fixture.store.planGroups.first?.id == "empty")
        responses[1].resume(returning: nil)
        await fixture.waitUntil { !fixture.store.isSavingPlan }
        #expect(fixture.store.planGroups.first?.id == "empty")
    }

    @Test
    func liveConfirmationBeforeReceiptDoesNotDuplicateNewCategory() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        let change = BudgetPlanChange.addCategory(groupID: "empty", name: "Trips")
        fixture.handler = { _, _, _ in
            fixture.structure.send(
                BudgetPlanFixture.structure(
                    groups:
                        change.applying(to: BudgetPlanFixture.groups, createdID: "trips")))
            await fixture.waitUntil { fixture.store.planGroups[2].categories.count == 1 }
            return "trips"
        }
        #expect(await fixture.store.savePlanChange(change, workspaceID: "workspace"))
        #expect(fixture.store.planGroups[2].categories.map(\.id) == ["trips"])
    }

    @Test
    func workspaceChangeCannotApplyOldReceiptOrClearNewErrors() async {
        let fixture = BudgetPlanFixture()
        await fixture.load()
        fixture.handler = { _, _, _ in
            fixture.structure.send(BudgetPlanFixture.structure(workspaceID: "other"))
            await fixture.waitUntil { fixture.store.workspace?.id == "other" }
            fixture.store.planError = "New workspace message"
            return "old-item"
        }
        #expect(
            !(await fixture.store.savePlanChange(.addGroup(name: "Old"), workspaceID: "workspace")))
        #expect(fixture.store.planGroups == BudgetPlanFixture.groups)
        #expect(fixture.store.planError == "New workspace message")
        #expect(!fixture.store.isSavingPlan)
    }
}

@MainActor
private final class BudgetPlanFixture {
    let structure = CurrentValueSubject<BudgetStructure, Error>(BudgetPlanFixture.structure())
    let snapshot = CurrentValueSubject<BudgetSnapshot, Error>(
        BudgetSnapshot(
            months: [
                .init(
                    yearMonth: 202608, budgetData: [:], summary: .init(totalTargetAmount: 400_000)),
                .init(
                    yearMonth: 202609, budgetData: [:], summary: .init(totalTargetAmount: 125_099)),
                .init(
                    yearMonth: 202610, budgetData: [:], summary: .init(totalTargetAmount: 200_000)),
            ], availableRange: .init(minYearMonth: 202608, maxYearMonth: 202610),
            readyToAssign: 5_000))
    var requests: [BudgetPlanChange] = []
    var handler: BudgetStore.PlanChangeHandler = { _, change, _ in
        change.createsItem ? "created" : nil
    }
    lazy var store = BudgetStore(
        now: { BudgetMonth.date(202609).addingTimeInterval(100_000) }, defaults: nil,
        structureSubscription: { [unowned self] in structure.eraseToAnyPublisher() },
        snapshotSubscription: { [unowned self] _, _ in snapshot.eraseToAnyPublisher() },
        assignmentHandler: { _ in .init(success: true) },
        planChangeHandler: { [unowned self] workspaceID, change, groupIDs in
            requests.append(change)
            return try await handler(workspaceID, change, groupIDs)
        })

    func load() async {
        store.start()
        await waitUntil { self.store.canEditPlan }
    }

    func waitUntil(_ condition: @escaping @MainActor () -> Bool) async {
        for _ in 0..<100 {
            if condition() { return }
            try? await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }

    static func structure(
        workspaceID: String = "workspace", groups: [BudgetCategoryGroup]? = nil
    ) -> BudgetStructure {
        .init(
            workspace: .init(
                id: workspaceID, name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: "UTC"), categoryGroups: groups ?? Self.groups)
    }

    static let groups: [BudgetCategoryGroup] = [
        .init(
            categoryGroup: .init(_id: "everyday", name: "Everyday", type: "expense"),
            categories: [
                .init(_id: "food", name: "Food", iconName: nil, type: "expense"),
                .init(_id: "fuel", name: "Fuel", iconName: nil, type: "expense"),
            ]),
        .init(
            categoryGroup: .init(_id: "bills", name: "Bills", type: "expense"),
            categories: [
                .init(_id: "rent", name: "Rent", iconName: nil, type: "expense")
            ]),
        .init(categoryGroup: .init(_id: "empty", name: "Empty", type: "expense"), categories: []),
        .init(
            categoryGroup: .init(_id: "cards", name: "Cards", type: "credit_card"),
            categories: [
                .init(_id: "visa", name: "Visa", iconName: nil, type: "credit_card")
            ]),
    ]
}
