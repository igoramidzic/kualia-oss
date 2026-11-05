import SwiftUI

struct HomeBackground: View {
    let page: HomePage
    var scrollState: HomeGlowScrollState? = nil

    var body: some View {
        page.background
            .overlay {
                if page != .home && page != .reports {
                    GeometryReader { geometry in
                        let glowHeight = geometry.size.height * 0.3
                        Ellipse()
                            .fill(page.glow.opacity(0.24))
                            .frame(width: geometry.size.width * 1.2, height: glowHeight * 1.3)
                            .blur(radius: glowHeight * 0.2)
                            .position(x: geometry.size.width * 0.5, y: glowHeight * 0.1)
                            .mask(alignment: .top) {
                                LinearGradient(
                                    stops: [
                                        .init(color: .white, location: 0),
                                        .init(color: .white, location: 0.45),
                                        .init(color: .clear, location: 1),
                                    ],
                                    startPoint: .top, endPoint: .bottom
                                )
                                .frame(height: glowHeight)
                            }
                    }
                    .offset(y: -(scrollState?.offset(for: page) ?? 0))
                }
            }
            .clipped()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Only the background observes these offsets, keeping scrolling out of the home shell's updates.
@MainActor
@Observable
final class HomeGlowScrollState {
    private var offsets: [HomePage: CGFloat] = [:]

    func offset(for page: HomePage) -> CGFloat { offsets[page] ?? 0 }

    func update(_ offset: CGFloat, for page: HomePage) {
        let value = max(0, offset)
        guard value != self.offset(for: page) else { return }
        offsets[page] = value
    }
}

/// Keep the inherited reporting value equal across shell/menu updates. A fresh
/// closure here changes the environment of every retained page's descendants.
struct HomeGlowScrollReporting: Equatable {
    let state: HomeGlowScrollState?
    let page: HomePage

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.state === rhs.state && lhs.page == rhs.page
    }

    func report(_ offset: CGFloat) {
        state?.update(offset, for: page)
    }
}

extension EnvironmentValues {
    @Entry var homeGlowScrollReporting: HomeGlowScrollReporting? = nil
}

struct HomeGlowScrollObserver: ViewModifier {
    var isEnabled = true
    @Environment(\.homeGlowScrollReporting) private var reporting
    @State private var offset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                max(0, geometry.contentOffset.y + geometry.contentInsets.top)
            } action: { _, value in
                offset = value
                if isEnabled { reporting?.report(value) }
            }
            .onChange(of: isEnabled, initial: true) { _, enabled in
                if enabled { reporting?.report(offset) }
            }
    }
}
