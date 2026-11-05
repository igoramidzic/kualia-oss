#if DEBUG
    import UIKit

    enum ScreenshotDemoLogo {
        // A private scheme with an allowlist cannot fetch remote images or read arbitrary files.
        static let names: Set<String> = [
            "chase", "sofi", "americanexpress", "ally", "capitalone",
            "walmart", "starbucks", "target", "wholefoods", "uber", "amazon",
            "netflix", "spotify", "apple", "cvs", "verizon",
        ]
        static func image(_ url: URL) -> UIImage? {
            guard url.scheme == "kualia-demo", url.host == "logo",
                names.contains(url.lastPathComponent)
            else { return nil }
            return UIImage(named: "DemoLogo-\(url.lastPathComponent)")
        }
    }
#endif
