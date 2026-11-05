import Combine
import ConvexMobile
import CoreTransferable
import Foundation
import ImageIO
import UniformTypeIdentifiers

extension AssistantClient {
    static func live(_ client: ConvexClientWithAuth<String>) -> Self {
        .init(
            threads: { workspaceID in
                client.subscribe(
                    to: "aiChat:listThreads", with: workspaceID.map { ["workspaceId": $0] },
                    yielding: AssistantThreadList.self
                )
                .mapError { $0 as Error }.eraseToAnyPublisher()
            },
            messages: { threadID, cursor in
                let pagination: [String: ConvexEncodable?] = [
                    "numItems": Double(50),
                    "cursor": cursor,
                ]
                return client.subscribe(
                    to: "aiChat:listMessages",
                    with: ["threadId": threadID, "paginationOpts": pagination],
                    yielding: AssistantMessagePage.self
                ).mapError { $0 as Error }.eraseToAnyPublisher()
            },
            streams: { threadID in
                client.subscribe(
                    to: "aiChat:streamMessages", with: ["threadId": threadID],
                    yielding: [AssistantStream].self
                )
                .mapError { $0 as Error }.eraseToAnyPublisher()
            },
            usage: {
                client.subscribe(to: "aiChat:getCurrentUsage", yielding: AssistantUsage.self)
                    .mapError { $0 as Error }.eraseToAnyPublisher()
            },
            createThread: { workspaceID in
                let response: AssistantThreadResponse = try await client.mutation(
                    "aiChat:createThread", with: workspaceID.map { ["workspaceId": $0] })
                return response.threadId
            },
            send: { request in
                let files: [ConvexEncodable?] = request.attachments.map {
                    ["storageId": $0.storageId, "mediaType": $0.mediaType, "filename": $0.filename]
                        as [String: ConvexEncodable?]
                }
                let _: AssistantThreadResponse = try await client.action(
                    "aiChat:sendMessage",
                    with: [
                        "threadId": request.threadID, "prompt": request.prompt,
                        "attachments": files,
                    ])
            },
            stop: { try await client.mutation("aiChat:stopStream", with: ["threadId": $0]) },
            markRead: {
                try await client.mutation("aiChat:markThreadRead", with: ["threadId": $0])
            },
            upload: { file in
                let address: String = try await client.mutation(
                    "storage/chatAttachmentUpload:generateChatAttachmentUploadUrl")
                guard let url = URL(string: address), url.scheme == "https" else {
                    throw AssistantFileError.upload
                }
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.timeoutInterval = 90
                request.setValue(file.mediaType, forHTTPHeaderField: "Content-Type")
                let (data, response) = try await URLSession.shared.upload(
                    for: request, fromFile: file.url)
                guard let response = response as? HTTPURLResponse,
                    (200..<300).contains(response.statusCode)
                else {
                    throw AssistantFileError.upload
                }
                let stored = try JSONDecoder().decode(AssistantStorageResponse.self, from: data)
                try await client.mutation(
                    "storage/chatAttachmentUpload:recordChatAttachment",
                    with: [
                        "storageId": stored.storageId, "filename": file.filename,
                        "mediaType": file.mediaType, "size": Double(file.size),
                    ])
                return .init(
                    storageId: stored.storageId, mediaType: file.mediaType, filename: file.filename)
            })
    }
}

private nonisolated struct AssistantThreadResponse: Decodable { let threadId: String }
private nonisolated struct AssistantStorageResponse: Decodable { let storageId: String }

nonisolated enum AssistantFileError: LocalizedError {
    case tooLarge, textTooLarge, empty, unsupported, unreadable, upload

    var errorDescription: String? {
        switch self {
        case .tooLarge: L10n.string("Choose a file smaller than 10 MB.")
        case .textTooLarge: L10n.string("Text, CSV, and JSON files must be smaller than 256 KB.")
        case .empty: L10n.string("This file is empty. Choose another file.")
        case .unsupported: L10n.string("Choose an image, PDF, text, CSV, or JSON file.")
        case .unreadable:
            L10n.string("Couldn't read this file. Try downloading it to your device first.")
        case .upload: L10n.string("Couldn't upload this file. Remove it and try again.")
        }
    }
}

