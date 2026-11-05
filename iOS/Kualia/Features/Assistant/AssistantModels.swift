import Foundation
import Observation

nonisolated struct AssistantWorkspace: Codable, Equatable, Sendable {
    let workspaceId: String
    let workspaceName: String
}

nonisolated struct AssistantAttachment: Codable, Equatable, Sendable {
    let storageId: String
    let mediaType: String
    let filename: String
}

nonisolated struct AssistantFileLabel: Codable, Equatable, Sendable {
    let filename: String
    let mediaType: String
}

nonisolated struct AssistantLocalFile: Sendable {
    let url: URL
    let filename: String
    let mediaType: String
    let size: Int
}

nonisolated struct AssistantDraftAttachment: Identifiable, Equatable, Sendable {
    enum Status: Equatable, Sendable {
        case uploading
        case ready(AssistantAttachment)
        case failed(String)
    }

    let id: UUID
    let filename: String
    var status: Status
}

nonisolated struct AssistantTool: Decodable, Identifiable, Equatable, Sendable {
    let toolCallId: String
    let toolName: String
    let state: String
    var itemCount: Int? = nil

    var id: String { toolCallId }
    // Explicit names from the Kualia, feedback, and docs tool catalogs. Unknown
    // stream bookkeeping must not become a made-up action in the transcript.
    private var action: (present: String, past: String, base: String, subject: String)? {
        let raw = toolName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let name = raw.hasPrefix("kualia_") ? String(raw.dropFirst(7)) : raw
        switch name {
        case "list_workspaces":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("workspaces")
            )
        case "export_workspace_data":
            return (
                L10n.string("Exporting"), L10n.string("Exported"), L10n.string("export"),
                L10n.string("workspace data")
            )
        case "get_account_balances_report", "list_bank_accounts":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("accounts")
            )
        case "get_net_worth_report":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("your net worth")
            )
        case "get_spending_report":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("your spending")
            )
        case "get_envelope_month_status":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("your budget")
            )
        case "set_category_assigned_amount":
            return (
                L10n.string("Updating"), L10n.string("Updated"), L10n.string("update"),
                L10n.string("your budget")
            )
        case "list_transactions":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("transactions")
            )
        case "list_recurring_transactions":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("scheduled transactions")
            )
        case "get_income_summary":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("your income")
            )
        case "get_monthly_summary":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("your monthly summary")
            )
        case "get_category_rollup":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("category spending")
            )
        case "create_bank_account":
            return (
                L10n.string("Adding"), L10n.string("Added"), L10n.string("add"),
                L10n.string("accounts")
            )
        case "close_bank_account":
            return (
                L10n.string("Closing"), L10n.string("Closed"), L10n.string("close"),
                L10n.string("accounts")
            )
        case "delete_bank_account":
            return (
                L10n.string("Deleting"), L10n.string("Deleted"), L10n.string("delete"),
                L10n.string("accounts")
            )
        case "reconcile_bank_account":
            return (
                L10n.string("Reconciling"), L10n.string("Reconciled"), L10n.string("reconcile"),
                L10n.string("accounts")
            )
        case "create_transactions":
            return (
                L10n.string("Adding"), L10n.string("Added"), L10n.string("add"),
                L10n.string("transactions")
            )
        case "update_transactions":
            return (
                L10n.string("Updating"), L10n.string("Updated"), L10n.string("update"),
                L10n.string("transactions")
            )
        case "delete_transactions":
            return (
                L10n.string("Deleting"), L10n.string("Deleted"), L10n.string("delete"),
                L10n.string("transactions")
            )
        case "restore_transactions":
            return (
                L10n.string("Restoring"), L10n.string("Restored"), L10n.string("restore"),
                L10n.string("transactions")
            )
        case "create_categories":
            return (
                L10n.string("Adding"), L10n.string("Added"), L10n.string("add"),
                L10n.string("categories")
            )
        case "update_categories":
            return (
                L10n.string("Updating"), L10n.string("Updated"), L10n.string("update"),
                L10n.string("categories")
            )
        case "archive_categories":
            return (
                L10n.string("Archiving"), L10n.string("Archived"), L10n.string("archive"),
                L10n.string("categories")
            )
        case "delete_categories":
            return (
                L10n.string("Deleting"), L10n.string("Deleted"), L10n.string("delete"),
                L10n.string("categories")
            )
        case "reorder_categories", "sort_categories":
            return (
                L10n.string("Organizing"), L10n.string("Organized"), L10n.string("organize"),
                L10n.string("categories")
            )
        case "list_category_groups":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("category groups")
            )
        case "create_category_groups":
            return (
                L10n.string("Adding"), L10n.string("Added"), L10n.string("add"),
                L10n.string("category groups")
            )
        case "update_category_groups":
            return (
                L10n.string("Updating"), L10n.string("Updated"), L10n.string("update"),
                L10n.string("category groups")
            )
        case "archive_category_groups":
            return (
                L10n.string("Archiving"), L10n.string("Archived"), L10n.string("archive"),
                L10n.string("category groups")
            )
        case "reorder_category_groups", "sort_category_groups":
            return (
                L10n.string("Organizing"), L10n.string("Organized"), L10n.string("organize"),
                L10n.string("category groups")
            )
        case "list_category_targets":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("category targets")
            )
        case "create_category_target":
            return (
                L10n.string("Adding"), L10n.string("Added"), L10n.string("add"),
                L10n.string("category targets")
            )
        case "update_category_target":
            return (
                L10n.string("Updating"), L10n.string("Updated"), L10n.string("update"),
                L10n.string("category targets")
            )
        case "delete_category_target":
            return (
                L10n.string("Deleting"), L10n.string("Deleted"), L10n.string("delete"),
                L10n.string("category targets")
            )
        case "feedback_list_boards":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("feedback boards")
            )
        case "feedback_list_requests":
            return (
                L10n.string("Reviewing"), L10n.string("Reviewed"), L10n.string("review"),
                L10n.string("feature requests")
            )
        case "feedback_create":
            return (
                L10n.string("Submitting"), L10n.string("Submitted"), L10n.string("submit"),
                L10n.string("feedback")
            )
        case "feedback_update":
            return (
                L10n.string("Updating"), L10n.string("Updated"), L10n.string("update"),
                L10n.string("feedback")
            )
        case "feedback_delete":
            return (
                L10n.string("Deleting"), L10n.string("Deleted"), L10n.string("delete"),
                L10n.string("feedback")
            )
        case "feedback_vote":
            return (
                L10n.string("Supporting"), L10n.string("Supported"), L10n.string("support"),
                L10n.string("a feature request")
            )
        case "feedback_unvote":
            return (
                L10n.string("Removing"), L10n.string("Removed"), L10n.string("remove"),
                L10n.string("a feature request vote")
            )
        case "search_kualia":
            return (
                L10n.string("Searching"), L10n.string("Searched"), L10n.string("search"),
                L10n.string("documentation")
            )
        case "query_docs_filesystem_kualia":
            return (
                L10n.string("Reading"), L10n.string("Read"), L10n.string("read"),
                L10n.string("documentation")
            )
        case "submit_feedback":
            return (
                L10n.string("Submitting"), L10n.string("Submitted"), L10n.string("submit"),
                L10n.string("documentation feedback")
            )
        default: return nil
        }
    }

    var isUserFacing: Bool { action != nil }
    var activity: String? { action.map { "\($0.present) \($0.subject)" } }

    var summary: String? {
        guard let action else { return nil }
        if state == "error" { return L10n.string("Couldn’t \(action.base) \(action.subject)") }
        return "\(state == "success" ? action.past : action.present) \(action.subject)"
    }

    static func summary(for tools: [Self]) -> String {
        // While working, highlight the current action. Completed actions remain in
        // the disclosure, and failures stay visible even if another tool succeeds.
        let meaningful = tools.filter(\.isUserFacing)
        let active = meaningful.filter { $0.state != "success" }
        let visible = active.isEmpty ? meaningful : active
        if visible.contains(where: { $0.state == "error" }) {
            var summaries: [String] = []
            for summary in visible.compactMap(\.summary) where !summaries.contains(summary) {
                summaries.append(summary)
            }
            return joined(summaries)
        }
        var subjects: [String] = []
        var verbs: [String: [String]] = [:]
        for tool in visible {
            guard let action = tool.action else { continue }
            let verb = tool.state == "success" ? action.past : action.present
            if verbs[action.subject] == nil { subjects.append(action.subject) }
            if !(verbs[action.subject] ?? []).contains(verb) {
                verbs[action.subject, default: []].append(verb)
            }
        }
        return joined(subjects.map { joined(verbs[$0] ?? []) + " " + $0 })
    }

    private static func joined(_ phrases: [String]) -> String {
        guard let first = phrases.first else { return "" }
        let rest = phrases.dropFirst().map { $0.prefix(1).lowercased() + $0.dropFirst() }
        let all = [first] + rest
        guard all.count > 1 else { return first }
        return all.formatted(.list(type: .and).locale(L10n.locale))
    }

}

