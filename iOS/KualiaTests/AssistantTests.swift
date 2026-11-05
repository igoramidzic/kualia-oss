import Combine
import Foundation
import Observation
import Synchronization
import Testing

@testable import Kualia

@MainActor struct AssistantModelTests {
    @Test func sidebarDimmingTracksBothOpeningAndClosingWithoutASeparateExitState() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(startX: 0, translationX: 160, translationY: 0)
        #expect(drawer.progress(width: 320) == 0.5)
        #expect(AssistantDrawerState.dimmingOpacity(progress: drawer.progress(width: 320)) == 0.08)
        drawer.endDrag(predictedTranslation: 250, width: 320)
        #expect(drawer.isPresented)
        drawer.dragChanged(startX: 200, translationX: -160, translationY: 0)
        #expect(drawer.progress(width: 320) == 0.5)
        #expect(AssistantDrawerState.dimmingOpacity(progress: drawer.progress(width: 320)) == 0.08)
        drawer.endDrag(predictedTranslation: -300, width: 320)
        #expect(!drawer.isPresented)
        #expect(drawer.progress(width: 320) == 0)
        #expect(AssistantDrawerState.dimmingOpacity(progress: drawer.progress(width: 320)) == 0)
    }

    @Test func sidebarIgnoresVerticalScrollingAndNonEdgeOpeningGestures() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(startX: 0, translationX: 30, translationY: 100)
        drawer.endDrag(predictedTranslation: 300, width: 320)
        #expect(!drawer.isPresented)
        drawer.dragChanged(startX: 100, translationX: 160, translationY: 0)
        drawer.endDrag(predictedTranslation: 300, width: 320)
        #expect(!drawer.isPresented)
        #expect(drawer.progress(width: 320) == 0)
    }

    @Test func sidebarOverscrollAndButtonDismissalLeaveNoResidualDim() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(startX: 0, translationX: 1000, translationY: 0)
        #expect(drawer.progress(width: 320) == 1)
        drawer.setPresented(false)
        #expect(drawer.progress(width: 320) == 0)
        drawer.setPresented(true)
        drawer.dragChanged(startX: 100, translationX: -1000, translationY: 0)
        #expect(drawer.progress(width: 320) == 0)
        drawer.endDrag(predictedTranslation: -1000, width: 320)
        #expect(!drawer.isPresented)
        #expect(drawer.progress(width: 0) == 0)
    }

    @Test func sidebarDragKeepsChatLockedWhenFingerMovesVerticallyOrReturnsToOrigin() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(startX: 0, translationX: 40, translationY: 0)
        #expect(drawer.blocksChatScrolling)
        drawer.dragChanged(startX: 0, translationX: 100, translationY: 200)
        #expect(drawer.progress(width: 320) == 0.3125)
        #expect(drawer.blocksChatScrolling)
        drawer.dragChanged(startX: 0, translationX: 0, translationY: 200)
        #expect(drawer.isDragging)
        #expect(drawer.blocksChatScrolling)
        drawer.endDrag(predictedTranslation: 0, width: 320)
        #expect(!drawer.blocksChatScrolling)
    }

    @Test func verticalScrollCannotBecomeSidebarDragMidGesture() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(startX: 0, translationX: 10, translationY: 30)
        drawer.dragChanged(startX: 0, translationX: 200, translationY: 40)
        #expect(!drawer.blocksChatScrolling)
        #expect(drawer.progress(width: 320) == 0)
        drawer.endDrag(predictedTranslation: 250, width: 320)
        #expect(!drawer.isPresented)
    }

    @Test func cancellingSidebarGestureRestoresScrollPolicyAndAllowsAnotherGesture() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(startX: 0, translationX: 100, translationY: 0)
        drawer.cancelDrag()
        #expect(!drawer.blocksChatScrolling)
        #expect(drawer.progress(width: 320) == 0)
        drawer.setPresented(true)
        drawer.dragChanged(startX: 100, translationX: -100, translationY: 0)
        drawer.cancelDrag()
        #expect(drawer.blocksChatScrolling)
        #expect(!drawer.isDragging)
        #expect(drawer.progress(width: 320) == 1)
        drawer.dragChanged(startX: 100, translationX: -200, translationY: 0)
        drawer.endDrag(predictedTranslation: -300, width: 320)
        #expect(!drawer.blocksChatScrolling)
    }

    @Test func dragSamplesDoNotInvalidateChatAndHistoryInteractionState() {
        let drawer = AssistantDrawerState()
        drawer.dragChanged(startX: 0, translationX: 20, translationY: 0)
        let paneInvalidated = Mutex(false)
        withObservationTracking {
            _ = drawer.isPresented
            _ = drawer.isDragging
            _ = drawer.blocksChatScrolling
        } onChange: {
            paneInvalidated.withLock { $0 = true }
        }
        for sample in 21...300 {
            drawer.dragChanged(startX: 0, translationX: Double(sample), translationY: 0)
        }
        #expect(drawer.progress(width: 320) == 0.9375)
        #expect(!paneInvalidated.withLock { $0 })
        drawer.endDrag(predictedTranslation: 320, width: 320)
        #expect(paneInvalidated.withLock { $0 })
        #expect(drawer.isPresented)
    }

    @Test func dragSamplesStillInvalidateTheMotionLayerDuringOpeningAndClosing() {
        let drawer = AssistantDrawerState()
        for presented in [false, true] {
            drawer.setPresented(presented)
            drawer.dragChanged(startX: 0, translationX: presented ? -20 : 20, translationY: 0)
            let motionInvalidated = Mutex(false)
            withObservationTracking {
                _ = drawer.progress(width: 320)
            } onChange: {
                motionInvalidated.withLock { $0 = true }
            }
            drawer.dragChanged(startX: 0, translationX: presented ? -160 : 160, translationY: 0)
            #expect(motionInvalidated.withLock { $0 })
            #expect(drawer.progress(width: 320) == 0.5)
            drawer.cancelDrag()
        }
    }

    @Test func markdownStylesHeadingsAndInlineFormatting() async throws {
        let partial = try await AssistantMarkdownRenderer.render(
            "## Summary\n\nYou spent **$42** at *the market*.\n\n- Food")
        #expect(partial[0].isHeading)
        #expect(partial[0].text == "Summary")
        #expect(String(partial[1].attributed.characters) == "You spent $42 at the market.")
        #expect(
            partial[1].attributed.runs.contains {
                $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true
            })
        #expect(
            partial[1].attributed.runs.contains {
                $0.inlinePresentationIntent?.contains(.emphasized) == true
            })
        #expect(partial[2].text == "• Food")
        let next = try await AssistantMarkdownRenderer.render(
            "## Summary\n\nYou spent **$42** at *the market*.\n\n- Food: $42\n- Travel: $10")
        #expect(next[0].id == partial[0].id)
        #expect(next[1].attributed == partial[1].attributed)
        #expect(next[2].text == "• Food: $42\n• Travel: $10")
    }

    @Test func codeAndTransactionLinksKeepTheirRenderedForm() async throws {
        let code = try await AssistantMarkdownRenderer.render(
            "Example:\n\n```swift\nlet value = \"**literal**\"")
        #expect(code[1].isCode)
        #expect(String(code[1].attributed.characters) == "let value = \"**literal**\"")
        let pending = try await AssistantMarkdownRenderer.render(
            "**Updated.** <transactionLink>https://app.kualia.com/abcd1234/transactions/tx987")
        #expect(pending.count == 1)
        #expect(String(pending[0].attributed.characters) == "Updated. ")
        let finished = try await AssistantMarkdownRenderer.render(
            "**Updated.** <transactionLink>https://app.kualia.com/abcd1234/transactions/tx987</transactionLink>"
        )
        #expect(finished[0].attributed == pending[0].attributed)
        #expect(finished[1].transaction?.transactionID == "tx987")
    }

    @Test func transactionTagsRenderLinksAndPreserveSurroundingText() throws {
        let url = try #require(
            URL(string: "https://app.kualia.com/abcd1234/transactions/tx987/details"))
        let link = try #require(AssistantTransactionLink(url: url))
        #expect(link.workspaceShortID == "abcd1234")
        #expect(link.transactionID == "tx987")
        #expect(
            AssistantResponsePart.parse(
                "Updated <transactionLink> \(url) </transactionLink> for you.") == [
                    .text("Updated "), .transaction(link), .text(" for you."),
                ])
        #expect(
            AssistantResponsePart.parse(
                "<TRANSACTIONLINK>\(url)</TRANSACTIONLINK><transactionLink>\(url)</transactionLink>"
            ) == [.transaction(link), .transaction(link)])
    }

    @Test func streamingTransactionTagsStayHiddenUntilComplete() throws {
        let text = "Updated your transaction. "
        let markup =
            "<transactionLink>https://app.kualia.com/abcd1234/transactions/tx987</transactionLink>"
        for count in 1..<markup.count {
            #expect(AssistantResponsePart.parse(text + markup.prefix(count)) == [.text(text)])
        }
        #expect(AssistantResponsePart.parse("You spent < $50") == [.text("You spent < $50")])
    }

    @Test func transactionLinksRejectOtherHostsAndInvalidRoutes() {
        let invalid = [
            "https://evil.example/abcd1234/transactions/tx987",
            "https://app.kualia.com.evil.example/abcd1234/transactions/tx987",
            "http://app.kualia.com/abcd1234/transactions/tx987",
            "https://app.kualia.com/abcd1234/accounts/tx987",
            "https://app.kualia.com/short/transactions/tx987",
            "https://app.kualia.com/abcd1234/transactions/tx987/delete",
            "https://app.kualia.com/abcd1234/transactions/tx%20id",
        ]
        for raw in invalid {
            #expect(URL(string: raw).flatMap(AssistantTransactionLink.init(url:)) == nil)
            #expect(
                AssistantResponsePart.parse("<transactionLink>\(raw)</transactionLink>") == [
                    .text("Transaction link unavailable")
                ])
        }
    }

    @Test func transactionURLsResolveAgainstCatalogInsteadOfTheActiveWorkspace() throws {
        let link = try #require(
            AssistantTransactionLink(
                rawValue: "https://app.kualia.com/abcd1234/transactions/tx987/details"))
        #expect(
            try link.resolveWorkspaceID(
                accessibleIDs: ["workspaceabcd1234", "workspaceefgh5678"],
                chatWorkspaceID: "workspaceefgh5678") == "workspaceabcd1234")
        #expect(throws: AssistantTransactionError.self) {
            try link.resolveWorkspaceID(
                accessibleIDs: ["workspaceefgh5678"], chatWorkspaceID: "workspaceefgh5678")
        }
    }

    @Test func workspaceLessAndSchemeLessLinksUseTheChatContext() throws {
        let link = try #require(
            AssistantTransactionLink(rawValue: "app.kualia.com/transactions/tx987/details"))
        #expect(link.workspaceShortID == nil)
        #expect(link.transactionID == "tx987")
        #expect(link.url.scheme == "https")
        #expect(
            try link.resolveWorkspaceID(accessibleIDs: ["personal"], chatWorkspaceID: "personal")
                == "personal")
        #expect(throws: AssistantTransactionError.self) {
            try link.resolveWorkspaceID(accessibleIDs: ["personal"], chatWorkspaceID: nil)
        }
        #expect(
            AssistantResponsePart.parse(
                "<transactionLink>app.kualia.com/transactions/tx987/details</transactionLink>") == [
                    .transaction(link)
                ])
    }

    @Test func completedToolsSummarizeActionsAndDeduplicateRepeats() {
        let tools: [AssistantTool] = [
            .init(toolCallId: "1", toolName: "kualia_list_transactions", state: "success"),
            .init(toolCallId: "2", toolName: "kualia_list_transactions", state: "success"),
            .init(toolCallId: "3", toolName: "kualia_delete_transactions", state: "success"),
        ]
        #expect(AssistantTool.summary(for: tools) == "Reviewed and deleted transactions")
        #expect(tools[2].summary == "Deleted transactions")
    }

    @Test func toolSummaryUsesCurrentActionAndNeverClaimsFailedWorkSucceeded() {
        let reviewed = AssistantTool(
            toolCallId: "1", toolName: "list_transactions", state: "success")
        let deleting = AssistantTool(
            toolCallId: "2", toolName: "delete_transactions", state: "running")
        let failed = AssistantTool(toolCallId: "2", toolName: "delete_transactions", state: "error")
        #expect(AssistantTool.summary(for: [reviewed, deleting]) == "Deleting transactions")
        #expect(AssistantTool.summary(for: [reviewed, failed]) == "Couldn’t delete transactions")
        #expect(AssistantTool.summary(for: [deleting]) == "Deleting transactions")
        #expect(
            AssistantTool(toolCallId: "3", toolName: "update_categories", state: "success").summary
                == "Updated categories")
    }

    @Test func contextAndAttachmentsRoundTripWithoutShowingMetadataOrFileBodies() {
        let workspace = AssistantWorkspace(
            workspaceId: "personal", workspaceName: "Igor's \"Budget\"")
        let attachment = AssistantAttachment(
            storageId: "storage", mediaType: "text/csv", filename: "Bank.csv")
        let prompt = AssistantPrompt.encode(
            text: "Review this", files: [attachment], workspace: workspace)
        let parsed = AssistantPrompt.parse(
            prompt
                + "\n<kualia-attachment-body filename=\"Bank.csv\">secret rows</kualia-attachment-body>"
        )
        #expect(parsed.text == "Review this")
        #expect(parsed.workspace == workspace)
        #expect(parsed.files == [.init(filename: "Bank.csv", mediaType: "text/csv")])
        #expect(!parsed.text.contains("secret"))
        #expect(AssistantPrompt.parse("Hello\n<kualia-attachment-body>partial").text == "Hello")
    }

    @Test func decodesStringAndMultipartMessagesWithoutExposingReasoningOrToolArguments() throws {
        let message = try AssistantTestData.message("u", order: 1, role: "user", text: "Hello")
        #expect(message.text == "Hello")
        let raw =
            #"{"_id":"a","order":1,"stepOrder":1,"message":{"role":"assistant","content":[{"type":"reasoning","text":"private"},{"type":"text","text":"Answer"},{"type":"tool-call","text":"arguments"}]},"toolCalls":[]}"#
        let decoded = try JSONDecoder().decode(AssistantMessage.self, from: Data(raw.utf8))
        #expect(decoded.text == "Answer")
    }

    @Test func streamedReplyReplacesPreambleAndKeepsItsIdentityWhenCommitted() throws {
        let preamble = try AssistantTestData.message(
            "pre", order: 1, step: 0, text: "Let me check.")
        let stream = AssistantTestData.stream(text: "You spent $42", order: 1)
        let streaming = AssistantRow.build(messages: [preamble], streams: [stream])
        #expect(streaming.count == 1)
        #expect(streaming[0].text == "You spent $42")
        #expect(streaming[0].isStreaming)
        let final = try AssistantTestData.message(
            "final", order: 1, step: 3, text: "You spent $42 this week.")
        let committed = AssistantRow.build(messages: [preamble, final], streams: [stream])
        #expect(committed.count == 1)
        #expect(committed[0].id == streaming[0].id)
        #expect(committed[0].text == "You spent $42 this week.")
        #expect(!committed[0].isStreaming)
    }

    @Test func unknownToolEntriesDoNotCreateRowsOrPolluteRealSummaries() {
        let unknown = AssistantTool(
            toolCallId: "unknown", toolName: "internal_update_transactions", state: "success")
        let unnamed = AssistantTool(toolCallId: "empty", toolName: "", state: "running")
        let real = AssistantTool(
            toolCallId: "real", toolName: "kualia_list_transactions", state: "success")
        #expect(!unknown.isUserFacing)
        #expect(unknown.summary == nil)
        #expect(AssistantTool.summary(for: [unknown, unnamed]) == "")
        #expect(AssistantTool.summary(for: [real, unknown, unnamed]) == "Reviewed transactions")
        #expect(
            AssistantRow.build(
                messages: [],
                streams: [AssistantTestData.stream(text: "", tools: [unknown, unnamed])]
            ).isEmpty)
        let rows = AssistantRow.build(
            messages: [],
            streams: [AssistantTestData.stream(text: "Answer", tools: [unknown, real, unnamed])])
        #expect(rows.first?.text == "Answer")
        #expect(rows.first?.tools == [real])
    }

    @Test func realPreviouslyUnmappedToolsHaveSpecificLabels() {
        let expected = [
            "kualia_get_income_summary": "Reviewed your income",
            "kualia_get_monthly_summary": "Reviewed your monthly summary",
            "kualia_get_envelope_month_status": "Reviewed your budget",
            "query_docs_filesystem_kualia": "Read documentation",
            "submit_feedback": "Submitted documentation feedback",
            "kualia_feedback_create": "Submitted feedback",
        ]
        for (name, summary) in expected {
            let tool = AssistantTool(toolCallId: name, toolName: name, state: "success")
            #expect(tool.isUserFacing)
            #expect(tool.summary == summary)
        }
    }

    @Test func savedToolCallsIgnoreUnknownEntriesAndKeepNamesForUnnamedResults() throws {
        let raw =
            #"{"_id":"a","order":1,"stepOrder":0,"message":{"role":"assistant","content":""},"toolCalls":[{"toolCallId":"real","toolName":"kualia_delete_transactions","state":"running"},{"toolCallId":"unknown","toolName":"internal_update_transactions","state":"success"}]}"#
        let message = try JSONDecoder().decode(AssistantMessage.self, from: Data(raw.utf8))
        #expect(AssistantRow.build(messages: [message], streams: []).first?.tools.count == 1)
        for state in ["success", "error"] {
            let result = AssistantTool(toolCallId: "real", toolName: "", state: state)
            let rows = AssistantRow.build(
                messages: [message],
                streams: [AssistantTestData.stream(text: "", order: 1, tools: [result])])
            #expect(rows.first?.tools.count == 1)
            #expect(rows.first?.tools.first?.toolName == "kualia_delete_transactions")
            #expect(rows.first?.tools.first?.state == state)
            #expect(
                rows.first?.tools.first?.summary
                    == (state == "success"
                        ? "Deleted transactions" : "Couldn’t delete transactions"))
        }
    }

    @Test func toolStatusUsesRealActivityAndNeverGuessesAnUnknownOperation() {
        #expect(
            AssistantTestData.tool("kualia_list_transactions").activity == "Reviewing transactions")
        #expect(
            AssistantTestData.tool("kualia_create_transactions").activity == "Adding transactions")
        #expect(AssistantTestData.tool("something_new").activity == nil)
    }

}

