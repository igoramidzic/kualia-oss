import Foundation

enum AppEnvironment {
    case development
    case production

    static let appStoreURL = URL(string: "https://apps.apple.com/app/kualia/id6466455367")!

    static var current: AppEnvironment {
        #if DEBUG
            .development
        #else
            .production
        #endif
    }

    var clerkPublishableKey: String {
        switch self {
        case .development:
            ""
        case .production:
            ""
        }
    }

    var convexDeploymentURL: String {
        switch self {
        case .development:
            "http://127.0.0.1:3210"
        case .production:
            "http://127.0.0.1:3210"
        }
    }

    /// Archived client: configure your own provider before building.
    var revenueCatAPIKey: String { "" }
}
