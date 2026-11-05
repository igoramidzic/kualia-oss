import SwiftUI

struct PeekPersistentSide {
    let edge: HorizontalEdge
    let width: CGFloat
}

extension EnvironmentValues {
    /// A full-height foreground uses this inset for its resizable content pane.
    @Entry var peekContentBottomInset: CGFloat = 0
}

/// A page or sheet in front of two reusable slots: a compact peek and an optional
/// expansion below it. Content is mounted at its destination before a curtain
/// reveal; adding an expansion to an existing peek pushes the whole back layer.
/// Only native frame, offset, and mask modifiers animate. The page layout
/// receives destinations, never a stream of animation samples.
struct PeekContainer<Foreground: View, Expansion: View, Compact: View>: View {
    let presentation: PeekPresentation
    let expansionHeight: CGFloat
    let isCompactPresented: Bool
    let compactHeight: CGFloat
    let animation: Animation?
    let compactAlignment: Alignment
    let maximumHeightFraction: CGFloat
    let bottomCornerRadius: CGFloat
    let foregroundBottomCornerRadius: CGFloat
    let foregroundColor: Color
    let expansionColor: Color
    let persistentSide: PeekPersistentSide?
    let foreground: Foreground
    let expansion: Expansion
    let compact: Compact

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        presentation: PeekPresentation = .init(), expansionHeight: CGFloat = 0,
        isCompactPresented: Bool = false, compactHeight: CGFloat = 0,
        animation: Animation? = nil, compactAlignment: Alignment = .center,
        maximumHeightFraction: CGFloat = 0.62, bottomCornerRadius: CGFloat = 34,
        foregroundBottomCornerRadius: CGFloat? = nil,
        foregroundColor: Color = KualiaPalette.canvas,
        expansionColor: Color = KualiaPalette.peekBackground,
        persistentSide: PeekPersistentSide? = nil,
        @ViewBuilder foreground: () -> Foreground,
        @ViewBuilder expansion: () -> Expansion = { EmptyView() },
        @ViewBuilder compact: () -> Compact = { EmptyView() }
    ) {
        self.presentation = presentation
        self.expansionHeight = expansionHeight
        self.isCompactPresented = isCompactPresented
        self.compactHeight = compactHeight
        self.animation = animation
        self.compactAlignment = compactAlignment
        self.maximumHeightFraction = maximumHeightFraction
        self.bottomCornerRadius = bottomCornerRadius
        self.foregroundBottomCornerRadius = foregroundBottomCornerRadius ?? bottomCornerRadius
        self.foregroundColor = foregroundColor
        self.expansionColor = expansionColor
        self.persistentSide = persistentSide
        self.foreground = foreground()
        self.expansion = expansion()
        self.compact = compact()
    }

    var body: some View {
        GeometryReader { geometry in
            let layout = PeekLayout(
                containerHeight: geometry.size.height,
                expansionHeight: presentation.sessionID == nil ? 0 : expansionHeight,
                isPresented: presentation.isPresented, isCompactPresented: isCompactPresented,
                compactHeight: compactHeight, maximumHeightFraction: maximumHeightFraction)
            let motion = presentation.motion(isCompactPresented: isCompactPresented)
            let sideWidth = min(max(0, persistentSide?.width ?? 0), geometry.size.width)
            let keepsSideVisible = sideWidth > 0

            ZStack(alignment: .top) {
                presentation.sessionID == nil ? foregroundColor : expansionColor

                // Both slots keep their content sizes and share one translation.
                // Their native offset also retains the current position on interruption.
                VStack(spacing: 0) {
                    compact
                        .frame(maxWidth: .infinity)
                        .frame(height: layout.compactContentHeight, alignment: compactAlignment)
                        .background(foregroundColor)
                        .clipped()
                        .allowsHitTesting(isCompactPresented && !presentation.isPreparing)
                        .accessibilityHidden(!isCompactPresented || presentation.isPreparing)
                    if let sessionID = presentation.sessionID {
                        expansion
                            .id(sessionID)
                            .frame(maxWidth: .infinity)
                            .frame(height: layout.expansionHeight)
                            .background(expansionColor)
                            .clipped()
                            .allowsHitTesting(presentation.isPresented)
                            .accessibilityHidden(!presentation.isPresented)
                            .transition(.identity)
                    }
                }
                .frame(
                    height: layout.compactContentHeight + layout.expansionHeight,
                    alignment: .top
                )
                // Isolate local numeric/button animations inside the moving slots.
                .geometryGroup()
                .offset(y: layout.compactTop(motion: motion))
                .frame(
                    width: geometry.size.width - sideWidth, height: layout.height, alignment: .top
                )
                .mask(alignment: .bottom) {
                    Rectangle().frame(height: layout.visibleBackHeight)
                }
                .contentShape(.interaction, Rectangle().offset(y: layout.foregroundHeight))
                .padding(persistentSide?.edge == .leading ? .leading : .trailing, sideWidth)
                // Cover only the main pane. The side controls keep their original
                // hosting tree, full height, and hit testing throughout the reveal.
                .zIndex(keepsSideVisible ? 1 : 0)

                foreground
                    .environment(
                        \.peekContentBottomInset, keepsSideVisible ? layout.visibleBackHeight : 0
                    )
                    .frame(maxWidth: .infinity)
                    .frame(height: keepsSideVisible ? layout.height : layout.foregroundHeight)
                    .background(foregroundColor)
                    .clipShape(
                        UnevenRoundedRectangle(
                            bottomLeadingRadius: foregroundBottomCornerRadius,
                            bottomTrailingRadius: foregroundBottomCornerRadius))
            }
            .frame(width: geometry.size.width, height: layout.height)
            .clipShape(
                UnevenRoundedRectangle(
                    bottomLeadingRadius: bottomCornerRadius,
                    bottomTrailingRadius: bottomCornerRadius))
        }
        .modifier(
            PeekCompactAnimation(
                isPresented: isCompactPresented, height: compactHeight,
                hasExpansion: presentation.sessionID != nil,
                animation: reduceMotion ? nil : animation)
        )
        .transaction { if reduceMotion { $0.animation = nil } }
    }

}

/// Changing expansion sessions must not change an implicit-animation key to nil:
/// `.animation(nil, value: ...)` would erase the caller's opening transaction.
struct PeekCompactAnimation: ViewModifier {
    let isPresented: Bool
    let height: CGFloat
    let hasExpansion: Bool
    let animation: Animation?

    func body(content: Content) -> some View {
        content.transaction(
            value: PeekCompactAnimationState(isPresented: isPresented, height: height), update)
    }

    func update(_ transaction: inout Transaction) {
        guard !hasExpansion, !transaction.disablesAnimations, let animation else { return }
        transaction.animation = animation
    }
}
