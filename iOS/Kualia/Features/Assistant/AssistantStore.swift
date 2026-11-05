import Combine
import Foundation
import Observation

@MainActor
struct AssistantClient {
    var threads: (String?) -> AnyPublisher<AssistantThreadList, Error>
    var messages: (String, String?) -> AnyPublisher<AssistantMessagePage, Error>
    var streams: (String) -> AnyPublisher<[AssistantStream], Error>
    var usage: () -> AnyPublisher<AssistantUsage, Error>
    var createThread: (String?) async throws -> String
    var send: (AssistantSendRequest) async throws -> Void
    var stop: (String) async throws -> Void
    var markRead: (String) async throws -> Void
    var upload: (AssistantLocalFile) async throws -> AssistantAttachment
}

/// Owned by the authenticated app root, so dismissal never cancels a response or upload.
@MainActor
@Observable
final class AssistantStore {
    private(set) var selected: AssistantConversation
    private(set) var conversations: [AssistantConversation]
    private(set) var threads = AssistantThreadList()
    private(set) var hasLoadedHistory = false
    private(set) var historyError: String?
    private(set) var limitReached = false
    private(set) var isPresented = false
    var workspace: AssistantWorkspace? {
        didSet {
            guard oldValue?.workspaceId != workspace?.workspaceId else { return }
            threads = .init()
            hasLoadedHistory = false
            historyError = nil
            if let previous = conversations.last(where: {
                $0.workspace?.workspaceId == workspace?.workspaceId
            }) {
                select(previous)
            } else {
                newChat()
            }
            if started { watchHistory() }
        }
    }

    @ObservationIgnored private let client: AssistantClient
    @ObservationIgnored private var subscriptions: Set<AnyCancellable> = []
    @ObservationIgnored private var userID: String?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var historyGeneration = UUID()

    init(client: AssistantClient) {
        self.client = client
        let conversation = AssistantConversation(client: client)
        selected = conversation
        conversations = [conversation]
    }

    var workingConversation: AssistantConversation? {
        if selected.isWorking && selected.workspace?.workspaceId == workspace?.workspaceId {
            return selected
        }
        return conversations.first {
            $0.isWorking && $0.workspace?.workspaceId == workspace?.workspaceId
        }
    }

    var launcherText: String {
        if let workingConversation { return workingConversation.activity }
        if conversations.contains(where: {
            $0.hasUnreadReply && $0.workspace?.workspaceId == workspace?.workspaceId
        })
            || visibleThreads.contains(where: \.unread)
        {
            return L10n.string("Your answer is ready")
        }
        return L10n.string("Hey, how can I help?")
    }

    var visibleThreads: [AssistantThread] {
        threads.all.filter { $0.workspaceId == workspace?.workspaceId }
    }

    func authenticate(userID: String) {
        if let previous = self.userID, previous != userID { reset() }
        self.userID = userID
        if started { reconnect() }
    }

    func present() {
        if !started {
            started = true
            watchHistory()
        }
        if let workingConversation { select(workingConversation) }
        isPresented = true
        selected.setVisible(true)
    }

    func close() {
        isPresented = false
        selected.setVisible(false)
    }

    var canStartNewChat: Bool { selected.threadID != nil || selected.isWorking }

    func newChat() {
        if let draft = conversations.first(where: {
            $0.threadID == nil && !$0.isWorking
                && $0.workspace?.workspaceId == workspace?.workspaceId
        }) {
            select(draft)
            return
        }
        let conversation = AssistantConversation(client: client, workspace: workspace)
        conversations.append(conversation)
        select(conversation)
    }

    func open(_ thread: AssistantThread) {
        guard thread.workspaceId == workspace?.workspaceId else { return }
        if let existing = conversations.first(where: { $0.threadID == thread.id }) {
            select(existing)
        } else {
            let conversation = AssistantConversation(
                client: client, threadID: thread.id, workspace: workspace)
            conversations.append(conversation)
            select(conversation)
        }
    }

    func title(for conversation: AssistantConversation) -> String {
        threads.all.first { $0.id == conversation.threadID }?.displayTitle ?? "Kualia"
    }

