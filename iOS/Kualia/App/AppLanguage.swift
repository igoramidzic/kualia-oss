import Foundation
import Observation
import Synchronization

/// Persist an app preference without changing Apple's process-wide language defaults.
nonisolated enum AppLanguage: String, CaseIterable, Identifiable, Sendable {
    case system
    case english = "en"
    case spanish = "es"
    case german = "de"
    case italian = "it"
    case french = "fr"
    case simplifiedChinese = "zh-Hans"
    case serbian = "sr-Latn"

    static let defaultsKey = "settings.language"
    static let supportedLanguageCodes = allCases.filter { $0 != .system }.map(\.rawValue)
    var id: String { rawValue }

    static func resolve(_ value: String?) -> Self {
        value.flatMap(Self.init(rawValue:)) ?? .system
    }

    func languageCode(preferredLanguages: [String]) -> String {
        guard self == .system else { return rawValue }
        return Bundle.preferredLocalizations(
            from: Self.supportedLanguageCodes, forPreferences: preferredLanguages
        ).first ?? "en"
    }

    var title: String {
        switch self {
        case .system: L10n.string("Device language")
        case .english: "English"
        case .spanish: "Español"
        case .german: "Deutsch"
        case .italian: "Italiano"
        case .french: "Français"
        case .simplifiedChinese: "简体中文"
        case .serbian: "Srpski"
        }
    }
}

/// Observable even when a presentation model resolves text outside a View.
/// The lock also permits localized error descriptions on background tasks.
nonisolated final class AppLanguageStore: Observable, @unchecked Sendable {
    static let shared = AppLanguageStore()

    private struct State {
        var preference: AppLanguage
        var preferredLanguages: [String]
        var deviceLocale: Locale
    }

    private let registrar = ObservationRegistrar()
    private let state: Mutex<State>
    private let defaults: UserDefaults

    init(
        defaults: UserDefaults = .standard,
        preferredLanguages: [String] = Locale.preferredLanguages,
        deviceLocale: Locale = .current
    ) {
        self.defaults = defaults
        state = Mutex(
            State(
                preference: AppLanguage.resolve(defaults.string(forKey: AppLanguage.defaultsKey)),
                preferredLanguages: preferredLanguages, deviceLocale: deviceLocale))
    }

    var preference: AppLanguage {
        get {
            registrar.access(self, keyPath: \.preference)
            return state.withLock { $0.preference }
        }
        set {
            guard preference != newValue else { return }
            registrar.withMutation(of: self, keyPath: \.preference) {
                state.withLock { $0.preference = newValue }
                defaults.set(newValue.rawValue, forKey: AppLanguage.defaultsKey)
            }
        }
    }

    var locale: Locale {
        // Observe both changes to the override and changes to the device preferences.
        _ = preference
        registrar.access(self, keyPath: \.locale)
        return state.withLock { state in
            var components = Locale.Components(locale: state.deviceLocale)
            components.languageComponents = Locale.Language.Components(
                identifier: state.preference.languageCode(
                    preferredLanguages: state.preferredLanguages))
            components.languageComponents.region = state.deviceLocale.region
            return Locale(components: components)
        }
    }

    var languageCode: String {
        AppLanguage.system.languageCode(preferredLanguages: [locale.identifier])
    }

    var isRightToLeft: Bool { locale.language.characterDirection == .rightToLeft }

    func refreshDevicePreferences(
        preferredLanguages: [String] = Locale.preferredLanguages,
        deviceLocale: Locale = .current
    ) {
        let changed = state.withLock {
            $0.preferredLanguages != preferredLanguages || $0.deviceLocale != deviceLocale
        }
        guard changed else { return }
        registrar.withMutation(of: self, keyPath: \.locale) {
            state.withLock {
                $0.preferredLanguages = preferredLanguages
                $0.deviceLocale = deviceLocale
            }
        }
    }
}

/// Only app-authored copy belongs here. Names, notes, IDs and provider data stay verbatim.
/// String.LocalizationValue preserves interpolation for translation and plural rules.
nonisolated enum L10n {
    static var locale: Locale { AppLanguageStore.shared.locale }

    private static let languageBundles: [String: Bundle] = Dictionary(
        uniqueKeysWithValues: AppLanguage.supportedLanguageCodes.compactMap { code in
            guard let bundle = localizedBundle(for: code, in: .main) else { return nil }
            return (code, bundle)
        })

    private static func localizedBundle(for languageCode: String, in bundle: Bundle) -> Bundle? {
        // Resource packagers may normalize script tags to lowercase (zh-hans, sr-latn).
        let resource =
            bundle.localizations.first {
                $0.caseInsensitiveCompare(languageCode) == .orderedSame
            } ?? languageCode
        return bundle.path(forResource: resource, ofType: "lproj").flatMap(Bundle.init(path:))
    }

    static func string(
        _ value: String.LocalizationValue,
        locale: Locale = L10n.locale,
        bundle: Bundle = .main
    ) -> String {
        let languageCode = AppLanguage.system.languageCode(preferredLanguages: [locale.identifier])
        let localizedBundle =
            bundle == .main
            ? languageBundles[languageCode] ?? bundle
            : Self.localizedBundle(for: languageCode, in: bundle) ?? bundle
        return String(localized: value, bundle: localizedBundle, locale: locale)
    }
}
