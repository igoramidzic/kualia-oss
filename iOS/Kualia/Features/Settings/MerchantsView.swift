import SwiftUI

struct MerchantsView: View {
    @State var store: MerchantsStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var viewer = UUID()
    @State private var search = ""
    @State private var order = MerchantOrder.count
    @State private var visibleMerchants: [SettingsMerchant] = []
    @State private var selection = MerchantSelection()
    @State private var peek = PeekPresentation()
    @State private var peekHeight: CGFloat = 100
    @State private var mergeRequest: MerchantMergeRequest?
    @State private var detail: SettingsMerchant?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selected: [SettingsMerchant] { selection.merchants(in: store.merchants) }
    private var requiresMerge: Bool { selected.contains { $0.requiresMerge } }
    private var motion: Animation? { reduceMotion ? nil : .smooth(duration: 0.3) }

    private func refreshVisibleMerchants() {
        visibleMerchants = order.merchants(store.merchants, matching: search)
    }

    var body: some View {
        GeometryReader { geometry in
            PeekContainer(
                presentation: peek, expansionHeight: peekHeight,
                bottomCornerRadius: 0, foregroundBottomCornerRadius: 34
            ) {
                page
                    .safeAreaPadding(.top, geometry.safeAreaInsets.top)
                    .safeAreaPadding(.bottom, peek.isPresented ? 0 : geometry.safeAreaInsets.bottom)
            } expansion: {
                selectionPeek(bottomInset: geometry.safeAreaInsets.bottom)
            }
            .ignoresSafeArea(.container, edges: .vertical)
        }
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .navigationTitle(L10n.string("Merchants"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(selection.isSelecting ? L10n.string("Done") : L10n.string("Select")) {
                    if selection.isSelecting { selection.end() } else { selection.begin() }
                }
                .disabled(
                    !store.hasLoaded || (!selection.isSelecting && store.merchants.isEmpty)
                        || store.isSaving
                )
                .accessibilityIdentifier("merchants-select")
            }
        }
        .navigationDestination(item: $detail) { merchant in
            MerchantDetailView(store: store, merchant: merchant)
        }
        .navigationDestination(item: $mergeRequest) { request in
            MerchantMergePicker(store: store, request: request) {
                mergeRequest = nil
                selection.end()
            }
        }
        .onChange(of: selection.isSelecting) { _, selecting in
            if selecting {
                store.actionError = nil
                peek.prepare()
            } else if let sessionID = peek.sessionID {
                withAnimation(motion) {
                    peek.beginClosing()
                } completion: {
                    peek.finishClosing(sessionID: sessionID)
                }
            }
        }
        .onChange(of: store.merchants, initial: true) { _, merchants in
            selection.reconcile(merchants)
            refreshVisibleMerchants()
        }
        .onChange(of: search) { _, _ in refreshVisibleMerchants() }
        .onChange(of: order) { _, _ in refreshVisibleMerchants() }
        .onChange(of: L10n.locale.identifier) { _, _ in refreshVisibleMerchants() }
        .onAppear { store.appear(viewer) }
        .onDisappear { store.disappear(viewer) }
        .accessibilityIdentifier("workspace-merchants-page")
    }

    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                if store.hasLoaded {
                    if !store.merchants.isEmpty {
                        controls
                        merchantList
                    } else {
                        ContentUnavailableView(
                            L10n.string("Your merchants will appear here"), icon: .shop,
                            description: Text(
                                L10n.string(
                                    "Add a merchant to a transaction to start building your list."))
                        )
                    }
                } else if store.loadError == nil {
                    ProgressView(L10n.string("Loading merchants…"))
                        .frame(maxWidth: .infinity, minHeight: 200)
                }
                if let error = store.actionError {
                    TransactionEditorNotice(message: error, isError: true)
                }
                if let error = store.loadError {
                    SettingsRetry(message: error, retry: store.reload)
                }
            }
            .frame(maxWidth: 600).padding(.horizontal, 22).padding(.vertical, 20)
            .frame(maxWidth: .infinity)
        }
        .background(KualiaPalette.canvas.ignoresSafeArea())
        .foregroundStyle(KualiaPalette.ink)
        .tint(KualiaPalette.ink)
        .scrollDismissesKeyboard(.interactively)
        .kualiaScrollEdges(for: .top)

    }

    private func selectionPeek(bottomInset: CGFloat) -> some View {
        HStack(spacing: 16) {
            Text(L10n.string("\(selected.count) selected"))
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("merchant-selection-count")
            Button {
                if requiresMerge {
                    mergeRequest = MerchantMergeRequest(merchants: selected)
                } else {
                    let ids = selected.map(\.id)
                    Task { _ = await store.remove(ids) }
                }
            } label: {
                Text(requiresMerge ? L10n.string("Merge") : L10n.string("Delete"))
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .opacity(store.isSaving ? 0 : 1)
                    .overlay { if store.isSaving { ProgressView().tint(KualiaPalette.peekInk) } }
                    .padding(.horizontal, 20).frame(minHeight: 48)
                    .background(KualiaPalette.peekControlSurface, in: Capsule())
            }
            .disabled(selected.isEmpty || store.isSaving)
            .accessibilityIdentifier("merchant-selection-action")
            Button {
                selection.end()
            } label: {
                KualiaIconImage(icon: .close, size: 18)
                    .frame(width: 48, height: 48)
                    .background(KualiaPalette.peekControlSurface, in: Circle())
            }
            .disabled(store.isSaving)
            .accessibilityLabel(L10n.string("Exit selection mode"))
        }
        .buttonStyle(.kualiaHaptic)
        .foregroundStyle(KualiaPalette.peekInk)
        .padding(.horizontal, 24).padding(.vertical, 16)
        .frame(minHeight: 100)
        .padding(.bottom, bottomInset)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: { height in
            guard let sessionID = peek.sessionID, peek.acceptsMeasurement(sessionID: sessionID)
            else { return }
            withAnimation(motion) {
                peekHeight = height
                peek.reveal(sessionID: sessionID)
            }
        }
        .frame(maxHeight: .infinity, alignment: .bottom)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                KualiaIconImage(icon: .search, size: 18)
                    .foregroundStyle(KualiaPalette.mutedInk)
                TextField(L10n.string("Find a merchant"), text: $search)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("merchants-search")
                if !search.isEmpty {
                    Button(L10n.string("Clear search"), icon: .closeCircle) { search = "" }
                        .labelStyle(.iconOnly).buttonStyle(.kualiaHaptic)
                }
            }
            .padding(16).background(KualiaPalette.surface, in: Capsule())
            // Native iOS sliding selection provides drag tracking, VoiceOver, and Reduce Motion.
            Picker(L10n.string("Order merchants by"), selection: $order) {
                ForEach(MerchantOrder.allCases, id: \.self) { option in
                    Text(option.title).tag(option)
                }
            }
            .pickerStyle(.segmented).controlSize(.large)
            .accessibilityIdentifier("merchants-order")
            HStack {
                Text(L10n.string("\(visibleMerchants.count) merchants"))
                Spacer()
                Text(L10n.string("Highest first"))
            }
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        }
    }

    @ViewBuilder
    private var merchantList: some View {
        let merchants = visibleMerchants
        if merchants.isEmpty {
            ContentUnavailableView(
                L10n.string("No matching merchants"), icon: .search,
                description: Text(L10n.string("Try a different name.")))
        } else {
            LazyVStack(spacing: 0) {
                ForEach(merchants) { merchant in
                    Button {
                        if selection.isSelecting {
                            selection.toggle(merchant.id)
                        } else {
                            detail = merchant
                        }
                    } label: {
                        merchantRow(merchant)
                    }
                    .buttonStyle(.kualiaHaptic)
                    .disabled(store.isSaving)
                    .highPriorityGesture(
                        LongPressGesture(minimumDuration: 0.45).onEnded { _ in
                            guard !store.isSaving else { return }
                            selection.toggle(merchant.id)
                        }, including: selection.isSelecting ? .none : .all
                    )
                    .accessibilityActions {
                        if !selection.isSelecting {
                            Button(L10n.string("Select merchant")) { selection.toggle(merchant.id) }
                        }
                    }
                    .accessibilityAddTraits(selection.ids.contains(merchant.id) ? .isSelected : [])
                    .sensoryFeedback(.selection, trigger: selection.ids.contains(merchant.id))
                    if merchant.id != merchants.last?.id {
                        Divider().overlay(KualiaPalette.border.opacity(0.2))
                            .padding(.leading, 80).padding(.trailing, 18)
                    }
                }
            }
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
            .animation(nil, value: order)
            Text(L10n.string("All-time amounts are net of refunds for each merchant."))
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                .padding(.horizontal, 4)
        }
    }

    private func merchantRow(_ merchant: SettingsMerchant) -> some View {
        HStack(spacing: 14) {
            if selection.isSelecting {
                KualiaIconImage(
                    icon: selection.ids.contains(merchant.id) ? .checkCircle : .circleOutline,
                    size: 22)
            }
            EntityLogoMark(url: merchant.logoUrl)
            VStack(alignment: .leading, spacing: 6) {
                Text(merchant.name).font(.body.weight(.semibold))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .multilineTextAlignment(.leading)
                if dynamicTypeSize.isAccessibilitySize {
                    Text(store.amount(merchant.amount)).font(.subheadline.weight(.semibold))
                }
                Text(L10n.string("\(merchant.transactionCount.formatted()) transactions"))
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !dynamicTypeSize.isAccessibilitySize {
                Text(store.amount(merchant.amount))
                    .font(.subheadline.bold()).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .layoutPriority(1)
            }
            if !selection.isSelecting {
                KualiaIconImage(icon: .chevronRight, size: 13)
                    .foregroundStyle(KualiaPalette.mutedInk)
            }
        }
        .padding(18).frame(minHeight: 88).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(
            selection.isSelecting
                ? L10n.string("Toggle merchant selection")
                : L10n.string("Open merchant details"))
    }
}

