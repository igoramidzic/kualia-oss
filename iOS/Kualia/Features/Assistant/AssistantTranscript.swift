import SwiftUI

struct AssistantTranscript: View {
    let conversation: AssistantConversation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var preservedMessageID: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    if conversation.hasMore {
                        Button {
                            preservedMessageID = conversation.rows.first?.id
                            conversation.loadOlder()
                        } label: {
                            HStack {
                                if conversation.isLoadingOlder {
                                    ProgressView().controlSize(.small)
                                }
                                Text(
                                    conversation.isLoadingOlder
                                        ? L10n.string("Loading earlier messages")
                                        : L10n.string("Load earlier messages"))
                            }.font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
                        }.disabled(conversation.isLoadingOlder)
                    }
                    if !conversation.hasLoaded && conversation.loadError == nil {
                        ProgressView(L10n.string("Loading conversation")).frame(maxWidth: .infinity)
                            .padding(
                                .top, 32)
                    }
                    ForEach(conversation.transcriptRows) { row in
                        AssistantMessageRow(row: row).equatable().id(row.id)
                    }
                    if let pending = conversation.pending {
                        AssistantMessageRow(row: pending).equatable().id(pending.id)
                    }
                    if conversation.isWorking {
                        HStack(spacing: 10) {
                            AssistantActivitySymbol()
                            Text(conversation.activity)
                                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                                .contentTransition(.opacity)
                                .animation(
                                    reduceMotion ? nil : .easeInOut(duration: 0.2),
                                    value: conversation.activity)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("assistant.activity")
                    }
                    if let error = conversation.loadError {
                        notice(error, button: L10n.string("Reconnect")) { conversation.reconnect() }
                    }
                    if let error = conversation.sendError {
                        notice(
                            error,
                            button: conversation.canRestoreFailedDraft
                                ? L10n.string("Edit message") : nil
                        ) {
                            conversation.restoreFailedDraft()
                        }
                    }
                    Color.clear.frame(height: 1).id("assistant-bottom")
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .scrollTargetLayout()
            }
            .scrollDismissesKeyboard(.interactively)
            .kualiaScrollEdges(for: .bottom)
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            // Keep the reading position when replies, tool details, or formatted
            // Markdown change height. Only an explicit send moves to the latest message.
            .defaultScrollAnchor(.top, for: .sizeChanges)
            .onChange(of: conversation.sendRevision) { _, _ in
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                    proxy.scrollTo("assistant-bottom", anchor: .bottom)
                }
            }
            .onChange(of: conversation.isLoadingOlder) { _, loading in
                if !loading, let preservedMessageID {
                    proxy.scrollTo(preservedMessageID, anchor: .top)
                    self.preservedMessageID = nil
                }
            }

        }
    }

    private func notice(_ message: String, button: String?, action: @escaping () -> Void)
        -> some View
    {
        VStack(alignment: .leading, spacing: 10) {
            Text(message).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            if let button {
                Button(button, action: action).font(.subheadline.weight(.semibold)).frame(
                    minHeight: 44)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 20))
    }
}

private struct AssistantMessageRow: View, Equatable {
    let row: AssistantRow
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var blocks: [AssistantTextBlock] = []
    @State private var isVisible = false
    @State private var isResponseVisible = false
    @State private var showsTools = false

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.row == rhs.row }

    var body: some View {
        VStack(alignment: row.isUser ? .trailing : .leading, spacing: 12) {
            if !row.files.isEmpty {
                ForEach(Array(row.files.enumerated()), id: \.offset) { _, file in
                    Label(
                        file.filename,
                        icon: file.mediaType.hasPrefix("image/") ? .photo : .file
                    )
                    .font(.caption).lineLimit(2).padding(12)
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                }
            }
            if !row.tools.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Button {
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
                            showsTools.toggle()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(AssistantTool.summary(for: row.tools))
                                .multilineTextAlignment(.leading)
                            KualiaIconImage(icon: .chevronRight, size: 9)
                                .font(.system(size: 9, weight: .semibold))
                                .rotationEffect(.degrees(showsTools ? 90 : 0))
                                .opacity(0.65)
                        }
                        .font(.subheadline)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(
                        showsTools ? L10n.string("Expanded") : L10n.string("Collapsed")
                    )
                    .accessibilityHint(L10n.string("Shows the actions taken for this response"))
                    if showsTools {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(row.tools) { tool in
                                if let summary = tool.summary {
                                    Label(
                                        summary,
                                        icon: tool.state == "error"
                                            ? .warning
                                            : tool.state == "running" ? .dots : .check
                                    )
                                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                        .padding(.leading, 12)
                        .padding(.vertical, 6)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(KualiaPalette.mutedInk.opacity(0.18)).frame(width: 1)
                        }
                        .transition(.opacity)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            if !row.text.isEmpty {
                if row.isUser {
                    Text(row.text).font(.body).textSelection(.enabled)
                        .padding(.horizontal, 18).padding(.vertical, 13)
                        .background(
                            KualiaPalette.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 24)
                        )
                        .frame(maxWidth: .infinity, alignment: .trailing)
                } else {
                    assistantText
                        .font(.body).lineSpacing(5)
                        .opacity(isResponseVisible ? 1 : 0)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contextMenu {
                            Button(L10n.string("Copy response"), icon: .copy) {
                                UIPasteboard.general.string = row.text
                            }
                            ShareLink(item: row.text)
                        }
                }
            }
        }
        .foregroundStyle(KualiaPalette.ink)
        .padding(.leading, row.isUser ? 30 : 0)
        .frame(maxWidth: .infinity, alignment: row.isUser ? .trailing : .leading)
        .opacity(isVisible ? 1 : 0)
        .onAppear {
            withAnimation(reduceMotion || row.isUser ? nil : .easeOut(duration: 0.22)) {
                isVisible = true
            }
        }
        .onChange(of: blocks.isEmpty, initial: true) { _, empty in
            // A tool row may already be visible when the first answer chunk arrives.
            // Fade that answer once, without animating every subsequent text update.
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) {
                isResponseVisible = !empty
            }
        }
        .task(id: row.text) {
            guard !row.isUser, !row.text.isEmpty else { return }
            do {
                let rendered = try await AssistantMarkdownRenderer.render(row.text)
                guard !Task.isCancelled else { return }
                blocks = rendered
            } catch is CancellationError {
                // The row changed or left the screen before parsing finished.
            } catch {
                assertionFailure(L10n.string("Unexpected Markdown rendering failure: \(error)"))
            }
        }
    }

    private var assistantText: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(blocks) { block in
                if let link = block.transaction {
                    transactionLink(link)
                } else if block.isCode {
                    ScrollView(.horizontal) {
                        Text(block.text).font(.system(.subheadline, design: .monospaced))
                            .padding(14)
                    }
                    .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 16))
                } else {
                    Text(block.attributed)
                        .font(block.isHeading ? .headline : .body)
                }
            }
        }
    }
    private func transactionLink(_ link: AssistantTransactionLink) -> some View {
        Link(destination: link.url) {
            Label(L10n.string("View transaction"), icon: .externalLink)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 12))
        }
        .accessibilityHint(L10n.string("Opens the transaction in Kualia"))
    }

}
