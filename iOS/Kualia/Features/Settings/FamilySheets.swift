import SwiftUI

struct FamilyInviteSheet: View {
    let store: FamilyStore
    @Environment(\.dismiss) private var dismiss
    @State private var draft = FamilyInviteDraft()
    @State private var sentEmail: String?

    var body: some View {
        NavigationStack {
            SettingsCanvas {
                if let sentEmail {
                    VStack(alignment: .leading, spacing: 18) {
                        KualiaIconImage(icon: .send, size: 64)
                            .font(.system(size: 64)).foregroundStyle(KualiaPalette.budgetPositive)
                            .accessibilityHidden(true)
                        Text(L10n.string("A little hello.\nA new beginning."))
                            .font(.largeTitle.bold()).fontDesign(.rounded)
                        Text(
                            L10n.string(
                                "We've emailed an invitation to \(sentEmail). They'll have 14 days to join using that email address."
                            )
                        )
                        .foregroundStyle(KualiaPalette.mutedInk)
                        FamilyPrimaryButton(L10n.string("Back to your family")) { dismiss() }
                    }
                    .accessibilityIdentifier("family-invitation-sent")
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        KualiaIconImage(icon: .email, size: 40)
                            .foregroundStyle(KualiaPalette.ink)
                            .accessibilityHidden(true)
                        Text(L10n.string("Save them a place."))
                            .font(.largeTitle.bold()).fontDesign(.rounded)
                        Text(
                            L10n.string(
                                "A personal invitation to plan a little more of life together.")
                        )
                        .foregroundStyle(KualiaPalette.mutedInk)
                    }
                    SettingsGroup(title: L10n.string("Who's joining your circle?")) {
                        VStack(spacing: 20) {
                            SettingsTextInput(
                                L10n.string("Their name"), placeholder: L10n.string("e.g. Alex"),
                                text: $draft.name)
                            VStack(alignment: .leading, spacing: 9) {
                                Text(L10n.string("Their email")).font(.caption.weight(.medium))
                                    .foregroundStyle(
                                        KualiaPalette.mutedInk)
                                TextField(
                                    L10n.string("Their email"), text: $draft.email,
                                    prompt: Text(verbatim: L10n.string("Email address"))
                                        .foregroundStyle(KualiaPalette.mutedInk)
                                )
                                .font(.body.weight(.medium))
                                .foregroundStyle(KualiaPalette.ink)
                                .tint(KualiaPalette.ink)
                                .keyboardType(.emailAddress).textContentType(.emailAddress)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .padding(14).background(
                                    KualiaPalette.canvas, in: RoundedRectangle(cornerRadius: 12)
                                )
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12)
                                        .strokeBorder(KualiaPalette.border.opacity(0.5))
                                }
                                .accessibilityLabel(L10n.string("Their email"))
                            }
                        }.padding(20)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text(L10n.string("AN INVITATION TO BELONG")).font(.caption2.bold())
                            .tracking(2)
                            .foregroundStyle(KualiaPalette.mutedInk)
                        Text(
                            L10n.string(
                                "\(draft.normalizedName.isEmpty ? L10n.string("Your person") : draft.normalizedName), you're invited."
                            )
                        )
                        .font(.title2.bold()).fontDesign(.rounded)
                        Text(
                            L10n.string(
                                "Join \(store.group?.displayName ?? L10n.string("our family")) on Kualia."
                            )
                        )
                        .font(.subheadline)
                        Divider()
                        Label {
                            Text(L10n.string("One place in our circle · 14 days to join"))
                        } icon: {
                            KualiaIconImage(icon: .email, size: 16)
                        }
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    .padding(22).frame(maxWidth: .infinity, alignment: .leading)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24).strokeBorder(
                            KualiaPalette.border, style: StrokeStyle(lineWidth: 1, dash: [5, 5])))
                    Text(
                        L10n.string(
                            "By joining, they'll be able to see and edit family workspaces, including accounts, balances, and transactions. They must use this email address to accept."
                        )
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    if let error = store.actionError ?? store.loadError {
                        Text(error).font(.subheadline).foregroundStyle(KualiaPalette.budgetNegative)
                    }
                    if store.group?.canInvite != true {
                        Text(
                            L10n.string(
                                "Invitations aren't available right now. Please try again later.")
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    FamilyPrimaryButton(L10n.string("Send invitation"), isWorking: store.isSaving) {
                        Task {
                            let email = draft.normalizedEmail
                            if await store.perform(.invite(draft)) { sentEmail = email }
                        }
                    }
                    .disabled(
                        !draft.isValid || store.isSaving || store.group?.canInvite != true
                            || store.loadError != nil
                    )
                    .accessibilityIdentifier("family-send-invitation")
                }
            }
            .disabled(store.isSaving)
            .navigationTitle(L10n.string("Invite to family")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }.disabled(store.isSaving)
                }
            }
        }
        .interactiveDismissDisabled(store.isSaving)
        .tint(KualiaPalette.ink)
    }
}

