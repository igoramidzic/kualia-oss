import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogService, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmRadioGroupImports } from '@spartan-ng/helm/radio-group';
import { nucleoCheckCircle as CheckCircle2, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';

import { api } from 'convex/_generated/api';
import type { Doc } from 'convex/_generated/dataModel';
import { ConvexService } from '../../../services/convex.service';
import { CurrencyService } from '../../../services/currency.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { CurrencyInputComponent } from '../../../shared/components/currency-input/currency-input.component';

type BankAccount = Doc<'bankAccount'>;

interface DialogContext {
  bankAccount: BankAccount;
  onClose?: (result?: unknown) => void;
}

@Component({
  selector: 'app-reconcile-bank-account-dialog',
  imports: [
    FormsModule,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmDialogFooter,
    HlmButton,
    HlmLabel,
    HlmRadioGroupImports,
    NucleoIcon,
    CurrencyInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reconcile-bank-account-dialog.html',
})
export class ReconcileBankAccountDialogComponent {
  private readonly convex = inject(ConvexService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);

  protected readonly CheckCircle2 = CheckCircle2;

  // Dialog context
  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();
  protected readonly bankAccount = this.dialogContext.bankAccount;

  // View children for radio containers
  protected readonly radioConfirm = viewChild<ElementRef<HTMLDivElement>>('radioConfirm');
  protected readonly radioAdjust = viewChild<ElementRef<HTMLDivElement>>('radioAdjust');

  // Wizard state
  readonly step = signal<1 | 2>(1);

  // Flow state
  readonly flowType = signal<'confirm' | 'adjust'>('confirm');

  // Form state
  readonly reportedBalance = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);

  // Computed values
  readonly currentBalance = computed((): bigint => {
    return this.bankAccount.clearedBalance ?? this.bankAccount.currentBalance;
  });

  readonly pendingBalance = computed((): bigint => {
    return this.bankAccount.pendingBalance ?? 0n;
  });

  readonly totalBalance = computed((): bigint => {
    return this.bankAccount.currentBalance;
  });

  readonly reportedBalanceInCents = computed((): bigint | null => {
    const value = this.reportedBalance();
    if (value === null) return null;
    return BigInt(value);
  });

  readonly difference = computed((): bigint | null => {
    if (this.flowType() === 'confirm') return 0n;

    const reported = this.reportedBalanceInCents();
    if (reported === null) return null;

    const current = this.currentBalance();
    return reported - current;
  });

  readonly hasDifference = computed(() => {
    const diff = this.difference();
    return diff !== null && diff !== 0n;
  });

  readonly isStep1Valid = computed(() => {
    if (this.flowType() === 'confirm') return true;

    const reported = this.reportedBalanceInCents();
    return reported !== null;
  });

  readonly canProceedToStep2 = computed(() => this.isStep1Valid());

  // Formatting helpers
  formatCurrency(amountInCents: bigint): string {
    return this.currencyService.format(amountInCents);
  }

  formatCurrencyWithSign(amountInCents: bigint): string {
    return this.currencyService.formatWithSign(amountInCents);
  }

  // Actions
  nextStep(): void {
    if (this.step() === 1 && this.canProceedToStep2()) {
      this.step.set(2);
      this.errorMessage.set(null);
    } else if (this.step() === 2) {
      void this.submit();
    }
  }

  previousStep(): void {
    if (this.step() === 2) {
      this.step.set(1);
      this.errorMessage.set(null);
    }
  }

  onRadioGroupKeydown(event: KeyboardEvent): void {
    // Allow tab navigation between radio options by preventing default radio group behavior
    // and managing focus manually
    const target = event.target as HTMLElement;

    // Check if we're on one of the radio containers
    const isOnConfirm =
      target === this.radioConfirm()?.nativeElement || target.closest('div') === this.radioConfirm()?.nativeElement;
    const isOnAdjust =
      target === this.radioAdjust()?.nativeElement || target.closest('div') === this.radioAdjust()?.nativeElement;

    // Handle Tab key to move between radio options
    if (event.key === 'Tab' && !event.shiftKey && isOnConfirm) {
      event.preventDefault();
      this.radioAdjust()?.nativeElement.focus();
    } else if (event.key === 'Tab' && event.shiftKey && isOnAdjust) {
      event.preventDefault();
      this.radioConfirm()?.nativeElement.focus();
    }
  }

  submit(): void {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.errorMessage.set('No workspace selected');
      return;
    }

    const reportedBalance = this.flowType() === 'confirm' ? undefined : this.reportedBalanceInCents();

    if (this.flowType() === 'adjust' && reportedBalance === null) {
      this.errorMessage.set('Invalid balance amount');
      return;
    }

    // Close dialog immediately
    this.close();

    // Format today's date in local timezone (YYYY-MM-DD)
    // Note: We can't use toISOString() because it converts to UTC which may shift the date
    const now = new Date();
    const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Create the reconciliation promise
    const reconcilePromise = this.convex
      .mutation(api.bankAccounts.reconcileBankAccount, {
        workspaceId,
        bankAccountId: this.bankAccount._id,
        reportedBalance,
        reconciliationDate: localDateStr,
      })
      .then((result) => {
        type ReconcileResult = {
          reconciledTransactionCount: number;
          adjustmentCreated: boolean;
          balanceAdjustmentAmount: bigint;
        };

        const typedResult = result as ReconcileResult;
        const count = typedResult.reconciledTransactionCount ?? 0;
        const adjustmentAmount = typedResult.balanceAdjustmentAmount ?? 0n;

        // Build message parts
        const parts: string[] = ['Reconciled successfully'];

        if (count > 0) {
          parts.push(`${count} transaction${count === 1 ? '' : 's'}`);
        }

        if (typedResult.adjustmentCreated && adjustmentAmount !== 0n) {
          parts.push(`adjustment of ${this.formatCurrencyWithSign(adjustmentAmount)}`);
        }

        return parts.join(' • ');
      });

    // Show promise toast
    toast.promise(reconcilePromise, {
      loading: 'Reconciling...',
      success: (message) => message,
      error: (error) => (error instanceof Error ? error.message : 'Failed to reconcile account'),
    });
  }

  close(): void {
    const closeCallback = this.dialogContext.onClose;
    if (closeCallback) {
      closeCallback();
    }
    // If no callback provided, dialog service will handle close
  }

  cancel(): void {
    this.close();
  }
}
