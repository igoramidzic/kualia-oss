import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmItem, HlmItemContent, HlmItemDescription, HlmItemTitle } from '@spartan-ng/helm/item';
import type { Id } from 'convex/_generated/dataModel';
import {
  nucleoArrowLeft as ArrowLeft,
  nucleoBank as Building2,
  nucleoChevronRight as ChevronRight,
  nucleoDots as Ellipsis,
  nucleoEye as Eye,
  nucleoLink as Link,
  nucleoUnlink as Link2Off,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoPlus as Plus,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService } from '../../../services/bank-account.service';
import { BankConnectionService, type BankConnectionAccountRef } from '../../../services/bank-connection.service';
import { NavigationService } from '../../../services/navigation.service';
import { formatAccountType, isSupportedForLinking } from '../../../shared/utils/account-type-utils';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { getShortId } from '../../../shared/utils/id-utils';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../../ui/dropdown-menu/src';

type DialogStep =
  | { step: 'details' }
  | { step: 'select-account' }
  | { step: 'link-confirm'; accountId: Id<'bankAccount'> | null }
  | { step: 'unlink-confirm' };

interface ConnectionAccountDetailsContext {
  connectionAccount: BankConnectionAccountRef;
}

interface ConnectionAccountDetails {
  ref: BankConnectionAccountRef;
  name: string;
  accountType: string | null;
  accountNumberMask: string | null;
  initialBalance: number | null;
  institution: {
    name: string;
    logo: string | null;
  } | null;
  currencyCode: string | null;
  accountDescription: string | null;
  linkedToBankAccount: { _id: Id<'bankAccount'>; name: string } | null;
  sourceLabel: string;
}