@MainActor
struct AssistantStoreTests {
    @Test func workspaceSwitchKeepsDraftsAndRunningRepliesInTheirOriginalWorkspace() async {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        let personal = AssistantWorkspace(workspaceId: "personal", workspaceName: "Personal")
        let shared = AssistantWorkspace(workspaceId: "shared", workspaceName: "Shared")
        store.workspace = personal
        store.present()
        let first = store.selected
        first.draft = "Review personal"
        first.send(workspace: personal)
        await fixture.settle()
        store.workspace = shared
        let second = store.selected
        second.draft = "Shared draft"
        #expect(first !== second)
        #expect(first.isWorking)
        #expect(store.workingConversation == nil)
        #expect(store.launcherText == "Hey, how can I help?")
        #expect(second.workspace == shared)
        #expect(fixture.historyWorkspaceIDs.last == "shared")
        store.workspace = personal
        #expect(store.selected === first)
        #expect(store.workingConversation === first)
        store.workspace = shared
        #expect(store.selected === second)
        #expect(second.draft == "Shared draft")
        fixture.complete("thread-1")
        await fixture.settle()
        #expect(store.launcherText == "Hey, how can I help?")
        store.reset()
    }

    @Test func historyAndOpenIgnoreOtherWorkspaceThreads() async {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.workspace = .init(workspaceId: "personal", workspaceName: "Personal")
        store.present()
        let current = AssistantThread(
            threadId: "personal-chat", title: "Personal", lastUpdatedAt: 1, unread: false,
            workspaceId: "personal")
        let other = AssistantThread(
            threadId: "other-chat", title: "Shared", lastUpdatedAt: 2, unread: true,
            workspaceId: "shared")
        fixture.threads.send(.init(active: [current, other]))
        await fixture.settle()
        #expect(store.visibleThreads == [current])
        #expect(store.launcherText == "Hey, how can I help?")
        let selected = store.selected
        store.open(other)
        #expect(store.selected === selected)
        store.open(current)
        #expect(store.selected.threadID == "personal-chat")
        #expect(store.selected.workspace?.workspaceId == "personal")
        store.reset()
    }