struct MerchantDetailView: View {
    let store: MerchantsStore
    let merchant: SettingsMerchant
    @Environment(\.dismiss) private var dismiss
    @State private var viewer = UUID()
    @State private var draft: MerchantDraft
    @State private var showsLogoPicker = false
    @State private var showsDiscard = false
    @State private var mergeRequest: MerchantMergeRequest?
    @FocusState private var editsName: Bool

    init(store: MerchantsStore, merchant: SettingsMerchant) {
        self.store = store
        self.merchant = merchant
        _draft = State(initialValue: MerchantDraft(name: merchant.name))
    }

    private var current: SettingsMerchant { store.merchant(id: merchant.id) ?? merchant }
    private var isDirty: Bool { draft.isDirty(comparedTo: merchant) }
    private var isUnavailable: Bool { store.hasLoaded && store.merchant(id: merchant.id) == nil }
    private var previewURL: String? {
        draft.logo.previewURL(current: current.logoUrl, defaultURL: current.globalMerchantLogoUrl)
    }

    var body: some View {
        SettingsCanvas {
            if isUnavailable {
                ContentUnavailableView(
                    L10n.string("Merchant unavailable"), icon: .shop,
                    description: Text(L10n.string("This merchant may have been removed or merged."))
                )
            } else {
                identity
                SettingsGroup(title: L10n.string("Merchant details")) {
                    SettingsTextInput(
                        L10n.string("Name"), placeholder: L10n.string("Merchant name"),
                        text: $draft.name
                    )
                    .focused($editsName).submitLabel(.done).onSubmit { editsName = false }
                    .padding(18).accessibilityIdentifier("merchant-name")
                }
                .disabled(store.isSaving)
                VStack(alignment: .leading, spacing: 16) {
                    Text(L10n.string("All-time activity"))
                        .font(.headline).fontDesign(.rounded)
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 20) { metrics }
                        VStack(alignment: .leading, spacing: 20) { metrics }
                    }
                    .padding(22)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
                    Text(L10n.string("The total amount includes refunds."))
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
                managementAction
                if let error = store.actionError {
                    TransactionEditorNotice(message: error, isError: true)
                }
                if let error = store.loadError {
                    SettingsRetry(message: error, retry: store.reload)
                }
            }
        }
        .navigationDestination(item: $mergeRequest) { request in
            MerchantMergePicker(store: store, request: request) {
                mergeRequest = nil
                dismiss()
            }
        }
        .navigationTitle(L10n.string("Merchant"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(isDirty || store.isSaving)
        .toolbar {
            if isDirty || store.isSaving {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L10n.string("Back"), icon: .chevronLeft) { showsDiscard = true }
                        .labelStyle(.iconOnly).disabled(store.isSaving)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editsName = false
                    Task { if await store.save(draft, original: merchant) { dismiss() } }
                } label: {
                    if store.isSaving { ProgressView() } else { Text(L10n.string("Save")).bold() }
                }
                .disabled(!isDirty || draft.trimmedName.isEmpty || store.isSaving || isUnavailable)
                .accessibilityIdentifier("merchant-save")
            }
        }
        .background {
            AccountEditorBackGestureGuard(
                isDirty: isDirty, isSaving: store.isSaving, onAttempt: { showsDiscard = true })
            TransactionEditorDismissalObserver(
                isDirty: isDirty, isSaving: store.isSaving, onAttempt: { showsDiscard = true })
        }
        .interactiveDismissDisabled(isDirty || store.isSaving)
        .alert(L10n.string("Discard your changes?"), isPresented: $showsDiscard) {
            Button(L10n.string("Discard changes"), role: .destructive) { dismiss() }
            Button(L10n.string("Keep editing"), role: .cancel) {}
        }
        .sheet(isPresented: $showsLogoPicker) {
            if let client = store.logoClient(for: merchant.id) {
                EntityLogoPicker(
                    name: draft.name, currentURL: previewURL,
                    defaultURL: current.globalMerchantLogoUrl,
                    state: draft.logo.state(original: current.logoState), fallback: .shop,
                    client: client
                ) { store.acceptSavedLogo($0, merchantID: merchant.id) }
            }
        }
        .onAppear {
            store.actionError = nil
            store.appear(viewer)
        }
        .onDisappear { store.disappear(viewer) }
        .onChange(of: draft) { _, _ in store.actionError = nil }
    }

    private var managementAction: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                current.requiresMerge
                    ? L10n.string(
                        "Move this merchant’s transactions to another merchant, then remove this merchant."
                    )
                    : L10n.string("This merchant has no transactions and can be deleted.")
            )
            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            Button {
                editsName = false
                if current.requiresMerge {
                    mergeRequest = MerchantMergeRequest(merchants: [current])
                } else {
                    Task { if await store.remove([merchant.id]) { dismiss() } }
                }
            } label: {
                Label(
                    current.requiresMerge
                        ? L10n.string("Merge merchant") : L10n.string("Delete merchant"),
                    icon: current.requiresMerge ? .arrowTurnRight : .trash
                )
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))
            }
            .foregroundStyle(
                current.requiresMerge ? KualiaPalette.ink : KualiaPalette.budgetNegative
            )
            .buttonStyle(.kualiaHaptic)
            .disabled(store.isSaving || isDirty || isUnavailable)
            .accessibilityIdentifier("merchant-detail-management")
            if isDirty {
                Text(L10n.string("Save your changes before merging or deleting this merchant."))
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    private var identity: some View {
        VStack(spacing: 14) {
            Button {
                editsName = false
                showsLogoPicker = true
            } label: {
                VStack(spacing: 14) {
                    EntityLogoMark(url: previewURL, size: 88)
                        .overlay(alignment: .bottomTrailing) {
                            KualiaIconImage(icon: .pencil, size: 15)
                                .padding(9).background(KualiaPalette.surface, in: Circle())
                        }
                    Text(L10n.string("Change logo")).font(.subheadline.weight(.semibold))
                }
            }
            .buttonStyle(.kualiaHaptic).disabled(store.isSaving)
            .accessibilityIdentifier("merchant-change-logo")
            Text(draft.trimmedName.isEmpty ? merchant.name : draft.trimmedName)
                .font(.title.bold()).fontDesign(.rounded).multilineTextAlignment(.center)
            Text(L10n.string("A familiar face for every transaction."))
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 18)
    }

    @ViewBuilder
    private var metrics: some View {
        MerchantMetric(
            title: L10n.string("Transactions"), value: current.transactionCount.formatted())
        MerchantMetric(title: L10n.string("Total amount"), value: store.amount(current.amount))
    }
}

