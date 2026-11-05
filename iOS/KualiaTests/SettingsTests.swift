import Foundation
import SwiftUI
import Testing

@testable import Kualia

#if canImport(UIKit)
    import UIKit
#endif

@MainActor
struct SettingsTests {
    #if canImport(UIKit)
        @Test func enabledSwitchTrackContrastsWithItsWhiteThumbInBothAppearances() throws {
            for style in [UIUserInterfaceStyle.light, .dark] {
                let color = UIColor(KualiaPalette.toggleOn)
                    .resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
                var red: CGFloat = 0
                var green: CGFloat = 0
                var blue: CGFloat = 0
                var alpha: CGFloat = 0
                #expect(color.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
                func linear(_ value: CGFloat) -> Double {
                    let value = Double(value)
                    return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
                }
                let luminance =
                    0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
                #expect(1.05 / (luminance + 0.05) >= 3)
                #expect(alpha == 1)
            }
        }

        @Test func appearanceCardsStaySquareAndFitInOneRow() {
            for pageWidth: CGFloat in [320, 375, 390, 430] {
                let rowWidth = pageWidth - 44
                let cardWidth = (rowWidth - 20) / 3
                for typeSize in [DynamicTypeSize.large, .accessibility3] {
                    let cards = HStack(spacing: 10) {
                        ForEach([SettingsAppearance.light, .dark, .system]) { option in
                            SettingsAppearanceCard(option: option, isSelected: option == .system)
                        }
                    }
                    .environment(\.dynamicTypeSize, typeSize)
                    let row = UIHostingController(rootView: cards)
                    let size = row.sizeThatFits(in: CGSize(width: rowWidth, height: 1_000))
                    #expect(abs(size.width - rowWidth) < 0.5)
                    #expect(abs(size.height - cardWidth) < 0.5)
                }
            }
        }
        @Test(arguments: [false, true], [false, true])
        func budgetLayoutPreviewFitsSettingsAtAccessibilitySizes(
            isCompact: Bool, showsProgress: Bool
        ) {
            for width: CGFloat in [320, 375, 390, 430] {
                for typeSize in [DynamicTypeSize.large, .accessibility3] {
                    let controller = UIHostingController(
                        rootView: SettingsBudgetLayoutPreview(
                            isCompact: isCompact, showsProgress: showsProgress
                        )
                        .environment(\.dynamicTypeSize, typeSize)
                        .environment(\.locale, Locale(identifier: "en_US")))
                    let size = controller.sizeThatFits(in: CGSize(width: width, height: 2_000))
                    #expect(size.width <= width + 0.5)
                    #expect(size.height >= 100)
                    #expect(size.height < 1_000)
                }
            }
        }
    #endif

    @Test func compactBudgetDefaultsOffAndPersistsIndependentlyOfDetails() throws {
        #expect(!SettingsBudgetAppearance.defaultUsesCompactLayout)
        #expect(SettingsBudgetAppearance.defaultShowsCategoryProgress)
        #expect(SettingsBudgetAppearance.defaultShowsCategoryStatus)
        let suiteName = "compact-budget-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(false, forKey: SettingsBudgetAppearance.showsCategoryProgressKey)
        defaults.set(true, forKey: SettingsBudgetAppearance.showsCategoryStatusKey)
        let preference = AppStorage(
            wrappedValue: SettingsBudgetAppearance.defaultUsesCompactLayout,
            SettingsBudgetAppearance.usesCompactLayoutKey, store: defaults)
        #expect(!preference.wrappedValue)
        preference.wrappedValue = true
        let reopened = AppStorage(
            wrappedValue: SettingsBudgetAppearance.defaultUsesCompactLayout,
            SettingsBudgetAppearance.usesCompactLayoutKey, store: defaults)
        #expect(reopened.wrappedValue)
        reopened.wrappedValue = false
        #expect(!defaults.bool(forKey: SettingsBudgetAppearance.usesCompactLayoutKey))
        #expect(!defaults.bool(forKey: SettingsBudgetAppearance.showsCategoryProgressKey))
        #expect(defaults.bool(forKey: SettingsBudgetAppearance.showsCategoryStatusKey))
    }

    @Test(arguments: [
        SettingsBudgetAppearance.showsCategoryProgressKey,
        SettingsBudgetAppearance.showsCategoryStatusKey,
    ])
    func budgetDetailPreferencesDefaultOnAndRememberExplicitOff(key: String) throws {
        let suiteName = "budget-details-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let preference = AppStorage(wrappedValue: true, key, store: defaults)
        #expect(preference.wrappedValue)
        preference.wrappedValue = false
        let reopened = AppStorage(wrappedValue: true, key, store: defaults)
        #expect(!reopened.wrappedValue)
        reopened.wrappedValue = true
        #expect(defaults.bool(forKey: key))
    }

