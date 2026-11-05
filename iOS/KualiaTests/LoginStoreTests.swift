import AuthenticationServices
import Foundation
import Testing

@testable import Kualia

@MainActor
struct LoginStoreTests {
    @Test
    func providerCancellationReturnsToAnEnabledWelcomeWithoutAnError() async {
        let authenticator = FakeLoginAuthenticator()
        authenticator.signInError = NSError(
            domain: ASWebAuthenticationSessionError.errorDomain,
            code: ASWebAuthenticationSessionError.canceledLogin.rawValue)
        let store = LoginStore(authenticator: authenticator)

        await store.signIn(with: .google)

        #expect(store.continuation == .welcome)
        #expect(store.errorMessage == nil)
        #expect(!store.isWorking)
        #expect(store.activeProvider == nil)
    }

    @Test
    func appleCancellationIsDifferentFromAnAuthenticationFailure() {
        #expect(
            LoginStore.isCancellation(
                NSError(
                    domain: ASAuthorizationError.errorDomain,
                    code: ASAuthorizationError.canceled.rawValue)))
        #expect(
            !LoginStore.isCancellation(
                NSError(
                    domain: ASAuthorizationError.errorDomain,
                    code: ASAuthorizationError.failed.rawValue)))
    }

    @Test
    func transferredSignUpCollectsOnlyRequiredFieldsAndDoesNotAssumeConsent() async {
        let authenticator = FakeLoginAuthenticator()
        authenticator.result = .profile(firstName: true, lastName: false, legal: true)
        let store = LoginStore(authenticator: authenticator)
        await store.signIn(with: .apple)

        store.firstName = "  "
        store.legalAccepted = true
        #expect(!store.canCompleteProfile)
        store.firstName = "  Taylor  "
        store.legalAccepted = false
        #expect(!store.canCompleteProfile)
        store.legalAccepted = true
        #expect(store.canCompleteProfile)
        await store.completeProfile()

        #expect(authenticator.submittedFirstName == "Taylor")
        #expect(authenticator.submittedConsent == true)
        #expect(store.continuation == .complete)
    }

    @Test
    func failedCodeDeliveryKeepsTheVerificationStepAvailableForRetry() async {
        let authenticator = FakeLoginAuthenticator()
        authenticator.result = .verification(methods: [.email])
        authenticator.prepareError = LoginTestError.unavailable
        let store = LoginStore(authenticator: authenticator)
        await store.signIn(with: .google)

        #expect(store.continuation == .verification(methods: [.email]))
        #expect(store.verificationMethod == nil)
        #expect(store.errorMessage != nil)
        authenticator.prepareError = nil
        await store.selectVerification(.email)

        #expect(store.verificationMethod == .email)
        #expect(store.errorMessage == nil)
        #expect(authenticator.preparedMethods == [.email, .email])
        await store.resendCode()
        #expect(authenticator.preparedMethods == [.email, .email])
    }

    @Test
    func anInvalidMfaCodePreservesTheSelectedMethodAndCanBeRetried() async {
        let authenticator = FakeLoginAuthenticator()
        authenticator.result = .verification(methods: [.authenticator, .backupCode])
        authenticator.verifyError = LoginTestError.unavailable
        let store = LoginStore(authenticator: authenticator)
        await store.signIn(with: .apple)
        store.code = " 123456 "
        await store.verifyCode()

        #expect(store.verificationMethod == .authenticator)
        #expect(store.errorMessage != nil)
        authenticator.verifyError = nil
        await store.verifyCode()

        #expect(authenticator.verifiedCode == "123456")
        #expect(store.continuation == .complete)
        #expect(store.errorMessage == nil)
    }

    @Test
    func startingOverClearsProfileAndVerificationData() async {
        let authenticator = FakeLoginAuthenticator()
        authenticator.result = .verification(methods: [.backupCode])
        let store = LoginStore(authenticator: authenticator)
        await store.signIn(with: .google)
        store.firstName = "Taylor"
        store.code = "backup-code"
        store.legalAccepted = true

        store.startOver()

        #expect(store.continuation == .welcome)
        #expect(store.firstName.isEmpty)
        #expect(store.code.isEmpty)
        #expect(!store.legalAccepted)
        #expect(store.verificationMethod == nil)
    }
}

@MainActor
private final class FakeLoginAuthenticator: LoginAuthenticating {
    var result = LoginContinuation.complete
    var signInError: Error?
    var prepareError: Error?
    var verifyError: Error?
    var submittedFirstName: String?
    var submittedConsent: Bool?
    var preparedMethods: [LoginVerificationMethod] = []
    var verifiedCode: String?

    func signIn(provider: LoginProvider) async throws -> LoginContinuation {
        if let signInError { throw signInError }
        return result
    }

    func completeProfile(firstName: String, lastName: String, legalAccepted: Bool) async throws
        -> LoginContinuation
    {
        submittedFirstName = firstName
        submittedConsent = legalAccepted
        return .complete
    }

    func prepareVerification(_ method: LoginVerificationMethod) async throws {
        preparedMethods.append(method)
        if let prepareError { throw prepareError }
    }

    func verify(_ code: String, method: LoginVerificationMethod) async throws -> LoginContinuation {
        verifiedCode = code
        if let verifyError { throw verifyError }
        return .complete
    }
}

private enum LoginTestError: LocalizedError {
    case unavailable
    var errorDescription: String? { "Please try again." }
}
