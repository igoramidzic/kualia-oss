import Foundation

struct AppReleaseVersion: Comparable {
    let components: [Int]

    init?(_ value: String) {
        let parts = value.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: ".", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count),
            parts.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) } })
        else { return nil }
        let numbers = parts.compactMap { Int($0) }
        guard numbers.count == parts.count else { return nil }
        components = numbers + Array(repeating: 0, count: 3 - numbers.count)
    }

    static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.components.lexicographicallyPrecedes(rhs.components)
    }
}

struct AppSystemStatus: Decodable, Equatable {
    var maintenanceMode = false
    var maintenanceMessage: String?
    var minIosVersion: String?
    var iosUpdateMessage: String?

    func blocker(currentVersion: String) -> AppStatusBlocker? {
        if maintenanceMode {
            return .maintenance(
                message: Self.message(
                    maintenanceMessage,
                    fallback: L10n.string(
                        "We're currently performing maintenance. Please check back shortly.")))
        }
        if let minIosVersion, let minimum = AppReleaseVersion(minIosVersion),
            let current = AppReleaseVersion(currentVersion), current < minimum
        {
            return .updateRequired(
                message: Self.message(
                    iosUpdateMessage,
                    fallback: L10n.string("Please update Kualia to the latest version to continue.")
                ),
                minimumVersion: minIosVersion)
        }
        return nil
    }

    private static func message(_ value: String?, fallback: String) -> String {
        let value = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? fallback : value
    }
}

enum AppStatusBlocker: Equatable {
    case maintenance(message: String)
    case updateRequired(message: String, minimumVersion: String)

    var message: String {
        switch self {
        case .maintenance(let message), .updateRequired(let message, _): message
        }
    }
}

struct AppChangelog: Decodable, Equatable {
    let version: String
    let changelogUrl: String

    var url: URL? { Self.validatedURL(changelogUrl) }

    func signedURL(_ value: String?) -> URL? {
        guard let value, let signed = Self.validatedURL(value), let url,
            signed.path == url.path,
            let components = URLComponents(url: signed, resolvingAgainstBaseURL: false),
            components.queryItems?.contains(where: {
                $0.name == "clientToken" && $0.value?.isEmpty == false
            }) == true
        else { return nil }
        return signed
    }

    private static func validatedURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https",
            url.host == "feedback.kualia.com", url.user == nil, url.password == nil,
            url.port == nil || url.port == 443
        else { return nil }
        return url
    }
}

struct AppChangelogPresentation: Identifiable {
    let changelog: AppChangelog
    let url: URL
    var id: String { changelog.version }
}