/// Decode the component's public message contract without exposing context tags or file bodies.
nonisolated struct AssistantMessage: Decodable, Equatable, Sendable {
    let id: String
    let order: Int
    let stepOrder: Int
    let role: String
    let text: String
    let files: [AssistantFileLabel]
    let workspace: AssistantWorkspace?
    let tools: [AssistantTool]
    let status: String

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case order, stepOrder, message, toolCalls, status
    }

    private struct Body: Decodable {
        let role: String
        let content: Content
    }

    private enum Content: Decodable {
        case text(String)
        case parts([Part])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let text = try? container.decode(String.self) {
                self = .text(text)
            } else {
                self = .parts(try container.decode([Part].self))
            }
        }

        var text: String {
            switch self {
            case .text(let text): text
            case .parts(let parts):
                parts.filter { $0.type == "text" || $0.type == "text-delta" }
                    .compactMap(\.text).joined()
            }
        }
    }

    private struct Part: Decodable {
        let type: String
        let text: String?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        order = try container.decode(Int.self, forKey: .order)
        stepOrder = try container.decodeIfPresent(Int.self, forKey: .stepOrder) ?? 0
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? "success"
        tools = try container.decodeIfPresent([AssistantTool].self, forKey: .toolCalls) ?? []
        let body = try container.decodeIfPresent(Body.self, forKey: .message)
        role = body?.role ?? ""
        let content = AssistantPrompt.parse(body?.content.text ?? "")
        text = content.text
        files = content.files
        workspace = content.workspace
    }
}

