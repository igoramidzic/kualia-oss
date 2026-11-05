import SwiftUI

struct SubscriptionPaywallView: View {
    @Bindable var store: SubscriptionStore
    let onSignOut: () async -> Void
    let onJoinFamily: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isSigningOut = false
    @State private var confirmsLogout = false

    private let ink = KualiaPalette.ink
    private let mint = Color(red: 0.75, green: 0.91, blue: 0.75)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Text("kualia")
                        .font(.system(size: 27, weight: .heavy, design: .rounded))
                        .tracking(-1)
                    Spacer()
                    Button(L10n.string("Log out")) {
                        confirmsLogout = true
                    }
                    .font(.subheadline)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .disabled(store.isBusy || isSigningOut)
                }
                .padding(.top, 8)

                SubscriptionPaywallHeader(
                    isPaused: store.isBusy || store.isAwaitingActivation || isSigningOut)

                SubscriptionPaywallFeatures()

                if store.appAccess?.requiresFamilyRenewal == true {
                    Label(
                        L10n.string(
                            "Your family plan needs renewing. Ask your family manager to renew, or choose your own plan below."
                        ),
                        icon: .users
                    )
                    .font(.subheadline)
                    .padding(18)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                }

                VStack(spacing: 12) {
                    if store.isLoadingPlans {
                        ProgressView(L10n.string("Getting your options…"))
                            .frame(maxWidth: .infinity, minHeight: 100)
                    } else {
                        ForEach(store.plans) { plan in planCard(plan) }
                    }
                    if let message = store.errorMessage {
                        Text(message).font(.subheadline).foregroundStyle(
                            KualiaPalette.budgetNegative
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if store.plans.isEmpty {
                            Button(L10n.string("Reload pricing")) { store.loadPlans() }
                                .font(.subheadline.weight(.semibold))
                        }
                    }
                    if let message = store.statusMessage {
                        Text(message).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityLabel(message)
                    }
                }

                purchaseControls

                Button(action: onJoinFamily) {
                    Label(L10n.string("Have a family invitation? Join here"), icon: .envelopeOpen)
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .disabled(store.isBusy || isSigningOut)
                .accessibilityIdentifier("membership-join-family")
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 28)
            .frame(maxWidth: 540)
            .frame(maxWidth: .infinity)
        }
        .foregroundStyle(ink)
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .tint(ink)
        .alert(L10n.string("Log out of Kualia?"), isPresented: $confirmsLogout) {
            Button(L10n.string("Cancel"), role: .cancel) { confirmsLogout = false }
            Button(L10n.string("Log out"), role: .destructive) {
                isSigningOut = true
                Task {
                    await onSignOut()
                    isSigningOut = false
                }
            }
        } message: {
            Text(L10n.string("Your budgets will be here when you come back."))
        }
        .task {
            store.loadPlans()
        }
    }

    private func planCard(_ plan: SubscriptionPlan) -> some View {
        let selected = store.selectedPlanID == plan.id
        let monthly = store.plans.first { $0.period == .monthly }
        return Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) {
                store.selectedPlanID = plan.id
            }
        } label: {
            HStack(spacing: 14) {
                KualiaIconImage(icon: selected ? .checkCircle : .circle, size: 22)
                    .font(.title2)
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(plan.title).font(.headline)
                        if let savings = plan.savings(comparedWith: monthly), savings > 0 {
                            Text(L10n.string("Save \(savings)%"))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color(red: 0.09, green: 0.15, blue: 0.13))
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(mint, in: Capsule())
                        }
                    }
                    if let trial = plan.freeTrial {
                        Text(L10n.string("\(trial) free, then \(plan.billingSummary)"))
                            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    } else {
                        Text(plan.billingSummary).font(.subheadline).foregroundStyle(
                            KualiaPalette.mutedInk)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                selected ? KualiaPalette.surface : KualiaPalette.canvas,
                in: RoundedRectangle(cornerRadius: 22)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 22).strokeBorder(
                    selected ? ink : KualiaPalette.border, lineWidth: selected ? 2 : 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 22))
        }
        .buttonStyle(.plain)
        .disabled(store.isBusy || store.isAwaitingActivation)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private var purchaseControls: some View {
        VStack(spacing: 16) {
            if store.isAwaitingActivation {
                Button {
                    Task { await store.refresh() }
                } label: {
                    Text(L10n.string("Check access")).font(.headline).frame(
                        maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(.plain)
                .foregroundStyle(KualiaPalette.canvas)
                .background(ink, in: Capsule())
            } else {
                Button {
                    Task { await store.purchase() }
                } label: {
                    HStack {
                        if store.isPurchasing { ProgressView().tint(KualiaPalette.canvas) }
                        Text(
                            store.selectedPlan?.freeTrial == nil
                                ? L10n.string("Start my plan") : L10n.string("Start my free trial"))
                        KualiaIconImage(icon: .arrowRight, size: 18)
                    }
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(.plain)
                .foregroundStyle(KualiaPalette.canvas)
                .background(ink.opacity(store.canPurchase ? 1 : 0.4), in: Capsule())
                .disabled(!store.canPurchase)
            }
            if let plan = store.selectedPlan {
                Text(plan.terms).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    .multilineTextAlignment(.center)
            }
            Button {
                Task { await store.restorePurchases() }
            } label: {
                Text(
                    store.isRestoring ? L10n.string("Restoring…") : L10n.string("Restore purchases")
                )
            }
            .font(.subheadline.weight(.medium))
            .disabled(store.isBusy)
            HStack(spacing: 20) {
                Link(
                    L10n.string("Terms"),
                    destination: URL(string: "https://www.kualia.com/terms-of-service")!)
                Link(
                    L10n.string("Privacy"),
                    destination: URL(string: "https://www.kualia.com/privacy")!)
                Link(L10n.string("Help"), destination: URL(string: "mailto:support@kualia.com")!)
            }
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        }
    }
}

struct SubscriptionPaywallHeader: View {
    let isPaused: Bool

    var body: some View {
        VStack(spacing: 20) {
            WelcomeOrbitScene(isPaused: isPaused)
                .frame(height: 192)

            VStack(spacing: 10) {
                Text(L10n.string("More living.\nLess wondering."))
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .tracking(-1)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(L10n.string("Make room for the life you want,\none envelope at a time."))
                    .font(.body)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
    }
}

struct SubscriptionPaywallFeatures: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            feature(
                L10n.string("Envelope budgets"),
                detail: L10n.string("Targets and Quick Assign for every category."),
                icon: .budget, accent: KualiaPalette.budgetGlow)
            feature(
                L10n.string("Connected accounts"),
                detail: L10n.string("Link your banks or track balances manually."),
                icon: .accounts, accent: KualiaPalette.accountsGlow)
            feature(
                L10n.string("Bills & recurring payments"),
                detail: L10n.string("Schedule expenses and see what's coming up."),
                icon: .calendarFilled, accent: KualiaPalette.plannedGlow)
            feature(
                L10n.string("Spending reports"),
                detail: L10n.string("Explore spending by category and over time."),
                icon: .reports, accent: KualiaPalette.reportsGlow)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private func feature(_ title: String, detail: String, icon: KualiaIcon, accent: Color)
        -> some View
    {
        HStack(alignment: .center, spacing: 14) {
            KualiaIconImage(icon: icon, size: 24)
                .foregroundStyle(colorScheme == .dark ? accent : accent.mix(with: .black, by: 0.32))
                .frame(width: 46, height: 46)
                .background(
                    accent.opacity(colorScheme == .dark ? 0.14 : 0.10),
                    in: RoundedRectangle(cornerRadius: 15)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 15)
                        .strokeBorder(accent.opacity(0.16), lineWidth: 0.75)
                }

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KualiaPalette.ink)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .lineSpacing(2)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
