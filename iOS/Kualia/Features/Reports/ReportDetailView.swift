import SwiftUI

struct ReportDetailView: View {
    let store: ReportsStore
    let scope: ReportDrilldown
    @State private var model: ReportDetailStore
    @State private var selectedEntry: ReportEntry?
    @State private var search = ""

    init(store: ReportsStore, scope: ReportDrilldown) {
        self.store = store
        self.scope = scope
        _model = State(initialValue: ReportDetailStore(store: store, scope: scope))
    }

    private var kind: ReportKind { scope.kind ?? store.kind }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if let report = model.analysis {
                    header(report)
                    breakdown(report)
                } else if let error = model.summaryError {
                    Text(error).foregroundStyle(KualiaPalette.mutedInk)
                    Button(L10n.string("Try breakdown again")) {
                        Task { await model.loadSummary() }
                    }
                } else {
                    ProgressView(L10n.string("Loading breakdown…")).frame(
                        maxWidth: .infinity, minHeight: 120)
                }
                Text(L10n.string("Transactions")).font(
                    .system(.title3, design: .rounded, weight: .bold))
                Text(
                    L10n.string(
                        "Amounts show the activity matching your report. Open a transaction to see its full amount and every category."
                    )
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                ForEach(model.entries) { match in transactionRow(match) }
                if model.isLoading {
                    ProgressView(L10n.string("Loading activity…")).frame(maxWidth: .infinity)
                } else if let error = model.pageError {
                    Text(error).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
                    Button(L10n.string("Try activity again")) { Task { await model.loadMore() } }
                } else if !model.isDone {
                    Button(
                        model.entries.isEmpty
                            ? L10n.string("Keep looking for matches")
                            : L10n.string("Show more transactions")
                    ) {
                        Task { await model.loadMore() }
                    }.font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                } else if model.entries.isEmpty {
                    Text(L10n.string("No transactions match this search.")).foregroundStyle(
                        KualiaPalette.mutedInk)
                }
            }.padding(24)
        }
        .background(KualiaPalette.canvas).foregroundStyle(KualiaPalette.ink)
        .navigationTitle(scope.title).navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: L10n.string("Search transactions"))
        .task { await model.loadSummary() }
        .task(id: search) { await model.search(search) }
        .onDisappear { model.cancel() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(L10n.string("Done")) { store.detail = nil }
            }
        }
        .sheet(item: $selectedEntry) { entry in ReportTransactionSheet(entry: entry, store: store) }
    }

    private func header(_ report: ReportAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(report.range.label).font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            Text(store.money(report.totals.value(for: kind)))
                .font(.system(size: 36, weight: .semibold, design: .rounded))
                .lineLimit(1).minimumScaleFactor(0.5)
            Text(L10n.string("\(kind.title) across \(report.totals.count) transactions"))
                .font(.subheadline).foregroundStyle(KualiaPalette.mutedInk)
            ReportComparisonLabel(
                current: report.totals.value(for: kind),
                previous: report.previous.value(for: kind), money: store.money)
            Text(L10n.string("Compared with \(report.range.comparison(store.comparison).label)"))
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            if store.filters.count > 0 {
                Label(
                    L10n.string("Your \(store.filters.count) filters still apply"),
                    icon: .filter
                )
                .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
            }
        }
    }

    @ViewBuilder private func breakdown(_ report: ReportAnalysis) -> some View {
        if scope.categoryID == nil || scope.merchantID == nil {
            let byMerchant = scope.merchantID == nil
            let ranks = byMerchant ? report.merchants : report.categories
            let count = byMerchant ? report.merchantCount : report.categoryCount
            if !ranks.isEmpty {
                Text(byMerchant ? L10n.string("By merchant") : L10n.string("By category"))
                    .font(.system(.title3, design: .rounded, weight: .bold))
                LazyVStack(spacing: 0) {
                    ForEach(ranks) { row in
                        NavigationLink(value: nextScope(row, byMerchant: byMerchant)) {
                            ReportRankRow(
                                row: row, maximum: ranks.first?.amount ?? 0,
                                total: kind == .moneyIn
                                    ? report.totals.inflow : report.totals.outflow,
                                money: store.money, isMerchant: byMerchant,
                                tint: kind == .moneyIn
                                    ? KualiaPalette.reportInflow : KualiaPalette.reportOutflow)
                        }.buttonStyle(.plain)
                    }
                }.padding(.leading, -24)
                if count > ranks.count {
                    Text(
                        L10n.string(
                            "Top \(ranks.count) of \(count). All activity is included in the total and transaction list."
                        )
                    )
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk)
                }
            }
        }
    }

    private func transactionRow(_ match: ReportMatchedEntry) -> some View {
        Button {
            selectedEntry = match.entry
        } label: {
            HStack(spacing: 14) {
                ReportMerchantLogo(logoURL: match.entry.merchantLogoUrl)
                VStack(alignment: .leading, spacing: 6) {
                    Text(match.entry.merchantName).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(
                        "\(ReportDates.date(match.entry.date).formatted(Date.FormatStyle(locale: L10n.locale, timeZone: .gmt).month(.abbreviated).day())) · \(match.entry.accountName)"
                    )
                    .font(.caption).foregroundStyle(KualiaPalette.mutedInk).lineLimit(1)
                    if match.entry.status == "pending" {
                        Text(L10n.string("Pending")).font(.caption2).foregroundStyle(
                            KualiaPalette.mutedInk)
                    }
                }
                Spacer(minLength: 0)
                Text(store.money(match.amount)).font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.7)
                KualiaIconImage(icon: .chevronRight, size: 11).font(.caption2.weight(.bold))
                    .foregroundStyle(
                        KualiaPalette.mutedInk)
            }.frame(minHeight: 50)
                .background(KualiaPalette.surface)
                .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityElement(children: .combine)
    }

    private func nextScope(_ rank: ReportRank, byMerchant: Bool) -> ReportDrilldown {
        var next = scope
        next.title = rank.name
        if byMerchant { next.merchantID = rank.id } else { next.categoryID = rank.id }
        return next
    }
}

