import ClerkKit
import ImageIO
import PhotosUI
import SwiftUI

struct SettingsMembershipCard: View {
    let store: SettingsStore
    @Environment(\.colorScheme) private var colorScheme
    var showsDisclosure = true

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let membership = SettingsMembershipPresentation(
                subscription: store.membershipSubscription, access: store.appAccess,
                now: context.date)
            let accent = accent(for: membership.tone)
            let countdown = SettingsMembershipCountdown(
                subscription: store.membershipSubscription, access: store.appAccess,
                now: context.date)
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    Group {
                        if store.appAccess?.usesFamilySubscription == true {
                            KualiaIconImage(icon: .family, size: 22)
                        } else if store.membershipSubscription?.isTrial != true,
                            membership.tone == .green
                        {
                            KualiaIconImage(icon: .badgeCheck, size: 22)
                        } else {
                            KualiaIconImage(
                                icon: store.membershipSubscription?.isTrial == true
                                    ? .calendarFilled : .subscription, size: 22)
                        }
                    }
                    .foregroundStyle(accent)
                    Text(store.hasLoadedPlan ? membership.status : L10n.string("Membership"))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(accent)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if showsDisclosure {
                        KualiaIconImage(icon: .chevronRight, size: 16).foregroundStyle(accent)
                    }
                }
                Text(store.hasLoadedPlan ? membership.title : L10n.string("A little more clarity."))
                    .font(.system(.title2, design: .serif, weight: .regular))
                    .fixedSize(horizontal: false, vertical: true)
                if store.hasLoadedPlan {
                    if let countdown {
                        VStack(alignment: .leading, spacing: 8) {
                            ViewThatFits(in: .horizontal) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(countdown.label).font(.caption).foregroundStyle(
                                        secondaryInk)
                                    Spacer(minLength: 8)
                                    Text(countdown.remaining).font(.subheadline.weight(.semibold))
                                        .foregroundStyle(accent)
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(countdown.label).font(.caption).foregroundStyle(
                                        secondaryInk)
                                    Text(countdown.remaining).font(.subheadline.weight(.semibold))
                                        .foregroundStyle(accent)
                                }
                            }
                            if let fraction = countdown.trialFractionRemaining {
                                GeometryReader { geometry in
                                    Capsule().fill(primaryInk.opacity(0.12))
                                        .overlay(alignment: .leading) {
                                            Capsule().fill(accent).frame(
                                                width: geometry.size.width * fraction)
                                        }
                                }.frame(height: 5).accessibilityHidden(true)
                            }
                            Text(countdown.date, format: .dateTime.month(.abbreviated).day().year())
                                .font(.caption).foregroundStyle(secondaryInk)
                        }
                    } else {
                        Text(membership.footnote).font(.caption).foregroundStyle(
                            secondaryInk
                        )
                        .fixedSize(horizontal: false, vertical: true)
                    }
                } else if store.planError != nil {
                    Text(L10n.string("Membership couldn't load. Open details to try again."))
                        .font(.caption).foregroundStyle(secondaryInk)
                } else {
                    ProgressView(L10n.string("Loading membership…")).tint(accent)
                        .font(.caption).foregroundStyle(primaryInk)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 28).fill(
                    LinearGradient(
                        colors: backgroundColors,
                        startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .overlay(alignment: .topTrailing) {
                    ZStack {
                        ForEach(0..<5) { index in
                            Ellipse().stroke(accent.opacity(0.09), lineWidth: 1)
                                .frame(
                                    width: CGFloat(140 + index * 34),
                                    height: CGFloat(220 + index * 34))
                        }
                    }.rotationEffect(.degrees(35)).offset(x: 100, y: -100)
                        .allowsHitTesting(false).accessibilityHidden(true)
                }.clipShape(RoundedRectangle(cornerRadius: 28))
            }
            .overlay(
                RoundedRectangle(cornerRadius: 28).strokeBorder(
                    accent.opacity(colorScheme == .dark ? 0.25 : 0.14))
            )
            .foregroundStyle(primaryInk).multilineTextAlignment(.leading)
            .accessibilityElement(children: .combine)
        }
    }

    private var primaryInk: Color {
        colorScheme == .dark ? .white : Color(red: 0.13, green: 0.23, blue: 0.19)
    }

    private var secondaryInk: Color {
        colorScheme == .dark ? .white.opacity(0.75) : Color(red: 0.34, green: 0.40, blue: 0.35)
    }

    private var backgroundColors: [Color] {
        colorScheme == .dark
            ? [Color(red: 0.12, green: 0.23, blue: 0.21), Color(red: 0.055, green: 0.1, blue: 0.1)]
            : [
                Color(red: 0.94, green: 0.96, blue: 0.90),
                Color(red: 0.98, green: 0.98, blue: 0.95),
            ]
    }

    private func accent(for tone: SettingsMembershipPresentation.Tone) -> Color {
        if colorScheme == .dark {
            return switch tone {
            case .green: Color(red: 0.77, green: 0.91, blue: 0.69)
            case .gold: Color(red: 0.98, green: 0.82, blue: 0.54)
            case .rose: Color(red: 1, green: 0.73, blue: 0.67)
            case .neutral: Color(red: 0.8, green: 0.85, blue: 0.84)
            }
        }
        return switch tone {
        case .green: Color(red: 0.22, green: 0.39, blue: 0.26)
        case .gold: Color(red: 0.48, green: 0.34, blue: 0.12)
        case .rose: Color(red: 0.62, green: 0.27, blue: 0.23)
        case .neutral: Color(red: 0.34, green: 0.40, blue: 0.35)
        }
    }
}

