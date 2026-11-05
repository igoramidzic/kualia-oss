import ClerkKit
import SafariServices
import SwiftUI

extension EnvironmentValues {
    @Entry var isDemoWorkspace = false
    @Entry var openWorkspaceSettings: () -> Void = {}
    @Entry var openAppSettings: () -> Void = {}
    @Entry var switchSettingsWorkspace: (String) -> Void = { _ in }
    @Entry var settingsProfileImage: Data? = nil
    @Entry var settingsProfileImageRemoved = false
    @Entry var settingsProfileName: String? = nil
    @Entry var confirmSettingsLogout: () -> Void = {}
}

struct SettingsView: View {
    @Bindable var store: SettingsStore
    let session: AppSessionStore
    var initialWidgetsDestination = false
    @Environment(Clerk.self) private var clerk
    @Environment(\.switchSettingsWorkspace) private var switchWorkspace
    @State private var confirmsLogout = false
    @State private var showsWidgets = false
    @State private var hasOpenedInitialWidgets = false

    var body: some View {
        SettingsCanvas {
            profileHeader
            NavigationLink {
                SettingsMembershipView(store: store)
            } label: {
                SettingsMembershipCard(store: store)
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityIdentifier("settings-membership")

            SettingsGroup(title: L10n.string("Your money")) {
                NavigationLink {
                    SettingsFamilyView(settings: store, session: session)
                } label: {
                    SettingsRow(
                        L10n.string("Family"),
                        detail: store.family.group?.displayName
                            ?? L10n.string("A little closer. A lot more possible."),
                        icon: .family)
                }
                .accessibilityIdentifier("settings-family")
                SettingsDivider()
                NavigationLink {
                    SettingsWorkspacesView(
                        store: store, session: session,
                        onSwitch: switchWorkspace)
                } label: {
                    SettingsRow(
                        L10n.string("All workspaces"),
                        detail: L10n.string("Switch, create, and manage your spaces"),
                        icon: .workspace, value: "\(session.workspaces.count)")
                }
                .accessibilityIdentifier("settings-workspaces")
            }

            SettingsGroup(title: L10n.string("App preferences")) {
                NavigationLink {
                    SettingsNotificationsView(store: store)
                } label: {
                    SettingsRow(
                        L10n.string("Notifications"),
                        detail: L10n.string("Choose what gets your attention"),
                        icon: .bell)
                }
                SettingsDivider()
                NavigationLink {
                    SettingsAppearanceView()
                } label: {
                    SettingsRow(
                        L10n.string("Appearance"), detail: L10n.string("Find your light"),
                        icon: .appearance)
                }
                SettingsDivider()
                NavigationLink {
                    SettingsWidgetsView(session: session)
                } label: {
                    SettingsRow(
                        L10n.string("Widgets"),
                        detail: L10n.string("Little windows into your money"),
                        icon: .widgets)
                }
                .accessibilityIdentifier("settings-widgets")
                SettingsDivider()
                NavigationLink {
                    SettingsShortcutsView()
                } label: {
                    SettingsRow(
                        L10n.string("Shortcuts"),
                        detail: L10n.string("Your transactions, fewer taps"), icon: .transactions)
                }
                .accessibilityIdentifier("settings-shortcuts")
                SettingsDivider()
                NavigationLink {
                    SettingsLanguageView()
                } label: {
                    SettingsRow(
                        L10n.string("Language"), detail: AppLanguageStore.shared.preference.title,
                        icon: .book)
                }
                .accessibilityIdentifier("settings-language")
            }

            SettingsGroup(title: L10n.string("Help shape Kualia")) {
                Button {
                    store.openFeedback(.features)
                } label: {
                    SettingsRow(
                        L10n.string("Feature requests"),
                        detail: L10n.string("Share an idea. Vote on what's next."),
                        icon: .idea)
                }
                .accessibilityIdentifier("settings-userjot")
                SettingsDivider()
                Link(destination: SettingsLinks.discord) {
                    SettingsRow(
                        L10n.string("Join us on Discord"), icon: .discord, external: true)
                }
                .accessibilityIdentifier("settings-discord")
                SettingsDivider()
                Button {
                    store.openFeedback(.updates)
                } label: {
                    SettingsRow(
                        L10n.string("What's new"), detail: L10n.string("The latest improvements"),
                        icon: .updates,
                        external: true)
                }
            }
            SettingsGroup(title: L10n.string("A helping hand")) {
                Button {
                    store.browser = .init(url: SettingsLinks.documentation)
                } label: {
                    SettingsRow(
                        L10n.string("Documentation"),
                        detail: L10n.string("Get comfortable with your budget"),
                        icon: .book, external: true)
                }
                SettingsDivider()
                NavigationLink {
                    SettingsSupportView()
                } label: {
                    SettingsRow(
                        L10n.string("Contact support"),
                        detail: L10n.string("A real person, ready to help"),
                        icon: .support)
                }
                SettingsDivider()
                NavigationLink {
                    SettingsAboutView()
                } label: {
                    SettingsRow(
                        L10n.string("About Kualia"),
                        detail: L10n.string("Our story, privacy, and terms"), icon: .heart
                    )
                }
            }
            Button(role: .destructive) {
                confirmsLogout = true
            } label: {
                HStack {
                    KualiaIconImage(icon: .logout, size: 20)
                    Text(L10n.string("Log out"))
                }
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .disabled(store.isSaving)
            .buttonStyle(.kualiaHaptic)
            #if DEBUG
                ScreenshotDemoToggle()
            #endif
            SettingsFooter()
        }
        .navigationTitle(L10n.string("Account settings"))
        .navigationDestination(isPresented: $showsWidgets) {
            SettingsWidgetsView(session: session)
        }
        .onAppear {
            if initialWidgetsDestination && !hasOpenedInitialWidgets {
                hasOpenedInitialWidgets = true
                showsWidgets = true
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .environment(\.settingsProfileImage, store.profileImageData)
        .environment(\.settingsProfileImageRemoved, store.hasRemovedProfileImage)
        .environment(\.settingsProfileName, store.profile?.displayName)
        .environment(\.confirmSettingsLogout, { confirmsLogout = true })
        .tint(KualiaPalette.ink)
        .sheet(item: $store.browser) { destination in
            Group {
                switch destination.content {
                case .website(let url): SettingsBrowser(url: url).ignoresSafeArea()
                case .feedback(let feedback):
                    SettingsFeedbackSheet(store: store, destination: feedback)
                }
            }
        }
        .alert(
            confirmsLogout
                ? L10n.string("Log out of Kualia?") : L10n.string("Something needs another try"),
            isPresented: Binding(
                get: { confirmsLogout || store.actionError != nil },
                set: {
                    if !$0 {
                        confirmsLogout = false
                        store.actionError = nil
                    }
                }
            )
        ) {
            if confirmsLogout {
                Button(L10n.string("Cancel"), role: .cancel) { confirmsLogout = false }
                Button(L10n.string("Log out"), role: .destructive) {
                    Task { await store.signOut() }
                }
            } else {
                Button("OK", role: .cancel) { store.actionError = nil }
            }
        } message: {
            Text(
                confirmsLogout
                    ? L10n.string("Your budgets will be here when you come back.")
                    : (store.actionError ?? L10n.string("Please try again.")))
        }
    }

    private var profileHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink {
                SettingsAccountView(store: store)
            } label: {
                HStack(spacing: 16) {
                    SettingsAvatar(size: 64)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(
                            store.profile?.displayName ?? clerk.user?.firstName
                                ?? L10n.string("Your account")
                        )
                        .font(.title2.weight(.bold)).fontDesign(.rounded)
                        Text(
                            store.profile?.email ?? clerk.user?.primaryEmailAddress?.emailAddress
                                ?? L10n.string("Account details")
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        .lineLimit(2).multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    KualiaIconImage(icon: .chevronRight, size: 16)
                        .foregroundStyle(KualiaPalette.mutedInk)
                }
                .padding(.vertical, 8).contentShape(Rectangle())
            }.buttonStyle(.kualiaHaptic)
            if let error = store.profileError {
                SettingsRetry(message: error, retry: store.reload)
            }
        }
    }
}

struct SettingsAvatar: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.settingsProfileImage) private var profileImage
    @Environment(\.settingsProfileImageRemoved) private var imageRemoved
    @Environment(\.settingsProfileName) private var profileName
    var size: CGFloat = 30
    var body: some View {
        Group {
            if let profileImage, let image = UIImage(data: profileImage) {
                Image(uiImage: image).resizable().scaledToFill()
            } else if !imageRemoved, let user = clerk.user, user.hasImage,
                let url = URL(string: user.imageUrl)
            {
                SettingsRemoteAvatar(url: url) {
                    fallback
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size).clipShape(Circle())
        .overlay(Circle().strokeBorder(KualiaPalette.border.opacity(0.5), lineWidth: 1))
        .accessibilityHidden(true)
        .onChange(of: profileImage, initial: true) { _, data in
            if data != nil { SettingsAvatarImageCache.shared.removeAll() }
        }
        .onChange(of: imageRemoved, initial: true) { _, removed in
            if removed { SettingsAvatarImageCache.shared.removeAll() }
        }
    }
    private var initials: String {
        let name =
            profileName
            ?? [clerk.user?.firstName, clerk.user?.lastName]
            .compactMap { $0 }.joined(separator: " ")
        let initials = SettingsPickerOptions.initials(name)
        return initials.isEmpty
            ? (clerk.user?.primaryEmailAddress?.emailAddress.first.map { String($0).uppercased() }
                ?? "?")
            : initials
    }

    private var fallback: some View {
        Text(initials)
            .font(.system(size: size * 0.35, weight: .semibold, design: .rounded))
            .foregroundStyle(KualiaPalette.ink)
            .frame(width: size, height: size)
            .background(KualiaPalette.surface)
    }

}

/// A remounted settings button can draw its decoded photo on the first frame,
/// including after Quick Assign or a workspace handoff replaces the toolbar.
struct SettingsRemoteAvatar<Placeholder: View>: View {
    let url: URL
    var cache: SettingsAvatarImageCache = .shared
    @ViewBuilder let placeholder: () -> Placeholder

    var body: some View {
        Group {
            if let image = cache.image(for: url) {
                image.resizable().scaledToFill()
            } else {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                        .onAppear { cache.insert(image, for: url) }
                } placeholder: {
                    placeholder()
                }
            }
        }
    }
}

@MainActor
final class SettingsAvatarImageCache {
    static let shared = SettingsAvatarImageCache()
    private let images = NSCache<NSURL, Entry>()

    init() { images.countLimit = 12 }

    func image(for url: URL) -> Image? { images.object(forKey: url as NSURL)?.image }

    func insert(_ image: Image, for url: URL) {
        images.setObject(Entry(image), forKey: url as NSURL)
    }

    func removeAll() { images.removeAllObjects() }

    private final class Entry {
        let image: Image
        init(_ image: Image) { self.image = image }
    }
}

struct SettingsCanvas<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) { content }
                .frame(maxWidth: 600)
                .padding(.horizontal, 22).padding(.top, 16).padding(.bottom, 32)
                .frame(maxWidth: .infinity)
        }
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .foregroundStyle(KualiaPalette.ink)
        .scrollDismissesKeyboard(.interactively)
    }
}

