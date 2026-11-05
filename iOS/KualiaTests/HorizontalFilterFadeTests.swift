import Foundation
import Testing

@testable import Kualia

@MainActor
struct HorizontalFilterFadeTests {
    @Test(arguments: [CGFloat(0), 200, 300])
    func contentThatFitsNeverFades(contentWidth: CGFloat) {
        // Even bounce must not fade a strip with no hidden choices.
        for offset in [CGFloat(-30), 0, 30] {
            let fade = HorizontalFilterFade(
                offset: offset, contentWidth: contentWidth, viewportWidth: 300)
            #expect(fade.leading == 0)
            #expect(fade.trailing == 0)
        }
    }

    @Test
    func fadesOnlyBeyondTheVisibleEdges() {
        let start = HorizontalFilterFade(contentWidth: 600, viewportWidth: 300)
        #expect(start.leading == 0)
        #expect(start.trailing == 40)
        let middle = HorizontalFilterFade(offset: 100, contentWidth: 600, viewportWidth: 300)
        #expect(middle.leading == 40)
        #expect(middle.trailing == 40)
        let end = HorizontalFilterFade(offset: 300, contentWidth: 600, viewportWidth: 300)
        #expect(end.leading == 40)
        #expect(end.trailing == 0)
    }

    @Test
    func respectsRestingContentMarginsAndBounce() {
        for offset in [CGFloat(-24), -50] {
            let fade = HorizontalFilterFade(
                offset: offset, contentWidth: 600, viewportWidth: 300,
                leadingInset: 24, trailingInset: 24)
            #expect(fade.leading == 0)
            #expect(fade.trailing == 40)
        }
        let end = HorizontalFilterFade(
            offset: 324, contentWidth: 600, viewportWidth: 300,
            leadingInset: 24, trailingInset: 24)
        #expect(end.trailing == 0)
        let fits = HorizontalFilterFade(
            offset: -24, contentWidth: 252, viewportWidth: 300,
            leadingInset: 24, trailingInset: 24)
        #expect(fits == HorizontalFilterFade())
    }

    @Test
    func fadeRecedesContinuouslyAsTheLastChoiceComesIntoView() {
        let start = HorizontalFilterFade(offset: 4, contentWidth: 600, viewportWidth: 300)
        #expect(start.leading == 4)
        let end = HorizontalFilterFade(offset: 296, contentWidth: 600, viewportWidth: 300)
        #expect(end.trailing == 4)
        let resized = HorizontalFilterFade(offset: 296, contentWidth: 600, viewportWidth: 700)
        #expect(resized == HorizontalFilterFade())
    }

    @Test
    func fadeWidthsStayWithinTheViewport() {
        let narrow = HorizontalFilterFade(offset: 50, contentWidth: 600, viewportWidth: 20)
        #expect(narrow.leading == 10)
        #expect(narrow.trailing == 10)
        #expect(HorizontalFilterFade(contentWidth: 600) == HorizontalFilterFade())
    }
}
