import Foundation
import Testing

@testable import Kualia

struct WelcomeOrbitTests {
    @Test
    func reduceMotionPausesTimeAndResumingDoesNotJump() {
        let start = Date(timeIntervalSinceReferenceDate: 100)
        var clock = WelcomeOrbitClock()
        #expect(!clock.isRunning)
        #expect(clock.elapsed(at: start) == 0)

        clock.setRunning(true, at: start)
        clock.setRunning(false, at: start.addingTimeInterval(4))
        #expect(!clock.isRunning)
        #expect(clock.elapsed(at: start.addingTimeInterval(120)) == 4)

        clock.setRunning(true, at: start.addingTimeInterval(120))
        #expect(clock.elapsed(at: start.addingTimeInterval(120)) == 4)
        #expect(clock.elapsed(at: start.addingTimeInterval(123)) == 7)
    }

    @Test
    func elapsedTimeAdvancesAcrossGapsWithoutRenderedFrames() {
        let start = Date(timeIntervalSinceReferenceDate: 100)
        var clock = WelcomeOrbitClock()
        clock.setRunning(true, at: start)
        #expect(clock.elapsed(at: start.addingTimeInterval(2)) == 2)

        // Background suspension or an auth sheet may prevent rendering for a while.
        let resumedAt = start.addingTimeInterval(125)
        clock.setRunning(true, at: resumedAt)
        #expect(clock.isRunning)
        #expect(clock.elapsed(at: resumedAt) == 125)
        #expect(clock.elapsed(at: resumedAt.addingTimeInterval(1)) == 126)
    }

    @Test
    func repeatedPlaybackUpdatesDoNotResetTheClock() {
        let start = Date(timeIntervalSinceReferenceDate: 100)
        var clock = WelcomeOrbitClock()
        clock.setRunning(true, at: start)
        clock.setRunning(true, at: start.addingTimeInterval(5))
        #expect(clock.elapsed(at: start.addingTimeInterval(8)) == 8)
        clock.setRunning(false, at: start.addingTimeInterval(8))
        clock.setRunning(false, at: start.addingTimeInterval(20))
        #expect(clock.elapsed(at: start.addingTimeInterval(30)) == 8)
    }

    @Test(arguments: WelcomeOrbitItem.allCases)
    func everyOrbitLoopsWithoutAPositionOrDepthJump(item: WelcomeOrbitItem) {
        let initial = WelcomeOrbitPose(item: item, elapsed: 0)
        let loop = WelcomeOrbitPose(item: item, elapsed: WelcomeOrbitPose.period)
        #expect(abs(initial.x - loop.x) < 0.0001)
        #expect(abs(initial.y - loop.y) < 0.0001)
        #expect(abs(initial.scale - loop.scale) < 0.0001)
        #expect(abs(initial.depth - loop.depth) < 0.0001)
        let justBefore = WelcomeOrbitPose(item: item, elapsed: WelcomeOrbitPose.period - 0.001)
        #expect(hypot(initial.x - justBefore.x, initial.y - justBefore.y) < 0.03)
    }

    @Test
    func foregroundIconsAreLargerAndBehindIconsRecede() {
        let back = WelcomeOrbitPose(item: .home, elapsed: 0)
        let front = WelcomeOrbitPose(item: .home, elapsed: WelcomeOrbitPose.period / 2)
        #expect(back.depth < 0)
        #expect(front.depth > 0)
        #expect(front.scale > back.scale)
        #expect(front.opacity > back.opacity)
    }

    @Test
    func iconsStayInsideTheHeaderAndDoNotCollideThroughoutTheOrbit() {
        for tick in 0..<360 {
            let poses = WelcomeOrbitItem.allCases.map {
                WelcomeOrbitPose(item: $0, elapsed: Double(tick) / 10)
            }
            for (index, pose) in poses.enumerated() {
                let radius = 29 * pose.scale
                #expect(abs(pose.x) + radius < 180)
                #expect(abs(pose.y) + radius < 126)
                for other in poses.dropFirst(index + 1) {
                    #expect(
                        hypot(pose.x - other.x, pose.y - other.y) > 29 * (pose.scale + other.scale))
                }
            }
        }
    }
}