struct SettingsGroup<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).fontDesign(.rounded).padding(.leading, 4)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) { content }
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
                .buttonStyle(.kualiaHaptic)
        }
    }
}

struct SettingsRow: View {
    let title: String
    var detail: String?
    var icon: KualiaIcon?
    var value: String?
    var external = false
    init(
        _ title: String, detail: String? = nil, icon: KualiaIcon? = nil, value: String? = nil,
        external: Bool = false
    ) {
        self.title = title
        self.detail = detail
        self.icon = icon
        self.value = value
        self.external = external
    }
    var body: some View {
        HStack(spacing: 14) {
            if let icon {
                KualiaIconImage(icon: icon, size: 20).frame(width: 27).foregroundStyle(
                    KualiaPalette.mutedInk)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(KualiaPalette.ink)
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }.multilineTextAlignment(.leading)
            Spacer(minLength: 2)
            if let value {
                Text(value).font(.caption.weight(.medium)).foregroundStyle(KualiaPalette.mutedInk)
            }
            KualiaIconImage(icon: external ? .arrowUpRight : .chevronRight, size: 16)
                .foregroundStyle(KualiaPalette.mutedInk)
        }
        .padding(.horizontal, 18).padding(.vertical, 18)
        .frame(minHeight: 64).contentShape(Rectangle())
    }
}