@Component({
  selector: 'app-bank-link-account-details-dialog',
  imports: [
    HlmButton,
    NucleoIcon,
    HlmDialogHeader,
    HlmItem,
    HlmItemContent,
    HlmItemTitle,
    HlmItemDescription,
    HlmBadge,
    HlmDropdownMenuTrigger,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bank-link-account-details-dialog.html',
})
export class BankLinkAccountDetailsDialogComponent {
  protected readonly dialogRef = inject(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<ConnectionAccountDetailsContext>();
  private readonly bankAccountService = inject(BankAccountService);
  private readonly bankConnectionService = inject(BankConnectionService);
  private readonly navigationService = inject(NavigationService);

  // Icons
  protected readonly Building2 = Building2;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Plus = Plus;
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly ChevronRight = ChevronRight;
  protected readonly LinkIcon = Link;
  protected readonly UnlinkIcon = Link2Off;
  protected readonly Ellipsis = Ellipsis;
  protected readonly Eye = Eye;

  // State
  readonly currentStep = signal<DialogStep>({ step: 'details' });
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  // Get external account details from service.
  readonly bankLinkAccount = computed<ConnectionAccountDetails | null>(() => {
    const connectionAccount = this.dialogContext.connectionAccount;
    const connections = this.bankConnectionService.connections();

    for (const connection of connections) {
      const account = connection.accounts.find((acc) => this.connectionAccountMatches(acc.ref, connectionAccount));
      if (account) {
        return {
          ref: account.ref,
          name: account.name,
          accountType: account.accountType,
          accountNumberMask: account.accountNumberMask,
          initialBalance: account.initialBalance,
          institution: {
            name: connection.displayName,
            logo: connection.logoUrl,
          },
          currencyCode: account.currencyCode,
          accountDescription: account.description,
          linkedToBankAccount: account.linkedToBankAccount,
          sourceLabel: connection.provider === 'apple_wallet' ? 'Apple Wallet Account' : 'Bank Account',
        };
      }
    }
    return null;
  });

  // Get workspace bank accounts from service
  readonly workspaceBankAccounts = this.bankAccountService.bankAccounts;

  // Get compatible workspace accounts - only show type-compatible accounts
  readonly compatibleAccounts = computed(() => {
    const accounts = this.workspaceBankAccounts();
    const externalAccount = this.bankLinkAccount();
    if (!externalAccount?.accountType) return [];

    const externalAccountTypePrefix = this.getTypePrefix(externalAccount.accountType);

    return accounts
      .filter((account) => {
        const accountTypePrefix = this.getTypePrefix(account.accountType);
        return accountTypePrefix === externalAccountTypePrefix;
      })
      .map((account) => {
        const isLinked = account.connectionAccount !== null;
        const isLinkedToThisAccount =
          account.connectionAccount !== null &&
          this.connectionAccountMatches(account.connectionAccount, externalAccount.ref);

        return {
          ...account,
          isDisabled: isLinked && !isLinkedToThisAccount,
        };
      });
  });

  readonly hasCompatibleAccounts = computed(() => this.compatibleAccounts().some((acc) => !acc.isDisabled));

  readonly isLinked = computed(() => !!this.bankLinkAccount()?.linkedToBankAccount);

  // Check if this bank link account type is supported for linking
  readonly isBankLinkAccountSupported = computed(() => {
    const externalAccount = this.bankLinkAccount();
    if (!externalAccount?.accountType) return false;
    return isSupportedForLinking(externalAccount.accountType);
  });

  // Helpers
  protected readonly formatAccountType = formatAccountType;
  protected readonly isSupportedForLinking = isSupportedForLinking;

  protected formatConnectionAccountType(accountType: string | null): string {
    return accountType ? formatAccountType(accountType) : 'Unknown type';
  }

  private getTypePrefix(accountType: string): string {
    return accountType.split('_')[0];
  }

  private connectionAccountMatches(left: BankConnectionAccountRef, right: BankConnectionAccountRef): boolean {
    return left.provider === right.provider && left.accountId === right.accountId;
  }

  // Navigation methods
  goToSelectAccount(): void {
    this.currentStep.set({ step: 'select-account' });
    this.error.set(null);
  }

  goToLinkConfirm(accountId: Id<'bankAccount'> | null): void {
    this.currentStep.set({ step: 'link-confirm', accountId });
    this.error.set(null);
  }

  goToUnlinkConfirm(): void {
    this.currentStep.set({ step: 'unlink-confirm' });
    this.error.set(null);
  }

  goBackToDetails(): void {
    this.currentStep.set({ step: 'details' });
    this.error.set(null);
  }

  // Get the account being confirmed for linking (null means creating new)
  readonly accountToLink = computed(() => {
    const step = this.currentStep();
    if (step.step !== 'link-confirm') return null;
    if (step.accountId === null) return null; // Creating new account

    return this.workspaceBankAccounts().find((acc) => acc._id === step.accountId) ?? null;
  });

  // Check if we're creating a new account
  readonly isCreatingNewAccount = computed(() => {
    const step = this.currentStep();
    return step.step === 'link-confirm' && step.accountId === null;
  });

  // Action methods
  async confirmLink(): Promise<void> {
    if (this.saving()) return;

    const step = this.currentStep();
    if (step.step !== 'link-confirm') return;

    this.saving.set(true);
    this.error.set(null);

    try {
      // If accountId is null, create a new account first
      if (step.accountId === null) {
        const externalAccount = this.bankLinkAccount();
        if (!externalAccount?.accountType) {
          this.error.set('External account not found');
          this.saving.set(false);
          return;
        }

        // Format today's date in local timezone (YYYY-MM-DD)
        // Note: We can't use toISOString() because it converts to UTC which may shift the date
        const now = new Date();
        const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        await this.bankConnectionService.createBankAccountFromConnectionAccount(externalAccount.ref, {
          initialBalanceDate: localDateStr,
        });

        toast.success('Bank account created and linked successfully');
      } else {
        const externalAccount = this.bankLinkAccount();
        if (!externalAccount) {
          this.error.set('External account not found');
          this.saving.set(false);
          return;
        }

        await this.bankConnectionService.linkAccount(step.accountId, externalAccount.ref);
        toast.success('Account linked successfully');
      }

      this.goBackToDetails();
      this.saving.set(false);
    } catch (err: unknown) {
      console.error('Failed to link account:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to link account. Please try again.'));
      this.saving.set(false);
    }
  }

  async confirmUnlink(): Promise<void> {
    if (this.saving()) return;

    const externalAccount = this.bankLinkAccount();
    const linkedAccount = externalAccount?.linkedToBankAccount;
    if (!linkedAccount) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      await this.bankConnectionService.unlinkAccount(linkedAccount._id);

      toast.success('Account disconnected successfully');
      this.goBackToDetails();
      this.saving.set(false);
    } catch (err: unknown) {
      console.error('Failed to disconnect account:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to disconnect account. Please try again.'));
      this.saving.set(false);
    }
  }

  viewBankAccount(): void {
    const bankLinkAccount = this.bankLinkAccount();
    const linkedAccount = bankLinkAccount?.linkedToBankAccount;
    if (!linkedAccount) return;

    // Close the dialog and navigate to the bank account page
    this.dialogRef.close();
    void this.navigationService.navigateToBankAccount(getShortId(linkedAccount._id));
  }

  close(): void {
    this.dialogRef.close();
  }
}
