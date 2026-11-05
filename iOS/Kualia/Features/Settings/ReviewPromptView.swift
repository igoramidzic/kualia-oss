import StoreKit
import SwiftUI

struct ReviewPromptModifier: ViewModifier {
    let store: ReviewPromptStore?
    let milestone: ReviewPromptMilestone?
    let isAvailable: Bool
    @Environment(\.requestReview) private var requestReview
    @Environment(\.openURL) private var openURL
    @State private var showsFounderMessage = false
    @State private var presentedUserID: String?
    @State private var presentationAnchor = UIView(frame: .zero)

    private struct Context: Equatable {
        let userID: String?
        let milestone: ReviewPromptMilestone?
        let isAvailable: Bool
    }

    private var context: Context {
        Context(userID: store?.userID, milestone: milestone, isAvailable: isAvailable)
    }

    func body(content: Content) -> some View {
        content
            .background {
                AppPresentationAnchor(view: presentationAnchor).frame(width: 0, height: 0)
            }
            .sheet(
                isPresented: $showsFounderMessage,
                onDismiss: {
                    guard store?.userID == presentedUserID else { return }
                    store?.recordFounderDismissed()
                    presentedUserID = nil
                }
            ) {
                FounderReviewSheet {
                    guard let store, store.userID == presentedUserID else { return }
                    store.recordReviewLinkTapped()
                    showsFounderMessage = false
                    openURL(ReviewPromptStore.reviewURL)
                }
                .onAppear {
                    guard store?.userID == presentedUserID else { return }
                    store?.recordFounderShown()
                }
            }
            .task(id: context) {
                guard isAvailable, let store, let userID = store.userID, let milestone,
                    !showsFounderMessage
                else { return }
                // Leave room for Home's completion and transaction receipts to settle.
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
                guard !Task.isCancelled, store.userID == userID,
                    let window = presentationAnchor.window, window.isKeyWindow,
                    window.rootViewController?.presentedViewController == nil
                else { return }
                switch store.action(for: milestone) {
                case .founderMessage:
                    presentedUserID = userID
                    showsFounderMessage = true
                case .nativeReview:
                    store.recordNativeRequested()
                    requestReview()
                case nil: break
                }
            }
            .onChange(of: store?.userID) { _, _ in showsFounderMessage = false }
    }
}

/// Check the actual window too, including sheets owned by nested pages.
struct AppPresentationAnchor: UIViewRepresentable {
    let view: UIView
    func makeUIView(context: Context) -> UIView { view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

private struct FounderReviewSheet: View {
    let onLeaveReview: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    KualiaIconImage(icon: .heart, size: 32)
                        .font(.system(size: 32))
                        .foregroundStyle(KualiaPalette.accent)
                        .accessibilityHidden(true)

                    Text(L10n.string("Hey, I’m Igor 👋"))
                        .font(.largeTitle.bold())

                    Text(
                        L10n.string(
                            "I’m the founder of Kualia. Thanks for making it part of your day."))
                    Text(
                        L10n.string(
                            "If you have a moment, I’d really appreciate a review. Your honest feedback helps me make Kualia better and helps more people find it."
                        )
                    )
                    Text(L10n.string("Thanks for being here,\nIgor"))
                        .fontWeight(.medium)

                    VStack(spacing: 12) {
                        Button(action: onLeaveReview) {
                            Text(L10n.string("Leave a review"))
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 52)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(KualiaPalette.canvas)
                        .background(KualiaPalette.ink, in: Capsule())
                        .accessibilityIdentifier("review.leaveReview")

                        Button(L10n.string("Not now")) { dismiss() }
                            .font(.body.weight(.medium))
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .accessibilityIdentifier("review.dismiss")
                    }
                }
                .font(.body)
                .foregroundStyle(KualiaPalette.ink)
                .padding(28)
                .frame(maxWidth: 580)
                .frame(maxWidth: .infinity)
            }
            .background(KualiaPalette.canvas)
            .navigationTitle(L10n.string("A note from me"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}