struct SettingsDivider: View {
    var body: some View {
        Divider().overlay(KualiaPalette.border.opacity(0.25)).padding(.leading, 59).padding(
            .trailing, 18)
    }
}

struct SettingsRetry: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(message).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            Button(L10n.string("Try again"), action: retry).font(.subheadline.weight(.semibold))
                .buttonStyle(
                    .bordered)
        }
    }
}

struct SettingsFooter: View {
    var body: some View {
        VStack(spacing: 7) {
            Text("Kualia").font(.title3.weight(.bold)).fontDesign(.rounded)
            Text(L10n.string("Version \(SettingsLinks.version())")).font(.caption)
            Text(L10n.string("Made with ❤️ by Igor"))
                .font(.caption)
                .accessibilityLabel(L10n.string("Made with love by Igor"))
        }
        .foregroundStyle(KualiaPalette.mutedInk).frame(maxWidth: .infinity).padding(.top, 2)
    }
}

struct SettingsBrowser: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

extension SettingsAppearance {
    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct SettingsTextInput: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    init(_ title: String, placeholder: String, text: Binding<String>) {
        self.title = title
        self.placeholder = placeholder
        _text = text
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.caption.weight(.medium)).foregroundStyle(KualiaPalette.mutedInk)
            TextField(placeholder, text: $text)
                .font(.body.weight(.medium)).textInputAutocapitalization(.words)
                .padding(14).background(
                    KualiaPalette.canvas, in: RoundedRectangle(cornerRadius: 12)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12).strokeBorder(
                        KualiaPalette.border.opacity(0.5))
                )
                .accessibilityLabel(title)
        }
    }
}

