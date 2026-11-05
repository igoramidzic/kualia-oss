import SwiftUI

struct TransactionSearchDateSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: TransactionSearchFilters
    let workspace: TransactionFeedWorkspace
    @State private var start = Date()
    @State private var end = Date()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L10n.string("When did it happen?"))
                            .font(.system(.title2, design: .rounded, weight: .bold))
                        Text(L10n.string("Choose a shortcut or set your own dates."))
                            .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    }
                    TransactionEditorGroup {
                        dateShortcut(L10n.string("All dates"), period: nil)
                        ForEach(TransactionSearchPeriod.allCases) { period in
                            TransactionEditorDivider()
                            dateShortcut(period.title, period: period)
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text(L10n.string("Custom range")).font(.subheadline.weight(.semibold))
                        TransactionEditorGroup {
                            DatePicker(
                                L10n.string("From"), selection: $start, displayedComponents: .date
                            )
                            .padding(16)
                            TransactionEditorDivider()
                            DatePicker(
                                L10n.string("Through"), selection: $end, in: start...,
                                displayedComponents: .date
                            )
                            .padding(16)
                        }
                        Button {
                            filters.startDate = TransactionEditorDate.key(
                                from: start, workspace: workspace)
                            filters.endDate = TransactionEditorDate.key(
                                from: end, workspace: workspace)
                            dismiss()
                        } label: {
                            Text(L10n.string("Apply dates")).font(.body.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .foregroundStyle(KualiaPalette.canvas)
                                .background(KualiaPalette.ink, in: Capsule())
                        }
                        .buttonStyle(.kualiaHaptic)
                    }
                }
                .padding(24)
            }
            .background(KualiaPalette.canvas.ignoresSafeArea())
            .navigationTitle(L10n.string("Dates")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    KualiaCloseButton(placement: .toolbar, label: L10n.string("Cancel")) {
                        dismiss()
                    }
                }
            }
        }
        .environment(\.timeZone, TransactionEditorDate.calendar(workspace: workspace).timeZone)
        .presentationDetents([.large]).presentationDragIndicator(.visible)
        .presentationBackground(KualiaPalette.canvas)
        .onAppear {
            let today = TransactionEditorDate.today(workspace: workspace)
            start =
                TransactionEditorDate.date(from: filters.startDate ?? today, workspace: workspace)
                ?? Date()
            end =
                TransactionEditorDate.date(from: filters.endDate ?? today, workspace: workspace)
                ?? start
        }
        .onChange(of: start) { _, date in if end < date { end = date } }
    }

    private var selectedPeriod: TransactionSearchPeriod? {
        TransactionSearchPeriod.allCases.first { period in
            let range = period.range(workspace: workspace)
            return filters.startDate == range.start && filters.endDate == range.end
        }
    }

    private func dateShortcut(_ title: String, period: TransactionSearchPeriod?) -> some View {
        let isSelected =
            period.map { $0 == selectedPeriod }
            ?? (filters.startDate == nil && filters.endDate == nil)
        return Button {
            let range = period?.range(workspace: workspace)
            filters.startDate = range?.start
            filters.endDate = range?.end
            dismiss()
        } label: {
            HStack {
                Text(title).foregroundStyle(KualiaPalette.ink)
                Spacer()
                if isSelected {
                    KualiaIconImage(icon: .checkCircle, size: 18)
                        .foregroundStyle(KualiaPalette.ink)
                        .accessibilityHidden(true)
                }
            }
            .font(.subheadline).padding(.horizontal, 16).frame(minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
