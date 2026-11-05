import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { ConvexService } from '../../../services/convex.service';
import { CurrencyService } from '../../../services/currency.service';
import { TransactionService, TransactionWithRelations } from '../../../services/transaction.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { TransactionRowBriefComponent } from '../../transaction-row/transaction-row-brief';

type TransactionListResponse = FunctionReturnType<typeof api.transactions.listTransactionsByMonth>;
type RawTransaction = TransactionListResponse[number];

@Component({
  selector: 'app-activity-popover',
  imports: [
    BrnPopover,
    BrnPopoverContent,
    BrnPopoverTrigger,
    HlmPopoverContent,
    TransactionRowBriefComponent,
    HlmButton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
      }

      .activity-popover-scroll {
        height: 200px;
        overflow-y: auto;
      }
    `,
  ],
  template: `
    <brn-popover
      [state]="popoverState()"
      (stateChanged)="onPopoverStateChange($event)"
      side="bottom"
      align="end"
      sideOffset="5"
    >
      <button hlmBtn variant="ghost" size="sm" type="button" class="px-1.5 py-1 text-right text-sm" brnPopoverTrigger>
        {{ formatCurrency(activityAmount()) }}
      </button>
      <div *brnPopoverContent="let ctx" class="w-[340px] p-0" hlmPopoverContent>
        <div class="border-b px-3 py-2.5">
          <p class="text-sm font-semibold">Activity</p>
          <p class="text-muted-foreground text-xs">{{ categoryName() }}</p>
        </div>
        <div class="activity-popover-scroll" [attr.aria-busy]="loading()">
          @if (!loading()) {
            @if (populatedTransactions().length === 0) {
              <div class="text-muted-foreground flex h-full items-center justify-center text-sm">No transactions</div>
            } @else {
              <div>
                @for (tx of populatedTransactions(); track tx._id; let isLast = $last) {
                  <app-transaction-row-brief
                    [transaction]="tx"
                    [isLast]="isLast"
                    [showCategoryBadge]="false"
                    [showBankAccountBadge]="false"
                  />
                }
              </div>
            }
          }
        </div>
      </div>
    </brn-popover>
  `,
})
export class ActivityPopoverComponent {
  private readonly convexService = inject(ConvexService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly transactionService = inject(TransactionService);

  readonly categoryId = input.required<Id<'category'>>();
  readonly categoryName = input.required<string>();
  readonly activityAmount = input.required<bigint>();
  readonly yearMonth = input.required<number>();

  readonly popoverState = signal<'open' | 'closed'>('closed');

  private readonly _transactions = signal<RawTransaction[] | undefined>(undefined);
  private readonly _loading = signal<boolean>(false);
  private transactionSubscription?: () => void;

  readonly loading = this._loading.asReadonly();

  readonly populatedTransactions = computed<TransactionWithRelations[]>(() => {
    const transactions = this._transactions();
    if (!transactions || transactions.length === 0) return [];
    return this.transactionService.populateTransactions(transactions);
  });

  constructor() {
    effect(() => {
      const state = this.popoverState();
      if (state === 'open') {
        this.subscribe();
      } else {
        this.unsubscribe();
      }
    });
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  onPopoverStateChange(state: 'open' | 'closed'): void {
    this.popoverState.set(state);
  }

  private subscribe(): void {
    this.unsubscribe();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) return;

    this._loading.set(true);

    try {
      const watcher = this.convexService.watchQuery<TransactionListResponse>(api.transactions.listTransactionsByMonth, {
        workspaceId: workspaceId as Id<'workspace'>,
        dateYearMonth: this.yearMonth(),
        categoryId: this.categoryId(),
      });

      this.transactionSubscription = watcher.subscribe((data) => {
        if (data !== undefined) {
          this._transactions.set(data);
          this._loading.set(false);
        }
      });
    } catch (error: unknown) {
      console.error('Error fetching activity transactions:', error);
      this._transactions.set(undefined);
      this._loading.set(false);
    }
  }

  private unsubscribe(): void {
    if (this.transactionSubscription) {
      this.transactionSubscription();
      this.transactionSubscription = undefined;
    }
    this._transactions.set(undefined);
    this._loading.set(false);
  }
}