    @Test func transcriptWaitsForTheFullTurnWhileKeepingToolActivityVisible() async throws {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        let conversation = store.selected
        conversation.draft = "Review my spending"
        conversation.send(workspace: nil)
        await fixture.settle()
        let tool = AssistantTool(
            toolCallId: "review", toolName: "list_transactions", state: "running")
        fixture.stream("thread-1").send([
            AssistantTestData.stream(text: "**Complete", tools: [tool])
        ]
        )
        await fixture.settle()
        #expect(conversation.rows.last?.text == "**Complete")
        #expect(conversation.transcriptRows.last?.text == "")
        #expect(conversation.transcriptRows.last?.tools == [tool])
        // A committed preamble between tools must also stay hidden until the action ends.
        fixture.page("thread-1").send(
            .init(
                page: [
                    try AssistantTestData.message("answer", order: 1, text: "**Complete answer**")
                ], continueCursor: nil, isDone: true))
        fixture.stream("thread-1").send([])
        await fixture.settle()
        #expect(conversation.isSending)
        #expect(conversation.transcriptRows.allSatisfy { $0.isUser || $0.text.isEmpty })
        fixture.complete("thread-1")
        await fixture.settle()
        #expect(conversation.transcriptRows.last?.text == "**Complete answer**")
        store.reset()
    }

