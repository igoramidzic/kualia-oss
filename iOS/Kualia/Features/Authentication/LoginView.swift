import SwiftUI

struct LoginView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var store = LoginStore()

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 28) {
                    HStack {
                        Text("kualia")
                            .font(.system(size: 27, weight: .heavy, design: .rounded))
                            .tracking(-1)
                        Spacer()
                        if store.continuation != .welcome && store.continuation != .complete {
                            Button(L10n.string("Go back")) { store.startOver() }
                                .font(.subheadline)
                                .foregroundStyle(KualiaPalette.mutedInk)
                                .disabled(store.isWorking)
                        }
                    }
                    .padding(.top, 12)

                    switch store.continuation {
                    case .welcome:
                        welcome
                    case .profile(let firstName, let lastName, let legal):
                        profile(
                            needsFirstName: firstName, needsLastName: lastName, needsLegal: legal)
                    case .verification(let methods):
                        verification(methods: methods)
                    case .complete:
                        Spacer(minLength: 80)
                        ProgressView(L10n.string("Making room for you…"))
                            .font(.headline)
                        Spacer(minLength: 80)
                    }

                    if let error = store.errorMessage {
                        VStack(spacing: 8) {
                            Text(error)
                                .font(.subheadline)
                                .foregroundStyle(KualiaPalette.budgetNegative)
                                .multilineTextAlignment(.center)
                                .accessibilityLabel(L10n.string("Sign-in error: \(error)"))
                            Link(
                                L10n.string("Get help"),
                                destination: URL(string: "mailto:support@kualia.com")!
                            )
                            .font(.subheadline.weight(.medium))
                        }
                    }

                    Spacer(minLength: 0)
                    legalLinks
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 24)
                .frame(maxWidth: 460)
                .frame(minHeight: geometry.size.height)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .foregroundStyle(KualiaPalette.ink)
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .tint(KualiaPalette.ink)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: store.continuation)
    }

    private var welcome: some View {
        VStack(spacing: 26) {
            WelcomeOrbitScene()
                .frame(height: 252)

            VStack(spacing: 12) {
                Text(L10n.string("Make room for\nwhat matters."))
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .tracking(-1.6)
                    .lineSpacing(-2)
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)

                Text(L10n.string("A little plan for your money.\nA lot more peace of mind."))
                    .font(.body)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .lineSpacing(3)
            }
            .multilineTextAlignment(.center)

            VStack(spacing: 12) {
                providerButton(.apple)
                providerButton(.google)
                Text(L10n.string("New here or coming back? Start here."))
                    .font(.footnote)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .padding(.top, 2)
            }
        }
    }

    private func providerButton(_ provider: LoginProvider) -> some View {
        Button {
            Task { await store.signIn(with: provider) }
        } label: {
            HStack(spacing: 12) {
                if store.activeProvider == provider {
                    ProgressView().tint(
                        provider == .apple ? KualiaPalette.canvas : KualiaPalette.ink)
                } else if provider == .apple {
                    Image(systemName: "apple.logo").font(.system(size: 21))
                } else {
                    GoogleSignInMark().frame(width: 20, height: 20)
                }
                Text(L10n.string("Continue with \(provider.name)"))
                    .font(.system(size: 17, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 56)
            .foregroundStyle(provider == .apple ? KualiaPalette.canvas : KualiaPalette.ink)
            .background(provider == .apple ? KualiaPalette.ink : KualiaPalette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .strokeBorder(
                        provider == .apple ? Color.clear : KualiaPalette.border, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .disabled(store.isWorking)
        .opacity(store.isWorking && store.activeProvider != provider ? 0.55 : 1)
        .accessibilityIdentifier("login.\(provider.rawValue)")
    }

    private func profile(needsFirstName: Bool, needsLastName: Bool, needsLegal: Bool) -> some View {
        @Bindable var store = store
        return VStack(alignment: .leading, spacing: 20) {
            KualiaIconImage(icon: .handWave, size: 48)
                .font(.system(size: 48))
                .foregroundStyle(KualiaPalette.budgetPositive)
                .padding(.top, 40)
            Text(L10n.string("One last hello."))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .accessibilityAddTraits(.isHeader)
            Text(L10n.string("A couple of details, then we'll make this feel like you."))
                .foregroundStyle(KualiaPalette.mutedInk)
            if needsFirstName {
                TextField(L10n.string("First name"), text: $store.firstName)
                    .textContentType(.givenName)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel(L10n.string("First name"))
            }
            if needsLastName {
                TextField(L10n.string("Last name"), text: $store.lastName)
                    .textContentType(.familyName)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel(L10n.string("Last name"))
            }
            if needsLegal {
                Toggle(
                    L10n.string("I agree to Kualia's Terms and Privacy Policy below."),
                    isOn: $store.legalAccepted
                )
                .font(.subheadline)
            }
            actionButton(L10n.string("Let's begin"), enabled: store.canCompleteProfile) {
                await store.completeProfile()
            }
        }
    }

    private func verification(methods: [LoginVerificationMethod]) -> some View {
        @Bindable var store = store
        return VStack(alignment: .leading, spacing: 20) {
            KualiaIconImage(icon: .shield, size: 48)
                .font(.system(size: 48))
                .foregroundStyle(KualiaPalette.budgetPositive)
                .padding(.top, 40)
            Text(L10n.string("A quick security check."))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .accessibilityAddTraits(.isHeader)
            Text(
                store.verificationMethod?.instruction
                    ?? L10n.string("Choose how you'd like to verify your account.")
            )
            .foregroundStyle(KualiaPalette.mutedInk)

            if store.verificationMethod != nil {
                TextField(L10n.string("Verification code"), text: $store.code)
                    .textContentType(.oneTimeCode)
                    .keyboardType(
                        store.verificationMethod == .backupCode ? .asciiCapable : .numberPad
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.title2.monospacedDigit())
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel(L10n.string("Verification code"))
                actionButton(
                    L10n.string("Continue"),
                    enabled: !store.code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ) {
                    await store.verifyCode()
                }
                if store.verificationMethod == .email || store.verificationMethod == .textMessage {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let seconds = max(
                            0, Int(ceil(store.canResendAt.timeIntervalSince(context.date))))
                        Button(
                            seconds > 0
                                ? L10n.string("Resend code in \(seconds)s")
                                : L10n.string("Resend code")
                        ) {
                            Task { await store.resendCode() }
                        }
                        .font(.subheadline)
                        .disabled(seconds > 0 || store.isWorking)
                    }
                }
            }
            if methods.count > 1 || store.verificationMethod == nil {
                Menu(L10n.string("Use another method")) {
                    ForEach(methods) { method in
                        Button(method.title) {
                            Task { await store.selectVerification(method) }
                        }
                    }
                }
                .font(.subheadline)
                .disabled(store.isWorking)
            }
        }
    }

    private func actionButton(_ title: String, enabled: Bool, action: @escaping () async -> Void)
        -> some View
    {
        Button {
            Task { await action() }
        } label: {
            HStack(spacing: 10) {
                if store.isWorking { ProgressView().tint(KualiaPalette.canvas) }
                Text(title).font(.headline)
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .foregroundStyle(KualiaPalette.canvas)
            .background(KualiaPalette.ink, in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .disabled(!enabled || store.isWorking)
        .opacity(enabled ? 1 : 0.45)
    }

    private var legalLinks: some View {
        VStack(spacing: 8) {
            Text(L10n.string("By continuing, you agree to our"))
                .font(.caption)
                .foregroundStyle(KualiaPalette.mutedInk)
            HStack(spacing: 16) {
                Link(L10n.string("Terms of Service"), destination: SettingsLinks.terms)
                Link(L10n.string("Privacy Policy"), destination: SettingsLinks.privacy)
            }
            .font(.caption.weight(.medium))
        }
        .multilineTextAlignment(.center)
        .padding(.top, 8)
    }
}

private struct GoogleSignInMark: View {
    var body: some View {
        Canvas { context, size in
            let scale = size.width / 24
            context.scaleBy(x: scale, y: scale)
            let colors: [(Color, Double, Double)] = [
                (Color(red: 0.26, green: 0.52, blue: 0.96), -40, 45),
                (Color(red: 0.20, green: 0.66, blue: 0.33), 45, 145),
                (Color(red: 0.98, green: 0.74, blue: 0.02), 145, 205),
                (Color(red: 0.92, green: 0.26, blue: 0.21), 205, 315),
            ]
            for (color, start, end) in colors {
                var path = Path()
                path.addArc(
                    center: CGPoint(x: 12, y: 12), radius: 8.5, startAngle: .degrees(start),
                    endAngle: .degrees(end), clockwise: false)
                context.stroke(path, with: .color(color), lineWidth: 4)
            }
            context.fill(
                Path(CGRect(x: 12, y: 10, width: 10.4, height: 4)),
                with: .color(Color(red: 0.26, green: 0.52, blue: 0.96)))
        }
        .accessibilityHidden(true)
    }
}
