import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmDialogHeader } from '@spartan-ng/helm/dialog';
import type { Id } from 'convex/_generated/dataModel';
import {
  nucleoBank as Building2,
  nucleoCheck as Check,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoPlus as Plus,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService } from '../../../services/bank-account.service';
import { formatAccountType } from '../../../shared/utils/account-type-utils';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

interface BankLinkAccountContext {
  bankLinkAccount: {
    _id: Id<'bankLinkAccount'>;
    name: string;
    accountType: string;
    accountNumberMask: string | null;
    initialBalance: number | null;
  };
  institution: {
    name: string;
    logoUrl?: string;
  } | null;
}

@Component({
  selector: 'app-connect-bank-link-account-dialog',
  imports: [NucleoIcon, HlmDialogHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './connect-bank-link-account-dialog.html',
})
export class ConnectBankLinkAccountDialogComponent {
  protected readonly dialogRef = inject(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<BankLinkAccountContext>();
  private readonly bankAccountService = inject(BankAccountService);

  // Icons
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Building2 = Building2;
  protected readonly Check = Check;
  protected readonly Plus = Plus;

  // State
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  // Get workspace bank accounts from service
  readonly workspaceBankAccounts = this.bankAccountService.bankAccounts;

  // Filter compatible accounts
  readonly compatibleAccounts = computed(() => {
    const accounts = this.workspaceBankAccounts();
    const bankLinkAccountType = this.dialogContext.bankLinkAccount.accountType;
    const bankLinkTypePrefix = this.getTypePrefix(bankLinkAccountType);

    return accounts.filter((account) => {
      // Filter out already linked accounts
      if (account.bankLinkAccountId) {
        return false;
      }

      // Filter by type compatibility
      const accountTypePrefix = this.getTypePrefix(account.accountType);
      return accountTypePrefix === bankLinkTypePrefix;
    });
  });

  readonly hasCompatibleAccounts = computed(() => this.compatibleAccounts().length > 0);

  private getTypePrefix(accountType: string): string {
    return accountType.split('_')[0];
  }

  formatAccountType = formatAccountType;

  async connectAccount(workspaceBankAccountId: Id<'bankAccount'>) {
    if (this.saving()) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      await this.bankAccountService.linkToBankLinkAccount(
        workspaceBankAccountId,
        this.dialogContext.bankLinkAccount._id
      );

      toast.success('Bank link account connected successfully');
      this.dialogRef.close(true);
    } catch (err: unknown) {
      console.error('Failed to connect bank link account:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to connect account. Please try again.'));
      this.saving.set(false);
    }
  }

  async createNewAccount() {
    if (this.saving()) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const bankLinkAccount = this.dialogContext.bankLinkAccount;
      const initialBalance = bankLinkAccount.initialBalance ?? 0;

      // Format today's date in local timezone (YYYY-MM-DD)
      // Note: We can't use toISOString() because it converts to UTC which may shift the date
      const now = new Date();
      const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      await this.bankAccountService.createBankAccount({
        name: bankLinkAccount.name,
        bankLinkAccountId: bankLinkAccount._id,
        accountType: bankLinkAccount.accountType,
        initialBalance: BigInt(Math.round(initialBalance * 100)),
        initialBalanceDate: localDateStr,
      });

      toast.success('Bank account created and linked successfully');
      this.dialogRef.close(true);
    } catch (err: unknown) {
      console.error('Failed to create and link bank account:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to create account. Please try again.'));
      this.saving.set(false);
    }
  }

  cancel() {
    this.dialogRef.close(false);
  }
}
