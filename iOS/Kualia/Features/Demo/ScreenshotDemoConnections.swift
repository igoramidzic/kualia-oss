#if DEBUG
    import Foundation

    extension ScreenshotDemoData {
        var bankConnectionExamples: [BankConnectionSnapshot] {
            accounts.map { account in
                let disconnected = account.id == "amex"
                return BankConnectionSnapshot(
                    id: "demo-connection-\(account.id)", provider: "plaid",
                    displayName: account.institutionName ?? account.name,
                    logoUrl: account.resolvedLogoUrl,
                    status: disconnected ? "disconnected" : "connected",
                    statusLabel: disconnected
                        ? L10n.string("Disconnected") : L10n.string("Connected"),
                    canManageConnection: true,
                    isOwnedByCurrentUser: true,
                    accounts: [
                        .init(
                            id: "demo-bank-\(account.id)",
                            ref: .init(provider: "plaid", accountId: "demo-bank-\(account.id)"),
                            name: account.name, accountType: account.accountType,
                            accountNumberMask: account.accountNumberMask,
                            initialBalance: account.currentBalance, isLinked: true,
                            linkedToBankAccount: .init(id: account.id, name: account.name),
                            hasCompletedInitialSync: true)
                    ], lastSyncedAt: today + "T12:00:00Z",
                    reauthorization: account.id == "chase"
                        ? .init(reason: "connection_expiring") : nil)
            }
        }

        func makeConnections(purpose: AccountConnectionPurpose) -> AccountConnectionStore {
            let connections = bankConnectionExamples
            return .init(
                workspace: feedWorkspace, purpose: purpose,
                subscription: { _ in Self.publisher(connections) },
                createToken: { throw ScreenshotDemoError.unavailable },
                authorize: { _ in throw ScreenshotDemoError.unavailable },
                exchange: { _, _, _ in throw ScreenshotDemoError.unavailable },
                save: { _ in throw ScreenshotDemoError.unavailable },
                currentAccounts: { self.accounts })
        }
    }
#endif
