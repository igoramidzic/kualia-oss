import SwiftUI

extension View {
    @ViewBuilder
    func kualiaNavigationTitle(_ title: String, subtitle: String) -> some View {
        if #available(iOS 26.0, *) {
            navigationTitle(title).navigationSubtitle(subtitle)
        } else {
            navigationTitle(title)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 2) {
                            Text(title).font(.headline).lineLimit(1)
                            if !subtitle.isEmpty {
                                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(
                                    1)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isHeader)
                    }
                }
        }
    }

    @ViewBuilder
    func kualiaBottomCorners(minimum radius: CGFloat) -> some View {
        kualiaBottomCorners(leadingMinimum: radius, trailingMinimum: radius)
    }

    @ViewBuilder
    func kualiaBottomCorners(leadingMinimum: CGFloat, trailingMinimum: CGFloat) -> some View {
        if #available(iOS 26.0, *) {
            clipShape(
                ConcentricRectangle(
                    topLeadingCorner: .fixed(0), topTrailingCorner: .fixed(0),
                    bottomLeadingCorner: .concentric(minimum: .fixed(leadingMinimum)),
                    bottomTrailingCorner: .concentric(minimum: .fixed(trailingMinimum))
                )
            )
        } else {
            clipShape(
                UnevenRoundedRectangle(
                    bottomLeadingRadius: leadingMinimum, bottomTrailingRadius: trailingMinimum)
            )
        }
    }

    /// Preserve bar layout and scroll insets on iOS 18; iOS 26 also supplies edge effects.
    @ViewBuilder
    func kualiaSafeAreaBar<Content: View>(
        edge: VerticalEdge,
        alignment: HorizontalAlignment = .center,
        spacing: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if #available(iOS 26.0, *) {
            safeAreaBar(edge: edge, alignment: alignment, spacing: spacing, content: content)
        } else {
            safeAreaInset(edge: edge, alignment: alignment, spacing: spacing, content: content)
        }
    }

    /// Adopt the clearer system edge on iOS 27; retain the iOS 26 appearance.
    /// Automatic has its own visuals on iOS 27 and follows system preferences.
    @ViewBuilder
    func kualiaScrollEdges(for edges: Edge.Set) -> some View {
        if #available(iOS 27.0, *) {
            scrollEdgeEffectStyle(.automatic, for: edges)
        } else if #available(iOS 26.0, *) {
            scrollEdgeEffectStyle(.soft, for: edges)
        } else {
            self
        }
    }

    @ViewBuilder
    func kualiaScrollEdgeEffectHidden(_ hidden: Bool = true, for edges: Edge.Set = .all)
        -> some View
    {
        if #available(iOS 26.0, *) {
            scrollEdgeEffectHidden(hidden, for: edges)
        } else {
            self
        }
    }

    func kualiaControlGlass(in shape: some Shape) -> some View {
        modifier(KualiaControlGlass(shape: shape))
    }

    /// Apply to a visible toolbar after padding, never to the clear inset spacers
    /// inside retained pages. iOS 26 supplies its own scroll-edge backdrop.
    func kualiaToolbarBackground() -> some View {
        modifier(KualiaToolbarBackground())
    }

    @ViewBuilder
    func kualiaGlassIdentityTransition() -> some View {
        if #available(iOS 26.0, *) {
            glassEffectTransition(.identity)
        } else {
            self
        }
    }
}

private struct KualiaToolbarBackground: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        content.background {
            if #unavailable(iOS 26.0) {
                if reduceTransparency {
                    Rectangle().fill(KualiaPalette.canvas)
                } else {
                    Rectangle().fill(.regularMaterial)
                }
            }
        }
    }
}

private struct KualiaControlGlass<S: Shape>: ViewModifier {
    let shape: S
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(KualiaPalette.controlGlass, in: shape)
        } else if reduceTransparency {
            content.background(KualiaPalette.surface, in: shape)
        } else {
            content.background(.regularMaterial, in: shape)
        }
    }
}