nonisolated struct AssistantMessagePage: Decodable, Sendable {
    let page: [AssistantMessage]
    let continueCursor: String?
    let isDone: Bool
}

nonisolated struct AssistantStream: Decodable, Equatable, Sendable {
    let streamId: String
    let order: Int
    let stepOrder: Int
    let status: String
    let text: String
    let toolCalls: [AssistantTool]
}

nonisolated struct AssistantThread: Decodable, Identifiable, Equatable, Sendable {
    let threadId: String
    let title: String?
    let lastUpdatedAt: Double
    let unread: Bool
    var workspaceId: String? = nil

    var id: String { threadId }
    var displayTitle: String {
        title?.trimmingCharacters(in: .whitespacesAndNewlines).nonempty ?? L10n.string("New chat")
    }
    var date: Date { Date(timeIntervalSince1970: lastUpdatedAt / 1000) }
}

nonisolated struct AssistantThreadList: Decodable, Equatable, Sendable {
    var active: [AssistantThread] = []
    var archived: [AssistantThread] = []

    var all: [AssistantThread] {
        (active + archived).sorted { $0.lastUpdatedAt > $1.lastUpdatedAt }
    }
}

nonisolated struct AssistantUsage: Decodable, Sendable {
    let limitReached: Bool
}

nonisolated struct AssistantSendRequest: Sendable {
    let threadID: String
    let prompt: String
    let attachments: [AssistantAttachment]
}