struct SettingsMembershipView: View {
    let store: SettingsStore
    @Environment(\.openURL) private var openURL

    var body: some View {
        SettingsCanvas {
            SettingsMembershipCard(store: store, showsDisclosure: false)
            if let error = store.planError {
                SettingsRetry(message: error, retry: store.reloadMembership)
            }
            if store.hasLoadedPlan {
                if store.appAccess?.usesFamilySubscription == true,
                    let family = store.appAccess?.familyAccess
                {
                    SettingsGroup(title: L10n.string("Shared with you")) {
                        SettingsInfoRow(L10n.string("Managed by"), value: family.owner.displayName)
                        SettingsDivider()
                        SettingsInfoRow(
                            L10n.string("Your access"),
                            value: L10n.string("Included in your family's membership"))
                    }
                    Text(
                        L10n.string(
                            "Your family manager takes care of billing. You don't need a separate subscription for shared access."
                        )
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                }
                if let subscription = store.membershipSubscription {
                    if !subscription.isLifetime, let source = subscription.store,
                        let url = billingURL(source)
                    {
                        SettingsGroup(title: L10n.string("Billing")) {
                            Button {
                                openURL(url)
                            } label: {
                                SettingsRow(
                                    L10n.string("Manage in \(sourceLabel(source))"),
                                    detail: L10n.string("Review billing or cancel renewal"),
                                    icon: .creditCard,
                                    external: true)
                            }
                        }
                    }
                    SettingsGroup(
                        title: store.appAccess?.usesFamilySubscription == true
                            ? L10n.string("Your own subscription")
                            : L10n.string("Membership details")
                    ) {
                        SettingsInfoRow(L10n.string("Plan"), value: subscription.planName)
                        SettingsDivider()
                        TimelineView(.periodic(from: .now, by: 60)) { context in
                            SettingsInfoRow(
                                L10n.string("Status"),
                                value: subscription.statusLabel(at: context.date))
                        }
                        if let date = subscription.expiration, !subscription.isLifetime {
                            SettingsDivider()
                            SettingsInfoRow(
                                subscription.dateLabel(at: .now),
                                value: date.formatted(
                                    Date.FormatStyle(
                                        date: .abbreviated, time: .omitted, locale: L10n.locale)))
                        }
                        if let source = subscription.store {
                            SettingsDivider()
                            SettingsInfoRow(
                                L10n.string("Purchased through"), value: sourceLabel(source))
                        }
                    }
                } else if store.appAccess?.usesFamilySubscription != true {
                    if let family = store.appAccess?.familyAccess, family.role == "member" {
                        Text(
                            L10n.string(
                                "Ask \(family.owner.displayName) to check the family membership to restore shared access."
                            )
                        )
                        .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    Link(destination: SettingsLinks.billing) {
                        SettingsRow(
                            L10n.string("Membership on Kualia web"),
                            detail: L10n.string("Review your account and available plans"),
                            icon: .creditCard,
                            external: true)
                    }
                }
            }
        }
        .navigationTitle(L10n.string("Membership")).navigationBarTitleDisplayMode(.inline)
    }

    private func sourceLabel(_ source: String) -> String {
        switch source.lowercased() {
        case "app_store": L10n.string("App Store")
        case "stripe", "rc_billing": L10n.string("Kualia web")
        case "promotional": L10n.string("Promotional access")
        case "play_store": L10n.string("Google Play")
        default: "Kualia"
        }
    }
    private func billingURL(_ source: String) -> URL? {
        switch source.lowercased() {
        case "app_store": SettingsLinks.appleSubscriptions
        case "stripe", "rc_billing": SettingsLinks.billing
        case "play_store": URL(string: "https://play.google.com/store/account/subscriptions")
        default: nil
        }
    }
}

struct SettingsAccountView: View {
    let store: SettingsStore
    @Environment(Clerk.self) private var clerk
    @State private var cropPhoto: SettingsCropPhoto?
    @State private var name = ""
    @State private var hasEditedName = false
    @State private var photo: PhotosPickerItem?
    @State private var isPreparingPhoto = false
    @State private var photoError: String?

    private var canSave: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed != (store.profile?.name ?? "") && store.profile != nil
            && !store.isSaving
    }

    var body: some View {
        SettingsCanvas {
            if let error = store.profileError { SettingsRetry(message: error, retry: store.reload) }
            let isChangingPhoto = store.isUpdatingImage || isPreparingPhoto
            HStack(spacing: 22) {
                SettingsAvatar(size: 80)
                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.string("Make yourself at home.")).font(.headline).fontDesign(.rounded)
                    HStack(spacing: 10) {
                        PhotosPicker(selection: $photo, matching: .images) {
                            HStack(spacing: 6) {
                                if isChangingPhoto {
                                    ProgressView().controlSize(.small)
                                } else {
                                    KualiaIconImage(icon: .camera, size: 16)
                                }
                                Text(L10n.string("Change"))
                            }
                        }
                        .accessibilityLabel(L10n.string("Change profile photo"))
                        .accessibilityIdentifier("settings-change-photo")
                        if store.profileImageData != nil
                            || (!store.isDemo && !store.hasRemovedProfileImage
                                && clerk.user?.hasImage == true)
                        {
                            Button(role: .destructive) {
                                Task { await store.removeProfileImage() }
                            } label: {
                                HStack(spacing: 6) {
                                    KualiaIconImage(icon: .close, size: 16)
                                    Text(L10n.string("Remove"))
                                }
                            }
                            .accessibilityLabel(L10n.string("Remove profile photo"))
                            .accessibilityIdentifier("settings-remove-photo")
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.bordered)
                    .disabled(isChangingPhoto || store.isSaving)
                }
            }.padding(.vertical, 8)
            if let photoError {
                Text(photoError).font(.caption).foregroundStyle(KualiaPalette.budgetNegative)
            }
            if let profile = store.profile {
                SettingsGroup(title: L10n.string("Your profile")) {
                    VStack(alignment: .leading, spacing: 14) {
                        SettingsTextInput(
                            L10n.string("Name"), placeholder: L10n.string("Your name"), text: $name
                        )
                        .textContentType(.givenName).disabled(store.isSaving)
                        .onChange(of: name) { _, _ in hasEditedName = true }
                        Text(L10n.string("This is the name you'll see around Kualia."))
                            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                        Button {
                            store.saveName(name)
                        } label: {
                            Text(L10n.string("Save name")).frame(maxWidth: .infinity, minHeight: 32)
                        }.buttonStyle(.borderedProminent).tint(KualiaPalette.ink)
                            .foregroundStyle(KualiaPalette.surface).disabled(!canSave)
                    }.padding(20)
                }
                VStack(alignment: .leading, spacing: 22) {
                    Text(L10n.string("Account information")).font(.headline).fontDesign(.rounded)
                    SettingsCopyField(title: L10n.string("Email"), value: profile.email)
                    Divider()
                    SettingsCopyField(title: L10n.string("Account ID"), value: profile.clerkId)
                }.padding(.horizontal, 4)
                NavigationLink {
                    SettingsMembershipView(store: store)
                } label: {
                    SettingsMembershipCard(store: store)
                }
                .buttonStyle(.kualiaHaptic)
            } else if store.profileError == nil {
                ProgressView(L10n.string("Loading account details…"))
            }
            SettingsGroup(title: L10n.string("Account controls")) {
                NavigationLink {
                    SettingsDeleteAccountView(store: store)
                } label: {
                    SettingsRow(
                        L10n.string("Delete account"),
                        detail: L10n.string("Close your account and remove owned workspaces"),
                        icon: .trash
                    )
                }.disabled(store.isSaving)
            }
        }
        .navigationTitle(L10n.string("Account details")).navigationBarTitleDisplayMode(.inline)
        .onChange(of: store.profile?.name, initial: true) { _, value in
            if !hasEditedName { name = value ?? "" }
        }
        .sheet(item: $cropPhoto, onDismiss: { photo = nil }) { photo in
            SettingsPhotoCropView(image: photo.image) { data in
                cropPhoto = nil
                Task { await store.updateProfileImage(data) }
            }
        }
        .task(id: photo) {
            guard let photo else { return }
            isPreparingPhoto = true
            photoError = nil
            defer { isPreparingPhoto = false }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self),
                    let jpeg = SettingsProfilePhoto.jpeg(from: data)
                else {
                    photoError = L10n.string("Choose a photo that can be opened on this device.")
                    return
                }
                guard !Task.isCancelled else { return }
                guard let image = UIImage(data: jpeg) else { return }
                cropPhoto = SettingsCropPhoto(image: image)
            } catch {
                if !Task.isCancelled {
                    photoError = L10n.string("Couldn't load that photo. Please try again.")
                }
            }
        }
    }
}

