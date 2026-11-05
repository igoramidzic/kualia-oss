import SwiftUI
import UIKit

struct BudgetPlanReorderView: UIViewControllerRepresentable {
    let groups: [BudgetCategoryGroup]
    let isEnabled: Bool
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0
    var allowsMovingBetweenGroups = true
    var accessibilityPrefix = "budget-plan-reorder"
    let onDragActivity: (Bool) -> Void
    let onMove: (BudgetPlanOrdering.Move) -> Bool

    func makeUIViewController(context: Context) -> BudgetPlanReorderController {
        let controller = BudgetPlanReorderController()
        updateUIViewController(controller, context: context)
        return controller
    }

    func updateUIViewController(_ controller: BudgetPlanReorderController, context: Context) {
        controller.allowsMovingBetweenGroups = allowsMovingBetweenGroups
        controller.accessibilityPrefix = accessibilityPrefix
        controller.onDragActivity = onDragActivity
        controller.onMove = onMove
        controller.updateViewportInsets(top: topInset, bottom: bottomInset)
        controller.update(groups: groups, isEnabled: isEnabled)
    }
}

/// A pan on the handle starts native interactive movement immediately. UIKit
/// moves neighboring rows and scrolls at the edges; there is no drag-session lift,
/// item provider, hover-time snapshot rebuild, or network work in the gesture path.
@MainActor
final class BudgetPlanReorderController: UIViewController, UICollectionViewDataSource,
    UICollectionViewDelegateFlowLayout, UIGestureRecognizerDelegate
{
    private typealias Item = BudgetPlanOrdering.Item
    private typealias Move = BudgetPlanOrdering.Move
    private typealias Destination = BudgetPlanOrdering.Destination

    var allowsMovingBetweenGroups = true
    var accessibilityPrefix = "budget-plan-reorder"
    var onDragActivity: (Bool) -> Void = { _ in }
    var onMove: (BudgetPlanOrdering.Move) -> Bool = { _ in false }

    private var latestGroups: [BudgetCategoryGroup] = []
    private var displayedGroups: [BudgetCategoryGroup] = []
    private var expandedRows: [[Item]] = []
    private var collapsedRows: [[Item]] = []
    private var rows: [[Item]] {
        drag.collapsesCategories ? collapsedRows : expandedRows
    }
    private var titles: [Item: String] = [:]
    private var measuredRows: [Item: (width: CGFloat, height: CGFloat)] = [:]
    private var isEnabled = false
    private var drag = BudgetPlanDragState()
    private var startingItem: Item?
    private var touchOffset = CGPoint.zero
    private var isFinishing = false
    private var viewportInsets = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
    private var expandedCollection: UICollectionView!
    private var collapsedCollection: UICollectionView!
    private var collectionView: UICollectionView {
        drag.collapsesCategories ? collapsedCollection : expandedCollection
    }
    private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(dragChanged))

    override func viewDidLoad() {
        super.viewDidLoad()
        expandedCollection = makeCollection(collapsed: false)
        collapsedCollection = makeCollection(collapsed: true)
        collapsedCollection.isHidden = true
        setContentScrollView(expandedCollection, for: .top)
        pan.maximumNumberOfTouches = 1
        pan.delegate = self
        // The recognizer stays on the common parent when the header list covers
        // the expanded list. Its source view is never reloaded or removed mid-touch.
        view.addGestureRecognizer(pan)
        expandedCollection.panGestureRecognizer.require(toFail: pan)
        collapsedCollection.panGestureRecognizer.require(toFail: pan)
        registerForTraitChanges([
            UITraitPreferredContentSizeCategory.self, UITraitUserInterfaceStyle.self,
        ]) {
            (controller: BudgetPlanReorderController, _: UITraitCollection) in
            if controller.drag.item != nil {
                controller.cancelDrag()
            } else {
                controller.reloadRows()
            }
        }
        reloadRows()
    }

    private func makeCollection(collapsed: Bool) -> UICollectionView {
        let layout = UICollectionViewFlowLayout()
        layout.minimumLineSpacing = collapsed ? 12 : 0
        layout.minimumInteritemSpacing = 0
        layout.sectionInset = UIEdgeInsets(top: 12, left: 16, bottom: 0, right: 16)
        let collection = UICollectionView(frame: view.bounds, collectionViewLayout: layout)
        collection.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        collection.backgroundColor = UIColor(KualiaPalette.budgetPage)
        // SwiftUI already accounts for the sheet and header safe areas. Do not
        // let UIKit add them a second time or shrink the scrolling viewport.
        collection.contentInsetAdjustmentBehavior = .never
        collection.contentInset = viewportInsets
        collection.contentOffset.y = -viewportInsets.top
        collection.showsVerticalScrollIndicator = false
        if #available(iOS 26.0, *) {
            collection.topEdgeEffect.style = .soft
            collection.bottomEdgeEffect.isHidden = true
        }
        collection.dataSource = self
        collection.delegate = self
        collection.allowsSelection = false
        collection.delaysContentTouches = false
        collection.dragInteractionEnabled = false
        collection.reorderingCadence = .immediate
        collection.register(BudgetPlanReorderCell.self, forCellWithReuseIdentifier: "row")
        collection.accessibilityIdentifier =
            collapsed
            ? "\(accessibilityPrefix)-groups" : "\(accessibilityPrefix)-collection"
        view.addSubview(collection)
        return collection
    }

    func updateViewportInsets(top: CGFloat, bottom: CGFloat) {
        viewportInsets = UIEdgeInsets(
            top: top.isFinite ? max(0, top) : 0, left: 0,
            bottom: (bottom.isFinite ? max(0, bottom) : 0) + 24, right: 0)
        guard isViewLoaded, drag.item == nil else { return }
        applyViewportInsets()
    }

    private func applyViewportInsets() {
        for collection in [expandedCollection, collapsedCollection].compactMap({ $0 }) {
            guard collection.contentInset != viewportInsets else { continue }
            let topChange = viewportInsets.top - collection.contentInset.top
            let offset = collection.contentOffset.y
            collection.contentInset = viewportInsets
            collection.contentOffset.y = offset - topChange
        }
    }

    private func rows(in collection: UICollectionView) -> [[Item]] {
        collection === collapsedCollection ? collapsedRows : expandedRows
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        cancelDrag()
    }

    func update(groups: [BudgetCategoryGroup], isEnabled: Bool) {
        latestGroups = groups
        self.isEnabled = isEnabled
        // Authoritative updates are retained while UIKit owns the moving layout.
        guard drag.item == nil, !isFinishing else { return }
        guard displayedGroups != groups else { return }
        displayedGroups = groups
        if isViewLoaded { reloadRows() }
    }

    private func reloadRows() {
        guard drag.item == nil else { return }
        applyViewportInsets()
        expandedRows = displayedGroups.map { BudgetPlanOrdering.items(in: $0, collapsed: false) }
        collapsedRows = [displayedGroups.map { .group($0.id) }]
        titles.removeAll(keepingCapacity: true)
        measuredRows.removeAll(keepingCapacity: true)
        for group in displayedGroups {
            titles[.group(group.id)] = group.categoryGroup.name
            titles[.empty(group.id)] = L10n.string("Drop a category here")
            for category in group.categories { titles[.category(category.id)] = category.name }
        }
        expandedCollection.reloadData()
        collapsedCollection.reloadData()
        collectionView.layoutIfNeeded()
    }

    private func positionVisibleItem(_ item: Item, screenY: CGFloat) {
        guard let path = indexPath(for: item) else { return }
        collectionView.layoutIfNeeded()
        collectionView.scrollToItem(at: path, at: .centeredVertically, animated: false)
        collectionView.layoutIfNeeded()
        guard let frame = collectionView.layoutAttributesForItem(at: path)?.frame else { return }
        let minimum = -collectionView.adjustedContentInset.top
        let maximum = max(
            minimum,
            collectionView.contentSize.height - collectionView.bounds.height
                + collectionView.adjustedContentInset.bottom)
        collectionView.contentOffset.y = min(maximum, max(minimum, frame.minY - screenY))
        // Materialize/reuse cells for the final offset before native movement.
        collectionView.layoutIfNeeded()
    }

    private func indexPath(for item: Item) -> IndexPath? {
        for (section, items) in rows.enumerated() {
            if let row = items.firstIndex(of: item) {
                return IndexPath(item: row, section: section)
            }
        }
        return nil
    }

    func numberOfSections(in collectionView: UICollectionView) -> Int {
        rows(in: collectionView).count
    }

    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int)
        -> Int
    {
        let rows = rows(in: collectionView)
        return rows.indices.contains(section) ? rows[section].count : 0
    }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt path: IndexPath)
        -> UICollectionViewCell
    {
        let rows = rows(in: collectionView)
        let collapsed = collectionView === collapsedCollection
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "row", for: path)
        guard let cell = cell as? BudgetPlanReorderCell else { return cell }
        guard
            let item = BudgetPlanOrdering.sizingItem(
                in: rows, section: path.section, row: path.item, moving: drag.item)
        else {
            cell.resetContent()
            return cell
        }
        cell.configure(
            title: titles[item] ?? "", item: item,
            isFirst: item.isGroup,
            isLast: collapsed || path.item >= rows[path.section].count - 1)
        cell.titleLabel.moveActions = { [weak self] in self?.accessibleMoves(for: item) ?? [] }
        return cell
    }

    func collectionView(
        _ collectionView: UICollectionView, layout: UICollectionViewLayout,
        sizeForItemAt path: IndexPath
    ) -> CGSize {
        let rows = rows(in: collectionView)
        let width = max(1, collectionView.bounds.width - 32)
        guard
            let item = BudgetPlanOrdering.sizingItem(
                in: rows, section: path.section, row: path.item, moving: drag.item)
        else { return CGSize(width: width, height: 56) }
        if let measurement = measuredRows[item], measurement.width == width {
            return CGSize(width: width, height: measurement.height)
        }
        let textWidth = max(1, width - 16 - (item.canDrag ? 52 : 16))
        let font = BudgetPlanReorderCell.font(isGroup: item.isGroup)
        let textHeight = (titles[item] ?? "").boundingRect(
            with: CGSize(width: textWidth, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font], context: nil
        ).height
        let height = max(56, ceil(textHeight) + 32)
        measuredRows[item] = (width, height)
        return CGSize(width: width, height: height)
    }

    /// Resolve the dedicated handle hit area before claiming a scroll gesture.
    func draggableItem(at point: CGPoint) -> BudgetPlanOrdering.Item? {
        guard isViewLoaded, isEnabled, drag.item == nil, !isFinishing,
            let path = collectionView.indexPathForItem(at: point),
            let cell = collectionView.cellForItem(at: path) as? BudgetPlanReorderCell,
            cell.canStartDrag(at: collectionView.convert(point, to: cell))
        else { return nil }
        return BudgetPlanOrdering.rowItem(in: rows, section: path.section, row: path.item)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch)
        -> Bool
    {
        guard gestureRecognizer === pan else { return false }
        let point = touch.location(in: collectionView)
        guard let item = draggableItem(at: point), let path = indexPath(for: item),
            let cell = collectionView.cellForItem(at: path)
        else { return false }
        startingItem = item
        let local = touch.location(in: cell)
        touchOffset = CGPoint(x: cell.bounds.midX - local.x, y: cell.bounds.midY - local.y)
        return true
    }

    @objc private func dragChanged(_ gesture: UIPanGestureRecognizer) {
        switch gesture.state {
        case .began:
            guard let item = startingItem, beginMovement(of: item) else { return }
            updateDragPosition(gesture)
            UISelectionFeedbackGenerator().selectionChanged()
        case .changed:
            if drag.item != nil, !isFinishing { updateDragPosition(gesture) }
        case .ended:
            endMovement(cancelled: false)
        case .cancelled, .failed:
            endMovement(cancelled: true)
        default: break
        }
    }

    /// Both data sources are prepared before the gesture. Changing which list
    /// is visible does not invalidate the cells or index paths in either one.
    @discardableResult
    func beginMovement(of item: BudgetPlanOrdering.Item) -> Bool {
        guard isViewLoaded, isEnabled, drag.item == nil, !isFinishing,
            let source = indexPath(for: item),
            let sourceCell = collectionView.cellForItem(at: source), item.canDrag
        else { return false }
        let screenY = sourceCell.frame.minY - collectionView.contentOffset.y
        drag.begin(id: UUID(), item: item)
        onDragActivity(true)
        if item.isGroup {
            collapsedCollection.isHidden = false
            setContentScrollView(collapsedCollection, for: .top)
            expandedCollection.accessibilityElementsHidden = true
            positionVisibleItem(item, screenY: screenY)
        }
        guard let path = indexPath(for: item), collectionView.cellForItem(at: path) != nil,
            collectionView.beginInteractiveMovementForItem(at: path)
        else {
            finishDrag()
            return false
        }
        return true
    }

    private func updateDragPosition(_ gesture: UIPanGestureRecognizer) {
        let point = gesture.location(in: collectionView)
        collectionView.updateInteractiveMovementTargetPosition(
            CGPoint(x: collectionView.bounds.midX, y: point.y + touchOffset.y))
    }

    private func endMovement(cancelled: Bool) {
        guard drag.item != nil, !isFinishing else { return }
        isFinishing = true
        let sessionID = drag.sessionID
        CATransaction.begin()
        CATransaction.setCompletionBlock { [weak self] in
            // Let UIKit finish its animation completion and cell bookkeeping
            // before either collection is reloaded.
            Task { @MainActor [weak self] in
                guard let self, self.drag.sessionID == sessionID else { return }
                self.finishDrag()
            }
        }
        if cancelled {
            collectionView.cancelInteractiveMovement()
        } else {
            collectionView.endInteractiveMovement()
        }
        CATransaction.commit()
    }

    func cancelDrag() {
        endMovement(cancelled: true)
    }

    private func finishDrag() {
        guard let id = drag.sessionID else { return }
        let header = drag.collapsesCategories ? drag.item : nil
        let screenY = header.flatMap(indexPath).flatMap {
            collectionView.layoutAttributesForItem(at: $0)?.frame.minY
        }.map { $0 - collectionView.contentOffset.y }
        drag.end(id: id)
        startingItem = nil
        isFinishing = false
        displayedGroups = latestGroups
        collapsedCollection.isHidden = true
        setContentScrollView(expandedCollection, for: .top)
        expandedCollection.accessibilityElementsHidden = false
        reloadRows()
        if let header, let screenY { positionVisibleItem(header, screenY: screenY) }
        onDragActivity(false)
    }

    func collectionView(_ collectionView: UICollectionView, canMoveItemAt path: IndexPath) -> Bool {
        let rows = rows(in: collectionView)
        guard collectionView === self.collectionView,
            let item = BudgetPlanOrdering.rowItem(
                in: rows, section: path.section, row: path.item)
        else { return false }
        return item == drag.item
    }

    func collectionView(
        _ collectionView: UICollectionView,
        targetIndexPathForMoveOfItemFromOriginalIndexPath original: IndexPath,
        atCurrentIndexPath current: IndexPath, toProposedIndexPath proposed: IndexPath
    ) -> IndexPath {
        guard let item = drag.item else { return current }
        if item.isGroup { return proposed }
        guard allowsMovingBetweenGroups || original.section == proposed.section else {
            return current
        }
        guard displayedGroups.indices.contains(proposed.section),
            displayedGroups.indices.contains(original.section)
        else { return current }
        guard
            let row = BudgetPlanOrdering.targetRow(
                sourceGroupID: displayedGroups[original.section].id,
                targetGroupID: displayedGroups[proposed.section].id,
                proposedRow: proposed.item, in: displayedGroups)
        else { return current }
        return IndexPath(item: row, section: proposed.section)
    }

    func collectionView(
        _ collectionView: UICollectionView, moveItemAt source: IndexPath, to destination: IndexPath
    ) {
        guard collectionView === self.collectionView, let item = drag.item,
            let updated = BudgetPlanOrdering.movingRow(
                in: rows(in: collectionView), item: item,
                sourceSection: source.section, sourceRow: source.item,
                destinationSection: destination.section, destinationRow: destination.item),
            drag.collapsesCategories || displayedGroups.indices.contains(destination.section)
        else {
            // Restore the authoritative rows after UIKit finishes the interaction.
            // No partial removal or server write is allowed for a stale callback.
            return
        }
        if collectionView === collapsedCollection {
            collapsedRows = updated
        } else {
            expandedRows = updated
        }
        let groupID = drag.collapsesCategories ? nil : displayedGroups[destination.section].id
        if let move = BudgetPlanOrdering.move(
            item: item, toGroupID: groupID, row: destination.item, in: displayedGroups)
        {
            commit(move)
        }
        // Keep UIKit's counts intact until its placement animation finishes.
        // finishDrag then restores empty placeholders and expands the groups.
    }

    private func commit(_ move: Move) {
        guard isEnabled, let change = move.change(in: latestGroups) else { return }
        if case .moveCategory(_, let source, let destination, _) = change,
            !allowsMovingBetweenGroups && source != destination
        {
            return
        }
        guard onMove(move) else { return }
        latestGroups = change.applying(to: latestGroups)
        if drag.item == nil {
            displayedGroups = latestGroups
            reloadRows()
        }
    }

    private func accessibleMoves(for item: Item) -> [UIAccessibilityCustomAction] {
        var candidates: [(String, Destination)] = []
        switch item {
        case .group(let id):
            guard let index = displayedGroups.firstIndex(where: { $0.id == id }) else { return [] }
            if index > 0 {
                candidates.append(
                    (L10n.string("Move group up"), .beforeGroup(displayedGroups[index - 1].id)))
            }
            if index + 1 < displayedGroups.count {
                candidates.append(
                    (L10n.string("Move group down"), .afterGroup(displayedGroups[index + 1].id)))
            }
        case .category(let id):
            guard
                let group = displayedGroups.first(where: { $0.categories.contains { $0.id == id } }
                ),
                let index = group.categories.firstIndex(where: { $0.id == id })
            else { return [] }
            if index > 0 {
                candidates.append(
                    (
                        L10n.string("Move up"),
                        .category(groupID: group.id, beforeID: group.categories[index - 1].id)
                    ))
            }
            if index + 1 < group.categories.count {
                let next = index + 2 < group.categories.count ? group.categories[index + 2].id : nil
                candidates.append(
                    (L10n.string("Move down"), .category(groupID: group.id, beforeID: next)))
            }
            for other in displayedGroups where allowsMovingBetweenGroups && other.id != group.id {
                candidates.append(
                    (
                        L10n.string("Move to \(other.categoryGroup.name)"),
                        .category(groupID: other.id, beforeID: nil)
                    ))
            }
        case .empty: break
        }
        return candidates.compactMap { name, destination in
            let move = Move(item: item, destination: destination)
            guard move.change(in: displayedGroups) != nil else { return nil }
            return UIAccessibilityCustomAction(name: name) { [weak self] _ in
                guard let self, self.isEnabled, self.drag.item == nil else { return false }
                self.commit(move)
                return true
            }
        }
    }
}

