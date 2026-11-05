import ImageIO
import SwiftUI

struct AccountBrandMark: View {
    let logoURL: String?
    let name: String
    let accountType: String
    var size: CGFloat = 48

    @State private var loadedURL: URL?
    @State private var asset: AccountBrandAsset?

    private var url: URL? { AccountBrandCache.logoURL(logoURL) }

    var body: some View {
        Group {
            if loadedURL == url, let asset {
                Image(uiImage: asset.image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .background(.white)
            } else {
                KualiaIconImage(icon: AccountBrandStyle.symbol(for: accountType), size: size * 0.39)
                    .font(.system(size: size * 0.39, weight: .medium))
                    .foregroundStyle(AccountBrandStyle.color(for: accountType))
                    .frame(width: size, height: size)
                    .background(KualiaPalette.surface)
            }
        }
        .clipShape(Circle())
        .overlay {
            Circle()
                .strokeBorder(KualiaPalette.border.opacity(0.4), lineWidth: 0.5)
        }
        .accessibilityLabel(name)
        .task(id: url) {
            let requestedURL = url
            asset = nil
            loadedURL = nil
            guard let requestedURL else { return }
            let result = await AccountBrandCache.shared.load(requestedURL)
            guard !Task.isCancelled, requestedURL == url else { return }
            asset = result
            loadedURL = requestedURL
        }
    }
}

struct AccountBrandHalo: View {
    static let height: CGFloat = 320

    let logoURL: String?
    var primaryColor: String? = nil
    let accountType: String

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme
    @State private var loadedURL: URL?
    @State private var extractedColor: Color?

    private var url: URL? { AccountBrandCache.logoURL(logoURL) }

    private var tint: Color {
        if let supplied = AccountBrandStyle.hexColor(primaryColor) { return supplied }
        if loadedURL == url, let extractedColor { return extractedColor }
        return AccountBrandStyle.color(for: accountType)
    }

    var body: some View {
        GeometryReader { geometry in
            if !reduceTransparency {
                ZStack {
                    Ellipse()
                        .fill(tint.opacity(colorScheme == .dark ? 0.26 : 0.22))
                        .frame(width: geometry.size.width * 0.82, height: 166)
                        .rotationEffect(.degrees(-24))
                        .blur(radius: 48)
                        .position(x: geometry.size.width * 0.39, y: 96)

                    Ellipse()
                        .fill(tint.opacity(colorScheme == .dark ? 0.16 : 0.12))
                        .frame(width: geometry.size.width * 0.62, height: 125)
                        .rotationEffect(.degrees(31))
                        .blur(radius: 38)
                        .position(x: geometry.size.width * 0.8, y: 46)
                }
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .white, location: 0),
                            .init(color: .white, location: 0.4),
                            .init(color: .clear, location: 1),
                        ], startPoint: .top, endPoint: .bottom)
                }
            }
        }
        .frame(height: Self.height)
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task(id: url) {
            let requestedURL = url
            extractedColor = nil
            loadedURL = nil
            guard let requestedURL else { return }
            let result = await AccountBrandCache.shared.load(requestedURL)
            guard !Task.isCancelled, requestedURL == url else { return }
            extractedColor = result?.color
            loadedURL = requestedURL
        }
    }
}

enum AccountBrandStyle {
    static func color(for accountType: String) -> Color {
        if accountType.hasPrefix("credit_") {
            return Color(red: 0.62, green: 0.37, blue: 0.76)
        }
        if accountType.hasPrefix("investment_") {
            return Color(red: 0.21, green: 0.60, blue: 0.46)
        }
        if accountType.hasPrefix("loan_") {
            return Color(red: 0.77, green: 0.45, blue: 0.31)
        }
        switch accountType {
        case "banking_savings", "banking_money_market", "banking_cd":
            return Color(red: 0.18, green: 0.59, blue: 0.62)
        case "banking_cash":
            return Color(red: 0.52, green: 0.56, blue: 0.28)
        default:
            return Color(red: 0.26, green: 0.47, blue: 0.77)
        }
    }

    static func symbol(for accountType: String) -> KualiaIcon {
        if accountType.hasPrefix("credit_") { return .creditCard }
        if accountType.hasPrefix("investment_") { return .chartLine }
        if accountType.hasPrefix("loan_") { return .bank }
        switch accountType {
        case "banking_cash": return .money
        case "banking_savings", "banking_money_market", "banking_cd": return .leaf
        default: return .bank
        }
    }

    static func hexColor(_ string: String?) -> Color? {
        guard let string else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        let hex = trimmed.hasPrefix("#") ? String(trimmed.dropFirst()) : trimmed
        guard hex.count == 3 || hex.count == 6,
            hex.allSatisfy({ $0.isASCII && $0.isHexDigit }),
            let value = UInt32(hex, radix: 16)
        else { return nil }

        if hex.count == 3 {
            return Color(
                red: Double((value >> 8) & 0xF) / 15,
                green: Double((value >> 4) & 0xF) / 15,
                blue: Double(value & 0xF) / 15)
        }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255)
    }
}

@MainActor
private final class AccountBrandAsset {
    let image: UIImage
    let color: Color?

