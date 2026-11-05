import { computed, Injectable, signal } from '@angular/core';
import { TransactionWithRelations } from '../../services/transaction.service';

/**
 * Service to share transaction data between the transaction parent page and its child routes
 */
@Injectable()
export class TransactionPageService {
  private readonly _currentTransaction = signal<TransactionWithRelations | null>(null);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _transactionAmountEdit = signal<number>(0);

  readonly transaction = computed(() => this._currentTransaction());
  readonly populatedTransaction = computed(() => this._currentTransaction());
  readonly isLoading = computed(() => this._isLoading());
  readonly transactionAmountEdit = computed(() => this._transactionAmountEdit());

  setTransaction(transaction: TransactionWithRelations | null) {
    this._currentTransaction.set(transaction);
    // Initialize the edit amount when transaction is loaded
    if (transaction) {
      this._transactionAmountEdit.set(Number(transaction.amount));
    }
  }

  setTransactionAmountEdit(amount: number) {
    this._transactionAmountEdit.set(amount);
  }

  setLoading(isLoading: boolean) {
    this._isLoading.set(isLoading);
  }
}
