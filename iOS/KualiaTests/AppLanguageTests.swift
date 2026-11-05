import Foundation
import Observation
import Synchronization
import Testing

@testable import Kualia

struct AppLanguageTests {
    @MainActor @Test func opensAndClosesRightToLeftChatHistoryFromTheRightEdge() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(
            startX: 390, translationX: -180, translationY: 0,
            containerWidth: 400, rightToLeft: true)
        #expect(drawer.isDragging)
        #expect(drawer.progress(width: 300) == 0.6)
        drawer.endDrag(predictedTranslation: -180, width: 300, rightToLeft: true)
        #expect(drawer.isPresented)
        drawer.dragChanged(
            startX: 200, translationX: 250, translationY: 0,
            containerWidth: 400, rightToLeft: true)
        drawer.endDrag(predictedTranslation: 250, width: 300, rightToLeft: true)
        #expect(!drawer.isPresented)
        drawer.dragChanged(
            startX: 10, translationX: -180, translationY: 0,
            containerWidth: 400, rightToLeft: true)
        #expect(!drawer.isDragging)
    }

    @Test func matchesDeviceLanguagesInPreferenceOrder() {
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["es-MX", "en-US"]) == "es")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["es-419"]) == "es")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["en-GB", "es-ES"]) == "en")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["fr-FR", "es-ES"]) == "fr")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["fr-CA", "en-US"]) == "fr")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["de-AT", "en-US"]) == "de")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["de-CH"]) == "de")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["it-CH", "en-US"]) == "it")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["it-IT"]) == "it")
        #expect(
            AppLanguage.system.languageCode(preferredLanguages: ["zh-CN", "en-US"]) == "zh-Hans")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["zh-SG"]) == "zh-Hans")
        #expect(
            AppLanguage.system.languageCode(preferredLanguages: ["zh-Hans-US"]) == "zh-Hans")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["ko-KR", "en-US"]) == "en")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["ja-JP", "en-US"]) == "en")
        #expect(
            AppLanguage.system.languageCode(preferredLanguages: ["sr-Latn-RS", "en-US"])
                == "sr-Latn")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["fr-FR", "ko-KR"]) == "fr")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["ja-JP", "ko-KR"]) == "en")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["en-US", "ko-KR"]) == "en")
        #expect(
            AppLanguage.system.languageCode(preferredLanguages: ["zh-Hant-TW", "es-ES"]) == "es")
        #expect(AppLanguage.system.languageCode(preferredLanguages: ["ja-JP"]) == "en")
        #expect(AppLanguage.system.languageCode(preferredLanguages: []) == "en")
    }

    @Test func overridesDevicePreferenceAndPersistsAcrossLaunches() throws {
        try withDefaults { defaults in
            let systemLanguages = defaults.stringArray(forKey: "AppleLanguages")
            let store = AppLanguageStore(defaults: defaults, preferredLanguages: ["es-MX"])
            #expect(store.preference == .system)
            #expect(store.languageCode == "es")
            store.preference = .english
            #expect(store.languageCode == "en")
            let reopened = AppLanguageStore(defaults: defaults, preferredLanguages: ["es-MX"])
            #expect(reopened.preference == .english)
            #expect(reopened.languageCode == "en")
            reopened.preference = .system
            #expect(reopened.languageCode == "es")
            #expect(defaults.stringArray(forKey: "AppleLanguages") == systemLanguages)
        }
    }

    @Test func invalidSavedLanguageFollowsDevice() throws {
        try withDefaults { defaults in
            defaults.set("unsupported", forKey: AppLanguage.defaultsKey)
            let store = AppLanguageStore(defaults: defaults, preferredLanguages: ["es-ES"])
            #expect(store.preference == .system)
            #expect(store.languageCode == "es")
        }
    }

    @Test func keepsRegionAndCurrencyWhenLanguageChanges() throws {
        try withDefaults { defaults in
            let store = AppLanguageStore(
                defaults: defaults, preferredLanguages: ["es-MX"],
                deviceLocale: Locale(identifier: "en_US"))
            #expect(store.locale.language.languageCode?.identifier == "es")
            #expect(store.locale.region?.identifier == "US")
            #expect(store.locale.currency?.identifier == "USD")
            store.preference = .english
            store.refreshDevicePreferences(
                preferredLanguages: ["es-ES"], deviceLocale: Locale(identifier: "es_ES"))
            #expect(store.languageCode == "en")
            #expect(store.locale.region?.identifier == "ES")
            #expect(store.locale.currency?.identifier == "EUR")
        }
    }

    @Test func modelTextObservesLanguageChangesWithoutRemountingViews() throws {
        try withDefaults { defaults in
            let store = AppLanguageStore(defaults: defaults, preferredLanguages: ["en-US"])
            let changes = Mutex(0)
            withObservationTracking {
                _ = store.locale
            } onChange: {
                changes.withLock { $0 += 1 }
            }
            store.preference = .spanish
            #expect(changes.withLock { $0 } == 1)
            #expect(store.languageCode == "es")
        }
    }

    @Test(arguments: [
        AppLanguage.simplifiedChinese, .serbian, .german, .italian, .french,
    ])
    func persistsNewLanguagesWithoutChangingRegionalPreferences(language: AppLanguage) throws {
        try withDefaults { defaults in
            let store = AppLanguageStore(
                defaults: defaults, preferredLanguages: ["en-US"],
                deviceLocale: Locale(identifier: "en_US"))
            store.preference = language
            let reopened = AppLanguageStore(
                defaults: defaults, preferredLanguages: ["es-MX"],
                deviceLocale: Locale(identifier: "en_US"))
            #expect(reopened.preference == language)
            #expect(reopened.languageCode == language.rawValue)
            #expect(reopened.locale.region?.identifier == "US")
            #expect(reopened.locale.currency?.identifier == "USD")
            if language == .simplifiedChinese {
                #expect(reopened.locale.language.script?.identifier == "Hans")
            } else if language == .serbian {
                #expect(reopened.locale.language.script?.identifier == "Latn")
            }
        }
    }

    @Test(arguments: ["ja", "ko"])
    func unsupportedLanguagesFallBackToSupportedDeviceLanguage(language: String) throws {
        #expect(!AppLanguage.supportedLanguageCodes.contains(language))
        try withDefaults { defaults in
            defaults.set(language, forKey: AppLanguage.defaultsKey)
            let store = AppLanguageStore(
                defaults: defaults, preferredLanguages: [language, "es-ES"],
                deviceLocale: Locale(identifier: "ko_KR"))
            #expect(store.preference == .system)
            #expect(store.languageCode == "es")
            #expect(!store.isRightToLeft)
            #expect(store.locale.region?.identifier == "KR")
            store.refreshDevicePreferences(preferredLanguages: [language])
            #expect(store.languageCode == "en")
            #expect(!store.isRightToLeft)
        }
    }

    @Test func refreshesDeviceLanguageWhileSystemIsSelected() throws {
        try withDefaults { defaults in
            let store = AppLanguageStore(defaults: defaults, preferredLanguages: ["en-US"])
            let changed = Mutex(false)
            withObservationTracking {
                _ = store.locale
            } onChange: {
                changed.withLock { $0 = true }
            }
            store.refreshDevicePreferences(preferredLanguages: ["es-ES"])
            #expect(changed.withLock { $0 })
            #expect(store.languageCode == "es")
            store.preference = .english
            store.refreshDevicePreferences(preferredLanguages: ["es-MX"])
            #expect(store.languageCode == "en")
        }
    }

    @Test func translatesCatalogAndPreservesInterpolatedUserText() {
        let spanish = Locale(identifier: "es_US")
        let english = Locale(identifier: "en_US")
        #expect(L10n.string("Settings", locale: spanish, bundle: catalogBundle) == "Ajustes")
        #expect(L10n.string("Settings", locale: english, bundle: catalogBundle) == "Settings")
        let name = "My groceries 100% 🥑"
        #expect(
            L10n.string("Edit \(name)", locale: spanish, bundle: catalogBundle)
                == "Editar My groceries 100% 🥑")
        #expect(
            L10n.string("Missing translation", locale: spanish, bundle: catalogBundle)
                == "Missing translation")
        #expect(
            L10n.string("Settings", locale: Locale(identifier: "ja_JP"), bundle: catalogBundle)
                == "Settings")
    }

    @Test func usesLanguagePluralRulesForZeroOneAndMany() {
        for (count, english, spanish) in [
            (0, "0 days", "0 días"), (1, "1 day", "1 día"), (3, "3 days", "3 días"),
        ] {
            #expect(
                L10n.string(
                    "\(count) days", locale: Locale(identifier: "en_US"), bundle: catalogBundle)
                    == english)
            #expect(
                L10n.string(
                    "\(count) days", locale: Locale(identifier: "es_US"), bundle: catalogBundle)
                    == spanish)
        }
    }

    @Test(arguments: [
        ("zh-Hans_US", "设置", "编辑 My groceries 100% 🥑"),
        ("sr-Latn_US", "Podešavanja", "Izmeni My groceries 100% 🥑"),
        ("de_US", "Einstellungen", "My groceries 100% 🥑 bearbeiten"),
        ("it_US", "Impostazioni", "Modifica My groceries 100% 🥑"),
        ("fr_US", "Réglages", "Modifier My groceries 100% 🥑"),
    ])
    func translatesNewLanguagesAndPreservesUserText(
        identifier: String, settings: String, edit: String
    ) {
        let locale = Locale(identifier: identifier)
        #expect(L10n.string("Settings", locale: locale, bundle: catalogBundle) == settings)
        let name = "My groceries 100% 🥑"
        #expect(L10n.string("Edit \(name)", locale: locale, bundle: catalogBundle) == edit)
        #expect(
            L10n.string("Missing translation", locale: locale, bundle: catalogBundle)
                == "Missing translation")
    }

    @Test func usesChinesePluralRules() {
        for count in [0, 1, 2, 3, 11, 100] {
            #expect(
                L10n.string(
                    "\(count) days", locale: Locale(identifier: "zh-Hans_US"),
                    bundle: catalogBundle) == "\(count) 天")
        }
    }

    @Test func usesSerbianLatinPluralRulesForCompoundNumbers() {
        for (count, expected) in [
            (1, "1 mesec"), (2, "2 meseca"), (5, "5 meseci"), (11, "11 meseci"),
            (21, "21 mesec"), (22, "22 meseca"), (111, "111 meseci"),
        ] {
            #expect(
                L10n.string(
                    "\(count) months", locale: Locale(identifier: "sr-Latn_US"),
                    bundle: catalogBundle) == expected)
        }
    }

    @Test func usesGermanItalianAndFrenchPluralRules() {
        for (count, german, italian, french) in [
            (0, "0 Tage", "0 giorni", "0 jour"),
            (1, "1 Tag", "1 giorno", "1 jour"),
            (2, "2 Tage", "2 giorni", "2 jours"),
            (21, "21 Tage", "21 giorni", "21 jours"),
        ] {
            for (language, expected) in [("de", german), ("it", italian), ("fr", french)] {
                #expect(
                    L10n.string(
                        "\(count) days", locale: Locale(identifier: "\(language)_US"),
                        bundle: catalogBundle) == expected)
            }
        }
    }

    @Test(arguments: [AppLanguage.german, .italian, .french])
    func preservesDeletionConfirmationKeyword(language: AppLanguage) {
        let instruction = L10n.string(
            "Type DELETE to confirm", locale: Locale(identifier: language.rawValue),
            bundle: catalogBundle)
        #expect(instruction.contains("DELETE"))
        #expect(instruction != "Type DELETE to confirm")
    }

    @Test(arguments: [
        ("es", "Días de visita", "Recordatorios"),
        ("zh-Hans", "签到天数", "提醒"),
        ("sr-Latn", "Dani prijavljivanja", "Podsetnici"),
        ("de", "Tage vorbeigeschaut", "Erinnerungen"),
        ("it", "Giorni di visita", "Promemoria"),
        ("fr", "Jours de visite", "Rappels"),
    ])
    func translatesCheckInHeaderAndReminders(language: String, days: String, reminders: String) {
        let locale = Locale(identifier: language)
        #expect(L10n.string("Days checked in", locale: locale, bundle: catalogBundle) == days)
        #expect(L10n.string("Reminders", locale: locale, bundle: catalogBundle) == reminders)
        let copy: [String.LocalizationValue] = [
            "Day checked in", "Days checked in", "Loading", "Reminders",
            "A moment for your money.",
            "Opening Kualia on iOS or the web counts once a day. Every day adds up, even when you take a break.",
            "Allow reminders", "Open iOS Settings", "Check-in reminders",
            "Remind me to check in", "Make a little time to review your budget.",
            "Reminders follow this device's local time. Turning off notifications also pauses reminders.",
            "Couldn't save your reminders", "Your day count will update when you're connected.",
            "Reset", "Restore all notices dismissed today", "Undo dismissals",
        ]
        for value in copy {
            let translated = L10n.string(value, locale: locale, bundle: catalogBundle)
            #expect(!translated.isEmpty)
            #expect(
                translated
                    != L10n.string(value, locale: Locale(identifier: "en"), bundle: catalogBundle))
        }
    }

    @Test(arguments: AppLanguage.supportedLanguageCodes.filter { $0 != "en" })
    func translatesFundingExplanationWithoutEnglishFallback(language: String) {
        let locale = Locale(identifier: language)
        let percentage = 80
        let copy: [String.LocalizationValue] = [
            "\(percentage)% funded",
            "A new month can need a little less",
            "About target funding",
            "Explains the amounts and how carryover affects your targets",
            "For targets that refill a category to a set amount, unused money carried into the next month can reduce what you need to add. Other target types may still call for their full contribution.",
            "Funded can fall below zero when money is removed from target categories, increasing what's left to add.",
            "How much of the monthly target is funded, rounded down to a whole percent. The bar fills as you get closer to covering this month's targets.",
            "Left to fund",
            "Target totals aren't available for this month yet. The guide below explains how they'll be calculated.",
            "That's why the monthly target can change from month to month, even when you haven't edited your targets.",
            "The combined funding your category targets call for this month, including this month's contributions toward longer-term goals. Categories without targets, snoozed targets, and archived categories are left out.",
            "The extra money still needed to meet your category targets for this month. As you fund those categories, this number goes down.",
            "The percentage",
            "The portion of this month's target need already covered. Extra funding in one category doesn't fill a shortfall in another.",
            "Your category targets set the plan. This card shows how much of this month's funding is covered and what's left to add.",
            "Your targets, explained",
        ]
        for value in copy {
            let translated = L10n.string(value, locale: locale, bundle: catalogBundle)
            #expect(!translated.isEmpty)
            #expect(
                translated
                    != L10n.string(
                        value, locale: Locale(identifier: "en"), bundle: catalogBundle))
            #expect(!translated.contains("%lld"))
        }
    }

    @Test func packagedCatalogHasMatchingCoverageForEverySupportedLanguage() throws {
        func strings(_ language: String) throws -> [String: String] {
            let resource = try #require(
                catalogBundle.localizations.first {
                    $0.caseInsensitiveCompare(language) == .orderedSame
                })
            let path = try #require(catalogBundle.path(forResource: resource, ofType: "lproj"))
            let data = try Data(
                contentsOf: URL(filePath: path).appending(path: "Localizable.strings"))
            return try PropertyListDecoder().decode([String: String].self, from: data)
        }
        let english = try strings("en")
        #expect(!english.isEmpty)
        for language in AppLanguage.supportedLanguageCodes where language != "en" {
            let localized = try strings(language)
            #expect(Set(english.keys).subtracting(localized.keys).isEmpty)
            #expect(Set(localized.keys).subtracting(english.keys).isEmpty)
            #expect(localized.values.allSatisfy { !$0.isEmpty })
        }
    }

    @Test(arguments: AppLanguage.supportedLanguageCodes)
    func translatesScreenshotDemoCopyAndPreservesFormattedValues(language: String) {
        let locale = Locale(identifier: language)
        let copy: [String.LocalizationValue] = [
            "Developer", "Screenshot demo", "Explore a populated workspace with sample data.",
            "A look at your budget", "How is my budget looking?",
        ]
        for value in copy {
            let translated = L10n.string(value, locale: locale, bundle: catalogBundle)
            #expect(!translated.isEmpty)
            if language != "en" {
                #expect(
                    translated
                        != L10n.string(
                            value, locale: Locale(identifier: "en"), bundle: catalogBundle))
            }
        }
        let amount = "150,00 US$"
        let reply: String.LocalizationValue =
            "Your everyday essentials have money assigned, and your emergency fund is growing. Your next adventure still needs \(amount) this month. Open Reports to explore your spending, income, and cash flow."
        let translatedReply = L10n.string(reply, locale: locale, bundle: catalogBundle)
        #expect(translatedReply.contains(amount))
        #expect(!translatedReply.contains("%@"))
        if language != "en" {
            #expect(
                translatedReply
                    != L10n.string(reply, locale: Locale(identifier: "en"), bundle: catalogBundle))
        }
        let name = "Morgan"
        let family = L10n.string("\(name)'s Family", locale: locale, bundle: catalogBundle)
        #expect(family.contains(name))
        if language != "en" { #expect(family != "Morgan's Family") }
    }

    @Test(arguments: AppLanguage.supportedLanguageCodes.filter { $0 != "en" })
    func translatesPreviouslyMissingAppAndWidgetCopy(language: String) {
        let copy: [String.LocalizationValue] = [
            "Merge merchants", "Choose a logo", "Search planned transactions",
            "Couldn't load merchants. Please try again.", "Open merchant details",
            "Your merchants, activity, and logos", "Clear search", "Remove logo",
            "Paper", "Stone", "Midnight", "Add expense in Kualia",
            "Open Kualia to connect your widgets.", "Tap to cycle",
            "accounts", "categories", "workspaces", "delete",
        ]
        for value in copy {
            let translated = L10n.string(
                value, locale: Locale(identifier: language), bundle: catalogBundle)
            #expect(!translated.isEmpty)
            #expect(
                translated
                    != L10n.string(
                        value, locale: Locale(identifier: "en"), bundle: catalogBundle))
        }
    }

    @Test func usesPluralRulesForMerchantCountsAndWidgetAttention() {
        for (count, merchant, attention) in [
            (1, "1 merchant", "1 category needs attention"),
            (2, "2 merchants", "2 categories need attention"),
        ] {
            #expect(
                L10n.string(
                    "\(count) merchants", locale: Locale(identifier: "en"),
                    bundle: catalogBundle) == merchant)
            #expect(
                L10n.string(
                    "\(count) categories need attention", locale: Locale(identifier: "en"),
                    bundle: catalogBundle) == attention)
        }
        for (count, expected) in [
            (1, "1 trgovac"), (2, "2 trgovca"), (5, "5 trgovaca"), (21, "21 trgovac"),
        ] {
            #expect(
                L10n.string(
                    "\(count) merchants", locale: Locale(identifier: "sr-Latn"),
                    bundle: catalogBundle) == expected)
        }
    }

    @Test func widgetCurrencyUsesTheChosenLocaleWithoutChangingTheAmount() {
        let english = WidgetCurrencyFormatter.format(
            123456, currencyCode: "USD", locale: Locale(identifier: "en_US"))
        let german = WidgetCurrencyFormatter.format(
            123456, currencyCode: "USD", locale: Locale(identifier: "de_DE"))
        #expect(english.contains("1,234.56"))
        #expect(german.contains("1.234,56"))
        #expect(german.contains("$"))
        #expect(
            WidgetCurrencyFormatter.formatAbsolute(
                -123456, currencyCode: "USD", locale: Locale(identifier: "de_DE")) == german)
    }

    private var catalogBundle: Bundle {
        #if SWIFT_PACKAGE
            Bundle.module
        #else
            Bundle.main
        #endif
    }

    private func withDefaults(_ body: (UserDefaults) throws -> Void) throws {
        let suite = "AppLanguageTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        try body(defaults)
    }
}