struct FamilyJoinSheet: View {
    let store: FamilyStore
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var joined = false
    @State private var confirmsJoin = false

    var body: some View {
        NavigationStack {
            SettingsCanvas {
                VStack(alignment: .leading, spacing: 12) {
                    KualiaIconImage(icon: joined ? .heart : .envelopeOpen, size: 48)
                        .font(.system(size: 48)).foregroundStyle(KualiaPalette.budgetPositive)
                        .accessibilityHidden(true)
                    Text(
                        joined
                            ? L10n.string("You're part of the circle.")
                            : L10n.string("There's a place for you.")
                    )
                    .font(.largeTitle.bold()).fontDesign(.rounded)
                    Text(
                        joined
                            ? L10n.string(
                                "Your family's workspaces will appear in your workspace list.")
                            : L10n.string(
                                "Paste the invitation link from your email. We'll check the details before you join."
                            )
                    )
                    .foregroundStyle(KualiaPalette.mutedInk)
                }
                if joined {
                    FamilyPrimaryButton(L10n.string("Back to Family")) { dismiss() }
                } else {
                    TextField("https://app.kualia.com/family/join/…", text: $link, axis: .vertical)
                        .keyboardType(.URL).textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(18).background(
                            KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18)
                        )
                        .accessibilityLabel(L10n.string("Invitation link"))
                        .onChange(of: link) { _, _ in store.clearPreview() }
                    if store.preview == nil || store.previewError != nil {
                        FamilyPrimaryButton(
                            L10n.string("Check invitation"), isWorking: store.isLoadingPreview
                        ) {
                            store.loadPreview(link: link)
                        }.disabled(
                            link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || store.isLoadingPreview)
                    }
                    if let error = store.loadError {
                        SettingsRetry(message: error, retry: store.reload)
                    } else if !store.hasLoaded {
                        ProgressView(L10n.string("Loading family access…"))
                    }
                    if let preview = store.preview {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(preview.familyGroupName ?? L10n.string("Family invitation"))
                                .font(.title2.bold()).fontDesign(.rounded)
                            if let name = preview.invitedByName {
                                Text(L10n.string("Invited by \(name)")).font(.subheadline)
                            }
                            Text(preview.message).foregroundStyle(KualiaPalette.mutedInk)
                            if let date = preview.expiresAt.flatMap(FamilyPresentation.date) {
                                Text(
                                    L10n.string(
                                        "Expires \(date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, locale: L10n.locale)))"
                                    )
                                )
                                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                            }
                            if let current = preview.currentFamilyGroup, preview.canAccept,
                                current.role == "owner"
                            {
                                Text(
                                    L10n.string(
                                        "Joining will delete your current family, \(current.name), and revoke its pending invitations. Your own workspaces stay with you."
                                    )
                                )
                                .font(.subheadline).foregroundStyle(KualiaPalette.budgetUnderfunded)
                            }
                        }
                        .padding(22).background(
                            KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
                        if preview.canAccept {
                            TimelineView(.periodic(from: .now, by: 30)) { context in
                                if preview.canJoin(at: context.date) {
                                    FamilyPrimaryButton(
                                        L10n.string("Join this family"), isWorking: store.isSaving
                                    ) {
                                        confirmsJoin = true
                                    }.disabled(
                                        store.isSaving || store.previewError != nil
                                            || store.loadError != nil || !store.hasLoaded)
                                } else {
                                    Text(
                                        L10n.string(
                                            "This invitation has expired. Ask the family manager for a new one."
                                        )
                                    )
                                    .foregroundStyle(KualiaPalette.mutedInk)
                                }
                            }
                        }
                    }
                    if let error = store.previewError ?? store.actionError ?? store.loadError {
                        Text(error).font(.subheadline).foregroundStyle(KualiaPalette.budgetNegative)
                    }
                }
            }
            .disabled(store.isSaving)
            .navigationTitle(L10n.string("Join a family")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }.disabled(store.isSaving)
                }
            }
            .alert(L10n.string("Join this family?"), isPresented: $confirmsJoin) {
                Button(L10n.string("Cancel"), role: .cancel) {}
                Button(L10n.string("Join family")) {
                    Task { joined = await store.acceptPreview() }
                }
            } message: {
                Text(
                    L10n.string(
                        "You and this family's members will be able to see and edit each other's family workspaces, including budgets, accounts, and transactions.\(store.preview?.currentFamilyGroup?.role == "owner" ? L10n.string(" Your current family group will be deleted and its pending invitations revoked.") : "")"
                    )
                )
            }
        }
        .interactiveDismissDisabled(store.isSaving)
        .onDisappear { store.clearPreview() }
        .tint(KualiaPalette.ink)
    }
}
