import SwiftUI
import UIKit

/// Native List swipe actions resize UICollectionView cells on every pan update.
/// Translate only the row's rendering instead; its proposed size never changes.
struct TransactionSwipeRow: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    let entry: TransactionFeedEntry
    let workspace: TransactionFeedWorkspace?
    let width: CGFloat
    var categoryAmount: Decimal? = nil
    @Binding var activeRowID: String?
    var isSelecting = false
    var isSelected = false
    var onSelect: (() -> Void)?
    let onEdit: () -> Void
    let onAction: (TransactionFeedAction) async -> Void

    @State private var isDeleting = false
    @State private var deleteSubmitted = false
    @State private var offset: CGFloat = 0
    @State private var dragOrigin: CGFloat = 0
    @State private var dragEdge: TransactionSwipeMotion.Edge?
    @State private var isDragging = false
    @State private var committedEdge: TransactionSwipeMotion.Edge?
    @State private var settlementTarget: CGFloat?
    @State private var settlementRevision = 0
    @State private var settlementTask: Task<Void, Never>?

    private var motion: TransactionSwipeMotion {
        .init(width: width, hasLeadingAction: entry.swipeAction != nil)
    }

    private var direction: CGFloat { layoutDirection == .rightToLeft ? -1 : 1 }
    private var settlementAnimation: Animation {
        // Keep functional settling smooth with Reduce Motion, using a short
        // ease-out instead of removing the movement and snapping into place.
        reduceMotion ? .easeOut(duration: 0.16) : .smooth(duration: 0.3)
    }

    var body: some View {
        TransactionFeedRowButton(
            entry: entry, workspace: workspace, categoryAmount: categoryAmount,
            isSelecting: isSelecting, isSelected: isSelected
        ) {
            if isSelecting {
                onSelect?()
            } else if activeRowID != nil || offset != 0 {
                activeRowID = nil
                close()
            } else {
                onEdit()
            }
        }
        .modifier(
            TransactionSwipePresentation(
                offset: offset, direction: direction, actionWidth: motion.actionWidth,
                allowedEdge: dragEdge, isSelected: isSelecting && isSelected,
                leading: {
                    if let action = entry.swipeAction { actionButton(action, edge: .leading) }
                },
                trailing: { actionButton(.delete, edge: .trailing) })
        )
        .contentShape(Rectangle())
        .highPriorityGesture(
            LongPressGesture(minimumDuration: 0.45).onEnded { _ in
                guard !isSelecting, !isDeleting else { return }
                activeRowID = nil
                close()
                onSelect?()
            }, including: onSelect != nil && !isSelecting ? .all : .none
        )
        .animation(isDragging ? nil : settlementAnimation, value: offset)
        .transaction { $0.disablesAnimations = false }
        .gesture(
            TransactionRowPanGesture(
                shouldBegin: { velocity in
                    !isSelecting && !isDeleting
                        && TransactionSwipeMotion.shouldBegin(velocity: velocity)
                        && (offset != 0 || velocity.x * direction < 0 || entry.swipeAction != nil)
                        && width > 0
                },
                onUpdate: updateDrag)
        )
        .allowsHitTesting(!isDeleting)
        .accessibilityActions {
            if let onSelect, !isSelecting {
                Button(L10n.string("Select transaction"), action: onSelect)
            }
            if !isSelecting {
                if let action = entry.swipeAction {
                    Button(action.title) { perform(action) }
                }
                Button(L10n.string("Delete"), role: .destructive) { perform(.delete) }
            }
        }
        .sensoryFeedback(
            .impact(weight: .heavy, intensity: 1),
            trigger: isDragging ? motion.armedEdge(offset: offset) : nil
        ) { _, armedEdge in
            armedEdge != nil
        }
        .sensoryFeedback(.selection, trigger: isSelected)
        .onChange(of: isSelecting) { _, _ in close() }
        .onChange(of: activeRowID) { _, id in
            if id != entry.id { close() }
        }
        .onChange(of: entry) { _, _ in close() }
        .onChange(of: width) { _, _ in close() }
        .onDisappear {
            // Scrolling away during the exit animation must not cancel a
            // deletion the user already committed.
            submitDelete()
            settlementRevision += 1
            settlementTask?.cancel()
            settlementTarget = nil
            committedEdge = nil
            dragEdge = nil
            isDragging = false
            offset = 0
            if activeRowID == entry.id { activeRowID = nil }
        }
    }

    private func actionButton(
        _ action: TransactionFeedAction, edge: TransactionSwipeMotion.Edge
    ) -> some View {
        Button {
            perform(action)
        } label: {
            VStack(spacing: 4) {
                KualiaIconImage(icon: action.icon, size: 20).font(.title3.weight(.semibold))
                if action == .categorize {
                    Text(action.title).font(.caption.weight(.semibold)).lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .foregroundStyle(.white)
            .modifier(
                TransactionSwipeActionCue(
                    edge: edge,
                    armed: (isDragging ? motion.armedEdge(offset: offset) : committedEdge) == edge,
                    direction: direction, contentWidth: action == .categorize ? 88 : 56)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(action.tint, in: RoundedRectangle(cornerRadius: 18))
            .padding(.vertical, 6)
            .padding(.horizontal, 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(action.title)
    }

    private func action(for edge: TransactionSwipeMotion.Edge) -> TransactionFeedAction? {
        edge == .leading ? entry.swipeAction : .delete
    }

    private func updateDrag(
        _ state: UIGestureRecognizer.State, _ translation: CGFloat, _ velocity: CGFloat
    ) {
        switch state {
        case .began:
            settlementRevision += 1
            settlementTask?.cancel()
            settlementTarget = nil
            committedEdge = nil
            dragOrigin = offset
            dragEdge = motion.edgeForDrag(
                origin: offset, translation: translation * direction, velocity: velocity * direction
            )
            isDragging = true
            activeRowID = entry.id
            fallthrough
        case .changed:
            guard isDragging else { return }
            // A disabling transaction can be coalesced with the final pan
            // callback and suppress the release animation. The row's explicit
            // animation modifier instead selects nil only while dragging.
            withTransaction(Transaction(animation: nil)) {
                offset = motion.dragOffset(
                    origin: dragOrigin, translation: translation * direction, edge: dragEdge)
            }
        case .ended:
            guard isDragging else { return }
            let result = motion.settlement(
                offset: offset, velocity: velocity * direction, edge: dragEdge)
            if case .perform(let edge) = result { committedEdge = edge }
            isDragging = false
            switch result {
            case .closed: close()
            case .open(let edge):
                settle(to: motion.openOffset(for: edge))
            case .perform(let edge):
                if let action = action(for: edge) { perform(action) } else { close() }
            }
        case .cancelled, .failed:
            close()
        default: break
        }
    }

    private func close() {
        guard !isDeleting else { return }
        isDragging = false
        settle(to: 0)
        if activeRowID == entry.id { activeRowID = nil }
    }

    private func settle(to target: CGFloat, completion: (() -> Void)? = nil) {
        // Entry updates and active-row changes can both request the same close.
        // Keep the existing animation and its completion in that case.
        guard settlementTarget != target else { return }
        settlementTarget = target
        settlementTask?.cancel()
        settlementRevision += 1
        let revision = settlementRevision
        // UIKit delivers its pan callbacks inside the List's immediate update.
        // Start settling outside that callback so it cannot inherit a gesture
        // transaction that suppresses animations. A new drag cancels this work.
        settlementTask = Task { @MainActor in
            await Task.yield()
            guard !Task.isCancelled else { return }
            var transaction = Transaction(animation: settlementAnimation)
            transaction.disablesAnimations = false
            withTransaction(transaction) {
                withAnimation(settlementAnimation, completionCriteria: .removed) {
                    offset = target
                } completion: {
                    // Clear the cue only once it is fully hidden. Old animation
                    // completions must not reset a new drag or settlement.
                    guard revision == settlementRevision, !isDragging else { return }
                    settlementTarget = nil
                    if target == 0 {
                        committedEdge = nil
                        dragEdge = nil
                    }
                    completion?()
                }
            }
        }
    }

    private func perform(_ action: TransactionFeedAction) {
        guard !isDeleting else { return }
        if action == .delete {
            isDeleting = true
            deleteSubmitted = false
            isDragging = false
            committedEdge = .trailing
            dragEdge = .trailing
            settle(to: motion.dismissOffset(for: .trailing), completion: submitDelete)
        } else {
            close()
            Task { await onAction(action) }
        }
    }

    private func submitDelete() {
        guard isDeleting, !deleteSubmitted else { return }
        deleteSubmitted = true
        Task { @MainActor in
            await onAction(.delete)
            // Usually the row has already been removed optimistically. If the
            // store rejects or rolls back the deletion, restore this row too.
            isDeleting = false
            deleteSubmitted = false
            close()
        }
    }
}

/// A separate, local animation makes crossing the commit threshold visible
/// even while the finger-driven row translation has animations disabled.
struct TransactionSwipeActionCue: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let edge: TransactionSwipeMotion.Edge
    let armed: Bool
    let direction: CGFloat
    let contentWidth: CGFloat

    func body(content: Content) -> some View {
        GeometryReader { geometry in
            let movesRight = (edge == .leading) == (direction > 0)
            let inset = min(contentWidth, geometry.size.width) / 2
            let armedCenter = movesRight ? geometry.size.width - inset : inset
            content
                .frame(width: contentWidth, height: geometry.size.height)
                .modifier(
                    TransactionSwipeIconPlacement(
                        progress: armed ? 1 : 0, center: geometry.size.width / 2,
                        armedCenter: armedCenter, height: geometry.size.height)
                )
                .animation(
                    reduceMotion ? .easeOut(duration: 0.16) : .snappy(duration: 0.24),
                    value: armed)
        }
    }

}

/// Interpolate only the cue's progress, independently of the changing strip width.
struct TransactionSwipeIconPlacement: ViewModifier, Animatable {
    var progress: CGFloat
    let center: CGFloat
    let armedCenter: CGFloat
    let height: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        content
            .position(x: center + (armedCenter - center) * progress, y: height / 2)
            .transaction { $0.animation = nil }
    }
}

/// Interpolate one presentation offset for both the row and its action strips.
/// Keeping both backgrounds mounted avoids removal transitions leaving a fading
/// action at its old width while the transparent transaction content moves back.
struct TransactionSwipePresentation<Leading: View, Trailing: View>: ViewModifier, Animatable {
    var offset: CGFloat
    let direction: CGFloat
    let actionWidth: CGFloat
    var allowedEdge: TransactionSwipeMotion.Edge? = nil
    var isSelected = false
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing

    var animatableData: CGFloat {
        get { offset }
        set { offset = newValue }
    }

    func body(content: Content) -> some View {
        content
            .modifier(
                TransactionSwipeTranslation(offset: offset * direction, isSelected: isSelected)
            )
            .background {
                // Background geometry never contributes to the row's size.
                GeometryReader { geometry in
                    ZStack {
                        strip(
                            leading(), width: allowedEdge == .trailing ? 0 : max(0, offset),
                            height: geometry.size.height,
                            alignment: .leading)
                        strip(
                            trailing(), width: allowedEdge == .leading ? 0 : max(0, -offset),
                            height: geometry.size.height,
                            alignment: .trailing)
                    }
                }
                .accessibilityHidden(true)
            }
            .clipped()
            // The modifier already interpolates offset. Its descendants must
            // render that frame directly, without a second animation or fade.
            .transaction { $0.animation = nil }
    }

    private func strip<Action: View>(
        _ action: Action, width: CGFloat, height: CGFloat, alignment: Alignment
    ) -> some View {
        action
            .frame(width: max(actionWidth, width), height: height)
            .frame(width: width, alignment: alignment)
            .clipped()
            .frame(maxWidth: .infinity, alignment: alignment)
            .allowsHitTesting(width > 0)
    }
}

/// Keep the resting inset inside the moving content, so the clipping viewport
/// remains the full list width rather than ending at the text's side margins.
struct TransactionSwipeTranslation: ViewModifier {
    let offset: CGFloat
    var isSelected = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 18)
            .background(KualiaPalette.surface)
            .overlay {
                if isSelected {
                    KualiaPalette.ink.opacity(0.05).allowsHitTesting(false)
                }
            }
            .offset(x: offset)
    }
}

