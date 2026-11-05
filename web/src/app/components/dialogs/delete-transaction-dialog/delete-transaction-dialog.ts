import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { CurrencyService } from '../../../services/currency.service';
import { TransactionService, TransactionWithRelations } from '../../../services/transaction.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

@Component({
  selector: 'app-delete-transaction-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Delete Transaction</h2>
    </hlm-dialog-header>

    <div class="p-4">
      <p class="text-muted-foreground text-sm">Are you sure you want to delete this transaction?</p>
      @if (transaction.notes) {
        <p class="text-foreground mt-2 font-medium">{{ transaction.notes }}</p>
      }
      <p class="text-foreground mt-2">Amount: {{ currencyService.format(transaction.amount) }}</p>
      <p class="mt-3 text-sm">This transaction will be moved to trash and permanently deleted after 30 days.</p>
    </div>

    @if (error()) {
      <div class="bg-destructive/10 text-destructive border-destructive/20 mb-4 rounded-lg border p-3">
        <p class="text-sm">{{ error() }}</p>
      </div>
    }

    <hlm-dialog-footer class="flex-col flex-row justify-end">
      <button hlmBtn size="sm" variant="outline" (click)="cancel()" [disabled]="deleting()">Cancel</button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDelete()" [disabled]="deleting()">
        @if (deleting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Deleting...
        } @else {
          Delete
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DeleteTransactionDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  protected readonly currencyService = inject(CurrencyService);
  private readonly transactionConvexService = inject(TransactionService);
  protected readonly dialogContext = injectBrnDialogContext<{
    transaction: TransactionWithRelations;
    onClose: (deleted?: boolean) => void;
  }>();

  protected readonly transaction = this.dialogContext.transaction;
  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);

  cancel() {
    this.dialogContext.onClose(false);
  }

  async confirmDelete() {
    if (this.deleting()) return;

    this.deleting.set(true);
    this.error.set(null);

    try {
      const success = await this.transactionConvexService.deleteTransaction(this.transaction._id);
      if (success) {
        this.dialogContext.onClose(true);
      } else {
        this.error.set('Failed to delete transaction');
        this.deleting.set(false);
      }
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to delete transaction'));
      this.deleting.set(false);
    }
  }
}