nonisolated struct AssistantPrompt: Equatable, Sendable {
    let text: String
    var files: [AssistantFileLabel] = []
    var workspace: AssistantWorkspace? = nil

    static func encode(text: String, files: [AssistantAttachment], workspace: AssistantWorkspace?)
        -> String
    {
        var parts: [String] = []
        if let workspace { parts.append(tag("context", value: workspace)) }
        if !files.isEmpty {
            parts.append(
                tag(
                    "attachments",
                    value: files.map {
                        AssistantFileLabel(filename: $0.filename, mediaType: $0.mediaType)
                    }))
        }
        parts.append(text)
        return parts.joined(separator: "\n\n")
    }

    private static func tag<T: Encodable>(_ name: String, value: T) -> String {
        guard let data = try? JSONEncoder().encode(value),
            let json = String(data: data, encoding: .utf8)
        else { return "" }
        return "<kualia-\(name)>\(json)</kualia-\(name)>"
    }

    static func parse(_ raw: String) -> Self {
        var text = raw
        var workspace: AssistantWorkspace?
        var files: [AssistantFileLabel] = []
        for name in ["context", "attachments"] {
            let opening = "<kualia-\(name)>"
            guard text.hasPrefix(opening), let end = text.range(of: "</kualia-\(name)>") else {
                continue
            }
            let data = Data(text.dropFirst(opening.count)[..<end.lowerBound].utf8)
            if name == "context" {
                workspace = try? JSONDecoder().decode(AssistantWorkspace.self, from: data)
            } else {
                files = (try? JSONDecoder().decode([AssistantFileLabel].self, from: data)) ?? []
            }
            text = String(text[end.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        while let start = text.range(of: "<kualia-attachment-body") {
            guard
                let end = text.range(
                    of: "</kualia-attachment-body>", range: start.upperBound..<text.endIndex)
            else {
                text.removeSubrange(start.lowerBound...)
                break
            }
            text.removeSubrange(start.lowerBound..<end.upperBound)
        }
        return .init(
            text: text.trimmingCharacters(in: .whitespacesAndNewlines), files: files,
            workspace: workspace)
    }
}

nonisolated struct AssistantRow: Identifiable, Equatable, Sendable {
    let id: String
    let order: Int
    let isUser: Bool
    var text: String
    var files: [AssistantFileLabel] = []
    var tools: [AssistantTool] = []
    var isStreaming = false

    static func build(messages: [AssistantMessage], streams: [AssistantStream]) -> [Self] {
        var rows: [String: Self] = [:]
        for message in messages.sorted(by: {
            $0.order == $1.order ? $0.stepOrder < $1.stepOrder : $0.order < $1.order
        }) {
            if message.role == "user" {
                rows[message.id] = .init(
                    id: message.id, order: message.order, isUser: true,
                    text: message.text, files: message.files)
            } else if message.role == "assistant" || !message.tools.isEmpty {
                let id = "assistant-\(message.order)"
                var row = rows[id] ?? .init(id: id, order: message.order, isUser: false, text: "")
                if !message.text.isEmpty { row.text = message.text }
                row.tools = mergeTools(row.tools, message.tools)
                rows[id] = row
            }
        }
        for stream in streams.sorted(by: { $0.stepOrder < $1.stepOrder }) {
            let id = "assistant-\(stream.order)"
            var row = rows[id] ?? .init(id: id, order: stream.order, isUser: false, text: "")
            // A committed final message wins over a delayed stream replay.
            let committed = messages.contains {
                $0.order == stream.order && $0.stepOrder >= stream.stepOrder
                    && $0.role == "assistant" && $0.status == "success" && !$0.text.isEmpty
                    && !stream.text.isEmpty && $0.text.hasPrefix(stream.text)
            }
            if !committed {
                row.text = stream.text
                row.isStreaming = stream.status == "streaming"
                row.tools = mergeTools(row.tools, stream.toolCalls)
            }
            rows[id] = row
        }
        return rows.values.filter { $0.isUser || !$0.text.isEmpty || !$0.tools.isEmpty }
            .sorted { $0.order == $1.order ? ($0.isUser && !$1.isUser) : $0.order < $1.order }
    }

    private static func mergeTools(_ current: [AssistantTool], _ next: [AssistantTool])
        -> [AssistantTool]
    {
        var result = current
        for tool in next {
            if let index = result.firstIndex(where: { $0.id == tool.id }) {
                if tool.state != "running" || result[index].state == "running" {
                    let previous = result[index]
                    result[index] = .init(
                        toolCallId: tool.id,
                        toolName: tool.toolName.isEmpty ? previous.toolName : tool.toolName,
                        state: tool.state, itemCount: tool.itemCount ?? previous.itemCount)
                }
            } else {
                result.append(tool)
            }
        }
        return result.filter(\.isUserFacing)
    }
}

/// Observe interaction flags independently from translation. Only the transform
/// modifiers and scrim read translation; the chat/history never observe each drag sample.
@MainActor @Observable final class AssistantDrawerState {
    private(set) var isPresented = false
    private(set) var isDragging = false
    @ObservationIgnored private var isScrollGesture = false
    private var translation = 0.0

    var blocksChatScrolling: Bool { isPresented || isDragging }

    func progress(width: Double) -> Double {
        guard width > 0 else { return 0 }
        return min(1, max(0, (isPresented ? 1 : 0) + translation / width))
    }

    nonisolated static func dimmingOpacity(progress: Double) -> Double {
        0.16 * min(1, max(0, progress))
    }

    func setPresented(_ presented: Bool) {
        isPresented = presented
        isDragging = false
        isScrollGesture = false
        translation = 0
    }

    func dragChanged(
        startX: Double, translationX: Double, translationY: Double,
        containerWidth: Double = 0, rightToLeft: Bool = false
    ) {
        guard !isScrollGesture else { return }
        if !isDragging {
            // Decide the owner once. A vertical scroll cannot turn into a drawer
            // drag, and a drawer drag keeps its lock when the finger moves vertically.
            let distanceFromLeadingEdge = rightToLeft ? containerWidth - startX : startX
            guard isPresented || distanceFromLeadingEdge < 44,
                abs(translationX) > abs(translationY) * 1.5
            else {
                isScrollGesture = true
                return
            }
            isDragging = true
        }
        translation = rightToLeft ? -translationX : translationX
    }

    func endDrag(predictedTranslation: Double, width: Double, rightToLeft: Bool = false) {
        guard isDragging, width > 0 else {
            cancelDrag()
            return
        }
        let projected =
            (isPresented ? width : 0) + (rightToLeft ? -predictedTranslation : predictedTranslation)
        setPresented(projected > width * 0.35)
    }

    func cancelDrag() {
        setPresented(isPresented)
    }

}

extension String {
    fileprivate nonisolated var nonempty: String? { isEmpty ? nil : self }
}

nonisolated struct AssistantTransactionLink: Identifiable, Equatable, Sendable {
    let url: URL
    let workspaceShortID: String?
    let transactionID: String
    var id: String { url.absoluteString }

    init?(rawValue: String) {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let address = value.lowercased().hasPrefix("app.kualia.com/") ? "https://" + value : value
        guard let url = URL(string: address) else { return nil }
        self.init(url: url)
    }

    init?(url: URL) {
        let parts = url.path.split(separator: "/")
        let alphanumeric = CharacterSet(
            charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        guard url.scheme == "https", url.host?.lowercased() == "app.kualia.com",
            url.user == nil, url.password == nil, url.port == nil
        else { return nil }
        let hasWorkspace = parts.first != "transactions"
        let routeIndex = hasWorkspace ? 1 : 0
        guard
            parts.count == routeIndex + 2
                || (parts.count == routeIndex + 3 && parts.last == "details"),
            parts[routeIndex] == "transactions",
            parts[routeIndex + 1].unicodeScalars.allSatisfy({ alphanumeric.contains($0) })
        else { return nil }
        if hasWorkspace {
            guard parts[0].count == 8,
                parts[0].unicodeScalars.allSatisfy({ alphanumeric.contains($0) })
            else { return nil }
        }
        self.url = url
        workspaceShortID = hasWorkspace ? String(parts[0]) : nil
        transactionID = String(parts[routeIndex + 1])
    }

    func resolveWorkspaceID(accessibleIDs: [String], chatWorkspaceID: String?) throws -> String {
        if let workspaceShortID {
            let matches = accessibleIDs.filter { $0.hasSuffix(workspaceShortID) }
            guard matches.count == 1, let match = matches.first else {
                throw AssistantTransactionError.inaccessibleWorkspace
            }
            return match
        }
        guard let chatWorkspaceID, accessibleIDs.contains(chatWorkspaceID) else {
            throw AssistantTransactionError.missingContext
        }
        return chatWorkspaceID
    }

}

nonisolated enum AssistantResponsePart: Equatable, Sendable {
    case text(String)
    case transaction(AssistantTransactionLink)

    static func parse(_ text: String) -> [Self] {
        let opening = "<transactionLink>"
        let closing = "</transactionLink>"
        var remaining = text[...]
        var parts: [Self] = []
        while let start = remaining.range(of: opening, options: .caseInsensitive) {
            let prefix = String(remaining[..<start.lowerBound])
            if !prefix.isEmpty { parts.append(.text(prefix)) }
            guard
                let end = remaining[start.upperBound...].range(
                    of: closing, options: .caseInsensitive)
            else { return parts }  // A streamed tag is not a link until it is complete.
            let raw = remaining[start.upperBound..<end.lowerBound].trimmingCharacters(
                in: .whitespacesAndNewlines)
            if let link = AssistantTransactionLink(rawValue: raw) {
                parts.append(.transaction(link))
            } else {
                // Strip invalid markup without turning arbitrary model output into an action.
                parts.append(.text(L10n.string("Transaction link unavailable")))
            }
            remaining = remaining[end.upperBound...]
        }
        // Hide an opening tag arriving over multiple deltas without hiding ordinary text.
        if let bracket = remaining.lastIndex(of: "<"),
            opening.lowercased().hasPrefix(remaining[bracket...].lowercased())
        {
            remaining = remaining[..<bracket]
        }
        if !remaining.isEmpty { parts.append(.text(String(remaining))) }
        return parts
    }
}

nonisolated enum AssistantTransactionError: LocalizedError {
    case inaccessibleWorkspace, missingContext
    var errorDescription: String? {
        switch self {
        case .inaccessibleWorkspace:
            L10n.string(
                "This link points to a workspace you no longer have access to, or an outdated workspace link."
            )
        case .missingContext:
            L10n.string(
                "This link has no workspace. Open the chat from its workspace and try again.")
        }
    }
}

nonisolated struct AssistantTextBlock: Identifiable, Sendable {
    let id: Int
    let text: String
    let attributed: AttributedString
    let isCode: Bool
    let isHeading: Bool
    var transaction: AssistantTransactionLink? = nil
}

/// A completed answer is parsed once off the UI executor, then inserted already
/// styled. Streaming text stays in the conversation model until the turn ends.
nonisolated enum AssistantMarkdownRenderer {
    @concurrent static func render(_ text: String) async throws -> [AssistantTextBlock] {
        try Task.checkCancellation()
        var result: [AssistantTextBlock] = []
        for part in AssistantResponsePart.parse(text) {
            try Task.checkCancellation()
            switch part {
            case .text(let text):
                var lines: [String] = []
                var inCode = false
                func flush() throws {
                    guard !lines.isEmpty else { return }
                    try Task.checkCancellation()
                    var text = lines.joined(separator: "\n")
                    let heading = !inCode && text.hasPrefix("#")
                    if heading { text = String(text.drop(while: { $0 == "#" || $0 == " " })) }
                    let attributed: AttributedString
                    if inCode {
                        attributed = AttributedString(text)
                    } else {
                        attributed =
                            (try? AttributedString(
                                markdown: text,
                                options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                            ?? AttributedString(text)
                    }
                    result.append(
                        .init(
                            id: result.count, text: text, attributed: attributed,
                            isCode: inCode, isHeading: heading))
                    lines = []
                }
                for line in text.components(separatedBy: "\n") {
                    if line.hasPrefix("```") {
                        try flush()
                        inCode.toggle()
                    } else if line.isEmpty && !inCode {
                        try flush()
                    } else {
                        lines.append(
                            !inCode && line.hasPrefix("- ") ? "• " + line.dropFirst(2) : line)
                    }
                }
                try flush()
            case .transaction(let link):
                result.append(
                    .init(
                        id: result.count, text: L10n.string("View transaction"),
                        attributed: AttributedString(L10n.string("View transaction")),
                        isCode: false, isHeading: false, transaction: link))
            }
        }
        try Task.checkCancellation()
        return result
    }
}
