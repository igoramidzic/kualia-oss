import SwiftUI

/// Install inside a ScrollView's content. Forward touch-down to its buttons
/// immediately while retaining the scroll view's normal drag cancellation.
/// This is scoped to that scroll view; no appearance proxy or gesture replacement.
struct ImmediateScrollTouches: UIViewRepresentable {
    func makeUIView(context: Context) -> Probe { Probe() }
    func updateUIView(_ view: Probe, context: Context) { view.connect() }
    static func dismantleUIView(_ view: Probe, coordinator: ()) { view.restore() }

    final class Probe: UIView {
        private weak var scrollView: UIScrollView?
        private var originalDelay = true

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            isAccessibilityElement = false
        }

        required init?(coder: NSCoder) { nil }

        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            connect()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            connect()
        }

        func connect() {
            var ancestor = superview
            while let view = ancestor {
                if let scroll = view as? UIScrollView {
                    guard scrollView !== scroll else { return }
                    restore()
                    scrollView = scroll
                    originalDelay = scroll.delaysContentTouches
                    scroll.delaysContentTouches = false
                    return
                }
                ancestor = view.superview
            }
            restore()
        }

        func restore() {
            scrollView?.delaysContentTouches = originalDelay
            scrollView = nil
        }
    }
}

/// Keep native Button activation/cancellation. Feedback belongs to the action,
/// never to touch-down or an isPressed transition that can become a scroll drag.
struct KualiaHapticButtonStyle<Appearance: ButtonStyle>: PrimitiveButtonStyle {
    let appearance: Appearance

    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.7)
            configuration.trigger()
        } label: {
            configuration.label
        }
        // Reset primitive styling on the forwarding button so it cannot inherit
        // this wrapper again; the supplied ButtonStyle only owns its appearance.
        .buttonStyle(.plain)
        .buttonStyle(appearance)
    }
}

struct KualiaButtonLabelStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label }
}

extension PrimitiveButtonStyle where Self == KualiaHapticButtonStyle<KualiaButtonLabelStyle> {
    static var kualiaHaptic: Self {
        KualiaHapticButtonStyle(appearance: KualiaButtonLabelStyle())
    }
}

/// Default sheet close/cancel control: a circular X with an accessible action label.
/// Navigation toolbars supply their own glass; custom headers use a 44-point circle.
struct KualiaCloseButton: View {
    enum Placement { case toolbar, customHeader }
    var placement: Placement = .customHeader
    var label = L10n.string("Close")
    var icon: KualiaIcon = .close
    let action: () -> Void

    private var role: ButtonRole {
        if #available(iOS 26.0, *) { .close } else { .cancel }
    }

    var body: some View {
        Group {
            if placement == .toolbar {
                Button(role: role, action: action) {
                    KualiaIconImage(icon: icon, size: 18)
                }
            } else {
                Button(role: role, action: action) {
                    KualiaIconImage(icon: icon, size: 17)
                        .font(.system(size: 17, weight: .medium))
                        .frame(width: 44, height: 44)
                        .kualiaControlGlass(in: Circle())
                        .contentShape(.interaction, Rectangle())
                }
                .buttonStyle(.kualiaHaptic)
            }
        }
        .tint(KualiaPalette.ink)
        .accessibilityLabel(label)
    }
}