    @Test func cachedAvatarDrawsThePhotoOnTheFirstFrameAfterRemounting() throws {
        let url = try #require(URL(string: "https://example.com/avatar.png"))
        let cache = SettingsAvatarImageCache()
        let context = try #require(
            CGContext(
                data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        cache.insert(Image(decorative: try #require(context.makeImage()), scale: 1), for: url)
        for _ in 0..<3 {
            let renderer = ImageRenderer(
                content: SettingsRemoteAvatar(url: url, cache: cache) { Color.blue }
                    .frame(width: 30, height: 30))
            let bitmap = try #require(renderer.cgImage)
            var pixel = [UInt8](repeating: 0, count: 4)
            try pixel.withUnsafeMutableBytes { buffer in
                let sample = try #require(
                    CGContext(
                        data: buffer.baseAddress, width: 1, height: 1,
                        bitsPerComponent: 8, bytesPerRow: 4,
                        space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                sample.draw(bitmap, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            }
            #expect(pixel[0] > 240)
            #expect(pixel[2] < 20)
            #expect(pixel[3] == 255)
        }
    }

    @Test func avatarPhotoChangesInvalidateCachedPhotosAndDifferentURLsStaySeparate() throws {
        let cache = SettingsAvatarImageCache()
        let original = try #require(URL(string: "https://example.com/original.png"))
        let replacement = try #require(URL(string: "https://example.com/replacement.png"))
        cache.insert(Image(systemName: "person"), for: original)
        #expect(cache.image(for: original) != nil)
        #expect(cache.image(for: replacement) == nil)
        cache.removeAll()
        #expect(cache.image(for: original) == nil)
        cache.insert(Image(systemName: "person.crop.circle"), for: replacement)
        #expect(cache.image(for: replacement) != nil)
        #expect(cache.image(for: original) == nil)
    }

    @Test func initialsHandleWhitespaceAndMultipleNames() {
        #expect(SettingsPickerOptions.initials("  Igor   Amidzic ") == "IA")
        #expect(SettingsPickerOptions.initials("Igor") == "I")
        #expect(SettingsPickerOptions.initials("  ") == "")
        #expect(SettingsPickerOptions.initials("Ana María Smith") == "AM")
    }

    @Test func popularPickerOptionsAreUniqueAndValid() {
        let currencies = SettingsPickerOptions.popularCurrencies
        #expect(Set(currencies).count == currencies.count)
        #expect(currencies.allSatisfy { Locale.commonISOCurrencyCodes.contains($0) })
        #expect(currencies.allSatisfy { !SettingsPickerOptions.currencySymbol($0).isEmpty })
        let zones = SettingsPickerOptions.popularTimezones
        #expect(Set(zones).count == zones.count)
        #expect(zones.allSatisfy { TimeZone(identifier: $0) != nil })
    }

    @Test func defaultAccountDecodesResolvedLogo() throws {
        let account = try JSONDecoder().decode(
            SettingsDefaultAccount.self,
            from: Data(
                #"{"_id":"a","name":"Bank","accountType":"banking_checking","resolvedLogoUrl":"https://example.com/logo.png"}"#
                    .utf8))
        #expect(account.resolvedLogoUrl == "https://example.com/logo.png")
        #expect(account.isEligible)
    }

    #if canImport(UIKit)
        @Test func cropPanTracksViewportPointsAtEveryZoom() {
            for zoom: CGFloat in [1, 2, 4] {
                let content = CGSize(width: 400 * zoom, height: 200 * zoom)
                let viewport = CGSize(width: 200, height: 200)
                let start = CGPoint(x: (content.width - 200) / 2, y: (content.height - 200) / 2)
                let before = SettingsProfilePhoto.viewportOffset(
                    contentSize: content,
                    viewportSize: viewport, contentOffset: start)
                let after = SettingsProfilePhoto.viewportOffset(
                    contentSize: content,
                    viewportSize: viewport, contentOffset: CGPoint(x: start.x - 20, y: start.y))
                #expect(after.width - before.width == 20)
                #expect(after.height == before.height)
            }
        }

        @Test func cropScrollViewPreservesZoomAndPanDuringLayout() {
            let image = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 200)).image { _ in
            }
            let view = SettingsPhotoScrollView(image: image, onChange: { _, _ in })
            view.frame = CGRect(x: 0, y: 0, width: 200, height: 200)
            view.layoutIfNeeded()
            view.setZoomScale(2, animated: false)
            view.contentOffset = CGPoint(x: 100, y: 50)
            view.setNeedsLayout()
            view.layoutIfNeeded()
            #expect(view.zoomScale == 2)
            #expect(view.contentOffset == CGPoint(x: 100, y: 50))
        }

        @Test func cropClampsEdgesAndProducesSquareImage() throws {
            let image = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 200)).image {
                context in
                UIColor.red.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 400, height: 200))
            }
            let offset = SettingsProfilePhoto.clampedOffset(
                CGSize(width: 500, height: -500),
                imageSize: image.size, side: 200, zoom: 1)
            #expect(offset == CGSize(width: 100, height: 0))
            let data = try #require(
                SettingsProfilePhoto.crop(image, side: 200, zoom: 2, offset: offset))
            let cropped = try #require(UIImage(data: data))
            #expect(cropped.size == CGSize(width: 1024, height: 1024))
        }
    #endif

    @Test func profileWithoutGranularPreferencesUsesBackendDefaults() throws {
        let profile = try JSONDecoder().decode(
            SettingsProfile.self,
            from: Data(
                #"{"name":"  Igor  ","email":"igor@example.com","clerkId":"user_1","notificationsEnabled":false}"#
                    .utf8))
        #expect(profile.displayName == "Igor")
        #expect(profile.notificationPreferences == nil)
        let defaults = profile.notificationPreferences ?? .init()
        #expect(defaults.newTransactionsEnabled)
        #expect(!defaults.remindersEnabled)
        #expect(defaults.frequency == .gentle)
    }

    @Test func unknownReminderFrequencyPreservesOtherPreferences() throws {
        let preferences = try JSONDecoder().decode(
            SettingsNotificationPreferences.self,
            from: Data(
                #"{"newTransactionsEnabled":false,"remindersEnabled":true,"reminderFrequency":"future-mode"}"#
                    .utf8))
        #expect(!preferences.newTransactionsEnabled)
        #expect(preferences.remindersEnabled)
        #expect(preferences.frequency == .gentle)
    }

    @Test(arguments: SettingsReminderFrequency.allCases)
    func reminderSchedulesStayWithinWakingHoursAndMatchTheirDescription(
        frequency: SettingsReminderFrequency
    ) {
        #expect(Set(frequency.hours).count == frequency.hours.count)
        #expect(frequency.hours == frequency.hours.sorted())
        #expect(frequency.hours.allSatisfy { (9...20).contains($0) })
        #expect(frequency.detail.hasPrefix("\(frequency.hours.count) reminders"))
    }

    @Test func trialPayloadDecodesFractionalExpirationAndLabelsTrialEnd() throws {
        let value = try decodeSubscription(
            type: "trial", status: "trialing", active: true, trial: true,
            expiry: "2026-09-20T12:30:00.000Z", store: "RC_BILLING")
        #expect(value.planName == "Kualia trial")
        #expect(value.statusLabel == "Free trial")
        #expect(value.dateLabel == "Trial ends")
        #expect(value.expiration != nil)
        #expect(!value.isApple)
    }

    @Test func canceledPaidAccessDoesNotClaimItWillRenew() throws {
        let value = try decodeSubscription(
            type: "yearly", status: "canceled", active: true, expiry: "2026-10-01T00:00:00Z")
        #expect(value.statusLabel == "Renewal canceled")
        #expect(value.dateLabel == "Access through")
        #expect(value.expiration != nil)
        #expect(value.isApple)
    }

    @Test func expiredCanceledSubscriptionAndExpiredTrialHaveEndedLabels() throws {
        let canceled = try decodeSubscription(type: "monthly", status: "canceled", active: false)
        #expect(canceled.statusLabel == "Expired")
        #expect(canceled.dateLabel == "Access ended")
        let trial = try decodeSubscription(
            type: "trial", status: "expired", active: false, trial: true)
        #expect(trial.statusLabel == "Expired")
        #expect(trial.dateLabel == "Trial ended")
    }

    @Test func billingProblemsAndPausedPlansRemainUnderstandableWithoutAccess() throws {
        let billing = try decodeSubscription(
            type: "monthly", status: "billing_issue", active: false)
        let paused = try decodeSubscription(type: "monthly", status: "paused", active: false)
        #expect(billing.statusLabel == "Payment needs attention")
        #expect(paused.statusLabel == "Paused")
    }

    @Test func lifetimeMembershipNeedsNoExpiration() throws {
        let value = try decodeSubscription(type: "lifetime", status: "active", active: true)
        #expect(value.isLifetime)
        #expect(value.expiration == nil)
        #expect(value.statusLabel == "Lifetime access")
    }

    @Test func invalidExpirationIsNotPresentedAsADate() throws {
        let value = try decodeSubscription(
            type: "monthly", status: "active", active: true, expiry: "not-a-date")
        #expect(value.expiration == nil)
    }

    @Test func familyMembershipDoesNotRequireAnOwnSubscription() throws {
        let access = try JSONDecoder().decode(
            SettingsAppAccess.self,
            from: Data(
                #"{"hasAppAccess":true,"accessSource":"family_owner_subscription","ownSubscription":null,"familyAccess":{"role":"member","owner":{"name":"Alex","email":null},"ownerHasValidSubscription":true}}"#
                    .utf8))
        #expect(access.usesFamilySubscription)
        #expect(access.familyAccess?.owner.displayName == "Alex")
    }

    @Test(arguments: ["own_subscription", "family_owner_subscription"])
    func activeFamilyCoverageTakesPrecedenceOverAnExpiredPersonalMembership(source: String) throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let expired = try decodeSubscription(
            type: "monthly", status: "active", active: true,
            expiry: now.addingTimeInterval(-86_400).ISO8601Format())
        let access = SettingsAppAccess(
            hasAppAccess: true, accessSource: source,
            familyAccess: .init(
                role: "member", owner: .init(name: "Alex", email: nil),
                ownerHasValidSubscription: true),
            ownSubscription: expired)
        let presentation = SettingsMembershipPresentation(
            subscription: expired, access: access, now: now)
        #expect(access.usesFamilySubscription)
        #expect(presentation.status == "Family membership")
        #expect(presentation.tone == .green)
        #expect(presentation.footnote == "Managed by Alex")
        #expect(SettingsMembershipCountdown(subscription: expired, access: access, now: now) == nil)
    }

    @Test(arguments: ["owner", "member"])
    func familyCoverageRequiresAnActiveOwnerAndMemberRole(role: String) {
        for ownerIsActive in [false, true] {
            for hasAccess in [false, true] {
                let access = SettingsAppAccess(
                    hasAppAccess: hasAccess, accessSource: "own_subscription",
                    familyAccess: .init(
                        role: role, owner: .init(name: "Alex", email: nil),
                        ownerHasValidSubscription: ownerIsActive))
                #expect(
                    access.usesFamilySubscription
                        == (hasAccess && ownerIsActive && role == "member"))
            }
        }
    }

    @Test func pausedFamilyCannotBeMistakenForIncludedAccess() throws {
        let access = try JSONDecoder().decode(
            SettingsAppAccess.self,
            from: Data(
                #"{"hasAppAccess":false,"accessSource":null,"ownSubscription":null,"familyAccess":{"role":"member","owner":{"name":null,"email":"owner@example.com"},"ownerHasValidSubscription":false}}"#
                    .utf8))
        #expect(!access.usesFamilySubscription)
        #expect(access.familyAccess?.owner.displayName == "owner@example.com")
    }

    @Test func sharedWorkspaceDecodesReadOnlyPermissionsAndKeepsDefaultAccount() throws {
        let workspace = try JSONDecoder().decode(
            SettingsWorkspace.self,
            from: Data(
                #"{"_id":"workspace_1","name":"Family","currency":"USD","canManage":false,"owner":{"name":"Alex","email":null},"transactionDefaultPendingStatus":true,"transactionDefaultAccountId":"account_1"}"#
                    .utf8))
        #expect(!workspace.canManage)
        #expect(workspace.timezone == nil)
        #expect(workspace.transactionDefaultAccountId == "account_1")
        #expect(workspace.transactionDefaultPendingStatus == true)
    }

    @Test(arguments: ["system", "unexpected", ""])
    func systemAndUnknownAppearanceValuesFollowDevice(value: String) {
        #expect(SettingsAppearance.resolve(value) == .system)
        #expect(SettingsAppearance.resolve(nil) == .system)
        #expect(SettingsAppearance.resolve("dark") == .dark)
        #expect(SettingsAppearance.resolve("light") == .light)
    }

    @Test func supportEmailEncodesVersionWithoutIncludingAccountData() throws {
        let url = try #require(SettingsLinks.supportMail(version: "1.0 (7) & test"))
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.scheme == "mailto")
        #expect(components.path == "support@kualia.com")
        let body = try #require(components.queryItems?.first { $0.name == "body" }?.value)
        #expect(body.hasSuffix("App version: 1.0 (7) & test"))
        #expect(components.queryItems?.count == 2)
    }

    @Test func latestToggleIsVisibleBeforeSaveAndSurvivesOlderFailure() throws {
        var writes = SettingsOptimisticWrites()
        writes.set(.flag(true), for: .notificationsEnabled)
        #expect(writes[.notificationsEnabled] == .flag(true))
        let olderCandidate = writes.next()
        let older = try #require(olderCandidate)
        writes.set(.flag(false), for: .notificationsEnabled)
        #expect(writes[.notificationsEnabled] == .flag(false))
        let didRollback = writes.fail(older)
        #expect(!didRollback)
        writes.observe(.flag(true), for: .notificationsEnabled)
        #expect(writes[.notificationsEnabled] == .flag(false))
        let latestCandidate = writes.next()
        let latest = try #require(latestCandidate)
        #expect(latest.value == .flag(false))
        writes.acknowledge(latest)
        #expect(writes[.notificationsEnabled] == .flag(false))
        #expect(!writes.hasUnsavedChanges)
        writes.observe(.flag(false), for: .notificationsEnabled)
        #expect(writes[.notificationsEnabled] == nil)
    }

    @Test func olderSuccessCannotClearNewerIntent() throws {
        var writes = SettingsOptimisticWrites()
        writes.set(.flag(true), for: .remindersEnabled)
        let firstCandidate = writes.next()
        let first = try #require(firstCandidate)
        writes.set(.flag(false), for: .remindersEnabled)
        writes.acknowledge(first)
        #expect(writes[.remindersEnabled] == .flag(false))
        #expect(writes.hasUnsavedChanges)
        let next = writes.next()
        #expect(next?.value == .flag(false))
    }

    @Test func liveQueryBeforeAcknowledgementStillCommitsWithoutFlicker() throws {
        var writes = SettingsOptimisticWrites()
        writes.set(.text("aggressive"), for: .reminderFrequency)
        let sentCandidate = writes.next()
        let sent = try #require(sentCandidate)
        writes.observe(.text("aggressive"), for: .reminderFrequency)
        #expect(writes[.reminderFrequency] == .text("aggressive"))
        writes.acknowledge(sent)
        #expect(writes.changes.isEmpty)
    }

    @Test func failedCurrentWriteRollsBackOnlyItsOwnSetting() throws {
        var writes = SettingsOptimisticWrites()
        writes.set(.flag(false), for: .newTransactionsEnabled)
        writes.set(.flag(true), for: .remindersEnabled)
        let sentCandidate = writes.next()
        let sent = try #require(sentCandidate)
        let didRollback = writes.fail(sent)
        #expect(didRollback)
        #expect(writes[.newTransactionsEnabled] == nil)
        #expect(writes[.remindersEnabled] == .flag(true))
        let next = writes.next()
        #expect(next?.key == .remindersEnabled)
    }

    @Test func rapidWorkspaceChangesKeepAllLatestFieldsInOneWrite() throws {
        let workspace = try JSONDecoder().decode(
            SettingsWorkspace.self,
            from: Data(
                #"{"_id":"w","name":"Home","currency":"USD","canManage":true,"transactionDefaultPendingStatus":false,"transactionDefaultAccountId":"a"}"#
                    .utf8))
        var writes = SettingsOptimisticWrites()
        var values = SettingsWorkspaceValues(workspace)
        values.pending = true
        writes.set(.workspace(values), for: .workspaceSettings("w"))
        let firstCandidate = writes.next()
        let first = try #require(firstCandidate)
        values.currency = "EUR"
        values.defaultAccountID = nil
        writes.set(.workspace(values), for: .workspaceSettings("w"))
        writes.acknowledge(first)
        let latestCandidate = writes.next()
        guard case .workspace(let latest) = try #require(latestCandidate).value else {
            Issue.record("Expected workspace settings")
            return
        }
        #expect(latest.pending)
        #expect(latest.currency == "EUR")
        #expect(latest.defaultAccountID == nil)
        #expect(latest.name == "Home")
        writes.removeWorkspace("w")
        #expect(writes.changes.isEmpty)
    }

    @Test func workspaceCreationRequiresNameCurrencyAndTimeZone() {
        var draft = SettingsWorkspaceDraft()
        draft.name = "  "
        #expect(!draft.isValid)
        draft.name = "  Our home  "
        draft.currency = "USD"
        draft.timezone = "America/New_York"
        #expect(draft.isValid)
        #expect(draft.trimmedName == "Our home")
        draft.currency = "invalid"
        #expect(!draft.isValid)
        draft.currency = "EUR"
        draft.timezone = "Not/A_Zone"
        #expect(!draft.isValid)
    }

    @Test func closedAndNonTransactionAccountsAreNotOfferedAsDefaults() {
        #expect(
            SettingsDefaultAccount(
                _id: "1", name: "Checking", accountType: "banking_checking", isClosed: nil
            ).isEligible)
        #expect(
            SettingsDefaultAccount(
                _id: "2", name: "Card", accountType: "credit_card", isClosed: false
            )
            .isEligible)
        #expect(
            !SettingsDefaultAccount(
                _id: "3", name: "Closed", accountType: "banking_checking", isClosed: true
            ).isEligible)
        #expect(
            !SettingsDefaultAccount(
                _id: "4", name: "Home", accountType: "asset_property", isClosed: false
            ).isEligible)
    }

    @Test func feedbackPresentationDoesNotRequireALoadedURL() {
        let sheet = SettingsBrowserDestination(feedback: .features)
        guard case .feedback(let destination) = sheet.content else {
            Issue.record("Feedback should load inside its presented sheet")
            return
        }
        #expect(destination == .features)
    }

    #if canImport(UIKit)
        @MainActor @Test func appearanceUpdatesExistingWindowWhenReturningToSystem() {
            let window = UIWindow(frame: .zero)
            let view = AppAppearanceBridge.AppearanceView(style: .dark)
            window.addSubview(view)
            #expect(window.overrideUserInterfaceStyle == .dark)
            view.style = SettingsAppearance.system.interfaceStyle
            view.applyAppearance()
            #expect(window.overrideUserInterfaceStyle == .unspecified)
            view.style = SettingsAppearance.light.interfaceStyle
            view.applyAppearance()
            #expect(window.overrideUserInterfaceStyle == .light)
            view.style = SettingsAppearance.system.interfaceStyle
            view.applyAppearance()
            #expect(window.overrideUserInterfaceStyle == .unspecified)
        }

        @MainActor @Test func appearanceMapsSystemToNoOverride() {
            #expect(SettingsAppearance.system.colorScheme == nil)
            #expect(SettingsAppearance.light.colorScheme == .light)
            #expect(SettingsAppearance.dark.colorScheme == .dark)
        }

        @MainActor @Test func profilePhotoConvertsLargeImagesToUploadableJPEG() throws {
            let image = UIGraphicsImageRenderer(size: CGSize(width: 1600, height: 800)).image {
                context in
                UIColor.blue.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 1600, height: 800))
            }
            let input = try #require(image.pngData())
            let output = try #require(SettingsProfilePhoto.jpeg(from: input))
            let decoded = try #require(UIImage(data: output))
            #expect(max(decoded.size.width, decoded.size.height) <= 1024)
            #expect(abs(decoded.size.width / decoded.size.height - 2) < 0.01)
            #expect(Array(output.prefix(2)) == [0xff, 0xd8])
            #expect(SettingsProfilePhoto.jpeg(from: Data("invalid".utf8)) == nil)
        }
    #endif

    @Test func appAccessCanSupplyMembershipWhenDetailQueryFails() throws {
        let access = try JSONDecoder().decode(
            SettingsAppAccess.self,
            from: Data(
                #"{"hasAppAccess":true,"accessSource":"own_subscription","familyAccess":null,"ownSubscription":{"status":"trialing","subscriptionType":"monthly","periodType":"TRIAL","expiresAt":"2026-09-20T00:00:00Z","isActive":true}}"#
                    .utf8))
        #expect(access.ownSubscription?.isTrial == true)
        #expect(access.ownSubscription?.store == nil)
        var load = SettingsMembershipLoadState()
        load.subscriptionError = "Unavailable"
        load.receivedAccess()
        #expect(load.hasSnapshot)
        #expect(load.error == "Unavailable")
        load.receivedSubscription()
        #expect(load.error == nil)
    }

    @Test func canceledStoreTrialIsRecognizedAfterTrialingStatusChanges() throws {
        let value = try JSONDecoder().decode(
            SettingsSubscription.self,
            from: Data(
                #"{"subscriptionType":"monthly","status":"canceled","isActive":true,"isTrialing":false,"periodType":"TRIAL","expiresAt":"2026-09-20T00:00:00Z","store":"app_store"}"#
                    .utf8))
        let end = try #require(value.expiration)
        #expect(value.isTrial)
        #expect(value.statusLabel(at: end.addingTimeInterval(-1)) == "Trial canceled")
        #expect(value.statusLabel(at: end) == "Trial ended")
        #expect(value.dateLabel(at: end) == "Trial ended")
    }

    @Test func membershipRefreshPreservesSnapshotAndTracksErrorsIndependently() {
        var load = SettingsMembershipLoadState()
        load.receivedSubscription()
        load.receivedAccess()
        load.beginRefresh()
        #expect(load.hasSnapshot)
        load.accessError = "Family unavailable"
        load.receivedSubscription()
        #expect(load.error == "Family unavailable")
        load.receivedAccess()
        load.timedOut()
        #expect(load.error == nil)
        load.beginRefresh()
        load.receivedAccess()
        load.timedOut()
        #expect(load.subscriptionError != nil)
        #expect(load.accessError == nil)
        load.receivedSubscription()
        #expect(load.error == nil)
        #expect(SettingsMembershipLoadState().hasSnapshot == false)
    }

    @Test func trialCancellationAndExpiryAreDifferentStates() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let canceled = try #require(
            MembershipFixture.trialCanceled.subscription(now: now))
        let current = SettingsMembershipPresentation(
            subscription: canceled, access: nil, now: now)
        #expect(current.status == "Trial canceled")
        #expect(current.message.contains("Renewal is off"))
        #expect(current.tone == .gold)
        let later = SettingsMembershipPresentation(
            subscription: canceled, access: nil, now: now.addingTimeInterval(13 * 86_400))
        #expect(later.status == "Trial ended")
    }

    @Test func trialUrgencyUsesTimeRemainingAndNeverShowsZeroDaysOfAccess() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let trial = MembershipFixture.trialEnding.subscription(now: now)
        let current = SettingsMembershipPresentation(subscription: trial, access: nil, now: now)
        #expect(current.message.hasPrefix("2 days"))
        #expect(current.tone == .gold)
        let lastDay = SettingsMembershipPresentation(
            subscription: trial, access: nil, now: now.addingTimeInterval(86_401))
        #expect(lastDay.message.hasPrefix("Less than a day"))
        let end = SettingsMembershipPresentation(
            subscription: trial, access: nil, now: now.addingTimeInterval(2 * 86_400))
        #expect(end.status == "Trial ended")
    }

    @Test(arguments: MembershipFixture.allCases)
    func membershipStatesProduceDistinctUsableDetails(
        scenario: MembershipFixture
    ) {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let presentation = SettingsMembershipPresentation(
            subscription: scenario.subscription(now: now), access: scenario.access, now: now)
        #expect(!presentation.title.isEmpty)
        #expect(!presentation.status.isEmpty)
        #expect(!presentation.footnote.isEmpty)
        if scenario == .monthly { #expect(presentation.status == "Monthly membership") }
        if scenario == .yearly { #expect(presentation.status == "Yearly membership") }
        if scenario == .family { #expect(presentation.status == "Family membership") }
        if scenario == .lifetime {
            #expect(presentation.footnote.contains("No renewal"))
            #expect(presentation.tone == .green)
        }
        if scenario == .billing { #expect(presentation.tone == .rose) }
    }

    @Test func trialProgressUsesActualDatesAndCancellationKeepsCountdown() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let trial = MembershipFixture.trialEnding.subscription(now: now)
        let countdown = try #require(
            SettingsMembershipCountdown(subscription: trial, access: nil, now: now))
        #expect(countdown.remaining == "2 days")
        #expect(countdown.label == "Trial remaining")
        #expect(abs((countdown.trialFractionRemaining ?? 0) - 2.0 / 14) < 0.001)
        let canceled = MembershipFixture.trialCanceled.subscription(now: now)
        #expect(
            SettingsMembershipCountdown(subscription: canceled, access: nil, now: now)?.label
                == "Trial remaining")
        #expect(
            SettingsMembershipCountdown(
                subscription: trial, access: nil, now: now.addingTimeInterval(2 * 86_400))
                == nil)
    }

    @Test func paidCountdownDistinguishesRenewalFromCanceledAndPrepaidAccess() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        for state in [MembershipFixture.monthly, .yearly] {
            let countdown = try #require(
                SettingsMembershipCountdown(
                    subscription: state.subscription(now: now), access: nil, now: now))
            #expect(countdown.label == "Next charge expected in")
            #expect(countdown.remaining == (state == .yearly ? "365 days" : "12 days"))
            #expect(countdown.trialFractionRemaining == nil)
        }
        var canceled = try #require(MembershipFixture.monthly.subscription(now: now))
        canceled.canceledAt = now.ISO8601Format()
        #expect(
            SettingsMembershipCountdown(subscription: canceled, access: nil, now: now)?.label
                == "Access remaining")
        let prepaid = SettingsSubscription(
            subscriptionType: "monthly", status: "active", isActive: true,
            expiresAt: now.addingTimeInterval(86_400).ISO8601Format(), periodType: "PREPAID",
            store: "app_store")
        #expect(
            SettingsMembershipCountdown(subscription: prepaid, access: nil, now: now)?.label
                == "Access remaining")
    }

    @Test func countdownHandlesMissingDatesAndNeverInventsTrialProgress() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var trial = try #require(MembershipFixture.trialEnding.subscription(now: now))
        for start in [nil, "invalid", now.addingTimeInterval(3 * 86_400).ISO8601Format()] {
            trial.purchasedAt = start
            let countdown = try #require(
                SettingsMembershipCountdown(subscription: trial, access: nil, now: now))
            #expect(countdown.trialFractionRemaining == nil)
        }
        let lastHour = SettingsMembershipCountdown(
            subscription: trial, access: nil, now: now.addingTimeInterval(2 * 86_400 - 3600))
        #expect(lastHour?.remaining == "Less than a day")
        for state in [MembershipFixture.lifetime, .billing, .paused, .expired, .none] {
            #expect(
                SettingsMembershipCountdown(
                    subscription: state.subscription(now: now), access: nil, now: now) == nil)
        }
        #expect(
            SettingsMembershipCountdown(
                subscription: trial, access: MembershipFixture.family.access, now: now)
                == nil)
    }

    private func decodeSubscription(
        type: String, status: String, active: Bool, trial: Bool = false, expiry: String? = nil,
        store: String = "APP_STORE"
    ) throws -> SettingsSubscription {
        struct Payload: Encodable {
            let subscriptionType: String
            let status: String
            let isActive: Bool
            let expiresAt: String?
            let isTrialing: Bool
            let store: String
        }
        let data = try JSONEncoder().encode(
            Payload(
                subscriptionType: type, status: status, isActive: active, expiresAt: expiry,
                isTrialing: trial, store: store))
        return try JSONDecoder().decode(SettingsSubscription.self, from: data)
    }
}

