#if DEBUG
    import Foundation

    extension ScreenshotDemoData {
        var assistantThread: AssistantThread {
            .init(
                threadId: "demo-chat", title: L10n.string("A look at your budget"),
                lastUpdatedAt: now.timeIntervalSince1970 * 1000, unread: false,
                workspaceId: workspace.id)
        }
        var assistantExampleAnswer: String {
            let snapshot = budgetSnapshot(month: month)
            let current = snapshot.months.first { $0.yearMonth == month }
            let travel = AccountMoney.string(
                Decimal(current?.budgetData["travel"]?.assignedAmount ?? 0),
                workspace: feedWorkspace)
            let emergency = AccountMoney.string(
                Decimal(current?.budgetData["emergency"]?.available ?? 0), workspace: feedWorkspace)
            let ready = AccountMoney.string(
                Decimal(snapshot.readyToAssign), workspace: feedWorkspace)
            return L10n.string(
                "Yes! Your monthly budget is **fully funded**, including spending beyond your targets.\n\n### Your savings snapshot\n\n- ✈️ **Next adventure:** \(travel) assigned this month.\n- 🛟 **Emergency Fund:** \(emergency) available.\n- ✨ **Ready to assign:** \(ready) still has no job.\n\n### A little more for your trip\n\nYou could put some of that unassigned money toward **Next adventure**, while keeping a cushion for surprises.\n\n*Want to explore how splitting it between travel and your emergency fund would look?*"
            )
        }

        func makeAssistant() -> AssistantStore {
            struct WireMessage: Encodable {
                struct Body: Encodable {
                    let role: String
                    let content: String
                }
                let _id: String
                let order: Int
                let message: Body
            }
            let wire = [
                WireMessage(
                    _id: "demo-question", order: 0,
                    message: .init(
                        role: "user",
                        content: L10n.string("Can I save more for my next trip this month?"))),
                WireMessage(
                    _id: "demo-answer", order: 1,
                    message: .init(
                        role: "assistant",
                        content: assistantExampleAnswer)),
            ]
            let messages =
                (try? JSONEncoder().encode(wire)).flatMap {
                    try? JSONDecoder().decode([AssistantMessage].self, from: $0)
                } ?? []
            let store = AssistantStore(
                client: .init(
                    threads: { _ in Self.publisher(.init(active: [self.assistantThread])) },
                    messages: { _, _ in
                        Self.publisher(.init(page: messages, continueCursor: nil, isDone: true))
                    },
                    streams: { _ in Self.publisher([]) },
                    usage: { Self.publisher(.init(limitReached: false)) },
                    createThread: { _ in throw ScreenshotDemoError.unavailable },
                    send: { _ in throw ScreenshotDemoError.unavailable },
                    stop: { _ in throw ScreenshotDemoError.unavailable }, markRead: { _ in },
                    upload: { _ in throw ScreenshotDemoError.unavailable }))
            store.workspace = .init(workspaceId: workspace.id, workspaceName: workspace.name)
            store.authenticate(userID: "screenshot-demo")
            store.open(assistantThread)
            return store
        }
    }
#endif