    func reconnect() {
        guard started else { return }
        watchHistory()
        for conversation in conversations where conversation.isWorking || conversation === selected
        {
            conversation.reconnect()
        }
    }

    func reset() {
        generation = UUID()
        historyGeneration = UUID()
        subscriptions.removeAll()
        for conversation in conversations { conversation.reset() }
        let fresh = AssistantConversation(client: client)
        selected = fresh
        conversations = [fresh]
        threads = .init()
        hasLoadedHistory = false
        historyError = nil
        limitReached = false
        started = false
        userID = nil
        workspace = nil
        isPresented = false
    }

    private func select(_ conversation: AssistantConversation) {
        selected.setVisible(false)
        selected = conversation
        selected.setVisible(isPresented)
        // Keep drafts and running conversations. Bound the cache of inactive, clean histories.
        let idle = conversations.filter { $0 !== selected && !$0.isWorking && !$0.hasDraft }
        let evicted = Set(idle.dropLast(4).map(\.id))
        conversations.removeAll { conversation in
            guard evicted.contains(conversation.id) else { return false }
            conversation.reset()
            return true
        }
    }

    private func watchHistory() {
        subscriptions.removeAll()
        historyError = nil
        historyGeneration = UUID()
        let token = historyGeneration
        client.threads(workspace?.workspaceId).receive(on: DispatchQueue.main).removeDuplicates()
            .sink { [weak self] completion in
                guard let self, self.historyGeneration == token else { return }
                if case .failure = completion {
                    self.historyError = L10n.string("Couldn't load chat history. Try again.")
                }
            } receiveValue: { [weak self] list in
                guard let self, self.historyGeneration == token else { return }
                self.threads = list
                self.hasLoadedHistory = true
                self.historyError = nil
            }.store(in: &subscriptions)
        client.usage().receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self] usage in
                    guard let self, self.historyGeneration == token else { return }
                    self.limitReached = usage.limitReached
                }
            ).store(in: &subscriptions)
    }
}

@MainActor
@Observable
final class AssistantConversation: Identifiable {
    let id = UUID()
    private(set) var threadID: String?
    private(set) var rows: [AssistantRow] = []
    private(set) var hasLoaded = false
    private(set) var loadError: String?
    private(set) var sendError: String?
    private(set) var isSending = false
    private(set) var hasActiveStream = false
    private(set) var hasSyncedStream = false
    private(set) var streamingActivity = L10n.string("Thinking…")
    private(set) var isStopping = false
    private(set) var isLoadingOlder = false
    private(set) var hasMore = false
    private(set) var hasUnreadReply = false
    private(set) var attachments: [AssistantDraftAttachment] = []
    private(set) var pending: AssistantRow?
    private(set) var revision = 0
    private(set) var sendRevision = 0
    private(set) var workspace: AssistantWorkspace?
    var draft = ""

    @ObservationIgnored private let client: AssistantClient
    @ObservationIgnored private var messages: [AssistantMessage] = []
    @ObservationIgnored private var streams: [AssistantStream] = []
    @ObservationIgnored private var settlingStreams: [AssistantStream] = []
    @ObservationIgnored private var pageSnapshots: [String: [AssistantMessage]] = [:]
    @ObservationIgnored private var pageSubscriptions: [String: AnyCancellable] = [:]
    @ObservationIgnored private var streamSubscription: AnyCancellable?
    @ObservationIgnored private var sendTask: Task<Void, Never>?
    @ObservationIgnored private var stopTask: Task<Void, Never>?
    @ObservationIgnored private var readTask: Task<Void, Never>?
    @ObservationIgnored private var uploadTasks: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private var deadline: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var watchGeneration = UUID()
    @ObservationIgnored private var cursor: String?
    @ObservationIgnored private var isVisible = false
    @ObservationIgnored private var baselineOrder = -1
    @ObservationIgnored private var needsWorkspaceContext: Bool
    @ObservationIgnored private var failedDraft:
        (text: String, attachments: [AssistantDraftAttachment])?

