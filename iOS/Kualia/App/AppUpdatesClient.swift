import Combine
import ConvexMobile
import Foundation

extension AppUpdatesClient {
    static func live(_ client: ConvexClientWithAuth<String>) -> Self {
        Self(
            watchStatus: {
                client.subscribe(
                    to: "systemStatus/queries:getSystemStatus", yielding: AppSystemStatus.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            watchChangelog: {
                client.subscribe(
                    to: "appChangelog:getLatestChangelog", yielding: AppChangelog?.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            signedChangelogURL: { nil })
    }
}
