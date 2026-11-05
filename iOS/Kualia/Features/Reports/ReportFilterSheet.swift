import SwiftUI

struct ReportRangeSheet: View {
    let store: ReportsStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(ReportPeriod.allCases.filter { $0 != .custom }) { option in
                        Button {
                            store.apply(period: option)
                            dismiss()
                        } label: {
                            optionLabel(option)
                        }
                        .buttonStyle(.kualiaHaptic)
                        .accessibilityAddTraits(store.period == option ? .isSelected : [])
                        .accessibilityIdentifier("reports.range.\(option.rawValue)")
                    }
                    NavigationLink {
                        ReportCustomMonthsView(store: store) { range in
                            store.apply(period: .custom, custom: range)
                            dismiss()
                        }
                    } label: {
                        optionLabel(.custom)
                    }
                    .buttonStyle(.kualiaHaptic)
                    .accessibilityIdentifier("reports.range.custom")
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
            }
            .navigationTitle(L10n.string("Report range"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    KualiaCloseButton(placement: .toolbar, label: L10n.string("Cancel")) {
                        dismiss()
                    }
                }
            }
        }
        .tint(KualiaPalette.ink)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(32)
        .presentationBackground(KualiaPalette.budgetPage)
        .onChange(of: store.context?.id) { _, _ in dismiss() }
    }

    private func optionLabel(_ option: ReportPeriod) -> some View {
        HStack(spacing: 12) {
            Text(option.title).font(.body)
            Spacer()
            if store.period == option {
                KualiaIconImage(icon: .check, size: 18).accessibilityHidden(true)
            }
            if option == .custom {
                KualiaIconImage(icon: .chevronRight, size: 14).accessibilityHidden(true)
            }
        }
        .foregroundStyle(KualiaPalette.ink)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

private struct ReportCustomMonthsView: View {
    let store: ReportsStore
    let onApply: (ReportRange) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selection: ReportMonthSelection

    init(store: ReportsStore, onApply: @escaping (ReportRange) -> Void) {
        self.store = store
        self.onApply = onApply
        _selection = State(initialValue: ReportMonthSelection(range: store.range))
    }

    private var months: [String] {
        ReportDates.months(
            from: min(store.availableMonths.first ?? store.range.start, store.range.start),
            through: store.today)
    }

    private var years: [String] { Array(Set(months.map { String($0.prefix(4)) })).sorted() }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(selection.range.monthLabel)
                    .font(.subheadline.weight(.semibold))
                Text(
                    selection.isComplete
                        ? L10n.string("Select a start month.")
                        : L10n.string("Now select an end month.")
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }.padding(.horizontal, 24)
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 20) {
                        ForEach(years, id: \.self) { year in
                            VStack(alignment: .leading, spacing: 12) {
                                Text(year)
                                    .font(.title2.weight(.bold).monospacedDigit())
                                    .accessibilityAddTraits(.isHeader)
                                LazyVGrid(
                                    columns: Array(
                                        repeating: GridItem(.flexible(), spacing: 8),
                                        count: dynamicTypeSize.isAccessibilitySize ? 2 : 3),
                                    spacing: 8
                                ) {
                                    ForEach(months.filter { $0.hasPrefix(year) }, id: \.self) {
                                        month in
                                        monthButton(month)
                                    }
                                }
                            }.id(year)
                        }
                    }.padding(.horizontal, 24).padding(.bottom, 24)
                }
                .onAppear { scroll.scrollTo(String(store.range.end.prefix(4)), anchor: .top) }
            }
        }
        .padding(.top, 8)
        .fontDesign(.rounded)
        .foregroundStyle(KualiaPalette.ink)
        .navigationTitle(L10n.string("Custom"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L10n.string("Apply")) { onApply(selection.range) }
                    .fontWeight(.semibold)
                    .disabled(!selection.isComplete)
                    .accessibilityIdentifier("reports.range.apply")
            }
        }
        .accessibilityIdentifier("reports.range.months")
    }

    private func monthButton(_ month: String) -> some View {
        let selected = selection.range.contains(month)
        return Button {
            selection.select(month, today: store.today)
        } label: {
            Text(
                ReportDates.date(month).formatted(
                    Date.FormatStyle(locale: L10n.locale, timeZone: .gmt).month(.abbreviated))
            )
            .font(.body.weight(selected ? .semibold : .medium))
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(selected ? KualiaPalette.surface : KualiaPalette.ink)
            .background(
                selected ? KualiaPalette.ink : KualiaPalette.surface,
                in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.kualiaHaptic)
        .accessibilityLabel(ReportDates.monthLabel(month))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("reports.range.month.\(month)")
    }
}
