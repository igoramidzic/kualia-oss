import SwiftUI

private enum FamilyStyle {
    static let accentInk = Color(red: 0.18, green: 0.18, blue: 0.18)
    static let cream = Color(red: 0.97, green: 0.94, blue: 0.84)
    static let lime = Color(red: 0.82, green: 0.89, blue: 0.54)
    static let blue = Color(red: 0.78, green: 0.85, blue: 0.92)
    static let lavender = Color(red: 0.80, green: 0.78, blue: 0.93)
    static let colors = [
        cream, blue, lime, lavender, Color(red: 0.65, green: 0.82, blue: 0.84), cream,
    ]
}

struct SettingsFamilyView: View {
    let settings: SettingsStore
    let session: AppSessionStore
    @Environment(\.switchSettingsWorkspace) private var switchWorkspace
    @State private var showsInvite = false
    @State private var confirmation: FamilyConfirmation?
    private var store: FamilyStore { settings.family }

    var body: some View {
        SettingsCanvas {
            FamilyCircleHeader(group: store.group)
            if let error = store.loadError {
                SettingsRetry(message: error, retry: store.reload)
            }
            if let notice = store.notice {
                Label(notice, icon: .checkCircle)
                    .font(.subheadline).foregroundStyle(KualiaPalette.budgetPositive)
                    .accessibilityIdentifier("family-success")
            }
            if let error = store.actionError {
                Text(error).font(.subheadline).foregroundStyle(KualiaPalette.budgetNegative)
                    .accessibilityIdentifier("family-error")
            }
            if !store.hasLoaded {
                if store.loadError == nil {
                    ProgressView(L10n.string("Finding your circle…")).frame(maxWidth: .infinity)
                        .padding()
                }
            } else if let group = store.group {
                familyContent(group)
            } else {
                welcomeContent
            }
        }
        .navigationTitle(L10n.string("Family")).navigationBarTitleDisplayMode(.inline)
        .kualiaScrollEdges(for: .top)
        .sheet(isPresented: $showsInvite) {
            FamilyInviteSheet(store: store)
        }
        .alert(
            confirmation?.title ?? L10n.string("Manage family"),
            isPresented: Binding(
                get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
            presenting: confirmation
        ) { item in
            Button(L10n.string("Cancel"), role: .cancel) { confirmation = nil }
            Button(item.actionLabel, role: item.role) {
                Task { await store.perform(item.change) }
                confirmation = nil
            }
        } message: { item in
            Text(item.message)
        }
    }

    private var welcomeContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            FamilyPrimaryButton(L10n.string("Create family"), isWorking: store.isSaving) {
                Task { await store.perform(.create) }
            }.disabled(store.isSaving || store.loadError != nil)
            Text(
                L10n.string(
                    "Share budgets, accounts, and transactions with up to five people you trust.")
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
        }
    }

