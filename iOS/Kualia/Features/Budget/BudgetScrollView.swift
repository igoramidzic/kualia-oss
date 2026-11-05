import Observation
import SwiftUI

/// Keep the scrolling surface in SwiftUI so safeAreaBar can extend it behind the
/// home controls and apply the system's scroll edge effects.
struct BudgetScrollView<Content: View>: View {
    let editingCategoryID: String?
    var isActive = true
    var scrollToTopRequest = 0
    var onScrollChange: (() -> Void)? = nil
    @ViewBuilder let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isBudgetAssignmentRevealReady) private var isRevealReady
    @Environment(\.budgetAssignmentFocus) private var sharedFocus
    @State private var localFocus = BudgetAssignmentFocus()
    @State private var request: BudgetAssignmentFocus.Request?
    @State private var openingRequest: UUID?

    private var focus: BudgetAssignmentFocus { sharedFocus ?? localFocus }

    var body: some View {
        @Bindable var focus = focus
        ScrollView {
            content
                .background(ImmediateScrollTouches())
                .coordinateSpace(name: BudgetScrollCoordinateSpace.content)
                .onGeometryChange(for: CGFloat.self) {
                    $0.frame(in: .global).minY
                } action: {
                    focus.contentOriginY = $0
                }
                .padding(.bottom, editingCategoryID == nil ? 0 : focus.revealBottomPadding)
        }
        .scrollPosition($focus.position)
        .onChange(of: scrollToTopRequest) { _, _ in
            guard isActive else { return }
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                focus.position.scrollTo(edge: .top)
            }
        }
        .scrollIndicators(.hidden)
        .kualiaScrollEdges(for: [.top, .bottom])
        .onScrollGeometryChange(for: ScrollGeometry.self) {
            $0
        } action: { _, geometry in
            focus.geometry = geometry
            onScrollChange?()
            updateRequest()
        }
        .onPreferenceChange(BudgetAssignmentFrames.self) { frames in
            focus.frames = frames
            updateRequest()
        }
        .onChange(of: editingCategoryID, initial: true) { _, _ in updateRequest() }
        .onChange(of: isRevealReady, initial: true) { _, _ in updateRequest() }
        .onChange(of: isActive) { _, _ in updateRequest() }
        .onChange(of: focus.openingRequestID) { _, _ in updateRequest() }
        .onScrollPhaseChange { _, phase in
            focus.updateScrollPhase(phase)
            onScrollChange?()
            updateRequest()
        }
        .task(id: request) {
            guard !Task.isCancelled, let request,
                request.categoryID == editingCategoryID,
                let reveal = focus.consume(request)
            else { return }
            // Category switches and later layout changes use the measured viewport.
            // Opening is coordinated by HomeView before its animation starts.
            withAnimation(reveal.animates && !reduceMotion ? .smooth(duration: 0.2) : nil) {
                focus.position.scrollTo(y: reveal.offset)
            }
        }
        .task(id: openingRequest) {
            guard !Task.isCancelled, let openingRequest else { return }
            focus.completeOpening(openingRequest)
        }
    }

    private func updateRequest() {
        focus.select(editingCategoryID)
        focus.isViewportReady = isActive && isRevealReady
        let next = focus.revealRequest(for: editingCategoryID)
        if request != next { request = next }
        let nextOpening = isActive ? focus.readyOpeningRequest() : nil
        if openingRequest != nextOpening { openingRequest = nextOpening }
    }
}

/// Live measurements are inputs, not observable state. Only selection, content
/// layout, or viewport changes request a reveal; manual scrolling never does.
@MainActor
@Observable
final class BudgetAssignmentFocus {
    var position = ScrollPosition()
    private(set) var revealBottomPadding: CGFloat = 0
    private(set) var openingRequestID: UUID?
    @ObservationIgnored var geometry: ScrollGeometry?
    @ObservationIgnored var frames: [String: CGRect] = [:]
    @ObservationIgnored var contentOriginY: CGFloat?
    @ObservationIgnored var isViewportReady = true
    @ObservationIgnored private var categoryID: String?
    @ObservationIgnored private var hasHandledSelection = false
    @ObservationIgnored private var lastHandledRequest: Request?
    @ObservationIgnored private var userInterruptedSelection = false
    @ObservationIgnored private var scrollPhase: ScrollPhase = .idle
    @ObservationIgnored private var openingContentHeight: CGFloat?
    @ObservationIgnored private var openingAction: (() -> Void)?

    struct Reveal: Equatable {
        let offset: CGFloat
        let animates: Bool
    }

    func select(_ categoryID: String?) {
        guard self.categoryID != categoryID else { return }
        self.categoryID = categoryID
        hasHandledSelection = false
        lastHandledRequest = nil
        userInterruptedSelection = false
        openingRequestID = nil
        openingAction = nil
        openingContentHeight = nil
        if categoryID == nil { revealBottomPadding = 0 }
    }

    func updateScrollPhase(_ phase: ScrollPhase) {
        scrollPhase = phase
        if phase == .interacting || phase == .decelerating {
            userInterruptedSelection = categoryID != nil
        }
    }