    @Test func incomingRepliesDoNotRequestTheSendScrollAgain() async throws {
        let fixture = AssistantFixture()
        let conversation = AssistantConversation(client: fixture.client)
        conversation.draft = "Review my spending"
        conversation.send(workspace: nil)
        await fixture.settle()
        let sentRevision = conversation.sendRevision
        #expect(sentRevision == 1)
        fixture.stream("thread-1").send([
            AssistantTestData.stream(
                text: "", tools: [AssistantTestData.tool("kualia_list_transactions")])
        ])
        await fixture.settle()
        #expect(conversation.sendRevision == sentRevision)
        fixture.stream("thread-1").send([AssistantTestData.stream(text: "Your **spending**")])
        await fixture.settle()
        #expect(conversation.sendRevision == sentRevision)
        let answer = try AssistantTestData.message(
            "answer", order: 1, text: "Your **spending** is lower this month.")
        fixture.page("thread-1").send(.init(page: [answer], continueCursor: nil, isDone: true))
        fixture.complete("thread-1")
        await fixture.settle()
        #expect(conversation.sendRevision == sentRevision)
        #expect(conversation.transcriptRows.last?.text == answer.text)
        conversation.reset()
    }

    @Test func unknownStreamEntriesDoNotReplaceRealLauncherActivity() async {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        store.selected.draft = "Review"
        store.selected.send(workspace: nil)
        await fixture.settle()
        let unknown = AssistantTool(toolCallId: "internal", toolName: "", state: "running")
        fixture.stream("thread-1").send([
            AssistantTestData.stream(
                text: "", tools: [AssistantTestData.tool("kualia_list_transactions"), unknown])
        ])
        await fixture.settle()
        #expect(store.launcherText == "Reviewing transactions")
        fixture.stream("thread-1").send([AssistantTestData.stream(text: "", tools: [unknown])])
        await fixture.settle()
        #expect(store.launcherText == "Thinking…")
        fixture.complete("thread-1")
        await fixture.settle()
        store.reset()
    }

