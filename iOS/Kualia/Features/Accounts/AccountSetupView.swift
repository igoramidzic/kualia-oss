import SwiftUI

struct AccountSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let store: AccountsStore
    let targetAccountID: String?
    let onSaved: () -> Void

    @State private var navigation: AccountSetupNavigation
    @State private var connectionStore: AccountConnectionStore?
    @State private var peekHeight: CGFloat = 110

    init(
        store: AccountsStore, connectionStore: AccountConnectionStore? = nil,
        targetAccountID: String? = nil, startsWithConnections: Bool = false,
        onSaved: @escaping () -> Void = {}
    ) {
        self.store = store
        self.targetAccountID = targetAccountID
        self.onSaved = onSaved
        _connectionStore = State(initialValue: connectionStore)
        _navigation = State(
            initialValue: AccountSetupNavigation(
                startsWithConnections: startsWithConnections || targetAccountID != nil))
    }

    private var motion: Animation? {
        reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.86)
    }

    private var showsPeek: Bool {
        connectionStore.map { navigation.showsPeek(during: $0.phase) } ?? false
    }

    private var peekPresentation: AccountConnectionPeekPresentation {
        AccountConnectionPeekPresentation(
            phase: connectionStore?.phase ?? .idle,
            completionName: connectionStore?.completionName,
            connection: connectionStore?.connections.first { $0.id == navigation.bankID },
            isLinkingExisting: targetAccountID != nil)
    }

    private var peekBackground: Color {
        peekPresentation.isPositive
            ? KualiaPalette.peekPositiveBackground : KualiaPalette.peekBackground
    }

    private var preventsDismissal: Bool {
        connectionStore?.phase == .saving || connectionStore?.phase == .exchanging
    }

    var body: some View {
        PeekContainer(
            isCompactPresented: showsPeek, compactHeight: peekHeight,
            animation: motion,
            compactAlignment: .top, bottomCornerRadius: 0,
            foregroundColor: showsPeek ? peekBackground : KualiaPalette.canvas
        ) {
            NavigationStack(path: $navigation.path) {
                Group {
                    if navigation.startsWithConnections {
                        connectionPage(.connections)
                    } else {
                        choice
                    }
                }
                .navigationDestination(for: AccountSetupRoute.self) { route in
                    if route == .manual {
                        AccountEditorView(store: store, isPushed: true) {
                            onSaved()
                            dismiss()
                        }
                    } else {
                        connectionPage(route)
                    }
                }
            }
            .background(KualiaPalette.canvas)
            .kualiaBottomCorners(minimum: 52)
            // Keep the page and its rounded boundary in the same reveal animation.
            .geometryGroup()
        } compact: {
            if let connectionStore {
                AccountConnectionPeek(
                    store: connectionStore, presentation: peekPresentation,
                    onDone: { dismiss() }
                )
                .background(peekBackground)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: { height in
                    if abs(peekHeight - height) > 0.5 { peekHeight = height }
                }
            }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(34)
        .presentationBackground(KualiaPalette.canvas)
        .task {
            if navigation.startsWithConnections { prepareConnections() }
        }
        // The sheet owns the subscription. A navigation push must never stop a save
        // or cancel Plaid while the next page is being installed.
        .onDisappear { connectionStore?.stop() }
        .onChange(of: navigation.showsConnections) { _, visible in
            if !visible { connectionStore?.stop() }
        }
        .animation(
            reduceMotion ? nil : .easeInOut(duration: 0.3),
            value: peekPresentation.isPositive
        )
        .onChange(of: connectionStore?.connectionToReviewID) { _, id in
            guard let id, connectionStore?.consumeConnectionToReview() == id else { return }
            withAnimation(reduceMotion ? nil : .default) {
                navigation.reviewNewConnection(id)
            }
        }
        .onChange(of: connectionStore?.statusTitle) { _, title in
            guard showsPeek, let title, let connectionStore else { return }
            UIAccessibility.post(
                notification: .announcement,
                argument: "\(title). \(connectionStore.statusDetail)")
        }
        .sensoryFeedback(.success, trigger: connectionStore?.phase == .completed) {
            _, completed in completed
        }
    }

    @ViewBuilder
    private func connectionPage(_ route: AccountSetupRoute) -> some View {
        if let connectionStore {
            AccountConnectionView(
                store: connectionStore, accountsStore: store, route: route,
                targetAccountID: targetAccountID,
                onClose: { dismiss() },
                onOpenConnection: { navigation.path.append(.bank($0)) }
            )
            .interactiveDismissDisabled(preventsDismissal)
        } else {
            VStack {
                ContentUnavailableView(
                    L10n.string("Connection unavailable"), icon: .wifiOff,
                    description: Text(L10n.string("Open a workspace and try again.")))
                KualiaCloseButton { dismiss() }
                    .padding(.bottom, 24)
            }
        }
    }

    private var choice: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.string("How would you like\nto add it?"))
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(L10n.string("Connect your bank, or track an account yourself."))
                        .font(.body).foregroundStyle(KualiaPalette.mutedInk)
                }
                VStack(spacing: 14) {
                    option(
                        title: L10n.string("Connection"),
                        detail: L10n.string(
                            "Choose accounts from a bank. Balances and transactions sync."),
                        identifier: "accounts.chooseConnection",
                        icon: {
                            Image("plaid-logo")
                                .renderingMode(.original)
                                .resizable().scaledToFit()
                                .frame(width: 52, height: 52)
                                .clipShape(Circle())
                        }
                    ) {
                        prepareConnections()
                        navigation.path.append(.connections)
                    }
                    option(
                        title: L10n.string("Manual"),
                        detail: L10n.string("Set a balance and add transactions yourself."),
                        identifier: "accounts.chooseManual",
                        icon: {
                            KualiaIconImage(icon: .newEntry, size: 24)
                                .font(.system(size: 24, weight: .medium))
                                .frame(width: 52, height: 52)
                                .background(KualiaPalette.accountsGlow.opacity(0.14), in: Circle())
                        }
                    ) {
                        navigation.path.append(.manual)
                    }
                }
            }
            .padding(.horizontal, 24).padding(.top, 20).padding(.bottom, 32)
        }
        .background(KualiaPalette.canvas)
        .foregroundStyle(KualiaPalette.ink)
        .navigationTitle(L10n.string("Add account"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .kualiaScrollEdges(for: .top)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                KualiaCloseButton(placement: .toolbar, label: L10n.string("Close add account")) {
                    dismiss()
                }
            }
        }
        .accessibilityIdentifier("accounts.addChoice")
    }

    private func option<Icon: View>(
        title: String, detail: String, identifier: String,
        @ViewBuilder icon: () -> Icon, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 16) {
                icon().accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 7) {
                    Text(title).font(.system(.title2, design: .rounded, weight: .bold))
                    Text(detail).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                KualiaIconImage(icon: .chevronRight, size: 15).font(
                    .system(size: 15, weight: .semibold)
                )
                .foregroundStyle(KualiaPalette.mutedInk)
            }
            .padding(22)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 27))
            .contentShape(RoundedRectangle(cornerRadius: 27))
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityIdentifier(identifier)
    }

    private func prepareConnections() {
        if connectionStore == nil { connectionStore = store.makeConnectionStore() }
        connectionStore?.start()
    }
}
