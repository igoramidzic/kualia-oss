import Foundation
import SwiftUI
import Testing
import UIKit

@testable import Kualia

private struct PeekMotionRegressionView: View {
    let startsVisible: Bool
    let usesEasedMotion: Bool
    @State private var presentation = PeekPresentation()

    var body: some View {
        PeekContainer(
            presentation: presentation, expansionHeight: 240,
            isCompactPresented: startsVisible || presentation.isPresented, compactHeight: 88,
            animation: .linear(duration: 0.8),
            bottomCornerRadius: 0, foregroundColor: .white, expansionColor: .black
        ) {
            Color.white.overlay(alignment: .bottom) {
                Color(red: 1, green: 0, blue: 1).frame(height: 4)
            }
        } expansion: {
            Color.black.overlay(alignment: .top) {
                Color.green.frame(width: 12, height: 12)
                    .animation(nil, value: presentation.isPresented)
            }
        } compact: {
            HStack(spacing: 0) {
                Color.red.frame(width: 12, height: 12)
                    .frame(maxWidth: .infinity)
                    .animation(nil, value: presentation.isPresented)
                Color.blue.frame(width: 12, height: 12)
                    .frame(maxWidth: .infinity)
                    .animation(.linear(duration: 0.7), value: presentation.isPresented)
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            presentation.prepare(hasVisiblePeek: startsVisible, motion: .pushFromBottom)
            try? await Task.sleep(for: .milliseconds(50))
            guard !Task.isCancelled, let id = presentation.sessionID else { return }
            let motion: Animation =
                usesEasedMotion
                ? .easeInOut(duration: 0.3) : .linear(duration: 0.4)
            withAnimation(motion) { presentation.reveal(sessionID: id) }
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            withAnimation(motion) { presentation.beginClosing() }
        }
    }
}

private struct PeekReplacementRegressionView: View {
    let destinationHeight: CGFloat
    @State private var isLoading = true

    var body: some View {
        PeekContainer(
            presentation: PeekPresentation(), expansionHeight: 0,
            isCompactPresented: isLoading || destinationHeight > 0,
            compactHeight: isLoading ? 68 : destinationHeight,
            animation: .linear(duration: 0.4), bottomCornerRadius: 0,
            foregroundColor: .black
        ) {
            Color.red.overlay(alignment: .topLeading) {
                Color.white.frame(width: 24, height: 24)
            }
        } expansion: {
            EmptyView()
        } compact: {
            Color.blue
        }
        .task {
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            // Match workspace installation, which intentionally has no animation.
            withTransaction(Transaction(animation: nil)) { isLoading = false }
        }
    }
}

@MainActor
private final class PeekForegroundLayoutSamples {
    // Deliberately not observable: recording geometry must not invalidate the view.
    var heights: [CGFloat] = []
    var completedTransitions = 0
}

private struct PeekLayoutRegressionView: View {
    let startsVisible: Bool
    let samples: PeekForegroundLayoutSamples
    @State private var presentation = PeekPresentation()

    var body: some View {
        PeekContainer(
            presentation: presentation, expansionHeight: 240,
            isCompactPresented: startsVisible || presentation.isPresented, compactHeight: 88,
            bottomCornerRadius: 0, foregroundColor: .white, expansionColor: .black
        ) {
            Color.white
                .overlay(alignment: .topLeading) {
                    Color.black.frame(width: 24, height: 24)
                }
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    samples.heights.append($0)
                }
        } expansion: {
            Color.black
        } compact: {
            Color.blue
        }
        .task {
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            presentation.prepare(hasVisiblePeek: startsVisible)
            try? await Task.sleep(for: .milliseconds(50))
            guard !Task.isCancelled, let id = presentation.sessionID else { return }
            withAnimation(.linear(duration: 0.4)) { presentation.reveal(sessionID: id) }
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            samples.completedTransitions += 1
            withAnimation(.linear(duration: 0.4)) { presentation.beginClosing() }
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            samples.completedTransitions += 1
            presentation.finishClosing(sessionID: id)
        }
    }
}