private struct ReportTransactionSheet: View {
    let entry: ReportEntry
    let store: ReportsStore
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        ReportMerchantLogo(logoURL: entry.merchantLogoUrl, size: 48)
                        Text(entry.merchantName).font(
                            .system(.title2, design: .rounded, weight: .bold))
                        Text(store.money(entry.amount)).font(
                            .system(size: 38, weight: .semibold, design: .rounded)
                        )
                        .lineLimit(1).minimumScaleFactor(0.5)
                    }
                    VStack(spacing: 16) {
                        LabeledContent(
                            L10n.string("Date"),
                            value: ReportDates.date(entry.date).formatted(
                                Date.FormatStyle(date: .long, time: .omitted, timeZone: .gmt)))
                        LabeledContent(L10n.string("Account"), value: entry.accountName)
                        LabeledContent(
                            L10n.string("Status"),
                            value: TransactionFeedStatus(rawValue: entry.status)?.title
                                ?? entry.status)
                        LabeledContent(
                            L10n.string("Review"),
                            value: entry.reviewStatus == "reviewed"
                                ? L10n.string("Reviewed") : L10n.string("Needs review"))
                    }.font(.subheadline)
                    VStack(alignment: .leading, spacing: 16) {
                        Text(
                            entry.movements.count > 1
                                ? L10n.string("The full split") : L10n.string("Category")
                        )
                        .font(.system(.headline, design: .rounded))
                        ForEach(Array(entry.movements.enumerated()), id: \.offset) { _, movement in
                            HStack(alignment: .firstTextBaseline) {
                                Text(movement.categoryName)
                                Spacer()
                                Text(store.money(movement.amount)).monospacedDigit()
                            }.font(.subheadline)
                        }
                    }.padding(20).background(
                        KualiaPalette.surface, in: RoundedRectangle(cornerRadius: 22))
                    if let notes = entry.notes, !notes.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(L10n.string("Notes")).font(.headline)
                            Text(notes).font(.subheadline).textSelection(.enabled)
                        }
                    }
                }.padding(24)
            }.background(KualiaPalette.canvas).foregroundStyle(KualiaPalette.ink)
                .navigationTitle(L10n.string("Transaction")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(L10n.string("Done")) { dismiss() }
                    }
                }
        }.tint(KualiaPalette.ink)
    }
}
