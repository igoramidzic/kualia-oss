import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct AssistantView: View {
    let store: AssistantStore
    let loadTransaction: (AssistantTransactionLink) async throws -> TransactionEditorStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawer = AssistantDrawerState()
    @State private var transactionLink: AssistantTransactionLink?

    var body: some View {
        GeometryReader { geometry in
            let width = min(340, geometry.size.width * 0.86)
            ZStack(alignment: .leading) {
                NavigationStack {
                    AssistantHistoryView(store: store, isActive: drawer.isPresented) {
                        setHistory(false)
                    }
                    .background(KualiaPalette.canvas.ignoresSafeArea(.container))
                    .navigationTitle(L10n.string("Your chats"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(L10n.string("New chat"), icon: .newChat) {
                                store.newChat()
                                setHistory(false)
                            }
                        }
                    }
                }
                .scrollDisabled(drawer.isDragging)
                .frame(width: width)
                .modifier(AssistantDrawerOffset(drawer: drawer, width: width, isHistory: true))
                .allowsHitTesting(drawer.isPresented)
                .accessibilityHidden(!drawer.isPresented)

                NavigationStack {
                    AssistantChatPage(
                        store: store, conversation: store.selected, isActive: !drawer.isPresented
                    )
                    .id(store.selected.id)
                    .background(AssistantBackground())
                    .kualiaNavigationTitle(
                        store.title(for: store.selected), subtitle: chatWorkspaceName
                    )
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { chatToolbar }
                }
                .scrollDisabled(drawer.blocksChatScrolling)
                .frame(width: geometry.size.width)
                .overlay {
                    AssistantDrawerScrim(drawer: drawer, width: width) { setHistory(false) }
                }
                .modifier(AssistantDrawerOffset(drawer: drawer, width: width, isHistory: false))
                .accessibilityHidden(drawer.isPresented)
            }
            // Scroll overflow may draw behind the bars, but must stay inside the
            // moving presentation during dismissal. Include both safe areas so
            // the background and glass are not cut off at the status/home bars.
            .clipShape(
                Rectangle()
                    .size(
                        width: geometry.size.width,
                        height: geometry.size.height + geometry.safeAreaInsets.top
                            + geometry.safeAreaInsets.bottom
                    )
                    .offset(y: -geometry.safeAreaInsets.top)
            )
            .modifier(
                AssistantDrawerGesture(
                    drawer: drawer, width: width, containerWidth: geometry.size.width))
        }
        .background(KualiaPalette.canvas.ignoresSafeArea(.container))
        .tint(KualiaPalette.ink)
        .environment(
            \.openURL,
            OpenURLAction { url in
                guard let link = AssistantTransactionLink(url: url) else { return .systemAction }
                transactionLink = link
                return .handled
            }
        )
        .sheet(item: $transactionLink) { link in
            AssistantTransactionSheet(link: link, loadEditor: loadTransaction)
        }
        .accessibilityAction(
            named: drawer.isPresented
                ? L10n.string("Hide chat history") : L10n.string("Show chat history")
        ) {
            setHistory(!drawer.isPresented)
        }
    }

    private var chatWorkspaceName: String {
        (store.selected.workspace ?? (store.selected.threadID == nil ? store.workspace : nil))?
            .workspaceName ?? ""
    }

    @ToolbarContentBuilder
    private var chatToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(L10n.string("Show chat history"), icon: .sidebar) {
                setHistory(true)
            }
        }
        if store.canStartNewChat {
            ToolbarItem(placement: .topBarTrailing) {
                Button(L10n.string("New chat"), icon: .newChat) {
                    store.newChat()
                }
            }
            if #available(iOS 26.0, *) {
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            KualiaCloseButton(placement: .toolbar, label: L10n.string("Close assistant")) {
                store.close()
            }
            .accessibilityIdentifier("assistant.close")
        }
    }

    private var drawerAnimation: Animation? {
        reduceMotion ? nil : .spring(duration: 0.3, bounce: 0)
    }

    private func setHistory(_ shown: Bool) {
        withAnimation(drawerAnimation) { drawer.setPresented(shown) }
    }
}

