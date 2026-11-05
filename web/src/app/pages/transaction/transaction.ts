import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoChevronRight as ChevronRight,
  nucleoDots as Ellipsis,
  NucleoIcon,
  nucleoReports as SquareChartGantt,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { filter } from 'rxjs/operators';
import { DeleteTransactionDialogComponent } from '../../components/dialogs/delete-transaction-dialog/delete-transaction-dialog';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import { TransactionService } from '../../services/transaction.service';
import { WorkspaceService } from '../../services/workspace.service';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../ui/dropdown-menu/src';
import { TransactionPageService } from './transaction-page.service';

@Component({
  selector: 'app-transaction',
  imports: [
    CommonModule,
    RouterOutlet,
    NucleoIcon,
    SidebarToggleComponent,
    RouterLink,
    RouterLink,
    RouterLinkActive,
    HlmSkeleton,
    HlmButton,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmDropdownMenuTrigger,
  ],
  providers: [TransactionPageService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction.html',
})
export class TransactionComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navigationService = inject(NavigationService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly transactionConvexService = inject(TransactionService);
  private readonly transactionPageService = inject(TransactionPageService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly merchantService = inject(MerchantService);
  private readonly currencyService = inject(CurrencyService);
  protected readonly ChevronRight = ChevronRight;
  protected readonly SquareChartGantt = SquareChartGantt;
  protected readonly Ellipsis = Ellipsis;
  protected readonly Trash2 = Trash2;

  readonly transaction = this.transactionPageService.transaction;
  readonly populatedTransaction = this.transactionPageService.populatedTransaction;
  readonly merchants = this.merchantService.merchants;
  readonly isLoading = this.transactionPageService.isLoading;
  readonly error = computed(() => {
    // Only show error if not loading and no transaction
    if (this.isLoading()) return null;
    return !this.transaction() ? 'Transaction not found' : null;
  });
  private transactionInitialized = false;

  constructor() {
    // Watch for transaction deletion and navigate away
    effect(() => {
      const transaction = this.transaction();
      // Only navigate away if we've already initialized and the transaction disappears
      if (this.transactionInitialized && !transaction) {
        void this.navigationService.navigateToTransactions();
      }
    });

    // Listen for navigation end events to reload transaction when navigating to same route
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id && this.transactionInitialized) {
        // Reload transaction when navigation ends (handles same-route navigation with reload)
        void this.fetchTransaction(id);
      }
    });
  }

  ngOnInit() {
    // Subscribe to route parameter changes to reload transaction when navigating to different transaction
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        // Reset initialization flag when route changes
        this.transactionInitialized = false;
        // Clear current transaction to show loading state
        this.transactionPageService.setTransaction(null);

        // Fetch transaction by full ID
        void this.fetchTransaction(id);

        // Only check for transaction after workspace is loaded AND loading is complete
        // This prevents premature navigation when workspace or transaction is still loading
        const checkTransaction = () => {
          // Make sure we have a workspace before checking transaction
          if (!this.workspaceService.workspaceId()) {
            setTimeout(checkTransaction, 50);
            return;
          }

          // Wait for loading to complete before checking if transaction exists
          if (this.isLoading()) {
            setTimeout(checkTransaction, 50);
            return;
          }

          this.transactionInitialized = true;
          if (!this.transaction()) {
            void this.navigationService.navigateToTransactions();
          }
        };

        // Start checking after a small delay to allow initial data load
        setTimeout(checkTransaction, 50);
      }
    });
  }

  private async fetchTransaction(transactionId: string) {
    this.transactionPageService.setLoading(true);
    try {
      const transaction = await this.transactionConvexService.getTransactionById(transactionId as Id<'transaction'>);
      this.transactionPageService.setTransaction(transaction);
    } finally {
      this.transactionPageService.setLoading(false);
    }
  }

  openDeleteDialog() {
    const transaction = this.transaction();
    if (!transaction) return;

    const dialogRef = this.dialogService.open(DeleteTransactionDialogComponent, {
      context: {
        transaction,
        onClose: (deleted?: boolean) => {
          dialogRef.close();
          if (deleted) {
            // Update local state to reflect deletion
            this.transactionPageService.setTransaction({
              ...transaction,
              isDeleted: true,
              deletedAt: new Date().toISOString(),
            });

            toast.success('Transaction deleted');
          }
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  formatAmount(amount: number): string {
    return this.currencyService.format(amount);
  }

  getTransactionIdShort(id: string): string {
    // Return the last 8 characters of the transaction ID
    return id.length > 8 ? id.slice(-8) : id;
  }

  getMerchantName(): string | null {
    const transaction = this.transaction();
    return transaction?.merchantName ?? null;
  }

  getTransactionDisplay(): { prefix: string; amount: string } | null {
    const transaction = this.transaction();
    if (!transaction) return null;

    let merchantName: string;
    if (transaction.type === 'starting_balance') {
      merchantName = 'Starting Balance';
    } else if (transaction.type === 'balance_adjustment') {
      merchantName = 'Balance Adjustment';
    } else if (transaction.type === 'transfer') {
      merchantName = 'Transfer';
    } else {
      merchantName = this.getMerchantName() ?? this.getTransactionIdShort(transaction._id);
    }

    let merchantNameShort = merchantName?.slice(0, 24);
    if ((merchantName.length ?? 0) > 24) {
      merchantNameShort += '...';
    }
    // Use the editable amount from the service so the header updates in real-time
    const editAmount = this.transactionPageService.transactionAmountEdit();
    const amount = this.formatAmount(editAmount);

    return {
      prefix: merchantNameShort,
      amount,
    };
  }
}