@MainActor
private final class BudgetPlanReorderLabel: UILabel {
    var moveActions: () -> [UIAccessibilityCustomAction] = { [] }
    override var accessibilityCustomActions: [UIAccessibilityCustomAction]? {
        get { moveActions() }
        set {}
    }
}

/// Reusable native rows match the editor's typography, spacing and group cards.
/// No embedded SwiftUI trees are rebuilt as UIKit moves the rows under the finger.
@MainActor
private final class BudgetPlanReorderCell: UICollectionViewCell {
    let titleLabel = BudgetPlanReorderLabel()
    private let card = UIView()
    private let headerTint = UIView()
    private let grip = UIImageView(image: UIImage(named: KualiaIcon.grip.rawValue))
    private let separator = UIView()
    private let outline = CAShapeLayer()
    private var isFirst = false
    private var isLast = false
    private var isGroup = false
    private var canDrag = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        contentView.addSubview(card)
        card.layer.cornerRadius = 20
        card.layer.cornerCurve = .continuous
        card.clipsToBounds = true
        card.backgroundColor = UIColor(KualiaPalette.surface)
        headerTint.backgroundColor = UIColor(KualiaPalette.border.opacity(0.12))
        card.addSubview(headerTint)
        titleLabel.numberOfLines = 0
        titleLabel.isAccessibilityElement = true
        card.addSubview(titleLabel)
        grip.contentMode = .scaleAspectFit
        grip.isAccessibilityElement = false
        card.addSubview(grip)
        separator.backgroundColor = UIColor(KualiaPalette.border.opacity(0.45))
        card.addSubview(separator)
        outline.fillColor = nil
        outline.lineWidth = 0.5
        card.layer.addSublayer(outline)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func resetContent() {
        titleLabel.text = nil
        titleLabel.moveActions = { [] }
        grip.isHidden = true
        canDrag = false
    }

