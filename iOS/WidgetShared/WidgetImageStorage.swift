//
//  WidgetImageStorage.swift
//  Kualia
//

import Foundation
import os.log

#if canImport(UIKit)
    import UIKit
#endif

nonisolated private let logger = Logger(subsystem: "com.kualia.app", category: "WidgetImageStorage")

nonisolated struct WidgetImageMetadata: Codable {
    let photographer: String?
    let source: String  // "pexels" or "library"
}

nonisolated enum WidgetImageStorage {
    private static let appGroupId = "group.com.kualia.app"
    private static let imageDirectoryName = "widget-backgrounds"

    private static var imageDirectory: URL? {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: appGroupId
            )
        else { return nil }

        let dir = containerURL.appendingPathComponent(imageDirectoryName, isDirectory: true)

        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        return dir
    }

    enum WidgetSize: String {
        case small
        case medium
    }

    private static func imageURL(forCategoryId id: String, size: WidgetSize) -> URL? {
        imageDirectory?.appendingPathComponent("\(id)_\(size.rawValue).jpg")
    }

    // Legacy single-image URL for migration
    private static func legacyImageURL(forCategoryId id: String) -> URL? {
        imageDirectory?.appendingPathComponent("\(id).jpg")
    }

    private static func metadataURL(forCategoryId id: String) -> URL? {
        imageDirectory?.appendingPathComponent("\(id).json")
    }

    // MARK: - Image Operations

    #if canImport(UIKit)
        static func saveImage(_ image: UIImage, forCategoryId id: String, size: WidgetSize) -> Bool
        {
            guard let url = imageURL(forCategoryId: id, size: size) else {
                logger.error("[SAVE] No URL for category \(id) size \(size.rawValue)")
                return false
            }

            // Delete old file first to bust any file cache in the widget process
            if FileManager.default.fileExists(atPath: url.path) {
                try? FileManager.default.removeItem(at: url)
                logger.info("[SAVE] Deleted existing file for category \(id) size \(size.rawValue)")
            }

            logger.info(
                "[SAVE] categoryId=\(id) size=\(size.rawValue) originalSize=\(Int(image.size.width))x\(Int(image.size.height)) orientation=\(image.imageOrientation.rawValue)"
            )

            let resized = resizeImage(image, maxDimension: 600)
            logger.info("[SAVE] resizedSize=\(Int(resized.size.width))x\(Int(resized.size.height))")

            // Try compression qualities until under 500KB
            for quality: CGFloat in [0.7, 0.5, 0.3] {
                guard let data = resized.jpegData(compressionQuality: quality) else {
                    logger.error("[SAVE] jpegData returned nil at quality=\(quality)")
                    continue
                }
                logger.info("[SAVE] quality=\(quality) dataSize=\(data.count) bytes")
                if data.count <= 500_000 || quality == 0.3 {
                    do {
                        try data.write(to: url, options: .atomic)
                        let exists = FileManager.default.fileExists(atPath: url.path)
                        logger.info("[SAVE] Written to \(url.path) exists=\(exists)")
                        return true
                    } catch {
                        logger.error("[SAVE] Write failed: \(error.localizedDescription)")
                        return false
                    }
                }
            }

            logger.error("[SAVE] All compression attempts failed")
            return false
        }

        static func loadImage(forCategoryId id: String, size: WidgetSize) -> UIImage? {
            guard let data = loadImageData(forCategoryId: id, size: size) else { return nil }
            guard let image = UIImage(data: data) else {
                logger.error("[LOAD] UIImage(data:) returned nil for \(id) \(size.rawValue)")
                return nil
            }
            logger.info(
                "[LOAD] \(id) \(size.rawValue) imageSize=\(Int(image.size.width))x\(Int(image.size.height))"
            )
            return image
        }

        static func loadImageData(forCategoryId id: String, size: WidgetSize) -> Data? {
            guard let url = imageURL(forCategoryId: id, size: size) else { return nil }

            // Fall back to legacy single-image file
            let fileURL: URL
            if FileManager.default.fileExists(atPath: url.path) {
                fileURL = url
            } else if let legacy = legacyImageURL(forCategoryId: id),
                FileManager.default.fileExists(atPath: legacy.path)
            {
                fileURL = legacy
            } else {
                return nil
            }

            guard let data = try? Data(contentsOf: fileURL) else {
                logger.error("[LOAD-DATA] Failed to read data for \(id) \(size.rawValue)")
                return nil
            }

            logger.info("[LOAD-DATA] \(id) \(size.rawValue) dataSize=\(data.count) bytes")
            return data
        }

        private static func resizeImage(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
            let size = image.size
            guard max(size.width, size.height) > maxDimension else { return image }

            let ratio: CGFloat
            if size.width > size.height {
                ratio = maxDimension / size.width
            } else {
                ratio = maxDimension / size.height
            }

            let newSize = CGSize(width: size.width * ratio, height: size.height * ratio)

            // Force scale 1.0 so output pixels match the requested dimensions.
            // Default UIGraphicsImageRenderer uses device scale (3x), which would
            // produce an image 3x larger than intended — too large for widgets.
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1.0
            let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
            return renderer.image { _ in
                image.draw(in: CGRect(origin: .zero, size: newSize))
            }
        }
    #endif

    static func deleteImage(forCategoryId id: String) {
        for size in [WidgetSize.small, .medium] {
            if let url = imageURL(forCategoryId: id, size: size) {
                try? FileManager.default.removeItem(at: url)
            }
        }
        // Also remove legacy single file
        if let url = legacyImageURL(forCategoryId: id) {
            try? FileManager.default.removeItem(at: url)
        }
        if let url = metadataURL(forCategoryId: id) {
            try? FileManager.default.removeItem(at: url)
        }
    }

    static func allStoredCategoryIds() -> [String] {
        guard let dir = imageDirectory else { return [] }
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        var ids = Set<String>()
        for file in files where file.hasSuffix(".jpg") {
            var name = String(file.dropLast(4))  // remove .jpg
            // Strip size suffix if present
            for suffix in ["_small", "_medium"] {
                if name.hasSuffix(suffix) {
                    name = String(name.dropLast(suffix.count))
                    break
                }
            }
            ids.insert(name)
        }
        return Array(ids)
    }

    // MARK: - Metadata Operations

    static func saveMetadata(_ metadata: WidgetImageMetadata, forCategoryId id: String) {
        guard let url = metadataURL(forCategoryId: id),
            let data = try? JSONEncoder().encode(metadata)
        else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func loadMetadata(forCategoryId id: String) -> WidgetImageMetadata? {
        guard let url = metadataURL(forCategoryId: id),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(WidgetImageMetadata.self, from: data)
    }
}