    @Test func launcherObservesActivityChangesWhileTheChatIsClosed() async {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        store.selected.draft = "Help"
        store.selected.send(workspace: nil)
        await fixture.settle()
        store.close()
        let changes = Mutex(0)
        withObservationTracking {
            _ = store.launcherText
        } onChange: {
            changes.withLock { $0 += 1 }
        }
        fixture.stream("thread-1").send([
            AssistantTestData.stream(
                text: "", tools: [AssistantTestData.tool("kualia_list_transactions")])
        ])
        await fixture.settle()
        #expect(changes.withLock { $0 } == 1)
        #expect(store.launcherText == "Reviewing transactions")
        fixture.complete("thread-1")
        await fixture.settle()
        store.reset()
    }

    @Test func retryingAnUnacceptedFirstMessageKeepsItsOriginalWorkspace() async {
        let fixture = AssistantFixture()
        let conversation = AssistantConversation(client: fixture.client)
        conversation.draft = "Hello"
        conversation.send(workspace: .init(workspaceId: "personal", workspaceName: "Personal"))
        await fixture.settle()
        fixture.complete("thread-1", error: URLError(.notConnectedToInternet))
        await fixture.settle()
        conversation.restoreFailedDraft()
        conversation.send(workspace: .init(workspaceId: "family", workspaceName: "Family"))
        await fixture.settle()
        #expect(fixture.requests.count == 2)
        #expect(
            AssistantPrompt.parse(fixture.requests[1].prompt).workspace?.workspaceId == "personal")
        fixture.complete("thread-1")
        await fixture.settle()
        conversation.reset()
    }

    @Test func attachmentOnlyMessageWaitsForUploadAndIncludesFileMetadata() async throws {
        let fixture = AssistantFixture()
        let conversation = AssistantConversation(client: fixture.client)
        conversation.addAttachment(filename: "receipt.txt") {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            try Data("Coffee $4".utf8).write(to: url)
            return .init(url: url, filename: "receipt.txt", mediaType: "text/plain", size: 9)
        }
        #expect(!conversation.canSend)
        await fixture.settle()
        #expect(conversation.canSend)
        conversation.send(workspace: nil)
        await fixture.settle()
        let request = try #require(fixture.requests.first)
        #expect(request.attachments.first?.filename == "receipt.txt")
        #expect(AssistantPrompt.parse(request.prompt).files.first?.filename == "receipt.txt")
        #expect(conversation.attachments.isEmpty)
        fixture.complete("thread-1")
        await fixture.settle()
        conversation.reset()
    }

    @Test func closingWhileThinkingKeepsTheRunAndToolActivityAlive() async throws {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        store.selected.draft = "Where did my money go?"
        store.selected.send(workspace: nil)
        await fixture.settle()
        #expect(fixture.requests.count == 1)
        let conversation = store.selected
        store.close()
        fixture.stream("thread-1").send([
            AssistantTestData.stream(
                text: "",
                tools: [
                    .init(
                        toolCallId: "tool", toolName: "kualia_list_transactions", state: "running")
                ])
        ])
        await fixture.settle()
        #expect(!store.isPresented)
        #expect(conversation.isWorking)
        #expect(store.launcherText == "Reviewing transactions")
        store.present()
        #expect(store.selected === conversation)
        fixture.complete("thread-1")
        await fixture.settle()
        store.reset()
    }

    @Test func switchingChatsDoesNotMoveAnInflightReplyOrOverwriteADraft() async throws {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.workspace = .init(workspaceId: "personal", workspaceName: "Personal")
        store.present()
        let first = store.selected
        first.draft = "First question"
        first.send(workspace: store.workspace)
        await fixture.settle()
        store.newChat()
        let second = store.selected
        second.draft = "Keep this draft"
        fixture.page("thread-1").send(
            .init(
                page: [try AssistantTestData.message("a1", order: 1, text: "First answer")],
                continueCursor: nil, isDone: true))
        fixture.complete("thread-1")
        await fixture.settle()
        #expect(first.rows.last?.text == "First answer")
        #expect(first.hasUnreadReply)
        #expect(second.rows.isEmpty)
        #expect(second.draft == "Keep this draft")
        #expect(store.launcherText == "Your answer is ready")
        #expect(
            AssistantPrompt.parse(fixture.requests[0].prompt).workspace?.workspaceId == "personal")
        store.reset()
    }

    @Test func finalStreamTextSurvivesTheGapBeforeTheCommittedMessageArrives() async throws {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        store.selected.draft = "Hello"
        store.selected.send(workspace: nil)
        await fixture.settle()
        let user = try AssistantTestData.message("user", order: 1, role: "user", text: "Hello")
        fixture.page("thread-1").send(.init(page: [user], continueCursor: nil, isDone: true))
        fixture.stream("thread-1").send([AssistantTestData.stream(text: "Here's your answer")])
        await fixture.settle()
        #expect(store.selected.pending == nil)
        #expect(store.selected.rows.last?.text == "Here's your answer")
        fixture.stream("thread-1").send([])
        fixture.complete("thread-1")
        await fixture.settle()
        #expect(store.selected.rows.last?.text == "Here's your answer")
        let final = try AssistantTestData.message("final", order: 1, text: "Here's your answer.")
        fixture.page("thread-1").send(
            .init(page: [final, user], continueCursor: nil, isDone: true))
        await fixture.settle()
        #expect(store.selected.rows.filter { !$0.isUser }.count == 1)
        #expect(store.selected.rows.last?.text == "Here's your answer.")
        store.reset()
    }

    @Test func resetRejectsQueuedStreamUpdatesAndLateActionCompletion() async {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.authenticate(userID: "first")
        store.present()
        let old = store.selected
        old.draft = "Private question"
        old.send(workspace: nil)
        await fixture.settle()
        fixture.stream("thread-1").send([AssistantTestData.stream(text: "Private reply")])
        store.authenticate(userID: "second")
        fixture.complete("thread-1")
        await fixture.settle()
        #expect(store.selected !== old)
        #expect(store.selected.rows.isEmpty)
        #expect(old.rows.isEmpty)
        #expect(!old.isWorking)
        #expect(!store.isPresented)
        #expect(store.threads.all.isEmpty)
    }

    @Test func aLateThreadCreationCannotResurrectASignedOutConversation() async {
        let fixture = AssistantFixture()
        var creation: CheckedContinuation<String, Error>?
        var client = fixture.client
        client.createThread = { _ in try await withCheckedThrowingContinuation { creation = $0 } }
        let store = AssistantStore(client: client)
        store.present()
        let old = store.selected
        old.draft = "Hello"
        old.send(workspace: nil)
        await fixture.settle()
        store.reset()
        creation?.resume(returning: "late-thread")
        await fixture.settle()
        #expect(fixture.requests.isEmpty)
        #expect(old.threadID == nil)
        #expect(store.selected.threadID == nil)
    }

    @Test func failurePreservesThePromptForAnExplicitEditWithoutResendingAutomatically() async {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        store.selected.draft = "Move $20"
        store.selected.send(workspace: nil)
        await fixture.settle()
        fixture.complete("thread-1", error: URLError(.notConnectedToInternet))
        await fixture.settle()
        #expect(store.selected.sendError != nil)
        store.selected.restoreFailedDraft()
        #expect(store.selected.draft == "Move $20")
        #expect(fixture.requests.count == 1)
        store.reset()
    }

    @Test func failedAttachmentBlocksSendInsteadOfSilentlyDroppingTheFile() async {
        let fixture = AssistantFixture()
        let conversation = AssistantConversation(client: fixture.client)
        conversation.draft = "Read this"
        conversation.addAttachment(filename: "statement.csv") { throw URLError(.cannotOpenFile) }
        #expect(!conversation.canSend)
        await fixture.settle()
        #expect(!conversation.canSend)
        #expect(conversation.attachments.count == 1)
        if let id = conversation.attachments.first?.id { conversation.removeAttachment(id) }
        #expect(conversation.canSend)
        conversation.reset()
    }

    @Test func removingAnAttachmentRejectsLatePreparationAndLimitsTheDraftToFourFiles() async {
        let fixture = AssistantFixture()
        let conversation = AssistantConversation(client: fixture.client)
        for index in 0..<5 {
            conversation.addAttachment(filename: "\(index).csv") {
                try await Task.sleep(for: .seconds(1))
                throw URLError(.cancelled)
            }
        }
        #expect(conversation.attachments.count == 4)
        for attachment in conversation.attachments { conversation.removeAttachment(attachment.id) }
        await fixture.settle()
        #expect(conversation.attachments.isEmpty)
        #expect(fixture.uploadCount == 0)
    }

    @Test func newChatIsAvailableWhileTheFirstMessageCreatesAThread() {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.selected.draft = "Hello"
        store.selected.send(workspace: nil)
        #expect(store.selected.threadID == nil)
        #expect(store.canStartNewChat)
        store.newChat()
        #expect(!store.canStartNewChat)
        store.reset()
    }

    @Test func newChatRestoresAnExistingUnsentDraft() {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        let first = store.selected
        #expect(!store.canStartNewChat)
        first.draft = "Unsent question"
        #expect(!store.canStartNewChat)
        store.open(.init(threadId: "old", title: "Old chat", lastUpdatedAt: 1, unread: false))
        #expect(store.canStartNewChat)
        store.newChat()
        #expect(!store.canStartNewChat)
        #expect(store.selected === first)
        #expect(store.selected.draft == "Unsent question")
        store.reset()
    }

    @Test func paginatedHistoryDeduplicatesOverlappingRowsAndRetainsTheOldestCursor() async throws {
        let fixture = AssistantFixture()
        let store = AssistantStore(client: fixture.client)
        store.present()
        store.open(.init(threadId: "old", title: "Old chat", lastUpdatedAt: 1, unread: false))
        let newer = try AssistantTestData.message("newer", order: 3, role: "user", text: "Newer")
        let older = try AssistantTestData.message("older", order: 1, role: "user", text: "Older")
        fixture.page("old").send(.init(page: [newer], continueCursor: "older", isDone: false))
        await fixture.settle()
        store.selected.loadOlder()
        fixture.page("old", cursor: "older").send(
            .init(page: [newer, older], continueCursor: nil, isDone: true))
        await fixture.settle()
        #expect(store.selected.rows.map(\.text) == ["Older", "Newer"])
        #expect(!store.selected.hasMore)
        fixture.page("old").send(.init(page: [newer], continueCursor: "older", isDone: false))
        await fixture.settle()
        #expect(!store.selected.hasMore)
        store.reset()
    }

    @Test func usageLimitAndDoubleSendDoNotDispatchAdditionalRequests() async {
        let fixture = AssistantFixture()
        let conversation = AssistantConversation(client: fixture.client)
        conversation.draft = "Hello"
        conversation.send(workspace: nil, limitReached: true)
        #expect(!conversation.isSending)
        #expect(conversation.draft == "Hello")
        conversation.send(workspace: nil)
        conversation.draft = "Again"
        conversation.send(workspace: nil)
        await fixture.settle()
        #expect(fixture.requests.count == 1)
        #expect(conversation.draft == "Again")
        fixture.complete("thread-1")
        await fixture.settle()
        conversation.reset()
    }

    @Test func reconnectRetainsMessagesAndReestablishesAFailedSubscription() async throws {
        let fixture = AssistantFixture()
        let conversation = AssistantConversation(client: fixture.client, threadID: "old")
        conversation.setVisible(true)
        let answer = try AssistantTestData.message("answer", order: 1, text: "Saved answer")
        fixture.page("old").send(.init(page: [answer], continueCursor: nil, isDone: true))
        await fixture.settle()
        fixture.page("old").send(completion: .failure(URLError(.networkConnectionLost)))
        await fixture.settle()
        #expect(conversation.loadError != nil)
        #expect(conversation.rows.last?.text == "Saved answer")
        fixture.replacePage("old", with: .init(page: [answer], continueCursor: nil, isDone: true))
        conversation.reconnect()
        await fixture.settle()
        #expect(conversation.loadError == nil)
        #expect(conversation.rows.last?.text == "Saved answer")
        conversation.reset()
    }
}

