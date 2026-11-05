import SwiftUI

struct HomeSheetDestination: Identifiable, Equatable {
    enum Content {
        case newEntry(TransactionEditorStore)
        case search(TransactionSearchStore)
        case transactionPreferences
    }

    // Each presentation owns its content throughout dismissal and rapid reopening.
    let id = UUID()
    let content: Content

    var transactionEditor: TransactionEditorStore? {
        if case .newEntry(let editor) = content { return editor }
        return nil
    }

    var isSearch: Bool {
        if case .search = content { return true }
        return false
    }

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
}

struct HomeSheetContent: View {
    let destination: HomeSheetDestination
    let transactionFeedStore: TransactionFeedStore
    var onSaved: (TransactionMutationReceipt) -> Void = { _ in }

    @ViewBuilder
    var body: some View {
        switch destination.content {
        case .search(let store):
            TransactionSearchSheet(store: store, feed: transactionFeedStore)
        case .newEntry(let editor):
            TransactionEditorView(store: editor, onSaved: onSaved)
        case .transactionPreferences:
            TransactionPreferencesSheet()
        }
    }
}
