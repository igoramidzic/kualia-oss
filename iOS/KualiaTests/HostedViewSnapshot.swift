import SwiftUI
import Testing
import UIKit

/// ImageRenderer does not draw every UIKit-backed SwiftUI scrolling view. Mount
/// snapshot subjects in a real hierarchy so lazy rows and scroll content participate.
@MainActor
enum HostedViewSnapshot {
    private static var isCapturing = false

    static func image<Content: View>(
        of content: Content, size: CGSize, scale: CGFloat = 2,
        animationSampleCount: Int = 0,
        minimumChannelRange: Int = 40,
        onAnimationSample: (UIView) -> Void = { _ in },
        inspect: (UIView) -> Void = { _ in }
    ) async throws -> UIImage {
        // Snapshot suites can interleave at suspension points on the main actor.
        while isCapturing {
            try Task.checkCancellation()
            await Task.yield()
        }
        isCapturing = true
        defer { isCapturing = false }

        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let controller = UIHostingController(
            rootView:
                content
                .frame(width: size.width, height: size.height)
                .transaction { $0.disablesAnimations = animationSampleCount == 0 }
        )
        controller.safeAreaRegions = []
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = controller
        // Visibility attaches the hierarchy without stealing keyboard/first-responder focus.
        window.isHidden = false
        defer {
            window.isHidden = true
            window.rootViewController = nil
            if let previousKeyWindow, !previousKeyWindow.isHidden,
                !previousKeyWindow.isKeyWindow
            {
                previousKeyWindow.makeKey()
            }
        }

        for _ in 0..<(animationSampleCount > 0 ? animationSampleCount : 3) {
            window.layoutIfNeeded()
            controller.view.layoutIfNeeded()
            if animationSampleCount > 0 { onAnimationSample(controller.view) }
            await Task.yield()
            try await Task.sleep(for: .milliseconds(animationSampleCount > 0 ? 16 : 50))
        }
        controller.view.layoutIfNeeded()
        inspect(controller.view)
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        let bounds = CGRect(origin: .zero, size: size)
        var renderedHierarchy = false
        let image = UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
            renderedHierarchy = controller.view.drawHierarchy(in: bounds, afterScreenUpdates: true)
        }
        try #require(renderedHierarchy, "The hosted view hierarchy did not finish drawing.")
        try requireVisibleContent(image, minimumChannelRange: minimumChannelRange)
        return image
    }

    private static func requireVisibleContent(_ image: UIImage, minimumChannelRange: Int) throws {
        let cgImage = try #require(image.cgImage)
        let sampleSize = 64
        var pixels = [UInt8](repeating: 0, count: sampleSize * sampleSize * 4)
        try pixels.withUnsafeMutableBytes { buffer in
            let context = try #require(
                CGContext(
                    data: buffer.baseAddress, width: sampleSize, height: sampleSize,
                    bitsPerComponent: 8, bytesPerRow: sampleSize * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                )
            )
            context.draw(
                cgImage, in: CGRect(x: 0, y: 0, width: sampleSize, height: sampleSize)
            )
        }
        let channelRanges = (0..<3).map { channel in
            let values = stride(from: channel, to: pixels.count, by: 4).map { pixels[$0] }
            return Int(values.max() ?? 0) - Int(values.min() ?? 0)
        }
        try #require(
            (channelRanges.max() ?? 0) > minimumChannelRange,
            "Snapshot contains only a blank or nearly uniform background."
        )
    }
}
