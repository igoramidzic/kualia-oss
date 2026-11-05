import ConvexMobile
import Foundation
import Observation
import WidgetKit

struct WidgetSessionContext: Equatable {
    let sessionID: String
    let workspaceID: String
    let workspaceName: String
    let currencyCode: String
    let timezoneIdentifier: String?
    let categories: [WidgetSharedStorage.WidgetCategory]
    let accounts: [WidgetSharedStorage.WidgetAccount]
    let budgetSnapshotRevision: Int
    let accountBalances: [String: Int64]
    let plannedData: PlannedData?
}

/// Serial token creation prevents a late refresh from revoking the current token.
/// Catalogs and credentials are removed before a different workspace is published.
@MainActor
@Observable
final class WidgetSessionBridge {
    private var context: WidgetSessionContext?
    private var generation = UUID()
    private var isSigningOut = false
    private var isApplicationActive = true
    private var tokenAttempt = UUID()
    private var tokenTask: Task<Void, Never>?
    private var tokenTaskGeneration: UUID?
    private var reloadTask: Task<Void, Never>?
    private let client: ConvexClientWithAuth<String>

    init(client: ConvexClientWithAuth<String>) { self.client = client }

    func update(_ next: WidgetSessionContext?) {
        if isSigningOut, next != nil {
            context = next
            return
        }
        if next == nil { isSigningOut = false }
        let scopeChanged =
            context?.sessionID != next?.sessionID || context?.workspaceID != next?.workspaceID
        context = next
        if scopeChanged || next == nil {
            cancelPendingReload()
            generation = UUID()
            WidgetSharedStorage.clearAll()
            WidgetCenter.shared.reloadAllTimelines()
        }
        guard let next else { return }
        WidgetSharedStorage.workspaceId = next.workspaceID
        WidgetSharedStorage.workspaceName = next.workspaceName
        WidgetSharedStorage.currencyCode = next.currencyCode
        WidgetSharedStorage.timezoneIdentifier = next.timezoneIdentifier
        WidgetSharedStorage.convexUrl = AppEnvironment.current.convexDeploymentURL
        WidgetSharedStorage.categories = next.categories
        WidgetSharedStorage.accounts = next.accounts
        if scopeChanged || (WidgetSharedStorage.widgetToken == nil && tokenTask == nil) {
            createToken()
        } else {
            reload()
        }
    }

    #if DEBUG
        /// Detach the foreground app without replacing the user's widget catalogs or credentials.
        func suspendForPreview() {
            context = nil
            generation = UUID()
            tokenTask?.cancel()
            tokenTask = nil
            cancelPendingReload()
        }
    #endif

    func refresh() {
        guard context != nil, !isSigningOut else { return }
        // Refresh on foreground also repairs a token revoked by another app install.
        createToken()
    }

    func setApplicationActive(_ active: Bool) {
        isApplicationActive = active
        // Submit the request before iOS can suspend a coalesced foreground refresh.
        if !active, reloadTask != nil { reload() }
    }

    func prepareForSignOut() async {
        isSigningOut = true
        cancelPendingReload()
        generation = UUID()
        tokenAttempt = UUID()
        let pending = tokenTask
        tokenTask = nil
        WidgetSharedStorage.clearAll()
        WidgetCenter.shared.reloadAllTimelines()
        await pending?.value
        // Drain any issuance before revocation, while the app still has auth.
        let _: String? = try? await client.mutation("widgets:revokeAllWidgetTokens")
        _ = PendingAppActionStore.consume()
    }

    func resumeAfterSignOutFailure() {
        isSigningOut = false
        update(context)
    }

    private func createToken() {
        guard let context else { return }
        // Foreground and catalog callbacks can arrive while issuance is still pending.
        // Join the current scope's request instead of queueing another mutation.
        guard tokenTask == nil || tokenTaskGeneration != generation else { return }
        let generation = generation
        tokenTaskGeneration = generation
        tokenAttempt = UUID()
        let attempt = tokenAttempt
        let previous = tokenTask
        tokenTask = Task { [weak self, client] in
            await previous?.value
            guard let self, self.generation == generation else { return }
            do {
                let token: String = try await client.mutation(
                    "widgets:createOrRefreshWidgetToken",
                    with: ["workspaceId": context.workspaceID, "reuseExisting": true]
                )
                guard self.generation == generation else { return }
                if WidgetSharedStorage.widgetToken != token {
                    WidgetSharedStorage.widgetToken = token
                    WidgetCenter.shared.reloadAllTimelines()
                } else {
                    // A valid reused token must still refresh data on foreground.
                    self.reload()
                }
            } catch {
                // A failed setup leaves widgets in their explicit sign-in/retry state.
            }
            if self.tokenAttempt == attempt { self.tokenTask = nil }
        }
    }

    func reload() {
        guard context != nil, !isSigningOut else { return }
        if !isApplicationActive {
            cancelPendingReload()
            WidgetCenter.shared.reloadAllTimelines()
            return
        }
        guard reloadTask == nil else { return }
        reloadTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            guard let self else { return }
            WidgetCenter.shared.reloadAllTimelines()
            self.reloadTask = nil
        }
    }

    private func cancelPendingReload() {
        reloadTask?.cancel()
        reloadTask = nil
    }
}
