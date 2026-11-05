import SwiftUI

struct WelcomeOrbitScene: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var clock = WelcomeOrbitClock()
    @State private var appeared = false

    var isPaused = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !clock.isRunning)) { context in
            WelcomeOrbitArtwork(
                elapsed: clock.elapsed(at: context.date),
                appeared: appeared || reduceMotion,
                reduceMotion: reduceMotion)
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
        .onAppear {
            appeared = true
            updatePlayback()
        }
        .onChange(of: reduceMotion) { _, _ in updatePlayback() }
        .onChange(of: isPaused) { _, _ in updatePlayback() }
    }

    private func updatePlayback() {
        clock.setRunning(!reduceMotion && !isPaused, at: .now)
    }
}

// Keep the artwork independent of its clock so every phase can be inspected without running auth.
struct WelcomeOrbitArtwork: View {
    @Environment(\.colorScheme) private var colorScheme

    let elapsed: TimeInterval
    let appeared: Bool
    let reduceMotion: Bool

    private let mint = Color(red: 0.73, green: 0.86, blue: 0.70)
    private let gold = Color(red: 0.94, green: 0.77, blue: 0.43)
    private let ink = Color(red: 0.10, green: 0.15, blue: 0.12)

    var body: some View {
        GeometryReader { geometry in
            let scale = min(geometry.size.width / 360, geometry.size.height / 252)
            ZStack {
                atmosphere
                orbitTrack
                centerpiece
                    .scaleEffect(appeared ? 1 : 0.86)
                    .opacity(appeared ? 1 : 0)
                    .animation(entrance(delay: 0), value: appeared)

                ForEach(WelcomeOrbitItem.allCases) { item in
                    let pose = WelcomeOrbitPose(item: item, elapsed: elapsed)
                    satellite(item)
                        .rotationEffect(.degrees(pose.rotation))
                        .scaleEffect(pose.scale * (appeared ? 1 : 0.5))
                        .opacity(appeared ? pose.opacity : 0)
                        .offset(
                            x: pose.x * (appeared ? 1 : 0.65),
                            y: pose.y * (appeared ? 1 : 0.65)
                        )
                        .zIndex(pose.depth)
                        .animation(entrance(delay: Double(item.rawValue) * 0.055), value: appeared)
                }
            }
            .frame(width: 360, height: 252)
            .scaleEffect(scale)
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
    }

    private var atmosphere: some View {
        ZStack {
            // Fade inside a circle before stretching it; an ellipse clips a circular gradient early.
            Circle()
                .fill(
                    RadialGradient(
                        colors: [mint.opacity(colorScheme == .dark ? 0.13 : 0.30), .clear],
                        center: .center, startRadius: 8, endRadius: 114)
                )
                .frame(width: 228, height: 228)
                .scaleEffect(x: 308.0 / 228, y: 1)
                .rotationEffect(.degrees(-18))

            KualiaIconImage(icon: .sparkles, size: 13)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(gold)
                .rotationEffect(.degrees(12))
                .offset(x: 73, y: -99)

            Circle()
                .fill(mint)
                .frame(width: 5, height: 5)
                .offset(x: -78, y: 99)

            Circle()
                .fill(gold.opacity(0.65))
                .frame(width: 3, height: 3)
                .offset(x: -121, y: -77)
        }
        .zIndex(-2)
    }

    private var orbitTrack: some View {
        ZStack {
            Ellipse()
                .stroke(KualiaPalette.ink.opacity(0.09), lineWidth: 0.8)
                .frame(width: 286, height: 150)
                .rotationEffect(.degrees(WelcomeOrbitPose.tiltDegrees))

            Ellipse()
                .trim(from: 0.05, to: 0.43)
                .stroke(
                    KualiaPalette.ink.opacity(0.05),
                    style: StrokeStyle(lineWidth: 0.7, lineCap: .round, dash: [2, 6])
                )
                .frame(width: 322, height: 184)
                .rotationEffect(.degrees(WelcomeOrbitPose.tiltDegrees))
        }
        .zIndex(-1.5)
    }

    private var centerpiece: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color(red: 0.21, green: 0.28, blue: 0.23), ink],
                        startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .overlay {
                    Circle()
                        .strokeBorder(
                            LinearGradient(
                                colors: [.white.opacity(0.28), .white.opacity(0.02)],
                                startPoint: .topLeading, endPoint: .bottomTrailing),
                            lineWidth: 1)
                }
                .shadow(color: ink.opacity(0.18), radius: 18, y: 12)

