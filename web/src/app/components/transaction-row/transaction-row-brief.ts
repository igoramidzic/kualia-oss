import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  nucleoWarningCircle as AlertCircle,
  nucleoCategory as Box,
  nucleoHistory as ClockFading,
  nucleoLock as Lock,
  NucleoIcon,
  nucleoTransactions as Receipt,
} from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';
import { NavigationService } from '../../services/navigation.service';
import { TransactionWithRelations } from '../../services/transaction.service';
import { DEFAULT_BANK_ACCOUNT_ICON_NAME, DEFAULT_MERCHANT_ICON_NAME } from '../../shared/utils/entity-identity';
import { EntityMarkComponent } from '../entity-mark/entity-mark.component';
import { TransactionAccountBadgeComponent } from '../transaction/transaction-account-badge';

@Component({
  selector: 'app-transaction-row-brief',
  imports: [RouterLink, NucleoIcon, EntityMarkComponent, TransactionAccountBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-row-brief.html',
})
export class TransactionRowBriefComponent {
  protected readonly ClockFading = ClockFading;
  protected readonly Receipt = Receipt;
  protected readonly Lock = Lock;
  protected readonly Box = Box;
  protected readonly AlertCircle = AlertCircle;
  protected readonly defaultMerchantIconName = DEFAULT_MERCHANT_ICON_NAME;
  protected readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  private readonly navigationService = inject(NavigationService);
  private readonly currencyService = inject(CurrencyService);

  // Inputs
  readonly transaction = input.required<TransactionWithRelations>();
  readonly showBankAccountBadge = input<boolean>(true);
  readonly isLast = input<boolean>(false);
  readonly selectionMode = input<boolean>(false);
  readonly isSelected = input<boolean>(false);
  readonly showCategoryBadge = input<boolean>(true);
  readonly showStatusIcons = input<boolean>(true);

  // Outputs
  readonly selected = output<TransactionWithRelations>();

  formatAmount(amountInCents: bigint | number): { display: string; isPositive: boolean } {
    const amount = typeof amountInCents === 'bigint' ? Number(amountInCents) : amountInCents;
    const isPositive = amount >= 0;
    const formatted = this.currencyService.format(Math.abs(amount));

    return {
      display: isPositive ? `+${formatted}` : formatted,
      isPositive,
    };
  }

  formatDate(dateString: string | null): string {
    if (!dateString) return 'N/A';

    let date: Date;

    if (dateString.includes('T')) {
      date = new Date(dateString);
    } else {
      const [year, month, day] = dateString.split('-').map(Number);
      date = new Date(year, month - 1, day);
    }

    if (isNaN(date.getTime())) {
      return 'N/A';
    }

    const now = new Date();
    const isCurrentYear = date.getFullYear() === now.getFullYear();

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      ...(isCurrentYear ? {} : { year: 'numeric' }),
    };
    return date.toLocaleDateString('en-US', options);
  }

  getDateWidth(dateString: string | null): string {
    if (!dateString) return 'w-20';

    let date: Date;

    if (dateString.includes('T')) {
      date = new Date(dateString);
    } else {
      const [year, month, day] = dateString.split('-').map(Number);
      date = new Date(year, month - 1, day);
    }

    const now = new Date();
    const isCurrentYear = date.getFullYear() === now.getFullYear();

    return isCurrentYear ? 'w-12' : 'w-20';
  }

  getBankAccountName(transaction: TransactionWithRelations): string {
    return transaction.bankAccount?.name ?? 'Unknown Account';
  }

  getCategoryName(transaction: TransactionWithRelations): string {
    const firstMovement = transaction.movements?.[0];
    if (!firstMovement) {
      return 'Uncategorized';
    }
    if (firstMovement.readyToAssign) {
      return 'Ready to Assign';
    }
    return firstMovement?.category?.name ?? 'Uncategorized';
  }

  hasCategory(transaction: TransactionWithRelations): boolean {
    const firstMovement = transaction.movements?.[0];
    if (!firstMovement) {
      return false;
    }
    return firstMovement.readyToAssign || firstMovement.category !== null;
  }

  getMerchantName(transaction: TransactionWithRelations): string {
    if (transaction.type === 'transfer' && transaction.transferPairAccountName) {
      const direction = transaction.amount > 0n ? 'from' : 'to';
      return `Transfer ${direction} ${transaction.transferPairAccountName}`;
    }
    return transaction.merchantName ?? '—';
  }

  getMerchantLogo(transaction: TransactionWithRelations): string | null {
    if (transaction.type === 'transfer') {
      return null;
    }
    return transaction.merchantLogo;
  }

  getTransferPairLogo(transaction: TransactionWithRelations): string | null {
    return transaction.transferPairAccountLogo ?? null;
  }

  isTransfer(transaction: TransactionWithRelations): boolean {
    return transaction.type === 'transfer';
  }

  isStartingBalance(transaction: TransactionWithRelations): boolean {
    return transaction.type === 'starting_balance';
  }

  isBalanceAdjustment(transaction: TransactionWithRelations): boolean {
    return transaction.type === 'balance_adjustment';
  }

  getInstitutionLogo(transaction: TransactionWithRelations): string | null {
    return transaction.bankAccount?.institution?.logoUrl ?? null;
  }

  getTransactionUrl(transactionId: string): string[] {
    return this.navigationService.getTransactionRoute(transactionId);
  }

  isPending(transaction: TransactionWithRelations): boolean {
    return transaction.status === 'pending';
  }

  isReconciled(transaction: TransactionWithRelations): boolean {
    return transaction.status === 'reconciled';
  }
}
