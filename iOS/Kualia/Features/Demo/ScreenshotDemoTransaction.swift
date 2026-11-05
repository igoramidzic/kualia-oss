#if DEBUG
    import Foundation

    extension ScreenshotDemoData {
        var editorChoices: TransactionEditorChoices {
            let accounts: [TransactionEditorAccount] = self.accounts.map {
                .init(
                    id: $0.id, name: $0.name, accountType: $0.accountType,
                    resolvedLogoUrl: $0.resolvedLogoUrl)
            }
            let categories: [TransactionEditorCategory] =
                self.categories.map {
                    .init(id: $0.id, name: $0.name, type: "expense")
                } + [.init(id: "income", name: L10n.string("Income"), type: "income")]
            let merchants: [TransactionEditorMerchant] = Dictionary(
                grouping: records, by: \.merchantId
            )
            .compactMap { id, entries in
                entries.first.map {
                    .init(id: id, name: $0.merchantName, logoUrl: $0.merchantLogoUrl)
                }
            }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            let schedules = planned.allPlannedTransactions.map {
                TransactionEditorPlannedTransaction(
                    id: $0.id, nextDate: $0.nextDate, bankAccountId: $0.bankAccountId,
                    merchantName: $0.merchantName, transferToAccountName: $0.transferToAccountName,
                    transferToAccountId: $0.transferToAccountId,
                    transactionType: $0.transactionType,
                    recurrence: $0.recurrence, merchantId: $0.merchantId, movements: $0.movements,
                    notes: $0.notes, status: $0.status, entryMode: $0.entryMode)
            }
            return .init(
                merchants: merchants, categories: categories, accounts: accounts,
                plannedTransactions: schedules)
        }

        func makeTransactionCreation() -> TransactionEditorStore {
            let choices = editorChoices
            return .init(
                workspace: feedWorkspace, now: { self.now }, choicesLoader: { _ in choices })
        }

        func makeTransactionDetail(id: String) -> TransactionEditorStore? {
            guard let entry = records.first(where: { $0.id == id }) else { return nil }
            let choices = editorChoices
            let merchant = TransactionEditorMerchant(
                id: entry.merchantId, name: entry.merchantName, logoUrl: entry.merchantLogoUrl)
            let detail = TransactionEditorDetail(
                id: entry.id, workspaceId: workspace.id, bankAccountId: entry.accountId,
                date: entry.date, type: .regular, status: .init(rawValue: entry.status) ?? .cleared,
                reviewStatus: .init(rawValue: entry.reviewStatus) ?? .reviewed,
                totalAmount: NSDecimalNumber(decimal: entry.amount).int64Value,
                movements: entry.movements.map { movement in
                    .init(
                        amount: NSDecimalNumber(decimal: movement.amount).int64Value,
                        categoryId: movement.categoryId,
                        categoryName: movement.categoryName, readyToAssign: false, notes: nil,
                        sortOrder: 0,
                        category: choices.categories.first { $0.id == movement.categoryId })
                }, merchantId: merchant.id, merchantName: merchant.name, notes: entry.notes,
                transferPairId: nil, transferPairBankAccountId: nil, transferPairAccountName: nil,
                isCrossBudgetTransfer: false, isCreditCardPayment: false,
                scheduledTransactionId: nil,
                importDetails: nil, linkedRawTransactionId: nil, source: nil, isDeleted: false,
                merchant: merchant,
                bankAccount: choices.accounts.first { $0.id == entry.accountId },
                suggestedTransfer: nil)
            return .init(
                workspace: feedWorkspace, transactionID: id, now: { self.now },
                detailLoader: { _, _ in detail },
                choicesLoader: { _ in choices })
        }
    }
#endif
