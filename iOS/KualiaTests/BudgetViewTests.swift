import Combine
import Foundation
import SwiftUI
import Testing
import UIKit

@testable import Kualia

@Suite(.serialized)
@MainActor
struct BudgetViewTests {
    @Test(arguments: [false, true])
    func budgetMountsOnlyOneVerticalMonthPageAcrossTabAndMonthChanges(isActive: Bool) async throws {
        let budget = scrollingBudget(monthCount: 2)
        defer { budget.stop() }
        budget.start()
        for _ in 0..<1_000 where !budget.canEdit { await Task.yield() }
        try #require(budget.canEdit)
        let initialMonth = budget.selectedMonth

        for month in [initialMonth, BudgetMonth.offset(initialMonth, by: 1), initialMonth] {
            budget.selectMonth(month)
            #expect(budget.selectedMonth == month)
            #expect(!budget.groups.isEmpty)
            var monthScrollCount = 0
            _ = try await HostedViewSnapshot.image(
                of: BudgetView(
                    store: budget, isActive: isActive, editingCategoryID: nil,
                    onEdit: { _ in }, onChangeMonth: {}
                ),
                size: CGSize(width: 390, height: 740),
                inspect: { root in
                    func inspect(_ view: UIView) {
                        // Ignore the short category-filter strip. There must be just
                        // one full-height scroll view and it must scroll vertically.
                        if let scroll = view as? UIScrollView, scroll.bounds.height > 200 {
                            monthScrollCount += 1
                            #expect(scroll.contentSize.width <= scroll.bounds.width + 1)
                            #expect(scroll.contentSize.height > scroll.bounds.height)
                        }
                        for child in view.subviews { inspect(child) }
                    }
                    inspect(root)
                })
            #expect(monthScrollCount == 1)
        }
    }

    @Test
    func fundingAnimationRevealsExactIntermediatePercentagesWithoutMovingTheTrack() {
        let bounds = CGRect(x: 10, y: 20, width: 200, height: 24)
        var mask = BudgetFundingProgressMask(progress: 0)
        // Sample increases, decreases, and interruptions at the interpolated value.
        for progress in [0.1, 0.25, 0.5, 0.9, 1, 0.75, 0.4, 0.6] {
            mask.animatableData = progress
            let path = mask.path(in: bounds)
            #expect(abs(path.boundingRect.width - bounds.width * progress) < 0.001)
            #expect(path.boundingRect.minX == bounds.minX)
            #expect(path.boundingRect.minY == bounds.minY)
            #expect(path.boundingRect.height == bounds.height)
            #expect(path.contains(CGPoint(x: bounds.minX + 1, y: bounds.midY)))
            #expect(!path.contains(CGPoint(x: bounds.maxX + 1, y: bounds.midY)))
        }
        mask.animatableData = 1.2
        #expect(mask.path(in: bounds).boundingRect == bounds)
        for progress in [0, -0.2, Double.infinity, .nan] {
            mask.animatableData = progress
            #expect(!mask.path(in: bounds).contains(CGPoint(x: 11, y: bounds.midY)))
        }
    }

    @Test
    func budgetProgressAnimationsRespectReduceMotion() {
        #expect(BudgetProgressMotion.animation(reduceMotion: true) == nil)
        #expect(BudgetProgressMotion.animation(reduceMotion: false) != nil)
    }

