import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmItem, HlmItemContent, HlmItemDescription, HlmItemTitle } from '@spartan-ng/helm/item';
import type { Id } from 'convex/_generated/dataModel';
import {
  nucleoChevronDown as ChevronDown,
  nucleoChevronRight as ChevronRight,
  nucleoLink as Link,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoDotsVertical as MoreVertical,
  nucleoPlus as Plus,
  nucleoRefresh as RefreshCw,
  nucleoPhone as Smartphone,
  nucleoUnlink as Unplug,
  nucleoAccounts as WalletCards,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankLinkAccountDetailsDialogComponent } from '../../../components/dialogs/bank-link-account-details-dialog/bank-link-account-details-dialog';
import {
  CreateBankAccountDialogConfig,
  CreateBankAccountDialogOrchestratorComponent,
} from '../../../components/dialogs/create-bank-account-dialog/create-bank-account-dialog-orchestrator';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import {
  BankConnectionService,
  type BankConnection,
  type BankConnectionAccount,
  type BankConnectionProvider,
  type BankConnectionRef,
} from '../../../services/bank-connection.service';
import { PlaidService } from '../../../services/plaid.service';
import { ReportingService, TrackingEvent } from '../../../services/reporting.service';
import { formatAccountType, isSupportedForLinking } from '../../../shared/utils/account-type-utils';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { getTimeAgo } from '../../../shared/utils/date-utils';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../../ui/dropdown-menu/src';

interface BankConnectionSection {
  id: 'owned' | 'shared';
  title: string;
  description: string;
  connections: BankConnection[];
}

interface ConnectionOwnerGroup {
  owner: {
    name: string | null;
    email: string | null;
  } | null;
}

interface DeleteBankConnectionDialogContext {
  connection: BankConnectionRef;
  provider: BankConnectionProvider;
  displayName: string;
  accountCount: number;
}

