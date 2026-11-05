import ConvexMobile
import ImageIO
import PhotosUI
import SwiftUI

@MainActor
struct EntityLogoClient {
    let search: EntityLogoSearchStore.Search
    let upload: (Data) async throws -> String
    let save: (EntityLogoChoice) async throws -> Void

    static func live(
        _ client: ConvexClientWithAuth<String>, workspaceID: String,
        entityID: String, entityType: String,
        isAvailable: @escaping () -> Bool
    ) -> Self {
        Self(
            search: { query in
                guard isAvailable() else { throw CancellationError() }
                let results: [EntityLogoSearchResult] = try await client.action(
                    "logoDev:searchLogos", with: ["query": query])
                guard isAvailable() else { throw CancellationError() }
                return results
            },
            upload: { data in
                guard isAvailable() else { throw CancellationError() }
                let jpeg = try prepareImage(data)
                let address: String = try await client.mutation(
                    "storage:generateUploadUrl", with: ["workspaceId": workspaceID])
                try Task.checkCancellation()
                guard isAvailable(), let url = URL(string: address), url.scheme == "https" else {
                    throw EntityLogoError.upload
                }
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
                request.httpBody = jpeg
                let (responseData, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
                else { throw EntityLogoError.upload }
                let uploaded = try JSONDecoder().decode(UploadResponse.self, from: responseData)
                try Task.checkCancellation()
                guard isAvailable() else { throw CancellationError() }
                let result: String = try await client.mutation(
                    "storage:saveUploadedLogo",
                    with: [
                        "workspaceId": workspaceID, "storageId": uploaded.storageId,
                        "entityType": entityType, "entityId": entityID,
                        "mimeType": "image/jpeg", "fileSize": Double(jpeg.count),
                    ])
                guard isAvailable() else { throw CancellationError() }
                return result
            },
            save: { choice in
                guard isAvailable() else { throw CancellationError() }
                let request = EntityLogoUpdateRequest(
                    workspaceID: workspaceID, entityID: entityID, entityType: entityType,
                    choice: choice)
                let result: LogoUpdateResult = try await client.mutation(
                    request.function, with: request.arguments)
                guard result.success, isAvailable() else { throw EntityLogoError.upload }
            })
    }

    private struct LogoUpdateResult: Decodable { let success: Bool }

    private struct UploadResponse: Decodable { let storageId: String }

    /// Downsample before decoding; fit the whole mark inside a square without cropping it.
    static func prepareImage(_ data: Data) throws -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let thumbnail = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 512,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                ] as CFDictionary)
        else { throw EntityLogoError.image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIImage(cgImage: thumbnail)
        let scale = 512 / max(image.size.width, image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let rendered = UIGraphicsImageRenderer(
            size: CGSize(width: 512, height: 512), format: format
        )
        .image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 512, height: 512))
            image.draw(
                in: CGRect(
                    x: (512 - size.width) / 2, y: (512 - size.height) / 2,
                    width: size.width, height: size.height))
        }
        guard let jpeg = rendered.jpegData(compressionQuality: 0.9), jpeg.count <= 5 * 1024 * 1024
        else { throw EntityLogoError.image }
        return jpeg
    }
}

private enum EntityLogoError: LocalizedError {
    case image, upload
    var errorDescription: String? {
        switch self {
        case .image: L10n.string("Couldn't read this image. Choose a different photo.")
        case .upload: L10n.string("Couldn't upload your logo. Please try again.")
        }
    }
}

struct EntityLogoPicker: View {
    let name: String
    let currentURL: String?
    let defaultURL: String?
    let state: EntityLogoState
    let fallback: KualiaIcon
    let client: EntityLogoClient
    let onSelect: (EntityLogoChoice) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saver: EntityLogoSaveStore
    @State private var cropPhoto: SettingsCropPhoto?
    @State private var search: EntityLogoSearchStore
    @State private var query: String
    @State private var photo: PhotosPickerItem?
    @State private var isUploading = false
    @State private var uploadError: String?
    @State private var searchAttempt = 0

    init(
        name: String, currentURL: String?, defaultURL: String?, state: EntityLogoState,
        fallback: KualiaIcon, client: EntityLogoClient,
        onSelect: @escaping (EntityLogoChoice) -> Void
    ) {
        self.name = name
        self.currentURL = currentURL
        self.defaultURL = defaultURL
        self.state = state
        self.fallback = fallback
        self.client = client
        self.onSelect = onSelect
        _saver = State(initialValue: EntityLogoSaveStore(save: client.save))
        _query = State(initialValue: name)
        _search = State(initialValue: EntityLogoSearchStore(search: client.search))
    }

