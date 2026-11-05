#if DEBUG
    import SwiftUI

    enum ScreenshotDemoMode {
        static let defaultsKey = "debug.screenshotDemo.enabled"

        static func currencyCode(for language: AppLanguage) -> String {
            switch language {
            case .system:
                currencyCode(
                    for: AppLanguage.resolve(
                        AppLanguage.system.languageCode(
                            preferredLanguages: Locale.preferredLanguages)))
            case .english: "USD"
            case .spanish, .german, .italian, .french: "EUR"
            case .simplifiedChinese: "CNY"
            case .serbian: "RSD"
            }
        }
    }

    extension EnvironmentValues {
        @Entry var exitScreenshotDemo: () -> Void = {
            UserDefaults.standard.set(false, forKey: ScreenshotDemoMode.defaultsKey)
        }
        @Entry var enterScreenshotDemo: () -> Void = {
            UserDefaults.standard.set(true, forKey: ScreenshotDemoMode.defaultsKey)
        }
    }

    struct ScreenshotDemoToggle: View {
        @AppStorage(ScreenshotDemoMode.defaultsKey) private var enabled = false
        @Environment(\.enterScreenshotDemo) private var enterDemo
        @Environment(\.exitScreenshotDemo) private var exitDemo

        var body: some View {
            SettingsGroup(title: L10n.string("Developer")) {
                Toggle(
                    isOn: Binding(
                        get: { enabled },
                        set: { value in
                            if value { enterDemo() } else { exitDemo() }
                        })
                ) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(L10n.string("Screenshot demo")).font(.body.weight(.medium))
                        Text(
                            L10n.string(
                                "Explore a populated workspace with sample data."
                            )
                        )
                        .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
                .tint(KualiaPalette.ink).padding(20)
                .accessibilityIdentifier("settings-screenshot-demo")
                SettingsDivider()
                Picker(
                    L10n.string("Language"),
                    selection: Binding(
                        get: { AppLanguageStore.shared.preference },
                        set: { AppLanguageStore.shared.preference = $0 })
                ) {
                    ForEach(AppLanguage.allCases) { option in
                        Text(
                            verbatim:
                                "\(option.title) · \(ScreenshotDemoMode.currencyCode(for: option))"
                        )
                        .tag(option)
                    }
                }
                .pickerStyle(.menu)
                .padding(20)
                .accessibilityIdentifier("settings-screenshot-demo-language")
                Text(L10n.string("Sets the app language and demo currency together."))
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    .padding(.horizontal, 20).padding(.bottom, 20)
            }
        }
    }

    /// Replaces AppRootView with local providers, without constructing live feature stores.
    struct ScreenshotDemoView: View {
        @State private var session: AppSessionStore
        @State private var settings: SettingsStore
        @State private var assistant: AssistantStore
        @State private var sampleDate: Date
        @State private var showsSettings = false
        @State private var showsWorkspaceSettings = false

        init() {
            let data = ScreenshotDemoData()
            _session = State(initialValue: data.makeSession())
            _settings = State(initialValue: SettingsStore(demo: data))
            _assistant = State(initialValue: data.makeAssistant())
            _sampleDate = State(initialValue: data.now)
        }

        var body: some View {
            NavigationStack {
                Group {
                    if let current = session.displayedSession {
                        HomeView(
                            transactionFeedStore: current.transactions,
                            budgetStore: current.budget,
                            accountsStore: current.accounts, reportsStore: current.reports,
                            appSession: session, assistantStore: assistant,
                            allowsReviewPrompt: false,
                            isSettingsPresented: showsSettings || showsWorkspaceSettings
                        )
                        .environment(\.transactionScheduleStore, current.transactions.agenda)
                        .environment(\.categoryPickerBudget, current.budget)
                    } else {
                        AppLoadingView()
                    }
                }
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(isPresented: $showsSettings) {
                    SettingsView(store: settings, session: session)
                        .background(KualiaPalette.canvas.ignoresSafeArea())
                }
            }
            .sheet(isPresented: $showsWorkspaceSettings) {
                WorkspaceSettingsSheet(settings: settings, session: session)
            }
            .environment(\.isDemoWorkspace, true)
            .environment(\.checkInSettings, settings)
            .environment(\.settingsProfileName, settings.profile?.displayName)
            .environment(
                \.openAppSettings,
                {
                    showsSettings = true
                }
            )
            .environment(
                \.openWorkspaceSettings,
                {
                    showsWorkspaceSettings = true
                }
            )
            .fullScreenCover(
                isPresented: Binding(
                    get: { assistant.isPresented }, set: { if !$0 { assistant.close() } })
            ) {
                AssistantView(
                    store: assistant,
                    loadTransaction: { _ in throw ScreenshotDemoError.unavailable }
                )
                .environment(\.isDemoWorkspace, true)
            }
            .task {
                session.start(userID: "screenshot-demo")
                settings.family.start(sessionID: "screenshot-demo")
            }
            .onChange(of: session.preparationState, initial: true) { _, _ in
                session.revealIfReady()
                settings.prepareBankConnections(accounts: session.current?.accounts)
            }
            .onChange(of: session.current?.workspace.id) { _, _ in
                showsWorkspaceSettings = false
            }
            .onChange(of: AppLanguageStore.shared.locale) { _, _ in
                refreshLocalizedContent()
            }
            .environment(\.exitScreenshotDemo) {
                session.reset()
                settings.family.reset()
                assistant.reset()
                UserDefaults.standard.set(false, forKey: ScreenshotDemoMode.defaultsKey)
            }
        }

        private func refreshLocalizedContent() {
            let page = session.navigation.selectedPage
            let assistantWasPresented = assistant.isPresented
            session.reset()
            settings.stopBankConnections()
            settings.family.reset()
            assistant.reset()
            // Rebuild captured labels and messages while keeping the same ledger dates.
            let data = ScreenshotDemoData(now: sampleDate)
            session = data.makeSession()
            settings = SettingsStore(demo: data)
            assistant = data.makeAssistant()
            session.start(userID: "screenshot-demo")
            session.navigation.restore(page)
            settings.family.start(sessionID: "screenshot-demo")
            if assistantWasPresented { assistant.present() }
        }
    }
#endif