@Component({
  selector: 'app-delete-bank-connection-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Disconnect Bank Connection</h2>
    </hlm-dialog-header>

    <div class="p-3">
      <p class="text-sm">
        This will disconnect {{ dialogContext.displayName }} from Kualia. Automatic syncing will stop, but existing
        Kualia accounts and transactions are kept.
      </p>
      @if (dialogContext.provider === 'apple_wallet') {
        <p class="text-muted-foreground mt-2 text-sm">
          Reconnect or manage Apple Wallet account access from an iOS device.
        </p>
      }

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 mt-4 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="dialogRef.close()" [disabled]="disconnecting()">
        Cancel
      </button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDisconnect()" [disabled]="disconnecting()">
        @if (disconnecting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Disconnecting...
        } @else {
          Disconnect
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DeleteBankConnectionDialogComponent {
  protected readonly dialogRef = inject(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<DeleteBankConnectionDialogContext>();
  private readonly bankConnectionService = inject(BankConnectionService);
  private readonly reportingService = inject(ReportingService);
  protected readonly LoaderCircle = LoaderCircle;

  readonly disconnecting = signal(false);
  readonly error = signal<string | null>(null);

  async confirmDisconnect(): Promise<void> {
    if (this.disconnecting()) return;

    this.disconnecting.set(true);
    this.error.set(null);

    try {
      const result = await this.bankConnectionService.disconnectConnection(this.dialogContext.connection);
      this.reportingService.capture(TrackingEvent.BANK_LINK_DISCONNECTED, {
        provider: this.dialogContext.provider,
        account_count: result.disconnectedAccountCount ?? this.dialogContext.accountCount,
      });
      toast.success('Bank connection disconnected');
      this.dialogRef.close(true);
    } catch (err: unknown) {
      console.error('Failed to disconnect bank connection:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to disconnect bank connection. Please try again.'));
      this.disconnecting.set(false);
    }
  }
}

@Component({
  selector: 'app-bank-connections',
  imports: [
    HlmButton,
    HlmCard,
    HlmDropdownMenuTrigger,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmItem,
    HlmItemContent,
    HlmItemTitle,
    HlmItemDescription,
    NucleoIcon,
    SettingsPageHeaderComponent,
  ],
  templateUrl: './bank-connections.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class BankConnectionsComponent {
  private readonly bankConnectionService = inject(BankConnectionService);
  private readonly plaidService = inject(PlaidService);
  private readonly dialogService = inject(HlmDialogService);

  readonly ChevronDown = ChevronDown;
  readonly ChevronRight = ChevronRight;
  readonly MoreVertical = MoreVertical;
  readonly ReconnectIcon = RefreshCw;
  readonly DisconnectIcon = Unplug;
  readonly LinkIcon = Link;
  readonly Plus = Plus;
  readonly Smartphone = Smartphone;
  readonly WalletCards = WalletCards;
  readonly getTimeAgo = getTimeAgo;
  readonly formatAccountType = formatAccountType;

  readonly connections = this.bankConnectionService.connections;
  readonly loading = this.bankConnectionService.loading;
  readonly ownedConnections = computed(() =>
    this.connections().filter((connection) => connection.isOwnedByCurrentUser)
  );
  readonly sharedConnections = computed(() =>
    this.connections().filter((connection) => !connection.isOwnedByCurrentUser)
  );
  readonly connectionSections = computed<BankConnectionSection[]>(() => {
    const sections: BankConnectionSection[] = [];
    const ownedConnections = this.ownedConnections();
    const sharedConnections = this.sharedConnections();

    if (ownedConnections.length > 0) {
      sections.push({
        id: 'owned',
        title: 'Your connections',
        description: 'Bank connections you manage.',
        connections: ownedConnections,
      });
    }

    if (sharedConnections.length > 0) {
      sections.push({
        id: 'shared',
        title: 'Shared with you',
        description: 'Connections from family members in this workspace.',
        connections: sharedConnections,
      });
    }

    return sections;
  });
  readonly hasConnections = computed(() => this.connections().length > 0);

  async reconnectConnection(connection: BankConnection): Promise<void> {
    if (!this.canReconnect(connection)) {
      return;
    }

    try {
      await this.plaidService.reconnectBankLink(connection.ref.connectionId);
    } catch (error: unknown) {
      console.error('Failed to reconnect bank connection:', error instanceof Error ? error.message : String(error));
      toast.error(extractConvexErrorMessage(error, 'Failed to reconnect bank account. Please try again.'));
    }
  }

  addNewBankConnection(): void {
    const config: CreateBankAccountDialogConfig = {
      initialView: 'plaid-loading',
      startPlaidImmediately: true,
      plaidCancelBehavior: 'close-dialog',
    };

    this.dialogService.open(CreateBankAccountDialogOrchestratorComponent, {
      context: { config },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  canReconnect(
    connection: BankConnection
  ): connection is BankConnection & { ref: { provider: 'plaid'; connectionId: Id<'bankLink'> } } {
    return (
      connection.provider === 'plaid' &&
      connection.ref.provider === 'plaid' &&
      connection.canManageConnection &&
      (connection.status === 'needs_attention' || connection.status === 'disconnected')
    );
  }

  getStatusCircleClass(status: BankConnection['status']): string {
    switch (status) {
      case 'connected':
        return 'bg-green-500';
      case 'needs_attention':
      case 'disconnected':
        return 'bg-red-500';
      case 'pending':
        return 'bg-yellow-500';
    }
  }

  disconnectConnection(connection: BankConnection): void {
    if (!connection.canManageConnection) {
      return;
    }

    this.dialogService.open(DeleteBankConnectionDialogComponent, {
      context: {
        connection: connection.ref,
        provider: connection.provider,
        displayName: connection.displayName,
        accountCount: connection.accounts.length,
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  openConnectionAccountDetails(account: BankConnectionAccount): void {
    this.dialogService.open(BankLinkAccountDetailsDialogComponent, {
      context: {
        connectionAccount: account.ref,
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-lg',
    });
  }

  isConnectionAccountSupported(accountType: string | null): boolean {
    return accountType ? isSupportedForLinking(accountType) : false;
  }

  getOwnerDisplayName(group: ConnectionOwnerGroup): string {
    return group.owner?.name ?? group.owner?.email ?? 'Family member';
  }
}
