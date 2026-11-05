import Foundation
import Security

/// Shared storage layer for communication between the main app and widget extension.
/// Uses App Group UserDefaults for non-sensitive data and Keychain for the widget token.
nonisolated enum WidgetSharedStorage {
    private static let suiteName = "group.com.kualia.app"
    private static let keychainService = "com.kualia.widget-token"

    // MARK: - UserDefaults Keys

    private enum Keys {
        static let workspaceId = "widget_workspaceId"
        static let workspaceName = "widget_workspaceName"
        static let currencyCode = "widget_currencyCode"
        static let convexUrl = "widget_convexUrl"
        static let categories = "widget_categories"
        static let accounts = "widget_accounts"
        static let timezone = "widget_timezone"
        static let locale = "widget_locale"
    }

    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    /// Keep the selected app language and region when the extension runs independently.
    static var localeIdentifier: String? {
        get { sharedDefaults?.string(forKey: Keys.locale) }
        set { sharedDefaults?.set(newValue, forKey: Keys.locale) }
    }

    static var locale: Locale {
        localeIdentifier.map(Locale.init(identifier:)) ?? L10n.locale
    }

    // MARK: - Workspace Info

    static var workspaceId: String? {
        get { sharedDefaults?.string(forKey: Keys.workspaceId) }
        set { sharedDefaults?.set(newValue, forKey: Keys.workspaceId) }
    }

    static var workspaceName: String? {
        get { sharedDefaults?.string(forKey: Keys.workspaceName) }
        set { sharedDefaults?.set(newValue, forKey: Keys.workspaceName) }
    }

    static var currencyCode: String {
        get { sharedDefaults?.string(forKey: Keys.currencyCode) ?? "USD" }
        set { sharedDefaults?.set(newValue, forKey: Keys.currencyCode) }
    }

    static var convexUrl: String? {
        get { sharedDefaults?.string(forKey: Keys.convexUrl) }
        set { sharedDefaults?.set(newValue, forKey: Keys.convexUrl) }
    }

    static var timezoneIdentifier: String? {
        get { sharedDefaults?.string(forKey: Keys.timezone) }
        set { sharedDefaults?.set(newValue, forKey: Keys.timezone) }
    }

    // MARK: - Category List (for widget configuration intent)

    /// Simplified category info for widget intent configuration
    struct WidgetCategory: Codable, Equatable {
        let id: String
        let name: String
        let groupName: String
    }

    static var categories: [WidgetCategory] {
        get {
            let defaults = sharedDefaults
            defaults?.synchronize()
            guard let data = defaults?.data(forKey: Keys.categories) else { return [] }
            return (try? JSONDecoder().decode([WidgetCategory].self, from: data)) ?? []
        }
        set {
            let defaults = sharedDefaults
            let data = try? JSONEncoder().encode(newValue)
            defaults?.set(data, forKey: Keys.categories)
            defaults?.synchronize()
        }
    }

    /// Simplified account info for widget intent configuration
    struct WidgetAccount: Codable, Equatable {
        let id: String
        let name: String
        let category: String  // "banking", "credit", "investment", "loan"
    }

    static var accounts: [WidgetAccount] {
        get {
            let defaults = sharedDefaults
            defaults?.synchronize()
            guard let data = defaults?.data(forKey: Keys.accounts) else { return [] }
            return (try? JSONDecoder().decode([WidgetAccount].self, from: data)) ?? []
        }
        set {
            let defaults = sharedDefaults
            let data = try? JSONEncoder().encode(newValue)
            defaults?.set(data, forKey: Keys.accounts)
            defaults?.synchronize()
        }
    }

    // MARK: - Widget Token (Keychain)

    static var widgetToken: String? {
        get { readFromKeychain(key: "widget_token") }
        set {
            if let value = newValue {
                saveToKeychain(key: "widget_token", value: value)
            } else {
                deleteFromKeychain(key: "widget_token")
            }
        }
    }

    /// Clear all widget shared data (called on sign out)
    static func clearAll() {
        sharedDefaults?.removeObject(forKey: Keys.workspaceId)
        sharedDefaults?.removeObject(forKey: Keys.workspaceName)
        sharedDefaults?.removeObject(forKey: Keys.currencyCode)
        sharedDefaults?.removeObject(forKey: Keys.convexUrl)
        sharedDefaults?.removeObject(forKey: Keys.categories)
        sharedDefaults?.removeObject(forKey: Keys.accounts)
        sharedDefaults?.removeObject(forKey: Keys.timezone)
        deleteFromKeychain(key: "widget_token")
    }

    // MARK: - Keychain Helpers

    private static func saveToKeychain(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }

        // Delete existing item first
        deleteFromKeychain(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessGroup as String: suiteName,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        SecItemAdd(query as CFDictionary, nil)
    }

    private static func readFromKeychain(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: suiteName,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func deleteFromKeychain(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: suiteName,
        ]

        SecItemDelete(query as CFDictionary)
    }
}

/// Widget timelines also resolve model copy outside SwiftUI's locale environment.
nonisolated enum WidgetL10n {
    static func string(_ value: String.LocalizationValue) -> String {
        L10n.string(value, locale: WidgetSharedStorage.locale)
    }
}
