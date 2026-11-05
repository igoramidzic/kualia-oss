import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnSwitch } from '@spartan-ng/brain/switch';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { nucleoInfo as Info, nucleoLink as Link, nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { TransactionService, TransactionWithRelations } from '../../../services/transaction.service';
import { CurrencyPipe } from '../../../shared/pipes/currency.pipe';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

@Component({
  selector: 'app-transaction-link-comparison-dialog',
  imports: [HlmButton, HlmDialogHeader, HlmDialogFooter, HlmSwitch, BrnSwitch, NucleoIcon, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">
        {{ hasDiscrepancies() ? 'Resolve Differences' : 'Confirm Link' }}
      </h2>
    </hlm-dialog-header>

    <div class="space-y-5 p-4">
      <!-- Confidence Badge -->
      <div class="flex flex-col items-center gap-2">
        <div class="bg-accent text-foreground flex items-center gap-1.5 rounded-full px-3 py-1.5">
          <nucleo-icon [icon]="LinkIcon" class="h-4 w-4" />
          <span class="text-sm font-semibold">{{ confidencePercent() }}% Match</span>
        </div>
        <p class="text-muted-foreground text-center text-sm">
          {{
            hasDiscrepancies()
              ? 'Some details differ between your entry and the bank import'
              : 'Your entry matches the bank import'
          }}
        </p>
      </div>

      <!-- Comparison Table -->
      <div class="border-border overflow-hidden rounded-lg border">
        <!-- Header -->
        <div class="bg-accent/50 flex border-b text-xs font-medium">
          <div class="text-muted-foreground w-20 flex-shrink-0 px-3 py-2">Field</div>
          <div class="text-muted-foreground flex-1 px-3 py-2">Your Entry</div>
          <div class="flex-1 px-3 py-2">Bank Import</div>
        </div>

        <!-- Amount Row -->
        <div class="flex items-center border-b text-sm">
          <div class="text-muted-foreground w-20 flex-shrink-0 px-3 py-3">Amount</div>
          <div
            class="flex-1 px-3 py-3"
            [class.text-muted-foreground]="amountDiffers()"
            [class.line-through]="amountDiffers()"
          >
            {{ toNumber(transaction().amount) | currency }}
          </div>
          <div class="flex-1 px-3 py-3" [class.font-medium]="amountDiffers()">
            {{ importAmountNumber() | currency }}
          </div>
        </div>

        <!-- Date Row -->
        <div class="flex items-center border-b text-sm">
          <div class="text-muted-foreground w-20 flex-shrink-0 px-3 py-3">Date</div>
          <div
            class="flex-1 px-3 py-3"
            [class.text-muted-foreground]="dateDiffers()"
            [class.line-through]="dateDiffers()"
          >
            {{ formatDate(transaction().date) }}
          </div>
          <div class="flex-1 px-3 py-3" [class.font-medium]="dateDiffers()">
            {{ formatDate(importDetails()?.date) }}
          </div>
        </div>

        <!-- Payee Row -->
        <div class="flex items-center text-sm">
          <div class="text-muted-foreground w-20 flex-shrink-0 px-3 py-3">Payee</div>
          <div class="flex-1 truncate px-3 py-3">{{ manualPayee() }}</div>
          <div class="text-muted-foreground flex-1 truncate px-3 py-3 line-through">{{ importPayee() }}</div>
        </div>
      </div>

      <!-- Resolution Options (only when discrepancies) -->
      @if (hasDiscrepancies()) {
        <div class="space-y-3">
          <p class="text-muted-foreground text-sm font-medium">Choose which values to use:</p>

          @if (amountDiffers()) {
            <div class="bg-accent/30 flex items-center justify-between rounded-lg p-3">
              <div>
                <p class="text-sm font-medium">Amount</p>
                <p class="text-muted-foreground text-xs">
                  {{ useImportAmount() ? 'Use bank: ' : 'Keep yours: ' }}
                  {{
                    useImportAmount() ? (importAmountNumber() | currency) : (toNumber(transaction().amount) | currency)
                  }}
                </p>
              </div>
              <brn-switch [checked]="useImportAmount()" (checkedChange)="onUseImportAmountChange($any($event))">
                <hlm-switch />
              </brn-switch>
            </div>
          }

          @if (dateDiffers()) {
            <div class="bg-accent/30 flex items-center justify-between rounded-lg p-3">
              <div>
                <p class="text-sm font-medium">Date</p>
                <p class="text-muted-foreground text-xs">
                  {{ useImportDate() ? 'Use bank: ' : 'Keep yours: ' }}
                  {{ useImportDate() ? formatDate(importDetails()?.date) : formatDate(transaction().date) }}
                </p>
              </div>
              <brn-switch [checked]="useImportDate()" (checkedChange)="onUseImportDateChange($any($event))">
                <hlm-switch />
              </brn-switch>
            </div>
          }
        </div>
      }

      <!-- Match Reason -->
      @if (linkReasonValue()) {
        <div class="bg-accent/30 flex items-start gap-2 rounded-lg p-3">
          <nucleo-icon [icon]="InfoIcon" class="text-muted-foreground h-4 w-4 flex-shrink-0" />
          <p class="text-muted-foreground text-xs">{{ linkReasonValue() }}</p>
        </div>
      }

      <!-- Info Section -->
      <div class="bg-accent/50 flex items-start gap-2 rounded-lg p-3">
        <nucleo-icon [icon]="InfoIcon" class="text-muted-foreground h-4 w-4 flex-shrink-0" />
        <p class="text-muted-foreground text-xs">{{ infoMessage() }}</p>
      </div>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3 text-sm">
          {{ error() }}
        </div>
      }
    </div>

    <hlm-dialog-footer class="flex-col gap-2 sm:flex-col">
      <!-- Primary: Confirm Link -->
      <button hlmBtn size="default" class="w-full" (click)="confirmLink()" [disabled]="processing()">
        @if (processing()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
        }
        {{ hasDiscrepancies() ? 'Confirm & Link' : 'Confirm Link' }}
      </button>

      <!-- Secondary: Not the same transaction -->
      <button
        hlmBtn
        size="default"
        variant="outline"
        class="w-full"
        (click)="unlinkInstead()"
        [disabled]="processing()"
      >
        Not the same transaction
      </button>
    </hlm-dialog-footer>
  `,
})
export class TransactionLinkComparisonDialogComponent {
  protected readonly LinkIcon = Link;
  protected readonly InfoIcon = Info;
  protected readonly LoaderCircle = LoaderCircle;

  private readonly transactionService = inject(TransactionService);

  // Inputs
  readonly transaction = input.required<TransactionWithRelations>();
  readonly currencyCode = input<string>('USD');

  // Outputs
  readonly approve = output<void>();
  readonly unlink = output<void>();
  readonly closed = output<void>();

  // State
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);

  // Resolution choices (default to import values)
  readonly useImportAmount = signal(true);
  readonly useImportDate = signal(true);

  // Computed values
  readonly importDetails = computed(() => this.transaction().importDetails);

  readonly importAmountNumber = computed(() => {
    const details = this.importDetails();
    if (details?.amount === undefined) return null;
    return typeof details.amount === 'bigint' ? Number(details.amount) : details.amount;
  });

  readonly confidencePercent = computed(() => {
    const raw = this.transaction();
    if ('linkConfidence' in raw && typeof raw.linkConfidence === 'number') {
      // linkConfidence is already 0-100, not 0-1
      return Math.round(raw.linkConfidence);
    }
    return 0;
  });

  readonly linkReasonValue = computed(() => {
    const raw = this.transaction();
    if ('linkReason' in raw && typeof raw.linkReason === 'string') {
      return raw.linkReason;
    }
    return null;
  });

  readonly amountDiffers = computed(() => {
    const details = this.importDetails();
    if (!details) return false;
    return details.amount !== this.transaction().amount;
  });

  readonly dateDiffers = computed(() => {
    const details = this.importDetails();
    if (!details?.date) return false;

    const manualDate = this.transaction().date;
    if (!manualDate) return false;

    return details.date !== manualDate;
  });

  readonly hasDiscrepancies = computed(() => {
    return this.amountDiffers() || this.dateDiffers();
  });

  readonly manualPayee = computed(() => {
    return this.transaction().merchantName ?? '—';
  });

  readonly importPayee = computed(() => {
    const details = this.importDetails();
    return details?.merchantName ?? details?.originalStatement ?? '—';
  });

  readonly infoMessage = computed(() => {
    if (this.hasDiscrepancies()) {
      return "We recommend using the bank's values as they are typically more accurate. Your payee, category, and notes will be preserved.";
    }
    return 'Confirm that this bank import belongs to your entry. Your payee, category, and notes will be preserved.';
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

  onUseImportAmountChange(checked: boolean): void {
    this.useImportAmount.set(checked);
  }

  onUseImportDateChange(checked: boolean): void {
    this.useImportDate.set(checked);
  }

  async confirmLink(): Promise<void> {
    if (this.processing()) return;

    this.processing.set(true);
    this.error.set(null);

    try {
      // Build resolutions only if there are discrepancies
      const resolutions = this.hasDiscrepancies()
        ? {
            useImportAmount: this.amountDiffers() ? this.useImportAmount() : undefined,
            useImportDate: this.dateDiffers() ? this.useImportDate() : undefined,
          }
        : undefined;

      const success = await this.transactionService.approveTransactionLink(this.transaction()._id, resolutions);

      if (success) {
        this.approve.emit();
        this.closed.emit();
      } else {
        this.error.set('Failed to confirm link');
        this.processing.set(false);
      }
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to confirm link'));
      this.processing.set(false);
    }
  }

  async unlinkInstead(): Promise<void> {
    if (this.processing()) return;

    this.processing.set(true);
    this.error.set(null);

    try {
      const success = await this.transactionService.unlinkTransaction(this.transaction()._id);

      if (success) {
        this.unlink.emit();
        this.closed.emit();
      } else {
        this.error.set('Failed to unlink transaction');
        this.processing.set(false);
      }
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to unlink transaction'));
      this.processing.set(false);
    }
  }
}