    /// Plan against the final peek boundary in screen coordinates. Using the
    /// content's measured origin avoids assuming the scroll and sheet heights match.
    func prepareReveal(categoryID: String, viewportBottom: CGFloat) -> CGFloat? {
        select(categoryID)
        guard !userInterruptedSelection, let geometry, let contentOriginY,
            let frame = frames[categoryID], frame.height > 0,
            geometry.contentSize.height > 0
        else { return nil }
        let visibleTop = geometry.contentOffset.y + geometry.contentInsets.top
        let viewport = CGRect(
            x: 0, y: visibleTop, width: geometry.containerSize.width,
            height: max(0, viewportBottom - contentOriginY - visibleTop))
        guard viewport.height > 0 else { return nil }
        hasHandledSelection = true
        guard
            let offset = BudgetAssignmentVisibility.offset(
                target: frame, viewport: viewport, contentHeight: geometry.contentSize.height)
        else { return nil }
        // An assignment near the end can need more than the current scroll range.
        // Reserve content for the destination before the opening scroll is applied, so
        // SwiftUI cannot clamp it to the old range while the peek is resizing.
        // Keep this space stable for the editing session; closing removes it.
        revealBottomPadding += max(
            0, offset + geometry.containerSize.height - geometry.contentSize.height)
        openingContentHeight = offset + geometry.containerSize.height
        return offset
    }

    /// Numeric scroll commands are clamped immediately, even when their content
    /// padding changes in the same transaction. Wait for native layout to expose
    /// the planned range, then let the owner animate the peek and scroll together.
    func openAfterRevealLayout(_ action: @escaping () -> Void) {
        openingAction = action
        openingRequestID = UUID()
    }

    func readyOpeningRequest() -> UUID? {
        guard let openingRequestID else { return nil }
        if let openingContentHeight {
            guard let geometry, geometry.contentSize.height + 0.5 >= openingContentHeight
            else { return nil }
        }
        return openingRequestID
    }

    func completeOpening(_ requestID: UUID) {
        guard requestID == readyOpeningRequest() else { return }
        let action = openingAction
        openingAction = nil
        openingRequestID = nil
        openingContentHeight = nil
        action?()
    }

    func consume(_ request: Request) -> Reveal? {
        guard request != lastHandledRequest,
            request == self.request(for: request.categoryID)
        else { return nil }
        let animates = !hasHandledSelection
        hasHandledSelection = true
        lastHandledRequest = request
        guard let offset = destination(for: request) else { return nil }
        return Reveal(offset: offset, animates: animates)
    }

    /// Geometry/preference callbacks also run when an assignment's label changes.
    /// Do not invalidate the scrolling view for visible rows or replay a command
    /// while native scrolling is still catching up to its requested position.
    func revealRequest(for categoryID: String?) -> Request? {
        guard let request = request(for: categoryID), request != lastHandledRequest else {
            return nil
        }
        guard destination(for: request) != nil else {
            _ = consume(request)
            return nil
        }
        return request
    }

    struct Request: Equatable {
        let categoryID: String
        let frame: CGRect
        let containerSize: CGSize
        let contentSize: CGSize
        let contentInsets: EdgeInsets

        static func == (lhs: Self, rhs: Self) -> Bool {
            // Editing can resize the amount label horizontally without changing
            // its visibility. Only vertical changes can require another reveal.
            lhs.categoryID == rhs.categoryID
                && lhs.frame.minY == rhs.frame.minY && lhs.frame.height == rhs.frame.height
                && lhs.containerSize.height == rhs.containerSize.height
                && lhs.contentSize.height == rhs.contentSize.height
                && lhs.contentInsets.top == rhs.contentInsets.top
                && lhs.contentInsets.bottom == rhs.contentInsets.bottom
        }
    }

    func request(for categoryID: String?) -> Request? {
        guard isViewportReady, scrollPhase == .idle, !userInterruptedSelection,
            let categoryID, let frame = frames[categoryID], frame.height > 0,
            let geometry, geometry.containerSize.height > 0, geometry.contentSize.height > 0
        else { return nil }
        return Request(
            categoryID: categoryID, frame: frame, containerSize: geometry.containerSize,
            contentSize: geometry.contentSize, contentInsets: geometry.contentInsets)
    }

    func destination(for request: Request) -> CGFloat? {
        guard request == self.request(for: request.categoryID), let geometry else { return nil }
        let viewport = CGRect(
            x: geometry.contentOffset.x + geometry.contentInsets.leading,
            y: geometry.contentOffset.y + geometry.contentInsets.top,
            // SwiftUI's containerSize already excludes the safe-area bars.
            // Subtracting their insets again causes a second, excessive reveal.
            width: geometry.containerSize.width,
            height: geometry.containerSize.height)
        guard
            let visibleTop = BudgetAssignmentVisibility.offset(
                target: request.frame, viewport: viewport,
                contentHeight: geometry.contentSize.height)
        else { return nil }

        // ScrollPosition is relative to the inset content origin. SwiftUI applies
        // the top inset when converting this to the native content offset.
        return visibleTop
    }
}

