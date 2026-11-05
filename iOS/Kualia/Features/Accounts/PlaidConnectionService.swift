import Foundation
import LinkKit
import UIKit

struct PlaidConnectionSelectedAccount: Sendable {
    let id: String
    let name: String
    let type: String
    let subtype: String
    let mask: String
}

struct PlaidConnectionResult: Sendable {
    let publicToken: String
    let institutionID: String
    let institutionName: String
    let accounts: [PlaidConnectionSelectedAccount]

    var selectedAccountIDs: [String] { accounts.map(\.id) }
}

enum PlaidConnectionError: LocalizedError {
    case alreadyConnecting
    case presentationUnavailable
    case loadingTimedOut
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .alreadyConnecting:
            L10n.string("A bank connection is already in progress.")
        case .presentationUnavailable:
            L10n.string("The bank sign-in screen could not open. Please try again.")
        case .loadingTimedOut:
            L10n.string("Plaid is taking too long to open. Check your connection and try again.")
        case .unavailable(let message):
            message
        }
    }
}

@MainActor
final class PlaidConnectionService {
    private var session: PlaidLinkSession?
    private var activeFlowID: UUID?
    private var continuation: CheckedContinuation<PlaidConnectionResult?, Error>?
    private var loadingTimeout: Task<Void, Never>?
    private var onEvent: ((String) -> Void)?
    private weak var linkViewController: UIViewController?
    private var isPresenting = false

    func connect(
        linkToken: String,
        onEvent: @escaping (String) -> Void
    ) async throws -> PlaidConnectionResult? {
        guard activeFlowID == nil else { throw PlaidConnectionError.alreadyConnecting }
        try Task.checkCancellation()
        let flowID = UUID()
        activeFlowID = flowID

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                self.onEvent = onEvent
                start(linkToken: linkToken, flowID: flowID)
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.finish(.failure(CancellationError()), flowID: flowID)
            }
        }
    }

    func cancel() {
        guard let activeFlowID else { return }
        finish(.success(nil), flowID: activeFlowID)
    }

    private func start(linkToken: String, flowID: UUID) {
        guard presentingController() != nil else {
            finish(.failure(PlaidConnectionError.presentationUnavailable), flowID: flowID)
            return
        }

        onEvent?(L10n.string("Opening secure bank sign-in"))
        let configuration = LinkTokenConfiguration(
            token: linkToken,
            onSuccess: { [weak self] success in
                Task { @MainActor in
                    self?.complete(success, flowID: flowID)
                }
            },
            onExit: { [weak self] exit in
                Task { @MainActor in
                    if let error = exit.error {
                        let message =
                            error.displayMessage
                            ?? L10n.string(
                                "The bank connection could not finish. Please try again.")
                        self?.finish(
                            .failure(PlaidConnectionError.unavailable(message)), flowID: flowID)
                    } else {
                        self?.finish(.success(nil), flowID: flowID)
                    }
                }
            },
            onEvent: { [weak self] event in
                // Most Link events are delivered in batches. Only OPEN is a reliable
                // live status; never turn credential or account metadata into Peek text.
                guard event.eventName == .open else { return }
                Task { @MainActor in
                    guard self?.activeFlowID == flowID else { return }
                    self?.onEvent?(L10n.string("Connect securely with Plaid"))
                }
            },
            onLoad: { [weak self] in
                Task { @MainActor in
                    self?.present(flowID: flowID)
                }
            }
        )

        do {
            session = try Plaid.createPlaidLinkSession(configuration: configuration)
            loadingTimeout = Task { [weak self] in
                do {
                    try await Task.sleep(for: .seconds(45))
                } catch {
                    return
                }
                self?.finish(.failure(PlaidConnectionError.loadingTimedOut), flowID: flowID)
            }
        } catch {
            finish(
                .failure(
                    PlaidConnectionError.unavailable(
                        L10n.string("Plaid could not open. Please try again."))),
                flowID: flowID
            )
        }
    }

    private func present(flowID: UUID) {
        guard activeFlowID == flowID, !isPresenting, let session else { return }
        isPresenting = true

        session.open(
            using: .custom(
                { [weak self] controller in
                    Task { @MainActor in
                        guard let self, self.activeFlowID == flowID else { return }
                        guard let presenter = self.presentingController() else {
                            self.finish(
                                .failure(PlaidConnectionError.presentationUnavailable),
                                flowID: flowID)
                            return
                        }
                        self.linkViewController = controller
                        controller.isModalInPresentation = true
                        // Keep the SwiftUI account flow mounted while Plaid owns bank sign-in.
                        controller.modalPresentationStyle = .overFullScreen
                        presenter.present(controller, animated: true) {
                            guard self.activeFlowID == flowID else { return }
                            self.loadingTimeout?.cancel()
                            self.loadingTimeout = nil
                        }
                    }
                },
                { controller in
                    Task { @MainActor in
                        controller.dismiss(animated: true)
                    }
                }))
    }

    private func complete(_ success: LinkSuccess, flowID: UUID) {
        let accounts = success.metadata.accounts.map { account in
            PlaidConnectionSelectedAccount(
                id: account.id,
                name: account.name,
                type: account.subtype.type,
                subtype: subtypeName(account.subtype),
                mask: account.mask ?? ""
            )
        }
        let result = PlaidConnectionResult(
            publicToken: success.publicToken,
            institutionID: success.metadata.institution.id,
            institutionName: success.metadata.institution.name,
            accounts: accounts
        )
        finish(.success(result), flowID: flowID)
    }

    private func subtypeName(_ subtype: AccountSubtype) -> String {
        switch subtype {
        case .depository(let value): value.description
        case .credit(let value): value.description
        case .loan(let value): value.description
        case .investment(let value): value.description
        case .other(let value): value.description
        case .unknown(_, let value): value
        @unknown default: subtype.description
        }
    }

    private func finish(_ result: Result<PlaidConnectionResult?, Error>, flowID: UUID) {
        guard activeFlowID == flowID, let continuation else { return }
        activeFlowID = nil
        isPresenting = false
        self.continuation = nil
        onEvent = nil
        loadingTimeout?.cancel()
        loadingTimeout = nil

        let retainedSession = session
        session = nil
        let controller = linkViewController
        linkViewController = nil

        var didResume = false
        let resume = {
            guard !didResume else { return }
            didResume = true
            withExtendedLifetime(retainedSession) {
                continuation.resume(with: result)
            }
        }
        if let controller, controller.presentingViewController != nil {
            if controller.isBeingDismissed, let transition = controller.transitionCoordinator {
                let accepted = transition.animate(alongsideTransition: nil) { _ in resume() }
                if !accepted { resume() }
            } else {
                controller.dismiss(animated: true, completion: resume)
            }
        } else {
            resume()
        }
    }

    private func presentingController() -> UIViewController? {
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows)
            .filter(\.isKeyWindow)
        // A single active key window is unambiguous, including while a sheet is open.
        guard windows.count == 1, var controller = windows.first?.rootViewController else {
            return nil
        }
        while let presented = controller.presentedViewController {
            controller = presented
        }
        guard controller.viewIfLoaded?.window != nil,
            !controller.isBeingDismissed,
            !controller.isBeingPresented
        else { return nil }
        return controller
    }
}
