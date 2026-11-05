import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogService } from '@spartan-ng/helm/dialog';
import type { ScheduledTransactionWithRelations } from 'convex/scheduledTransactions/queries';
import { nucleoCalendarCheck as CalendarArrowDown, NucleoIcon } from '@kualia/icons';

interface EnterScheduledTransactionDialogContext {
  scheduledTransaction: ScheduledTransactionWithRelations;
  dateIso: string;
  onClose: (confirmed?: boolean) => void;
}

@Component({
  selector: 'app-enter-scheduled-transaction-dialog',
  imports: [HlmButton, HlmDialogHeader, HlmDialogFooter, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Enter scheduled transaction?</h2>
    </hlm-dialog-header>

    <div class="space-y-3 p-4">
      <div class="bg-accent/50 flex items-start gap-3 rounded-md border p-3">
        <nucleo-icon [icon]="CalendarArrowDown" class="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ merchantName() }}</p>
          <p class="text-muted-foreground text-sm">
            {{ dueDateLabel() }} is today or earlier. Enter this transaction into the register now?
          </p>
        </div>
      </div>

      <p class="text-muted-foreground text-sm">{{ resultDescription() }}</p>
    </div>

    <hlm-dialog-footer class="flex-row justify-end gap-2">
      <button hlmBtn type="button" variant="outline" size="sm" (click)="cancel()">Cancel</button>
      <button hlmBtn type="button" variant="default" size="sm" (click)="confirm()">Enter transaction</button>
    </hlm-dialog-footer>
  `,
})
export class EnterScheduledTransactionDialogComponent {
  protected readonly CalendarArrowDown = CalendarArrowDown;

  protected readonly dialogContext = injectBrnDialogContext<EnterScheduledTransactionDialogContext>();
  protected readonly scheduledTransaction = this.dialogContext.scheduledTransaction;

  protected readonly merchantName = computed(
    () =>
      this.scheduledTransaction.merchantName ??
      this.scheduledTransaction.transferToAccountName ??
      'Scheduled transaction'
  );

  protected readonly dueDateLabel = computed(() => {
    const [year, month, day] = this.dialogContext.dateIso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  });

  protected readonly resultDescription = computed(() =>
    this.scheduledTransaction.recurrence === 'once'
      ? 'The one-time schedule will be completed after the transaction is created.'
      : 'The schedule will move to its next occurrence after the transaction is created.'
  );

  protected cancel(): void {
    this.dialogContext.onClose(false);
  }

  protected confirm(): void {
    this.dialogContext.onClose(true);
  }
}

export function confirmEnterScheduledTransaction(
  dialogService: HlmDialogService,
  scheduledTransaction: ScheduledTransactionWithRelations,
  dateIso: string
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;

    const settle = (confirmed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(confirmed);
    };

    const dialogRef = dialogService.open(EnterScheduledTransactionDialogComponent, {
      context: {
        scheduledTransaction,
        dateIso,
        onClose: (confirmed?: boolean) => {
          settle(confirmed === true);
          dialogRef.close();
        },
      },
      contentClass: 'max-w-full sm:w-md',
    });

    dialogRef.closed$.subscribe(() => {
      settle(false);
    });
  });
}
