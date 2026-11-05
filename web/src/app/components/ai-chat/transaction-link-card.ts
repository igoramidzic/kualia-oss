import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  nucleoTransfer as ArrowLeftRight,
  NucleoIcon,
  nucleoTransactions as Receipt,
  nucleoShop as Store,
} from '@kualia/icons';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { WorkspaceService } from '../../services/workspace.service';

type PopulatedTransaction = {
  _id: Id<'transaction'>;
  type: 'regular' | 'transfer' | 'starting_balance' | 'balance_adjustment';
  merchantName: string | null;
  merchantLogo: string | null;
  amount: bigint | number;
  bankAccount: {
    name: string;
    institution: {
      logoUrl: string | null;
    } | null;
  } | null;
};

const PROD_APP_BASE_URL = 'https://app.kualia.com';

/**
 * Inline pill rendered in place of a `<transactionLink>` tag. Sized like a
 * file-attachment chip so it flows with the surrounding text. Resolves the
 * transaction via the active workspace and navigates in-app on click.
 *
 * While loading, the pill shows skeleton blocks for the logo and text so the
 * chat reads as in-flight rather than asserting a placeholder name.
 */
@Component({
  selector: 'app-transaction-link-card',
  imports: [NucleoIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!sameWorkspace()) {
      <a
        [href]="externalUrl()"
        target="_blank"
        rel="noopener noreferrer"
        class="bg-background border-border text-foreground hover:bg-accent mx-0.5 my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0 align-middle text-[12px] no-underline transition-colors"
      >
        <span class="bg-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-full border">
          <nucleo-icon [icon]="Store" class="text-muted-foreground h-3 w-3" />
        </span>
        <span class="truncate">Open transaction</span>
      </a>
    } @else {
      <a
        [routerLink]="routeLink()"
        class="bg-background border-border text-foreground hover:bg-accent mx-0.5 my-0.5 inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-1.5 py-0 align-middle text-[12px] no-underline transition-colors"
      >
        @if (isLoading()) {
          <span class="bg-accent h-5 w-5 shrink-0 animate-pulse rounded-full"></span>
          <span class="bg-accent inline-block h-3 w-20 animate-pulse rounded"></span>
          <span class="bg-accent inline-block h-3 w-10 shrink-0 animate-pulse rounded"></span>
        } @else {
          @if (logoUrl(); as logo) {
            <img [src]="logo" [alt]="merchantName()" class="h-5 w-5 shrink-0 rounded-full border object-cover" />
          } @else {
            <span class="bg-accent flex h-5 w-5 shrink-0 items-center justify-center rounded-full border">
              <nucleo-icon [icon]="fallbackIcon()" class="text-muted-foreground h-3 w-3" />
            </span>
          }
          <span class="truncate font-medium">{{ merchantName() }}</span>
          @if (amountText(); as amount) {
            <span class="text-muted-foreground shrink-0 text-[11px]">{{ amount }}</span>
          }
        }
      </a>
    }
  `,
})
export class TransactionLinkCardComponent {
  protected readonly Store = Store;

  private readonly workspaceService = inject(WorkspaceService);
  private readonly convex = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);

  readonly workspaceShortId = input.required<string>();
  readonly transactionId = input.required<string>();

  protected readonly externalUrl = computed(
    () => `${PROD_APP_BASE_URL}/${this.workspaceShortId()}/transactions/${this.transactionId()}/details`
  );

  protected readonly sameWorkspace = computed(() => {
    const id = this.workspaceService.workspaceId();
    return !!id && id.slice(-8).toLowerCase() === this.workspaceShortId().toLowerCase();
  });

  protected readonly routeLink = computed(() => [
    '/',
    this.workspaceShortId(),
    'transactions',
    this.transactionId(),
    'details',
  ]);

  // Computed-pair: outer computed creates the Convex live subscription once the
  // active workspace matches; inner computed reads the value from that signal so
  // template bindings re-render when the server pushes updates.
  private readonly transactionSig = computed(() => {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) return null;
    if (workspaceId.slice(-8).toLowerCase() !== this.workspaceShortId().toLowerCase()) return null;
    return this.convex.query<PopulatedTransaction | null>(api.transactions.getTransaction, {
      workspaceId: workspaceId as Id<'workspace'>,
      transactionId: this.transactionId() as Id<'transaction'>,
    });
  });

  private readonly transaction = computed<PopulatedTransaction | null | undefined>(() => {
    const sig = this.transactionSig();
    if (!sig) return undefined;
    return sig();
  });

  protected readonly isLoading = computed(() => this.transaction() === undefined);

  protected readonly merchantName = computed(() => {
    const txn = this.transaction();
    if (!txn) return 'Transaction unavailable';
    if (txn.type === 'transfer') {
      const accountName = txn.bankAccount?.name ?? null;
      return accountName ? `Transfer · ${accountName}` : 'Transfer';
    }
    if (txn.type === 'starting_balance') return 'Starting balance';
    if (txn.type === 'balance_adjustment') return 'Balance adjustment';
    return txn.merchantName ?? 'Unknown merchant';
  });

  protected readonly logoUrl = computed(() => {
    const txn = this.transaction();
    if (!txn) return null;
    if (txn.type === 'transfer') {
      return txn.bankAccount?.institution?.logoUrl ?? null;
    }
    return txn.merchantLogo ?? null;
  });

  protected readonly fallbackIcon = computed(() => {
    const txn = this.transaction();
    if (!txn) return Store;
    if (txn.type === 'transfer') return ArrowLeftRight;
    if (txn.type === 'starting_balance' || txn.type === 'balance_adjustment') return Receipt;
    return Store;
  });

  protected readonly amountText = computed<string | null>(() => {
    const txn = this.transaction();
    if (!txn) return null;
    const total = typeof txn.amount === 'bigint' ? Number(txn.amount) : txn.amount;
    const formatted = this.currencyService.format(Math.abs(total));
    return total > 0 ? `+${formatted}` : total < 0 ? `-${formatted}` : formatted;
  });
}
