import Foundation

/// Hidden content still gets measured. Its size must not animate the foreground
/// while a native sheet or navigation controller is laying out the page.
nonisolated struct PeekCompactAnimationState: Equatable {
    let isPresented: Bool
    let height: CGFloat

    init(isPresented: Bool, height: CGFloat) {
        self.isPresented = isPresented
        self.height = isPresented ? height : 0
    }
}

/// Shared by the peek container and callers that need its destination before opening.
nonisolated struct PeekLayout {
    let height: CGFloat
    let expansionHeight: CGFloat
    let visibleExpansionHeight: CGFloat
    let compactContentHeight: CGFloat
    let visibleCompactHeight: CGFloat
    var visibleBackHeight: CGFloat { visibleExpansionHeight + visibleCompactHeight }
    var foregroundHeight: CGFloat { height - visibleBackHeight }

    func expansionTop(motion: PeekContentMotion) -> CGFloat {
        height - (motion == .stationaryReveal ? expansionHeight : visibleExpansionHeight)
    }

    func compactTop(motion: PeekContentMotion) -> CGFloat {
        expansionTop(motion: motion) - compactContentHeight
    }

    init(
        containerHeight: CGFloat, expansionHeight: CGFloat, isPresented: Bool,
        isCompactPresented: Bool, compactHeight: CGFloat, maximumHeightFraction: CGFloat = 0.62
    ) {
        height = max(0, containerHeight)
        self.expansionHeight = min(
            max(0, expansionHeight), height * min(max(maximumHeightFraction, 0), 1))
        visibleExpansionHeight = isPresented ? self.expansionHeight : 0
        compactContentHeight = min(max(0, compactHeight), height)
        visibleCompactHeight =
            isCompactPresented ? min(compactContentHeight, height - visibleExpansionHeight) : 0
    }
}

/// Keeps the back layer alive until its own dismissal finishes. A stale animation
/// completion cannot remove content opened by another field or page.
nonisolated struct PeekPresentation {
    private(set) var isPresented = false
    private(set) var isPreparing = false
    private(set) var sessionID: UUID?
    private(set) var contentMotion: PeekContentMotion = .stationaryReveal

    var isClosing: Bool { sessionID != nil && !isPreparing && !isPresented }

    init(initiallyPresented: Bool = false, hasVisiblePeek: Bool = false) {
        if initiallyPresented { open(hasVisiblePeek: hasVisiblePeek) }
    }

    mutating func open(hasVisiblePeek: Bool = false, motion: PeekContentMotion = .automatic) {
        prepare(hasVisiblePeek: hasVisiblePeek, motion: motion)
        isPreparing = false
        isPresented = true
    }

    /// Mount the back layer for measurement before the foreground reveals it.
    mutating func prepare(hasVisiblePeek: Bool = false, motion: PeekContentMotion = .automatic) {
        // Capture the origin before a caller makes its compact content visible.
        // Replacing an already open expansion preserves its geometry and motion.
        if !isPresented {
            contentMotion = motion.resolved(hasVisiblePeek: hasVisiblePeek)
        }
        sessionID = UUID()
        isPreparing = true
        isPresented = false
    }

    /// Only the mounted, active expansion may change its measured height or reveal it.
    func acceptsMeasurement(sessionID: UUID) -> Bool {
        self.sessionID == sessionID && (isPreparing || isPresented)
    }

    mutating func reveal(sessionID: UUID) {
        guard isPreparing, self.sessionID == sessionID else { return }
        isPreparing = false
        isPresented = true
    }

    func motion(isCompactPresented: Bool) -> PeekContentMotion {
        isClosing && isCompactPresented ? .pushFromBottom : contentMotion
    }

    mutating func beginClosing() {
        isPreparing = false
        isPresented = false
    }

    mutating func finishClosing(sessionID: UUID) {
        guard isClosing, self.sessionID == sessionID else { return }
        self.sessionID = nil
    }

    mutating func dismissForFocusChange() {
        isPreparing = false
        isPresented = false
        sessionID = nil
    }
}

/// Adding content under an existing peek pushes it upward; the first peek is
/// revealed in place. Callers can override the automatic choice for a specific surface.
nonisolated enum PeekContentMotion {
    case automatic
    case stationaryReveal
    case pushFromBottom

    func resolved(hasVisiblePeek: Bool) -> Self {
        self == .automatic ? (hasVisiblePeek ? .pushFromBottom : .stationaryReveal) : self
    }

}