struct TransactionSwipeMotion {
    enum Edge: Equatable { case leading, trailing }
    enum Settlement: Equatable {
        case closed
        case open(Edge)
        case perform(Edge)
    }

    let width: CGFloat
    let hasLeadingAction: Bool

    var actionWidth: CGFloat { min(88, max(0, width) * 0.35) }
    var commitDistance: CGFloat { max(actionWidth + 44, width * 0.4) }

    static func shouldBegin(velocity: CGPoint) -> Bool {
        abs(velocity.x) > abs(velocity.y) * 1.2
    }

    static func hasPriority(over other: UIGestureRecognizer, rowView: UIView?) -> Bool {
        // Account/category lists live inside a sheet. Its container pan also
        // competes with row swipes, even though its view is not a UIScrollView.
        // Vertical drags still fail our direction gate; preserve edge navigation.
        guard other is UIPanGestureRecognizer, !(other is UIScreenEdgePanGestureRecognizer),
            let rowView, let container = other.view
        else { return false }
        return rowView.isDescendant(of: container)
    }

    func edgeForDrag(origin: CGFloat, translation: CGFloat, velocity: CGFloat) -> Edge {
        // An already-open row keeps its existing side, including when this
        // gesture starts by dragging back toward closed.
        let initial = origin != 0 ? origin : (translation != 0 ? translation : velocity)
        return initial > 0 ? .leading : .trailing
    }