    static func font(isGroup: Bool) -> UIFont {
        let base = UIFont.systemFont(ofSize: 15, weight: isGroup ? .bold : .medium)
        let rounded = UIFont(
            descriptor: base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor, size: 15)
        return UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: rounded)
    }

    func configure(
        title: String, item: BudgetPlanOrdering.Item,
        isFirst: Bool, isLast: Bool
    ) {
        self.isFirst = isFirst
        self.isLast = isLast
        outline.strokeColor = UIColor(KualiaPalette.border.opacity(0.4)).cgColor
        isGroup = item.isGroup
        canDrag = item.canDrag
        titleLabel.text = title
        titleLabel.font = Self.font(isGroup: item.isGroup)
        titleLabel.textColor = UIColor(item.canDrag ? KualiaPalette.ink : KualiaPalette.mutedInk)
        titleLabel.accessibilityTraits = item.isGroup ? [.header] : [.staticText]
        titleLabel.accessibilityHint = item.canDrag ? L10n.string("Use actions to reorder") : nil
        grip.isHidden = !item.canDrag
        grip.tintColor = UIColor(KualiaPalette.mutedInk.opacity(0.65))
        headerTint.isHidden = !item.isGroup
        var corners: CACornerMask = []
        if isFirst { corners.formUnion([.layerMinXMinYCorner, .layerMaxXMinYCorner]) }
        if isLast { corners.formUnion([.layerMinXMaxYCorner, .layerMaxXMaxYCorner]) }
        card.layer.maskedCorners = corners
        separator.isHidden = isGroup || isLast
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        card.frame = contentView.bounds
        headerTint.frame = card.bounds
        let width = card.bounds.width
        let height = card.bounds.height
        grip.frame = CGRect(x: width - 35, y: (height - 18) / 2, width: 18, height: 18)
        let trailing: CGFloat = canDrag ? 52 : 16
        titleLabel.frame = CGRect(x: 16, y: 0, width: max(1, width - 16 - trailing), height: height)
        separator.frame = CGRect(x: 14, y: height - 0.5, width: max(0, width - 28), height: 0.5)
        updateOutline(width: width, height: height)
    }

    private func updateOutline(width: CGFloat, height: CGFloat) {
        let path = UIBezierPath()
        let inset: CGFloat = 0.25
        let radius: CGFloat = 20
        let top = isFirst ? radius : 0
        let bottom = isLast ? height - radius : height
        path.move(to: CGPoint(x: inset, y: top))
        path.addLine(to: CGPoint(x: inset, y: bottom))
        path.move(to: CGPoint(x: width - inset, y: top))
        path.addLine(to: CGPoint(x: width - inset, y: bottom))
        if isFirst {
            path.move(to: CGPoint(x: inset, y: radius))
            path.addArc(
                withCenter: CGPoint(x: radius, y: radius), radius: radius - inset,
                startAngle: .pi, endAngle: .pi * 1.5, clockwise: true)
            path.addLine(to: CGPoint(x: width - radius, y: inset))
            path.addArc(
                withCenter: CGPoint(x: width - radius, y: radius), radius: radius - inset,
                startAngle: .pi * 1.5, endAngle: .pi * 2, clockwise: true)
        }
        if isLast {
            path.move(to: CGPoint(x: width - inset, y: height - radius))
            path.addArc(
                withCenter: CGPoint(x: width - radius, y: height - radius), radius: radius - inset,
                startAngle: 0, endAngle: .pi / 2, clockwise: true)
            path.addLine(to: CGPoint(x: radius, y: height - inset))
            path.addArc(
                withCenter: CGPoint(x: radius, y: height - radius), radius: radius - inset,
                startAngle: .pi / 2, endAngle: .pi, clockwise: true)
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        outline.path = path.cgPath
        CATransaction.commit()
    }

    func canStartDrag(at point: CGPoint) -> Bool {
        guard canDrag, card.frame.contains(point) else { return false }
        let local = convert(point, to: card)
        return local.x >= card.bounds.width - 48
    }

}