struct SettingsCopyField: View {
    let title: String
    let value: String
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                Spacer()
                Button {
                    UIPasteboard.general.string = value
                    copied = true
                } label: {
                    HStack(spacing: 6) {
                        KualiaIconImage(icon: copied ? .check : .copy, size: 16)
                        Text(copied ? L10n.string("Copied") : L10n.string("Copy")).font(
                            .caption.weight(.semibold))
                    }.frame(minHeight: 32)
                }.buttonStyle(.kualiaHaptic).accessibilityLabel(
                    L10n.string("Copy \(title.lowercased())"))
            }
            Text(value).font(.body).textSelection(.enabled).fixedSize(
                horizontal: false, vertical: true)
        }.task(id: copied) {
            guard copied else { return }
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            copied = false
        }
    }
}

enum SettingsProfilePhoto {
    static func jpeg(from data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let thumbnail = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 1024,
                ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: thumbnail).jpegData(compressionQuality: 0.85)
    }
}

struct SettingsDeleteAccountView: View {
    let store: SettingsStore
    @State private var confirmation = ""
    @State private var confirmsDeletion = false
    @FocusState private var isTyping: Bool

    var body: some View {
        SettingsCanvas {
            if store.isAccountDeleted {
                VStack(alignment: .leading, spacing: 16) {
                    Text(L10n.string("Account deleted")).font(.largeTitle.bold()).fontDesign(
                        .rounded)
                    Text(
                        L10n.string(
                            "Your account deletion is underway. Finish signing out of this device.")
                    )
                    Button(L10n.string("Finish signing out")) { Task { await store.signOut() } }
                        .buttonStyle(.borderedProminent).tint(KualiaPalette.ink)
                        .foregroundStyle(KualiaPalette.surface).disabled(store.isSaving)
                }
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    KualiaIconImage(icon: .trash, size: 38)
                        .foregroundStyle(KualiaPalette.budgetNegative)
                    Text(L10n.string("Before you go")).font(.largeTitle.bold()).fontDesign(.rounded)
                    Text(
                        L10n.string(
                            "Deleting your account removes every workspace you own, including its accounts, transactions, and budgets. People sharing those workspaces lose access, and linked banks are disconnected."
                        )
                    )
                    .font(.body)
                }
                SettingsGroup(title: L10n.string("What happens next")) {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(
                            L10n.string(
                                "Financial data is retained for 30 days, then permanently removed during the next scheduled deletion cycle. Your sign-in identity and billing history are retained for support."
                            )
                        )
                        Text(
                            L10n.string(
                                "Kualia stops renewal of web trials and subscriptions. App Store subscriptions must be canceled separately in Apple Subscriptions."
                            )
                        )
                        .fontWeight(.medium)
                        Link(
                            L10n.string("Open Apple Subscriptions"),
                            destination: SettingsLinks.appleSubscriptions
                        )
                        .underline().frame(minHeight: 44)
                    }.font(.subheadline).padding(20)
                }
                SettingsGroup(title: L10n.string("Type DELETE to confirm")) {
                    TextField(text: $confirmation) { Text(verbatim: "DELETE") }
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .focused($isTyping).padding(20).disabled(store.isSaving)
                        .accessibilityIdentifier("settings-delete-confirmation")
                }
                Button(role: .destructive) {
                    isTyping = false
                    confirmsDeletion = true
                } label: {
                    HStack {
                        if store.isSaving { ProgressView() }
                        Text(
                            store.isSaving
                                ? L10n.string("Deleting account…")
                                : L10n.string("Delete my account"))
                    }.font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.borderedProminent).tint(KualiaPalette.budgetNegative)
                .foregroundStyle(KualiaPalette.surface)
                .disabled(confirmation != "DELETE" || store.isSaving)
                .accessibilityIdentifier("settings-delete-account")
            }
        }
        .navigationTitle(L10n.string("Delete account")).navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(store.isSaving)
        .alert(
            L10n.string("Delete your account and all owned workspaces?"),
            isPresented: $confirmsDeletion
        ) {
            Button(L10n.string("Delete account"), role: .destructive) {
                Task { await store.deleteAccount(confirmation: confirmation) }
            }
        } message: {
            Text(L10n.string("This signs you out and starts account deletion."))
        }
    }
}

