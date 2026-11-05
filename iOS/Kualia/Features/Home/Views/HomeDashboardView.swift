import SwiftUI

/// The sample screen deliberately shares every visual and interaction with the live home.
struct HomeDashboardView: View {
    var isActive = true
    var feed: TransactionFeedStore? = nil
    @State private var scenario: HomeDashboardScenario
    @State private var inbox = HomeInboxState()
    @State private var sampleDetail: HomeNotice?

    init(
        isActive: Bool = true, scenario: HomeDashboardScenario = .needsAttention,
        feed: TransactionFeedStore? = nil
    ) {
        self.isActive = isActive
        self.feed = feed
        _scenario = State(initialValue: scenario)
    }

    var body: some View {
        HomeInboxView(
            notices: scenario.notices, day: "preview", inbox: $inbox, isActive: isActive,
            feed: feed,
            onOpen: { sampleDetail = $0 }, onRefresh: {}
        )
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack {
                Text(L10n.string("Sample workspace")).foregroundStyle(KualiaPalette.mutedInk)
                Spacer()
                Menu {
                    ForEach(HomeDashboardScenario.allCases) { scenario in
                        Button(scenario.title) {
                            self.scenario = scenario
                            inbox = HomeInboxState()
                        }
                    }
                } label: {
                    Label(L10n.string("Try a day"), icon: .preferences)
                        .frame(minHeight: 44)
                }
                .accessibilityIdentifier("home.demoScenarios")
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 24)
        }
        .sheet(item: $sampleDetail) { notice in
            NavigationStack {
                VStack(alignment: .leading, spacing: 20) {
                    Text(notice.title).font(.title.bold())
                    Text(notice.message)
                    Text(
                        L10n.string(
                            "This is a sample notice. In your workspace, this action opens the relevant budget, account, or payment."
                        )
                    )
                    .foregroundStyle(KualiaPalette.mutedInk)
                    Spacer()
                }
                .padding(24)
                .background(KualiaPalette.canvas)
                .toolbar { Button(L10n.string("Done")) { sampleDetail = nil } }
            }
            .presentationDetents([.medium])
            .presentationBackground(KualiaPalette.canvas)
        }
    }
}

struct HomeInboxView: View {
    let notices: [HomeNotice]
    let day: String
    @Binding var inbox: HomeInboxState
    var isActive = true
    var isLoading = false
    var canReconcile = true
    var feed: TransactionFeedStore? = nil
    let onOpen: (HomeNotice) -> Void
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var daySelection: PlannedDaySelection?

    private var plans: PlannedStore? { feed?.agenda }

