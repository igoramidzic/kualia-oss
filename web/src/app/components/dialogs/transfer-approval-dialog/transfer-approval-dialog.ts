import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoBank as Building2,
  nucleoCheck as Check,
  nucleoInfo as Info,
  nucleoLink as Link,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
} from '@kualia/icons';
import { BankAccountService } from '../../../services/bank-account.service';
import { TransactionService, TransactionWithRelations } from '../../../services/transaction.service';
import { CurrencyPipe } from '../../../shared/pipes/currency.pipe';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { formatCurrency } from '../../../shared/utils/formatters';

interface SuggestedTransfer {
  transferConfidence: number;
  accountConfidence?: number;
  suggestedCounterpartAccountId?: string;
  matchedTransactionId?: string;
  detectionReason: string;
  status: string;
}

@Component({
  selector: 'app-transfer-approval-dialog',
  imports: [HlmButton, HlmDialogHeader, HlmDialogFooter, NucleoIcon, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <div class="flex flex-col items-center gap-3 pb-2">
        <!-- Icon -->
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
          <nucleo-icon [icon]="ArrowLeftRightIcon" class="h-7 w-7 text-purple-600 dark:text-purple-400" />
        </div>

        <!-- Title -->
        <h2 class="text-lg font-semibold">
          {{ isLinkedTransfer() ? 'Possible Linked Transfer' : 'Possible Transfer' }}
        </h2>

        <!-- Confidence Badge -->
        <div class="bg-accent text-foreground flex items-center gap-1.5 rounded-full px-3 py-1">
          <span class="text-sm font-medium">{{ confidencePercent() }}% confidence</span>
        </div>

        <!-- Description -->
        <p class="text-muted-foreground text-center text-sm">
          {{
            isLinkedTransfer()
              ? 'Both sides of this transfer have been imported. Approve to link them together.'
              : accountSelectionDescription()
          }}
        </p>
      </div>
    </hlm-dialog-header>

    <div class="space-y-5 px-1 py-4">
      <!-- Transfer Details Card -->
      <div class="space-y-2">
        <p class="text-muted-foreground px-1 text-xs font-medium">Transfer Details</p>
        <div class="border-border overflow-hidden rounded-lg border">
          <!-- Amount -->
          <div class="flex items-center justify-between border-b px-4 py-3 text-sm">
            <span class="text-muted-foreground">Amount</span>
            <span class="font-medium">{{ toNumber(transaction().amount) | currency }}</span>
          </div>
          <!-- Date -->
          <div class="flex items-center justify-between border-b px-4 py-3 text-sm">
            <span class="text-muted-foreground">Date</span>
            <span>{{ formatDate(transaction().date) }}</span>
          </div>
          <!-- Account -->
          <div class="flex items-center justify-between border-b px-4 py-3 text-sm">
            <span class="text-muted-foreground">{{ currentAccountLabel() }}</span>
            <span>{{ sourceAccountName() }}</span>
          </div>
          <!-- Detection Reason -->
          @if (detectionReason()) {
            <div class="flex items-center justify-between px-4 py-3 text-sm">
              <span class="text-muted-foreground">Detected via</span>
              <span>{{ formatDetectionReason(detectionReason()!) }}</span>
            </div>
          }
        </div>
      </div>

      <!-- Account Selection (only for non-linked transfers) -->
      @if (!isLinkedTransfer()) {
        <div class="space-y-2">
          <p class="text-muted-foreground px-1 text-xs font-medium">{{ counterpartAccountLabel() }}</p>
          <div class="border-border overflow-hidden rounded-lg border">
            @for (account of availableAccounts(); track account._id) {
              <button
                type="button"
                class="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
                [class.border-b]="!$last"
                [disabled]="processing()"
                (click)="selectAccount(account._id)"
              >
                <!-- Account Icon -->
                <div class="bg-accent flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full">
                  <nucleo-icon [icon]="Building2Icon" class="text-muted-foreground h-4 w-4" />
                </div>

                <!-- Account Info -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium">{{ account.name }}</span>
                    @if (isSuggestedAccount(account._id)) {
                      <span
                        class="flex-shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
                      >
                        Suggested
                      </span>
                    }
                  </div>
                  <span class="text-muted-foreground text-xs">{{ formatAccountType(account.accountType) }}</span>
                </div>

                <!-- Selection Indicator -->
                <div class="flex-shrink-0">
                  @if (isSelectedAccount(account._id)) {
                    <div class="bg-primary flex h-5 w-5 items-center justify-center rounded-full">
                      <nucleo-icon [icon]="CheckIcon" class="h-3 w-3 text-white" />
                    </div>
                  } @else {
                    <div class="border-muted-foreground/30 h-5 w-5 rounded-full border-2"></div>
                  }
                </div>
              </button>
            }
          </div>
        </div>
      }

      <!-- Linked Transaction Card (only for linked transfers) -->
      @if (isLinkedTransfer() && matchedTransaction()) {
        <div class="space-y-2">
          <p class="text-muted-foreground px-1 text-xs font-medium">Linked Transaction</p>
          <div class="border-border overflow-hidden rounded-lg border">
            <div class="flex items-center justify-between border-b px-4 py-3 text-sm">
              <span class="text-muted-foreground">Amount</span>
              <span class="font-medium">{{ matchedTransaction()!.formattedAmount }}</span>
            </div>
            <div class="flex items-center justify-between border-b px-4 py-3 text-sm">
              <span class="text-muted-foreground">Date</span>
              <span>{{ matchedTransaction()!.formattedDate }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3 text-sm">
              <span class="text-muted-foreground">Account</span>
              <span>{{ matchedTransaction()!.accountName }}</span>
            </div>
          </div>
        </div>
      }

      <!-- Info Section -->
      <div class="bg-accent/50 flex items-start gap-2 rounded-lg p-3">
        <nucleo-icon [icon]="InfoIcon" class="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
        <p class="text-muted-foreground text-xs">
          {{
            isLinkedTransfer()
              ? 'Approving will link both transactions as a transfer. This action cannot be undone.'
              : confirmationDescription()
          }}
        </p>
      </div>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3 text-sm">
          {{ error() }}
        </div>
      }
    </div>

    <hlm-dialog-footer class="flex-col gap-2 sm:flex-col">
      <!-- Primary: Approve -->
      <button
        hlmBtn
        size="default"
        class="w-full"
        (click)="approveTransfer()"
        [disabled]="processing() || (!isLinkedTransfer() && !effectiveSelectedAccountId())"
      >
        @if (processing()) {
          <nucleo-icon [icon]="LoaderCircleIcon" class="h-4 w-4 animate-spin" />
        }
        {{ isLinkedTransfer() ? 'Approve Transfer' : 'Confirm as Transfer' }}
      </button>

      <!-- Secondary: Reject -->
      <button
        hlmBtn
        size="default"
        variant="outline"
        class="w-full"
        (click)="rejectTransfer()"
        [disabled]="processing()"
      >
        Not a Transfer
      </button>
    </hlm-dialog-footer>
  `,
})
export class TransferApprovalDialogComponent {
  protected readonly ArrowLeftRightIcon = ArrowLeftRight;
  protected readonly Building2Icon = Building2;
  protected readonly CheckIcon = Check;
  protected readonly InfoIcon = Info;
  protected readonly LinkIcon = Link;
  protected readonly LoaderCircleIcon = LoaderCircle;

  private readonly transactionService = inject(TransactionService);
  private readonly bankAccountService = inject(BankAccountService);

  // Inputs
  readonly transaction = input.required<TransactionWithRelations>();
  readonly currencyCode = input<string>('USD');

  // Outputs
  readonly approve = output<Id<'transaction'>>();
  readonly reject = output<Id<'transaction'>>();
  readonly closed = output<void>();

  // State
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedAccount = signal<{ transactionId: Id<'transaction'>; accountId: string } | null>(null);

  // Computed values
  readonly suggestedTransfer = computed((): SuggestedTransfer | null => {
    const raw = this.transaction();
    if ('suggestedTransfer' in raw && raw.suggestedTransfer) {
      return raw.suggestedTransfer;
    }
    return null;
  });

  readonly isLinkedTransfer = computed(() => {
    const suggestion = this.suggestedTransfer();
    return suggestion?.status === 'linked_pending_approval';
  });

  readonly confidencePercent = computed(() => {
    const suggestion = this.suggestedTransfer();
    return suggestion?.transferConfidence ?? 0;
  });

  readonly detectionReason = computed(() => {
    const suggestion = this.suggestedTransfer();
    return suggestion?.detectionReason ?? null;
  });

  readonly sourceAccountName = computed(() => {
    return this.transaction().bankAccount?.name ?? 'Unknown';
  });

  readonly isInflow = computed(() => this.transaction().amount > 0n);

  readonly currentAccountLabel = computed(() => (this.isInflow() ? 'To account' : 'From account'));

  readonly counterpartAccountLabel = computed(() => (this.isInflow() ? 'From account' : 'To account'));

  readonly accountSelectionDescription = computed(() =>
    this.isInflow()
      ? 'This inflow appears to be a transfer. Select the account it came from to confirm.'
      : 'This outflow appears to be a transfer. Select the account receiving it to confirm.'
  );

  readonly confirmationDescription = computed(() =>
    this.isInflow()
      ? 'Confirming will mark this as a transfer and create the paired outflow in the selected account.'
      : 'Confirming will mark this as a transfer and create the paired inflow in the selected account.'
  );

  readonly availableAccounts = computed(() => {
    const txn = this.transaction();
    return this.bankAccountService
      .bankAccounts()
      .filter((account) => !account.isDeleted && !account.isClosed && account._id !== txn.bankAccountId);
  });

  readonly suggestedAccountId = computed(() => {
    const suggestion = this.suggestedTransfer();
    return suggestion?.suggestedCounterpartAccountId ?? null;
  });

  readonly effectiveSelectedAccountId = computed(() => {
    const transactionId = this.transaction()._id;
    const selection = this.selectedAccount();
    return selection?.transactionId === transactionId ? selection.accountId : this.suggestedAccountId();
  });

  readonly matchedTransaction = computed(() => {
    const suggestion = this.suggestedTransfer();
    if (!suggestion?.matchedTransactionId) return null;

    // Try to find the matched transaction in the transaction list
    const transactions = this.transactionService.transactions();
    const matched = transactions.find((t) => t._id === suggestion.matchedTransactionId);

    if (matched) {
      return {
        formattedAmount: this.formatAmount(Number(matched.amount)),
        formattedDate: this.formatDate(matched.date),
        accountName: matched.bankAccount?.name ?? 'Unknown',
      };
    }

    return null;
  });

  toNumber(value: bigint | number): number {
    return typeof value === 'bigint' ? Number(value) : value;
  }

  formatDate(dateStr: string | undefined | null): string {
    if (!dateStr) return '—';
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  formatAmount(amount: number): string {
    return formatCurrency(amount, this.currencyCode());
  }

  formatDetectionReason(reason: string): string {
    switch (reason) {
      case 'plaid_transfer_code':
        return 'Bank categorization';
      case 'transfer_category':
        return 'Transfer category';
      case 'amount_match':
        return 'Matching amounts';
      case 'name_pattern':
        return 'Name pattern';
      default:
        return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  formatAccountType(accountType: string | undefined): string {
    if (!accountType) return 'Account';
    // Convert banking_checking to "Checking", credit_credit_card to "Credit Card", etc.
    return accountType
      .replace(/^(banking_|credit_|investment_|loan_)/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  selectAccount(accountId: string): void {
    if (this.processing()) return;
    this.selectedAccount.set({ transactionId: this.transaction()._id, accountId });
  }

  isSuggestedAccount(accountId: string): boolean {
    return accountId === this.suggestedAccountId();
  }

  isSelectedAccount(accountId: string): boolean {
    return accountId === this.effectiveSelectedAccountId();
  }

  async approveTransfer(): Promise<void> {
    if (this.processing()) return;

    const transactionId = this.transaction()._id;
    this.processing.set(true);
    this.error.set(null);

    try {
      let success: boolean;

      if (this.isLinkedTransfer()) {
        // Approve linked transfer (both sides already imported)
        success = await this.transactionService.approveLinkedTransfer(transactionId);
      } else {
        // Approve single-side transfer with selected account
        const counterpartAccountId = this.effectiveSelectedAccountId();
        success = await this.transactionService.approveTransferSuggestion(
          transactionId,
          counterpartAccountId ? (counterpartAccountId as Id<'bankAccount'>) : undefined
        );
      }

      if (this.transaction()._id !== transactionId) {
        this.processing.set(false);
        return;
      }

      if (success) {
        this.approve.emit(transactionId);
        this.closed.emit();
      } else {
        this.error.set('Failed to approve transfer');
        this.processing.set(false);
      }
    } catch (err: unknown) {
      if (this.transaction()._id !== transactionId) {
        this.processing.set(false);
        return;
      }
      this.error.set(extractConvexErrorMessage(err, 'Failed to approve transfer'));
      this.processing.set(false);
    }
  }

  async rejectTransfer(): Promise<void> {
    if (this.processing()) return;

    const transactionId = this.transaction()._id;
    this.processing.set(true);
    this.error.set(null);

    try {
      const success = await this.transactionService.rejectTransferSuggestion(transactionId);

      if (this.transaction()._id !== transactionId) {
        this.processing.set(false);
        return;
      }

      if (success) {
        this.reject.emit(transactionId);
        this.closed.emit();
      } else {
        this.error.set('Failed to reject transfer suggestion');
        this.processing.set(false);
      }
    } catch (err: unknown) {
      if (this.transaction()._id !== transactionId) {
        this.processing.set(false);
        return;
      }
      this.error.set(extractConvexErrorMessage(err, 'Failed to reject transfer suggestion'));
      this.processing.set(false);
    }
  }
}
