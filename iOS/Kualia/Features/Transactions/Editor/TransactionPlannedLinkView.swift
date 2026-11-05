import SwiftUI

struct TransactionPlannedLinkSummary: View {
    let details: TransactionPlannedLinkDetails
    private var today: String {
        TransactionEditorDate.today(workspace: details.workspace, now: Date())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                TransactionEditorLogo(
                    url: details.logoURL, symbol: details.plan.isTransfer ? .transfer : .shop,
                    iconSize: 22)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        name.fixedSize(horizontal: true, vertical: false)
                        Spacer(minLength: 0)
                        amount.fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        name
                        amount
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    due
                    recurrence
                }
                VStack(alignment: .leading, spacing: 6) {
                    due
                    recurrence
                }
            }
            VStack(alignment: .leading, spacing: 5) {
                Label(details.accountName, icon: .bank)
                if let categories = details.categorySummary {
                    Label(categories, icon: .category)
                }
            }
            .font(.caption)
            .foregroundStyle(KualiaPalette.mutedInk)
            .fixedSize(horizontal: false, vertical: true)
            if let notes = details.plan.notes?.trimmingCharacters(in: .whitespacesAndNewlines),
                !notes.isEmpty, notes != details.name
            {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(KualiaPalette.mutedInk)
                    .lineLimit(2)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var name: some View {
        Text(details.name)
            .font(.system(.body, design: .rounded, weight: .semibold))
            .foregroundStyle(KualiaPalette.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var amount: some View {
        if let title = details.amountTitle {
            Text(title)
                .font(.system(.body, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(
                    !details.plan.isTransfer && (details.plan.amount ?? 0) > 0
                        ? KualiaPalette.budgetPositive : KualiaPalette.ink)
        }
    }

    private var due: some View {
        Text(details.dueTitle(today: today))
            .font(.caption.weight(.medium))
            .foregroundStyle(
                details.occurrenceDate == nil && details.plan.isLinkable
                    && details.plan.nextDate < today
                    ? KualiaPalette.budgetNegative : KualiaPalette.mutedInk)
    }

    @ViewBuilder private var recurrence: some View {
        if !details.recurrenceTitle.isEmpty {
            Label(
                details.recurrenceTitle,
                icon: details.plan.recurrence?.calendarIcon ?? .calendarFilled
            )
            .font(.caption.weight(.medium))
            .foregroundStyle(KualiaPalette.mutedInk)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(KualiaPalette.border.opacity(0.25), in: Capsule())
        }
    }
}

struct TransactionPlannedLinkPicker: View {
    @Bindable var store: TransactionEditorStore
    let selectedID: String?
    let onSelect: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var plans: [TransactionEditorPlannedTransaction] {
        store.linkablePlannedTransactions.filter {
            TransactionPlannedLinkDetails(
                plan: $0, choices: store.choices, workspace: store.workspace
            )
            .matches(search: search)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let error = store.choicesErrorMessage {
                        TransactionEditorNotice(message: error, symbol: .wifiOff, isError: true)
                        Button(L10n.string("Try again")) { Task { await store.reloadChoices() } }
                    }
                    if store.isLoadingChoices { ProgressView(L10n.string("Loading choices…")) }
                    TransactionEditorGroup {
                        Button {
                            onSelect(nil)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                Label(L10n.string("No planned link"), icon: .linkPlus)
                                Spacer()
                                if selectedID == nil {
                                    KualiaIconImage(icon: .checkCircle, size: 22)
                                }
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(KualiaPalette.mutedInk)
                            .padding(18)
                            .frame(minHeight: 52)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.kualiaHaptic)
                        .accessibilityAddTraits(selectedID == nil ? .isSelected : [])
                    }
                    ForEach(plans) { plan in
                        TransactionEditorGroup {
                            Button {
                                onSelect(plan.id)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 10) {
                                    if let draft = store.draft, plan.isSuggested(for: draft) {
                                        Text(L10n.string("Suggested"))
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(KualiaPalette.mutedInk)
                                    }
                                    TransactionPlannedLinkSummary(
                                        details: .init(
                                            plan: plan, choices: store.choices,
                                            workspace: store.workspace))
                                    if selectedID == plan.id {
                                        Label(L10n.string("Selected"), icon: .checkCircle)
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(KualiaPalette.ink)
                                    }
                                }
                                .padding(18)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.kualiaHaptic)
                            .disabled(store.isLoadingChoices)
                            .accessibilityAddTraits(selectedID == plan.id ? .isSelected : [])
                        }
                    }
                    if plans.isEmpty, !store.isLoadingChoices, store.choicesErrorMessage == nil {
                        if search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            ContentUnavailableView(
                                L10n.string("No matching planned transactions"),
                                icon: .calendarFilled,
                                description: Text(
                                    L10n.string(
                                        "Active plans for the selected accounts appear here.")))
                        } else {
                            ContentUnavailableView.search(text: search)
                        }
                    }
                }
                .padding(20)
            }
            .background(KualiaPalette.canvas)
            .scrollDismissesKeyboard(.interactively)
            .searchable(text: $search, prompt: L10n.string("Search planned transactions"))
            .navigationTitle(L10n.string("Planned transactions"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    KualiaCloseButton(placement: .toolbar) { dismiss() }
                }
            }
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}
