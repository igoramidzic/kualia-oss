import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogService } from '@spartan-ng/helm/dialog';
import { NucleoIcon, nucleoSkip as SkipForward } from '@kualia/icons';

export interface SkippablePlannedTransaction {
  merchantName?: string;
  transferToAccountName?: string;
  nextDate: string;
  recurrence: string;
}

interface SkipPlannedTransactionDialogContext {
  scheduledTransaction: SkippablePlannedTransaction;
  onClose: (confirmed?: boolean) => void;
}

@Component({
  selector: 'app-skip-planned-transaction-dialog',
  imports: [HlmButton, HlmDialogHeader, HlmDialogFooter, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Skip this occurrence?</h2>
    </hlm-dialog-header>

    <div class="space-y-3 p-4">
      <div class="bg-accent/50 flex items-start gap-3 rounded-md border p-3">
        <nucleo-icon [icon]="SkipForward" class="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ payeeName() }}</p>
          <p class="text-muted-foreground text-sm">{{ dueDateLabel() }} will be skipped without entering it.</p>
        </div>
      </div>

      <p class="text-muted-foreground text-sm">{{ resultDescription() }}</p>
    </div>

    <hlm-dialog-footer class="flex-row justify-end gap-2">
      <button hlmBtn type="button" variant="outline" size="sm" (click)="cancel()">Cancel</button>
      <button hlmBtn type="button" variant="default" size="sm" (click)="confirm()">Skip</button>
    </hlm-dialog-footer>
  `,
})
export class SkipPlannedTransactionDialogComponent {
  protected readonly SkipForward = SkipForward;

  protected readonly dialogContext = injectBrnDialogContext<SkipPlannedTransactionDialogContext>();
  protected readonly scheduledTransaction = this.dialogContext.scheduledTransaction;

  protected readonly payeeName = computed(
    () =>
      this.scheduledTransaction.merchantName ?? this.scheduledTransaction.transferToAccountName ?? 'Planned transaction'
  );

  protected readonly dueDateLabel = computed(() => {
    const [year, month, day] = this.scheduledTransaction.nextDate.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  });

  protected readonly resultDescription = computed(() =>
    this.scheduledTransaction.recurrence === 'once'
      ? 'The one-time schedule will be completed without creating a transaction.'
      : 'Only this occurrence will be skipped. Other unpaid occurrences will remain due.'
  );

  protected cancel(): void {
    this.dialogContext.onClose(false);
  }

  protected confirm(): void {
    this.dialogContext.onClose(true);
  }
}

export function confirmSkipPlannedTransaction(
  dialogService: HlmDialogService,
  scheduledTransaction: SkippablePlannedTransaction
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

    const dialogRef = dialogService.open(SkipPlannedTransactionDialogComponent, {
      context: {
        scheduledTransaction,
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