    @ViewBuilder
    private func familyContent(_ group: FamilyGroup) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                Text(L10n.string("Your people")).font(.title2.bold()).fontDesign(.rounded)
                Spacer()
                Text(L10n.string("\(group.members.count) of 6 joined"))
                    .font(.caption.weight(.medium)).foregroundStyle(KualiaPalette.mutedInk)
            }
            VStack(spacing: 0) {
                ForEach(Array(group.members.enumerated()), id: \.element.id) { index, member in
                    if index > 0 { Divider().padding(.horizontal, 18) }
                    HStack(spacing: 14) {
                        FamilyMonogram(
                            name: member.displayName, color: FamilyStyle.colors[index % 6])
                        VStack(alignment: .leading, spacing: 4) {
                            Text(member.displayName + (member.isCurrentUser ? " (you)" : ""))
                                .font(.body.weight(.semibold))
                            Text(member.roleLabel).font(.caption)
                                .foregroundStyle(KualiaPalette.mutedInk)
                            if let email = member.email {
                                Text(email).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                                    .textSelection(.enabled)
                            }
                        }
                        Spacer(minLength: 0)
                        if group.isOwner, member.role != "owner", !member.isCurrentUser {
                            Menu {
                                Button(L10n.string("Remove member"), role: .destructive) {
                                    confirmation = .remove(member)
                                }
                            } label: {
                                KualiaIconImage(icon: .dots, size: 18).frame(width: 44, height: 44)
                            }
                            .accessibilityLabel(L10n.string("Manage \(member.displayName)"))
                            .disabled(store.isSaving || store.loadError != nil)
                        } else if member.role == "owner" {
                            KualiaIconImage(icon: .crown, size: 18).foregroundStyle(
                                KualiaPalette.budgetUnderfunded
                            )
                            .accessibilityHidden(true)
                        }
                    }.padding(18)
                }
            }
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
            if group.isOwner {
                inviteControls(group)
            } else {
                Text(
                    L10n.string(
                        "\(group.members.first(where: { $0.role == "owner" })?.displayName ?? L10n.string("Your family manager")) manages invitations and family membership."
                    )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
        }

        if group.isOwner, !group.pendingInvites.isEmpty {
            pendingInvites(group)
        }
        SettingsGroup(title: L10n.string("Shared with family")) {
            NavigationLink {
                SettingsWorkspacesView(store: settings, session: session, onSwitch: switchWorkspace)
            } label: {
                SettingsRow(
                    L10n.string("Family workspaces"),
                    detail: L10n.string("Open the budgets you share"), icon: .workspace)
            }
            SettingsDivider()
            NavigationLink {
                SettingsMembershipView(store: settings)
            } label: {
                SettingsRow(
                    L10n.string("Membership"), detail: membershipDetail(group), icon: .family)
            }
        }
        FamilySharingNote()
        VStack(alignment: .leading, spacing: 12) {
            if group.canLeave {
                Button(
                    group.isOwner ? L10n.string("Delete family") : L10n.string("Leave family"),
                    role: .destructive
                ) {
                    confirmation = .leave(isOwner: group.isOwner)
                }
                .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                .disabled(store.isSaving || store.loadError != nil)
            } else {
                Text(L10n.string("To delete your family, remove the other members first."))
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    private func membershipDetail(_ group: FamilyGroup) -> String {
        if settings.appAccess?.usesFamilySubscription == true {
            return L10n.string("Included through your family manager")
        }
        if group.isOwner { return L10n.string("Your active membership can cover your family") }
        return L10n.string("See your plan and family access")
    }

    private func inviteControls(_ group: FamilyGroup) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            FamilyPrimaryButton(
                group.availableSeats == 0
                    ? L10n.string("Your circle is full") : L10n.string("Invite someone"),
                isWorking: store.isSaving
            ) {
                store.clearFeedback()
                showsInvite = true
            }.disabled(!group.canInvite || store.isSaving || store.loadError != nil)
            Text(
                group.availableSeats == 0
                    ? L10n.string("Pending invitations reserve a place. Revoke one to make room.")
                    : L10n.string(
                        "\(group.availableSeats) open \(group.availableSeats == 1 ? L10n.string("place") : L10n.string("places"))."
                    )
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)

        }
    }

    private func pendingInvites(_ group: FamilyGroup) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L10n.string("On their way")).font(.title2.bold()).fontDesign(.rounded)
            TimelineView(.periodic(from: .now, by: 60)) { context in
                ForEach(group.pendingInvites) { invite in
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 12) {
                            KualiaIconImage(icon: .envelopeBadge, size: 22)
                                .font(.title2).foregroundStyle(KualiaPalette.budgetUnderfunded)
                                .frame(width: 44, height: 44)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(invite.invitedName).font(.body.weight(.semibold))
                                Text(invite.invitedEmail).font(.caption).foregroundStyle(
                                    KualiaPalette.mutedInk)
                                Text(
                                    invite.isExpired(at: context.date)
                                        ? L10n.string("Expired · resend to renew")
                                        : L10n.string("Waiting for them to join")
                                )
                                .font(.caption.weight(.medium)).foregroundStyle(
                                    KualiaPalette.budgetUnderfunded)
                            }
                            Spacer(minLength: 0)
                        }
                        HStack {
                            Button(L10n.string("Resend email")) { confirmation = .resend(invite) }
                                .disabled(!group.canSendEmail)
                            Spacer()
                            Button(L10n.string("Revoke"), role: .destructive) {
                                confirmation = .revoke(invite)
                            }
                        }.font(.subheadline.weight(.semibold)).frame(minHeight: 36)
                    }
                    .padding(18).background(
                        KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 24).strokeBorder(
                            KualiaPalette.border, style: StrokeStyle(lineWidth: 1, dash: [5, 5])))
                }
            }
        }.disabled(store.isSaving || store.loadError != nil)
    }
}