    @Test func archivedCategoriesOwnTheirNavigationToolbarAndScrollEdges() async throws {
        let budget = scrollingBudget()
        defer { budget.stop() }
        budget.start()
        for _ in 0..<1_000 where !budget.canEdit { await Task.yield() }
        let workspaceID = try #require(budget.workspace?.id)
        var client = BudgetCategoryLifecycleClient.unavailable
        client.loadGroups = { _ in
            [
                .init(
                    group: .init(
                        _id: "archived", name: "Archived group", type: "expense", isDeleted: false),
                    categories: (0..<30).map {
                        .init(
                            _id: "archived-\($0)", name: "Category \($0)", iconName: nil,
                            type: "expense", isArchived: true)
                    })
            ]
        }
        let archived = BudgetArchivedCategoriesStore(workspaceID: workspaceID, client: client)
        defer { archived.stop() }
        await archived.load()
        var inspected = false
        _ = try await HostedViewSnapshot.image(
            of: BudgetArchivedCategoriesView(budget: budget, store: archived),
            size: CGSize(width: 390, height: 740),
            inspect: { root in
                func inspect(_ view: UIView) {
                    if let scroll = view as? UIScrollView,
                        scroll.contentSize.height > scroll.bounds.height
                    {
                        inspected = true
                        var responder: UIResponder? = scroll
                        var navigation: UINavigationController?
                        while let current = responder {
                            if let controller = current as? UIViewController,
                                let owner = controller.navigationController
                            {
                                navigation = owner
                                break
                            }
                            responder = current.next
                        }
                        #expect(navigation != nil)
                        #expect(navigation?.isNavigationBarHidden == false)
                        #expect(
                            navigation?.navigationBar.topItem?.title
                                == L10n.string("Archived categories"))
                        #expect(
                            navigation?.navigationBar.topItem?.rightBarButtonItems?.isEmpty == false
                        )
                        let viewport = scroll.frame
                        let insets = scroll.adjustedContentInset
                        scroll.setContentOffset(CGPoint(x: 0, y: 120 - insets.top), animated: false)
                        root.layoutIfNeeded()
                        #expect(scroll.frame == viewport)
                        #expect(scroll.adjustedContentInset == insets)
                        #expect(abs(scroll.contentOffset.y + insets.top - 120) < 1)
                        if #available(iOS 26.0, *) {
                            #expect(!scroll.topEdgeEffect.isHidden)
                            #expect(scroll.topEdgeEffect.style == .soft)
                            #expect(!scroll.bottomEdgeEffect.isHidden)
                        }
                    }
                    for child in view.subviews { inspect(child) }
                }
                inspect(root)
            })
        #expect(inspected)
    }

    @Test
    func fundingFillOnlyAnimatesEnabledLiveUpdates() {
        var initial = Transaction(animation: .default)
        BudgetFundingAnimation(progress: 0.75, isEnabled: false).update(&initial)
        #expect(initial.animation == nil)

        var liveUpdate = Transaction()
        BudgetFundingAnimation(progress: 0.85, isEnabled: true).update(&liveUpdate)
        #expect(liveUpdate.animation == .easeInOut(duration: 0.45))

        var disabled = Transaction(animation: .default)
        disabled.disablesAnimations = true
        BudgetFundingAnimation(progress: 0.9, isEnabled: true).update(&disabled)
        #expect(disabled.animation == nil)
        #expect(disabled.disablesAnimations)
    }

    @Test(arguments: [false, true])
    func categoryProgressExpandsOnlyAmountRowsAndFitsAccessibilityLayouts(isCompact: Bool) {
        let row = BudgetCategoryRowModel(
            id: "category", name: "Groceries and other everyday expenses",
            isCreditCard: false, assigned: 1_000, available: 750, activity: -250,
            isPending: false,
            progress: .init(target: .init(fundedRatio: 0.5, spentRatio: 0.25)))
        for width: CGFloat in [296, 390] {
            for typeSize in [DynamicTypeSize.large, .accessibility3] {
                for showsAmounts in [false, true] {
                    let heights = [false, true].map { showsProgress in
                        let controller = UIHostingController(
                            rootView: BudgetCategoryRow(
                                row: row, currencyCode: "USD", minorUnit: 2,
                                isEditing: false, calculator: nil, canEdit: true,
                                amountColumnWidth: 96, onEdit: {},
                                showsProgress: showsProgress, showsAmounts: showsAmounts,
                                isCompact: isCompact
                            )
                            .environment(\.dynamicTypeSize, typeSize)
                            .environment(\.locale, Locale(identifier: "en_US")))
                        let size = controller.sizeThatFits(in: CGSize(width: width, height: 2_000))
                        #expect(size.width <= width + 0.5)
                        #expect(size.height >= 44)
                        return size.height
                    }
                    #expect(
                        abs(heights[1] - heights[0] - (showsAmounts ? (isCompact ? 6 : 16) : 0))
                            < 0.5)
                    if showsAmounts, typeSize == .large {
                        #expect(abs(heights[0] - (isCompact ? 44 : 56)) < 0.5)
                    }
                }
            }
        }
    }

    @Test(arguments: [false, true])
    func fundingCaptionUsesAFooterOnlyInStandardLayout(isCompact: Bool) {
        let fundingCases: [BudgetCategoryFunding] = [
            .init(amounts: .init(available: -50_000)),
            .init(amounts: .init(target: .init(targetAmount: 50_000, remainingToAssign: 50_000))),
            .init(amounts: .init(target: .init(targetAmount: 50_000, remainingToAssign: 0))),
        ]
        for funding in fundingCases {
            #expect(funding.status(target: nil, month: 202609) != nil)
            for width: CGFloat in [296, 390] {
                let controller = UIHostingController(
                    rootView: BudgetCategoryRow(
                        row: .init(
                            id: "category", name: "Groceries and other everyday expenses",
                            isCreditCard: false, assigned: 0, available: 0, activity: 0,
                            isPending: false, funding: funding),
                        currencyCode: "USD", minorUnit: 2, isEditing: false,
                        calculator: nil, canEdit: true, amountColumnWidth: 96, onEdit: {},
                        showsProgress: true, month: 202609, isCompact: isCompact
                    )
                    .environment(\.dynamicTypeSize, .large)
                    .environment(\.locale, Locale(identifier: "en_US")))
                let size = controller.sizeThatFits(in: CGSize(width: width, height: 2_000))
                #expect(abs(size.width - width) < 0.5)
                #expect(isCompact ? abs(size.height - 50) < 0.5 : size.height > 72)
            }
        }
    }

    @Test(arguments: [false, true], [false, true])
    func categoryStatusVisibilityIsIndependentOfProgressBars(
        isCompact: Bool, showsProgress: Bool
    ) throws {
        func render(showsStatus: Bool) throws -> UIImage {
            let renderer = ImageRenderer(
                content: BudgetCategoryRow(
                    row: .init(
                        id: "category", name: "Groceries", isCreditCard: false,
                        assigned: 10_000, available: -1_000, activity: -11_000, isPending: false,
                        funding: .init(amounts: .init(available: -1_000))),
                    currencyCode: "USD", minorUnit: 2, isEditing: false, calculator: nil,
                    canEdit: true, amountColumnWidth: 96, onEdit: {}, showsProgress: showsProgress,
                    month: 202609, isCompact: isCompact, showsStatus: showsStatus
                )
                .frame(width: 390)
                .environment(\.locale, Locale(identifier: "en_US"))
                .environment(\.dynamicTypeSize, .large)
                .environment(\.colorScheme, .light))
            let image = try #require(renderer.uiImage)
            let expectedHeight: CGFloat =
                (isCompact ? 44 : 56) + (showsProgress ? (isCompact ? 6 : 16) : 0)
            if !isCompact, showsProgress, showsStatus {
                #expect(image.size.height > expectedHeight)
            } else {
                #expect(abs(image.size.height - expectedHeight) < 0.5)
            }
            return image
        }
        let visible = try render(showsStatus: true)
        let hidden = try render(showsStatus: false)
        #expect(visible.pngData() != hidden.pngData())
        func contentAboveStatus(in image: UIImage) throws -> Data {
            // Only standard rows with progress bars put status after the track.
            // Otherwise status belongs inside the row beneath the category name.
            let height: CGFloat = isCompact ? 44 : 56 + (showsProgress ? 6 : 0)
            let bitmap = try #require(image.cgImage)
            let crop = try #require(
                bitmap.cropping(
                    to: CGRect(
                        x: 0, y: 0, width: image.size.width * image.scale,
                        height: height * image.scale)))
            return try #require(UIImage(cgImage: crop).pngData())
        }
        #expect(
            try (contentAboveStatus(in: visible) == contentAboveStatus(in: hidden))
                == (!isCompact && showsProgress))
    }

    @Test(arguments: [false, true])
    func categoryProgressEndsInSolidAvailableOrOverspentColor(isCompact: Bool) throws {
        let target = BudgetCategoryTarget(
            targetAmount: 20_000, remainingToAssign: 0, fundedRatio: 1, spentRatio: 1)
        let cases: [(Int64, Int64, Color)] = [
            (25_000, 5_000, KualiaPalette.budgetAvailableProgress),
            (2_000, -18_000, KualiaPalette.budgetNegative),
            (0, -20_000, KualiaPalette.budgetNegative),
        ]
        func pixel(of view: some View, x: CGFloat, y: CGFloat) throws -> [UInt8] {
            let renderer = ImageRenderer(
                content: view.frame(width: 200, height: 6)
                    .environment(\.colorScheme, .light))
            let image = try #require(renderer.cgImage)
            var pixel = [UInt8](repeating: 0, count: 4)
            try pixel.withUnsafeMutableBytes { bytes in
                let context = try #require(
                    CGContext(
                        data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                        bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                context.interpolationQuality = .none
                context.draw(image, in: CGRect(x: -x, y: -y, width: 200, height: 6))
            }
            return pixel
        }
        for (assigned, available, color) in cases {
            let progress = BudgetCategoryProgress(
                amounts: .init(
                    assignedAmount: assigned, available: available,
                    activity: -20_000, target: target),
                assigned: assigned, targetKind: .setAside, isFutureMonth: false)
            let points =
                isCompact
                ? [CGPoint(x: 190, y: 3), CGPoint(x: 199, y: 0), CGPoint(x: 199, y: 5)]
                : [CGPoint(x: 190, y: 3)]
            for point in points {
                let actual = try pixel(
                    of: BudgetCategoryProgressBar(
                        progress: progress, categoryName: "Groceries", isCompact: isCompact),
                    x: point.x, y: point.y)
                let expected = try pixel(of: Rectangle().fill(color), x: point.x, y: point.y)
                #expect(actual == expected)
            }
        }
    }

    @Test
    func fundingMarksRemainVisibleInCompactTracks() {
        for width: CGFloat in [1, 5, 12, 44, 112, 340] {
            for count in [5, 17, 33] {
                let path = BudgetFundingMarks(count: count, gap: 3)
                    .path(in: CGRect(x: 0, y: 0, width: width, height: 24))
                let visibleSamples = (0..<1_000).filter { index in
                    path.contains(CGPoint(x: width * (CGFloat(index) + 0.5) / 1_000, y: 20))
                }
                #expect(visibleSamples.count >= 400)
            }
        }
    }

    @Test(arguments: [false, true])
    func compactGroupAndTotalsHeadersGrowWithDynamicType(isCompact: Bool) async throws {
        let store = scrollingBudget()
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 where !store.canEdit { await Task.yield() }
        try #require(store.canEdit)
        let group = try #require(store.groups.first)
        store.toggleGroup(group.id)
        let proposal = CGSize(width: 366, height: 2_000)
        var heights: [(group: CGFloat, totals: CGFloat)] = []

        for size in [DynamicTypeSize.large, .accessibility3] {
            let header = UIHostingController(
                rootView: BudgetCategoryGroupSection(
                    store: store, group: group, month: store.selectedMonth,
                    showsCategoryProgress: false, editingCategoryID: nil,
                    animatesDisclosure: false, onEdit: { _ in }, onChangeMonth: {},
                    onMoveMoney: { _ in }, onOpenCategory: { _ in }, isCompact: isCompact
                ).environment(\.dynamicTypeSize, size))
            let totals = UIHostingController(
                rootView: BudgetTotalsRow(
                    totals: BudgetTotals(groups: [group]), currencyCode: "USD", minorUnit: 2,
                    isCompact: isCompact
                ).environment(\.dynamicTypeSize, size))
            let headerHeight = header.sizeThatFits(in: proposal).height
            let totalHeight = totals.sizeThatFits(in: proposal).height
            #expect(headerHeight >= 44)
            #expect(headerHeight <= totalHeight + 0.5)
            #expect(totalHeight - headerHeight <= 4.5)
            heights.append((headerHeight, totalHeight))
        }
        #expect(heights[1].group > heights[0].group)
        #expect(heights[1].totals > heights[0].totals)
    }

    @Test
    func filteredGroupsKeepTheirDisclosureStateAndCanStillBeToggled() async throws {
        let store = scrollingBudget(overspentCategoryID: "0-0")
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)
        store.toggleGroup("group-0")

        for filter in [BudgetCategoryFilter.all, .overspent, .all, .overspent] {
            store.categoryFilter = filter
            for isCollapsed in [true, false, true] {
                if store.collapsedGroupIDs.contains("group-0") != isCollapsed {
                    store.toggleGroup("group-0")
                }
                var frames: [String: CGRect] = [:]
                _ = try await HostedViewSnapshot.image(
                    of: BudgetView(
                        store: store, isActive: true, editingCategoryID: nil,
                        onEdit: { _ in }, onChangeMonth: {}
                    )
                    .onPreferenceChange(BudgetAssignmentFrames.self) { frames = $0 },
                    size: CGSize(width: 414, height: 1_000))
                #expect((frames["0-0"] == nil) == isCollapsed)
                #expect(store.collapsedGroupIDs.contains("group-0") == isCollapsed)
            }
        }
    }

    @Test
    func filterChangesCrossfadeWholeRowsWithoutSlidingSurvivingCategories() async throws {
        for typeSize in [DynamicTypeSize.large, .accessibility1] {
            var origins: [String: [CGFloat]] = [:]
            _ = try await HostedViewSnapshot.image(
                of: BudgetFilterTransitionRegressionView()
                    .environment(\.dynamicTypeSize, typeSize),
                size: CGSize(width: 390, height: 500), animationSampleCount: 60,
                onAnimationSample: { root in
                    @MainActor func record(_ view: UIView) {
                        if view.accessibilityIdentifier == "filter-retained-row",
                            let identity = view.accessibilityValue
                        {
                            let layer = view.layer.presentation() ?? view.layer
                            let rootLayer = root.layer.presentation() ?? root.layer
                            origins[identity, default: []].append(
                                layer.convert(CGPoint.zero, to: rootLayer).y)
                        }
                        for child in view.subviews { record(child) }
                    }
                    record(root)
                })
            // The same category appears at two different positions, with a fresh presentation
            // for each filter. Neither its outgoing nor incoming row travels between positions.
            #expect(origins.count >= 2)
            let positions = origins.values.compactMap(\.first)
            #expect((positions.max() ?? 0) - (positions.min() ?? 0) > 40)
            for samples in origins.values {
                #expect((samples.max() ?? 0) - (samples.min() ?? 0) < 1)
            }
        }
    }

    @Test
    func collapsedFundingLabelAndPercentageKeepTheHeaderCompact() {
        let summaries: [BudgetTargetFundingSummary?] = [
            nil,
            .init(funded: 0, remaining: 0, total: 0),
            .init(funded: 60_000, remaining: 15_000, total: 75_000),
            .init(funded: 75_000, remaining: 0, total: 75_000),
        ]
        let heights = summaries.map { summary in
            UIHostingController(
                rootView: BudgetTargetSummaryCard(
                    summary: summary.map { BudgetMonthlyFundingSummary(targets: $0) },
                    currencyCode: "USD", minorUnit: 2,
                    isExpanded: .constant(false)
                )
                .environment(\.dynamicTypeSize, .large)
                .environment(\.locale, Locale(identifier: "en_US"))
            ).sizeThatFits(in: CGSize(width: 390, height: 1_000)).height
        }
        #expect(abs(heights[0] - 48) < 0.5)
        #expect(abs(heights[1] - heights[0]) < 0.5)
        #expect(heights[2] > heights[0])
        #expect(heights[2] < 72)
        #expect(abs(heights[3] - heights[2]) < 0.5)
    }

    @Test
    func collapsingRowsReserveTheirVisibleHeightAtEveryExpansionStep() {
        for width: CGFloat in [296, 390] {
            for typeSize in [DynamicTypeSize.large, .accessibility3] {
                func card(expansion: CGFloat) -> some View {
                    VStack(spacing: 0) {
                        Text("Day to Day").frame(height: 52)
                        BudgetDisclosureLayout(expansion: expansion) {
                            VStack(spacing: 0) {
                                Text("Groceries and other everyday expenses")
                                    .font(.body)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(14)
                                Text("Transport").font(.body).padding(14)
                            }
                        }
                        .clipped()
                        Text("Next group").frame(height: 52)
                    }
                    .environment(\.dynamicTypeSize, typeSize)
                    .transaction { $0.disablesAnimations = true }
                }
                let controller = UIHostingController(rootView: card(expansion: 1))
                let proposal = CGSize(width: width, height: 2_000)
                let expandedHeight = controller.sizeThatFits(in: proposal).height
                let rowsHeight = expandedHeight - 104
                #expect(rowsHeight > 0)
                // Include reversals to exercise rapid close/open without remounting rows.
                for expansion: CGFloat in [1, 0.75, 0.5, 0.25, 0, 0.5, 1, 0, 1] {
                    controller.rootView = card(expansion: expansion)
                    let size = controller.sizeThatFits(in: proposal)
                    #expect(abs(size.height - (104 + rowsHeight * expansion)) < 0.5)
                    #expect(size.width <= width + 0.5)
                }
            }
        }
    }

    @Test
    func onlyTheVisibleBudgetMonthAnimatesSharedDisclosureChanges() {
        #expect(
            BudgetDisclosureMotion.isEnabled(isPageActive: true, isSelectedMonth: true))
        #expect(
            !BudgetDisclosureMotion.isEnabled(isPageActive: true, isSelectedMonth: false))
        #expect(
            !BudgetDisclosureMotion.isEnabled(isPageActive: false, isSelectedMonth: true))
        #expect(
            !BudgetDisclosureMotion.isEnabled(isPageActive: false, isSelectedMonth: false))
    }

    @Test
    func collapsedRowsDoNotExposeAssignmentFrames() async throws {
        for isExpanded in [true, false, true] {
            var frames: [String: CGRect] = [:]
            _ = try await HostedViewSnapshot.image(
                of: VStack {
                    Text("Day to Day")
                    BudgetGroupDisclosure(isExpanded: isExpanded) {
                        Text("Groceries")
                            .preference(
                                key: BudgetAssignmentFrames.self,
                                value: ["groceries": CGRect(x: 0, y: 52, width: 296, height: 60)])
                    }
                    Text("Next group")
                }
                .onPreferenceChange(BudgetAssignmentFrames.self) { frames = $0 },
                size: CGSize(width: 296, height: 300))
            #expect((frames["groceries"] != nil) == isExpanded)
        }
    }

    @Test
    func fundingExplanationFitsNarrowWidthsAndAccessibilityText() {
        let summaries: [BudgetTargetFundingSummary?] = [
            .init(funded: 60_000, remaining: 15_000, total: 75_000),
            .init(funded: 75_000, remaining: 0, total: 75_000),
            .init(funded: 0, remaining: 0, total: 0),
            .init(funded: -10_000, remaining: 85_000, total: 75_000),
            .init(funded: 9_000_000_000, remaining: 1_000_000_000, total: 10_000_000_000),
            nil,
        ]
        for width: CGFloat in [256, 350] {
            for typeSize in [DynamicTypeSize.large, .accessibility3] {
                for summary in summaries {
                    for (currency, minorUnit) in [("USD", 2), ("JPY", 0), ("KWD", 3)] {
                        let controller = UIHostingController(
                            rootView: BudgetTargetFundingExplanation(
                                summary: summary.map {
                                    BudgetMonthlyFundingSummary(
                                        targets: $0, extraFunded: 50_000, extraRemaining: 200_000)
                                }, currencyCode: currency, minorUnit: minorUnit,
                                month: 202609
                            )
                            .environment(\.dynamicTypeSize, typeSize)
                            .environment(\.locale, Locale(identifier: "en_US"))
                        )
                        let size = controller.sizeThatFits(
                            in: CGSize(width: width, height: 10_000))
                        #expect(size.width <= width + 0.5)
                        #expect(size.height > 300)
                        #expect(size.height < 10_000)
                    }
                }
            }
        }
    }

    @Test
    func targetSummaryFitsNarrowWidthsAndAccessibilityTextWithoutClipping() {
        let summaries: [BudgetTargetFundingSummary?] = [
            .init(funded: 60_000, remaining: 15_000, total: 75_000),
            .init(funded: 75_000, remaining: 0, total: 75_000),
            .init(funded: 0, remaining: 0, total: 0),
            .init(funded: 9_000_000_000, remaining: 1_000_000_000, total: 10_000_000_000),
            nil,
        ]
        for width: CGFloat in [296, 390] {
            for typeSize in [DynamicTypeSize.large, .accessibility3] {
                for summary in summaries {
                    func card(isExpanded: Bool) -> some View {
                        BudgetTargetSummaryCard(
                            summary: summary.map {
                                BudgetMonthlyFundingSummary(
                                    targets: $0, extraFunded: 50_000, extraRemaining: 200_000)
                            },
                            currencyCode: "USD", minorUnit: 2,
                            isExpanded: .constant(isExpanded)
                        )
                        .environment(\.dynamicTypeSize, typeSize)
                        .transaction { $0.disablesAnimations = true }
                        .environment(\.locale, Locale(identifier: "en_US"))
                    }
                    let controller = UIHostingController(rootView: card(isExpanded: false))
                    var heights: [CGFloat] = []
                    for isExpanded in [false, true, false, true] {
                        controller.rootView = card(isExpanded: isExpanded)
                        let size = controller.sizeThatFits(
                            in: CGSize(width: width, height: 2_000))
                        #expect(size.width <= width + 0.5)
                        #expect(size.height >= 44)
                        #expect(size.height < 2_000)
                        heights.append(size.height)
                    }
                    #expect(heights[1] > heights[0])
                    #expect(abs(heights[0] - heights[2]) < 0.5)
                    #expect(abs(heights[1] - heights[3]) < 0.5)
                }
            }
        }
    }

    @Test
    func categoryFiltersFitTheViewportAtAccessibilitySizes() {
        let rows = [
            BudgetCategoryRowModel(
                id: "overspent", name: "Groceries", isCreditCard: false, assigned: 100,
                available: -100, activity: -200, isPending: false,
                targetFundingStatus: .underfunded),
            BudgetCategoryRowModel(
                id: "funded", name: "Rent", isCreditCard: false, assigned: 1_000,
                available: 1_000, activity: 0, isPending: false,
                targetFundingStatus: .funded, extraFunded: 100),
            BudgetCategoryRowModel(
                id: "no-target", name: "Other", isCreditCard: false, assigned: 0,
                available: 0, activity: 0, isPending: false),
        ]
        let groups = [
            BudgetGroupModel(
                id: "group", name: "Everyday", rows: rows, assigned: 1_100, available: 900)
        ]
        for typeSize in [DynamicTypeSize.large, .accessibility3] {
            let controller = UIHostingController(
                rootView: BudgetCategoryFilterStrip(groups: groups, selection: .overspent) { _ in }
                    .environment(\.dynamicTypeSize, typeSize))
            let size = controller.sizeThatFits(in: CGSize(width: 296, height: 1_000))
            #expect(size.width <= 296.5)
            #expect(size.height >= 44)
            #expect(size.height < 200)
        }
    }

    @Test
    func navigatingToBudgetKeepsTheSingleRowHeaderWithoutMovingTheGroups() async throws {
        let store = scrollingBudget()
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)
        let probe = BudgetNavigationProbe()
        var origins: [Int: [CGFloat]] = [:]
        _ = try await HostedViewSnapshot.image(
            of: BudgetNavigationRegressionView(store: store, probe: probe),
            size: CGSize(width: 414, height: 740), animationSampleCount: 60,
            onAnimationSample: { root in
                guard probe.isBudgetSelected else { return }
                @MainActor func record(in view: UIView) {
                    if let scroll = view as? UIScrollView,
                        scroll.contentSize.height > scroll.bounds.height
                    {
                        let layer = scroll.layer.presentation() ?? scroll.layer
                        let rootLayer = root.layer.presentation() ?? root.layer
                        origins[probe.visit, default: []].append(
                            layer.convert(CGPoint.zero, to: rootLayer).y)
                    }
                    for child in view.subviews { record(in: child) }
                }
                record(in: root)
            })
        #expect(probe.visit == 2)
        for visit in 1...2 {
            let samples = try #require(origins[visit])
            try #require(samples.count > 5)
            // 48pt toolbar row + 18pt surrounding padding.
            // Check every presentation sample, including the first visible one.
            #expect(samples.allSatisfy { abs($0 - 66) < 1 })
        }
    }

    @Test
    func regularBudgetRegistersToolbarInsetsOnTheVerticalScrollView() async throws {
        let store = scrollingBudget()
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)

        // Unlike Quick Assign, regular Budget nests its vertical scroller inside
        // a month pager. Checking only effect.style misses a consumed safe area.
        for (height, showsToolbar): (CGFloat, Bool) in [(800, true), (680, true), (440, false)] {
            var verticalScrollCount = 0
            _ = try await HostedViewSnapshot.image(
                of: BudgetView(
                    store: store, isActive: true, editingCategoryID: nil,
                    onEdit: { _ in }, onChangeMonth: {}
                )
                .kualiaSafeAreaBar(edge: .top, spacing: 0) { Text("Budget").frame(height: 100) }
                .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                    if showsToolbar { Text("Menu").frame(height: 60) }
                }
                .modifier(HomeScrollSurface(showsBottomToolbar: showsToolbar))
                .background(KualiaPalette.budgetPage),
                size: CGSize(width: 414, height: height),
                inspect: { view in
                    @MainActor func inspectScrollViews(in child: UIView) {
                        if let scroll = child as? UIScrollView,
                            scroll.contentSize.height > scroll.bounds.height
                        {
                            verticalScrollCount += 1
                            let frame = scroll.convert(scroll.bounds, to: view)
                            #expect(abs(frame.minY) < 0.5)
                            #expect(abs(frame.maxY - height) < 0.5)
                            #expect(abs(scroll.adjustedContentInset.top - 100) < 0.5)
                            #expect(
                                abs(scroll.adjustedContentInset.bottom - (showsToolbar ? 60 : 0))
                                    < 0.5)
                            if #available(iOS 26.0, *) {
                                #expect(!scroll.topEdgeEffect.isHidden)
                                #expect(scroll.bottomEdgeEffect.isHidden == !showsToolbar)
                                #expect(scroll.bottomEdgeEffect.style == .soft)
                            }
                        }
                        for descendant in child.subviews { inspectScrollViews(in: descendant) }
                    }
                    inspectScrollViews(in: view)
                })
            #expect(verticalScrollCount == 1)
        }
    }

    @Test
    func largeBudgetsOnlyMeasureNearbyGroupsAndKeepVisibleAssignmentFocus() async throws {
        let store = scrollingBudget(groupCount: 100)
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)
        let category = try #require(store.groups.first?.rows.first)
        _ = try #require(store.beginEditing(category.id))
        let registry = BudgetAssignmentFocusRegistry()
        let focus = registry.focus(workspaceID: store.workspace?.id)
        var frames: [String: CGRect] = [:]
        var request: BudgetAssignmentFocus.Request?

        _ = try await HostedViewSnapshot.image(
            of: BudgetView(
                store: store, isActive: true, editingCategoryID: category.id,
                onEdit: { _ in }, onChangeMonth: {}
            )
            .environment(\.budgetAssignmentFocusRegistry, registry)
            .kualiaSafeAreaBar(edge: .top, spacing: 0) { Text("Budget").frame(height: 100) }
            .background(KualiaPalette.budgetPage),
            size: CGSize(width: 414, height: 740),
            inspect: { _ in
                frames = focus.frames
                request = focus.request(for: category.id)
            })

        // Frame probes live inside category rows, so the measured set proves
        // opening a large budget doesn't eagerly lay out every group's rows.
        let visibleFrame = try #require(frames[category.id])
        #expect(visibleFrame.height > 0)
        #expect(frames.count < store.groups.reduce(0) { $0 + $1.rows.count } / 2)
        #expect(frames["99-1"] == nil)
        #expect(try #require(request).frame == visibleFrame)
    }

    @Test
    func budgetCanvasRetainsItsFocusAndPositionUntilTheWorkspaceChanges() {
        let registry = BudgetAssignmentFocusRegistry()
        let focus = registry.focus(workspaceID: "workspace")
        focus.position.scrollTo(y: 360)
        let expectedPosition = focus.position
        focus.geometry = scrollGeometry(height: 500, offset: 360)
        for _ in 0..<5 {
            let sameCanvas = registry.focus(workspaceID: "workspace")
            #expect(sameCanvas === focus)
            #expect(sameCanvas.position == expectedPosition)
            #expect(sameCanvas.geometry?.contentOffset.y == 360)
        }
        let otherWorkspace = registry.focus(workspaceID: "other")
        #expect(otherWorkspace !== focus)
        #expect(otherWorkspace.position == ScrollPosition())
        #expect(registry.focus(workspaceID: "workspace") === focus)
        #expect(focus.position == expectedPosition)
    }

    @Test
    func budgetMonthChangesKeepTheNativeScrollViewAndVisibleOffset() async throws {
        let budget = scrollingBudget(groupCount: 30, monthCount: 2)
        defer { budget.stop() }
        budget.start()
        for _ in 0..<1_000 where !budget.canEdit { await Task.yield() }
        try #require(budget.canEdit)
        let initialMonth = budget.selectedMonth
        let lockedMonth = BudgetMonth.offset(initialMonth, by: 2)
        try #require(budget.canBrowseMonth(lockedMonth))
        try #require(budget.isMonthLocked(lockedMonth))
        var sample = 0
        var originalScroll: UIScrollView?
        var expectedOffset: CGFloat?
        var checkedSamples = 0
        _ = try await HostedViewSnapshot.image(
            of: BudgetView(
                store: budget, isActive: true, editingCategoryID: nil,
                onEdit: { _ in }, onChangeMonth: {}),
            size: CGSize(width: 390, height: 740), animationSampleCount: 75,
            onAnimationSample: { root in
                func verticalScroll(in view: UIView) -> UIScrollView? {
                    if let scroll = view as? UIScrollView, scroll.bounds.height > 200 {
                        return scroll
                    }
                    return view.subviews.lazy.compactMap { verticalScroll(in: $0) }.first
                }
                sample += 1
                guard let scroll = verticalScroll(in: root) else { return }
                if sample == 5 {
                    originalScroll = scroll
                    scroll.setContentOffset(CGPoint(x: 0, y: 500), animated: false)
                    root.layoutIfNeeded()
                    expectedOffset = scroll.contentOffset.y
                }
                if sample >= 10, let expectedOffset {
                    #expect(scroll === originalScroll)
                    #expect(abs(scroll.contentOffset.y - expectedOffset) < 1)
                    checkedSamples += 1
                }
                switch sample {
                case 15, 35, 55: budget.selectMonth(BudgetMonth.offset(initialMonth, by: 1))
                case 25, 45, 65: budget.selectMonth(initialMonth)
                case 40:
                    budget.selectMonth(lockedMonth)
                    #expect(budget.selectedMonth == lockedMonth)
                default: break
                }
            })
        #expect(checkedSamples >= 60)
        #expect(budget.selectedMonth == initialMonth)
    }

    @Test(arguments: [false, true])
    func monthTitleFitsItsTextWhileCalendarPagingKeepsAStableWidth(usesPageTitleStyle: Bool) {
        for locale in [Locale(identifier: "en_US"), Locale(identifier: "de_DE")] {
            var widths: [CGFloat] = []
            for month in [202601, 202605, 202609, 202612, 202701] {
                let controller = UIHostingController(
                    rootView:
                        BudgetSlidingMonthTitle(
                            month: month, currentMonth: 202609,
                            usesPageTitleStyle: usesPageTitleStyle
                        )
                        .environment(\.locale, locale))
                for availableWidth: CGFloat in [320, 600] {
                    let size = controller.sizeThatFits(
                        in: CGSize(width: availableWidth, height: 100))
                    #expect(size.width > 0)
                    #expect(size.width < 250)
                    #expect(size.height == (usesPageTitleStyle ? 40 : 34))
                    if usesPageTitleStyle {
                        let text = UIHostingController(
                            rootView: Text(
                                BudgetMonth.navigationTitle(
                                    month, currentMonth: 202609, locale: locale)
                            )
                            .font(HomeTopBar.titleFont)
                            .fixedSize())
                        let textSize = text.sizeThatFits(
                            in: CGSize(width: availableWidth, height: 100))
                        #expect(abs(size.width - textSize.width) < 0.5)
                    }
                    widths.append(size.width)
                }
            }
            let widthRange = (widths.max() ?? 0) - (widths.min() ?? 0)
            if usesPageTitleStyle {
                #expect(widthRange > 20)
            } else {
                #expect(widthRange < 0.5)
            }
        }
    }

    @Test
    func monthResetDoesNotChangeTheHeaderHeight() {
        for size in [DynamicTypeSize.large, .accessibility3] {
            let controller = UIHostingController(rootView: AnyView(EmptyView()))
            let months = [202609, 202608, 202610, 202609, 202701, 202609]
            let heights = months.map { month in
                controller.rootView = AnyView(
                    HomeTopBar(
                        title: "September", onNewEntry: {}, onPreferences: {},
                        onTitleTap: {}, showsActions: false,
                        monthBrowsingLabel: BudgetMonth.browsingLabel(month, currentMonth: 202609),
                        onReturnToCurrentMonth: {}, budgetMonth: month,
                        currentBudgetMonth: 202609
                    )
                    .environment(\.dynamicTypeSize, size))
                return controller.sizeThatFits(in: CGSize(width: 350, height: 200)).height
            }
            #expect(abs(heights[0] - 48) < 0.5)
            #expect(heights.allSatisfy { abs($0 - heights[0]) < 0.5 })
        }
    }

    @Test(arguments: ["en_US", "de_DE", "fr_FR"])
    func budgetPreferencesActionFitsBesidePlanAndAccountSettings(localeIdentifier: String) {
        for width: CGFloat in [280, 335, 350] {
            for month in [202609, 202608, 202709] {
                let controller = UIHostingController(
                    rootView: HomeTopBar(
                        title: "September", onNewEntry: {}, onPreferences: {},
                        onEditBudgetPlan: {}, onBudgetPreferences: {}, onTitleTap: {},
                        monthBrowsingLabel: BudgetMonth.browsingLabel(month, currentMonth: 202609),
                        onReturnToCurrentMonth: {}, budgetMonth: month, currentBudgetMonth: 202609
                    )
                    .environment(\.locale, Locale(identifier: localeIdentifier)))
                let size = controller.sizeThatFits(in: CGSize(width: width, height: 200))
                #expect(size.width <= width + 0.5)
                #expect(abs(size.height - 48) < 0.5)
            }
        }
    }

    @Test(arguments: [CGFloat(280), CGFloat(350)])
    func allTabsUseTheSameSingleToolbarRow(width: CGFloat) {
        let proposal = CGSize(width: width, height: 200)
        for page in HomePage.allCases {
            let controller = UIHostingController(
                rootView: HomeTopBar(
                    title: page.title,
                    onNewEntry: {}, onPreferences: {},
                    onAddAccount: page == .accounts ? {} : nil,
                    onReorderAccounts: page == .accounts ? {} : nil,
                    onTitleTap: page == .budget ? {} : nil,
                    budgetMonth: page == .budget ? 202609 : nil, currentBudgetMonth: 202609))
            let size = controller.sizeThatFits(in: proposal)
            #expect(abs(size.height - 48) < 0.5)
            #expect(size.width <= width + 0.5)
        }
    }

    @Test
    func rendersExpandedAndCollapsedGroupsAtPhoneAndAccessibilitySizes() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            for collapsed in [false, true] {
                let store = BudgetStore.preview
                defer { store.stop() }
                store.start()
                for _ in 0..<1_000 {
                    if store.canEdit { break }
                    await Task.yield()
                }
                try #require(store.canEdit)
                let firstGroup = try #require(store.groups.first)
                #expect(!firstGroup.rows.isEmpty)
                if collapsed { store.toggleGroup(firstGroup.id) }
                #expect(store.collapsedGroupIDs.contains(firstGroup.id) == collapsed)
                for filter in [BudgetCategoryFilter.all, .overspent, .underfunded, .all] {
                    store.categoryFilter = filter
                    try await record(
                        BudgetView(
                            store: store, isActive: true, editingCategoryID: nil,
                            onEdit: { _ in }, onChangeMonth: {}
                        )
                        .background(KualiaPalette.budgetPage),
                        size: size,
                        name:
                            "budget-\(collapsed ? "collapsed" : "expanded")-\(filter.rawValue)-\(size)"
                    )
                    // Filtering preserves the group disclosure preference.
                    #expect(store.collapsedGroupIDs.contains(firstGroup.id) == collapsed)
                }
            }
        }
    }

    @Test
    func rendersBudgetWithTheSharedKeypadBehindItsReducedViewport() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            let store = BudgetStore.preview
            defer { store.stop() }
            store.start()
            for _ in 0..<1_000 {
                if store.canEdit { break }
                await Task.yield()
            }
            try #require(store.canEdit)
            let category = try #require(store.groups.first?.rows.first)
            let editor = try #require(store.beginEditing(category.id))
            var calculator = try #require(store.assignmentCalculator)
            calculator.appendDigit(5)
            store.updateCalculator(calculator, editorID: editor.id)
            #expect(store.groups.first?.rows.first?.assigned == 5)
            #expect(store.groups.first?.rows.first?.isPending == false)
            var presentation = PeekPresentation()
            presentation.open(hasVisiblePeek: true)

            try await record(
                PeekContainer(
                    presentation: presentation, expansionHeight: 254,
                    isCompactPresented: true, compactHeight: 88,
                    foregroundColor: KualiaPalette.peekPositiveBackground,
                    expansionColor: KualiaPalette.peekPositiveBackground
                ) {
                    BudgetView(
                        store: store, isActive: true, editingCategoryID: category.id,
                        onEdit: { _ in }, onChangeMonth: {}
                    )
                } expansion: {
                    AmountPad(
                        calculator: .constant(calculator),
                        accessibilityIdentifierPrefix: "budget", onDismiss: {},
                        onCancel: {},
                        backgroundColor: KualiaPalette.peekPositiveBackground,
                        topPadding: 0
                    )
                } compact: {
                    BudgetReadyToAssignPeek(
                        readyToAssign: store.readyToAssign, currencyCode: "USD", minorUnit: 2
                    )
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .frame(minHeight: 88)
                },
                size: size, name: "budget-keypad-open-\(size)"
            )
            store.reset()
        }
    }

    @Test
    func fullyVisibleCategoryNearTheTopDoesNotScrollDownForExtraSpacing() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 125, width: 96, height: 44)]
        focus.geometry = scrollGeometry(height: 400, offset: 20, top: 100)
        let request = try #require(focus.request(for: "category"))
        #expect(focus.consume(request) == nil)
    }

    @Test
    func switchingVisibleAssignmentsWithoutDraggingDoesNotScheduleScrollWork() {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(height: 400)
        focus.frames = [
            "first": CGRect(x: 120, y: 100, width: 96, height: 44),
            "second": CGRect(x: 120, y: 180, width: 96, height: 44),
        ]
        let position = focus.position
        for category in ["first", "second", "first", "second"] {
            focus.select(category)
            for width: CGFloat in [52, 70, 96, 52] {
                focus.frames[category]?.size.width = width
                #expect(focus.revealRequest(for: category) == nil)
            }
        }
        #expect(focus.position == position)
    }

    @Test
    func switchingAssignmentsCannotReplayARevealBeforeNativeScrollingCatchesUp() throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(height: 300)
        focus.frames = [
            "first": CGRect(x: 120, y: 520, width: 96, height: 44),
            "second": CGRect(x: 120, y: 620, width: 96, height: 44),
        ]
        for category in ["first", "second"] {
            focus.select(category)
            let request = try #require(focus.revealRequest(for: category))
            _ = try #require(focus.consume(request))
            // No user drag or updated offset occurs between these callbacks.
            for index in 0..<20 {
                focus.frames[category]?.origin.x = CGFloat(120 + index)
                focus.frames[category]?.size.width = CGFloat(52 + index)
                focus.updateScrollPhase(.animating)
                #expect(focus.revealRequest(for: category) == nil)
                focus.updateScrollPhase(.idle)
                #expect(focus.revealRequest(for: category) == nil)
                #expect(focus.consume(request) == nil)
            }
            // A genuinely smaller viewport can still require a new reveal.
            focus.geometry = scrollGeometry(height: 280)
            let resized = try #require(focus.revealRequest(for: category))
            #expect(try #require(focus.consume(resized)).animates == false)
            focus.geometry = scrollGeometry(height: 300)
        }
    }

    @Test
    func openingScrollIsPlannedBeforeTheViewportShrinks() throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(height: 612, offset: -100, top: 100, bottom: 60)
        focus.contentOriginY = 100
        focus.frames = ["category": CGRect(x: 120, y: 490, width: 96, height: 44)]
        focus.isViewportReady = false

        let offset = try #require(focus.prepareReveal(categoryID: "category", viewportBottom: 358))
        #expect(offset == 310)
        // The owner can apply this alongside the drawer state in one transaction.
        focus.position.scrollTo(y: offset)
        var expectedPosition = ScrollPosition()
        expectedPosition.scrollTo(y: offset)
        #expect(focus.position == expectedPosition)
        for height: CGFloat in [612, 500, 400, 358] {
            focus.geometry = scrollGeometry(height: height, offset: offset - 100, top: 100)
            #expect(focus.request(for: "category") == nil)
        }
        focus.isViewportReady = true
        let settled = try #require(focus.request(for: "category"))
        #expect(focus.consume(settled) == nil)
    }

    @Test(arguments: [CGFloat(0), CGFloat(1), CGFloat(1_200)])
    func plannedRevealUsesScreenCoordinatesAcrossOffsetsAndInsetForegrounds(
        distanceFromTop: CGFloat
    ) throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(
            height: 588, offset: -100 + distanceFromTop, contentHeight: 4_000,
            top: 100, bottom: 60)
        // The outer sheet starts at 40; its content has another 24 points of padding.
        focus.contentOriginY = 164 - distanceFromTop
        let frame = CGRect(x: 120, y: 490 + distanceFromTop, width: 96, height: 44)
        focus.frames = ["category": frame]
        let offset = try #require(focus.prepareReveal(categoryID: "category", viewportBottom: 398))
        #expect(offset == 334 + distanceFromTop)
        let scrollDistance = offset - distanceFromTop
        #expect(scrollDistance > 0)
        #expect(frame.maxY + 164 - distanceFromTop - scrollDistance == CGFloat(398 - 34))
    }

    @Test
    func openingPlanUsesTheFinalScrollRangeForAShortBudget() throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(
            height: 612, offset: -100, contentHeight: 608, top: 100, bottom: 60)
        focus.contentOriginY = 100
        focus.frames = ["category": CGRect(x: 120, y: 540, width: 96, height: 44)]
        let offset = try #require(focus.prepareReveal(categoryID: "category", viewportBottom: 358))
        #expect(offset == 350)
        #expect(offset > CGFloat(608 + 100 + 60 - 612))
        #expect(offset <= CGFloat(608 + 100 - 358))
    }

    @Test(arguments: [CGFloat(340), CGFloat(608), CGFloat(4_000)])
    func openingReservesEnoughScrollRangeBeforeTheKeypadResizes(contentHeight: CGFloat) throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(
            height: 612, offset: -100, contentHeight: contentHeight, top: 100, bottom: 60)
        focus.contentOriginY = 100
        focus.frames = ["category": CGRect(x: 120, y: 270, width: 96, height: 44)]
        let offset = try #require(focus.prepareReveal(categoryID: "category", viewportBottom: 358))
        #expect(offset == (contentHeight == 340 ? 82 : 90))
        let closedViewportHeight = try #require(focus.geometry).containerSize.height
        #expect(contentHeight + focus.revealBottomPadding - closedViewportHeight >= offset)
        #expect(focus.revealBottomPadding == (contentHeight == 340 ? 194 : 0))

        // The extra space remains stable through category switches and is removed
        // when the editing session closes, restoring the filtered list's size.
        let padding = focus.revealBottomPadding
        focus.select("another-category")
        #expect(focus.revealBottomPadding == padding)
        focus.select(nil)
        #expect(focus.revealBottomPadding == 0)
    }

    @Test
    func openingAVisibleSingleCategoryDoesNotAddScrollSpace() {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(
            height: 612, offset: -100, contentHeight: 240, top: 100, bottom: 60)
        focus.contentOriginY = 100
        focus.frames = ["category": CGRect(x: 120, y: 150, width: 96, height: 44)]
        #expect(focus.prepareReveal(categoryID: "category", viewportBottom: 358) == nil)
        #expect(focus.revealBottomPadding == 0)
    }

    @Test
    func openingWaitsForTheMeasuredScrollRangeAndRunsOnlyOnce() throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(
            height: 612, offset: -100, contentHeight: 340, top: 100, bottom: 60)
        focus.contentOriginY = 100
        focus.frames = ["category": CGRect(x: 120, y: 270, width: 96, height: 44)]
        _ = try #require(focus.prepareReveal(categoryID: "category", viewportBottom: 358))
        var openings = 0
        focus.openAfterRevealLayout { openings += 1 }
        let request = try #require(focus.openingRequestID)
        #expect(focus.readyOpeningRequest() == nil)
        focus.completeOpening(request)
        #expect(openings == 0)

        focus.geometry = scrollGeometry(
            height: 612, offset: -100, contentHeight: 340 + focus.revealBottomPadding,
            top: 100, bottom: 60)
        #expect(focus.readyOpeningRequest() == request)
        focus.completeOpening(request)
        focus.completeOpening(request)
        #expect(openings == 1)
        #expect(focus.openingRequestID == nil)
    }

    @Test
    func closingBeforeLayoutCancelsThePendingOpening() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        var didOpen = false
        focus.openAfterRevealLayout { didOpen = true }
        let request = try #require(focus.openingRequestID)
        focus.select(nil)
        focus.completeOpening(request)
        #expect(!didOpen)
        #expect(focus.readyOpeningRequest() == nil)
    }

    @Test
    func openingPlanKeepsAVisibleAssignmentStillAndWaitsForMissingMeasurements() throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(height: 612, offset: -100, top: 100, bottom: 60)
        focus.frames = ["category": CGRect(x: 120, y: 80, width: 96, height: 44)]
        #expect(focus.prepareReveal(categoryID: "category", viewportBottom: 358) == nil)
        focus.contentOriginY = 100
        #expect(focus.prepareReveal(categoryID: "category", viewportBottom: 358) == nil)
        focus.geometry = scrollGeometry(height: 358, offset: -100, top: 100)
        let request = try #require(focus.request(for: "category"))
        #expect(focus.consume(request) == nil)
    }

    @Test
    func openingCompletionRevealsWithoutAnotherGeometryChange() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 520, width: 96, height: 44)]
        focus.isViewportReady = false

        // The bottom bar disappears as the drawer opens. Neither its old inset
        // nor an intermediate page height should start the assignment reveal.
        for height: CGFloat in [612, 600, 550, 450, 400, 359, 340] {
            focus.geometry = scrollGeometry(
                height: height, offset: -100, top: 100, bottom: height == 612 ? 60 : 0)
            #expect(focus.request(for: "category") == nil)
        }
        // The native scroll height can differ from the outer drawer foreground.
        // Completion must wake focus even when no further geometry event arrives.
        focus.isViewportReady = true
        let request = try #require(focus.request(for: "category"))
        let reveal = try #require(focus.consume(request))
        #expect(reveal.animates)
        #expect(reveal.offset == 358)
        focus.geometry = scrollGeometry(height: 340, offset: reveal.offset - 100, top: 100)
        #expect(focus.consume(try #require(focus.request(for: "category"))) == nil)
    }

    @Test(arguments: [CGFloat(0), CGFloat(1)])
    func assignmentRevealWorksAtTheTopWithoutAnInitialDrag(distanceFromTop: CGFloat) throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 490, width: 96, height: 44)]
        focus.geometry = scrollGeometry(
            height: 358, offset: -100 + distanceFromTop, top: 100)

        let request = try #require(focus.request(for: "category"))
        let reveal = try #require(focus.consume(request))
        #expect(reveal.offset == 310)
        #expect(reveal.offset > distanceFromTop)
        // The amount ends 34 points above the peek, after accounting for the header.
        #expect(534 - (reveal.offset - 100) == CGFloat(358 - 34))
    }

    @Test
    func openingTheDrawerInvalidatesAPendingReveal() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 520, width: 96, height: 44)]
        focus.geometry = scrollGeometry(height: 400)
        let previous = try #require(focus.request(for: "category"))
        focus.isViewportReady = false
        #expect(focus.consume(previous) == nil)
        focus.geometry = scrollGeometry(height: 300)
        #expect(focus.request(for: "category") == nil)
        focus.isViewportReady = true
        let request = try #require(focus.request(for: "category"))
        let reveal = try #require(focus.consume(request))
        #expect(reveal.animates)
        #expect(reveal.offset == 298)
    }

    @Test
    func draggingWhileTheDrawerOpensStillCancelsThePendingReveal() {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 520, width: 96, height: 44)]
        focus.geometry = scrollGeometry(height: 300)
        focus.isViewportReady = false
        focus.updateScrollPhase(.interacting)
        focus.updateScrollPhase(.idle)
        focus.isViewportReady = true
        #expect(focus.request(for: "category") == nil)
    }

    @Test
    func viewportAnimationDoesNotRestartTheAssignmentScrollAnimation() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 520, width: 96, height: 44)]
        focus.geometry = scrollGeometry(height: 400)
        let request = try #require(focus.request(for: "category"))
        #expect(try #require(focus.consume(request)).animates)

        focus.updateScrollPhase(.animating)
        for height: CGFloat in [380, 360, 340, 320, 300] {
            focus.geometry = scrollGeometry(height: height)
            #expect(focus.request(for: "category") == nil)
        }
        focus.updateScrollPhase(.idle)
        let correction = try #require(focus.request(for: "category"))
        #expect(try #require(focus.consume(correction)).animates == false)
    }

    @Test
    func initiallyVisibleSelectionFollowsThePeekWithoutStartingMoreAnimations() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 520, width: 96, height: 44)]
        focus.geometry = scrollGeometry(height: 600)
        #expect(focus.consume(try #require(focus.request(for: "category"))) == nil)
        for height: CGFloat in [500, 450, 400, 350, 300] {
            focus.geometry = scrollGeometry(height: height)
            let request = try #require(focus.request(for: "category"))
            #expect(try #require(focus.consume(request)).animates == false)
        }
    }

    @Test
    func touchingAnAssignmentWaitsForTheTapWithoutCancellingItsReveal() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("category")
        focus.frames = ["category": CGRect(x: 120, y: 520, width: 96, height: 44)]
        focus.geometry = scrollGeometry(height: 300)
        focus.updateScrollPhase(.tracking)
        #expect(focus.request(for: "category") == nil)
        focus.updateScrollPhase(.idle)
        let request = try #require(focus.request(for: "category"))
        #expect(try #require(focus.consume(request)).animates)
    }

    @Test
    func draggingDuringThePeekCancelsFocusAndDoesNotSnapBackOnRelease() throws {
        let focus = BudgetAssignmentFocus()
        focus.select("first")
        focus.frames = [
            "first": CGRect(x: 120, y: 520, width: 96, height: 44),
            "second": CGRect(x: 120, y: 620, width: 96, height: 44),
        ]
        focus.geometry = scrollGeometry(height: 400)
        let pending = try #require(focus.request(for: "first"))
        for phase in [ScrollPhase.tracking, .interacting, .decelerating, .idle] {
            focus.updateScrollPhase(phase)
            focus.geometry = scrollGeometry(height: 300, offset: 100)
            #expect(focus.request(for: "first") == nil)
            #expect(focus.consume(pending) == nil)
        }
        focus.select("second")
        let next = try #require(focus.request(for: "second"))
        #expect(try #require(focus.consume(next)).animates)
    }

    @Test
    func assignmentFocusWaitsForRealLayoutAndRejectsAnOutdatedRequest() throws {
        let focus = BudgetAssignmentFocus()
        #expect(focus.request(for: "category") == nil)
        focus.geometry = scrollGeometry(height: 600)
        #expect(focus.request(for: "category") == nil)
        focus.frames = ["category": CGRect(x: 120, y: 520, width: 96, height: 44)]
        let initial = try #require(focus.request(for: "category"))
        #expect(focus.destination(for: initial) == nil)
        focus.geometry = scrollGeometry(height: 300)
        #expect(focus.destination(for: initial) == nil)
        let resized = try #require(focus.request(for: "category"))
        #expect(resized != initial)
        #expect(try #require(focus.destination(for: resized)) == 298)
    }

    @Test(arguments: [false, true])
    func everyKeypadResizeRechecksFocusAndManualScrollingDoesNot(shortList: Bool) throws {
        let focus = BudgetAssignmentFocus()
        let frame = CGRect(x: 120, y: 520, width: 96, height: 44)
        focus.frames = ["category": frame]
        var offset: CGFloat = 0
        for height: CGFloat in [500, 400, 340, 300, 260] {
            focus.geometry = scrollGeometry(
                height: height, offset: offset, contentHeight: shortList ? 600 : 4_000)
            let request = try #require(focus.request(for: "category"))
            offset = try #require(focus.destination(for: request))
            #expect(frame.maxY <= offset + height - 34 + 0.5)
            #expect(frame.minY >= offset)
            // Updating only the offset must not create another reveal task.
            focus.geometry = scrollGeometry(
                height: height, offset: offset + 100, contentHeight: shortList ? 600 : 4_000)
            #expect(focus.request(for: "category") == request)
        }
        #expect(focus.request(for: nil) == nil)
    }

    @Test
    func assignmentFocusAccountsForToolbarsAndCategorySwitches() throws {
        let focus = BudgetAssignmentFocus()
        focus.frames = [
            "lower": CGRect(x: 120, y: 490, width: 96, height: 44),
            "upper": CGRect(x: 120, y: 100, width: 96, height: 44),
        ]
        focus.geometry = scrollGeometry(height: 600, offset: -100, top: 100, bottom: 60)
        let request = try #require(focus.request(for: "lower"))
        #expect(try #require(focus.destination(for: request)) == 128)
        focus.geometry = scrollGeometry(height: 600, offset: 200, top: 100, bottom: 60)
        #expect(focus.request(for: "lower") == request)
        let upper = try #require(focus.request(for: "upper"))
        #expect(upper != request)
        #expect(focus.destination(for: upper) == nil)
        focus.geometry = scrollGeometry(height: 600, offset: 200, top: 100, bottom: 120)
        #expect(focus.request(for: "upper") != upper)
    }

    private func scrollGeometry(
        height: CGFloat, offset: CGFloat = 0, contentHeight: CGFloat = 1_000,
        top: CGFloat = 0, bottom: CGFloat = 0
    ) -> ScrollGeometry {
        ScrollGeometry(
            contentOffset: CGPoint(x: 0, y: offset),
            contentSize: CGSize(width: 390, height: contentHeight),
            contentInsets: EdgeInsets(top: top, leading: 0, bottom: bottom, trailing: 0),
            // Match onScrollGeometryChange: containerSize is the unobscured size,
            // while visibleRect includes the areas under the safe-area bars.
            containerSize: CGSize(width: 390, height: height - top - bottom))
    }

    @Test(arguments: [DynamicTypeSize.large, .accessibility3], [false, true])
    func contentUnderlapsTheHomeBarsWhileFocusClearsThePeek(
        size: DynamicTypeSize, opensKeypad: Bool
    ) async throws {
        try await checkBudgetViewport(size: size, opensKeypad: opensKeypad)
    }

    @Test
    func assignmentAboveThePeekNeverRequestsABackwardScroll() throws {
        let focus = BudgetAssignmentFocus()
        focus.geometry = scrollGeometry(height: 358, offset: 200, top: 100)
        focus.contentOriginY = -200
        focus.frames = ["category": CGRect(x: 120, y: 280, width: 96, height: 44)]
        #expect(focus.prepareReveal(categoryID: "category", viewportBottom: 358) == nil)
        let request = try #require(focus.request(for: "category"))
        #expect(focus.consume(request) == nil)
    }

    @Test(
        arguments: [CGFloat(0), CGFloat(1), CGFloat(300)], BudgetRevealSelection.allCases)
    func animatedAssignmentRevealNeverReversesOrCorrectsAfterOpening(
        initialScrollDistance: CGFloat, selection: BudgetRevealSelection
    ) async throws {
        try await checkAnimatedReveal(
            initialScrollDistance: initialScrollDistance, selection: selection)
    }

    @Test
    func animatedRevealCanUseTheScrollRangeCreatedByOpeningTheKeypad() async throws {
        try await checkAnimatedReveal(
            initialScrollDistance: 0, selection: .lowestVisible, groupCount: 3)
    }

    @Test(arguments: [1, 8])
    func animatedRevealClearsThePeekAtTheEndOfTheBudget(groupCount: Int) async throws {
        try await checkAnimatedReveal(
            initialScrollDistance: 100_000, selection: .lowestVisible, groupCount: groupCount)
    }

    @Test
    func animatedRevealClearsThePeekForTheOnlyOverspentCategory() async throws {
        try await checkAnimatedReveal(
            initialScrollDistance: 0, selection: .lowestVisible,
            overspentCategoryID: "7-1")
    }

    @Test(arguments: [false, true])
    func switchingToAnAssignmentAboveThePeekKeepsTheOpenPageStill(aboveHeader: Bool) async throws {
        let store = scrollingBudget()
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)
        let probe = BudgetViewportProbe()
        var selectedOffset: CGFloat?
        var offsets: [CGFloat] = []
        let image = try await HostedViewSnapshot.image(
            of: BudgetViewportTransition(
                store: store, categoryID: "", probe: probe, opensKeypad: true,
                openingAnimation: .smooth(duration: 0.24), initialScrollDistance: 300
            ),
            size: CGSize(width: 414, height: 700), animationSampleCount: 90,
            onAnimationSample: { view in
                guard probe.isRevealReady, let scrollView = nativeBudgetScrollView(in: view)
                else { return }
                if selectedOffset != nil {
                    offsets.append(scrollView.contentOffset.y)
                    return
                }
                let viewport = scrollView.bounds.inset(by: scrollView.adjustedContentInset)
                guard
                    let category = probe.frames.filter({
                        $0.key != probe.selectedCategoryID
                            && (aboveHeader
                                ? $0.value.maxY < viewport.minY
                                : $0.value.minY >= viewport.minY && $0.value.maxY <= viewport.maxY)
                    }).min(by: { $0.value.minY < $1.value.minY })
                else { return }
                selectedOffset = scrollView.contentOffset.y
                probe.selectCategory?(category.key)
            })
        let offsetBeforeSwitch = try #require(selectedOffset)
        try #require(offsets.count > 5)
        #expect(offsets.allSatisfy { abs($0 - offsetBeforeSwitch) <= 0.5 })
        Attachment.record(
            Array(try #require(image.pngData())),
            named: "budget-switch-above-peek-\(aboveHeader).png")
    }

    private func checkAnimatedReveal(
        initialScrollDistance: CGFloat, selection: BudgetRevealSelection, groupCount: Int = 8,
        overspentCategoryID: String? = nil
    ) async throws {
        let store = scrollingBudget(
            groupCount: groupCount, overspentCategoryID: overspentCategoryID)
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)
        if overspentCategoryID != nil { store.categoryFilter = .overspent }
        // Leave a category inside the final viewport for the no-scroll case.
        // The expanded funding summary can cover every row when the peek opens.
        if selection == .alreadyVisible { store.setTargetSummaryExpanded(false) }
        let probe = BudgetViewportProbe()
        var samples: [BudgetScrollAnimationSample] = []
        _ = try await HostedViewSnapshot.image(
            of: BudgetViewportTransition(
                store: store, categoryID: "", probe: probe, opensKeypad: true,
                openingAnimation: .smooth(duration: 0.24),
                initialScrollDistance: initialScrollDistance, selection: selection
            ),
            size: CGSize(width: 414, height: 700), animationSampleCount: 75,
            onAnimationSample: { view in
                guard probe.openingStarted, let scrollView = nativeBudgetScrollView(in: view)
                else { return }
                samples.append(
                    BudgetScrollAnimationSample(
                        time: Date.timeIntervalSinceReferenceDate,
                        offset: scrollView.contentOffset.y,
                        presentedOffset: scrollView.layer.presentation()?.bounds.minY
                            ?? scrollView.contentOffset.y,
                        height: scrollView.bounds.height,
                        contentHeight: scrollView.contentSize.height,
                        bottomInset: scrollView.adjustedContentInset.bottom,
                        isOpeningComplete: probe.isRevealReady))
            },
            inspect: { view in
                guard let scrollView = nativeBudgetScrollView(in: view),
                    let categoryID = probe.selectedCategoryID,
                    let frame = probe.frames[categoryID]
                else { return }
                probe.finalAssignment = scrollView.convert(frame, to: nil)
            })
        let trace =
            "time,offset,presentedOffset,height,contentHeight,bottomInset,openingComplete\n"
            + samples.map(\.csv).joined(separator: "\n")
        Attachment.record(
            Array(trace.utf8),
            named: "assignment-scroll-\(Int(initialScrollDistance))-\(selection).csv")
        let initialOffset = try #require(probe.initialOffset)
        try #require(samples.count > 5)
        var previous = initialOffset
        for sample in samples {
            #expect(sample.presentedOffset >= previous - 0.5, "The category moved backward.")
            previous = sample.presentedOffset
        }
        let completed = samples.filter(\.isOpeningComplete)
        let firstCompleted = try #require(completed.first)
        for sample in completed {
            #expect(
                abs(sample.presentedOffset - firstCompleted.presentedOffset) <= 0.5,
                "Scrolling continued after the opening animation ended.")
        }
        let finalOffset = try #require(completed.last).offset
        let finalAssignment = try #require(probe.finalAssignment)
        if let overspentCategoryID { #expect(probe.selectedCategoryID == overspentCategoryID) }
        #expect(finalAssignment.maxY <= probe.peekTop + 0.5)
        if selection == .alreadyVisible {
            #expect(probe.plannedOffset == nil)
            #expect(abs(finalOffset - initialOffset) <= 0.5)
        } else {
            let plannedOffset = try #require(probe.plannedOffset)
            #expect(abs(finalOffset - (plannedOffset - probe.initialTopInset)) <= 0.5)
            #expect(finalOffset > initialOffset)
            #expect(samples.contains { !$0.isOpeningComplete && $0.offset > initialOffset + 0.5 })
        }
    }

    @Test
    func assignmentRevealWorksWhenScrollAndForegroundHeightsDiffer() async throws {
        try await checkBudgetViewport(size: .large, opensKeypad: true, contentTopPadding: 24)
    }

    private func checkBudgetViewport(
        size: DynamicTypeSize, opensKeypad: Bool, contentTopPadding: CGFloat = 0
    ) async throws {
        let store = scrollingBudget()
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)
        let category = try #require(store.groups[2].rows.first)
        let probe = BudgetViewportProbe()
        _ = try await HostedViewSnapshot.image(
            of: BudgetViewportTransition(
                store: store, categoryID: category.id, probe: probe, opensKeypad: opensKeypad,
                contentTopPadding: contentTopPadding
            )
            .environment(\.dynamicTypeSize, size)
            .transaction { $0.animation = nil },
            size: CGSize(width: 414, height: 700),
            inspect: { view in
                guard let scrollView = nativeBudgetScrollView(in: view) else { return }
                let assignment = probe.frames[category.id] ?? .zero
                probe.snapshot = BudgetViewportSnapshot(
                    assignment: assignment,
                    globalAssignment: scrollView.convert(assignment, to: nil),
                    viewport: scrollView.bounds.inset(by: scrollView.adjustedContentInset),
                    globalScrollFrame: scrollView.convert(scrollView.bounds, to: nil))
            }
        )
        let snapshot = try #require(probe.snapshot)
        if contentTopPadding == 0 {
            #expect(snapshot.globalScrollFrame.minY < probe.headerBottom - 0.5)
        } else {
            #expect(snapshot.globalScrollFrame.minY == probe.headerBottom + contentTopPadding)
        }
        if opensKeypad {
            #expect(probe.plannedOffset != nil)
            #expect(probe.isRevealReady)
            #expect(snapshot.assignment.height > 0)
            #expect(store.assignmentCalculator != nil)
            #expect(snapshot.viewport.minY > 0)
            #expect(snapshot.assignment.minY >= snapshot.viewport.minY)
            #expect(snapshot.assignment.maxY <= snapshot.viewport.maxY + 0.5)
            #expect(snapshot.globalAssignment.maxY <= probe.peekTop + 0.5)
            #expect(snapshot.globalAssignment.minY >= probe.headerBottom - 0.5)
        } else {
            #expect(store.assignmentCalculator == nil)
            #expect(snapshot.globalScrollFrame.maxY > probe.footerTop + 0.5)
        }
    }

    private func nativeBudgetScrollView(in view: UIView) -> UIScrollView? {
        // The outer scroll view pages months horizontally. Inspect the vertical
        // category scroller, including when its content fits in the viewport.
        if let scrollView = view as? UIScrollView,
            !scrollView.alwaysBounceHorizontal,
            scrollView.contentSize.width <= scrollView.bounds.width + 0.5
        {
            return scrollView
        }
        return view.subviews.lazy.compactMap { nativeBudgetScrollView(in: $0) }.first
    }

    private func scrollingBudget(
        groupCount: Int = 8, overspentCategoryID: String? = nil, monthCount: Int = 1
    )
        -> BudgetStore
    {
        let month = BudgetMonth.current()
        let groups = (0..<groupCount).map { group in
            BudgetCategoryGroup(
                categoryGroup: .init(
                    _id: "group-\(group)", name: "Group \(group)", type: "expense"),
                categories: (0..<2).map { category in
                    .init(
                        _id: "\(group)-\(category)", name: "Category \(category)", iconName: nil,
                        type: "expense")
                })
        }
        let structure = BudgetStructure(
            workspace: .init(
                id: "scroll-test", name: "Personal", currencyCode: "USD", minorUnit: 2,
                timezoneIdentifier: nil), categoryGroups: groups)
        let amounts = Dictionary(
            uniqueKeysWithValues: groups.flatMap { group in
                group.categories.map {
                    (
                        $0.id,
                        BudgetCategoryAmounts(
                            assignedAmount: 1_000,
                            available: $0.id == overspentCategoryID ? -1_000 : 1_000)
                    )
                }
            })
        let snapshot = BudgetSnapshot(
            months: (0..<monthCount).map {
                .init(yearMonth: BudgetMonth.offset(month, by: $0), budgetData: amounts)
            },
            availableRange: .init(
                minYearMonth: month, maxYearMonth: BudgetMonth.offset(month, by: monthCount - 1)),
            readyToAssign: 8_000)
        return BudgetStore(
            defaults: nil,
            structureSubscription: {
                Just(structure).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            snapshotSubscription: { _, _ in
                Just(snapshot).setFailureType(to: Error.self).eraseToAnyPublisher()
            },
            assignmentHandler: { _ in .init(success: true) })
    }

    @Test
    func rendersReadyToAssignWithANegativeBalanceBelowItsLabel() async throws {
        let store = BudgetStore.preview(readyToAssign: -55_000)
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 {
            if store.canEdit { break }
            await Task.yield()
        }
        try #require(store.canEdit)
        #expect(store.readyToAssign == -55_000)

        for size in [DynamicTypeSize.large, .accessibility3] {
            try await record(
                BudgetReadyToAssignPeek(
                    readyToAssign: store.readyToAssign, currencyCode: "USD", minorUnit: 2
                )
                .padding(24)
                .background(
                    KualiaPalette.budgetInputBackground(readyToAssign: store.readyToAssign)),
                size: size, name: "budget-negative-ready-to-assign-\(size)"
            )
        }
    }

    @Test
    func readyToAssignAndCompletionReserveTheSameHeight() async throws {
        for typeSize in [DynamicTypeSize.large, .accessibility3, .accessibility5] {
            var heights: [CGFloat] = []
            for showsCompletion in [false, true] {
                var height: CGFloat = 0
                _ = try await HostedViewSnapshot.image(
                    of: BudgetReadyToAssignPeek(
                        readyToAssign: 0, currencyCode: "USD", minorUnit: 2,
                        showsCompletion: showsCompletion
                    )
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: {
                        height = $0
                    }
                    .environment(\.dynamicTypeSize, typeSize)
                    .environment(\.locale, Locale(identifier: "en_US"))
                    .background(KualiaPalette.peekPositiveBackground),
                    size: CGSize(width: 320, height: 500)
                )
                try #require(height > 0)
                heights.append(height)
            }
            #expect(heights[0] == heights[1])
        }
    }

    @Test(arguments: [false, true])
    func categoryStatusUsesAProgressFooterOrWrapsAtAccessibilitySizes(isCompact: Bool) throws {
        let cases: [BudgetCategoryAmounts] = [
            .init(available: 500),
            .init(available: -15_000),
            .init(target: .init(targetAmount: 50_000, remainingToAssign: 15_000)),
            .init(target: .init(targetAmount: 50_000)),
            .init(target: .init(targetAmount: 50_000, overfundedByAmount: 15_000)),
            .init(target: .init(isSnoozed: true)),
        ]
        for size in [DynamicTypeSize.large, .accessibility3] {
            for showsProgress in [false, true] {
                var heights: [CGFloat] = []
                for amounts in cases {
                    let controller = UIHostingController(
                        rootView: BudgetCategoryRow(
                            row: .init(
                                id: "category", name: "Groceries", isCreditCard: false,
                                assigned: 0, available: 0, activity: 0, isPending: false,
                                progress: .init(
                                    target: amounts.target, available: Decimal(amounts.available)),
                                funding: .init(amounts: amounts)),
                            currencyCode: "USD", minorUnit: 2, isEditing: false, calculator: nil,
                            canEdit: true, amountColumnWidth: 96, onEdit: {},
                            showsProgress: showsProgress, month: 202609, isCompact: isCompact
                        )
                        .environment(\.dynamicTypeSize, size)
                        .environment(\.locale, Locale(identifier: "en_US")))
                    let height = controller.sizeThatFits(
                        in: CGSize(width: 320, height: 700)
                    ).height
                    try #require(height > 0)
                    heights.append(height)
                }
                for height in heights.dropFirst() {
                    #expect(
                        (!isCompact && showsProgress) || size.isAccessibilitySize
                            ? height > heights[0] : height == heights[0])
                }
            }
        }
    }

    @Test(arguments: [Int64(-1_500), Int64(0), Int64(5_000)])
    func snoozeIndicatorShowsWithoutProgressAndKeepsTheAvailableChipLayout(available: Int64)
        async throws
    {
        for size in [DynamicTypeSize.large, .accessibility3] {
            var heights: [CGFloat] = []
            var images: [Data] = []
            for isSnoozed in [false, true] {
                var height: CGFloat = 0
                let row = BudgetCategoryRow(
                    row: .init(
                        id: "category", name: "Groceries", isCreditCard: false,
                        assigned: 5_000, available: Decimal(available), activity: 0,
                        isPending: false,
                        targetFundingStatus: isSnoozed ? .snoozed : .funded),
                    currencyCode: "USD", minorUnit: 2, isEditing: false, calculator: nil,
                    canEdit: true, amountColumnWidth: 96, onEdit: {}, canMoveMoney: true,
                    showsProgress: false)
                #expect(
                    row.availableAccessibilityValue.contains(L10n.string("Target snoozed"))
                        == isSnoozed)
                let image = try await HostedViewSnapshot.image(
                    of:
                        row
                        .onGeometryChange(for: CGFloat.self) {
                            $0.size.height
                        } action: {
                            height = $0
                        }
                        .environment(\.dynamicTypeSize, size)
                        .environment(\.locale, Locale(identifier: "en_US")),
                    size: CGSize(width: 320, height: 300))
                try #require(height > 0)
                heights.append(height)
                images.append(try #require(image.pngData()))
            }
            #expect(heights[0] == heights[1])
            #expect(images[0] != images[1])
        }
    }

    @Test
    func neighboringMonthsKeepAssignedAndAvailableButtonAppearance() async throws {
        let store = scrollingBudget(groupCount: 1)
        defer { store.stop() }
        store.start()
        for _ in 0..<1_000 where !store.canEdit { await Task.yield() }
        try #require(store.canEdit)
        try #require(store.canMoveMoney)
        let group = try #require(store.groups.first)
        var images: [Data] = []
        for offset in [-1, 0, 1] {
            let image = try await HostedViewSnapshot.image(
                of: BudgetCategoryGroupSection(
                    store: store, group: group,
                    month: BudgetMonth.offset(store.selectedMonth, by: offset),
                    showsCategoryProgress: false, editingCategoryID: nil,
                    animatesDisclosure: false, onEdit: { _ in }, onChangeMonth: {},
                    onMoveMoney: { _ in }, onOpenCategory: { _ in }
                )
                .environment(\.locale, Locale(identifier: "en_US"))
                .environment(\.dynamicTypeSize, .large),
                size: CGSize(width: 390, height: 220)
            )
            images.append(try #require(image.pngData()))
        }
        #expect(images[0] == images[1])
        #expect(images[1] == images[2])
    }

    @Test(arguments: [false, true])
    func assignmentControlsRespectTheSelectedBudgetLayout(isCompact: Bool) async throws {
        var frames: [CGRect] = []
        for assigned: Int64 in [0, 123_456] {
            var assignmentFrames: [String: CGRect] = [:]
            _ = try await HostedViewSnapshot.image(
                of: BudgetCategoryRow(
                    row: BudgetCategoryRowModel(
                        id: "category", name: "Groceries and other everyday expenses",
                        isCreditCard: false, assigned: assigned, available: 0,
                        activity: 0, isPending: false
                    ),
                    currencyCode: "USD", minorUnit: 2, isEditing: false,
                    calculator: nil, canEdit: true, amountColumnWidth: 96, onEdit: {},
                    isCompact: isCompact
                )
                .onPreferenceChange(BudgetAssignmentFrames.self) { assignmentFrames = $0 }
                .environment(\.dynamicTypeSize, .large)
                .environment(\.locale, Locale(identifier: "en_US")),
                size: CGSize(width: 390, height: 200)
            )
            frames.append(try #require(assignmentFrames["category"]))
        }
        if isCompact {
            for frame in frames {
                #expect(abs(frame.width - 96) < 0.5)
                #expect(abs(frame.height - 44) < 0.5)
                #expect(abs(frame.minX - (390 - 192)) < 0.5)
                #expect(abs(frame.maxX - (390 - 96)) < 0.5)
            }
            #expect(frames[0] == frames[1])
        } else {
            #expect(frames[0].width >= 52)
            #expect(frames[0].width < 96)
            #expect(frames[1].width > frames[0].width)
            #expect(frames[0].minX > frames[1].minX)
            #expect(abs(frames[0].maxX - frames[1].maxX) < 0.5)
        }
    }

    @Test(arguments: [false, true])
    func calculationsAndSavingKeepTheAssignmentRowTheSameSize(isCompact: Bool) async throws {
        var calculator = AmountCalculator(amount: 123_456, minorUnit: 2)
        var states: [(calculator: AmountCalculator?, isPending: Bool)] = [
            (nil, false), (calculator, false),
        ]
        calculator.appendOperation(.add)
        states.append((calculator, false))
        for digit in [1, 2, 3] { calculator.appendDigit(digit) }
        states.append((calculator, false))
        calculator.appendOperation(.divide)
        calculator.appendDigit(0)
        states.append((calculator, false))
        calculator.appendDigit(1)
        calculator.resolve()
        states.append((calculator, false))
        states.append((nil, true))
        for typeSize in [DynamicTypeSize.large, .accessibility3] {
            var rowSizes: [CGSize] = []
            for state in states {
                var rowSize = CGSize.zero
                _ = try await HostedViewSnapshot.image(
                    of: BudgetCategoryRow(
                        row: BudgetCategoryRowModel(
                            id: "groceries", name: "Groceries", isCreditCard: false,
                            assigned: state.calculator?.previewAmount ?? 123_456,
                            available: 34_500, activity: -88_956, isPending: state.isPending
                        ),
                        currencyCode: "USD", minorUnit: 2, isEditing: state.calculator != nil,
                        calculator: state.calculator, canEdit: true, amountColumnWidth: 96,
                        onEdit: {}, isCompact: isCompact
                    )
                    .onGeometryChange(for: CGSize.self) {
                        $0.size
                    } action: {
                        rowSize = $0
                    }
                    .environment(\.dynamicTypeSize, typeSize)
                    .environment(\.locale, Locale(identifier: "en_US"))
                    .background(KualiaPalette.canvas),
                    size: CGSize(width: 414, height: 300)
                )
                try #require(rowSize.height > 0)
                rowSizes.append(rowSize)
            }
            #expect(rowSizes.allSatisfy { $0 == rowSizes[0] })
        }
    }

    @Test
    func rendersQuickAssignChooserAndPreviewWithPeekActions() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            let store = BudgetStore.preview
            defer { store.stop() }
            store.start()
            for _ in 0..<1_000 {
                if store.canEdit { break }
                await Task.yield()
            }
            try #require(store.canEdit)
            store.beginQuickAssign()
            for (step, isChoosing) in [true, false, true].enumerated() {
                if isChoosing {
                    store.showQuickAssignOptions()
                } else {
                    store.chooseQuickAssignOption(.underfunded)
                }
                try await record(
                    BudgetQuickAssignView(store: store)
                        .safeAreaInset(edge: .bottom) {
                            BudgetReadyToAssignPeek(
                                readyToAssign: store.readyToAssign,
                                currencyCode: "USD", minorUnit: 2,
                                quickAssign: store.quickAssign,
                                onApplyQuickAssign: {},
                                canApplyQuickAssign: store.canApplyQuickAssign
                            )
                            .padding(18)
                            .background(KualiaPalette.peekBackground)
                        },
                    size: size,
                    name:
                        "budget-quick-assign-\(step)-\(isChoosing ? "chooser" : "preview")-\(size)"
                )
            }
        }
    }

    @Test
    func quickAssignKeepsTheSharedPeekHeightWithoutASummary() async throws {
        let plan = BudgetQuickAssignPlan.make(
            option: .underfunded,
            categories: [
                .init(
                    id: "groceries", name: "Groceries", groupName: "Everyday",
                    assigned: 0, available: 0, underfunded: 5_000, overfunded: 0)
            ],
            currentMonth: 202609, readyToAssign: 8_000, allowsNegativeRTA: false)
        let session = BudgetQuickAssignSession(
            workspaceID: "preview", yearMonth: 202609, option: .underfunded, plan: plan)
        for typeSize in [DynamicTypeSize.large, .xxxLarge] {
            var heights: [CGFloat] = []
            for isQuickAssign in [false, true] {
                var height: CGFloat = 0
                _ = try await HostedViewSnapshot.image(
                    of: BudgetReadyToAssignPeek(
                        readyToAssign: 8_000, currencyCode: "USD", minorUnit: 2,
                        onQuickAssign: {}, quickAssign: isQuickAssign ? session : nil
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: {
                        height = $0
                    }
                    .padding(.horizontal, 24)
                    .environment(\.dynamicTypeSize, typeSize)
                    .environment(\.locale, Locale(identifier: "en_US"))
                    .background(KualiaPalette.peekPositiveBackground),
                    size: CGSize(width: 390, height: 600))
                try #require(height > 0)
                heights.append(height)
            }
            #expect(abs(heights[1] - heights[0]) < 0.5)
        }
    }

    @Test
    func quickAssignPeekReservesPreviewHeightBeforeChoosingAMethod() async throws {
        let categories: [BudgetQuickAssignCategory] = [
            .init(
                id: "groceries", name: "Groceries", groupName: "Everyday",
                assigned: 0, available: 0, underfunded: 5_000, overfunded: 0,
                history: [202608: .init(assigned: 7_000, activity: -3_000)]),
            .init(
                id: "travel", name: "Travel", groupName: "Future",
                assigned: 3_000, available: 5_000, underfunded: 0, overfunded: 2_000,
                history: [202608: .init(assigned: 1_000, activity: 2_000)]),
        ]
        let states: [(BudgetQuickAssignOption, Bool)] =
            [(.underfunded, true)]
            + BudgetQuickAssignOption.allCases.map { ($0, false) }
        for typeSize in [DynamicTypeSize.large, .accessibility3] {
            var placeholderHeight: CGFloat?
            for (option, isChoosing) in states {
                let plan = BudgetQuickAssignPlan.make(
                    option: option, categories: categories, currentMonth: 202609,
                    readyToAssign: 2_000, allowsNegativeRTA: true)
                var session = BudgetQuickAssignSession(
                    workspaceID: "preview", yearMonth: 202609, option: option, plan: plan)
                session.isChoosingOption = isChoosing
                var height: CGFloat = 0
                _ = try await HostedViewSnapshot.image(
                    of: BudgetQuickAssignPeek(
                        session: session, readyToAssign: 2_000,
                        currencyCode: "USD", minorUnit: 2, showsCompletion: false
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: {
                        height = $0
                    }
                    .padding(.horizontal, 24)
                    .environment(\.dynamicTypeSize, typeSize)
                    .environment(\.locale, Locale(identifier: "en_US"))
                    .background(KualiaPalette.peekPositiveBackground),
                    size: CGSize(width: 390, height: 600))
                try #require(height > 0)
                if let placeholderHeight {
                    #expect(abs(height - placeholderHeight) < 0.5)
                } else {
                    placeholderHeight = height
                }
            }
        }
    }

    @Test
    func rendersTemporaryQuickAssignUndoAtZeroAndNonzeroBalances() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            for amount: Decimal in [0, 3_000] {
                for isUndoing in [false, true] {
                    try await record(
                        BudgetReadyToAssignPeek(
                            readyToAssign: amount, currencyCode: "USD", minorUnit: 2,
                            onQuickAssign: {}, onUndo: {}, canUndo: !isUndoing,
                            isUndoing: isUndoing
                        )
                        .padding(24)
                        .background(KualiaPalette.peekPositiveBackground),
                        size: size, name: "budget-quick-undo-\(amount)-\(isUndoing)-\(size)")
                }
            }
        }
    }

    @Test
    func completionKeepsUndoBesideTheMessageWithoutChangingPeekHeight() {
        for size in [DynamicTypeSize.large, .accessibility3] {
            let heights = [false, true].map { complete in
                let controller = UIHostingController(
                    rootView:
                        BudgetReadyToAssignPeek(
                            readyToAssign: 0, currencyCode: "USD", minorUnit: 2,
                            showsCompletion: complete, onUndo: {}
                        )
                        .environment(\.dynamicTypeSize, size)
                        .environment(\.locale, Locale(identifier: "en_US")))
                return controller.sizeThatFits(in: CGSize(width: 342, height: 600)).height
            }
            #expect(heights[0] > 0)
            #expect(abs(heights[0] - heights[1]) < 0.5)
        }
    }

    @Test
    func rendersAllAssignedWithUndoOnTheRegularBudgetPeek() async throws {
        for size in [DynamicTypeSize.large, .accessibility3] {
            try await record(
                BudgetReadyToAssignPeek(
                    readyToAssign: 0, currencyCode: "USD", minorUnit: 2,
                    showsCompletion: true, onUndo: {}
                )
                .padding(24)
                .background(KualiaPalette.peekPositiveBackground),
                size: size, name: "budget-all-assigned-with-undo-\(size)")
        }
    }

    @Test
    func quickAssignUpdatesTheSingleBalanceOnlyAfterChoosingAnOption() {
        let plan = BudgetQuickAssignPlan.make(
            option: .underfunded,
            categories: [
                .init(
                    id: "groceries", name: "Groceries", groupName: "Everyday",
                    assigned: 0, available: 0, underfunded: 5_000, overfunded: 0)
            ],
            currentMonth: 202609, readyToAssign: 8_000, allowsNegativeRTA: false)
        var peek = BudgetReadyToAssignPeek(
            readyToAssign: 8_000, currencyCode: "USD", minorUnit: 2)
        let existingAmount = peek.primaryAmount
        var session = BudgetQuickAssignSession(
            workspaceID: "preview", yearMonth: 202609, option: .underfunded, plan: plan)
        session.isChoosingOption = true
        peek.quickAssign = session
        #expect(peek.primaryAmount == existingAmount)

        session.isChoosingOption = false
        peek.quickAssign = session
        #expect(peek.primaryAmount == 3_000)

        session.isChoosingOption = true
        peek.quickAssign = session
        #expect(peek.primaryAmount == existingAmount)

        peek.quickAssign = nil
        #expect(peek.primaryAmount == existingAmount)
        #expect(!peek.showsAssignmentPreview)
    }

    @Test
    func quickAssignKeepsTheAfterAmountAndSuppressesActionsUntilTheSessionCloses() {
        let plan = BudgetQuickAssignPlan.make(
            option: .underfunded,
            categories: [
                .init(
                    id: "groceries", name: "Groceries", groupName: "Everyday",
                    assigned: 0, available: 0, underfunded: 5_000, overfunded: 0)
            ],
            currentMonth: 202609, readyToAssign: 8_000, allowsNegativeRTA: false)
        var session = BudgetQuickAssignSession(
            workspaceID: "preview", yearMonth: 202609, option: .underfunded, plan: plan)
        session.isChoosingOption = false
        for phase in [BudgetQuickAssignSession.Phase.reviewing, .saving, .checking, .finished] {
            session.phase = phase
            // The optimistic store balance already reflects the pending assignment.
            let peek = BudgetReadyToAssignPeek(
                readyToAssign: 3_000, currencyCode: "USD", minorUnit: 2, quickAssign: session)
            #expect(peek.showsAssignmentPreview)
            #expect(peek.primaryAmount == 3_000)
            #expect(!peek.isActionVisible)
            #expect(peek.quickAssign?.plan.readyToAssignBefore == 8_000)
        }
    }

    @Test
    func undoWaitsForTheAllAssignedRevealButRemainsAvailableForNonzeroResults() {
        var peek = BudgetReadyToAssignPeek(
            readyToAssign: 0, currencyCode: "USD", minorUnit: 2, onUndo: {})
        #expect(!peek.isActionVisible)
        peek.showsCompletion = true
        #expect(peek.isActionVisible)

        let nonzeroPeek = BudgetReadyToAssignPeek(
            readyToAssign: 3_000, currencyCode: "USD", minorUnit: 2, onUndo: {})
        #expect(nonzeroPeek.isActionVisible)
        peek.showsCompletion = false
        peek.isUndoing = true
        #expect(peek.isActionVisible)
    }

    @Test(arguments: [Decimal(-18_000), Decimal.zero, Decimal(32_000)])
    func onboardingBalanceKeepsFullContrastForEveryAmount(amount: Decimal) {
        let peek = BudgetReadyToAssignPeek(
            readyToAssign: amount, currencyCode: "USD", minorUnit: 2,
            usesFullContrast: true)
        #expect(!peek.usesMutedZeroStyle)
        #expect(peek.labelInk == KualiaPalette.peekInk)
        #expect(peek.onMoveMoney == nil)
    }

    @Test
    func zeroBalanceKeepsQuickAssignAvailableAfterTheCompletionReturnsToRTA() {
        let peek = BudgetReadyToAssignPeek(
            readyToAssign: 0, currencyCode: "USD", minorUnit: 2, onQuickAssign: {})
        #expect(peek.isActionVisible)
        #expect(peek.usesMutedZeroStyle)
        #expect(!peek.showsAssignmentPreview)
        #expect(peek.primaryAmount == 0)

        let openPad = BudgetReadyToAssignPeek(
            readyToAssign: 0, currencyCode: "USD", minorUnit: 2,
            isAmountPadPresented: true, onQuickAssign: {})
        #expect(!openPad.usesMutedZeroStyle)

        let funded = BudgetReadyToAssignPeek(
            readyToAssign: 3_000, currencyCode: "USD", minorUnit: 2, onQuickAssign: {})
        #expect(!funded.usesMutedZeroStyle)
    }

    @Test
    func rendersQuickAssignPeekLoadingAndCompletion() async throws {
        let plan = BudgetQuickAssignPlan.make(
            option: .underfunded,
            categories: [
                .init(
                    id: "groceries", name: "Groceries", groupName: "Everyday",
                    assigned: 0, available: 0, underfunded: 5_000, overfunded: 0)
            ],
            currentMonth: 202609, readyToAssign: 5_000, allowsNegativeRTA: false)
        for size in [DynamicTypeSize.large, .accessibility3] {
            for phase in [BudgetQuickAssignSession.Phase.reviewing, .saving, .finished] {
                var session = BudgetQuickAssignSession(
                    workspaceID: "preview", yearMonth: 202609, option: .underfunded, plan: plan)
                session.isChoosingOption = false
                session.phase = phase
                try await record(
                    BudgetQuickAssignPeek(
                        session: session, readyToAssign: 0,
                        currencyCode: "USD", minorUnit: 2,
                        showsCompletion: phase == .finished
                    )
                    .padding(24)
                    .background(KualiaPalette.peekPositiveBackground),
                    size: size, name: "budget-quick-peek-\(phase)-\(size)")
            }
        }
    }

    private func record<Content: View>(
        _ content: Content, size: DynamicTypeSize, name: String
    ) async throws {
        let image = try await HostedViewSnapshot.image(
            of:
                content
                .environment(\.locale, Locale(identifier: "en_US"))
                .environment(\.colorScheme, .light)
                .environment(\.dynamicTypeSize, size),
            size: CGSize(width: 414, height: 896)
        )
        #expect(image.size.width == 414)
        #expect(image.size.height == 896)
        Attachment.record(Array(try #require(image.pngData())), named: "\(name).png")
    }
}

private struct BudgetFilterTransitionRegressionView: View {
    @State private var filter = BudgetCategoryFilter.all

    private let rows: [BudgetCategoryRowModel] = [
        .init(
            id: "funded", name: "Groceries", isCreditCard: false, assigned: 20_000,
            available: 20_000, activity: 0, isPending: false, targetFundingStatus: .funded,
            progress: .init(target: .init(targetAmount: 20_000, fundedRatio: 1)),
            funding: .init(
                amounts: .init(
                    assignedAmount: 20_000, available: 20_000,
                    target: .init(targetAmount: 20_000)))),
        .init(
            id: "retained", name: "Dining out", isCreditCard: false, assigned: 5_000,
            available: -15_000, activity: -20_000, isPending: false,
            progress: .init(available: -15_000, fundedRatio: 0.25),
            funding: .init(amounts: .init(available: -15_000))),
    ]

    var body: some View {
        VStack(spacing: 0) {
            Text("Budget filters").frame(height: 44)
            BudgetCategoryFilterContent(filter: filter) {
                LazyVStack(spacing: 0) {
                    ForEach(rows.filter { filter.matches($0) }) { row in
                        BudgetCategoryRow(
                            row: row, currencyCode: "USD", minorUnit: 2, isEditing: false,
                            calculator: nil, canEdit: true, amountColumnWidth: 96, onEdit: {},
                            canMoveMoney: true, showsProgress: true, month: 202609
                        )
                        .background {
                            if row.id == "retained" { BudgetFilterRowFrameProbe() }
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .background(KualiaPalette.canvas)
        .task {
            do {
                try await Task.sleep(for: .milliseconds(150))
                filter = .overspent
            } catch { return }
        }
    }
}

private struct BudgetFilterRowFrameProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.accessibilityIdentifier = "filter-retained-row"
        view.accessibilityValue = UUID().uuidString
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}

@MainActor
private final class BudgetNavigationProbe {
    var isBudgetSelected = false
    var visit = 0
}

private struct BudgetNavigationRegressionView: View {
    let store: BudgetStore
    let probe: BudgetNavigationProbe
    @State private var isBudgetSelected = false

    var body: some View {
        BudgetView(
            store: store, isActive: isBudgetSelected, editingCategoryID: nil,
            onEdit: { _ in }, onChangeMonth: {}
        )
        .opacity(isBudgetSelected ? 1 : 0)
        .kualiaSafeAreaBar(edge: .top, spacing: 0) {
            HomeTopBar(
                title: isBudgetSelected ? "Budget" : "Home",
                onNewEntry: {}, onPreferences: {},
                onTitleTap: isBudgetSelected ? {} : nil, showsActions: false,
                budgetMonth: isBudgetSelected ? store.selectedMonth : nil,
                currentBudgetMonth: store.currentMonth
            )
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 8)
        }
        .kualiaSafeAreaBar(edge: .bottom, spacing: 0) { Text("Menu").frame(height: 68) }
        .modifier(HomeScrollSurface(showsBottomToolbar: true))
        .background(KualiaPalette.canvas)
        .environment(\.dynamicTypeSize, .large)
        .task {
            do {
                try await Task.sleep(for: .milliseconds(100))
                for visit in 1...2 {
                    // Use the same immediate transaction as Home navigation.
                    withAnimation(nil) {
                        isBudgetSelected = true
                        probe.isBudgetSelected = true
                        probe.visit = visit
                    }
                    try await Task.sleep(for: .milliseconds(260))
                    if visit == 1 {
                        withAnimation(nil) {
                            isBudgetSelected = false
                            probe.isBudgetSelected = false
                        }
                        try await Task.sleep(for: .milliseconds(100))
                    }
                }
            } catch { return }
        }
    }
}

@MainActor
private final class BudgetViewportProbe {
    var snapshot: BudgetViewportSnapshot?
    var frames: [String: CGRect] = [:]
    var peekTop: CGFloat = 0
    var headerBottom: CGFloat = 0
    var footerTop: CGFloat = 0
    var isRevealReady = false
    var plannedOffset: CGFloat?
    var initialOffset: CGFloat?
    var initialTopInset: CGFloat = 0
    var openingStarted = false
    var selectedCategoryID: String?
    var finalAssignment: CGRect?
    var selectCategory: ((String) -> Void)?
}

enum BudgetRevealSelection: CaseIterable {
    case lowestVisible
    case nearestCovered
    case alreadyVisible
}

private struct BudgetScrollAnimationSample {
    let time: TimeInterval
    let offset: CGFloat
    let presentedOffset: CGFloat
    let height: CGFloat
    let contentHeight: CGFloat
    let bottomInset: CGFloat
    let isOpeningComplete: Bool

    var csv: String {
        "\(time),\(offset),\(presentedOffset),\(height),\(contentHeight),\(bottomInset),\(isOpeningComplete)"
    }
}

private struct BudgetViewportSnapshot {
    let assignment: CGRect
    let globalAssignment: CGRect
    let viewport: CGRect
    let globalScrollFrame: CGRect
}

private struct BudgetViewportTransition: View {
    let store: BudgetStore
    let categoryID: String
    let probe: BudgetViewportProbe
    let opensKeypad: Bool
    var contentTopPadding: CGFloat = 0
    var openingAnimation: Animation? = nil
    var initialScrollDistance: CGFloat? = nil
    var selection: BudgetRevealSelection = .lowestVisible
    @State private var activeCategoryID: String?
    @State private var presentation = PeekPresentation()
    @State private var isRevealReady = false
    @State private var focusRegistry = BudgetAssignmentFocusRegistry()
    private var focus: BudgetAssignmentFocus {
        focusRegistry.focus(workspaceID: store.workspace?.id)
    }
    @State private var containerFrame = CGRect.zero

    var body: some View {
        PeekContainer(
            presentation: presentation, expansionHeight: 254,
            isCompactPresented: true, compactHeight: 88,
            bottomCornerRadius: 0
        ) {
            BudgetView(
                store: store, isActive: true,
                editingCategoryID: presentation.isPresented || presentation.isPreparing
                    ? activeCategoryID ?? categoryID : nil,
                onEdit: { _ in }, onChangeMonth: {}
            )
            .environment(\.isBudgetAssignmentRevealReady, isRevealReady)
            .environment(\.budgetAssignmentFocusRegistry, focusRegistry)
            .padding(.top, contentTopPadding)
            .onPreferenceChange(BudgetAssignmentFrames.self) { probe.frames = $0 }
            .kualiaSafeAreaBar(edge: .top, spacing: 0) {
                Text("Budget").frame(height: 100)
                    .onGeometryChange(for: CGFloat.self) {
                        $0.frame(in: .global).maxY
                    } action: {
                        probe.headerBottom = $0
                    }
            }
            .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                if !presentation.isPresented {
                    Text("Menu").frame(height: 60)
                        .onGeometryChange(for: CGFloat.self) {
                            $0.frame(in: .global).minY
                        } action: {
                            probe.footerTop = $0
                        }
                }
            }
        } expansion: {
            Color.gray
        } compact: {
            BudgetReadyToAssignPeek(readyToAssign: 8_000, currencyCode: "USD", minorUnit: 2)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onGeometryChange(for: CGFloat.self) {
                    $0.frame(in: .global).minY
                } action: {
                    probe.peekTop = $0
                }
        }
        .onGeometryChange(for: CGRect.self) {
            $0.frame(in: .global)
        } action: {
            containerFrame = $0
        }
        .onDisappear { probe.selectCategory = nil }
        .task {
            guard opensKeypad else { return }
            probe.selectCategory = { categoryID in
                _ = store.beginEditing(categoryID)
                activeCategoryID = categoryID
                presentation.open(hasVisiblePeek: true)
                probe.selectedCategoryID = categoryID
            }
            try? await Task.sleep(for: .milliseconds(30))
            guard !Task.isCancelled else { return }
            if let initialScrollDistance {
                focus.position.scrollTo(y: initialScrollDistance)
                try? await Task.sleep(for: .milliseconds(80))
                guard !Task.isCancelled else { return }
                // Choose an assignment that can actually be tapped before opening.
                let origin = focus.contentOriginY ?? 0
                let visibleFrames = focus.frames.filter {
                    $0.value.minY + origin >= probe.headerBottom
                        && $0.value.maxY + origin <= probe.footerTop
                }
                switch selection {
                case .lowestVisible:
                    activeCategoryID = visibleFrames.max { $0.value.maxY < $1.value.maxY }?.key
                case .nearestCovered:
                    let layout = PeekLayout(
                        containerHeight: containerFrame.height, expansionHeight: 254,
                        isPresented: true,
                        isCompactPresented: true, compactHeight: 88)
                    activeCategoryID =
                        visibleFrames.filter {
                            $0.value.maxY + origin > containerFrame.minY + layout.foregroundHeight
                        }.min { $0.value.maxY < $1.value.maxY }?.key
                case .alreadyVisible:
                    activeCategoryID = visibleFrames.min { $0.value.maxY < $1.value.maxY }?.key
                }
                guard activeCategoryID != nil else { return }
            }
            let selectedCategoryID = activeCategoryID ?? categoryID
            probe.selectedCategoryID = selectedCategoryID
            _ = store.beginEditing(selectedCategoryID)
            presentation.prepare(hasVisiblePeek: true)
            await Task.yield()
            guard let sessionID = presentation.sessionID else { return }
            let layout = PeekLayout(
                containerHeight: containerFrame.height, expansionHeight: 254, isPresented: true,
                isCompactPresented: true, compactHeight: 88)
            let offset = focus.prepareReveal(
                categoryID: selectedCategoryID,
                viewportBottom: containerFrame.minY + layout.foregroundHeight)
            probe.plannedOffset = offset
            probe.initialOffset = focus.geometry?.contentOffset.y
            probe.initialTopInset = focus.geometry?.contentInsets.top ?? 0
            var transaction = Transaction(animation: openingAnimation)
            transaction.scrollContentOffsetAdjustmentBehavior = .disabled
            transaction.addAnimationCompletion(criteria: .removed) {
                isRevealReady = true
                probe.isRevealReady = true
            }
            focus.openAfterRevealLayout {
                probe.openingStarted = true
                withTransaction(transaction) {
                    presentation.reveal(sessionID: sessionID)
                    if let offset { focus.position.scrollTo(y: offset) }
                }
            }
        }
    }
}