/// File IO and image decoding run on this actor, never on the UI executor. Images
/// are downsampled before decoding and converted to a model-supported JPEG.
actor AssistantFileLoader {
    static let shared = AssistantFileLoader()

    func prepare(url: URL, temporarySource: Bool = false) throws -> AssistantLocalFile {
        let access = url.startAccessingSecurityScopedResource()
        defer {
            if access { url.stopAccessingSecurityScopedResource() }
            if temporarySource { try? FileManager.default.removeItem(at: url) }
        }
        try Task.checkCancellation()
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0 else { throw AssistantFileError.empty }
        let type = UTType(filenameExtension: url.pathExtension) ?? .data
        let target = FileManager.default.temporaryDirectory.appendingPathComponent(
            "kualia-chat-\(UUID())")
        let filename: String
        let mediaType: String
        if type.conforms(to: .image) {
            guard size <= 50 * 1024 * 1024 else { throw AssistantFileError.tooLarge }
            guard
                let source = CGImageSourceCreateWithURL(
                    url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
                let thumbnail = CGImageSourceCreateThumbnailAtIndex(
                    source, 0,
                    [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 2048,
                        kCGImageSourceShouldCacheImmediately: true,
                    ] as CFDictionary),
                let destination = CGImageDestinationCreateWithURL(
                    target as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
            else { throw AssistantFileError.unreadable }
            CGImageDestinationAddImage(
                destination, thumbnail,
                [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else {
                try? FileManager.default.removeItem(at: target)
                throw AssistantFileError.unreadable
            }
            filename = url.deletingPathExtension().lastPathComponent + ".jpg"
            mediaType = "image/jpeg"
        } else {
            guard type.conforms(to: .pdf) || type.conforms(to: .text) || type.conforms(to: .json)
            else {
                throw AssistantFileError.unsupported
            }
            guard size <= 10 * 1024 * 1024 else { throw AssistantFileError.tooLarge }
            if !type.conforms(to: .pdf), size > 256 * 1024 { throw AssistantFileError.textTooLarge }
            try FileManager.default.copyItem(at: url, to: target)
            filename = url.lastPathComponent
            mediaType = type.preferredMIMEType ?? "text/plain"
        }
        let uploadedSize = (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard uploadedSize > 0, uploadedSize <= 10 * 1024 * 1024 else {
            try? FileManager.default.removeItem(at: target)
            throw AssistantFileError.tooLarge
        }
        return .init(url: target, filename: filename, mediaType: mediaType, size: uploadedSize)
    }
}

nonisolated struct AssistantPickedPhoto: Transferable, Sendable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            let source = received.file
            let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 50 * 1024 * 1024 else { throw AssistantFileError.tooLarge }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(L10n.string("Photo-\(UUID())")).appendingPathExtension(
                    source.pathExtension)
            try FileManager.default.copyItem(at: source, to: url)
            return Self(url: url)
        }
    }
}

// Workspace selection comes from the app's authorized catalog. The editor fetches
// the transaction by its ID even when it isn't in the current feed page.
extension AssistantTransactionLink {
    @MainActor func makeEditor(client: ConvexClientWithAuth<String>, workspaceID: String)
        async throws -> TransactionEditorStore
    {
        let structure = try await TransactionEditorQuery<AssistantLinkedBudget>().read(
            client.subscribe(
                to: "categoryBudgets:listBudgetStructure",
                with: ["workspaceId": workspaceID], yielding: AssistantLinkedBudget.self
            )
            .mapError { $0 as Error }.eraseToAnyPublisher())
        guard let workspace = structure.workspace else {
            throw AssistantTransactionError.inaccessibleWorkspace
        }
        return TransactionEditorStore(
            workspace: workspace, transactionID: transactionID, convexClient: client)
    }
}
private struct AssistantLinkedBudget: Decodable { let workspace: TransactionFeedWorkspace? }