/// One scroll position belongs to the workspace's persistent budget canvas.
/// Month selection changes the contents, not the scroll view or its position binding.
@MainActor
final class BudgetAssignmentFocusRegistry {
    private var focuses: [String?: BudgetAssignmentFocus] = [:]

    func focus(workspaceID: String?) -> BudgetAssignmentFocus {
        if let existing = focuses[workspaceID] { return existing }
        let focus = BudgetAssignmentFocus()
        focuses[workspaceID] = focus
        return focus
    }
}

extension EnvironmentValues {
    @Entry var budgetAssignmentFocusRegistry: BudgetAssignmentFocusRegistry? = nil
    @Entry var budgetAssignmentFocus: BudgetAssignmentFocus? = nil
    /// Avoid retargeting the coordinated opening animation as the viewport resizes.
    @Entry var isBudgetAssignmentRevealReady = true
}

private enum BudgetScrollCoordinateSpace: Hashable {
    case content
}

struct BudgetAssignmentFrames: PreferenceKey {
    nonisolated static let defaultValue: [String: CGRect] = [:]

    nonisolated static func reduce(
        value: inout [String: CGRect], nextValue: () -> [String: CGRect]
    ) {
        value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
    }
}

struct BudgetAssignmentAnchor: View {
    let categoryID: String

    var body: some View {
        GeometryReader { geometry in
            Color.clear.preference(
                key: BudgetAssignmentFrames.self,
                value: [categoryID: geometry.frame(in: .named(BudgetScrollCoordinateSpace.content))]
            )
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The native horizontal scroll view owns paging and direction arbitration with
/// each month's vertical scroll view. Only the title observes every scroll frame.
// Shared month paging remains in use by the Spending calendar.
@MainActor
@Observable
final class BudgetMonthPaging {
    struct Geometry: Equatable {
        let offset: CGFloat
        let width: CGFloat
    }

    struct Selection: Equatable {
        let sourceMonth: Int
        let destinationMonth: Int
        let workspaceID: String?
    }

    private(set) var monthPosition: CGFloat?
    var isScrolling = false
    @ObservationIgnored private var hadUserInteraction = false
    @ObservationIgnored private var swipeSelection: Int?
    @ObservationIgnored private var measuredMonthPosition: CGFloat?
    @ObservationIgnored private var pendingGeometryPublication: UUID?

    func beginUserScroll() { hadUserInteraction = true }

    func finishUserScroll(selectedMonth: Int, workspaceID: String?) -> Selection? {
        isScrolling = false
        defer { hadUserInteraction = false }
        guard hadUserInteraction, let destination = nearestMonth, destination != selectedMonth
        else { return nil }
        swipeSelection = destination
        return Selection(
            sourceMonth: selectedMonth, destinationMonth: destination, workspaceID: workspaceID)
    }

    func selectionNeedsAlignment(_ month: Int) -> Bool {
        defer { swipeSelection = nil }
        return swipeSelection != month
    }

    func cancelSwipe() {
        isScrolling = false
        hadUserInteraction = false
        swipeSelection = nil
        pendingGeometryPublication = nil
    }

    var nearestMonth: Int? {
        (measuredMonthPosition ?? monthPosition).map { BudgetMonth.fromIndex(Int($0.rounded())) }
    }

    func align(to month: Int) {
        pendingGeometryPublication = nil
        measuredMonthPosition = CGFloat(BudgetMonth.index(month))
        monthPosition = measuredMonthPosition
    }

    func update(_ geometry: Geometry, firstMonth: Int, lastMonth: Int) {
        guard geometry.width > 0, geometry.width.isFinite, geometry.offset.isFinite else { return }
        let first = CGFloat(BudgetMonth.index(firstMonth))
        let last = CGFloat(BudgetMonth.index(lastMonth))
        measuredMonthPosition = min(last, max(first, first + geometry.offset / geometry.width))
        guard pendingGeometryPublication == nil else { return }
        let publication = UUID()
        pendingGeometryPublication = publication
        // Keep the final measurement available to the idle callback immediately,
        // but invalidate the title/safe-area bar only after scroll layout returns.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.pendingGeometryPublication == publication else { return }
            self.pendingGeometryPublication = nil
            if self.monthPosition != self.measuredMonthPosition {
                self.monthPosition = self.measuredMonthPosition
            }
        }
    }

    func titlePosition(selectedMonth: Int) -> CGFloat {
        isScrolling
            ? monthPosition ?? CGFloat(BudgetMonth.index(selectedMonth))
            : CGFloat(BudgetMonth.index(swipeSelection ?? selectedMonth))
    }

    func browsingLabel(selectedMonth: Int, currentMonth: Int) -> String? {
        let visibleMonth = BudgetMonth.fromIndex(
            Int(titlePosition(selectedMonth: selectedMonth).rounded()))
        return BudgetMonth.browsingLabel(visibleMonth, currentMonth: currentMonth)
    }
}

extension EnvironmentValues {
    @Entry var budgetMonthPaging: BudgetMonthPaging? = nil
}