/// These small leaves are the only views that observe per-frame translation.
/// ViewModifier keeps its supplied content outside the motion's body evaluation.
private struct AssistantDrawerOffset: ViewModifier {
    let drawer: AssistantDrawerState
    let width: CGFloat
    let isHistory: Bool
    @Environment(\.layoutDirection) private var layoutDirection

    func body(content: Content) -> some View {
        content.offset(
            x: width * (drawer.progress(width: width) - (isHistory ? 1 : 0))
                * (layoutDirection == .rightToLeft ? -1 : 1))
    }
}

private struct AssistantDrawerScrim: View {
    let drawer: AssistantDrawerState
    let width: CGFloat
    let onDismiss: () -> Void

    var body: some View {
        // Stay mounted: inserting/removing this layer would add an independent fade.
        Color.black.opacity(
            AssistantDrawerState.dimmingOpacity(progress: drawer.progress(width: width))
        )
        .ignoresSafeArea(.container, edges: .vertical)
        .contentShape(Rectangle())
        .allowsHitTesting(drawer.isPresented)
        .accessibilityHidden(true)
        .onTapGesture(perform: onDismiss)
    }
}

private struct AssistantDrawerGesture: ViewModifier {
    let drawer: AssistantDrawerState
    let width: CGFloat
    let containerWidth: CGFloat
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var isActive = false

    private var animation: Animation? {
        reduceMotion ? nil : .spring(duration: 0.3, bounce: 0)
    }

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 12)
                .updating($isActive) { _, active, _ in active = true }
                .onChanged { value in
                    var transaction = Transaction()
                    transaction.disablesAnimations = true
                    withTransaction(transaction) {
                        drawer.dragChanged(
                            startX: value.startLocation.x,
                            translationX: value.translation.width,
                            translationY: value.translation.height,
                            containerWidth: containerWidth,
                            rightToLeft: layoutDirection == .rightToLeft)
                    }
                }
                .onEnded { value in
                    withAnimation(animation) {
                        drawer.endDrag(
                            predictedTranslation: value.predictedEndTranslation.width,
                            width: width, rightToLeft: layoutDirection == .rightToLeft)
                    }
                }
        )
        .onChange(of: isActive) { _, active in
            if !active {
                // Cancellation has no onEnded callback. This state is local to
                // the gesture modifier so its updates cannot invalidate the panes.
                withAnimation(animation) { drawer.cancelDrag() }
            }
        }
    }
}

