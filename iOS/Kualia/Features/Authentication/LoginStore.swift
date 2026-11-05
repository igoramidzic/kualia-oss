import AuthenticationServices
import ClerkKit
import Foundation
import Observation

enum LoginProvider: String, Sendable {
    case apple
    case google

    var name: String { self == .apple ? "Apple" : "Google" }
}

enum LoginVerificationMethod: String, CaseIterable, Identifiable, Sendable {
    case authenticator
    case email
    case textMessage
    case backupCode

    var id: String { rawValue }

    var title: String {
        switch self {
        case .authenticator: L10n.string("Authenticator app")
        case .email: L10n.string("Email code")
        case .textMessage: L10n.string("Text message")
        case .backupCode: L10n.string("Backup code")
        }
    }

    var instruction: String {
        switch self {
        case .authenticator: L10n.string("Enter the code from your authenticator app.")
        case .email: L10n.string("Enter the code we sent to your email.")
        case .textMessage: L10n.string("Enter the code we sent to your phone.")
        case .backupCode: L10n.string("Enter one of your saved backup codes.")
        }
    }
}

enum LoginContinuation: Equatable, Sendable {
    case welcome
    case profile(firstName: Bool, lastName: Bool, legal: Bool)
    case verification(methods: [LoginVerificationMethod])
    case complete
}

@MainActor
protocol LoginAuthenticating {
    func signIn(provider: LoginProvider) async throws -> LoginContinuation
    func completeProfile(firstName: String, lastName: String, legalAccepted: Bool) async throws
        -> LoginContinuation
    func prepareVerification(_ method: LoginVerificationMethod) async throws
    func verify(_ code: String, method: LoginVerificationMethod) async throws -> LoginContinuation
}

@MainActor
@Observable
final class LoginStore {
    private(set) var continuation = LoginContinuation.welcome
    private(set) var isWorking = false
    private(set) var activeProvider: LoginProvider?
    private(set) var verificationMethod: LoginVerificationMethod?
    private(set) var errorMessage: String?
    private(set) var canResendAt = Date.distantPast
    var firstName = ""
    var lastName = ""
    var legalAccepted = false
    var code = ""

    @ObservationIgnored private let authenticator: LoginAuthenticating

    init(authenticator: LoginAuthenticating? = nil) {
        self.authenticator = authenticator ?? ClerkLoginAuthenticator()
    }

    var canCompleteProfile: Bool {
        guard case .profile(let needsFirst, let needsLast, let needsLegal) = continuation else {
            return false
        }
        return (!needsFirst || !firstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            && (!needsLast || !lastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            && (!needsLegal || legalAccepted)
    }

    func signIn(with provider: LoginProvider) async {
        guard !isWorking else { return }
        activeProvider = provider
        await perform {
            try await advance(authenticator.signIn(provider: provider))
        }
        activeProvider = nil
    }

    func completeProfile() async {
        guard canCompleteProfile else { return }
        await perform {
            try await advance(
                authenticator.completeProfile(
                    firstName: firstName.trimmingCharacters(in: .whitespacesAndNewlines),
                    lastName: lastName.trimmingCharacters(in: .whitespacesAndNewlines),
                    legalAccepted: legalAccepted))
        }
    }

    func selectVerification(_ method: LoginVerificationMethod) async {
        await perform {
            try await prepareVerification(method)
        }
    }

    func resendCode() async {
        guard Date() >= canResendAt, let verificationMethod else { return }
        await selectVerification(verificationMethod)
    }

    func verifyCode() async {
        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCode.isEmpty, let verificationMethod else { return }
        await perform {
            try await advance(authenticator.verify(trimmedCode, method: verificationMethod))
        }
    }

    func startOver() {
        guard !isWorking else { return }
        continuation = .welcome
        verificationMethod = nil
        code = ""
        firstName = ""
        lastName = ""
        legalAccepted = false
        errorMessage = nil
    }

    private func advance(_ next: LoginContinuation) async throws {
        continuation = next
        if case .verification(let methods) = next, let first = methods.first {
            try await prepareVerification(first)
        }
    }

    private func prepareVerification(_ method: LoginVerificationMethod) async throws {
        try await authenticator.prepareVerification(method)
        verificationMethod = method
        code = ""
        canResendAt = Date().addingTimeInterval(30)
    }

    private func perform(_ operation: () async throws -> Void) async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await operation()
        } catch {
            if !Self.isCancellation(error) {
                errorMessage =
                    (error as? LocalizedError)?.errorDescription
                    ?? L10n.string("We couldn't sign you in. Please try again.")
            }
        }
    }

    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        let error = error as NSError
        return
            (error.domain == ASAuthorizationError.errorDomain
            && error.code == ASAuthorizationError.canceled.rawValue)
            || (error.domain == ASWebAuthenticationSessionError.errorDomain
                && error.code == ASWebAuthenticationSessionError.canceledLogin.rawValue)
    }
}

