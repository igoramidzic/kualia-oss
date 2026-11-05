import Foundation
import Testing

@testable import Kualia

struct PeekTests {
    @Test func measuringHiddenCompactContentDoesNotStartALayoutAnimation() {
        let initial = PeekCompactAnimationState(isPresented: false, height: 110)
        for height in [CGFloat(0), 64, 160, 280] {
            #expect(PeekCompactAnimationState(isPresented: false, height: height) == initial)
        }
    }

    @Test func compactVisibilityAndVisibleResizingStillRequestAnimation() {
        let hidden = PeekCompactAnimationState(isPresented: false, height: 110)
        let opened = PeekCompactAnimationState(isPresented: true, height: 110)
        let resized = PeekCompactAnimationState(isPresented: true, height: 180)
        #expect(opened != hidden)
        #expect(resized != opened)
        #expect(PeekCompactAnimationState(isPresented: false, height: 180) == hidden)
        #expect(PeekCompactAnimationState(isPresented: true, height: 0) != hidden)
    }

    @Test(arguments: [CGFloat(300), CGFloat(700), CGFloat(1024)])
    func firstOpeningRevealsBothSlotsAtTheirFinalPositions(containerHeight: CGFloat) {
        for isPresented in [false, true] {
            let layout = PeekLayout(
                containerHeight: containerHeight, expansionHeight: 240, isPresented: isPresented,
                isCompactPresented: isPresented, compactHeight: 88)
            let expansionTop = layout.expansionTop(motion: .stationaryReveal)
            #expect(expansionTop == containerHeight - layout.expansionHeight)
            #expect(
                layout.compactTop(motion: .stationaryReveal)
                    == expansionTop - layout.compactContentHeight)
            #expect(layout.foregroundHeight + layout.visibleBackHeight == containerHeight)
            #expect(layout.visibleBackHeight == (isPresented ? layout.expansionHeight + 88 : 0))
        }
    }

    @Test func compactPeekIsStationaryWhileTheCurtainOpensAndCloses() {
        for isCompactPresented in [false, true, false] {
            let layout = PeekLayout(
                containerHeight: 700, expansionHeight: 0, isPresented: false,
                isCompactPresented: isCompactPresented, compactHeight: 88)
            #expect(layout.compactTop(motion: .stationaryReveal) == 612)
            #expect(layout.expansionTop(motion: .stationaryReveal) == 700)
            #expect(layout.visibleBackHeight == (isCompactPresented ? 88 : 0))
            #expect(layout.foregroundHeight == (isCompactPresented ? 612 : 700))
        }
    }

    @Test func expansionPushesExistingContentWithOneSharedBoundary() {
        for isPresented in [false, true, false] {
            let layout = PeekLayout(
                containerHeight: 800, expansionHeight: 274, isPresented: isPresented,
                isCompactPresented: true, compactHeight: 86)
            #expect(layout.compactTop(motion: .pushFromBottom) == layout.foregroundHeight)
            #expect(layout.expansionTop(motion: .pushFromBottom) == (isPresented ? 526 : 800))
            #expect(
                layout.expansionTop(motion: .pushFromBottom)
                    - layout.compactTop(motion: .pushFromBottom) == 86)
            #expect(layout.foregroundHeight + layout.visibleBackHeight == 800)
        }
    }

    @Test(arguments: [false, true])
    func openingCapturesTheOriginBeforeCompactVisibilityChanges(wasVisible: Bool) throws {
        var presentation = PeekPresentation()
        presentation.prepare(hasVisiblePeek: wasVisible)
        let id = try #require(presentation.sessionID)
        let expected: PeekContentMotion = wasVisible ? .pushFromBottom : .stationaryReveal
        #expect(presentation.contentMotion == expected)
        #expect(presentation.motion(isCompactPresented: true) == expected)
        presentation.reveal(sessionID: id)
        #expect(presentation.motion(isCompactPresented: true) == expected)
        #expect(presentation.motion(isCompactPresented: false) == expected)
    }

    @Test func closingToCompactPushesDownAndClosingEverythingReversesTheCurtain() throws {
        var presentation = PeekPresentation(initiallyPresented: true)
        let id = try #require(presentation.sessionID)
        presentation.beginClosing()
        #expect(presentation.motion(isCompactPresented: true) == .pushFromBottom)
        #expect(presentation.motion(isCompactPresented: false) == .stationaryReveal)
        #expect(!presentation.acceptsMeasurement(sessionID: id))
        presentation.finishClosing(sessionID: id)
        #expect(presentation.sessionID == nil)
    }

    @Test func closingAfterACurtainRevealMovesBothSlotsToTheirCompactDestination() {
        var presentation = PeekPresentation(initiallyPresented: true)
        let opened = PeekLayout(
            containerHeight: 700, expansionHeight: 240,
            isPresented: presentation.isPresented, isCompactPresented: true, compactHeight: 88)
        let openingMotion = presentation.motion(isCompactPresented: true)
        #expect(openingMotion == .stationaryReveal)
        #expect(opened.compactTop(motion: openingMotion) == 372)
        #expect(opened.expansionTop(motion: openingMotion) == 460)

        presentation.beginClosing()
        let closing = PeekLayout(
            containerHeight: 700, expansionHeight: 240,
            isPresented: presentation.isPresented, isCompactPresented: true, compactHeight: 88)
        let closingMotion = presentation.motion(isCompactPresented: true)
        #expect(closingMotion == .pushFromBottom)
        #expect(closing.compactTop(motion: closingMotion) == 612)
        #expect(closing.expansionTop(motion: closingMotion) == 700)
        #expect(closing.foregroundHeight == 612)
        #expect(closing.visibleBackHeight == 88)
        for layout in [opened, closing] {
            #expect(layout.foregroundHeight + layout.visibleBackHeight == 700)
        }
    }

    @Test(arguments: [false, true])
    func replacingAnOpenFieldPreservesMotionAndRejectsTheOldSession(wasVisible: Bool) throws {
        var presentation = PeekPresentation(initiallyPresented: true, hasVisiblePeek: wasVisible)
        let oldID = try #require(presentation.sessionID)
        let motion = presentation.contentMotion
        presentation.open(hasVisiblePeek: !wasVisible)
        let currentID = try #require(presentation.sessionID)
        #expect(currentID != oldID)
        #expect(presentation.contentMotion == motion)
        #expect(!presentation.acceptsMeasurement(sessionID: oldID))
        presentation.finishClosing(sessionID: oldID)
        #expect(presentation.isPresented)
        #expect(presentation.sessionID == currentID)
    }

    @Test func lateCloseCannotRemoveContentBeingMeasuredEvenWithTheSameID() throws {
        var presentation = PeekPresentation()
        presentation.prepare()
        let id = try #require(presentation.sessionID)
        presentation.finishClosing(sessionID: id)
        #expect(presentation.isPreparing)
        #expect(presentation.sessionID == id)
        presentation.reveal(sessionID: id)
        #expect(presentation.isPresented)
    }

    @Test func rapidCloseReopenAndFocusChangesRejectStaleCallbacks() throws {
        var presentation = PeekPresentation()
        for index in 0..<20 {
            presentation.open(hasVisiblePeek: index.isMultiple(of: 2))
            let oldID = try #require(presentation.sessionID)
            presentation.beginClosing()
            presentation.prepare(hasVisiblePeek: true)
            let newID = try #require(presentation.sessionID)
            presentation.reveal(sessionID: oldID)
            presentation.finishClosing(sessionID: oldID)
            #expect(presentation.isPreparing)
            #expect(presentation.sessionID == newID)
            #expect(presentation.contentMotion == .pushFromBottom)
            presentation.reveal(sessionID: newID)
            presentation.dismissForFocusChange()
            presentation.reveal(sessionID: newID)
            presentation.finishClosing(sessionID: newID)
            #expect(presentation.sessionID == nil)
            #expect(!presentation.isPresented)
            #expect(!presentation.acceptsMeasurement(sessionID: newID))
        }
    }

    @Test(arguments: [CGFloat(-1), 0, 0.62, 1, 2])
    func shortSheetsAndCustomHeightLimitsNeverProduceNegativeViewports(fraction: CGFloat) {
        let layout = PeekLayout(
            containerHeight: 300, expansionHeight: 999, isPresented: true,
            isCompactPresented: true, compactHeight: 999, maximumHeightFraction: fraction)
        #expect(layout.expansionHeight == 300 * min(max(fraction, 0), 1))
        #expect(layout.foregroundHeight == 0)
        #expect(layout.visibleCompactHeight + layout.visibleExpansionHeight == 300)
        let empty = PeekLayout(
            containerHeight: -1, expansionHeight: -1, isPresented: true,
            isCompactPresented: true, compactHeight: -1, maximumHeightFraction: fraction)
        #expect(empty.foregroundHeight == 0)
    }

    @Test func resizedContentIsClampedAtEveryVisibilityEndpoint() {
        for isPresented in [false, true] {
            for isCompactPresented in [false, true] {
                for expansionHeight: CGFloat in [-20, 0, 200, 500] {
                    for compactHeight: CGFloat in [-20, 0, 88, 500] {
                        let layout = PeekLayout(
                            containerHeight: 300, expansionHeight: expansionHeight,
                            isPresented: isPresented, isCompactPresented: isCompactPresented,
                            compactHeight: compactHeight)
                        #expect(layout.expansionHeight == min(max(0, expansionHeight), 186))
                        #expect(layout.compactContentHeight == min(max(0, compactHeight), 300))
                        #expect(layout.foregroundHeight >= 0)
                        #expect(layout.visibleBackHeight >= 0)
                        #expect(layout.visibleBackHeight <= 300)
                        #expect(layout.foregroundHeight + layout.visibleBackHeight == 300)
                        #expect(isPresented || layout.visibleExpansionHeight == 0)
                        #expect(isCompactPresented || layout.visibleCompactHeight == 0)
                    }
                }
            }
        }
    }
}