private struct AssistantChatPage: View {
    let store: AssistantStore
    let conversation: AssistantConversation
    let isActive: Bool
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        AssistantTranscript(conversation: conversation)
            .overlay {
                if conversation.hasLoaded && conversation.rows.isEmpty
                    && conversation.pending == nil && !conversation.isWorking
                    && conversation.loadError == nil
                {
                    welcome
                }
            }
            .contentShape(.interaction, Rectangle())
            .simultaneousGesture(TapGesture().onEnded { isComposerFocused = false })
            .kualiaSafeAreaBar(edge: .bottom, spacing: 0) {
                AssistantComposer(
                    store: store, conversation: conversation, isFocused: $isComposerFocused
                )
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 10)
            }
            .onChange(of: isActive) { _, active in
                if !active { isComposerFocused = false }
            }
    }

    private var welcome: some View {
        ViewThatFits(in: .vertical) {
            VStack(alignment: .leading, spacing: 28) {
                greeting
                VStack(spacing: 10) {
                    suggestion(L10n.string("How am I doing this month?"), symbol: .reports)
                    suggestion(L10n.string("Help me plan my budget"), symbol: .inbox)
                    suggestion(L10n.string("Find ways I could save"), symbol: .sparkles)
                }
            }
            greeting
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 24)
        .frame(maxWidth: 540, maxHeight: .infinity, alignment: .center)
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 16) {
            KualiaIconImage(icon: .assistant, size: 30)
                .foregroundStyle(KualiaPalette.ink)
                .frame(width: 62, height: 62)
                .background(
                    KualiaPalette.assistantGlow.opacity(0.16),
                    in: RoundedRectangle(cornerRadius: 22)
                )
                .accessibilityHidden(true)
            Text(L10n.string("A little clarity,\nfor your money."))
                .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                .tracking(-0.8)
                .foregroundStyle(KualiaPalette.ink)
            Text(L10n.string("Ask a question, make a plan, or bring a receipt."))
                .font(.body)
                .foregroundStyle(KualiaPalette.mutedInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func suggestion(_ text: String, symbol: KualiaIcon) -> some View {
        Button {
            conversation.draft = text
        } label: {
            HStack(spacing: 12) {
                KualiaIconImage(icon: symbol, size: 18).frame(width: 22).accessibilityHidden(true)
                Text(text).font(.subheadline).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                KualiaIconImage(icon: .arrowUpLeft, size: 12).font(.caption).accessibilityHidden(
                    true)
            }
            .foregroundStyle(KualiaPalette.ink)
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(KualiaPalette.cardSurface, in: RoundedRectangle(cornerRadius: 20))
            .overlay(
                RoundedRectangle(cornerRadius: 20).strokeBorder(
                    KualiaPalette.cardBorder, lineWidth: 1))
        }.buttonStyle(.kualiaHaptic)
    }
}

private struct AssistantComposer: View {
    let store: AssistantStore
    @Bindable var conversation: AssistantConversation
    var isFocused: FocusState<Bool>.Binding
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var showsFiles = false
    @State private var showsPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickerError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if store.limitReached {
                Text(
                    L10n.string(
                        "You've reached this month's assistant limit. Your chats are still here.")
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
            if let pickerError {
                HStack {
                    Text(pickerError).font(.caption)
                    Spacer(minLength: 0)
                    Button(L10n.string("Dismiss")) { self.pickerError = nil }.font(
                        .caption.weight(.semibold))
                }.foregroundStyle(KualiaPalette.budgetNegative)
            }
            if !conversation.attachments.isEmpty { attachments }
            TextField(
                L10n.string("Ask anything about your money"), text: $conversation.draft,
                axis: .vertical
            )
            .font(.body)
            .lineLimit(1...6)
            .focused(isFocused)
            .padding(.horizontal, 4)
            .padding(.top, 5)
            .accessibilityLabel(L10n.string("Message Kualia"))
            .accessibilityIdentifier("assistant.input")
            HStack(alignment: .bottom, spacing: 12) {
                Menu {
                    Button(L10n.string("Photo library"), icon: .photo) { showsPhotos = true }
                    Button(L10n.string("Choose file"), icon: .file) { showsFiles = true }
                } label: {
                    KualiaIconImage(icon: .plus, size: 17).font(.system(size: 17, weight: .medium))
                        .frame(width: 36, height: 36)
                        .background(KualiaPalette.ink.opacity(0.05), in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(.interaction, Rectangle())
                }
                .disabled(conversation.attachments.count >= 4)
                .accessibilityLabel(L10n.string("Add files or photos"))
                .accessibilityHint(L10n.string("Up to four attachments"))
                Spacer(minLength: 0)
                if conversation.isWorking {
                    Button {
                        conversation.stop()
                    } label: {
                        KualiaIconImage(icon: .stop, size: 12).font(
                            .system(size: 12, weight: .semibold)
                        )
                        .frame(width: 36, height: 36)
                        .background(KualiaPalette.ink, in: Circle())
                        .foregroundStyle(KualiaPalette.canvas)
                        .frame(width: 44, height: 44)
                        .contentShape(.interaction, Rectangle())
                    }
                    .disabled(!conversation.canStop)
                    .opacity(conversation.canStop ? 1 : 0.5)
                    .accessibilityLabel(
                        conversation.isStopping
                            ? L10n.string("Stopping response") : L10n.string("Stop response"))
                } else {
                    Button {
                        conversation.send(
                            workspace: store.workspace, limitReached: store.limitReached)
                    } label: {
                        KualiaIconImage(icon: .arrowUp, size: 16).font(
                            .system(size: 16, weight: .semibold)
                        )
                        .frame(width: 36, height: 36)
                        .background(KualiaPalette.ink, in: Circle())
                        .foregroundStyle(KualiaPalette.canvas)
                        .frame(width: 44, height: 44)
                        .contentShape(.interaction, Rectangle())
                    }
                    .disabled(!conversation.canSend || store.limitReached)
                    .opacity(conversation.canSend && !store.limitReached ? 1 : 0.3)
                    .accessibilityLabel(L10n.string("Send message"))
                    .accessibilityIdentifier("assistant.send")
                }
            }
            .buttonStyle(.kualiaHaptic)
        }
        .padding(14)
        .foregroundStyle(KualiaPalette.ink)
        .background {
            if reduceTransparency {
                RoundedRectangle(cornerRadius: 28).fill(KualiaPalette.surface)
            }
        }
        .kualiaControlGlass(in: RoundedRectangle(cornerRadius: 28))
        .fileImporter(
            isPresented: $showsFiles,
            allowedContentTypes: [.pdf, .plainText, .commaSeparatedText, .json, .image],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls):
                let slots = max(0, 4 - conversation.attachments.count)
                if urls.count > slots {
                    pickerError = L10n.string("You can attach up to four files per message.")
                }
                for url in urls.prefix(slots) {
                    conversation.addAttachment(filename: url.lastPathComponent) {
                        try await AssistantFileLoader.shared.prepare(url: url)
                    }
                }
            case .failure:
                pickerError = L10n.string("Couldn't open the selected files. Please try again.")
            }
        }
        .photosPicker(
            isPresented: $showsPhotos, selection: $photos,
            maxSelectionCount: max(1, 4 - conversation.attachments.count), matching: .images
        )
        .onChange(of: photos) { _, selected in
            for (index, photo) in selected.enumerated() {
                conversation.addAttachment(filename: L10n.string("Photo \(index + 1)")) {
                    guard
                        let file = try await photo.loadTransferable(type: AssistantPickedPhoto.self)
                    else {
                        throw AssistantFileError.unreadable
                    }
                    return try await AssistantFileLoader.shared.prepare(
                        url: file.url, temporarySource: true)
                }
            }
            photos = []
        }
    }

    private var attachments: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(conversation.attachments) { attachment in
                    HStack(spacing: 8) {
                        switch attachment.status {
                        case .uploading: ProgressView().controlSize(.small)
                        case .ready(let file):
                            KualiaIconImage(
                                icon: file.mediaType.hasPrefix("image/") ? .photo : .file, size: 18)
                        case .failed:
                            KualiaIconImage(icon: .warning, size: 18).foregroundStyle(
                                KualiaPalette.budgetNegative)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(attachment.filename).lineLimit(1)
                            if case .failed(let message) = attachment.status {
                                Text(message).font(.caption2).foregroundStyle(
                                    KualiaPalette.budgetNegative
                                ).lineLimit(2)
                            }
                        }.frame(maxWidth: 200, alignment: .leading)
                        Button {
                            conversation.removeAttachment(attachment.id)
                        } label: {
                            KualiaIconImage(icon: .close, size: 12).font(.caption.weight(.semibold))
                                .frame(
                                    width: 44, height: 44)
                        }.accessibilityLabel(L10n.string("Remove \(attachment.filename)"))
                    }
                    .font(.caption)
                    .padding(.leading, 12)
                    .background(
                        KualiaPalette.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
                }
            }
        }.scrollIndicators(.hidden)
    }
}

