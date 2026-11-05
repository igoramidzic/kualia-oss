import SwiftUI

/// Use a small, fixed fade only at edges with more content beyond them.
struct HorizontalFilterFade: Equatable {
    var leading: CGFloat = 0
    var trailing: CGFloat = 0

    init(
        offset: CGFloat = 0, contentWidth: CGFloat = 0, viewportWidth: CGFloat = 0,
        leadingInset: CGFloat = 0, trailingInset: CGFloat = 0
    ) {
        guard viewportWidth > 0,
            contentWidth + leadingInset + trailingInset > viewportWidth + 1
        else { return }
        let width = min(12, viewportWidth / 2)
        leading = offset + leadingInset > 1 ? width : 0
        trailing = contentWidth + trailingInset - offset - viewportWidth > 1 ? width : 0
    }
}

/// An alpha-only edge treatment shared by horizontal filter and choice strips.
struct HorizontalFilterScrollEdges: ViewModifier {
    var horizontalInset: CGFloat = 0
    @State private var fade = HorizontalFilterFade()

    // Ease into both transparency and full opacity without a visible seam.
    private var edgeGradient: Gradient {
        Gradient(
            stops: (0...8).map { step in
                let progress = Double(step) / 8
                let opacity = progress * progress * (3 - 2 * progress)
                return .init(color: .black.opacity(opacity), location: CGFloat(progress))
            })
    }

    func body(content: Content) -> some View {
        content
            .contentMargins(.vertical, 2)
            .contentMargins(.horizontal, horizontalInset, for: .scrollContent)
            .kualiaScrollEdgeEffectHidden(true, for: .horizontal)
            .onScrollGeometryChange(for: HorizontalFilterFade.self) { geometry in
                HorizontalFilterFade(
                    offset: geometry.contentOffset.x,
                    contentWidth: geometry.contentSize.width,
                    viewportWidth: geometry.containerSize.width,
                    leadingInset: geometry.contentInsets.leading,
                    trailingInset: geometry.contentInsets.trailing)
            } action: { _, fade in
                self.fade = fade
            }
            .mask {
                HStack(spacing: 0) {
                    LinearGradient(
                        gradient: edgeGradient, startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: fade.leading)
                    // Mask colors only supply alpha; never inherit the chip's foreground style.
                    Color.black
                    LinearGradient(
                        gradient: edgeGradient, startPoint: .trailing, endPoint: .leading
                    )
                    .frame(width: fade.trailing)
                }
            }
            .padding(.horizontal, -horizontalInset)
    }
}

/// Dock labels read from top to bottom; badges and accessibility text remain upright.
struct HomeFilterLabel: View {
    let title: String
    @Environment(\.homeFiltersAreVertical) private var isVertical

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        if isVertical {
            VerticalFilterLabelLayout {
                Text(title)
                    .fixedSize()
                    .rotationEffect(.degrees(90))
            }
        } else {
            Text(title)
        }
    }
}

/// Rotation alone keeps the original layout bounds, so reserve the rotated dimensions.
private struct VerticalFilterLabelLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let label = subviews.first else { return .zero }
        let size = label.sizeThatFits(.unspecified)
        return CGSize(width: size.height, height: size.width)
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        subviews.first?.place(
            at: CGPoint(x: bounds.midX, y: bounds.midY), anchor: .center, proposal: .unspecified)
    }
}

/// Compact filter appearance with a full-height touch target outside the capsule.
struct FilterChipStyle: ViewModifier {
    @Environment(\.homeFiltersAreVertical) private var isVertical
    let background: Color
    var horizontalPadding: CGFloat = 17
    @ScaledMetric(relativeTo: .footnote) private var fontSize: CGFloat = 14

    func body(content: Content) -> some View {
        content
            .font(.system(size: fontSize, weight: .semibold))
            .multilineTextAlignment(isVertical ? .center : .leading)
            .fixedSize(horizontal: false, vertical: isVertical)
            .padding(.horizontal, isVertical ? 6 : horizontalPadding)
            .padding(.vertical, isVertical ? 12 : 6)
            .frame(minWidth: isVertical ? 44 : nil, minHeight: isVertical ? 44 : 36)
            .background(background, in: RoundedRectangle(cornerRadius: isVertical ? 18 : 100))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }
}

struct HomeFilterOptions<Content: View>: View {
    @Environment(\.homeFiltersAreVertical) private var isVertical
    @ViewBuilder var content: () -> Content

    var body: some View {
        let layout =
            isVertical
            ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout { content() }
    }
}

/// Soften a bounded dock only where more controls can be scrolled into view.
/// Navigation sits outside this viewport, so it needs no overlapping blur effect.
struct VerticalFilterScrollEdges: ViewModifier {
    @State private var overflow: Edge.Set = []

    func body(content: Content) -> some View {
        content
            .scrollClipDisabled(false)
            .kualiaScrollEdgeEffectHidden(true, for: .vertical)
            .onScrollGeometryChange(for: Edge.Set.self) { geometry in
                var edges: Edge.Set = []
                if geometry.contentOffset.y + geometry.contentInsets.top > 1 {
                    edges.insert(.top)
                }
                if geometry.contentSize.height + geometry.contentInsets.bottom
                    - geometry.contentOffset.y > geometry.containerSize.height + 1
                {
                    edges.insert(.bottom)
                }
                return edges
            } action: { _, edges in
                overflow = edges
            }
            .mask {
                VStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                        .frame(height: overflow.contains(.top) ? 16 : 0)
                    Color.black
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: overflow.contains(.bottom) ? 16 : 0)
                }
            }
    }
}

/// Counts stay compact and widen into a pill without increasing the filter row height.
struct FilterCountBadge: View {
    let count: Int
    @ScaledMetric(relativeTo: .caption2) private var minimumSide: CGFloat = 20
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(count.formatted(.number.locale(L10n.locale)))
            .font(.caption2.weight(.semibold))
            .monospacedDigit()
            .contentTransition(reduceMotion ? .identity : .numericText())
            .fixedSize()
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .frame(minWidth: minimumSide, minHeight: minimumSide)
            .foregroundStyle(KualiaPalette.ink)
            .background(Color(uiColor: .secondarySystemBackground), in: Capsule())
    }
}