@MainActor
struct AmountInputTests {
    @Test(arguments: [false, true])
    func openingAndClosingDoNotRelayoutTheForegroundOnEveryAnimationFrame(startsVisible: Bool)
        async throws
    {
        let samples = PeekForegroundLayoutSamples()
        _ = try await HostedViewSnapshot.image(
            of: PeekLayoutRegressionView(startsVisible: startsVisible, samples: samples),
            size: CGSize(width: 320, height: 700), animationSampleCount: 90
        )
        #expect(samples.completedTransitions == 2)
        let closedHeight: CGFloat = startsVisible ? 612 : 700
        #expect(abs(try #require(samples.heights.first) - closedHeight) < 0.5)
        #expect(samples.heights.contains { abs($0 - 372) < 0.5 })
        #expect(abs(try #require(samples.heights.last) - closedHeight) < 0.5)
        // Allow initial layout and lifecycle updates. Native frame animation should
        // report its destination, without laying out the page for every sample.
        #expect(
            samples.heights.count <= 12,
            "The foreground reported \(samples.heights.count) layout changes across two transitions."
        )
    }

    @Test(arguments: [CGFloat(0), CGFloat(34), CGFloat(68), CGFloat(254)], [false, true])
    func keypadHasNoToolbarWhileOtherPeeksKeepTheNativeBar(
        expansionHeight: CGFloat, showsKeypad: Bool
    ) throws {
        let renderer = ImageRenderer(
            content: PeekContainer(
                presentation: .init(initiallyPresented: true, hasVisiblePeek: true),
                expansionHeight: expansionHeight,
                isCompactPresented: true, compactHeight: 88,
                bottomCornerRadius: 0, foregroundColor: .black
            ) {
                Color.white.kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                    if !showsKeypad {
                        Color(red: 1, green: 0, blue: 0).frame(height: 68)
                    }
                }
            } expansion: {
                Color.black
            } compact: {
                Color.green
            }
            .frame(width: 100, height: 700))
        renderer.scale = 1
        let image = try #require(renderer.cgImage)
        var pixels = [UInt8](repeating: 0, count: 100 * 700 * 4)
        try pixels.withUnsafeMutableBytes { buffer in
            let context = try #require(
                CGContext(
                    data: buffer.baseAddress, width: 100, height: 700,
                    bitsPerComponent: 8, bytesPerRow: 400,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: 100, height: 700))
        }
        let visibleToolbarPixels = (0..<700).filter { y in
            let index = (y * 100 + 50) * 4
            return pixels[index] > 240 && pixels[index + 1] < 20 && pixels[index + 2] < 20
        }.count
        let expectedHeight = showsKeypad ? 0 : 68
        #expect(abs(visibleToolbarPixels - Int(expectedHeight)) <= 1)
    }

    @Test func expansionSessionsPreserveTheCallersAnimation() {
        let opening = Animation.linear(duration: 0.4)
        let compact = Animation.linear(duration: 0.8)
        for isPresented in [false, true] {
            var transaction = Transaction(animation: opening)
            PeekCompactAnimation(
                isPresented: isPresented, height: 88, hasExpansion: true, animation: compact
            ).update(&transaction)
            #expect(transaction.animation == opening)
        }
        var standalone = Transaction()
        PeekCompactAnimation(isPresented: true, height: 88, hasExpansion: false, animation: compact)
            .update(&standalone)
        #expect(standalone.animation == compact)
    }

    @Test func immediateScrollTouchesAreScopedAndRestoreOnRemoval() {
        let outer = UIScrollView()
        let inner = UIScrollView()
        outer.addSubview(inner)
        let probe = ImmediateScrollTouches.Probe()
        inner.addSubview(probe)
        #expect(!inner.delaysContentTouches)
        #expect(outer.delaysContentTouches)
        #expect(inner.canCancelContentTouches)
        probe.removeFromSuperview()
        #expect(inner.delaysContentTouches)
        outer.delaysContentTouches = false
        outer.addSubview(probe)
        probe.removeFromSuperview()
        #expect(!outer.delaysContentTouches)
    }

    @Test(arguments: [CGFloat(0), CGFloat(140)])
    func peekReplacementAnimatesClosingAndExpansion(destinationHeight: CGFloat) async throws {
        var boundaries: [Int] = []
        _ = try await HostedViewSnapshot.image(
            of: PeekReplacementRegressionView(destinationHeight: destinationHeight),
            size: CGSize(width: 320, height: 700), animationSampleCount: 60,
            onAnimationSample: { view in
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                let image = UIGraphicsImageRenderer(size: view.bounds.size, format: format).image {
                    _ in view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)
                }
                guard let bitmap = image.cgImage else { return }
                var pixels = [UInt8](repeating: 0, count: 320 * 700 * 4)
                pixels.withUnsafeMutableBytes { buffer in
                    guard
                        let context = CGContext(
                            data: buffer.baseAddress, width: 320, height: 700,
                            bitsPerComponent: 8, bytesPerRow: 320 * 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                        )
                    else { return }
                    context.translateBy(x: 0, y: 700)
                    context.scaleBy(x: 1, y: -1)
                    context.draw(bitmap, in: CGRect(x: 0, y: 0, width: 320, height: 700))
                }
                let boundary =
                    (0..<700).first { y in
                        let index = (y * 320 + 160) * 4
                        return pixels[index] < 220 || pixels[index + 1] > 30
                    } ?? 700
                boundaries.append(boundary)
            })
        let destination = 700 - Int(destinationHeight)
        #expect(boundaries.contains { abs($0 - 632) <= 1 })
        #expect(abs((boundaries.last ?? 0) - destination) <= 1)
        let intermediate = Set(
            boundaries.filter {
                $0 > min(632, destination) + 2 && $0 < max(632, destination) - 2
            })
        #expect(intermediate.count > 3, "The peek must resize through intermediate frames.")
    }

    @Test
    func drawerLayoutPrecalculatesTheFinalPeekBoundary() {
        let closed = PeekLayout(
            containerHeight: 700, expansionHeight: 254, isPresented: false,
            isCompactPresented: true, compactHeight: 88)
        let opened = PeekLayout(
            containerHeight: 700, expansionHeight: 254, isPresented: true,
            isCompactPresented: true, compactHeight: 88)
        #expect(closed.foregroundHeight == 612)
        #expect(opened.foregroundHeight == 358)
        #expect(closed.foregroundHeight - opened.foregroundHeight == opened.expansionHeight)

        let compact = PeekLayout(
            containerHeight: 400, expansionHeight: 999, isPresented: true,
            isCompactPresented: true, compactHeight: 999)
        #expect(compact.expansionHeight == 248)
        #expect(compact.visibleCompactHeight == 152)
        #expect(compact.foregroundHeight == 0)
        let empty = PeekLayout(
            containerHeight: -1, expansionHeight: -1, isPresented: true,
            isCompactPresented: true, compactHeight: -1)
        #expect(empty.foregroundHeight == 0)
    }

    @Test(arguments: [false, true])
    func drawerUsesTheCorrectPositionBeforeOpeningAndWhileClosing(hasVisiblePeek: Bool) async throws
    {
        for height: CGFloat in [700, 300] {
            var prepared = PeekPresentation()
            prepared.prepare(hasVisiblePeek: hasVisiblePeek)
            var opened = prepared
            opened.reveal(sessionID: try #require(prepared.sessionID))
            var closing = opened
            closing.beginClosing()
            for presentation in [prepared, opened, closing] {
                var drawerFrame = CGRect.zero
                var foregroundHeight: CGFloat = 0
                var undoFrame = CGRect.zero
                _ = try await HostedViewSnapshot.image(
                    of: PeekContainer(
                        presentation: presentation, expansionHeight: 240
                    ) {
                        Color.white
                            .overlay { Text("Budget").foregroundStyle(.black) }
                            .onGeometryChange(for: CGFloat.self) {
                                $0.size.height
                            } action: {
                                foregroundHeight = $0
                            }
                    } expansion: {
                        HStack {
                            Text("Dining out")
                            Spacer()
                            Button("Undo") {}
                                .frame(width: 60, height: 44)
                                .onGeometryChange(for: CGRect.self) {
                                    $0.frame(in: .named("drawer-test"))
                                } action: {
                                    undoFrame = $0
                                }
                        }
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .onGeometryChange(for: CGRect.self) {
                            $0.frame(in: .named("drawer-test"))
                        } action: {
                            drawerFrame = $0
                        }
                    }
                    .coordinateSpace(name: "drawer-test"),
                    size: CGSize(width: 320, height: height)
                )
                let reservedHeight = min(240, height * 0.62)
                let expectedDrawerBottom =
                    height
                    + (hasVisiblePeek && !presentation.isPresented ? reservedHeight : 0)
                #expect(abs(drawerFrame.maxY - expectedDrawerBottom) < 0.5)
                #expect(abs(drawerFrame.height - reservedHeight) < 0.5)
                #expect(abs(undoFrame.maxY - expectedDrawerBottom) < 0.5)
                #expect(abs(undoFrame.height - 44) < 0.5)
                let expectedForegroundHeight =
                    height - (presentation.isPresented ? reservedHeight : 0)
                #expect(abs(foregroundHeight - expectedForegroundHeight) < 0.5)
            }
        }
    }

    @Test(arguments: [true, false], [true, false])
    func peekDescendantsShareTheDrawerMotionDespiteLocalAnimations(
        startsVisible: Bool, usesEasedMotion: Bool
    ) async throws {
        var samples: [(CGFloat, CGFloat, CGFloat, CGFloat)] = []
        var missingPeekSamples = 0
        _ = try await HostedViewSnapshot.image(
            of: PeekMotionRegressionView(
                startsVisible: startsVisible, usesEasedMotion: usesEasedMotion),
            size: CGSize(width: 320, height: 700),
            animationSampleCount: 80,
            onAnimationSample: { view in
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                let image = UIGraphicsImageRenderer(size: view.bounds.size, format: format).image {
                    _ in view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)
                }
                guard let bitmap = image.cgImage else { return }
                var pixels = [UInt8](repeating: 0, count: 320 * 700 * 4)
                pixels.withUnsafeMutableBytes { buffer in
                    guard
                        let context = CGContext(
                            data: buffer.baseAddress, width: 320, height: 700,
                            bitsPerComponent: 8, bytesPerRow: 320 * 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                        )
                    else { return }
                    context.translateBy(x: 0, y: 700)
                    context.scaleBy(x: 1, y: -1)
                    context.draw(bitmap, in: CGRect(x: 0, y: 0, width: 320, height: 700))
                }
                let redRows = (0..<700).filter { y in
                    let index = (y * 320 + 80) * 4
                    return pixels[index] > 220 && pixels[index + 1] < 30
                        && pixels[index + 2] < 30
                }
                let blueRows = (0..<700).filter { y in
                    let index = (y * 320 + 240) * 4
                    return pixels[index + 2] > 220 && pixels[index] < 30
                        && pixels[index + 1] < 30
                }
                let greenRows = (0..<700).filter { y in
                    let index = (y * 320 + 160) * 4
                    return pixels[index + 1] > 180 && pixels[index] < 100
                        && pixels[index + 2] < 100
                }
                let edgeRows = (0..<700).filter { y in
                    let index = (y * 320 + 10) * 4
                    return pixels[index] > 220 && pixels[index + 1] < 30
                        && pixels[index + 2] > 220
                }
                if startsVisible, !edgeRows.isEmpty, !greenRows.isEmpty,
                    redRows.isEmpty || blueRows.isEmpty
                {
                    missingPeekSamples += 1
                }
                if let red = redRows.first, let blue = blueRows.first,
                    let green = greenRows.first, let edge = edgeRows.first
                {
                    samples.append((CGFloat(red), CGFloat(blue), CGFloat(green), CGFloat(edge)))
                }
            })
        // Inspect rendered positions, not geometry callbacks reporting destination frames.
        // Both independently animated descendants must stay on the same baseline.
        #expect(samples.count > 20)
        #expect(missingPeekSamples == 0)
        if startsVisible {
            // The 12pt marker sits 38pt inside the 88pt peek, immediately after
            // the page's 4pt edge marker. It must never slide behind that edge.
            #expect(samples.allSatisfy { abs($0.0 - $0.3 - 42) <= 1 })
        }
        #expect(samples.allSatisfy { abs($0.0 - $0.1) <= 1 })
        // The peek marker is centered in 88 points; the drawer marker starts at its top.
        #expect(samples.allSatisfy { abs($0.2 - $0.0 - 50) <= 1 })
        let positions = samples.map(\.0)
        #expect(positions.contains { $0 > 460 && $0 < 580 })
        #expect((positions.max() ?? 0) - (positions.min() ?? 0) > 200)
    }

    @Test(arguments: [PeekContentMotion.stationaryReveal, .pushFromBottom])
    func peekContentStaysClippedBetweenThePageAndKeypadAsItsSpaceOpens(
        contentMotion: PeekContentMotion
    ) async throws {
        var presentation = PeekPresentation()
        presentation.open(motion: contentMotion)
        let keypadColor = Color(red: 0, green: 0, blue: 1)
        let peekColor = Color(red: 1, green: 0, blue: 0)
        for peekHeight: CGFloat in [0, 17, 34, 68] {
            let image = try await HostedViewSnapshot.image(
                of: PeekContainer(
                    presentation: presentation, expansionHeight: 240,
                    isCompactPresented: true, compactHeight: peekHeight,
                    bottomCornerRadius: 0, foregroundColor: .white, expansionColor: keypadColor
                ) {
                    Color.white
                } expansion: {
                    keypadColor
                } compact: {
                    // Deliberately overflow the reveal space, like a full-height RTA row
                    // while its available space is still growing during the animation.
                    peekColor.frame(height: 200)
                },
                size: CGSize(width: 320, height: 700), scale: 1
            )
            let bitmap = try #require(image.cgImage)
            let pageBottom = 460 - peekHeight
            let pagePixel = try pixel(in: bitmap, y: pageBottom - 2)
            #expect(pagePixel[0] > 240 && pagePixel[1] > 240 && pagePixel[2] > 240)
            let keypadPixel = try pixel(in: bitmap, y: 462)
            #expect(keypadPixel[0] < 20 && keypadPixel[1] < 20 && keypadPixel[2] > 240)
            if peekHeight > 0 {
                let peekPixel = try pixel(in: bitmap, y: pageBottom + peekHeight / 2)
                #expect(peekPixel[0] > 240 && peekPixel[1] < 20 && peekPixel[2] < 20)
            }
        }
    }

    private func pixel(in image: CGImage, y: CGFloat) throws -> [UInt8] {
        let sample = try #require(
            image.cropping(to: CGRect(x: 160, y: y.rounded(.down), width: 1, height: 1)))
        var channels = [UInt8](repeating: 0, count: 4)
        try channels.withUnsafeMutableBytes { buffer in
            let context = try #require(
                CGContext(
                    data: buffer.baseAddress, width: 1, height: 1,
                    bitsPerComponent: 8, bytesPerRow: 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                ))
            context.draw(sample, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return channels
    }

    @Test
    func automaticMotionRevealsTheFirstPeekAndPushesContentUnderAnExistingPeek() {
        let firstPeek = PeekContentMotion.automatic.resolved(hasVisiblePeek: false)
        let addedContent = PeekContentMotion.automatic.resolved(hasVisiblePeek: true)
        #expect(firstPeek == .stationaryReveal)
        #expect(addedContent == .pushFromBottom)
        for isPresented in [false, true] {
            let layout = PeekLayout(
                containerHeight: 700, expansionHeight: 240, isPresented: isPresented,
                isCompactPresented: true, compactHeight: 88)
            #expect(layout.expansionTop(motion: firstPeek) == 460)
            #expect(layout.expansionTop(motion: addedContent) == (isPresented ? 460 : 700))
        }
    }

    @Test
    func explicitMotionOverridesTheAutomaticPeekRule() {
        for hasVisiblePeek in [false, true] {
            #expect(
                PeekContentMotion.stationaryReveal.resolved(hasVisiblePeek: hasVisiblePeek)
                    == .stationaryReveal)
            #expect(
                PeekContentMotion.pushFromBottom.resolved(hasVisiblePeek: hasVisiblePeek)
                    == .pushFromBottom)
        }
    }

    @Test
    func compactResizingKeepsThePageAndExpansionEndpointsAdjacent() {
        for isPresented in [false, true] {
            for compactHeight: CGFloat in [0, 17, 86, 116] {
                let layout = PeekLayout(
                    containerHeight: 800, expansionHeight: 274, isPresented: isPresented,
                    isCompactPresented: true, compactHeight: compactHeight)
                #expect(layout.compactTop(motion: .pushFromBottom) == layout.foregroundHeight)
                #expect(
                    layout.expansionTop(motion: .pushFromBottom)
                        - layout.compactTop(motion: .pushFromBottom) == compactHeight)
                #expect(layout.foregroundHeight + layout.visibleBackHeight == 800)
            }
        }
    }

    @Test(arguments: [false, true])
    func rapidReopensRejectStaleMeasurementsAndPreservePeekSpace(hasVisiblePeek: Bool) throws {
        var presentation = PeekPresentation()
        var previousID: UUID?
        for _ in 0..<20 {
            presentation.prepare()
            let sessionID = try #require(presentation.sessionID)
            #expect(presentation.acceptsMeasurement(sessionID: sessionID))
            if let previousID {
                #expect(!presentation.acceptsMeasurement(sessionID: previousID))
                presentation.reveal(sessionID: previousID)
                presentation.finishClosing(sessionID: previousID)
                #expect(presentation.isPreparing)
                #expect(presentation.sessionID == sessionID)
            }
            presentation.reveal(sessionID: sessionID)
            #expect(presentation.acceptsMeasurement(sessionID: sessionID))
            let open = PeekLayout(
                containerHeight: 800, expansionHeight: 274,
                isPresented: presentation.isPresented, isCompactPresented: hasVisiblePeek,
                compactHeight: 86)
            #expect(open.foregroundHeight == (hasVisiblePeek ? 440 : 526))
            #expect(open.visibleCompactHeight == (hasVisiblePeek ? 86 : 0))
            let motion = PeekContentMotion.pushFromBottom.resolved(hasVisiblePeek: hasVisiblePeek)
            #expect(open.expansionTop(motion: motion) == 526)
            presentation.beginClosing()
            #expect(!presentation.acceptsMeasurement(sessionID: sessionID))
            let closed = PeekLayout(
                containerHeight: 800, expansionHeight: 274,
                isPresented: presentation.isPresented, isCompactPresented: hasVisiblePeek,
                compactHeight: 86)
            #expect(closed.foregroundHeight == (hasVisiblePeek ? 714 : 800))
            #expect(closed.visibleCompactHeight == (hasVisiblePeek ? 86 : 0))
            #expect(closed.expansionTop(motion: motion) == 800)
            previousID = sessionID
        }
        presentation.dismissForFocusChange()
        #expect(!presentation.acceptsMeasurement(sessionID: try #require(previousID)))
    }

    @Test
    func measuringContentCannotReopenAClosingOrReplacedKeypad() throws {
        var presentation = PeekPresentation()
        presentation.prepare()
        let oldID = try #require(presentation.sessionID)
        #expect(presentation.isPreparing)
        #expect(!presentation.isPresented)
        presentation.reveal(sessionID: oldID)
        #expect(!presentation.isPreparing)
        #expect(presentation.isPresented)
        presentation.beginClosing()
        presentation.reveal(sessionID: oldID)
        #expect(!presentation.isPresented)
        presentation.prepare()
        let newID = try #require(presentation.sessionID)
        presentation.reveal(sessionID: oldID)
        #expect(presentation.isPreparing)
        #expect(!presentation.isPresented)
        presentation.finishClosing(sessionID: oldID)
        #expect(presentation.sessionID == newID)
        presentation.reveal(sessionID: newID)
        #expect(presentation.isPresented)
    }

    @Test
    func pendingOperatorsKeepTheAmountVisibleWithoutAllowingAnIncompleteSave() {
        var calculator = AmountCalculator(amount: 8_420, minorUnit: 2)
        calculator.appendOperation(.add)
        #expect(calculator.amount == nil)
        #expect(calculator.previewAmount == 8_420)
        #expect(calculator.error?.errorDescription == nil)
        calculator.appendOperation(.subtract)
        #expect(calculator.previewAmount == 8_420)
        calculator.appendDigit(5)
        #expect(calculator.previewAmount == 8_415)
        calculator.appendOperation(.add)
        #expect(calculator.amount == nil)
        #expect(calculator.previewAmount == 8_415)
        calculator.deleteLast()
        #expect(calculator.amount == 8_415)
        calculator.resolve()
        #expect(calculator.previewAmount == 8_415)
    }

    @Test
    func invalidResultsDoNotShowAnOldAmountAsThePreview() {
        var calculator = AmountCalculator(amount: 0, minorUnit: 2)
        calculator.appendOperation(.subtract)
        calculator.appendDigit(1)
        #expect(calculator.error == .negativeAmount)
        #expect(calculator.previewAmount == nil)
        calculator.appendOperation(.add)
        #expect(calculator.previewAmount == nil)

        var signed = AmountCalculator(
            amount: Int64.min, minorUnit: 2, allowsNegativeAmounts: true
        )
        signed.appendOperation(.subtract)
        #expect(signed.previewAmount == Int64.min)
        signed.appendDigit(1)
        #expect(signed.error == .amountTooLarge)
        #expect(signed.previewAmount == nil)
    }

    @Test
    func displayStaysTwoRowsForLabelsArithmeticLargeAmountsAndErrors() async throws {
        let initial = AmountCalculator(amount: 8_420, minorUnit: 2)
        var pending = initial
        pending.appendOperation(.add)
        var arithmetic = pending
        arithmetic.appendDigit(5)
        var resolved = arithmetic
        resolved.resolve()
        let large = AmountCalculator(amount: Int64.max, minorUnit: 2)
        var overflow = large
        overflow.appendOperation(.add)
        overflow.appendDigit(1)
        let states = [
            ("initial", initial), ("pending", pending), ("arithmetic", arithmetic),
            ("resolved", resolved), ("large", large), ("error", overflow),
        ]

        for size in [DynamicTypeSize.large, .accessibility3] {
            var expectedHeight: CGFloat = 0
            _ = try await HostedViewSnapshot.image(
                of: VStack(spacing: 6) {
                    Text("0").font(.largeTitle.weight(.semibold))
                    Text("Amount").font(.subheadline)
                }
                .padding(.bottom, 4)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    expectedHeight = $0
                }
                .frame(maxHeight: .infinity, alignment: .top)
                .environment(\.dynamicTypeSize, size),
                size: CGSize(width: 320, height: 300)
            )
            #expect(expectedHeight > 0)
            for (name, calculator) in states {
                var height: CGFloat = 0
                let image = try await HostedViewSnapshot.image(
                    of: AmountPadDisplay(
                        calculator: calculator, currencyCode: "USD",
                        title: "Home maintenance and annual property expenses",
                        accessibilityIdentifierPrefix: "test"
                    )
                    .onGeometryChange(for: CGFloat.self) {
                        $0.size.height
                    } action: {
                        height = $0
                    }
                    .padding(20)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .background(KualiaPalette.peekBackground)
                    .environment(\.locale, Locale(identifier: "en_US"))
                    .environment(\.dynamicTypeSize, size),
                    size: CGSize(width: 320, height: 300)
                )
                #expect(height > 0)
                #expect(abs(height - expectedHeight) < 0.5)
                Attachment.record(
                    Array(try #require(image.pngData())),
                    named: "amount-display-\(name)-\(size).png"
                )
            }
        }
    }

    @Test
    func signedAmountsAreOptInAndTheFirstDigitReplacesTheWholeAmount() {
        let transaction = AmountCalculator(amount: -8_420, minorUnit: 2)
        #expect(transaction.amount == 0)

        var budget = AmountCalculator(amount: -8_420, minorUnit: 2, allowsNegativeAmounts: true)
        #expect(budget.expression == "-84.20")
        #expect(budget.amount == -8_420)
        #expect(!budget.hasOperations)
        #expect(budget.displayExpression(decimalSeparator: ",") == "−84,20")
        budget.appendDigit(9)
        #expect(budget.amount == 9)
        #expect(budget.expression == "0.09")
    }

    @Test
    func signedCalculationsCanCrossZeroResolveAndContinue() {
        var calculator = AmountCalculator(amount: 500, minorUnit: 2, allowsNegativeAmounts: true)
        calculator.appendOperation(.subtract)
        for digit in [8, 0, 0] { calculator.appendDigit(digit) }
        #expect(calculator.amount == -300)
        calculator.resolve()
        #expect(calculator.expression == "-3.00")
        #expect(!calculator.hasOperations)
        calculator.appendOperation(.add)
        for digit in [5, 0, 0] { calculator.appendDigit(digit) }
        #expect(calculator.hasOperations)
        #expect(calculator.amount == 200)
        #expect(calculator.displayExpression(decimalSeparator: ".") == "−3.00 + 5.00")
    }

    @Test
    func signedBackspacePreservesTheSignUntilZero() {
        var calculator = AmountCalculator(amount: -123, minorUnit: 2, allowsNegativeAmounts: true)
        calculator.deleteLast()
        #expect(calculator.expression == "-0.12")
        #expect(calculator.amount == -12)
        calculator.appendDigit(4)
        #expect(calculator.amount == -124)
        calculator.deleteLast()
        calculator.deleteLast()
        #expect(calculator.amount == -1)
        calculator.deleteLast()
        #expect(calculator.expression == "0.00")
        #expect(calculator.amount == 0)
    }

    @Test
    func signedMoneyKeepsTheInt64MinimumExactAndRejectsLowerValues() throws {
        var calculator = AmountCalculator(
            amount: Int64.min, minorUnit: 2, allowsNegativeAmounts: true
        )
        #expect(calculator.expression == "-92233720368547758.08")
        #expect(calculator.amount == Int64.min)
        calculator.resolve()
        #expect(calculator.amount == Int64.min)
        calculator.appendOperation(.subtract)
        calculator.appendDigit(1)
        #expect(calculator.error == .amountTooLarge)
        calculator.deleteLast()
        #expect(calculator.amount == Int64.min)
        #expect(
            try AmountCalculator.evaluate(
                "-92233720368547758.08", minorUnit: 2, allowsNegativeAmounts: true
            ) == Int64.min
        )
        #expect(
            throws: AmountCalculator.CalculationError.amountTooLarge,
            performing: {
                try AmountCalculator.evaluate(
                    "-92233720368547758.09", minorUnit: 2, allowsNegativeAmounts: true
                )
            }
        )
    }

    @Test
    func signedResultUsesCurrencyRoundingAndStillRejectsMalformedCalculations() throws {
        #expect(
            try AmountCalculator.evaluate(
                "1−2.235", minorUnit: 2, allowsNegativeAmounts: true
            ) == -124
        )
        #expect(
            try AmountCalculator.evaluate(
                "-0.0004", minorUnit: 3, allowsNegativeAmounts: true
            ) == 0
        )
        for expression in ["--2", "1−−2", "1..2", "-"] {
            #expect(
                throws: AmountCalculator.CalculationError.invalidExpression,
                performing: {
                    try AmountCalculator.evaluate(
                        expression, minorUnit: 2, allowsNegativeAmounts: true
                    )
                }
            )
        }
    }

    @Test
    func eachCategorySessionIgnoresEarlierCloseCompletions() throws {
        var presentation = PeekPresentation()
        presentation.open()
        let previousCategory = try #require(presentation.sessionID)
        presentation.beginClosing()
        presentation.open()
        let currentCategory = try #require(presentation.sessionID)
        #expect(previousCategory != currentCategory)
        presentation.finishClosing(sessionID: previousCategory)
        #expect(presentation.isPresented)
        #expect(presentation.sessionID == currentCategory)
        presentation.dismissForFocusChange()
        presentation.finishClosing(sessionID: currentCategory)
        #expect(presentation.sessionID == nil)
    }

    @Test
    func sharedMoneyFormattingSupportsSignedValuesAndTotalsBeyondInt64() {
        let locale = Locale(identifier: "en_US")
        #expect(
            MoneyAmountFormatter.string(
                minorUnits: Int64(-12_345), currencyCode: "USD", minorUnit: 2,
                showsPositiveSign: false, usesAbsoluteValue: false, locale: locale
            ) == "-$123.45"
        )
        #expect(
            MoneyAmountFormatter.string(
                decimalMinorUnits: Decimal(Int64.max) + 1, currencyCode: "USD", minorUnit: 2,
                showsPositiveSign: false, usesAbsoluteValue: false, locale: locale
            ) == "$92,233,720,368,547,758.08"
        )
    }
}