private struct AssistantHistoryView: View {
    let store: AssistantStore
    let isActive: Bool
    let onSelect: () -> Void
    @State private var search = ""
    @FocusState private var isSearchFocused: Bool

    private var threads: [AssistantThread] {
        store.visibleThreads.filter {
            search.isEmpty || $0.displayTitle.localizedStandardContains(search)
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if let error = store.historyError {
                    Text(error).font(.subheadline)
                    Button(L10n.string("Try again")) { store.reconnect() }
                } else if !store.hasLoadedHistory {
                    ProgressView(L10n.string("Loading chats")).padding(.vertical, 20)
                } else if threads.isEmpty {
                    Text(
                        search.isEmpty
                            ? L10n.string("Your conversations will appear here.")
                            : L10n.string("No matching chats.")
                    )
                    .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk).padding(
                        .vertical, 20)
                }
                ForEach(threads) { thread in
                    Button {
                        store.open(thread)
                        onSelect()
                    } label: {
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(thread.displayTitle).font(.subheadline.weight(.medium))
                                    .lineLimit(2)
                                Text(thread.date, style: .date).font(.caption).foregroundStyle(
                                    KualiaPalette.mutedInk)
                            }
                            Spacer(minLength: 0)
                            if let running = store.conversations.first(where: {
                                $0.threadID == thread.id && $0.isWorking
                            }) {
                                AssistantActivitySymbol().accessibilityLabel(running.activity)
                            } else if thread.unread {
                                Circle().fill(KualiaPalette.accent).frame(width: 7, height: 7)
                                    .accessibilityLabel(L10n.string("Unread response"))
                            }
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            store.selected.threadID == thread.id
                                ? KualiaPalette.surface : .clear,
                            in: RoundedRectangle(cornerRadius: 18)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityAddTraits(
                        store.selected.threadID == thread.id ? .isSelected : [])
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
        }
        .scrollDismissesKeyboard(.interactively)
        .kualiaSafeAreaBar(edge: .top, spacing: 0) {
            HStack(spacing: 8) {
                KualiaIconImage(icon: .search, size: 18).accessibilityHidden(true)
                TextField(L10n.string("Search chats"), text: $search)
                    .textInputAutocapitalization(.never)
                    .focused($isSearchFocused)
            }
            .font(.subheadline)
            .padding(14)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 18))

