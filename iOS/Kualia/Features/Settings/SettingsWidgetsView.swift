import PhotosUI
import SwiftUI
import WidgetKit

enum SettingsWidgetDesign: String, CaseIterable, Identifiable {
    case categories, map, bills, capture
    var id: String { rawValue }
    var kind: String {
        switch self {
        case .categories: "CategoryCardWidget"
        case .bills: "UpcomingTransactionsWidget"
        case .map: "AccountBalancesWidget"
        case .capture: "LockScreenAddTransactionWidget"
        }
    }
    var title: String {
        switch self {
        case .categories: L10n.string("Category Balances")
        case .bills: L10n.string("Upcoming Bills")
        case .map: L10n.string("Account Balances")
        case .capture: L10n.string("Add Transaction")
        }
    }
    var icon: KualiaIcon {
        switch self {
        case .categories: .envelopeOpen
        case .bills: .calendarClock
        case .map: .accounts
        case .capture: .plus
        }
    }
    var summary: String {
        switch self {
        case .categories:
            L10n.string("See what's available in the categories you choose.")
        case .bills:
            L10n.string("See your next planned bill and how many days you have until it's due.")
        case .map:
            L10n.string("See the balance of each account you choose.")
        case .capture:
            L10n.string(
                "A plus button for a new expense, or three shortcuts on medium. Tap to finish in Kualia."
            )
        }
    }
    var sizes: String {
        switch self {
        case .categories, .map: L10n.string("Small · Medium · Large · Lock Screen")
        case .bills: L10n.string("Small · Medium · Large · Lock Screen")
        case .capture: L10n.string("Small · Medium · Lock Screen · Control Center")
        }
    }
    var tip: String {
        switch self {
        case .categories:
            L10n.string(
                "Edit Widget to choose up to six categories in order. Small shows the first, medium up to three, and large up to six. Amounts are available balances for this month."
            ) + " "
                + L10n.string(
                    "On the Lock Screen, tap the widget while customizing to choose one category or account."
                )
        case .map:
            L10n.string(
                "Edit Widget to choose up to six accounts in order. Small shows the first, medium up to three, and large up to six. Each amount belongs to one account."
            ) + " "
                + L10n.string(
                    "On the Lock Screen, tap the widget while customizing to choose one category or account."
                )
        case .capture:
            L10n.string(
                "Tap a shortcut to open Kualia and finish your entry. Lock Screen and Control Center shortcuts open a new expense. Nothing is saved until you finish the form."
            )
        case .bills:
            L10n.string(
                "Amounts and due dates come from your planned expenses. Tap to review them in Kualia."
            ) + " "
                + L10n.string("On the Lock Screen, the rectangular widget shows your next payment.")
        }
    }
}

struct SettingsWidgetsView: View {
    let session: AppSessionStore
    @State private var showsInstructions = false
    @State private var refreshID = UUID()

    var body: some View {
        SettingsCanvas {
            introduction
            Button {
                showsInstructions = true
            } label: {
                HStack(spacing: 14) {
                    KualiaIconImage(icon: .plusCircle, size: 24)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L10n.string("Make room on your Home Screen")).font(
                            .subheadline.weight(.semibold))
                        Text(L10n.string("A little setup. A lot less opening the app."))
                            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    Spacer(minLength: 0)
                    KualiaIconImage(icon: .chevronRight, size: 16)
                }
                .padding(18).background(
                    KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityIdentifier("settings-widgets-how-to-add")

            VStack(alignment: .leading, spacing: 18) {
                Text(
                    L10n.string("Choose the information you want close by, then make it your own.")
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                ForEach(SettingsWidgetDesign.allCases) { design in
                    NavigationLink {
                        SettingsWidgetDetailView(design: design, session: session)
                    } label: {
                        galleryCard(design)
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityIdentifier("settings-widget-\(design.rawValue)")
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Label(
                    session.visibleWorkspaceName ?? L10n.string("Your active workspace"),
                    icon: .workspace
                )
                .font(.subheadline.weight(.semibold))
                Text(
                    L10n.string(
                        "Widgets follow the workspace you last opened. Updates arrive on iOS's schedule, so open Kualia when you need the latest details."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }.padding(.horizontal, 4)
        }
        .navigationTitle(L10n.string("Widgets"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showsInstructions) { SettingsWidgetInstructionsView() }
        .onAppear { refreshID = UUID() }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 7) {
                KualiaIconImage(icon: .widgets, size: 16)
                Text(L10n.string("YOUR WIDGETS")).font(.caption.weight(.bold)).tracking(1.7)
            }.foregroundStyle(KualiaPalette.mutedInk)
            Text(L10n.string("Your money.\nA little more you."))
                .font(.largeTitle.bold()).fontDesign(.rounded)
                .fixedSize(horizontal: false, vertical: true)
            Text(
                L10n.string(
                    "Small windows into the things that matter. Find your favorites, choose a mood, and give them a home."
                )
            )
            .font(.body).foregroundStyle(KualiaPalette.mutedInk)
        }.padding(.vertical, 8)
    }

    private func galleryCard(_ design: SettingsWidgetDesign) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            SettingsWidgetSample(design: design)
                .id("\(design.id)-\(refreshID)")
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(design.title).font(.title3.bold()).fontDesign(.rounded)
                    Spacer(minLength: 8)
                    KualiaIconImage(icon: .arrowUpRight, size: 17)
                }
                Text(design.summary).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Text(design.sizes)
                    Text("·")
                    Text(L10n.string("Your background"))
                }.font(.caption2).foregroundStyle(KualiaPalette.mutedInk)
                    .fixedSize(horizontal: false, vertical: true)
            }.padding(.horizontal, 4)
        }
        .padding(14)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 30))
        .multilineTextAlignment(.leading)
        .accessibilityElement(children: .combine)
        .accessibilityHint(L10n.string("Preview and customize this widget"))
    }

}