private enum AssistantTestData {
    static func message(
        _ id: String, order: Int, step: Int = 0, role: String = "assistant", text: String
    ) throws -> AssistantMessage {
        struct Payload: Encodable {
            struct Body: Encodable {
                let role: String
                let content: String
            }
            let _id: String
            let order: Int
            let stepOrder: Int
            let message: Body
        }
        return try JSONDecoder().decode(
            AssistantMessage.self,
            from: JSONEncoder().encode(
                Payload(
                    _id: id, order: order, stepOrder: step,
                    message: .init(role: role, content: text))))
    }

    static func stream(text: String, order: Int = 1, tools: [AssistantTool] = []) -> AssistantStream
    {
        .init(
            streamId: "stream", order: order, stepOrder: 0, status: "streaming", text: text,
            toolCalls: tools)
    }

    static func tool(_ name: String) -> AssistantTool {
        .init(toolCallId: "tool", toolName: name, state: "running")
    }
}

@MainActor
private final class AssistantFixture {
    var requests: [AssistantSendRequest] = []
    var historyWorkspaceIDs: [String?] = []
    var uploadCount = 0
    private var nextThread = 0
    private var pages: [String: CurrentValueSubject<AssistantMessagePage, Error>] = [:]
    private var streams: [String: CurrentValueSubject<[AssistantStream], Error>] = [:]
    private var sends: [String: CheckedContinuation<Void, Error>] = [:]
    let threads = CurrentValueSubject<AssistantThreadList, Error>(.init())