    init(client: AssistantClient, threadID: String? = nil, workspace: AssistantWorkspace? = nil) {
        self.client = client
        self.threadID = threadID
        self.workspace = workspace
        needsWorkspaceContext = threadID == nil
        hasSyncedStream = threadID == nil
        hasLoaded = threadID == nil
    }

    var isWorking: Bool { isSending || hasActiveStream }
    var hasDraft: Bool { !draft.isEmpty || !attachments.isEmpty || failedDraft != nil }
    var canSend: Bool {
        !isWorking && (threadID == nil || (hasLoaded && hasSyncedStream)) && loadError == nil
            && attachments.allSatisfy {
                if case .ready = $0.status { return true }
                return false
            }
            && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !attachments.isEmpty)
    }

    /// Keep tool activity live, but reveal response text only once the turn ends.
    /// The stored stream still retains partial text for Stop and reconnection.
    var transcriptRows: [AssistantRow] {
        rows.compactMap { row in
            var visible = row
            if !row.isUser && (row.isStreaming || (isSending && row.order > baselineOrder)) {
                visible.text = ""
            }
            return visible.isUser || !visible.text.isEmpty || !visible.tools.isEmpty ? visible : nil
        }
    }

    var activity: String {
        if isStopping { return L10n.string("Stopping…") }
        return streamingActivity
    }

    func setVisible(_ visible: Bool) {
        isVisible = visible
        if visible {
            hasUnreadReply = false
            watch()
            markRead()
        } else if !isWorking {
            stopWatching()
        }
    }

    func reconnect() {
        stopWatching()
        watch()
    }

    func send(workspace currentWorkspace: AssistantWorkspace?, limitReached: Bool = false) {
        guard canSend, !limitReached else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let sentAttachments = attachments
        let files = sentAttachments.compactMap { attachment -> AssistantAttachment? in
            if case .ready(let file) = attachment.status { return file }
            return nil
        }
        if needsWorkspaceContext { workspace = workspace ?? currentWorkspace }
        let prompt = AssistantPrompt.encode(
            text: text, files: files, workspace: needsWorkspaceContext ? workspace : nil)
        baselineOrder = messages.map(\.order).max() ?? -1
        pending = .init(
            id: "pending-\(UUID())", order: baselineOrder + 1, isUser: true, text: text,
            files: files.map { .init(filename: $0.filename, mediaType: $0.mediaType) })
        failedDraft = nil
        sendError = nil
        draft = ""
        attachments = []
        isSending = true
        streamingActivity = L10n.string("Thinking…")
        sendRevision += 1
        revision += 1
        let token = generation
        sendTask = Task { [weak self] in
            guard let self else { return }
            do {
                if self.threadID == nil {
                    let created = try await self.client.createThread(self.workspace?.workspaceId)
                    guard self.generation == token, !Task.isCancelled else { return }
                    self.threadID = created
                    self.watch()
                }
                guard let threadID = self.threadID else { return }
                try Task.checkCancellation()
                try await self.client.send(
                    .init(threadID: threadID, prompt: prompt, attachments: files))
                guard self.generation == token, !Task.isCancelled else { return }
                self.needsWorkspaceContext = false
                self.hasUnreadReply = !self.isVisible
                if self.isVisible { self.markRead() }
            } catch {
                guard self.generation == token, !Task.isCancelled else { return }
                self.sendError =
                    L10n.string(
                        "Couldn't finish the response. Check the conversation before sending again."
                    )
                self.failedDraft = (text, sentAttachments)
            }
            self.isSending = false
            self.isStopping = false
            self.sendTask = nil
            self.revision += 1
            // Wait for the persisted reply before detaching the watcher. The action and
            // query results can arrive in either order over the connection.
            self.finishWatchingIfIdle()
        }
    }

    func restoreFailedDraft() {
        guard let failedDraft, draft.isEmpty, attachments.isEmpty, !isWorking else { return }
        draft = failedDraft.text
        attachments = failedDraft.attachments
        pending = nil
        sendError = nil
        self.failedDraft = nil
    }

    var canRestoreFailedDraft: Bool {
        failedDraft != nil && draft.isEmpty && attachments.isEmpty && !isWorking
    }

    func stop() {
        guard let threadID, !streams.isEmpty, !isStopping else { return }
        isStopping = true
        let token = generation
        stopTask = Task { [weak self] in
            guard let self else { return }
            do { try await self.client.stop(threadID) } catch {
                guard self.generation == token, !Task.isCancelled else { return }
                self.sendError = L10n.string("Couldn't stop the response. Please try again.")
            }
            guard self.generation == token, !Task.isCancelled else { return }
            self.isStopping = false
        }
    }

    var canStop: Bool { hasActiveStream && !isStopping }

    func addAttachment(
        filename: String, prepare: @escaping @Sendable () async throws -> AssistantLocalFile
    ) {
        guard attachments.count < 4 else { return }
        let attachmentID = UUID()
        let token = generation
        attachments.append(.init(id: attachmentID, filename: filename, status: .uploading))
        uploadTasks[attachmentID] = Task { [weak self] in
            guard let self else { return }
            do {
                let file = try await prepare()
                defer { try? FileManager.default.removeItem(at: file.url) }
                try Task.checkCancellation()
                guard self.generation == token,
                    self.attachments.contains(where: { $0.id == attachmentID })
                else { return }
                let uploaded = try await self.client.upload(file)
                guard self.generation == token, !Task.isCancelled else { return }
                self.updateAttachment(attachmentID, status: .ready(uploaded))
            } catch {
                guard self.generation == token, !Task.isCancelled else { return }
                self.updateAttachment(
                    attachmentID,
                    status: .failed(
                        (error as? LocalizedError)?.errorDescription
                            ?? L10n.string("Upload failed. Remove the file and try again.")))
            }
            self.uploadTasks[attachmentID] = nil
        }
    }

    func removeAttachment(_ id: UUID) {
        uploadTasks.removeValue(forKey: id)?.cancel()
        attachments.removeAll { $0.id == id }
    }

    func loadOlder() {
        guard let cursor, hasMore, !isLoadingOlder, pageSubscriptions[cursor] == nil else { return }
        isLoadingOlder = true
        subscribePage(cursor: cursor)
    }

    func reset() {
        generation = UUID()
        sendTask?.cancel()
        stopTask?.cancel()
        readTask?.cancel()
        for task in uploadTasks.values { task.cancel() }
        uploadTasks = [:]
        stopWatching()
        isSending = false
        hasActiveStream = false
        hasSyncedStream = false
        streamingActivity = L10n.string("Thinking…")
        isStopping = false
        streams = []
        settlingStreams = []
        messages = []
        rows = []
        pending = nil
        draft = ""
        attachments = []
        failedDraft = nil
    }

    private func updateAttachment(_ id: UUID, status: AssistantDraftAttachment.Status) {
        guard let index = attachments.firstIndex(where: { $0.id == id }) else { return }
        attachments[index].status = status
    }

    private func watch() {
        guard let threadID, pageSubscriptions.isEmpty else { return }
        loadError = nil
        hasSyncedStream = false
        pageSnapshots = [:]
        subscribePage(cursor: nil)
        let token = watchGeneration
        streamSubscription = client.streams(threadID)
            .receive(on: DispatchQueue.main)
            .throttle(for: .milliseconds(100), scheduler: DispatchQueue.main, latest: true)
            .removeDuplicates()
            .sink { [weak self] completion in
                guard let self, self.watchGeneration == token else { return }
                if case .failure = completion {
                    self.loadError = L10n.string(
                        "Connection interrupted. Reconnect to see the latest response.")
                }
            } receiveValue: { [weak self] streams in
                guard let self, self.watchGeneration == token else { return }
                let wasStreaming = !self.streams.isEmpty
                if streams.isEmpty && !self.streams.isEmpty {
                    self.settlingStreams = self.streams.filter { !$0.text.isEmpty }.map {
                        .init(
                            streamId: $0.streamId, order: $0.order, stepOrder: $0.stepOrder,
                            status: "finished", text: $0.text, toolCalls: $0.toolCalls)
                    }
                }
                self.streams = streams.filter { $0.status == "streaming" }
                self.hasSyncedStream = true
                self.hasActiveStream = !self.streams.isEmpty
                let tools = self.streams.flatMap(\.toolCalls)
                let activity =
                    tools.last(where: { $0.state == "running" && $0.isUserFacing })?.activity
                    ?? (self.streams.contains(where: { !$0.text.isEmpty })
                        ? L10n.string("Writing your answer") : L10n.string("Thinking…"))
                if self.streamingActivity != activity { self.streamingActivity = activity }
                self.rebuildRows()
                if wasStreaming && self.streams.isEmpty {
                    if !self.isVisible { self.hasUnreadReply = true } else { self.markRead() }
                }
                self.finishWatchingIfIdle()
            }
        deadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(20)) } catch { return }
            guard let self, self.watchGeneration == token, !self.hasLoaded else { return }
            self.loadError = L10n.string("Couldn't connect to this chat. Please try again.")
        }
    }

    private func subscribePage(cursor requestedCursor: String?) {
        guard let threadID else { return }
        let key = requestedCursor ?? "first"
        let token = watchGeneration
        pageSubscriptions[key] = client.messages(threadID, requestedCursor).receive(
            on: DispatchQueue.main
        )
        .sink { [weak self] completion in
            guard let self, self.watchGeneration == token else { return }
            if case .failure = completion {
                self.loadError = L10n.string("Couldn't load messages. Reconnect to try again.")
                self.isLoadingOlder = false
                self.pageSubscriptions[key] = nil
            }
        } receiveValue: { [weak self] page in
            guard let self, self.watchGeneration == token else { return }
            self.pageSnapshots[key] = page.page
            // The live first page can overlap older pages. Deduplicate by server ID,
            // preferring the newest page for tool states that change during a run.
            var merged: [String: AssistantMessage] = [:]
            for (pageKey, messages) in self.pageSnapshots where pageKey != "first" {
                for message in messages { merged[message.id] = message }
            }
            for message in self.pageSnapshots["first"] ?? [] { merged[message.id] = message }
            self.messages = Array(merged.values)
            self.workspace = self.workspace ?? self.messages.compactMap(\.workspace).first
            if self.messages.contains(where: { $0.role == "user" && $0.workspace != nil }) {
                self.needsWorkspaceContext = false
            }
            if requestedCursor != nil || self.pageSnapshots.count == 1 {
                self.cursor = page.continueCursor
                self.hasMore = !page.isDone
            }
            self.hasLoaded = true
            self.isLoadingOlder = false
            self.loadError = nil
            self.deadline?.cancel()
            if self.pending != nil,
                self.messages.contains(where: {
                    $0.role == "user" && $0.order > self.baselineOrder
                        && $0.text == self.pending?.text && $0.files == self.pending?.files
                })
            {
                self.pending = nil
            }
            self.rebuildRows()
            self.finishWatchingIfIdle()
        }
    }

    private func rebuildRows() {
        settlingStreams.removeAll { stream in
            messages.contains {
                $0.role == "assistant" && $0.order == stream.order
                    && $0.status == "success" && $0.text.hasPrefix(stream.text)
            }
        }
        let updated = AssistantRow.build(messages: messages, streams: settlingStreams + streams)
        if updated != rows {
            rows = updated
            revision += 1
        }
    }

    private func finishWatchingIfIdle() {
        guard !isVisible, !isWorking else { return }
        if sendError != nil {
            stopWatching()
            return
        }
        guard pending == nil else { return }
        if messages.contains(where: {
            $0.role == "assistant" && $0.status == "success"
                && $0.order > baselineOrder && !$0.text.isEmpty
        }) {
            stopWatching()
        }
    }

    private func stopWatching() {
        watchGeneration = UUID()
        pageSubscriptions = [:]
        streamSubscription = nil
        deadline?.cancel()
        deadline = nil
        isLoadingOlder = false
    }

    private func markRead() {
        guard let threadID else { return }
        readTask?.cancel()
        readTask = Task { [client] in try? await client.markRead(threadID) }
    }
}
