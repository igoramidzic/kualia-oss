import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterOutlet } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoCalendarClock as CalendarClock,
  nucleoChevronRight as ChevronRight,
  nucleoDots as Ellipsis,
  NucleoIcon,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { extractConvexErrorMessage } from '../../shared/utils/convex-error-message';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../ui/dropdown-menu/src';
import { PlannedTransactionPageService } from './planned-transaction-page.service';

@Component({
  selector: 'app-planned-transaction',
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    NucleoIcon,
    SidebarToggleComponent,
    HlmSkeleton,
    HlmButton,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmDropdownMenuTrigger,
  ],
  providers: [PlannedTransactionPageService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planned-transaction.html',
})
export class PlannedTransactionComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly navigationService = inject(NavigationService);
  private readonly scheduledService = inject(ScheduledTransactionService);
  private readonly pageService = inject(PlannedTransactionPageService);
  private readonly currencyService = inject(CurrencyService);
  private readonly merchantService = inject(MerchantService);
  private readonly undoRedoService = inject(UndoRedoService);

  protected readonly ChevronRight = ChevronRight;
  protected readonly CalendarClock = CalendarClock;
  protected readonly Ellipsis = Ellipsis;
  protected readonly Trash2 = Trash2;

  readonly scheduled = this.pageService.scheduled;
  readonly isLoading = this.pageService.isLoading;

  readonly display = computed(() => {
    const scheduled = this.scheduled();
    if (!scheduled) return null;
    const transactionType = scheduled.transactionType ?? 'regular';
    const total = scheduled.movements.reduce((sum, m) => sum + m.amount, 0n);
    const abs = total < 0n ? -total : total;
    const formatted =
      transactionType === 'transfer' ? this.currencyService.format(-abs) : this.currencyService.format(abs);
    const merchantName =
      scheduled.merchantName ??
      this.merchantService.merchants().find((merchant) => merchant._id === scheduled.merchantId)?.name;
    const name = transactionType === 'transfer' ? 'Transfer' : (merchantName ?? 'No payee');
    const prefix = name.length > 24 ? `${name.slice(0, 24)}...` : name;
    return { prefix, amount: transactionType === 'transfer' || total < 0n ? formatted : `+${formatted}` };
  });

  readonly plannedLink = computed(() => this.navigationService.getPlannedRoute());

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        void this.pageService.load(id as Id<'scheduledTransaction'>);
      }
    });
  }

  async deleteScheduled(): Promise<void> {
    const scheduled = this.scheduled();
    if (!scheduled) return;
    try {
      await this.scheduledService.deleteScheduledTransaction(scheduled._id);
      this.undoRedoService.pushAction({
        description: 'Planned transaction deleted',
        type: 'planned-transaction-delete',
        timestamp: Date.now(),
        undo: () => this.scheduledService.restoreScheduledTransaction(scheduled._id),
        redo: () => this.scheduledService.deleteScheduledTransaction(scheduled._id),
      });
      toast('Planned transaction deleted', {
        action: {
          label: 'Undo',
          onClick: () => void this.undoRedoService.undo(),
        },
      });
      void this.navigationService.navigateToPlanned();
    } catch (err: unknown) {
      toast.error(extractConvexErrorMessage(err, 'Failed to delete planned transaction'));
    }
  }
}