    var client: AssistantClient {
        .init(
            threads: { workspaceID in
                self.historyWorkspaceIDs.append(workspaceID)
                return self.threads.eraseToAnyPublisher()
            },
            messages: { self.page($0, cursor: $1).eraseToAnyPublisher() },
            streams: { self.stream($0).eraseToAnyPublisher() },
            usage: {
                Just(AssistantUsage(limitReached: false)).setFailureType(to: Error.self)
                    .eraseToAnyPublisher()
            },
            createThread: { _ in
                self.nextThread += 1
                return "thread-\(self.nextThread)"
            },
            send: { request in
                self.requests.append(request)
                try await withCheckedThrowingContinuation { self.sends[request.threadID] = $0 }
            },
            stop: { self.stream($0).send([]) },
            markRead: { _ in },
            upload: { file in
                self.uploadCount += 1
                return .init(storageId: "file", mediaType: file.mediaType, filename: file.filename)
            })
    }

    func page(_ thread: String, cursor: String? = nil) -> CurrentValueSubject<
        AssistantMessagePage, Error
    > {
        let key = thread + (cursor ?? "first")
        if let page = pages[key] { return page }
        let page = CurrentValueSubject<AssistantMessagePage, Error>(
            .init(page: [], continueCursor: nil, isDone: true))
        pages[key] = page
        return page
    }

    func replacePage(_ thread: String, with page: AssistantMessagePage) {
        pages[thread + "first"] = CurrentValueSubject(page)
    }

    func stream(_ thread: String) -> CurrentValueSubject<[AssistantStream], Error> {
        if let stream = streams[thread] { return stream }
        let stream = CurrentValueSubject<[AssistantStream], Error>([])
        streams[thread] = stream
        return stream
    }

    func complete(_ thread: String, error: Error? = nil) {
        if let error {
            sends.removeValue(forKey: thread)?.resume(throwing: error)
        } else {
            sends.removeValue(forKey: thread)?.resume()
        }
    }

    func settle() async { try? await Task.sleep(for: .milliseconds(140)) }
}
