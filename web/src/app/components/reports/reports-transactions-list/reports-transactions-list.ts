import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { ConvexService } from '../../../services/convex.service';
import { TransactionService, TransactionWithRelations } from '../../../services/transaction.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { TransactionRowBriefComponent } from '../../transaction-row/transaction-row-brief';

// Infer transaction type from the query
type TransactionListResponse = FunctionReturnType<typeof api.transactions.listTransactionsByMonth>;
type RawTransaction = TransactionListResponse[number];

@Component({
  selector: 'app-reports-transactions-list',
  imports: [TransactionRowBriefComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <div class="flex items-center justify-between border-b px-2 py-3 sm:px-3">
        <h2 class="text-sm font-semibold">Transactions</h2>
      </div>

      @if (!loading() && populatedTransactions().length === 0) {
        <div class="fade-in text-muted-foreground flex h-32 items-center justify-center text-sm">
          No transactions found
        </div>
      } @else if (!loading()) {
        <div class="fade-in">
          @for (tx of populatedTransactions(); track tx._id; let isLast = $last) {
            <app-transaction-row-brief [transaction]="tx" [isLast]="isLast" [showBankAccountBadge]="true" />
          }
        </div>
      }
    </div>
  `,
})
export class ReportsTransactionsListComponent {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly transactionService = inject(TransactionService);

  // Inputs
  readonly yearMonth = input<string>(); // "YYYY-MM" format
  readonly endYearMonth = input<string | null>(null); // Optional end month for range queries ("YYYY-MM" format)
  readonly categoryId = input<string | null>(null);
  readonly merchantId = input<string | null>(null);
  readonly categoryGroupId = input<string | null>(null);
  readonly flow = input<'inflow' | 'outflow' | null>(null);

  // Internal state
  private readonly _transactions = signal<RawTransaction[] | undefined>(undefined);
  private readonly _loading = signal<boolean>(false);
  private transactionSubscription?: () => void;

  readonly loading = this._loading.asReadonly();

  constructor() {
    // Subscribe to transactions when inputs change
    effect(() => {
      this.fetchTransactions();
    });
  }

  // Convert YYYY-MM string to YYYYMM number
  private yearMonthStringToNumber(ym: string): number {
    const [year, month] = ym.split('-').map(Number);
    return year * 100 + month;
  }

  // Fetch transactions based on current filters
  private fetchTransactions(): void {
    // Cleanup previous subscription
    if (this.transactionSubscription) {
      this.transactionSubscription();
      this.transactionSubscription = undefined;
    }

    const workspaceId = this.workspaceService.workspaceId();
    const ym = this.yearMonth();

    if (!workspaceId || !ym) {
      this._transactions.set(undefined);
      this._loading.set(false);
      return;
    }

    const yearMonthNum = this.yearMonthStringToNumber(ym);

    this._loading.set(true);

    const queryArgs: {
      workspaceId: Id<'workspace'>;
      dateYearMonth: number;
      endYearMonth?: number;
      categoryId?: string;
      merchantId?: string;
      categoryGroupId?: string;
      flow?: 'inflow' | 'outflow';
    } = {
      workspaceId: workspaceId as Id<'workspace'>,
      dateYearMonth: yearMonthNum,
    };

    // Add end month for range queries
    const endYm = this.endYearMonth();
    if (endYm) {
      queryArgs.endYearMonth = this.yearMonthStringToNumber(endYm);
    }

    // Add filters if selected
    const catId = this.categoryId();
    if (catId) {
      queryArgs.categoryId = catId;
    }

    const merchId = this.merchantId();
    if (merchId) {
      queryArgs.merchantId = merchId;
    }

    const groupId = this.categoryGroupId();
    if (groupId) {
      queryArgs.categoryGroupId = groupId;
    }

    const flow = this.flow();
    if (flow) {
      queryArgs.flow = flow;
    }

    try {
      const watcher = this.convexService.watchQuery<TransactionListResponse>(
        api.transactions.listTransactionsByMonth,
        queryArgs
      );

      this.transactionSubscription = watcher.subscribe((data) => {
        if (data !== undefined) {
          this._transactions.set(data);
          this._loading.set(false);
        }
      });
    } catch (error) {
      console.error('Error fetching transactions:', error);
      this._transactions.set(undefined);
      this._loading.set(false);
    }
  }

  // Populated transactions with relations
  readonly populatedTransactions = computed<TransactionWithRelations[]>(() => {
    const transactions = this._transactions();
    if (!transactions || transactions.length === 0) return [];
    return this.transactionService.populateTransactions(transactions);
  });
}