private struct FamilyCircleHeader: View {
    let group: FamilyGroup?
    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(group?.displayName ?? L10n.string("Your family"))
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(L10n.string("A little closer, together."))
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            illustration
                .frame(width: 116, height: 116)
                .accessibilityHidden(true)
        }
        .padding(20)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
    }

    private var illustration: some View {
        ZStack {
            Circle().stroke(
                KualiaPalette.mutedInk.opacity(0.2),
                style: StrokeStyle(lineWidth: 1, dash: [2, 4])
            )
            .frame(width: 86, height: 86)
            Circle().fill(KualiaPalette.budgetSelection).frame(width: 42, height: 42)
                .overlay {
                    KualiaIconImage(icon: .house, size: 18).font(.system(size: 18, weight: .medium))
                        .foregroundStyle(KualiaPalette.ink)
                }
                .rotationEffect(.degrees(-7))
            ForEach(0..<6) { index in
                let angle = Double(index) * .pi / 3 - .pi / 2
                let member = group.flatMap {
                    index < $0.members.count ? $0.members[index] : nil
                }
                let reserved =
                    group.map {
                        index >= $0.members.count
                            && index < $0.members.count + $0.pendingInvites.count
                    } ?? false
                ZStack {
                    Circle().fill(member != nil ? FamilyStyle.colors[index] : KualiaPalette.surface)
                    Circle().strokeBorder(
                        KualiaPalette.mutedInk.opacity(0.25),
                        style: StrokeStyle(lineWidth: 1, dash: member != nil ? [] : [2, 2]))
                    if let member {
                        Text(member.initials)
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(FamilyStyle.accentInk)
                    } else {
                        KualiaIconImage(icon: reserved ? .email : .plus, size: 10)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                .frame(width: 26, height: 26)
                .offset(x: cos(angle) * 45, y: sin(angle) * 45)
            }
        }
    }
}

private struct FamilyMonogram: View {
    let name: String
    var color = FamilyStyle.blue
    var body: some View {
        Text(FamilyPresentation.initials(name))
            .font(.system(.headline, design: .rounded)).foregroundStyle(FamilyStyle.accentInk)
            .frame(width: 46, height: 46).background(color, in: Circle())
            .accessibilityHidden(true)
    }
}

private struct FamilySharingNote: View {
    var body: some View {
        DisclosureGroup(L10n.string("How sharing works")) {
            Text(
                L10n.string(
                    "Members can see and edit family budgets, accounts, and transactions. Bank connections stay with their owner. Leaving keeps your own workspaces and removes shared access."
                )
            )
            .padding(.top, 8)
            .fixedSize(horizontal: false, vertical: true)
        }
        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
    }
}

struct FamilyPrimaryButton: View {
    let title: String
    var isWorking = false
    let action: () -> Void
    init(_ title: String, isWorking: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isWorking = isWorking
        self.action = action
    }
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if isWorking { ProgressView().tint(KualiaPalette.ink) }
                Text(isWorking ? L10n.string("One moment…") : title)
                    .font(.body.weight(.semibold))
                if !isWorking { KualiaIconImage(icon: .arrowRight, size: 18) }
            }.frame(maxWidth: .infinity, minHeight: 54).padding(.horizontal, 16)
                .foregroundStyle(KualiaPalette.ink)
                .background(KualiaPalette.budgetSelection, in: Capsule())
        }.buttonStyle(.kualiaHaptic)
    }
}

private enum FamilyConfirmation {
    case remove(FamilyMember)
    case revoke(FamilyInvite)
    case resend(FamilyInvite)
    case leave(isOwner: Bool)
    var role: ButtonRole? {
        if case .resend = self { return nil }
        return .destructive
    }
    var title: String {
        switch self {
        case .remove: L10n.string("Remove family member?")
        case .revoke: L10n.string("Revoke this invitation?")
        case .resend: L10n.string("Send another invitation?")
        case .leave(let isOwner):
            isOwner ? L10n.string("Delete your family?") : L10n.string("Leave this family?")
        }
    }
    var actionLabel: String {
        switch self {
        case .remove: L10n.string("Remove member")
        case .revoke: L10n.string("Revoke invitation")
        case .resend: L10n.string("Resend email")
        case .leave(let isOwner):
            isOwner ? L10n.string("Delete family") : L10n.string("Leave family")
        }
    }
    var message: String {
        switch self {
        case .remove(let member):
            L10n.string(
                "\(member.displayName) will lose shared family workspace and membership access. Their Kualia account and own workspaces stay intact. Bank links crossing between them and the family will be unlinked."
            )
        case .revoke(let invite):
            L10n.string(
                "The invitation for \(invite.invitedEmail) will stop working and their reserved place will become available."
            )
        case .resend(let invite):
            L10n.string(
                "Send a new email to \(invite.invitedEmail)? The new invitation replaces the previous link."
            )
        case .leave(let isOwner):
            isOwner
                ? L10n.string(
                    "Your family group will be deleted and pending invitations revoked. Your Kualia account and own workspaces stay intact."
                )
                : L10n.string(
                    "You'll lose shared family workspaces and access through the manager's membership. Your own workspaces stay with you. Bank links crossing between you and the family will be unlinked."
                )
        }
    }
    var change: FamilyChange {
        switch self {
        case .remove(let member): .remove(member.id)
        case .revoke(let invite): .revoke(invite.id)
        case .resend(let invite):
            .invite(.init(name: invite.invitedName, email: invite.invitedEmail))
        case .leave: .leave
        }
    }
}