enum MembershipFixture: CaseIterable {
    case trial
    case trialEnding
    case trialCanceled
    case monthly
    case yearly
    case canceled
    case expired
    case billing
    case paused
    case lifetime
    case family
    case none

    func subscription(now: Date = .now) -> SettingsSubscription? {
        guard self != .family, self != .none else { return nil }
        let trial = [.trial, .trialEnding, .trialCanceled, .expired].contains(self)
        let days = self == .expired ? -1 : self == .trialEnding ? 2 : self == .yearly ? 365 : 12
        let status =
            self == .billing
            ? "billing_issue"
            : self == .paused
                ? "paused"
                : self == .expired
                    ? "expired"
                    : [.trialCanceled, .canceled].contains(self)
                        ? "canceled" : trial ? "trialing" : "active"
        return SettingsSubscription(
            subscriptionType: self == .lifetime
                ? "lifetime" : trial ? "trial" : self == .yearly ? "yearly" : "monthly",
            status: status,
            isActive: ![.expired, .billing, .paused].contains(self),
            expiresAt: self == .lifetime
                ? nil : now.addingTimeInterval(Double(days) * 86_400).ISO8601Format(),
            isTrialing: trial, periodType: trial ? "TRIAL" : "NORMAL", store: "app_store",
            purchasedAt: now.addingTimeInterval(
                Double(days - (trial ? 14 : self == .yearly ? 365 : 30)) * 86_400
            ).ISO8601Format(),
            canceledAt: [.trialCanceled, .canceled].contains(self) ? now.ISO8601Format() : nil)
    }
    var access: SettingsAppAccess? {
        guard self == .family else { return nil }
        return SettingsAppAccess(
            hasAppAccess: true, accessSource: "family_owner_subscription",
            familyAccess: .init(
                role: "member", owner: .init(name: "Alex", email: nil),
                ownerHasValidSubscription: true))
    }
}
