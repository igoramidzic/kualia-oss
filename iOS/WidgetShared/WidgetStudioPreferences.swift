import Foundation
import SwiftUI
import WidgetKit

nonisolated enum WidgetStudioStyle: String, CaseIterable, Identifiable {
    case paper, stone, midnight
    var id: String { rawValue }
    var title: String {
        switch self {
        case .paper: L10n.string("Paper")
        case .stone: L10n.string("Stone")
        case .midnight: L10n.string("Midnight")
        }
    }
    var colors: [Color] {
        switch self {
        case .paper:
            [Color(red: 0.98, green: 0.96, blue: 0.90), Color(red: 0.91, green: 0.90, blue: 0.82)]
        case .stone:
            [Color(red: 0.94, green: 0.94, blue: 0.93), Color(red: 0.84, green: 0.86, blue: 0.87)]
        case .midnight:
            [Color(red: 0.16, green: 0.23, blue: 0.29), Color(red: 0.07, green: 0.12, blue: 0.17)]
        }
    }
    var foreground: Color { self == .midnight ? .white : Color(red: 0.12, green: 0.19, blue: 0.17) }
    var accent: Color { self == .midnight ? Color(red: 0.82, green: 0.95, blue: 0.60) : foreground }
}

/// Appearance is scoped to workspace and design, independent of WidgetKit kind
/// migration. Existing photos and the two retained palettes keep their storage keys.
nonisolated enum WidgetStudioPreferences {
    static let suiteName = "group.com.kualia.app"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: suiteName) }
    static func storageKey(for kind: String, workspaceID: String?) -> String {
        "widget.studio.\(workspaceID ?? "unconfigured").\(appearanceKey(for: kind))"
    }
    static func appearanceKey(for kind: String) -> String {
        switch kind {
        case "TopSpendingWidget": "StudioBudgetPulseWidget"
        case "CategoryCardWidget": "StudioDailyRoomWidget"
        case "UpcomingTransactionsWidget": "StudioBillsCountdownWidget"
        case "AccountBalancesWidget": "StudioMoneyMapWidget"
        case "LockScreenAddTransactionWidget": "StudioQuickCaptureWidget"
        default: kind
        }
    }
    static func resolvedStyle(_ saved: String?, for kind: String) -> WidgetStudioStyle {
        saved.flatMap(WidgetStudioStyle.init(rawValue:)) ?? defaultStyle(for: kind)
    }
    private static func key(_ kind: String) -> String {
        storageKey(for: kind, workspaceID: WidgetSharedStorage.workspaceId)
    }
    static func style(for kind: String) -> WidgetStudioStyle {
        resolvedStyle(defaults?.string(forKey: key(kind)), for: kind)
    }
    static func defaultStyle(for kind: String) -> WidgetStudioStyle {
        switch appearanceKey(for: kind) {
        case "StudioMoneyMapWidget": .midnight
        case "StudioBudgetPulseWidget", "StudioBillsCountdownWidget": .stone
        default: .paper
        }
    }

    static func setStyle(_ style: WidgetStudioStyle, for kind: String) {
        defaults?.set(style.rawValue, forKey: key(kind))
        reload(kind)
    }
    static func imageData(for kind: String) -> Data? {
        WidgetImageStorage.loadImageData(forCategoryId: key(kind), size: .small)
    }
    static func saveImage(_ image: UIImage, for kind: String) -> Bool {
        let saved = WidgetImageStorage.saveImage(image, forCategoryId: key(kind), size: .small)
        if saved { reload(kind) }
        return saved
    }
    static func removeImage(for kind: String) {
        WidgetImageStorage.deleteImage(forCategoryId: key(kind))
        reload(kind)
    }
    static func reset(for kind: String) {
        defaults?.removeObject(forKey: key(kind))
        removeImage(for: kind)
    }
    static func foreground(for kind: String, fallbackImageData: Data? = nil) -> Color {
        (imageData(for: kind) ?? fallbackImageData) == nil ? style(for: kind).foreground : .white
    }
    private static func reload(_ kind: String) { WidgetCenter.shared.reloadTimelines(ofKind: kind) }
}

struct WidgetStudioBackground: View {
    let kind: String
    var fallbackImageData: Data? = nil
    var body: some View {
        GeometryReader { geometry in
            if let data = WidgetStudioPreferences.imageData(for: kind) ?? fallbackImageData,
                let photo = UIImage(data: data)
            {
                Image(uiImage: photo)
                    .resizable().scaledToFill()
                    .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                    .overlay(Color.black.opacity(0.62))
            } else {
                LinearGradient(
                    colors: WidgetStudioPreferences.style(for: kind).colors,
                    startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
    }
}
