import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogHeader } from '@spartan-ng/helm/dialog';
import type { Id } from 'convex/_generated/dataModel';
import { nucleoArrowLeft as ArrowLeft, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService } from '../../../services/bank-account.service';
import { BankConnectionService } from '../../../services/bank-connection.service';
import { PlaidLinkOnSuccessMetadata, PlaidService } from '../../../services/plaid.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { AccountConfirmationComponent } from './account-confirmation';
import { AccountSelectListComponent } from './account-select-list';
import { BankAccountConnectionTypeComponent, ConnectionType } from './bank-account-connection-type';
import { BankAccountManualFormComponent } from './bank-account-manual-form';
import { BankAccountPlaidLoadingComponent } from './bank-account-plaid-loading';
import { BankLinkListComponent } from './bank-link-list';

type ViewState =
  | 'selection'
  | 'linked-bank-list'
  | 'linked-account-select'
  | 'linked-confirm'
  | 'manual'
  | 'plaid-loading'
  | 'plaid-waiting'
  | 'plaid-error'
  | 'plaid-processing';

export interface CreateBankAccountDialogConfig {
  initialView?: ViewState;
  startPlaidImmediately?: boolean;
  plaidCancelBehavior?: 'linked-bank-list' | 'close-dialog';
}

@Component({
  selector: 'app-create-bank-account-dialog-orchestrator',
  imports: [
    HlmButton,
    NucleoIcon,
    BankAccountConnectionTypeComponent,
    BankAccountManualFormComponent,
    BankAccountPlaidLoadingComponent,
    BankLinkListComponent,
    AccountSelectListComponent,
    AccountConfirmationComponent,
    HlmDialogHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showBackButton()) {
      <hlm-dialog-header>
        <div class="flex items-center gap-2 select-none">
          <button hlmBtn variant="ghost" size="icon" class="h-6 w-6" (click)="goBack()" [disabled]="isProcessing()">
            <nucleo-icon [icon]="ArrowLeft" class="h-4 w-4" />
          </button>
          <h2>{{ headerTitle() }}</h2>
        </div>
      </hlm-dialog-header>
    }

    @switch (currentView()) {
      @case ('selection') {
        <app-bank-account-connection-type (connectionTypeSelected)="onConnectionTypeSelected($event)" />
      }
      @case ('linked-bank-list') {
        <app-bank-link-list
          [bankLinks]="bankLinks()"
          [loading]="bankLinksLoading()"
          (bankLinkSelected)="selectBankLink($event)"
          (connectNewClicked)="initializePlaidLink()"
        />
      }
      @case ('linked-account-select') {
        <app-account-select-list
          [bankLink]="selectedBankLink()!"
          [selectedAccountIds]="selectedAccountIds()"
          (accountToggled)="toggleAccount($event)"
          (selectAllToggled)="toggleAllAccounts($event)"
          (continueClicked)="goToConfirmation()"
        />
      }
      @case ('linked-confirm') {
        <app-account-confirmation
          [bankLink]="selectedBankLink()!"
          [selectedAccounts]="selectedAccounts()"
          [isProcessing]="isProcessing()"
          [error]="error()"
          (confirmClicked)="createSelectedAccounts()"
        />
      }
      @case ('manual') {
        <app-bank-account-manual-form
          (bankAccountCreated)="onBankAccountCreated($event)"
          (cancelled)="closeDialog()"
          (errorOccurred)="onError($event)"
        />
      }
      @case ('plaid-loading') {
        <app-bank-account-plaid-loading [isWaiting]="false" />
      }
      @case ('plaid-waiting') {
        <app-bank-account-plaid-loading [isWaiting]="true" />
      }
      @case ('plaid-error') {
        <app-bank-account-plaid-loading
          [isError]="true"
          [errorMessage]="error()"
          [showBackButton]="!isDirectPlaidFlow()"
          (retry)="retryPlaidConnection()"
          (cancelClick)="goBackFromError()"
        />
      }
      @case ('plaid-processing') {
        <app-bank-account-plaid-loading [isProcessing]="true" />
      }
    }
  `,
})
export class CreateBankAccountDialogOrchestratorComponent {
  protected readonly ArrowLeft = ArrowLeft;

  private readonly plaidService = inject(PlaidService);
  private readonly bankConnectionService = inject(BankConnectionService);
  private readonly bankAccountService = inject(BankAccountService);
  protected readonly dialogRef = inject(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<{ config?: CreateBankAccountDialogConfig }>();

  // Configuration with defaults
  private readonly config = computed(() => ({
    initialView: this.dialogContext.config?.initialView ?? 'selection',
    startPlaidImmediately: this.dialogContext.config?.startPlaidImmediately ?? false,
    plaidCancelBehavior: this.dialogContext.config?.plaidCancelBehavior ?? 'linked-bank-list',
  }));

  // Whether this is a direct Plaid flow (no previous steps to go back to)
  readonly isDirectPlaidFlow = computed(() => this.config().initialView === 'plaid-loading');

  // Initialization tracking
  private readonly initialized = signal(false);

  constructor() {
    effect(() => {
      if (!this.initialized()) {
        const cfg = this.config();
        if (cfg.initialView !== 'selection') {
          this.currentView.set(cfg.initialView);
        }
        this.initialized.set(true);

        if (cfg.startPlaidImmediately) {
          void this.initializePlaidLink();
        }
      }
    });
  }

  // View state
  readonly currentView = signal<ViewState>('selection');
  readonly isProcessing = signal(false);
  readonly error = signal<string | null>(null);

  // Bank links from service (real-time)
  readonly bankLinks = this.bankConnectionService.bankLinkAccountGroups;
  readonly bankLinksLoading = this.bankConnectionService.loading;

  // Selection state
  readonly selectedBankLinkId = signal<Id<'bankLink'> | null>(null);
  readonly selectedAccountIds = signal<Set<Id<'bankLinkAccount'>>>(new Set());

  // Computed signals
  readonly selectedBankLink = computed(() => {
    const id = this.selectedBankLinkId();
    if (!id) return null;
    return this.bankLinks().find((bl) => bl.bankLinkId === id) ?? null;
  });

  readonly unlinkedAccounts = computed(() => {
    const bankLink = this.selectedBankLink();
    if (!bankLink) return [];
    return bankLink.accounts.filter((a) => !a.isLinked);
  });

  readonly selectedAccounts = computed(() => {
    const bankLink = this.selectedBankLink();
    const ids = this.selectedAccountIds();
    if (!bankLink) return [];
    return bankLink.accounts.filter((a) => ids.has(a._id));
  });

  readonly showBackButton = computed(() => {
    const view = this.currentView();
    const cfg = this.config();

    // In direct Plaid flow, only show back button for account selection/confirm steps
    if (cfg.initialView === 'plaid-loading') {
      return view === 'linked-account-select' || view === 'linked-confirm';
    }

    return (
      view === 'manual' || view === 'linked-bank-list' || view === 'linked-account-select' || view === 'linked-confirm'
    );
  });

  readonly headerTitle = computed(() => {
    const view = this.currentView();
    switch (view) {
      case 'manual':
        return 'Create a bank account';
      case 'linked-bank-list':
        return 'Link a bank account';
      case 'linked-account-select':
        return 'Select accounts';
      case 'linked-confirm':
        return 'Confirm';
      default:
        return '';
    }
  });

  onConnectionTypeSelected(type: ConnectionType) {
    if (type === 'manual') {
      this.currentView.set('manual');
    } else if (type === 'linked') {
      this.currentView.set('linked-bank-list');
    }
  }

  goBack() {
    const view = this.currentView();
    const cfg = this.config();

    switch (view) {
      case 'linked-bank-list':
        this.currentView.set('selection');
        break;
      case 'linked-account-select':
        this.selectedBankLinkId.set(null);
        this.selectedAccountIds.set(new Set());
        // In direct Plaid flow, close dialog; otherwise go to bank list
        if (cfg.initialView === 'plaid-loading') {
          this.dialogRef.close();
        } else {
          this.currentView.set('linked-bank-list');
        }
        break;
      case 'linked-confirm':
        this.currentView.set('linked-account-select');
        break;
      case 'manual':
        this.currentView.set('selection');
        break;
      default:
        this.currentView.set('selection');
    }
    this.error.set(null);
  }

  goBackFromError() {
    if (this.config().plaidCancelBehavior === 'close-dialog') {
      this.dialogRef.close();
      return;
    }
    this.currentView.set('linked-bank-list');
    this.error.set(null);
  }

  retryPlaidConnection() {
    this.error.set(null);
    void this.initializePlaidLink();
  }

  // Bank link selection
  selectBankLink(bankLinkId: Id<'bankLink'>) {
    this.selectedBankLinkId.set(bankLinkId);
    this.selectedAccountIds.set(new Set());
    this.currentView.set('linked-account-select');
  }

  // Account selection
  toggleAccount(accountId: Id<'bankLinkAccount'>) {
    this.selectedAccountIds.update((ids) => {
      const newIds = new Set(ids);
      if (newIds.has(accountId)) {
        newIds.delete(accountId);
      } else {
        newIds.add(accountId);
      }
      return newIds;
    });
  }

  toggleAllAccounts(selectAll: boolean) {
    if (selectAll) {
      const unlinkedIds = this.unlinkedAccounts().map((a) => a._id);
      this.selectedAccountIds.set(new Set(unlinkedIds));
    } else {
      this.selectedAccountIds.set(new Set());
    }
  }

  goToConfirmation() {
    if (this.selectedAccountIds().size > 0) {
      this.currentView.set('linked-confirm');
    }
  }

  // Create selected accounts
  async createSelectedAccounts() {
    const accountIds = Array.from(this.selectedAccountIds());
    if (accountIds.length === 0) return;

    this.isProcessing.set(true);
    this.error.set(null);

    try {
      // Format today's date in local timezone (YYYY-MM-DD)
      // Note: We can't use toISOString() because it converts to UTC which may shift the date
      const now = new Date();
      const initialBalanceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      await this.bankAccountService.createBankAccountsFromBankLinkAccounts(accountIds, initialBalanceDate);

      toast.success(`Created ${accountIds.length} account${accountIds.length > 1 ? 's' : ''}`);
      this.dialogRef.close({ success: true });
    } catch (err: unknown) {
      console.error('Failed to create accounts:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to create accounts'));
    } finally {
      this.isProcessing.set(false);
    }
  }

  onBankAccountCreated(bankAccount: unknown) {
    this.dialogRef.close(bankAccount);
  }

  onError(errorMessage: string) {
    this.error.set(errorMessage);
  }

  closeDialog() {
    this.dialogRef.close();
  }

  async initializePlaidLink() {
    try {
      this.currentView.set('plaid-loading');
      this.isProcessing.set(true);

      // Get link token from edge function
      const linkToken = await this.plaidService.createLinkToken();

      // Show waiting state now that we have the token
      this.currentView.set('plaid-waiting');

      // Initialize Plaid Link
      this.plaidService.initializePlaidLink(
        linkToken,
        (publicToken, metadata) => {
          // Process the success
          this.plaidService.destroy();
          void this.handlePlaidSuccess(publicToken, metadata);
        },
        () => {
          // Handle exit - user closed Plaid without connecting
          this.plaidService.destroy();
          if (this.config().plaidCancelBehavior === 'close-dialog') {
            this.dialogRef.close();
          } else {
            this.currentView.set('linked-bank-list');
          }
          this.isProcessing.set(false);
        }
      );

      // Don't close our dialog - keep it open with its backdrop
      // Open Plaid Link modal on top of our dialog
      this.plaidService.open();
    } catch (error: unknown) {
      const errorMessage = extractConvexErrorMessage(error, 'Failed to initialize bank connection');
      this.error.set(errorMessage);
      this.currentView.set('plaid-error');
      this.isProcessing.set(false);
    }
  }

  private async handlePlaidSuccess(publicToken: string, metadata: unknown) {
    try {
      this.currentView.set('plaid-processing');
      this.isProcessing.set(true);

      // Cast to the proper type
      const metadataObj = metadata as PlaidLinkOnSuccessMetadata;

      if (!metadataObj.institution) {
        throw new Error('Institution data not found in metadata');
      }

      // Use the PlaidService to link the new Plaid item
      const result = await this.plaidService.linkNewPlaidItem(publicToken, metadataObj);

      // Auto-select the new bank link and navigate to account selection
      this.selectedBankLinkId.set(result.bankLinkId as Id<'bankLink'>);
      this.selectedAccountIds.set(new Set());
      this.currentView.set('linked-account-select');
    } catch (error: unknown) {
      console.error('Error linking bank account:', error);
      const errorMessage = extractConvexErrorMessage(error, 'Failed to link bank account');

      // Show error in dialog so user can retry
      this.error.set(errorMessage);
      this.currentView.set('plaid-error');
    } finally {
      this.isProcessing.set(false);
    }
  }
}
