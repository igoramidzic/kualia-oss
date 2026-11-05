import Testing

@testable import Kualia

@MainActor
struct SettingsWidgetsTests {
    @Test func balanceGalleryIncludesLockScreenSetup() {
        for design in [SettingsWidgetDesign.categories, .map] {
            #expect(design.sizes == "Small · Medium · Large · Lock Screen")
            #expect(design.tip.contains("On the Lock Screen, tap the widget"))
        }
        #expect(SettingsWidgetDesign.bills.sizes == "Small · Medium · Large · Lock Screen")
        #expect(
            SettingsWidgetDesign.bills.tip.contains(
                "the rectangular widget shows your next payment"))
        #expect(SettingsWidgetDesign.capture.icon == .plus)
    }

    @Test func oneCollectionUsesClearNamesAndCompatibleIdentities() {
        let designs = SettingsWidgetDesign.allCases
        #expect(
            designs.map(\.title) == [
                "Category Balances", "Account Balances", "Upcoming Bills", "Add Transaction",
            ])
        #expect(
            designs.map(\.kind) == [
                "CategoryCardWidget", "AccountBalancesWidget", "UpcomingTransactionsWidget",
                "LockScreenAddTransactionWidget",
            ])
        #expect(Set(designs.map(\.kind)).count == 4)
    }

    @Test func defaultsAreNeutralAndRetainThePreferredDarkAndPaperStyles() {
        #expect(
            WidgetStudioPreferences.defaultStyle(for: SettingsWidgetDesign.categories.kind)
                == .paper)
        #expect(
            WidgetStudioPreferences.defaultStyle(for: SettingsWidgetDesign.bills.kind) == .stone)
        #expect(
            WidgetStudioPreferences.defaultStyle(for: SettingsWidgetDesign.map.kind) == .midnight)
        #expect(
            WidgetStudioPreferences.defaultStyle(for: SettingsWidgetDesign.capture.kind) == .paper)
        #expect(Set(WidgetStudioStyle.allCases) == [.stone, .paper, .midnight])
    }

    @Test func discontinuedColorsFallBackWithoutDiscardingSupportedChoices() {
        for kind in SettingsWidgetDesign.allCases.map(\.kind) {
            for removed in ["meadow", "peach", "lavender", "unknown"] {
                #expect(
                    WidgetStudioPreferences.resolvedStyle(removed, for: kind)
                        == WidgetStudioPreferences.defaultStyle(for: kind))
            }
            for style in WidgetStudioStyle.allCases {
                #expect(WidgetStudioPreferences.resolvedStyle(style.rawValue, for: kind) == style)
            }
        }
    }

    @Test func replacementKindsKeepExistingAppearanceAndPhotoKeys() {
        let previous = [
            "StudioDailyRoomWidget", "StudioMoneyMapWidget", "StudioBillsCountdownWidget",
            "StudioQuickCaptureWidget",
        ]
        for (design, oldKind) in zip(SettingsWidgetDesign.allCases, previous) {
            #expect(
                WidgetStudioPreferences.storageKey(for: design.kind, workspaceID: "personal")
                    == WidgetStudioPreferences.storageKey(for: oldKind, workspaceID: "personal"))
        }
    }

    @Test func backgroundKeysKeepWorkspaceAndWidgetChoicesSeparate() {
        let kind = SettingsWidgetDesign.map.kind
        let personal = WidgetStudioPreferences.storageKey(for: kind, workspaceID: "personal")
        let family = WidgetStudioPreferences.storageKey(for: kind, workspaceID: "family")
        let unconfigured = WidgetStudioPreferences.storageKey(for: kind, workspaceID: nil)
        let daily = WidgetStudioPreferences.storageKey(
            for: SettingsWidgetDesign.categories.kind, workspaceID: "personal")
        #expect(Set([personal, family, unconfigured, daily]).count == 4)
    }
}
