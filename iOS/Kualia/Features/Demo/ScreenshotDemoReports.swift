#if DEBUG
    import Foundation

    nonisolated struct ScreenshotDemoReports {
        let workspaceID: String
        let records: [ReportEntry]
        let accounts: [ReportFilterOption]
        let categories: [ReportFilterOption]
        func matched(_ request: ReportSummaryRequest, range: ReportRange) -> [ReportMatchedEntry] {
            guard request.workspaceID == workspaceID else { return [] }
            return records.filter {
                range.contains($0.date) && request.filters.matches($0)
                    && (request.scope?.merchantID == nil
                        || request.scope?.merchantID == $0.merchantId)
            }.map(request.matching).filter { !$0.movements.isEmpty }
        }

        func report(_ request: ReportSummaryRequest) -> ReportAnalysis {
            let current = matched(request, range: request.range)
            let previous = matched(request, range: request.comparison)
            func totals(_ entries: [ReportMatchedEntry]) -> ReportTotals {
                let amounts = entries.flatMap(\.movements).map(\.amount)
                return .init(
                    outflow: amounts.reduce(0) { $0 + max(0, -$1) },
                    inflow: amounts.reduce(0) { $0 + max(0, $1) }, count: entries.count)
            }
            var result = ReportAnalysis(range: request.range)
            result.totals = totals(current)
            result.previous = totals(previous)
            let step = request.range.dayCount <= 45 ? 1 : request.range.dayCount <= 120 ? 7 : 30
            result.buckets = stride(from: 0, to: request.range.dayCount, by: step).map { offset in
                func bucketRange(_ range: ReportRange) -> ReportRange {
                    .init(
                        start: ReportDates.key(
                            ReportDates.add(.day, offset, to: ReportDates.date(range.start))),
                        end: min(
                            range.end,
                            ReportDates.key(
                                ReportDates.add(
                                    .day, offset + step - 1, to: ReportDates.date(range.start)))))
                }
                let range = bucketRange(request.range)
                let comparison = bucketRange(request.comparison)
                return .init(
                    range: range, totals: totals(current.filter { range.contains($0.entry.date) }),
                    previous: totals(previous.filter { comparison.contains($0.entry.date) }))
            }
            func ranks(merchants: Bool) -> [ReportRank] {
                let ids = Set(
                    (current + previous).flatMap {
                        merchants ? [$0.entry.merchantId] : $0.movements.map(\.categoryId)
                    })
                return ids.map { id in
                    let entries = current.filter {
                        merchants
                            ? $0.entry.merchantId == id
                            : $0.movements.contains { $0.categoryId == id }
                    }
                    let old = previous.filter {
                        merchants
                            ? $0.entry.merchantId == id
                            : $0.movements.contains { $0.categoryId == id }
                    }
                    func scoped(_ values: [ReportMatchedEntry]) -> [ReportMatchedEntry] {
                        values.map {
                            .init(
                                entry: $0.entry,
                                movements: merchants
                                    ? $0.movements : $0.movements.filter { $0.categoryId == id })
                        }
                    }
                    let sample = (entries + old).first!
                    let name =
                        merchants
                        ? sample.entry.merchantName
                        : sample.movements.first { $0.categoryId == id }!.categoryName
                    return ReportRank(
                        id: id, name: name, logoURL: merchants ? sample.entry.merchantLogoUrl : nil,
                        amount: totals(scoped(entries)).value(for: request.kind),
                        previousAmount: totals(scoped(old)).value(for: request.kind),
                        count: entries.count)
                }.sorted {
                    abs($0.amount) == abs($1.amount)
                        ? $0.id < $1.id : abs($0.amount) > abs($1.amount)
                }
            }
            result.categories = ranks(merchants: false)
            result.merchants = ranks(merchants: true)
            result.categoryCount = result.categories.filter { $0.count > 0 }.count
            result.merchantCount = result.merchants.filter { $0.count > 0 }.count
            result.spendingDays = Set(current.filter { $0.amount < 0 }.map { $0.entry.date }).count
            result.accounts = accounts
            result.categoryOptions =
                categories + [
                    .init(id: "income", title: L10n.string("Income"))
                ]
            let merchants = Dictionary(grouping: records, by: \.merchantId)
            result.merchantOptions = merchants.compactMap { id, entries in
                entries.first.map { .init(id: id, title: $0.merchantName) }
            }
            .sorted { $0.title < $1.title }
            return result
        }

        func reportPage(_ request: ReportPageRequest) -> ReportPage {
            let rows = matched(request.report, range: request.report.range).map(\.entry).filter {
                request.search.isEmpty
                    || "\($0.merchantName) \($0.accountName)".localizedCaseInsensitiveContains(
                        request.search)
            }
            let start = min(max(0, Int(request.cursor ?? "") ?? 0), rows.count)
            let end = min(start + 50, rows.count)
            return .init(
                page: Array(rows[start..<end]), continueCursor: String(end),
                isDone: end == rows.count)
        }
    }
#endif
