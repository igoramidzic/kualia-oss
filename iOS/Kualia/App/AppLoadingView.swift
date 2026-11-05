import SwiftUI
import UIKit

/// A standalone launch screen. The workspace mounts only after its data is ready.
struct AppLoadingView: View {
    var message: String?
    var onRetry: () -> Void = {}

    var body: some View {
        AppLoadingBird()
            .frame(width: 96, height: 96)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Kualia")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .bottom) {
                if let message {
                    VStack(spacing: 12) {
                        Text(message)
                            .font(.subheadline)
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .multilineTextAlignment(.center)
                        Button(L10n.string("Try again"), action: onRetry)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(KualiaPalette.ink)
                            .buttonStyle(.kualiaHaptic)
                            .frame(minHeight: 44)
                    }
                    .padding(24)
                }
            }
            .background(KualiaPalette.canvas.ignoresSafeArea())
            .accessibilityIdentifier("app.loading")
    }
}

private struct AppLoadingBird: View {
    var body: some View {
        let dots = AppLoadingBirdPattern.dots
        Canvas { context, size in
            let diameter =
                min(size.width, size.height)
                / CGFloat(AppLoadingBirdPattern.columns) * 0.56
            for dot in dots {
                let rect = CGRect(
                    x: dot.x * size.width - diameter / 2,
                    y: dot.y * size.height - diameter / 2,
                    width: diameter, height: diameter)
                context.fill(
                    Path(ellipseIn: rect),
                    with: .color(KualiaPalette.ink.opacity(0.12)))
            }
        }
    }
}

enum AppLoadingBirdPattern {
    static let columns = 32

    // Sample the official vector asset once. Every dot stays a complete circle,
    // with the bird's eye and the spaces between its wings preserved.
    static let dots: [CGPoint] = {
        guard let mark = UIImage(named: "KualiaMark") else { return [] }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let size = CGSize(width: columns, height: columns)
        let scale = min(size.width / mark.size.width, size.height / mark.size.height)
        let markSize = CGSize(width: mark.size.width * scale, height: mark.size.height * scale)
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            mark.draw(
                in: CGRect(
                    x: (size.width - markSize.width) / 2,
                    y: (size.height - markSize.height) / 2,
                    width: markSize.width, height: markSize.height))
        }
        guard let image = rendered.cgImage else { return [] }
        var pixels = [UInt8](repeating: 0, count: columns * columns * 4)
        let didDraw = pixels.withUnsafeMutableBytes { buffer in
            guard
                let context = CGContext(
                    data: buffer.baseAddress, width: columns, height: columns,
                    bitsPerComponent: 8, bytesPerRow: columns * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                        | CGBitmapInfo.byteOrder32Big.rawValue)
            else { return false }
            context.draw(image, in: CGRect(origin: .zero, size: size))
            return true
        }
        guard didDraw else { return [] }
        return (0..<columns).flatMap { row in
            (0..<columns).compactMap { column -> CGPoint? in
                guard pixels[(row * columns + column) * 4 + 3] >= 128 else { return nil }
                return CGPoint(
                    x: (CGFloat(column) + 0.5) / CGFloat(columns),
                    y: (CGFloat(row) + 0.5) / CGFloat(columns))
            }
        }
    }()
}

struct WorkspaceTransitionPeek: View {
    let name: String?
    let page: HomePage
    let readiness: PageReadiness
    let onRetry: () -> Void
    var onCancel: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                if case .failed = readiness {
                    KualiaIconImage(icon: .wifiOff, size: 18)
                } else {
                    ProgressView()
                        .tint(KualiaPalette.peekInk)
                        .accessibilityHidden(true)
                }
                Text(
                    name.map { L10n.string("Switching to \($0)") }
                        ?? L10n.string("Opening \(page.title)")
                )
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if case .failed(let message) = readiness {
                Text(message).font(.subheadline).foregroundStyle(KualiaPalette.peekMutedInk)
                HStack(spacing: 24) {
                    Button(L10n.string("Try again"), action: onRetry)
                    if let onCancel { Button(L10n.string("Go back"), action: onCancel) }
                }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.kualiaHaptic)
                .frame(minHeight: 44)
            }
        }
        .foregroundStyle(KualiaPalette.peekInk)
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .frame(minHeight: 68)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.workspaceTransition")
    }
}