struct SettingsInfoRow: View {
    let title: String
    let value: String
    init(_ title: String, value: String) {
        self.title = title
        self.value = value
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            Text(value).font(.body.weight(.medium)).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
    }
}

struct SettingsCropPhoto: Identifiable {
    let id = UUID()
    let image: UIImage
}

struct SettingsPhotoCropView: View {
    let image: UIImage
    let onSave: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var zoom: CGFloat = 1
    @State private var offset: CGSize = .zero

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let canvasHeight = max(1, geometry.size.height - 68)
                let side = max(1, min(geometry.size.width - 48, canvasHeight - 48))
                let scale = max(side / image.size.width, side / image.size.height) * zoom
                VStack(spacing: 0) {
                    ZStack {
                        Color.black
                        // Match the crop viewport's transform so the surrounding photo moves
                        // continuously with the bright circular selection.
                        Image(uiImage: image)
                            .resizable()
                            .frame(
                                width: image.size.width * scale, height: image.size.height * scale
                            )
                            .offset(x: offset.width, y: offset.height)
                            .accessibilityHidden(true)
                        Color.black.opacity(0.6)
                            .allowsHitTesting(false)
                        SettingsPhotoGestureCanvas(image: image) { newZoom, newOffset in
                            zoom = newZoom
                            offset = newOffset
                        }
                        .frame(width: side, height: side)
                        .clipShape(Circle())
                        .overlay(
                            Circle().stroke(.white.opacity(0.8), lineWidth: 2)
                                .allowsHitTesting(false))
                    }
                    .frame(width: geometry.size.width, height: canvasHeight)
                    .clipped()
                    Text(L10n.string("Pinch to zoom. Drag to position."))
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 68)
                }.frame(maxWidth: .infinity)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(L10n.string("Use photo")) {
                                if let data = SettingsProfilePhoto.crop(
                                    image, side: side, zoom: zoom, offset: offset)
                                {
                                    onSave(data)
                                }
                            }
                        }
                    }
            }
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("Crop photo")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    KualiaCloseButton(placement: .toolbar, label: L10n.string("Cancel")) {
                        dismiss()
                    }
                }
            }
        }
    }
}

