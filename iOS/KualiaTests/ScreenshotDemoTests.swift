#if DEBUG
    import Foundation
    import Testing

    @testable import Kualia

    @MainActor struct ScreenshotDemoTests {
        private func fixture(_ date: String = "2026-09-09") -> ScreenshotDemoData {
            ScreenshotDemoData(now: ReportDates.date(date).addingTimeInterval(12 * 3600))
        }

        @Test func bankDemoShowsDisconnectedAndUpcomingReauthorizationCards() throws {
            let banks = fixture().bankConnectionExamples
            let disconnected = try #require(banks.first { $0.id == "demo-connection-amex" })
            let reauthorization = try #require(banks.first { $0.id == "demo-connection-chase" })
            #expect(disconnected.health == .disconnected)
            #expect(disconnected.review == .disconnected)
            #expect(reauthorization.health == .connected)
            #expect(reauthorization.review == .reauthorizationSoon)
            #expect(banks.filter { $0.review != nil }.count == 2)
            #expect(banks.allSatisfy { !$0.addedAccounts.isEmpty })
        }

        @Test func datasetIsDeterministicAndCoversEveryBrowsableMonth() {
            for date in ["2026-01-01", "2026-09-09", "2028-02-29"] {
                let demo = fixture(date)
                #expect(demo.records == fixture(date).records)
                #expect(demo.records.count > 900)
                #expect(demo.records.allSatisfy { $0.date <= demo.today })
                let snapshot = demo.budgetSnapshot(month: demo.month)
                #expect(snapshot.months.count == 14)
                #expect(snapshot.months.allSatisfy { $0.budgetData.count == demo.categories.count })
                #expect(demo.accounts.map(\.id).count == Set(demo.accounts.map(\.id)).count)
                #expect(demo.history.count == 12)
                #expect(
                    demo.history.allSatisfy { month in
                        month.accounts.allSatisfy { account in
                            demo.accounts.first { $0.id == account.accountId }?.category.isLiability
                                == true || account.balance >= 0
                        }
                    })
            }
        }

        @Test func monthlyFundingCoversTargetsAndSpendingInEveryDemoMonth() throws {
            for date in ["2026-01-01", "2026-09-09", "2028-02-29"] {
                let demo = fixture(date)
                for month in demo.budgetSnapshot(month: demo.month).months {
                    let targets = try #require(month.summary)
                    var funding = BudgetMonthlyFundingSummary(
                        targets: .init(
                            funded: Decimal(try #require(targets.totalFunded)),
                            remaining: Decimal(try #require(targets.totalRemainingToFund)),
                            total: Decimal(targets.totalTargetAmount)))
                    for amounts in month.budgetData.values {
                        #expect(amounts.available >= 0)
                        funding.includeSpending(
                            assigned: Decimal(amounts.assignedAmount),
                            available: Decimal(amounts.available),
                            target: amounts.target?.fundingSummary(assigned: amounts.assignedAmount)
                        )
                    }
                    #expect(funding.isFullyFunded)
                    #expect(funding.remaining == 0)
                    #expect(funding.percentage == 100)
                }
            }
        }

        @Test func assistantExampleRendersSavingsHeadingsAndCurrentBudgetAmounts() async throws {
            let demo = fixture()
            let answer = demo.assistantExampleAnswer
            let blocks = try await AssistantMarkdownRenderer.render(answer)
            #expect(blocks.filter(\.isHeading).count == 2)
            #expect(blocks.allSatisfy { !$0.isCode && $0.transaction == nil })
            #expect(answer.contains("✈️") && answer.contains("🛟") && answer.contains("✨"))
            let snapshot = demo.budgetSnapshot(month: demo.month)
            let current = try #require(snapshot.months.first { $0.yearMonth == demo.month })
            let travel = try #require(current.budgetData["travel"])
            let emergency = try #require(current.budgetData["emergency"])
            for amount in [travel.assignedAmount, emergency.available, snapshot.readyToAssign] {
                #expect(
                    answer.contains(
                        AccountMoney.string(Decimal(amount), workspace: demo.feedWorkspace)))
            }
        }

        @Test func demoLanguageSelectsOneCurrencyAcrossAllProviders() {
            let pairs: [(AppLanguage, String)] = [
                (.english, "USD"), (.spanish, "EUR"), (.german, "EUR"),
                (.italian, "EUR"), (.french, "EUR"), (.simplifiedChinese, "CNY"),
                (.serbian, "RSD"),
            ]
            for (language, currency) in pairs {
                let demo = ScreenshotDemoData(now: fixture().now, language: language)
                #expect(demo.workspace.currencyCode == currency)
                #expect(demo.feedWorkspace.currencyCode == currency)
                #expect(demo.structure.workspace?.currencyCode == currency)
                #expect(demo.briefing.workspace.currencyCode == currency)
                let settings = SettingsStore(demo: demo)
                #expect(settings.workspace(id: demo.workspace.id)?.currency == currency)
            }
            let deviceLanguage = AppLanguage.resolve(
                AppLanguage.system.languageCode(preferredLanguages: Locale.preferredLanguages))
            #expect(
                ScreenshotDemoMode.currencyCode(for: .system)
                    == ScreenshotDemoMode.currencyCode(for: deviceLanguage))
        }

        @Test func allNamedLogosAreBundledAndUnknownPathsAreRejected() {
            for name in ScreenshotDemoLogo.names {
                #expect(
                    ScreenshotDemoLogo.image(URL(string: ScreenshotDemoData.logo(name))!) != nil)
            }
            #expect(ScreenshotDemoLogo.image(URL(string: "https://example.com/chase")!) == nil)
            #expect(ScreenshotDemoLogo.image(URL(string: "kualia-demo://logo/unknown")!) == nil)
        }

        @Test func budgetActivityAndReportSpendingUseTheSameRecords() {
            let demo = fixture()
            let snapshot = demo.budgetSnapshot(month: demo.month).months.first {
                $0.yearMonth == demo.month
            }!
            let range = ReportRange(start: "2026-09-01", end: demo.today)
            let request = ReportSummaryRequest(
                workspaceID: demo.workspace.id, range: range,
                comparison: range.comparison(.previous),
                kind: .spending, filters: .init(includesPending: true))
            let report = demo.reportProvider.report(request)
            let activity = snapshot.budgetData.values.reduce(Int64.zero) { $0 + $1.activity }
            #expect(-Decimal(activity) == report.totals.outflow)
            let lastHistory = demo.history.last!
            for account in demo.accounts {
                #expect(
                    lastHistory.accounts.first { $0.accountId == account.id }?.balance
                        == account.currentBalance)
            }
        }

        @Test func accountHistoriesShowIndependentDepositsAndPayments() throws {
            let demo = fixture()
            var changesByAccount: [[Int64]] = []
            for account in demo.accounts {
                let balances = demo.history.compactMap { month in
                    month.accounts.first { $0.accountId == account.id }?.balance
                }
                #expect(balances.count == 12)
                #expect(balances.last == account.currentBalance)
                #expect(balances.allSatisfy { account.category.isLiability ? $0 < 0 : $0 > 0 })
                let changes = zip(balances.dropFirst(), balances).map { $0 - $1 }
                #expect(changes.contains { $0 > 0 })
                #expect(changes.contains { $0 < 0 })
                #expect(Set(changes).count > 5)
                changesByAccount.append(changes)
                let pending = try #require(account.pendingBalance)
                let cleared = try #require(account.clearedBalance)
                #expect(cleared + pending == account.currentBalance)
                let pendingTransactions = demo.records.filter {
                    $0.accountId == account.id && $0.status == "pending"
                }.reduce(Decimal.zero) { $0 + $1.amount }
                #expect(Decimal(pending) == pendingTransactions)
                #expect(demo.records.contains { $0.accountId == account.id })
            }
            #expect(Set(changesByAccount).count == demo.accounts.count)
        }

        @Test func dailySpendingHasVarietyWithoutOneChargeFlatteningTheChart() {
            for date in ["2026-01-31", "2026-09-09", "2028-02-29"] {
                let demo = fixture(date)
                let range = ReportRange(start: demo.monthKey(demo.month) + "-01", end: demo.today)
                let report = demo.reportProvider.report(
                    .init(
                        workspaceID: demo.workspace.id, range: range,
                        comparison: range.comparison(.previous), kind: .spending,
                        filters: .init(includesPending: true)))
                let daily = report.buckets.map { $0.totals.outflow }
                #expect(Set(daily).count >= 5)
                #expect(daily.allSatisfy { $0 >= 0 && $0 < 100_000 })
                #expect(daily.reduce(0, +) == report.totals.outflow)
                #expect(report.merchants.reduce(0) { $0 + $1.amount } == report.totals.outflow)
            }
        }

        @Test func weeklyRentAgreesWithPlannedPaymentsAcrossMonthBoundaries() throws {
            let demo = fixture()
            let planned = demo.planned
            let rent = try #require(
                planned.allPlannedTransactions.first { $0.merchantName == "Parkside Apartments" })
            #expect(rent.recurrence == .weekly)
            let occurrences = planned.plannedByMonth.values.flatMap { $0 }.filter {
                $0.scheduledTransactionId == rent.id
            }.sorted { $0.displayDate < $1.displayDate }
            for (next, previous) in zip(occurrences.dropFirst(), occurrences) {
                #expect(
                    ReportRange(start: previous.displayDate, end: next.displayDate).dayCount == 8)
            }
            for paid in occurrences where paid.coverage.status == .paid {
                #expect(paid.coverage.paidAmount == 46_250)
            }
        }

        @Test func paidPlansLinkToRecordedActivityAndUpcomingPlansStayInTheFuture() {
            let demo = fixture()
            for occurrence in demo.planned.plannedByMonth.values.flatMap({ $0 }) {
                if occurrence.coverage.status == .paid {
                    #expect(!occurrence.coverage.linkedTransactions.isEmpty)
                    #expect(occurrence.coverage.linkedTransactions.count == 1)
                    #expect(
                        occurrence.coverage.paidAmount == abs(occurrence.coverage.expectedAmount))
                    for link in occurrence.coverage.linkedTransactions {
                        #expect(
                            demo.records.contains {
                                $0.id == link.transactionId && $0.date == occurrence.displayDate
                            })
                    }
                } else {
                    #expect(occurrence.displayDate > demo.today)
                }
            }
        }

        @Test func plannedCalendarSpreadsKnownBrandsAcrossWeekdayColumns() {
            for date in ["2026-01-01", "2026-09-09", "2028-02-29"] {
                let demo = fixture(date)
                let planned = demo.planned
                let brands = Set(planned.allPlannedTransactions.compactMap(\.merchantLogoUrl))
                #expect(brands.count >= 10)
                for brand in [
                    "amazon", "walmart", "uber", "target", "wholefoods", "cvs", "starbucks",
                ] {
                    #expect(brands.contains(ScreenshotDemoData.logo(brand)))
                }
                for month in planned.plannedByMonth.values {
                    let dates = Set(month.map(\.displayDate))
                    let weekdays = Set(
                        dates.map {
                            ReportDates.calendar.component(.weekday, from: ReportDates.date($0))
                        })
                    #expect(dates.count >= 12)
                    #expect(weekdays.count == 7)
                }
            }
        }

        @Test func demoControlsOpenEditorsAndAttemptActionsWithoutPersisting() async throws {
            let demo = fixture()
            let session = demo.makeWorkspaceSession()
            session.prepare()
            for _ in 0..<100
            where !session.budget.hasLoaded || !session.accounts.hasLoaded
                || !session.transactions.hasLoaded
            {
                try? await Task.sleep(for: .milliseconds(10))
            }
            defer { session.reset() }
            #expect(
                session.budget.hasLoaded && session.accounts.hasLoaded
                    && session.transactions.hasLoaded)
            let account = demo.accounts[0]
            #expect(session.budget.canEdit && session.budget.canEditPlan)
            #expect(session.transactions.canCreateTransaction)
            #expect(session.transactions.canSearchTransactions)
            let creation = try #require(session.transactions.makeCreationEditor(date: "2026-09-08"))
            await creation.load()
            #expect(creation.isCreating)
            #expect(creation.draft?.dateKey == "2026-09-08")
            #expect(creation.choices.accounts.count == demo.accounts.count)
            #expect(creation.choices.merchants.contains { $0.name == "Netflix" })
            #expect(creation.choices.merchants.contains { $0.name == "Walmart" })
            #expect(creation.choices.categories.count == demo.categories.count + 1)
            #expect(!creation.choices.plannedTransactions.isEmpty)
            creation.selectAccount("chase")
            creation.selectMerchant("walmart")
            creation.selectCategory("groceries")
            creation.draft?.setAmount(1299)
            #expect(creation.canSave)
            #expect(await creation.save() == false)
            #expect(creation.saveErrorMessage != nil)
            let detail = try #require(session.transactions.makeEditor(for: demo.records[0].id))
            await detail.load()
            #expect(detail.draft != nil)
            detail.draft?.notes = "Demo edit"
            #expect(detail.canSave)
            #expect(detail.canDelete)
            #expect(await detail.save() == false)
            #expect(detail.saveErrorMessage != nil)
            #expect(await detail.delete() == false)
            let accountFeed = try #require(
                session.accounts.makeTransactionStore(accountID: account.id))
            let accountEditor = try #require(accountFeed.makeCreationEditor())
            accountEditor.preselectAccount(account.id)
            await accountEditor.load()
            #expect(accountEditor.draft?.accountID == account.id)
            let agenda = try #require(session.transactions.agenda)
            let schedule = try #require(demo.planned.allPlannedTransactions.first)
            let plannedEditor = try #require(agenda.makeEditor(schedule: schedule))
            await plannedEditor.load()
            #expect(plannedEditor.isEditingPlan)
            #expect(plannedEditor.plannedSchedule?.id == schedule.id)
            #expect(plannedEditor.choices.accounts.count == demo.accounts.count)
            let plannedCreation = try #require(
                agenda.makeEditor(date: "2026-09-24", recurrence: .monthly))
            await plannedCreation.load()
            #expect(plannedCreation.draft?.wantsToSchedule == true)
            #expect(plannedCreation.draft?.recurrence == .monthly)
            #expect(plannedCreation.draft?.dateKey == "2026-09-24")
            let entry = try #require(session.transactions.sections.flatMap(\.entries).first)
            session.transactions.beginSelection(entry)
            #expect(session.transactions.isSelecting)
            session.transactions.presentSelectionEditor()
            #expect(session.transactions.showsSelectionEditor)
            session.transactions.endSelection()
            await session.transactions.perform(.delete, on: entry)
            #expect(session.transactions.actionErrorMessage != nil)
            #expect(session.transactions.sections.flatMap(\.entries).contains { $0.id == entry.id })
            #expect(await session.accounts.delete(account: account) == false)
            #expect(session.accounts.actionErrorMessage != nil)
            let settings = SettingsStore(demo: demo)
            // Let SettingsAvatar resolve the signed-in user's image through Clerk.
            #expect(settings.profileImageData == nil)
            #expect(!settings.hasRemovedProfileImage)
            let original = settings.profile
            settings.saveName("Changed")
            settings.setNotificationsEnabled(false)
            settings.saveWorkspaceName(id: demo.workspace.id, name: "Changed")
            await settings.deleteAccount(confirmation: "DELETE")
            await settings.signOut()
            #expect(settings.profile == original)
            #expect(settings.workspace(id: demo.workspace.id)?.name == demo.workspace.name)
            #expect(!settings.isAccountDeleted)
            #expect(settings.workspace(id: demo.workspace.id)?.canManage == true)
        }
    }
#endif
