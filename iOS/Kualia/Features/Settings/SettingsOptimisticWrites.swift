import Foundation

enum SettingsWriteKey: Hashable {
    case name, notificationsEnabled, newTransactionsEnabled, remindersEnabled, reminderFrequency
    case workspaceSettings(String)
    case workspaceTimezone(String)

    var workspaceID: String? {
        switch self {
        case .workspaceSettings(let id), .workspaceTimezone(let id): id
        default: nil
        }
    }
}

enum SettingsWriteValue: Equatable {
    case text(String)
    case flag(Bool)
    case workspace(SettingsWorkspaceValues)
    var text: String? { if case .text(let value) = self { value } else { nil } }
    var flag: Bool? { if case .flag(let value) = self { value } else { nil } }
}

/// Keep the latest intent visible through stale subscription events and older saves.
/// Writes are serialized by SettingsStore; a failed older write cannot undo a newer tap.
struct SettingsOptimisticWrites {
    struct Change: Equatable {
        let key: SettingsWriteKey
        let value: SettingsWriteValue
        let revision: Int
        var isSending = false
        var isAcknowledged = false
        var observedMatchingValue = false
    }
    private(set) var changes: [SettingsWriteKey: Change] = [:]
    private var revision = 0
    var hasUnsavedChanges: Bool { changes.values.contains { !$0.isAcknowledged } }

    subscript(key: SettingsWriteKey) -> SettingsWriteValue? { changes[key]?.value }

    mutating func set(_ value: SettingsWriteValue, for key: SettingsWriteKey) {
        revision += 1
        changes[key] = Change(key: key, value: value, revision: revision)
    }

    mutating func next() -> Change? {
        guard
            var change = changes.values.filter({ !$0.isSending && !$0.isAcknowledged })
                .min(by: { $0.revision < $1.revision })
        else { return nil }
        change.isSending = true
        changes[change.key] = change
        return change
    }

    mutating func acknowledge(_ sent: Change) {
        guard var current = changes[sent.key], current.revision == sent.revision else { return }
        current.isAcknowledged = true
        current.isSending = false
        if current.observedMatchingValue {
            changes[sent.key] = nil
        } else {
            changes[sent.key] = current
        }
    }

    @discardableResult
    mutating func fail(_ sent: Change) -> Bool {
        guard changes[sent.key]?.revision == sent.revision else { return false }
        changes[sent.key] = nil
        return true
    }

    mutating func observe(_ value: SettingsWriteValue, for key: SettingsWriteKey) {
        guard var current = changes[key] else { return }
        current.observedMatchingValue =
            current.isSending || current.isAcknowledged ? current.value == value : false
        if current.isAcknowledged && current.observedMatchingValue {
            changes[key] = nil
        } else {
            changes[key] = current
        }
    }

    mutating func removeWorkspace(_ id: String) {
        changes = changes.filter { $0.key.workspaceID != id }
    }
}