@MainActor
private final class ClerkLoginAuthenticator: LoginAuthenticating {
    private var signIn: SignIn?
    private var signUp: SignUp?

    func signIn(provider: LoginProvider) async throws -> LoginContinuation {
        signIn = nil
        signUp = nil
        let result: TransferFlowResult
        switch provider {
        case .apple:
            result = try await Clerk.shared.auth.signInWithApple()
        case .google:
            result = try await Clerk.shared.auth.signInWithOAuth(provider: .google)
        }
        return try await consume(result)
    }

    func completeProfile(firstName: String, lastName: String, legalAccepted: Bool) async throws
        -> LoginContinuation
    {
        guard let signUp else { throw LoginError.expired }
        let updated = try await signUp.update(
            firstName: signUp.missingFields.contains(.firstName) ? firstName : nil,
            lastName: signUp.missingFields.contains(.lastName) ? lastName : nil,
            legalAccepted: signUp.missingFields.contains(.legalAccepted) ? legalAccepted : nil)
        return try await consume(.signUp(updated))
    }

    func prepareVerification(_ method: LoginVerificationMethod) async throws {
        guard let signIn else { throw LoginError.expired }
        let isSecondFactor =
            signIn.status == .needsSecondFactor || signIn.status == .needsClientTrust
        switch method {
        case .authenticator, .backupCode:
            break
        case .email:
            self.signIn =
                try await isSecondFactor
                ? signIn.sendMfaEmailCode() : signIn.sendEmailCode()
        case .textMessage:
            self.signIn =
                try await isSecondFactor
                ? signIn.sendMfaPhoneCode() : signIn.sendPhoneCode()
        }
    }

    func verify(_ code: String, method: LoginVerificationMethod) async throws -> LoginContinuation {
        guard let signIn else { throw LoginError.expired }
        let updated: SignIn
        if signIn.status == .needsSecondFactor || signIn.status == .needsClientTrust {
            let type: SignIn.MfaType
            switch method {
            case .authenticator: type = .totp
            case .email: type = .emailCode
            case .textMessage: type = .phoneCode
            case .backupCode: type = .backupCode
            }
            updated = try await signIn.verifyMfaCode(code, type: type)
        } else {
            updated = try await signIn.verifyCode(code)
        }
        return try await consume(.signIn(updated))
    }

    private func consume(_ result: TransferFlowResult) async throws -> LoginContinuation {
        switch result {
        case .signIn(let signIn):
            self.signIn = signIn
            if signIn.status == .complete {
                return try await activate(signIn.createdSessionId)
            }
            let factors: [Factor]
            switch signIn.status {
            case .needsSecondFactor, .needsClientTrust:
                factors = signIn.supportedSecondFactors ?? []
            case .needsFirstFactor:
                factors = signIn.supportedFirstFactors ?? []
            default: throw LoginError.additionalVerification
            }
            let methods = LoginVerificationMethod.allCases.filter { method in
                factors.contains { factor in
                    switch method {
                    case .authenticator: factor.strategy == .totp
                    case .email: factor.strategy == .emailCode
                    case .textMessage: factor.strategy == .phoneCode
                    case .backupCode: factor.strategy == .backupCode
                    }
                }
            }
            guard !methods.isEmpty else { throw LoginError.additionalVerification }
            return .verification(methods: methods)
        case .signUp(let signUp):
            self.signUp = signUp
            if signUp.status == .complete {
                let continuation = try await activate(signUp.createdSessionId)
                AdAttributionStore.shared.record(.signedUp)
                return continuation
            }
            let supported: Set<SignUp.Field> = [.firstName, .lastName, .legalAccepted]
            guard signUp.status == .missingRequirements,
                !signUp.missingFields.isEmpty,
                Set(signUp.missingFields).isSubset(of: supported),
                signUp.unverifiedFields.isEmpty
            else { throw LoginError.additionalVerification }
            return .profile(
                firstName: signUp.missingFields.contains(.firstName),
                lastName: signUp.missingFields.contains(.lastName),
                legal: signUp.missingFields.contains(.legalAccepted))
        }
    }

    private func activate(_ sessionID: String?) async throws -> LoginContinuation {
        guard let sessionID else { throw LoginError.expired }
        if Clerk.shared.session?.id != sessionID {
            try await Clerk.shared.auth.setActive(sessionId: sessionID)
        }
        return .complete
    }
}

private enum LoginError: LocalizedError {
    case expired
    case additionalVerification

    var errorDescription: String? {
        switch self {
        case .expired:
            L10n.string("This sign-in has expired. Go back and try again.")
        case .additionalVerification:
            L10n.string(
                "Your account needs another verification step. Contact support@kualia.com for help signing in."
            )
        }
    }
}