struct SettingsChoiceField: View {
    let title: String
    let value: String
    let action: () -> Void
    init(_ title: String, value: String, action: @escaping () -> Void) {
        self.title = title
        self.value = value
        self.action = action
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.caption.weight(.medium)).foregroundStyle(KualiaPalette.mutedInk)
            Button(action: action) {
                HStack(spacing: 12) {
                    Text(value).font(.body.weight(.medium)).multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    KualiaIconImage(icon: .chevronDown, size: 16).foregroundStyle(
                        KualiaPalette.mutedInk)
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(KualiaPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12).strokeBorder(
                            KualiaPalette.border.opacity(0.5)))
            }.accessibilityLabel("\(title), \(value)").accessibilityHint(
                L10n.string("Choose \(title.lowercased())"))
        }
    }
}

struct SettingsFact: View {
    let title: String
    let value: String
    init(_ title: String, value: String) {
        self.title = title
        self.value = value
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            Text(value).font(.body).textSelection(.enabled).fixedSize(
                horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SettingsActionRow: View {
    let title: String
    let detail: String
    let icon: KualiaIcon
    var destructive = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                KualiaIconImage(icon: icon, size: 22)
                    .foregroundStyle(
                        destructive ? KualiaPalette.budgetNegative : KualiaPalette.ink)
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(detail).font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 12)
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
            .padding(18).frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .foregroundStyle(KualiaPalette.ink)
    }
}

struct SettingsSearchField: View {
    @Binding var text: String
    var prompt = L10n.string("Search")
    var body: some View {
        TextField(prompt, text: $text).textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(14).background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 14))
            .accessibilityLabel(L10n.string("Search options"))
    }
}

struct SettingsOptionRow: View {
    let title: String
    var detail: String? = nil
    let selected: Bool
    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.body.weight(.medium))
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            Spacer(minLength: 0)
            KualiaIconImage(icon: .checkCircle, size: 22).opacity(selected ? 1 : 0)
        }.padding(18).frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
            .multilineTextAlignment(.leading).contentShape(Rectangle())
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct SettingsFeedbackSheet: View {
    let store: SettingsStore
    let destination: SettingsFeedbackDestination
    @Environment(\.dismiss) private var dismiss
    @State private var url: URL?
    @State private var error: String?
    @State private var attempt = 0
    var body: some View {
        Group {
            if let url {
                SettingsBrowser(url: url).ignoresSafeArea()
            } else {
                NavigationStack {
                    VStack(spacing: 20) {
                        if let error {
                            SettingsRetry(message: error, retry: { attempt += 1 })
                        } else {
                            ProgressView(L10n.string("Getting things ready…"))
                        }
                    }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(KualiaPalette.canvas).foregroundStyle(KualiaPalette.ink)
                        .navigationTitle(
                            destination == .features
                                ? L10n.string("Feature requests") : L10n.string("What's new")
                        )
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                KualiaCloseButton(placement: .toolbar) { dismiss() }
                            }
                        }
                }
            }
        }.task(id: attempt) {
            error = nil
            do { url = try await store.feedbackURL(destination) } catch {
                if !Task.isCancelled {
                    self.error = L10n.string("Couldn't open this page. Try again.")
                }
            }
        }
    }
}