extension SettingsProfilePhoto {
    static func clampedOffset(_ offset: CGSize, imageSize: CGSize, side: CGFloat, zoom: CGFloat)
        -> CGSize
    {
        let scale = max(side / imageSize.width, side / imageSize.height) * zoom
        let limitX = max(0, (imageSize.width * scale - side) / 2)
        let limitY = max(0, (imageSize.height * scale - side) / 2)
        return CGSize(
            width: min(max(offset.width, -limitX), limitX),
            height: min(max(offset.height, -limitY), limitY))
    }

    static func crop(_ image: UIImage, side: CGFloat, zoom: CGFloat, offset: CGSize) -> Data? {
        let scale = max(side / image.size.width, side / image.size.height) * zoom
        let offset = clampedOffset(offset, imageSize: image.size, side: side, zoom: zoom)
        let factor = 1024 / side
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: 1024, height: 1024), format: format)
            .image { _ in
                image.draw(
                    in: CGRect(
                        x: ((side - image.size.width * scale) / 2 + offset.width) * factor,
                        y: ((side - image.size.height * scale) / 2 + offset.height) * factor,
                        width: image.size.width * scale * factor,
                        height: image.size.height * scale * factor))
            }.jpegData(compressionQuality: 0.85)
    }
}

/// UIKit owns both gestures so panning stays in viewport points while pinching around the fingers.
struct SettingsPhotoGestureCanvas: UIViewRepresentable {
    let image: UIImage
    let onChange: (CGFloat, CGSize) -> Void

