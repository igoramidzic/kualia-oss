import SwiftUI

struct RuleTextConditionFields: View {
    let title: String
    let icon: KualiaIcon
    @Binding var alternatives: [RuleTextConditionDraft]
    var conditionType: Binding<RuleConditionKind>? = nil
    var unavailableTypes: Set<RuleConditionKind> = []
    @FocusState private var focusedAlternativeID: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if let conditionType {
                    RuleConditionTypePicker(
                        selection: conditionType, unavailableTypes: unavailableTypes)
                } else {
                    Label(title, icon: icon).font(.subheadline.weight(.medium))
                }
                Spacer()
                Button(L10n.string("Add alternative"), icon: .plus) { alternatives.append(.init()) }
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
            }
            ForEach($alternatives) { $alternative in
                VStack(alignment: .leading, spacing: 8) {
                    if alternative.id != alternatives.first?.id { RuleAlternativeDivider() }
                    HStack {
                        Picker(
                            L10n.string("\(title) comparison"), selection: $alternative.matchType
                        ) {
                            ForEach(RuleTextMatch.allCases, id: \.self) { match in
                                Text(
                                    match == .contains
                                        ? L10n.string("Contains") : L10n.string("Is exactly")
                                ).tag(match)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.segmented)
                        .tint(KualiaPalette.ink)
                        Button {
                            alternatives.removeAll { $0.id == alternative.id }
                        } label: {
                            KualiaIconImage(icon: .minusCircle, size: 18)
                                .frame(width: 44, height: 44)
                        }
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .accessibilityLabel(L10n.string("Remove \(title.lowercased()) condition"))
                    }
                    TextField(L10n.string("Text to match"), text: $alternative.value)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedAlternativeID, equals: alternative.id)
                        .submitLabel(.done)
                        .onSubmit { focusedAlternativeID = nil }
                        .padding(12)
                        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityLabel(L10n.string("\(title) to match"))
                }
            }
        }

    }
}

