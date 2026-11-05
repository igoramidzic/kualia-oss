import SwiftUI

/// A value row owns its appearance; its destination and editing behavior stay with the editor.
struct TransactionEditorField: View {
    let title: String
    let value: String
    let symbol: KualiaIcon
    var valueIcon: KualiaIcon? = nil
    var icon: KualiaIcon? = nil
    var placeholder = false
    var detail: String?
    var logoURL: URL?
    var circularIcon = false
    var iconSize: CGFloat = 18
    var action: (() -> Void)?

    var body: some View {
        Group {
            if let action {
                Button(action: action) { content }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityHint(L10n.string("Change \(title.lowercased())"))
            } else {
                content
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var content: some View {
        HStack(alignment: .center, spacing: 13) {
            if let icon {
                KualiaIconImage(icon: icon, size: 24)
                    .foregroundStyle(KualiaPalette.mutedInk).frame(width: 26)
            } else if circularIcon {
                TransactionEditorLogo(url: logoURL, symbol: symbol, iconSize: iconSize)
            } else {
                KualiaIconImage(icon: symbol, size: iconSize)
                    .font(.system(size: iconSize, weight: .medium))
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .frame(width: 26)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(.caption, weight: .medium))
                    .foregroundStyle(KualiaPalette.mutedInk)
                HStack(spacing: 8) {
                    Text(value)
                        .font(.system(.body, design: .rounded, weight: .semibold))
                        .foregroundStyle(placeholder ? KualiaPalette.mutedInk : KualiaPalette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let valueIcon {
                        KualiaIconImage(icon: valueIcon, size: 18)
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .accessibilityHidden(true)
                    }
                }
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(KualiaPalette.mutedInk)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if action != nil {
                KualiaIconImage(icon: .chevronRight, size: 11)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(KualiaPalette.mutedInk.opacity(0.6))
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 15)
        .frame(minHeight: 68)
        .contentShape(Rectangle())
    }
}

struct TransactionEditorGroup<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .background(KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 24))
    }
}

struct TransactionEditorDivider: View {
    var body: some View {
        Rectangle()
            .fill(KualiaPalette.border.opacity(0.5))
            .frame(height: 0.5)
            .padding(.leading, 57)
            .padding(.trailing, 18)
    }
}

struct TransactionEditorChoice: Identifiable {
    let id: String
    let title: String
    var subtitle: String?
    var symbol: KualiaIcon? = .circle
    var groupID: String?
    var groupTitle: String?
    var logoURL: URL?
    var circularIcon = false
}

struct TransactionEditorChoiceSection: Identifiable {
    let id: String?
    let title: String?
    var choices: [TransactionEditorChoice]

    static func build(_ choices: [TransactionEditorChoice], search: String) -> [Self] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        var sections: [Self] = []
        var indices: [String?: Int] = [:]
        for choice in choices
        where query.isEmpty
            || choice.title.localizedStandardContains(query)
            || choice.subtitle?.localizedStandardContains(query) == true
            || choice.groupTitle?.localizedStandardContains(query) == true
        {
            if let index = indices[choice.groupID] {
                sections[index].choices.append(choice)
            } else {
                indices[choice.groupID] = sections.count
                sections.append(
                    Self(id: choice.groupID, title: choice.groupTitle, choices: [choice]))
            }
        }
        return sections
    }
}

extension EnvironmentValues {
    @Entry var categoryPickerBudget: BudgetStore? = nil
}

/// Shared searchable picker with optional live category balances.
struct TransactionEditorPicker: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.categoryPickerBudget) private var budget
    let title: String
    let choices: [TransactionEditorChoice]
    let selectedID: String?
    var selectedIDs: Set<String>? = nil
    var isEmbedded = false
    var isLoading = false
    var isSaving = false
    var dismissesOnSelection = true
    var errorMessage: String?
    var onRetry: (() -> Void)?
    var onCreate: ((String) -> Void)?
    var onSplit: (() -> Void)?
    var splitActionTitle = L10n.string("Split")
    var isSplitActionEnabled = true
    var showsSelectionControls = false
    var showsCategoryBalances = false
    var categoryDateKey: String?
    var focusesSearchOnAppear = false
    let onSelect: (String) -> Void

    @State private var search = ""
    @FocusState private var isSearchFocused: Bool

    private var sections: [TransactionEditorChoiceSection] {
        TransactionEditorChoiceSection.build(choices, search: search)
    }

    var body: some View {
        Group {
            if isEmbedded { pickerContent } else { NavigationStack { pickerContent } }
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var pickerContent: some View {
        let sections = self.sections
        let month = categoryDateKey.flatMap(BudgetMonth.fromDateKey) ?? budget?.currentMonth
        let balances =
            showsCategoryBalances
            ? month.flatMap { budget?.categoryPickerBalances(for: $0) } : nil
        return ScrollView {
            // Rows must be direct lazy children. An eager card around a letter
            // group instantiates every merchant in that group during navigation.
            LazyVStack(alignment: .leading, spacing: 0) {
                if showsCategoryBalances, let month {
                    Text(L10n.string("Available · \(BudgetMonth.title(month))"))
                        .font(.subheadline)
                        .foregroundStyle(KualiaPalette.mutedInk)
                        .padding(.bottom, 16)
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).padding(.bottom, 20)
                    if let onRetry {
                        Button(L10n.string("Try again"), action: onRetry).padding(.bottom, 20)
                    }
                }
                if isSaving { ProgressView(L10n.string("Saving category…")).padding(.bottom, 20) }
                if isLoading {
                    ProgressView(L10n.string("Loading choices…")).padding(.bottom, 20)
                }
                ForEach(sections) { section in
                    Section {
                        ForEach(section.choices) { choice in
                            let isFirst = choice.id == section.choices.first?.id
                            let isLast = choice.id == section.choices.last?.id
                            choiceRow(choice, available: balances?[choice.id])
                                .background {
                                    UnevenRoundedRectangle(
                                        topLeadingRadius: isFirst ? 24 : 0,
                                        bottomLeadingRadius: isLast ? 24 : 0,
                                        bottomTrailingRadius: isLast ? 24 : 0,
                                        topTrailingRadius: isFirst ? 24 : 0
                                    ).fill(KualiaPalette.surface)
                                }
                                .overlay(alignment: .top) {
                                    if !isFirst {
                                        Rectangle()
                                            .fill(KualiaPalette.border.opacity(0.5))
                                            .frame(height: 0.5)
                                            .padding(.horizontal, 16)
                                    }
                                }
                                .padding(
                                    .bottom, isLast && section.id != sections.last?.id ? 20 : 0)
                        }
                    } header: {
                        if let title = section.title {
                            Text(title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(KualiaPalette.ink)
                                .padding(.horizontal, 4)
                                .padding(.bottom, 8)
                                .accessibilityAddTraits(.isHeader)
                        }
                    }
                }
                if sections.isEmpty, !isLoading, errorMessage == nil {
                    ContentUnavailableView.search(text: search)
                }
                if let onCreate, !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button {
                        onCreate(search.trimmingCharacters(in: .whitespacesAndNewlines))
                        dismiss()
                    } label: {
                        Label(
                            L10n.string(
                                "Create “\(search.trimmingCharacters(in: .whitespacesAndNewlines))”"
                            ),
                            icon: .plusCircle
                        )
                        .frame(minHeight: 44)
                    }
                    .padding(.top, 20)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .scrollDismissesKeyboard(.interactively)
        .kualiaScrollEdges(for: .top)
        .background(KualiaPalette.canvas)
        .safeAreaInset(edge: .top, spacing: 0) {
            searchField
        }
        .task {
            isSearchFocused = focusesSearchOnAppear
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isEmbedded {
                if !dismissesOnSelection {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(L10n.string("Done")) { dismiss() }.disabled(isSaving)
                    }
                }
            } else if let onSplit {
                ToolbarItem(placement: .cancellationAction) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(splitActionTitle, action: onSplit)
                        .disabled(!isSplitActionEnabled || isLoading || isSaving)
                        .accessibilityIdentifier("transaction.category.split")
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }
                        .disabled(isSaving)
                }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            KualiaIconImage(icon: .search, size: 18)
                .foregroundStyle(KualiaPalette.mutedInk)
                .accessibilityHidden(true)
            TextField(L10n.string("Search \(title.lowercased())"), text: $search)
                .focused($isSearchFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { isSearchFocused = false }
                .accessibilityIdentifier("transaction-picker-search")
            if !search.isEmpty {
                Button(L10n.string("Clear search"), icon: .closeCircle) { search = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.kualiaHaptic)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .background(KualiaPalette.surface, in: Capsule())
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(KualiaPalette.canvas)
    }

    func isSelected(_ id: String) -> Bool {
        selectedIDs?.contains(id) ?? (selectedID == id)
    }
    private func choiceRow(_ choice: TransactionEditorChoice, available: Decimal?) -> some View {
        Button {
            onSelect(choice.id)
            if dismissesOnSelection { dismiss() }
        } label: {
            HStack(spacing: 13) {
                choiceIcon(choice)
                VStack(alignment: .leading, spacing: 4) {
                    Text(choice.title)
                        .font(.system(.body, design: .rounded, weight: .semibold))
                        .foregroundStyle(KualiaPalette.ink)
                    if let subtitle = choice.subtitle {
                        Text(subtitle).font(.caption).foregroundStyle(
                            KualiaPalette.mutedInk)
                    }
                }
                Spacer(minLength: 8)
                if let available, let workspace = budget?.workspace {
                    let amount = MoneyAmountFormatter.string(
                        decimalMinorUnits: available, currencyCode: workspace.currencyCode,
                        minorUnit: workspace.minorUnit, showsPositiveSign: false,
                        usesAbsoluteValue: false)
                    Text(amount)
                        .font(.subheadline.weight(.medium).monospacedDigit())
                        .foregroundStyle(
                            available < 0
                                ? KualiaPalette.budgetNegative : KualiaPalette.budgetPositive
                        )
                        .fixedSize(horizontal: true, vertical: false)
                        .accessibilityLabel(L10n.string("\(amount) available"))
                }
                if showsSelectionControls || isSelected(choice.id) {
                    KualiaIconImage(
                        icon: isSelected(choice.id) ? .checkCircle : .circleOutline, size: 22
                    )
                    .foregroundStyle(
                        isSelected(choice.id) ? KualiaPalette.ink : KualiaPalette.mutedInk)
                }
            }
            .padding(.vertical, choice.circularIcon || choice.symbol == nil ? 4 : 9)
            .frame(minHeight: 48)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .disabled(isLoading || isSaving)
        .accessibilityAddTraits(isSelected(choice.id) ? .isSelected : [])

    }

    @ViewBuilder
    private func choiceIcon(_ choice: TransactionEditorChoice) -> some View {
        if choice.circularIcon {
            TransactionEditorLogo(
                url: choice.logoURL, symbol: choice.symbol ?? .bank)
        } else if let symbol = choice.symbol {
            KualiaIconImage(icon: symbol, size: 18)
                .font(.system(size: 18))
                .foregroundStyle(KualiaPalette.mutedInk)
                .frame(width: 26)
                .accessibilityHidden(true)
        }
    }

}

/// Shared identity treatment for the selected field and its picker options.
struct TransactionEditorLogo: View {
    let url: URL?
    let symbol: KualiaIcon
    var iconSize: CGFloat = 18

    var body: some View {
        Group {
            #if DEBUG
                if let url = url, let image = ScreenshotDemoLogo.image(url) {
                    Image(uiImage: image).resizable().scaledToFit().background(.white)
                } else {
                    remoteLogo
                }
            #else
                remoteLogo
            #endif
        }
        .frame(width: iconSize + 14, height: iconSize + 14).clipShape(Circle()).accessibilityHidden(
            true)
    }

    private var remoteLogo: some View {
        AsyncImage(url: url) { phase in
            if let image = phase.image {
                image.resizable().scaledToFit()
            } else {
                KualiaIconImage(icon: symbol, size: iconSize)
                    .font(.system(size: iconSize))
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(KualiaPalette.border.opacity(0.35))
            }
        }
        .frame(width: iconSize + 14, height: iconSize + 14)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

struct TransactionEditorNotice: View {
    let message: String
    var symbol: KualiaIcon = .info
    var isError = false

    var body: some View {
        Label(message, icon: symbol)
            .font(.system(.footnote, weight: .medium))
            .foregroundStyle(isError ? .red : KualiaPalette.mutedInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 6)
            .accessibilityElement(children: .combine)
    }
}
