import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import {
  nucleoBank as Building2,
  nucleoCheck as Check,
  nucleoUnlink as Link2Off,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService, BankAccountWithRelations } from '../../../services/bank-account.service';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { formatAccountType } from '../../../shared/utils/account-type-utils';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

type BankLinksQueryResult = FunctionReturnType<typeof api.bankLinks.listBankLinks>;

interface AvailableBankLinkAccount {
  _id: string;
  name: string;
  accountType: string;
  accountNumberMask: string | null;
  isLinked: boolean;
  linkedToBankAccount: { _id: string; name: string } | null;
}

interface BankLinkGroup {
  bankLinkId: string;
  institution: {
    _id: string;
    name: string;
    logo: string | undefined;
  } | null;
  accounts: AvailableBankLinkAccount[];
}

@Component({
  selector: 'app-link-bank-account-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './link-bank-account-dialog.html',
})
export class LinkBankAccountDialogComponent implements OnInit {
  protected readonly dialogRef = inject(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<{ bankAccount: BankAccountWithRelations }>();
  private readonly convex = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly destroyRef = inject(DestroyRef);

  // Icons
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Building2 = Building2;
  protected readonly Check = Check;
  protected readonly Link2Off = Link2Off;

  // State
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  private readonly _availableBankLinks = signal<BankLinkGroup[]>([]);
  private subscription?: () => void;

  // Computed values
  readonly isCurrentlyLinked = computed(() => !!this.dialogContext.bankAccount.bankLinkAccountId);

  readonly currentBankLinkAccountName = computed(() => {
    return this.dialogContext.bankAccount.bankLinkAccount?.name ?? null;
  });

  readonly currentInstitutionName = computed(() => {
    return this.dialogContext.bankAccount.bankLinkAccount?.bankLink?.institution?.name ?? null;
  });

  readonly currentInstitutionLogo = computed(() => {
    return this.dialogContext.bankAccount.bankLinkAccount?.bankLink?.institution?.logoUrl ?? null;
  });

  readonly currentAccountMask = computed(() => {
    return this.dialogContext.bankAccount.bankLinkAccount?.accountNumberMask ?? null;
  });

  readonly bankAccountType = computed(() => {
    return this.dialogContext.bankAccount.accountType;
  });

  readonly bankLinkGroups = computed(() => {
    const groups = this._availableBankLinks();
    const currentBankLinkAccountId = this.dialogContext.bankAccount.bankLinkAccountId;

    // Filter out the currently linked account from the available list
    return groups
      .map((group) => ({
        ...group,
        accounts: group.accounts.filter((account) => account._id !== currentBankLinkAccountId),
      }))
      .filter((group) => group.accounts.length > 0);
  });

  readonly hasAvailableAccounts = computed(() => {
    return this.bankLinkGroups().some((group) => group.accounts.length > 0);
  });

  ngOnInit() {
    this.loadAvailableBankLinkAccounts();
  }

  private loadAvailableBankLinkAccounts() {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.loading.set(false);
      this.error.set('No workspace selected');
      return;
    }

    const watcher = this.convex.watchQuery(api.bankLinks.listBankLinks, {
      workspaceId: workspaceId as Id<'workspace'>,
    });

    this.subscription = watcher.subscribe((data) => {
      if (data !== undefined) {
        // Transform to the expected format
        const transformed: BankLinkGroup[] = (data as BankLinksQueryResult).map((link) => ({
          bankLinkId: link._id,
          institution: link.institution,
          accounts: link.accounts.map((acc) => ({
            _id: acc._id,
            name: acc.name,
            accountType: acc.accountType,
            accountNumberMask: acc.accountNumberMask,
            isLinked: !!acc.connectedBankAccount,
            linkedToBankAccount: acc.connectedBankAccount,
          })),
        }));
        this._availableBankLinks.set(transformed);
        this.loading.set(false);
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.subscription) {
        this.subscription();
      }
    });
  }

  getDisabledState(account: AvailableBankLinkAccount): { isDisabled: boolean; reason: string | null } {
    const bankAccountType = this.bankAccountType();

    // Check if already linked to another bank account
    if (account.isLinked && account.linkedToBankAccount) {
      return {
        isDisabled: true,
        reason: `Linked to "${account.linkedToBankAccount.name}"`,
      };
    }

    // Check type compatibility
    const accountTypePrefix = this.getTypePrefix(account.accountType);
    const bankAccountTypePrefix = this.getTypePrefix(bankAccountType);

    if (accountTypePrefix !== bankAccountTypePrefix) {
      return {
        isDisabled: true,
        reason: 'Incompatible account type',
      };
    }

    return { isDisabled: false, reason: null };
  }

  private getTypePrefix(accountType: string): string {
    return accountType.split('_')[0];
  }

  formatAccountType = formatAccountType;

  getAccountButtonClasses(disabled: { isDisabled: boolean; reason: string | null }): string {
    const baseClasses = 'flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors';
    const disabledClasses = disabled.isDisabled ? 'opacity-50 cursor-not-allowed' : '';
    const hoverClasses = !disabled.isDisabled && !this.isCurrentlyLinked() ? 'hover:bg-accent/50' : '';
    return `${baseClasses} ${disabledClasses} ${hoverClasses}`.trim();
  }

  async linkAccount(bankLinkAccountId: string) {
    if (this.saving() || this.isCurrentlyLinked()) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      await this.bankAccountService.linkToBankLinkAccount(
        this.dialogContext.bankAccount._id,
        bankLinkAccountId as Id<'bankLinkAccount'>
      );

      toast.success('Bank account linked successfully');
      this.dialogRef.close(true);
    } catch (err: unknown) {
      console.error('Failed to link bank account:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to link account. Please try again.'));
      this.saving.set(false);
    }
  }

  async unlinkAccount() {
    if (this.saving()) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      await this.bankAccountService.linkToBankLinkAccount(this.dialogContext.bankAccount._id, null);

      toast.success('Bank account disconnected');
      this.dialogRef.close(true);
    } catch (err: unknown) {
      console.error('Failed to unlink bank account:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to disconnect. Please try again.'));
      this.saving.set(false);
    }
  }
}