            .padding(.horizontal, 18)
            .padding(.top, 10)
            .padding(.bottom, 8)
        }
        .foregroundStyle(KualiaPalette.ink)
        .onChange(of: isActive) { _, active in
            if !active { isSearchFocused = false }
        }
    }
}

struct AssistantActivitySymbol: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        KualiaIconImage(icon: .sparkles, size: 20)
            .font(.system(size: 20, weight: .medium))
            .phaseAnimator(!reduceMotion && scenePhase == .active ? [false, true] : [false]) {
                icon, breathes in
                icon.scaleEffect(breathes ? 1.1 : 1).opacity(breathes ? 0.65 : 1)
            } animation: { _ in
                .easeInOut(duration: 1.2)
            }
            .foregroundStyle(KualiaPalette.ink)
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
    }
}

private struct AssistantBackground: View {
    var body: some View {
        KualiaPalette.canvas.overlay(alignment: .top) {
            RadialGradient(
                colors: [KualiaPalette.assistantGlow.opacity(0.15), .clear],
                center: .topLeading, startRadius: 0, endRadius: 440)
        }
        .ignoresSafeArea(.container, edges: .vertical)
        .allowsHitTesting(false)
    }
}

private struct AssistantTransactionSheet: View {
    let link: AssistantTransactionLink
    let loadEditor: (AssistantTransactionLink) async throws -> TransactionEditorStore
    @Environment(\.dismiss) private var dismiss
    @State private var editor: TransactionEditorStore?
    @State private var error: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let editor {
                TransactionEditorView(store: editor)
            } else {
                NavigationStack {
                    Group {
                        if let error {
                            ContentUnavailableView {
                                Label(
                                    L10n.string("Couldn’t open transaction"),
                                    icon: .warning)
                            } description: {
                                Text(error)
                            } actions: {
                                Button(L10n.string("Try again")) { attempt += 1 }
                            }
                        } else {
                            ProgressView(L10n.string("Opening transaction"))
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(KualiaPalette.canvas)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            KualiaCloseButton(placement: .toolbar) { dismiss() }
                        }
                    }
                }
            }
        }
        .task(id: attempt) {
            error = nil
            do {
                let loaded = try await loadEditor(link)
                try Task.checkCancellation()
                editor = loaded
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
        }
    }
}
