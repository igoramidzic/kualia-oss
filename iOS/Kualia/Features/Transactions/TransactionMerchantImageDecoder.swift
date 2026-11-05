import Foundation
import ImageIO

enum TransactionMerchantImageDecoder {
    // Feed marks are 44pt. Bound decoded memory at 3x resolution
    // instead of keeping each merchant's full-size source bitmap in the cache.
    nonisolated static let maximumPixelSize = 132

    nonisolated static func decode(_ data: Data) async -> CGImage? {
        await Task.detached(priority: .utility) {
            downsample(data)
        }.value
    }

    nonisolated private static func downsample(_ data: Data) -> CGImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return nil
        }
        let options =
            [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
                kCGImageSourceShouldCacheImmediately: true,
            ] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options)
    }
}