    private var isBusy: Bool { isUploading || saver.isSaving }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(spacing: 18) {
                        EntityLogoMark(url: currentURL, fallback: fallback, size: 72)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(name).font(.title2.bold()).fontDesign(.rounded)
                            Text(L10n.string("Make it easy to recognize."))
                                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        }
                    }
                    VStack(spacing: 0) {
                        PhotosPicker(selection: $photo, matching: .images) {
                            SettingsRow(
                                isUploading
                                    ? L10n.string("Uploading photo…")
                                    : L10n.string("Choose a photo"),
                                detail: L10n.string("Use your own image"), icon: .photo)
                        }
                        if state != .automatic {
                            SettingsDivider()
                            Button {
                                select(.reset)
                            } label: {
                                SettingsRow(
                                    L10n.string("Reset to default"),
                                    detail: defaultURL == nil
                                        ? L10n.string("Let Kualia choose the logo")
                                        : L10n.string("Restore the original logo"), icon: .undo)
                            }
                        }
                        if currentURL != nil || (state != .removed && defaultURL != nil) {
                            SettingsDivider()
                            Button(role: .destructive) {
                                select(.remove)
                            } label: {
                                SettingsRow(
                                    L10n.string("Remove logo"),
                                    detail: L10n.string("Use a simple symbol instead"), icon: .trash
                                )
                            }
                        }
                    }
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
                    .buttonStyle(.kualiaHaptic)
                    if let error = uploadError ?? saver.error {
                        TransactionEditorNotice(message: error, isError: true)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Text(L10n.string("Find a logo"))
                            .font(.headline).fontDesign(.rounded)
                        HStack(spacing: 10) {
                            KualiaIconImage(icon: .search, size: 19)
                                .foregroundStyle(KualiaPalette.mutedInk)
                            TextField(L10n.string("Company name or website"), text: $query)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .submitLabel(.search)
                                .accessibilityIdentifier("logo-search")
                            if !query.isEmpty {
                                Button(L10n.string("Clear search"), icon: .closeCircle) {
                                    query = ""
                                }
                                .labelStyle(.iconOnly).buttonStyle(.kualiaHaptic)
                            }
                        }
                        .padding(16)
                        .background(KualiaPalette.surface, in: Capsule())
                        searchResults
                        Text(L10n.string("Logos by Logo.dev"))
                            .font(.caption2).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                .frame(maxWidth: 600).padding(22).frame(maxWidth: .infinity)
                .disabled(isBusy)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(KualiaPalette.canvas.ignoresSafeArea())
            .foregroundStyle(KualiaPalette.ink)
            .navigationTitle(L10n.string("Choose a logo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }.disabled(isBusy)
                }
            }
            .overlay { if isBusy { ProgressView().controlSize(.large) } }
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .interactiveDismissDisabled(isBusy)
        .task(id: "\(query)-\(searchAttempt)") { await search.load(query) }
        .sheet(item: $cropPhoto, onDismiss: { photo = nil }) { selected in
            SettingsPhotoCropView(image: selected.image) { data in
                cropPhoto = nil
                isUploading = true
                uploadError = nil
                Task {
                    defer { isUploading = false }
                    do {
                        let url = try await client.upload(data)
                        await commit(.custom(url))
                    } catch {
                        uploadError = L10n.string("Couldn't upload this photo. Please try again.")
                    }
                }
            }
        }
        .task(id: photo) {
            guard let photo else { return }
            isUploading = true
            uploadError = nil
            defer { isUploading = false }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self),
                    let jpeg = SettingsProfilePhoto.jpeg(from: data),
                    let image = UIImage(data: jpeg)
                else {
                    throw EntityLogoError.image
                }
                guard !Task.isCancelled else { return }
                cropPhoto = SettingsCropPhoto(image: image)
            } catch {
                if !Task.isCancelled {
                    uploadError = L10n.string("Couldn't upload this photo. Please try again.")
                }
            }
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        if search.isSearching {
            ProgressView(L10n.string("Finding logos…"))
                .frame(maxWidth: .infinity, minHeight: 110)
        } else if let error = search.error {
            SettingsRetry(message: error, retry: { searchAttempt += 1 })
        } else if search.results.isEmpty {
            Text(
                query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2
                    ? L10n.string("Enter at least two characters to find a logo.")
                    : L10n.string("No logos found. Try a company website or choose a photo.")
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            .frame(maxWidth: .infinity, minHeight: 90)
        } else {
            LazyVStack(spacing: 10) {
                ForEach(search.results) { result in
                    Button {
                        select(.custom(result.logoUrl))
                    } label: {
                        HStack(spacing: 14) {
                            EntityLogoMark(url: result.logoUrl, fallback: fallback, size: 48)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.name).font(.body.weight(.semibold))
                                Text(result.domain).font(.caption)
                                    .foregroundStyle(KualiaPalette.mutedInk)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            KualiaIconImage(icon: .plusCircle, size: 21)
                                .foregroundStyle(KualiaPalette.mutedInk)
                        }
                        .padding(14)
                        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityLabel(L10n.string("Use \(result.name) logo, \(result.domain)"))
                }
            }
        }
    }

    private func select(_ choice: EntityLogoChoice) {
        guard !isBusy else { return }
        uploadError = nil
        Task { await commit(choice) }
    }

    private func commit(_ choice: EntityLogoChoice) async {
        guard await saver.save(choice) else { return }
        onSelect(choice)
        dismiss()
    }
}

struct EntityLogoMark: View {
    let url: String?
    var fallback: KualiaIcon = .shop
    var size: CGFloat = 48
    var body: some View {
        Group {
            #if DEBUG
                if let url = url.flatMap(URL.init(string:)),
                    let image = ScreenshotDemoLogo.image(url)
                {
                    Image(uiImage: image).resizable().scaledToFit().background(.white)
                } else {
                    remoteLogo
                }
            #else
                remoteLogo
            #endif
        }
        .frame(width: size, height: size).clipShape(Circle()).accessibilityHidden(true)
    }

    private var remoteLogo: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
            if let image = phase.image {
                image.resizable().scaledToFit().background(.white)
            } else {
                KualiaIconImage(icon: fallback, size: size * 0.42)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(KualiaPalette.border.opacity(0.25))
            }
        }
        .frame(width: size, height: size).clipShape(Circle()).accessibilityHidden(true)
    }
}