    func dragOffset(origin: CGFloat, translation: CGFloat, edge: Edge? = nil) -> CGFloat {
        let width = max(0, width)
        let proposed = origin + translation
        if let edge, width > 0 {
            let sign: CGFloat = edge == .leading ? 1 : -1
            let reverseTravel = -proposed * sign
            if reverseTravel > 0 {
                // A small elastic stop at closed, never a second action strip.
                return -sign * 12 * reverseTravel / (reverseTravel + 60)
            }
        }
        return min(hasLeadingAction ? width : 0, max(-width, proposed))
    }

    func openOffset(for edge: Edge) -> CGFloat { edge == .leading ? actionWidth : -actionWidth }
    func dismissOffset(for edge: Edge) -> CGFloat { (edge == .leading ? 1 : -1) * max(0, width) }

    func armedEdge(offset: CGFloat) -> Edge? {
        guard width > 0 else { return nil }
        let offset = dragOffset(origin: 0, translation: offset)
        guard abs(offset) >= commitDistance else { return nil }
        return offset > 0 ? .leading : .trailing
    }

    func settlement(offset: CGFloat, velocity: CGFloat, edge: Edge? = nil) -> Settlement {
        guard width > 0 else { return .closed }
        if let edge, offset * (edge == .leading ? 1 : -1) <= 0 { return .closed }
        let offset = dragOffset(origin: 0, translation: offset)
        if let edge = armedEdge(offset: offset) { return .perform(edge) }
        // Velocity may reveal an action, but must never commit a destructive
        // action that the finger hasn't actually dragged far enough to reach.
        let projected = dragOffset(origin: offset, translation: velocity * 0.12)
        guard abs(projected) > actionWidth * 0.5, projected * offset > 0 else { return .closed }
        return .open(projected > 0 ? .leading : .trailing)
    }
}

private struct TransactionRowPanGesture: UIGestureRecognizerRepresentable {
    let shouldBegin: (CGPoint) -> Bool
    let onUpdate: (UIGestureRecognizer.State, CGFloat, CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator(shouldBegin: shouldBegin)
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        context.coordinator.shouldBegin = shouldBegin
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        // Window coordinates stay stationary while the row is translated.
        onUpdate(
            recognizer.state, recognizer.translation(in: nil).x, recognizer.velocity(in: nil).x)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var shouldBegin: (CGPoint) -> Bool

        init(shouldBegin: @escaping (CGPoint) -> Bool) { self.shouldBegin = shouldBegin }

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            return shouldBegin(pan.velocity(in: nil))
        }

        func gestureRecognizer(
            _ recognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy other: UIGestureRecognizer
        ) -> Bool {
            TransactionSwipeMotion.hasPriority(over: other, rowView: recognizer.view)
        }
    }
}