    func makeUIView(context: Context) -> SettingsPhotoScrollView {
        SettingsPhotoScrollView(image: image, onChange: onChange)
    }

    func updateUIView(_ view: SettingsPhotoScrollView, context: Context) {
        view.onChange = onChange
    }
}

final class SettingsPhotoScrollView: UIScrollView, UIScrollViewDelegate {
    private let photoView: UIImageView
    private let imageSize: CGSize
    private var viewportSize: CGSize = .zero
    private var isConfiguring = false
    var onChange: (CGFloat, CGSize) -> Void

    init(image: UIImage, onChange: @escaping (CGFloat, CGSize) -> Void) {
        photoView = UIImageView(image: image)
        imageSize = image.size
        self.onChange = onChange
        super.init(frame: .zero)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 4
        bounces = false
        bouncesZoom = false
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        addSubview(photoView)
        isAccessibilityElement = true
        accessibilityLabel = L10n.string("Profile photo crop")
        accessibilityHint =
            L10n.string(
                "Pinch to zoom and drag to position your photo. Swipe up or down to adjust zoom.")
        accessibilityTraits = .adjustable
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0, bounds.size != viewportSize else { return }
        isConfiguring = true
        viewportSize = bounds.size
        setZoomScale(1, animated: false)
        let scale = max(bounds.width / imageSize.width, bounds.height / imageSize.height)
        photoView.frame = CGRect(
            origin: .zero,
            size: CGSize(
                width: imageSize.width * scale, height: imageSize.height * scale))
        contentSize = photoView.bounds.size
        contentOffset = CGPoint(
            x: (contentSize.width - bounds.width) / 2,
            y: (contentSize.height - bounds.height) / 2)
        isConfiguring = false
        // Layout may run during a SwiftUI update; publish once that update has finished.
        DispatchQueue.main.async { [weak self] in self?.publishCrop() }
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { photoView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { publishCrop() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { publishCrop() }

    private func publishCrop() {
        guard !isConfiguring, viewportSize != .zero else { return }
        onChange(
            zoomScale,
            SettingsProfilePhoto.viewportOffset(
                contentSize: contentSize, viewportSize: bounds.size, contentOffset: contentOffset))
    }

    override func accessibilityIncrement() {
        setZoomScale(min(4, zoomScale + 0.25), animated: false)
    }
    override func accessibilityDecrement() {
        setZoomScale(max(1, zoomScale - 0.25), animated: false)
    }
}

extension SettingsProfilePhoto {
    static func viewportOffset(contentSize: CGSize, viewportSize: CGSize, contentOffset: CGPoint)
        -> CGSize
    {
        CGSize(
            width: (contentSize.width - viewportSize.width) / 2 - contentOffset.x,
            height: (contentSize.height - viewportSize.height) / 2 - contentOffset.y)
    }
}