            Circle()
                .strokeBorder(.white.opacity(0.07), lineWidth: 1)
                .padding(6)

            Image("KualiaMark")
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .foregroundStyle(Color(red: 0.88, green: 0.94, blue: 0.83))
                .frame(width: 45, height: 45)
        }
        .frame(width: 100, height: 100)
        .rotationEffect(.degrees(-8))
        .zIndex(0)
    }

    private func satellite(_ item: WelcomeOrbitItem) -> some View {
        Text(item.emoji)
            .font(.system(size: item == .home ? 32 : 30))
            .frame(width: 58, height: 58)
            .background {
                Circle()
                    .fill(KualiaPalette.surface)
                    .overlay {
                        Circle()
                            .fill(item.tint.opacity(colorScheme == .dark ? 0.18 : 0.12))
                    }
                    .overlay {
                        Circle()
                            .strokeBorder(
                                .white.opacity(colorScheme == .dark ? 0.10 : 0.90), lineWidth: 1)
                    }
                    .shadow(color: .black.opacity(0.06), radius: 9, y: 5)
            }
    }

    private func entrance(delay: Double) -> Animation? {
        reduceMotion ? nil : .spring(response: 0.85, dampingFraction: 0.78).delay(delay)
    }
}

enum WelcomeOrbitItem: Int, CaseIterable, Identifiable {
    case home, coffee, travel, music, groceries, growth

    var id: Int { rawValue }

    var emoji: String {
        switch self {
        case .home: "🏡"
        case .coffee: "☕️"
        case .travel: "✈️"
        case .music: "🎧"
        case .groceries: "🥑"
        case .growth: "🌱"
        }
    }

    var tint: Color {
        switch self {
        case .home: Color(red: 0.96, green: 0.73, blue: 0.49)
        case .coffee: Color(red: 0.85, green: 0.69, blue: 0.54)
        case .travel: Color(red: 0.55, green: 0.77, blue: 0.97)
        case .music: Color(red: 0.77, green: 0.68, blue: 0.94)
        case .groceries: Color(red: 0.78, green: 0.85, blue: 0.45)
        case .growth: Color(red: 0.54, green: 0.80, blue: 0.60)
        }
    }
}

struct WelcomeOrbitPose {
    static let period: TimeInterval = 36
    static let tiltDegrees = -18.0

    let x: Double
    let y: Double
    let depth: Double
    let scale: Double
    let opacity: Double
    let rotation: Double

    init(item: WelcomeOrbitItem, elapsed: TimeInterval) {
        let phase = elapsed.truncatingRemainder(dividingBy: Self.period) / Self.period
        let angle =
            (Double(item.rawValue) / Double(WelcomeOrbitItem.allCases.count) + phase)
            * 2 * .pi - .pi / 2
        let tilt = Self.tiltDegrees * .pi / 180
        let horizontal = cos(angle) * 143
        let vertical = sin(angle) * 75
        x = horizontal * cos(tilt) - vertical * sin(tilt)
        y = horizontal * sin(tilt) + vertical * cos(tilt)
        depth = sin(angle)
        scale = 0.89 + depth * 0.13
        opacity = 0.87 + depth * 0.13
        rotation = cos(angle) * 9
    }
}

// Elapsed time advances even when the system suspends rendering or auth covers the view.
// The welcome page pauses only for Reduce Motion; other hosts can explicitly pause.
struct WelcomeOrbitClock {
    private var accumulated: TimeInterval = 0
    private var startedAt: Date?

    var isRunning: Bool { startedAt != nil }

    func elapsed(at date: Date) -> TimeInterval {
        accumulated + (startedAt.map { max(0, date.timeIntervalSince($0)) } ?? 0)
    }

    mutating func setRunning(_ running: Bool, at date: Date) {
        guard running != isRunning else { return }
        if running {
            startedAt = date
        } else {
            accumulated = elapsed(at: date)
            startedAt = nil
        }
    }
}