struct RuleAmountConditionFields: View {
    @Binding var alternatives: [RuleAmountConditionDraft]
    let currency: String
    let minorUnit: Int
    var conditionType: Binding<RuleConditionKind>? = nil
    var unavailableTypes: Set<RuleConditionKind> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if let conditionType {
                    RuleConditionTypePicker(
                        selection: conditionType, unavailableTypes: unavailableTypes)
                } else {
                    Label(L10n.string("Amount"), icon: .money).font(.subheadline.weight(.medium))
                }
                Spacer()
                Button(L10n.string("Add alternative"), icon: .plus) { alternatives.append(.init()) }
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
            }
            Text(
                L10n.string("Use negative amounts for money out and positive amounts for money in.")
            )
            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            ForEach($alternatives) { $alternative in
                VStack(alignment: .leading, spacing: 8) {
                    if alternative.id != alternatives.first?.id { RuleAlternativeDivider() }
                    HStack {
                        Picker(L10n.string("Amount comparison"), selection: $alternative.comparison)
                        {
                            ForEach(RuleAmountOperator.allCases, id: \.self) { comparison in
                                Text(comparison.title).tag(comparison)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                        .tint(KualiaPalette.ink)
                        Spacer(minLength: 4)
                        Button {
                            alternatives.removeAll { $0.id == alternative.id }
                        } label: {
                            KualiaIconImage(icon: .minusCircle, size: 18)
                                .frame(width: 44, height: 44)
                        }
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .accessibilityLabel(L10n.string("Remove amount condition"))
                    }
                    amountInput(
                        alternative.comparison == .between
                            ? L10n.string("From") : L10n.string("Amount"),
                        value: $alternative.value)
                    if alternative.comparison == .between {
                        amountInput(L10n.string("Through"), value: $alternative.valueTo)
                        Text(L10n.string("Both endpoints are included. Example: −100 through −20."))
                            .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                    }
                }
            }
        }

    }

    private func amountInput(_ title: String, value: Binding<String>) -> some View {
        HStack(spacing: 10) {
            Text(title).font(.footnote).foregroundStyle(KualiaPalette.mutedInk)
            TextField(RuleMoney.input(0, minorUnit: minorUnit), text: value)
                .keyboardType(.numbersAndPunctuation)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .accessibilityLabel(L10n.string("\(title) in \(currency), negative for money out"))
            Text(currency).font(.caption.weight(.semibold)).foregroundStyle(KualiaPalette.mutedInk)
        }
        .padding(12)
        .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct RuleAlternativeDivider: View {
    var body: some View {
        HStack(spacing: 10) {
            Rectangle().frame(height: 1)
            Text("OR").font(.system(.caption2, design: .rounded, weight: .bold))
            Rectangle().frame(height: 1)
        }
        .foregroundStyle(KualiaPalette.mutedInk.opacity(0.5))
        .accessibilityLabel(L10n.string("Or"))
    }
}

struct RuleSelectionRow: View {
    let title: String
    let value: String
    let icon: KualiaIcon
    let isSet: Bool

    var body: some View {
        HStack(spacing: 12) {
            KualiaIconImage(icon: icon, size: 20)
                .foregroundStyle(KualiaPalette.mutedInk)
            Text(title).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            Spacer(minLength: 8)
            Text(value).font(.subheadline.weight(isSet ? .medium : .regular))
                .foregroundStyle(KualiaPalette.ink)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
            KualiaIconImage(icon: .chevronRight, size: 13)
                .foregroundStyle(KualiaPalette.mutedInk)
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

struct RuleChoicePicker: View {
    let title: String
    let choices: [RuleChoice]
    @Binding var selection: Set<String>
    let allowsMultiple: Bool
    let emptyLabel: String
    let unavailableLabel: String
    let icon: KualiaIcon

    var pickerChoices: [TransactionEditorChoice] {
        let knownIDs = Set(choices.map(\.id))
        let missing = selection.subtracting(knownIDs).sorted().map {
            TransactionEditorChoice(
                id: $0, title: unavailableLabel, symbol: nil,
                groupID: "previous", groupTitle: L10n.string("Previously selected"))
        }
        return [TransactionEditorChoice(id: "", title: emptyLabel, symbol: nil)] + missing
            + choices.map { choice in
                let hasIdentity = icon != .category
                return TransactionEditorChoice(
                    id: choice.id, title: choice.name,
                    symbol: hasIdentity
                        ? (icon == .shop
                            ? .shop
                            : choice.accountType?.hasPrefix("credit_") == true
                                ? .creditCard : .bank) : nil,
                    groupID: choice.groupName, groupTitle: choice.groupName,
                    logoURL: choice.logoURL.flatMap(URL.init(string:)), circularIcon: hasIdentity)
            }
    }

    var body: some View {
        TransactionEditorPicker(
            title: title, choices: pickerChoices,
            selectedID: selection.first ?? "",
            selectedIDs: selection.isEmpty ? [""] : selection,
            dismissesOnSelection: !allowsMultiple,
            showsCategoryBalances: icon == .category,
            focusesSearchOnAppear: icon == .shop || icon == .category,
            onSelect: { id in
                if id.isEmpty {
                    selection = []
                } else if allowsMultiple {
                    if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
                } else {
                    selection = [id]
                }
            })
    }
}

struct RuleEditorMessage: View {
    let message: String
    let isError: Bool

    var body: some View {
        Label(message, icon: isError ? .warning : .info)
            .font(.footnote)
            .foregroundStyle(isError ? KualiaPalette.budgetNegative : KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct RuleConditionTypePicker: View {
    @Binding var selection: RuleConditionKind
    let unavailableTypes: Set<RuleConditionKind>
    var body: some View {
        Picker(L10n.string("Condition type"), selection: $selection) {
            ForEach(RuleConditionKind.allCases) { kind in
                Text(kind.title).tag(kind).disabled(unavailableTypes.contains(kind))
            }
        }
        .pickerStyle(.menu).tint(KualiaPalette.ink)
        .accessibilityIdentifier("rule-condition-type")
    }
}

struct RuleConditionsEditor: View {
    @Binding var draft: RuleDraft
    let store: RulesStore
    @Environment(\.dismiss) private var dismiss
    @State private var showsAccountPicker = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(draft.conditionKinds) { kind in
                    let unavailable = Set(draft.conditionKinds).subtracting([kind])
                    switch kind {
                    case .merchant:
                        RuleTextConditionFields(
                            title: L10n.string("Merchant"), icon: .shop,
                            alternatives: $draft.merchantName, conditionType: typeBinding(kind),
                            unavailableTypes: unavailable)
                    case .statement:
                        RuleTextConditionFields(
                            title: L10n.string("Statement text"), icon: .fileSearch,
                            alternatives: $draft.originalStatement,
                            conditionType: typeBinding(kind),
                            unavailableTypes: unavailable)
                    case .amount:
                        RuleAmountConditionFields(
                            alternatives: $draft.amount, currency: draft.currency,
                            minorUnit: draft.minorUnit, conditionType: typeBinding(kind),
                            unavailableTypes: unavailable)
                    }
                }
                Menu {
                    ForEach(RuleConditionKind.allCases) { kind in
                        Button(kind.title) { draft.addCondition(kind) }.disabled(
                            draft.conditionKinds.contains(kind))
                    }
                } label: {
                    Label(L10n.string("Add another condition"), icon: .plus).font(.subheadline)
                        .frame(
                            minHeight: 44)
                }
                .disabled(draft.conditionKinds.count == RuleConditionKind.allCases.count)
                .accessibilityIdentifier("rule-editor-add-condition")
                DisclosureGroup(L10n.string("Limit to accounts")) {
                    Button {
                        showsAccountPicker = true
                    } label: {
                        RuleSelectionRow(
                            title: L10n.string("Accounts"), value: accountSummary, icon: .accounts,
                            isSet: !draft.bankAccountIDs.isEmpty)
                    }.buttonStyle(.plain).padding(.top, 8)
                        .sheet(isPresented: $showsAccountPicker) {
                            RuleChoicePicker(
                                title: L10n.string("Accounts"), choices: store.choices.accounts,
                                selection: Binding(
                                    get: { Set(draft.bankAccountIDs) },
                                    set: { draft.bankAccountIDs = $0.sorted() }),
                                allowsMultiple: true, emptyLabel: L10n.string("Any account"),
                                unavailableLabel: L10n.string("Unavailable account"),
                                icon: .accounts)
                        }
                }.font(.subheadline)
                if let error = store.choicesError {
                    SettingsRetry(message: error, retry: store.reloadChoices)
                }
                if let message = draft.conditionValidationMessage {
                    Text(message).font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
                if draft.conditionKinds.count > 1 {
                    Text(
                        L10n.string(
                            "Every condition must match. Alternatives within one condition use OR.")
                    )
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            .frame(maxWidth: 600).padding(22).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .kualiaScrollEdges(for: .top)
        .background(KualiaPalette.canvas)
        .navigationTitle(L10n.string("Conditions")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L10n.string("Done")) { dismiss() }.disabled(!draft.hasConfiguredConditions)
                    .accessibilityIdentifier("rule-conditions-done")
            }
        }
    }

    private var accountSummary: String {
        if draft.bankAccountIDs.isEmpty { return L10n.string("Any account") }
        if draft.bankAccountIDs.count == 1 {
            return store.choices.accounts.first { $0.id == draft.bankAccountIDs.first }?.name
                ?? L10n.string("Unavailable account")
        }
        return L10n.string("\(draft.bankAccountIDs.count) accounts")
    }

    private func typeBinding(_ kind: RuleConditionKind) -> Binding<RuleConditionKind> {
        Binding(get: { kind }, set: { draft.changeConditionKind(from: kind, to: $0) })
    }

}