private struct MerchantMetric: View {
    let title: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value).font(.title3.bold()).fontDesign(.rounded).monospacedDigit()
                .fixedSize(horizontal: true, vertical: false)
            Text(title).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct MerchantMergePicker: View {
    let store: MerchantsStore
    let request: MerchantMergeRequest
    let onComplete: () -> Void
    @State private var target: SettingsMerchant?
    @State private var viewer = UUID()
    @State private var choices: [TransactionEditorChoice] = []
    @State private var hasPreparedChoices = false

    private func prepareChoices() {
        choices = TransactionEditorMerchant.pickerChoices(
            store.merchants.filter(request.allowsTarget).map {
                TransactionEditorMerchant(id: $0.id, name: $0.name, logoUrl: $0.logoUrl)
            })
        hasPreparedChoices = true
    }

    var body: some View {
        Group {
            if choices.isEmpty, store.hasLoaded, hasPreparedChoices {
                ContentUnavailableView(
                    L10n.string("No other merchants"), icon: .shop,
                    description: Text(
                        L10n.string("Add another merchant to a transaction before merging.")))
            } else {
                TransactionEditorPicker(
                    title: L10n.string("Merge into"), choices: choices, selectedID: nil,
                    isEmbedded: true, isLoading: !store.hasLoaded || !hasPreparedChoices,
                    dismissesOnSelection: false, errorMessage: store.loadError,
                    onRetry: store.reload, focusesSearchOnAppear: true,
                    onSelect: { target = store.merchant(id: $0) })
            }
        }
        .navigationTitle(L10n.string("Merge into"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $target) { target in
            MerchantMergeReview(
                store: store, request: request, target: target, onComplete: onComplete)
        }
        .onAppear { store.appear(viewer) }
        .onDisappear { store.disappear(viewer) }
        .onChange(of: store.merchants, initial: true) { _, _ in prepareChoices() }
        .onChange(of: L10n.locale.identifier) { _, _ in prepareChoices() }
        .accessibilityIdentifier("merchant-merge-picker")
    }
}

private struct MerchantMergeReview: View {
    let store: MerchantsStore
    let request: MerchantMergeRequest
    let target: SettingsMerchant
    let onComplete: () -> Void
    @State private var viewer = UUID()
    @State private var isComplete = false

    private var sources: [SettingsMerchant] { request.sources(targetID: target.id) }
    private var completedCount: Int {
        sources.filter { store.completedRemovalIDs.contains($0.id) }.count
    }
    private var destination: SettingsMerchant { store.merchant(id: target.id) ?? target }
    private var targetAvailable: Bool { store.merchant(id: target.id) != nil }

    var body: some View {
        SettingsCanvas {
            VStack(alignment: .leading, spacing: 12) {
                Text(isComplete ? L10n.string("Merchants merged") : L10n.string("Review merge"))
                    .font(.title.bold()).fontDesign(.rounded)
                Text(
                    isComplete
                        ? L10n.string(
                            "All transactions and planned transactions now use \(destination.name)."
                        )
                        : L10n.string(
                            "All transactions and planned transactions from these merchants will move to \(destination.name). The original merchants will be removed."
                        )
                )
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            }
            SettingsGroup(title: L10n.string("From")) {
                ForEach(sources) { source in
                    merchantRow(
                        store.merchant(id: source.id) ?? source,
                        isDone: store.completedRemovalIDs.contains(source.id))
                }
            }
            KualiaIconImage(icon: .arrowDownRight, size: 24)
                .foregroundStyle(KualiaPalette.mutedInk).frame(maxWidth: .infinity)
            SettingsGroup(title: L10n.string("To")) {
                merchantRow(destination, isDone: isComplete)
            }
            if store.isSaving || completedCount > 0 {
                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: Double(completedCount), total: Double(sources.count))
                    Text(L10n.string("\(completedCount) of \(sources.count) merchants merged"))
                        .font(.subheadline).monospacedDigit()
                }
                .accessibilityIdentifier("merchant-merge-progress")
            }
            if !targetAvailable, !isComplete {
                TransactionEditorNotice(
                    message: L10n.string(
                        "This destination is no longer available. Go back and choose another merchant."
                    ),
                    isError: true)
            }
            if let error = store.actionError {
                TransactionEditorNotice(message: error, isError: true)
            }
            Button {
                if isComplete {
                    onComplete()
                } else {
                    Task {
                        isComplete = await store.remove(sources.map(\.id), mergingInto: target.id)
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    if store.isSaving { ProgressView() }
                    Text(
                        isComplete
                            ? L10n.string("Done")
                            : store.isSaving
                                ? L10n.string("Merging…")
                                : completedCount > 0
                                    ? L10n.string("Retry merge") : L10n.string("Merge")
                    )
                    .font(.body.weight(.semibold))
                }
                .frame(maxWidth: .infinity, minHeight: 54)
                .background(KualiaPalette.surface, in: Capsule())
            }
            .buttonStyle(.kualiaHaptic)
            .disabled(store.isSaving || (!isComplete && !targetAvailable))
            .accessibilityIdentifier("merchant-merge-confirm")
        }
        .navigationTitle(L10n.string("Merge merchants"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(store.isSaving || isComplete)
        .interactiveDismissDisabled(store.isSaving)
        .background {
            AccountEditorBackGestureGuard(isDirty: false, isSaving: store.isSaving, onAttempt: {})
        }
        .onAppear {
            store.actionError = nil
            store.appear(viewer)
        }
        .onDisappear { store.disappear(viewer) }
    }

    private func merchantRow(_ merchant: SettingsMerchant, isDone: Bool) -> some View {
        HStack(spacing: 14) {
            EntityLogoMark(url: merchant.logoUrl)
            VStack(alignment: .leading, spacing: 4) {
                Text(merchant.name).font(.body.weight(.semibold))
                Text(L10n.string("\(merchant.transactionCount.formatted()) transactions"))
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                if merchant.activeRecurringTransactionCount > 0 {
                    Text(
                        L10n.string(
                            "\(merchant.activeRecurringTransactionCount) planned transactions")
                    )
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if isDone {
                KualiaIconImage(icon: .checkCircle, size: 22)
                    .foregroundStyle(KualiaPalette.budgetPositive)
                    .accessibilityLabel(L10n.string("Merged"))
            }
        }
        .padding(18).accessibilityElement(children: .combine)
    }
}
