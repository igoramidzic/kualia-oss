#if DEBUG
    import Combine
    import Foundation

    extension ScreenshotDemoData {
        var reportProvider: ScreenshotDemoReports {
            .init(
                workspaceID: workspace.id, records: records,
                accounts: accounts.map { .init(id: $0.id, title: $0.name) },
                categories: categories.map { .init(id: $0.id, title: $0.name) })
        }
        func makeSession() -> AppSessionStore {
            AppSessionStore(
                defaults: nil,
                workspaceSubscription: { Self.publisher([self.workspace]) },
                profileSubscription: {
                    Self.publisher(.init(activeWorkspaceId: self.workspace.id))
                },
                sessionFactory: { _ in self.makeWorkspaceSession() },
                selectionHandler: { _ in throw ScreenshotDemoError.unavailable })
        }

        func makeWorkspaceSession() -> HomeWorkspaceSession {
            let budget = BudgetStore(
                now: { self.now }, defaults: nil, workspaceID: workspace.id,
                structureSubscription: { Self.publisher(self.structure) },
                snapshotSubscription: { _, month in
                    Self.publisher(self.budgetSnapshot(month: month))
                },
                assignmentHandler: { _ in throw ScreenshotDemoError.unavailable })
            let accounts = AccountsStore(
                now: { self.now }, workspaceID: workspace.id,
                transactionStoreFactory: { self.makeFeed(accountID: $0) },
                connectionStoreFactory: { self.makeConnections(purpose: $0) },
                accountsSubscription: { _ in Self.publisher(self.accounts) },
                historySubscription: { _, _ in
                    Self.publisher(
                        .init(months: self.history, currentMonth: self.monthKey(self.month)))
                },
                transactionsChecker: { _, id in self.records.contains { $0.accountId == id } })
            let reports = ReportsStore(
                workspaceID: workspace.id, now: { self.now },
                historyLoader: { request in
                    let records = self.reportProvider.records
                    let start = min(Int(request.cursor ?? "") ?? 0, records.count)
                    let end = min(start + 200, records.count)
                    return .init(
                        page: Array(records[start..<end]), continueCursor: String(end),
                        isDone: end == records.count)
                })
            let home = HomeDashboardStore(
                workspaceID: workspace.id, subscribe: { _, _ in Self.publisher(self.briefing) })
            return .init(
                workspace: workspace, budget: budget, transactions: makeFeed(), accounts: accounts,
                home: home, reports: reports)
        }

        func makeFeed(accountID: String? = nil) -> TransactionFeedStore {
            TransactionFeedStore(
                bankAccountID: accountID, workspace: feedWorkspace,
                detailStoreFactory: { self.makeTransactionDetail(id: $0) },
                creationStoreFactory: { self.makeTransactionCreation() },
                searchStoreFactory: { filters, loadsAll in
                    self.makeSearch(filters, loadsAllPages: loadsAll)
                },
                categoryHistoryFactory: { id in
                    BudgetCategoryHistoryStore(month: self.month) {
                        (-11...0).map { offset in
                            let month = BudgetMonth.offset(self.month, by: offset)
                            let sum = self.records.filter {
                                $0.date.hasPrefix(self.monthKey(month))
                            }
                            .flatMap(\.movements).filter { $0.categoryId == id && $0.amount < 0 }
                            .reduce(Decimal.zero) { $0 - $1.amount }
                            return .init(id: month, spent: sum)
                        }
                    }
                },
                plannedStoreFactory: { workspace in
                    PlannedStore(
                        workspace: workspace, now: { self.now },
                        editorFactory: { self.makeTransactionCreation() },
                        subscription: { _, _ in Self.publisher(self.planned) },
                        actionHandler: { _, _, _, _ in throw ScreenshotDemoError.unavailable })
                },
                subscriptionFactory: { request in
                    let entries = self.records.filter { entry in
                        (accountID == nil || entry.accountId == accountID)
                            && (request.filter == .all
                                || (request.filter == .pending && entry.status == "pending")
                                || (request.filter == .needsReview
                                    && entry.reviewStatus == "needs_review"))
                    }
                    return Self.publisher(
                        self.feedResponse(
                            entries: entries, cursor: request.cursor, limit: request.numItems))
                })
        }

        func makeSearch(_ filters: TransactionSearchFilters, loadsAllPages: Bool)
            -> TransactionSearchStore
        {
            .init(
                workspace: feedWorkspace, filters: filters, loadsAllPages: loadsAllPages,
                pageLoader: {
                    self.feedResponse(
                        entries: self.searchEntries($0.filters), cursor: $0.cursor, limit: 100)
                },
                choicesLoader: {
                    .init(
                        accounts: self.accounts.map {
                            .init(
                                id: $0.id, title: $0.name, subtitle: nil, symbol: nil,
                                logoURL: $0.resolvedLogoUrl.flatMap(URL.init(string:)))
                        },
                        categories: self.categories.map {
                            .init(id: $0.id, title: $0.name, subtitle: nil, symbol: nil)
                        })
                })
        }

        var planned: PlannedData {
            var schedules: [PlannedSchedule] = []
            var occurrences: [String: [PlannedOccurrence]] = [:]
            for payment in Self.scheduledPayments {
                let id = "demo-schedule-\(payment.id)"
                func dates(in month: Int) -> [String] {
                    PlannedCalendarGrid.days(in: month, calendar: ReportDates.calendar)
                        .filter { $0.isCurrentMonth && payment.occurs(on: $0.date) }.map(\.key)
                }
                let next = (dates(in: month) + dates(in: BudgetMonth.offset(month, by: 1)))
                    .first { $0 > today }!
                let category =
                    categories.first { $0.id == payment.categoryID }?.name ?? L10n.string("Income")
                let bankID = payment.accountID
                let bankName = accounts.first { $0.id == bankID }!.name
                schedules.append(
                    .init(
                        _id: id, workspaceId: workspace.id, bankAccountId: bankID,
                        transferToAccountId: nil,
                        transactionType: "regular", merchantId: payment.logo ?? payment.categoryID,
                        merchantName: payment.name,
                        merchantLogoUrl: payment.logo.map(Self.logo),
                        bankAccountName: bankName, transferToAccountName: nil,
                        notes: nil, entryStatus: .cleared, entryMode: .automatic,
                        recurrence: payment.isWeekly ? .weekly : .monthly,
                        anchorDate: dates(in: BudgetMonth.offset(month, by: -11)).first!,
                        nextDate: next, status: "active",
                        movements: [
                            .init(
                                amount: payment.amount, categoryId: payment.categoryID,
                                categoryName: category,
                                readyToAssign: false, notes: nil)
                        ]))
                for offset in -11...2 {
                    let selected = BudgetMonth.offset(month, by: offset)
                    for key in dates(in: selected) {
                        let paid = key <= today
                        let recorded = records.filter {
                            $0.id == payment.transactionID(date: key)
                        }
                        let paidAmount = NSDecimalNumber(
                            decimal: recorded.reduce(Decimal.zero) { $0 + abs($1.amount) }
                        ).int64Value
                        occurrences[String(selected), default: []].append(
                            .init(
                                scheduledTransactionId: id, occurrenceDate: key, displayDate: key,
                                isTransfer: false,
                                coverage: .init(
                                    status: paid ? .paid : .upcoming,
                                    expectedAmount: payment.amount,
                                    paidAmount: paid ? paidAmount : 0,
                                    linkedTransactions: paid
                                        ? records.filter {
                                            $0.id == payment.transactionID(date: key)
                                        }.map { .init(transactionId: $0.id) } : [])))
                    }
                }
            }
            return .init(
                today: today,
                availableRange: .init(
                    minYearMonth: BudgetMonth.offset(month, by: -11),
                    maxYearMonth: BudgetMonth.offset(month, by: 2)),
                allPlannedTransactions: schedules, plannedByMonth: occurrences)
        }

        var briefing: HomeBriefing {
            let through = ReportDates.key(ReportDates.add(.day, 7, to: ReportDates.date(today)))
            let data = planned
            let allOccurrences: [PlannedOccurrence] = data.plannedByMonth.values.flatMap { $0 }
            let upcoming: [HomeBriefing.Occurrence] = allOccurrences.filter {
                $0.coverage.status == .upcoming && $0.displayDate >= today
                    && $0.displayDate <= through
            }
            .sorted { $0.displayDate < $1.displayDate }.compactMap {
                occurrence -> HomeBriefing.Occurrence? in
                guard
                    let schedule = data.allPlannedTransactions.first(where: {
                        $0.id == occurrence.scheduledTransactionId
                    })
                else { return nil }
                let days = ReportRange(start: today, end: occurrence.displayDate).dayCount - 1
                let amount = String(occurrence.coverage.expectedAmount)
                return HomeBriefing.Occurrence(
                    logoUrl: schedule.merchantLogoUrl, id: schedule.id, name: schedule.name,
                    accountName: schedule.bankAccountName ?? "", date: occurrence.displayDate,
                    day: days,
                    amount: amount, isTransfer: false,
                    transferToAccountName: nil)
            }
            let review = records.filter { $0.reviewStatus == "needs_review" }.prefix(5).map {
                HomeBriefing.Entry(
                    id: $0.id, name: $0.merchantName, accountName: $0.accountName, date: $0.date,
                    amount: NSDecimalNumber(decimal: $0.amount).stringValue)
            }
            let weekStart = ReportDates.key(ReportDates.add(.day, -6, to: ReportDates.date(today)))
            let previousStart = ReportDates.key(
                ReportDates.add(.day, -7, to: ReportDates.date(weekStart)))
            func spending(_ start: String, _ end: String) -> String {
                NSDecimalNumber(
                    decimal: records.filter { $0.date >= start && $0.date <= end && $0.amount < 0 }
                        .reduce(0) { $0 - $1.amount }
                ).stringValue
            }
            let outlooks: [HomeBriefing.Account] = accounts.filter { $0.category == .banking }.map {
                account in
                let points: [HomeBriefing.Account.Point] = (0...7).map { day in
                    let change: Int64 = upcoming.filter {
                        $0.day <= day && $0.accountName == account.name
                    }.reduce(Int64.zero) { $0 + (Int64($1.amount) ?? 0) }
                    return HomeBriefing.Account.Point(
                        day: day, amount: String(account.currentBalance + change))
                }
                let low = points.min { (Int64($0.amount) ?? 0) < (Int64($1.amount) ?? 0) }!
                return .init(
                    id: account.id, name: account.name,
                    currentBalance: String(account.currentBalance), points: points,
                    lowestDay: low.day, lowestBalance: low.amount,
                    hasUpcoming: upcoming.contains { $0.accountName == account.name })
            }
            return .init(
                workspace: .init(
                    id: workspace.id, name: workspace.name,
                    currencyCode: workspace.currencyCode ?? "USD",
                    minorUnit: 2,
                    timezoneIdentifier: "America/New_York"),
                today: today, throughDate: through, isPartial: false,
                reviews: .init(count: review.count, hasMore: false, items: review),
                uncategorized: .init(count: 0, hasMore: false, items: []),
                accounts: outlooks,
                upcoming: upcoming, upcomingCount: upcoming.count, overdue: [], overdueCount: 0,
                incoming: String(
                    upcoming.reduce(Int64.zero) { $0 + max(0, Int64($1.amount) ?? 0) }),
                outgoing: String(
                    upcoming.reduce(Int64.zero) { $0 + max(0, -(Int64($1.amount) ?? 0)) }),
                spending: .init(
                    current: spending(weekStart, today),
                    previous: spending(
                        previousStart,
                        ReportDates.key(ReportDates.add(.day, -1, to: ReportDates.date(weekStart)))),
                    currentStart: weekStart, previousStart: previousStart))
        }
    }
#endif