    init(image: UIImage, color: Color?) {
        self.image = image
        self.color = color
    }
}

@MainActor
private final class AccountBrandCache {
    static let shared = AccountBrandCache()

    private let assets = NSCache<NSURL, CacheEntry>()
    private var pending: [URL: Task<AccountBrandAsset?, Never>] = [:]

    nonisolated private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 20
        return URLSession(configuration: configuration)
    }()

    private init() {
        assets.countLimit = 100
        assets.totalCostLimit = 8 * 1_024 * 1_024
    }

    static func logoURL(_ string: String?) -> URL? {
        #if DEBUG
            if let string, let url = URL(string: string), ScreenshotDemoLogo.image(url) != nil {
                return url
            }
        #endif
        guard let string, string.count <= 8_192,
            let url = URL(string: string), url.scheme?.lowercased() == "https",
            url.host != nil
        else { return nil }
        return url
    }

    func load(_ url: URL) async -> AccountBrandAsset? {
        #if DEBUG
            if let image = ScreenshotDemoLogo.image(url) {
                return AccountBrandAsset(
                    image: image, color: image.cgImage.flatMap(Self.dominantColor))
            }
        #endif
        if let cached = assets.object(forKey: url as NSURL), cached.expiresAt > Date() {
            return cached.asset
        }
        if let task = pending[url] { return await task.value }

        // The mark and halo share one request; a disappearing row must not cancel the detail's logo.
        let task = Task {
            guard let data = await Self.fetchLogo(url) else { return AccountBrandAsset?.none }
            return Self.makeAsset(data)
        }
        pending[url] = task
        let result = await task.value
        assets.setObject(
            CacheEntry(asset: result), forKey: url as NSURL,
            cost: result == nil ? 1 : 256 * 256 * 4)
        pending[url] = nil
        return result
    }

    nonisolated private static func fetchLogo(_ url: URL) async -> Data? {
        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            request.httpShouldHandleCookies = false
            let (bytes, response) = try await session.bytes(for: request)
            let maximumBytes = 1_024 * 1_024
            guard let response = response as? HTTPURLResponse,
                (200..<300).contains(response.statusCode),
                response.expectedContentLength <= maximumBytes
            else { return nil }

            var data = Data()
            data.reserveCapacity(64 * 1_024)
            for try await byte in bytes {
                guard data.count < maximumBytes else { return nil }
                data.append(byte)
                if data.count.isMultiple(of: 4_096) { try Task.checkCancellation() }
            }
            return data
        } catch {
            return nil
        }
    }

    private static func makeAsset(_ data: Data) -> AccountBrandAsset? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as NSDictionary?,
            let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
            let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
            width.doubleValue > 0, height.doubleValue > 0,
            width.doubleValue * height.doubleValue <= 16_777_216,
            let thumbnail = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 256,
                    kCGImageSourceShouldCacheImmediately: true,
                ] as CFDictionary)
        else { return nil }
        return AccountBrandAsset(
            image: UIImage(cgImage: thumbnail), color: dominantColor(in: thumbnail))
    }

    private static func dominantColor(in image: CGImage) -> Color? {
        // Ignore the white/transparent canvas and quantize the remaining saturated pixels.
        let dimension = 24
        var pixels = [UInt8](repeating: 0, count: dimension * dimension * 4)
        let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard
                let context = CGContext(
                    data: buffer.baseAddress, width: dimension, height: dimension,
                    bitsPerComponent: 8, bytesPerRow: dimension * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: dimension, height: dimension))
            return true
        }
        guard rendered else { return nil }

        struct Bucket {
            var weight = 0.0
            var red = 0.0
            var green = 0.0
            var blue = 0.0
        }
        var buckets: [Int: Bucket] = [:]
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            let alpha = Double(pixels[offset + 3]) / 255
            guard alpha > 0.5 else { continue }
            let red = min(Double(pixels[offset]) / 255 / alpha, 1)
            let green = min(Double(pixels[offset + 1]) / 255 / alpha, 1)
            let blue = min(Double(pixels[offset + 2]) / 255 / alpha, 1)
            let brightness = max(red, green, blue)
            let chroma = brightness - min(red, green, blue)
            guard brightness > 0.18, chroma > 0.16 else { continue }
            let weight = alpha * chroma
            let key = (Int(red * 7) << 6) + (Int(green * 7) << 3) + Int(blue * 7)
            var bucket = buckets[key] ?? Bucket()
            bucket.weight += weight
            bucket.red += red * weight
            bucket.green += green * weight
            bucket.blue += blue * weight
            buckets[key] = bucket
        }
        guard let dominant = buckets.max(by: { $0.value.weight < $1.value.weight })?.value,
            dominant.weight > 0
        else { return nil }
        return Color(
            red: dominant.red / dominant.weight, green: dominant.green / dominant.weight,
            blue: dominant.blue / dominant.weight)
    }

    private final class CacheEntry {
        let asset: AccountBrandAsset?
        let expiresAt: Date

        init(asset: AccountBrandAsset?) {
            self.asset = asset
            expiresAt = Date().addingTimeInterval(asset == nil ? 60 : 3_600)
        }
    }
}