private struct SettingsWidgetDetailView: View {
    @Environment(\.isDemoWorkspace) private var isDemo
    let design: SettingsWidgetDesign
    let session: AppSessionStore
    @State private var style = WidgetStudioStyle.paper
    @State private var photo: PhotosPickerItem?
    @State private var imageData: Data?
    @State private var isPreparingPhoto = false
    @State private var photoError: String?
    @State private var savedMessage: String?
    @State private var revision = UUID()
    @State private var showsInstructions = false

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 18) {
                SettingsWidgetSample(design: design).id(revision)
                Text(design.summary).font(.body).foregroundStyle(KualiaPalette.mutedInk)
                Label(design.sizes, icon: .widgets).font(.caption.weight(.medium))
            }
            appearanceEditor
            if design == .categories {
                NavigationLink {
                    SettingsCategoryBalancePhotosView(session: session)
                } label: {
                    SettingsRow(
                        L10n.string("A photo for each category"),
                        detail: L10n.string("Separate photos for small and medium widgets"),
                        icon: .photo)
                }
                .buttonStyle(.kualiaHaptic)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
            }
            Text(design.tip).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            Button {
                showsInstructions = true
            } label: {
                Label(L10n.string("Add to your Home Screen"), icon: .plus)
                    .font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(.borderedProminent).tint(KualiaPalette.ink)
            .foregroundStyle(KualiaPalette.surface)
        }
        .navigationTitle(design.title).navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: refresh)
        .task(id: photo) { await importPhoto() }
        .sheet(isPresented: $showsInstructions) { SettingsWidgetInstructionsView() }
    }

    private var appearanceEditor: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.string("Set the mood")).font(.title3.bold()).fontDesign(.rounded)
                Text(
                    design == .categories
                        ? L10n.string(
                            "The default background for Category Balances in this workspace. Category photos appear when no photo is set here. Saved on this device."
                        )
                        : L10n.string(
                            "Applies to every \(design.title) widget in your active workspace, in every size. Saved on this device."
                        )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 85), spacing: 10)], spacing: 14) {
                ForEach(WidgetStudioStyle.allCases) { option in
                    Button {
                        if isDemo {
                            style = option
                            imageData = nil
                        } else {
                            WidgetStudioPreferences.removeImage(for: design.kind)
                            WidgetStudioPreferences.setStyle(option, for: design.kind)
                        }
                        savedMessage = L10n.string("\(option.title) is ready for your widgets.")
                        photoError = nil
                        refresh()
                    } label: {
                        VStack(spacing: 7) {
                            RoundedRectangle(cornerRadius: 18)
                                .fill(
                                    LinearGradient(
                                        colors: option.colors, startPoint: .topLeading,
                                        endPoint: .bottomTrailing)
                                )
                                .frame(height: 62)
                                .overlay {
                                    if style == option && imageData == nil {
                                        KualiaIconImage(icon: .checkCircle, size: 24)
                                            .foregroundStyle(option.foreground)
                                    }
                                }
                                .overlay {
                                    RoundedRectangle(cornerRadius: 18)
                                        .strokeBorder(
                                            KualiaPalette.border.opacity(0.5), lineWidth: 1)
                                }
                            Text(option.title).font(.caption.weight(.medium))
                        }
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(isPreparingPhoto)
                    .accessibilityLabel(L10n.string("\(option.title) background"))
                    .accessibilityAddTraits(style == option && imageData == nil ? .isSelected : [])
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                PhotosPicker(selection: $photo, matching: .images) {
                    HStack(spacing: 12) {
                        if isPreparingPhoto {
                            ProgressView()
                        } else {
                            KualiaIconImage(icon: .photo, size: 23)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(
                                imageData == nil
                                    ? L10n.string("Bring your own background")
                                    : L10n.string("Change your photo")
                            )
                            .font(.subheadline.weight(.semibold))
                            Text(L10n.string("Pick a photo. We'll keep the numbers readable."))
                                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                        }
                        Spacer(minLength: 0)
                        KualiaIconImage(icon: .plus, size: 18)
                    }
                    .padding(18).background(
                        KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 22))
                }
                .buttonStyle(.kualiaHaptic).disabled(isPreparingPhoto)
                .accessibilityIdentifier("settings-widget-photo")
                if imageData != nil {
                    Button(L10n.string("Remove photo"), icon: .trash) {
                        if isDemo {
                            imageData = nil
                        } else {
                            WidgetStudioPreferences.removeImage(for: design.kind)
                        }
                        savedMessage = L10n.string("Photo removed. Your color palette is back.")
                        refresh()
                    }.font(.subheadline).buttonStyle(.kualiaHaptic).disabled(
                        isPreparingPhoto)
                }
                if let photoError {
                    Text(photoError).font(.caption).foregroundStyle(KualiaPalette.budgetNegative)
                } else if let savedMessage {
                    Label(savedMessage, icon: .checkCircle)
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            Button(L10n.string("Restore original look"), icon: .undo) {
                if isDemo {
                    style = .paper
                    imageData = nil
                } else {
                    WidgetStudioPreferences.reset(for: design.kind)
                }
                savedMessage = L10n.string("Back to the original look.")
                photoError = nil
                refresh()
            }
            .font(.caption.weight(.medium)).foregroundStyle(KualiaPalette.mutedInk)
            .buttonStyle(.kualiaHaptic).disabled(isPreparingPhoto)
            Text(
                L10n.string(
                    "iOS may simplify backgrounds when widgets are tinted or their backgrounds are removed."
                )
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        }
    }

    private func refresh() {
        if !isDemo {
            style = WidgetStudioPreferences.style(for: design.kind)
            imageData = WidgetStudioPreferences.imageData(for: design.kind)
        }
        revision = UUID()
    }

    private func importPhoto() async {
        guard let photo else { return }
        let workspaceID = session.current?.workspace.id
        isPreparingPhoto = true
        photoError = nil
        defer {
            isPreparingPhoto = false
            if self.photo == photo { self.photo = nil }
        }
        do {
            guard let data = try await photo.loadTransferable(type: Data.self),
                let image = UIImage(data: data)
            else {
                photoError = L10n.string(
                    "That photo couldn't be opened. Try another from your library.")
                return
            }
            guard !Task.isCancelled, workspaceID == session.current?.workspace.id else { return }
            if isDemo {
                imageData = data
                refresh()
                return
            }
            guard WidgetStudioPreferences.saveImage(image, for: design.kind) else {
                photoError = L10n.string("Your photo couldn't be saved. Please try again.")
                return
            }
            savedMessage = L10n.string("Photo saved. Your widgets will pick up the new look.")
            refresh()
        } catch {
            guard !Task.isCancelled else { return }
            photoError =
                L10n.string(
                    "Your photo couldn't be loaded. Please try again. \(error.localizedDescription)"
                )
        }
    }
}

private struct SettingsCategoryBalancePhotosView: View {
    @Environment(\.isDemoWorkspace) private var isDemo
    @State private var demoPhotos: [String: Data] = [:]
    let session: AppSessionStore
    @State private var selectedCategoryID = ""
    @State private var size = WidgetImageStorage.WidgetSize.small
    @State private var photo: PhotosPickerItem?
    @State private var imageData: Data?
    @State private var isPreparingPhoto = false
    @State private var photoError: String?
    @State private var savedMessage: String?

    private var categories: [BudgetCategory] {
        session.current?.budget.planGroups.flatMap(\.categories) ?? []
    }
    private var selectedCategory: BudgetCategory? {
        categories.first { $0.id == selectedCategoryID }
    }

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.string("An envelope with a view.")).font(.title.bold()).fontDesign(
                    .rounded)
                Text(
                    L10n.string(
                        "Choose a photo for each category and widget size. Small and medium use the first selected category’s photo when no widget photo is set."
                    )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            if categories.isEmpty {
                ContentUnavailableView(
                    L10n.string("Your categories belong here"), icon: .envelopeOpen,
                    description: Text(
                        L10n.string(
                            "Open your budget to load or create categories, then come back to personalize their widgets."
                        )
                    ))
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    Picker(L10n.string("Category"), selection: $selectedCategoryID) {
                        ForEach(categories) { category in
                            Text(category.name).tag(category.id)
                        }
                    }.pickerStyle(.menu)
                    Picker(L10n.string("Widget size"), selection: $size) {
                        Text(L10n.string("Small")).tag(WidgetImageStorage.WidgetSize.small)
                        Text(L10n.string("Medium")).tag(WidgetImageStorage.WidgetSize.medium)
                    }.pickerStyle(.segmented)
                    categoryPreview
                    Text(L10n.string("Preview · Sample amount"))
                        .font(.caption2).foregroundStyle(KualiaPalette.mutedInk)
                        .frame(maxWidth: .infinity)
                }
                .disabled(isPreparingPhoto)
                PhotosPicker(selection: $photo, matching: .images) {
                    HStack(spacing: 10) {
                        if isPreparingPhoto { ProgressView() }
                        Label(
                            imageData == nil
                                ? L10n.string("Choose a photo") : L10n.string("Change photo"),
                            icon: .photo)
                    }.frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.borderedProminent).tint(KualiaPalette.ink)
                .foregroundStyle(KualiaPalette.surface).disabled(
                    isPreparingPhoto || selectedCategory == nil)
                if imageData != nil {
                    Button(L10n.string("Remove this category's photos"), icon: .trash) {
                        if isDemo {
                            for size in [WidgetImageStorage.WidgetSize.small, .medium] {
                                demoPhotos.removeValue(
                                    forKey: "\(selectedCategoryID)-\(size.rawValue)")
                            }
                        } else {
                            WidgetImageStorage.deleteImage(forCategoryId: selectedCategoryID)
                            WidgetCenter.shared.reloadTimelines(ofKind: "CategoryCardWidget")
                        }
                        savedMessage = L10n.string("Photos removed for both widget sizes.")
                        refresh()
                    }.font(.subheadline).buttonStyle(.kualiaHaptic).disabled(
                        isPreparingPhoto)
                }
                if let photoError {
                    Text(photoError).font(.caption).foregroundStyle(KualiaPalette.budgetNegative)
                } else if let savedMessage {
                    Label(savedMessage, icon: .checkCircle)
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
                Text(
                    L10n.string(
                        "On your Home Screen, edit Category Balances and choose \(selectedCategory?.name ?? L10n.string("this category")) first. Its saved photo appears for that size."
                    )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
        .navigationTitle(L10n.string("Category backgrounds")).navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: selectInitialCategory)
        .onChange(of: categories) { _, _ in selectInitialCategory() }
        .onChange(of: selectedCategoryID) { _, _ in refresh() }
        .onChange(of: size) { _, _ in refresh() }
        .task(id: photo) { await importPhoto() }
    }

    private var categoryPreview: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                KualiaIconImage(icon: .envelopeOpen, size: 22)
                Spacer()
                Text("KUALIA").font(.caption2.weight(.bold)).tracking(1)
            }
            Spacer(minLength: 20)
            Text(selectedCategory?.name ?? L10n.string("Your category")).font(
                .subheadline.weight(.semibold))
            Text(AccountMoney.string(25000, workspace: nil)).font(.title.bold()).fontDesign(
                .rounded)
            Text(L10n.string("Available")).font(.caption)
        }
        .padding(22).frame(maxWidth: size == .small ? 190 : .infinity, minHeight: 190)
        .foregroundStyle(imageData == nil ? WidgetStudioStyle.paper.foreground : .white)
        .background {
            GeometryReader { geometry in
                Group {
                    if let imageData, let image = UIImage(data: imageData) {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else {
                        LinearGradient(
                            colors: WidgetStudioStyle.paper.colors, startPoint: .topLeading,
                            endPoint: .bottomTrailing)
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                .overlay(Color.black.opacity(imageData == nil ? 0 : 0.62))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            L10n.string(
                "Preview of \(selectedCategory?.name ?? L10n.string("category")) with a sample available balance"
            )
        )
    }

    private func selectInitialCategory() {
        if !categories.contains(where: { $0.id == selectedCategoryID }) {
            selectedCategoryID = categories.first?.id ?? ""
        }
        refresh()
    }

    private func refresh() {
        if isDemo {
            imageData = demoPhotos["\(selectedCategoryID)-\(size.rawValue)"]
            return
        }
        imageData =
            selectedCategoryID.isEmpty
            ? nil : WidgetImageStorage.loadImageData(forCategoryId: selectedCategoryID, size: size)
    }

    private func importPhoto() async {
        guard let photo, !selectedCategoryID.isEmpty else { return }
        let categoryID = selectedCategoryID
        let selectedSize = size
        let workspaceID = session.current?.workspace.id
        isPreparingPhoto = true
        photoError = nil
        defer {
            isPreparingPhoto = false
            if self.photo == photo { self.photo = nil }
        }
        do {
            guard let data = try await photo.loadTransferable(type: Data.self),
                let image = UIImage(data: data)
            else {
                photoError = L10n.string(
                    "That photo couldn't be opened. Try another from your library.")
                return
            }
            guard !Task.isCancelled, categoryID == selectedCategoryID,
                workspaceID == session.current?.workspace.id
            else { return }
            if isDemo {
                demoPhotos["\(categoryID)-\(selectedSize.rawValue)"] = data
                refresh()
                return
            }
            guard WidgetImageStorage.saveImage(image, forCategoryId: categoryID, size: selectedSize)
            else {
                photoError = L10n.string("Your photo couldn't be saved. Please try again.")
                return
            }
            WidgetImageStorage.saveMetadata(
                .init(photographer: nil, source: "library"), forCategoryId: categoryID)
            WidgetCenter.shared.reloadTimelines(ofKind: "CategoryCardWidget")
            let sizeTitle = selectedSize == .small ? L10n.string("Small") : L10n.string("Medium")
            savedMessage = L10n.string(
                "Photo saved for the \(sizeTitle) Category Balances widget.")
            refresh()
        } catch {
            guard !Task.isCancelled else { return }
            photoError =
                L10n.string(
                    "Your photo couldn't be loaded. Please try again. \(error.localizedDescription)"
                )
        }
    }
}

private struct SettingsWidgetSample: View {
    @Environment(\.isDemoWorkspace) private var isDemo
    let design: SettingsWidgetDesign
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var style: WidgetStudioStyle {
        isDemo ? .paper : WidgetStudioPreferences.style(for: design.kind)
    }
    private var hasPhoto: Bool {
        !isDemo && WidgetStudioPreferences.imageData(for: design.kind) != nil
    }
    private var foreground: Color { hasPhoto ? .white : style.foreground }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(design.title, icon: design.icon).font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text(L10n.string("PREVIEW")).font(.system(size: 9, weight: .bold)).tracking(1)
                    .padding(.horizontal, 7).padding(.vertical, 4)
                    .background(foreground.opacity(0.09), in: Capsule())
            }
            sampleContent
            Text(L10n.string("Sample data")).font(.caption2).foregroundStyle(
                foreground.opacity(0.66))
        }
        .padding(20).frame(
            maxWidth: .infinity, minHeight: dynamicTypeSize.isAccessibilitySize ? 0 : 180,
            alignment: .leading
        )
        .foregroundStyle(foreground)
        .background {
            WidgetStudioBackground(kind: design.kind)
        }
        .clipShape(RoundedRectangle(cornerRadius: 23))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.string("\(design.title) preview using sample data"))
    }

    @ViewBuilder private var sampleContent: some View {
        switch design {
        case .categories:
            VStack(spacing: 12) {
                sampleBalance(L10n.string("Groceries"), amount: 28750)
                sampleBalance(L10n.string("Dining Out"), amount: 8400)
                sampleBalance(L10n.string("Transport"), amount: -1800)
            }
        case .bills:
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    amount(3.formatted(.number.locale(L10n.locale)))
                    Text(L10n.string("days to go")).font(.caption)
                }
                Rectangle().fill(foreground.opacity(0.18)).frame(width: 1, height: 55)
                VStack(alignment: .leading, spacing: 6) {
                    Text(L10n.string("Internet")).font(.headline)
                    Text(AccountMoney.string(6500, workspace: nil)).font(.title2.bold()).fontDesign(
                        .rounded)
                    Text(L10n.string("Your next planned expense")).font(.caption2)
                }
            }
        case .map:
            VStack(spacing: 12) {
                sampleBalance(L10n.string("Checking"), amount: 245000)
                sampleBalance(L10n.string("Savings"), amount: 820000)
                sampleBalance(L10n.string("Credit card"), amount: -36500)
            }
        case .capture:
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    VStack(spacing: 6) {
                        KualiaIconImage(icon: .plus, size: 26)
                        Text(L10n.string("Kualia"))
                            .font(.system(.caption2, design: .rounded, weight: .semibold))
                    }
                    .frame(width: 76, height: 76)
                    .background(
                        foreground.opacity(0.09), in: RoundedRectangle(cornerRadius: 18))
                    Text(L10n.string("Add expense in Kualia")).font(.headline)
                }
                HStack(spacing: 8) {
                    sampleShortcut(L10n.string("Expense"), icon: .minus)
                    sampleShortcut(L10n.string("Income"), icon: .plus)
                    sampleShortcut(L10n.string("Transfer"), icon: .transfer)
                }
            }

        }
    }

    private func sampleBalance(_ title: String, amount: Int) -> some View {
        HStack(spacing: 12) {
            Text(title).font(.subheadline).lineLimit(1)
            Spacer(minLength: 0)
            Text(AccountMoney.string(Decimal(amount), workspace: nil))
                .font(.system(.headline, design: .rounded)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.65)
        }
    }

    private func amount(_ value: String) -> some View {
        Text(value).font(.system(.largeTitle, design: .rounded, weight: .bold))
            .minimumScaleFactor(0.7).lineLimit(1)
    }

    private func sampleShortcut(_ title: String, icon: KualiaIcon) -> some View {
        VStack(spacing: 6) {
            KualiaIconImage(icon: icon, size: 19)
            Text(title).font(.caption2.weight(.medium)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 9)
        .background(foreground.opacity(0.09), in: RoundedRectangle(cornerRadius: 12))
    }

}

private struct SettingsWidgetInstructionsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            SettingsCanvas {
                Text(L10n.string("A home for your widgets.")).font(.title.bold()).fontDesign(
                    .rounded)
                instructions(
                    L10n.string("Home Screen"), icon: .home,
                    steps: [
                        L10n.string("Touch and hold an empty area of your Home Screen."),
                        L10n.string("Tap Edit, then Add Widget. Search for Kualia."),
                        L10n.string(
                            "Choose a widget and swipe to pick a size, then tap Add Widget."),
                        L10n.string(
                            "For widgets with categories or accounts, touch and hold the widget and choose Edit Widget."
                        ),
                    ])
                instructions(
                    L10n.string("Lock Screen"), icon: .lock,
                    steps: [
                        L10n.string(
                            "Touch and hold your Lock Screen, tap Customize, then choose Lock Screen."
                        ),
                        L10n.string(
                            "Tap the widget area, choose Kualia, then choose a balance, Upcoming Bills, or Add Transaction."
                        ),
                        L10n.string(
                            "On the Lock Screen, tap the widget while customizing to choose one category or account."
                        ),
                    ])
                instructions(
                    L10n.string("Control Center"), icon: .bolt,
                    steps: [
                        L10n.string("Open Control Center and touch and hold an empty area."),
                        L10n.string(
                            "Tap Add a Control, search for Kualia, and choose Add Transaction."),
                    ])
                Text(
                    L10n.string(
                        "Custom backgrounds appear on Home Screen widgets. Lock Screen widgets and the Control Center control follow your system appearance."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
            .navigationTitle(L10n.string("Add a widget")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.string("Done")) { dismiss() }
                }
            }
        }
    }

    private func instructions(_ title: String, icon: KualiaIcon, steps: [String]) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(title, icon: icon).font(.headline)
            ForEach(steps.indices, id: \.self) { index in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)").font(.caption.weight(.bold))
                        .frame(width: 25, height: 25)
                        .background(KualiaPalette.ink.opacity(0.07), in: Circle())
                    Text(steps[index]).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
        }
        .padding(22).background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 26))
    }
}