    private var effectiveInbox: HomeInboxState {
        var current = inbox
        current.prepare(day: day)
        if canReconcile { current.reconcile(notices: notices, day: day) }
        return current
    }
    private var motion: Animation? {
        reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.88)
    }
    private var listMotion: Animation? { reduceMotion ? nil : .easeOut(duration: 0.28) }
    private var context: Context { Context(notices: notices, day: day, canReconcile: canReconcile) }
    private struct Context: Equatable {
        let notices: [HomeNotice]
        let day: String
        let canReconcile: Bool
    }

    var body: some View {
        let current = effectiveInbox
        let visible = current.visible(in: notices)
        let hasDismissed = notices.contains { current.isDismissed($0) }
        let contentState = HomeInboxContentState(isLoading: isLoading, visibleCount: visible.count)

        GeometryReader { viewport in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 24) {
                    if let plans {
                        TransactionAgendaCalendar(
                            plans: plans, onSelectDay: { daySelection = .init(id: $0) })
                        PlannedCalendarStatus(plans: plans)
                    } else if feed != nil {
                        ProgressView(L10n.string("Loading calendar…"))
                            .frame(maxWidth: .infinity, minHeight: 420)
                    }
                    switch contentState {
                    case .empty:
                        EmptyView()
                    case .loading:
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .accessibilityIdentifier("home.loading")
                    case .briefing:
                        noticeSection(visible).transition(.opacity)
                    }
                    if hasDismissed && !isLoading {
                        undoDismissalsButton.frame(maxWidth: .infinity)
                    }
                }
                .background(ImmediateScrollTouches())
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 32)
                .frame(width: min(viewport.size.width, 580))
                .frame(width: viewport.size.width)
                .frame(minHeight: viewport.size.height, alignment: .top)
                .animation(listMotion, value: visible.map(\.id))
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.always, axes: .vertical)
            .refreshable {
                plans?.retry()
                onRefresh()
            }
            .modifier(HomeGlowScrollObserver(isEnabled: isActive))
        }
        .foregroundStyle(KualiaPalette.ink)
        .animation(motion, value: isLoading)
        .transaction(value: isLoading) { transaction in
            if isLoading {
                transaction.animation = nil
                transaction.disablesAnimations = true
            }
        }
        .onChange(of: context, initial: true) { _, context in
            inbox.prepare(day: context.day)
            guard context.canReconcile else { return }
            inbox.reconcile(notices: context.notices, day: context.day)
        }
        .modifier(
            PlannedCalendarPresentation(plans: plans, feed: feed, daySelection: $daySelection)
        )
        .accessibilityIdentifier("home.calendar")
    }

    private func noticeSection(_ items: [HomeNotice]) -> some View {
        VStack(spacing: 14) {
            ForEach(items) { notice in
                HomeNoticeCard(notice: notice, onOpen: { onOpen(notice) }) {
                    withAnimation(listMotion) {
                        var updated = effectiveInbox
                        updated.dismiss(notice)
                        inbox = updated
                    }
                }
                .transition(
                    reduceMotion
                        ? .opacity
                        : .asymmetric(
                            insertion: .opacity.combined(with: .offset(y: 10)),
                            removal: .opacity))
            }
        }
    }

    private var undoDismissalsButton: some View {
        Button(L10n.string("Reset"), icon: .undo) {
            withAnimation(motion) {
                var updated = effectiveInbox
                updated.restoreAll()
                inbox = updated
            }
        }
        .labelStyle(.titleAndIcon)
        .font(.subheadline.weight(.medium))
        .foregroundStyle(KualiaPalette.mutedInk)
        .frame(minHeight: 44)
        .buttonStyle(.kualiaHaptic)
        .accessibilityHint(L10n.string("Restore all notices dismissed today"))
        .accessibilityIdentifier("home.undoDismissals")
    }
}

private struct HomeNoticeCard: View {
    let notice: HomeNotice
    let onOpen: () -> Void
    let onDismiss: () -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    private var accent: Color {
        switch notice.kind {
        case .overspent, .balance, .overdue: KualiaPalette.budgetNegative
        case .connection, .unavailable: KualiaPalette.budgetUnderfunded
        case .upcoming, .allocation: KualiaPalette.budgetPositive
        case .review, .category: KualiaPalette.menuOptionAccent
        }
    }
    private var symbol: KualiaIcon {
        switch notice.kind {
        case .overspent: .minusCircle
        case .allocation: .layers
        case .connection: .link
        case .balance: .arrowDownRight
        case .review: .checklist
        case .category: .grid
        case .overdue: .clock
        case .upcoming: .calendarFilled
        case .unavailable: .cloudOff
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                KualiaIconImage(icon: symbol, size: 14).font(.system(size: 14, weight: .semibold))
                    .accessibilityHidden(true)
                Text(notice.eyebrow).font(.caption2.weight(.semibold)).tracking(1.1)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if notice.isDismissible {
                    Button(action: onDismiss) {
                        KualiaIconImage(icon: .close, size: 12).font(
                            .system(size: 12, weight: .medium)
                        )
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityLabel(L10n.string("Dismiss \(notice.title) for today"))
                    .accessibilityIdentifier("home.dismiss.\(notice.id)")
                }
            }
            .foregroundStyle(accent)
            .frame(minHeight: 44)
            .padding(.trailing, -10)

            Text(notice.title)
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 1)
            if let amount = notice.amount {
                Text(amount)
                    .font(.system(.title, design: .rounded, weight: .medium))
                    .monospacedDigit().foregroundStyle(accent)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 5)
            }
            Text(notice.message)
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            Button(action: onOpen) {
                HStack(spacing: 8) {
                    Text(notice.actionTitle)
                    KualiaIconImage(icon: .arrowUpRight, size: 12).font(.caption.weight(.semibold))
                }
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.kualiaHaptic)
            .accessibilityIdentifier("home.open.\(notice.id)")
            .padding(.top, 8)
        }
        .padding(.horizontal, 20).padding(.top, 7).padding(.bottom, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            KualiaPalette.surface.opacity(reduceTransparency ? 1 : 0.88),
            in: RoundedRectangle(cornerRadius: 26)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 26).strokeBorder(
                KualiaPalette.ink.opacity(0.055), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.notice.\(notice.id)")
    }
}

#Preview { HomeDashboardView().background(KualiaPalette.canvas) }
