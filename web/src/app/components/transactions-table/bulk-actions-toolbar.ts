import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoBadgeCheck as BadgeCheck,
  nucleoCalendarCheck as CalendarArrowDown,
  nucleoCheckCircle as CircleCheck,
  nucleoHistory as ClockFading,
  nucleoDots as Ellipsis,
  NucleoIcon,
  nucleoTrash as Trash2,
  nucleoClose as X,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { ScheduledTransactionService } from '../../services/scheduled-transaction.service';
import { TransactionSelectionService } from '../../services/transaction-selection.service';
import { TransactionService, TransactionWithRelations } from '../../services/transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';

@Component({
  selector: 'app-bulk-actions-toolbar',
  imports: [NucleoIcon, HlmButton, BrnPopover, BrnPopoverTrigger, BrnPopoverContent, HlmPopoverContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bulk-actions-toolbar.html',
})
export class BulkActionsToolbarComponent {
  protected readonly XIcon = X;
  protected readonly Trash2 = Trash2;
  protected readonly Ellipsis = Ellipsis;
  protected readonly CircleCheck = CircleCheck;
  protected readonly ClockFading = ClockFading;
  protected readonly BadgeCheck = BadgeCheck;
  protected readonly CalendarArrowDown = CalendarArrowDown;

  private readonly transactionService = inject(TransactionService);
  private readonly scheduledService = inject(ScheduledTransactionService);
  private readonly selectionService = inject(TransactionSelectionService);
  private readonly undoRedoService = inject(UndoRedoService);

  // Input: all transactions (needed to check reviewStatus of selected ones)
  readonly transactions = input.required<TransactionWithRelations[]>();

  // Bulk action loading state
  readonly isBulkActionInProgress = signal(false);

  // More menu popover state
  readonly moreMenuState = signal<'open' | 'closed'>('closed');

  // Selection counts by type
  readonly selectedCount = computed(() => this.selectionService.selectedTransactionIds().size);
  readonly selectedScheduledCount = computed(() => this.selectionService.selectedScheduledIds().size);
  readonly totalSelectedCount = computed(() => this.selectedCount() + this.selectedScheduledCount());

  // Which action set to show: only regular, only scheduled, or a mix of both
  readonly selectionMode = computed<'regular' | 'scheduled' | 'mixed'>(() => {
    const hasRegular = this.selectedCount() > 0;
    const hasScheduled = this.selectedScheduledCount() > 0;
    if (hasRegular && hasScheduled) return 'mixed';
    return hasScheduled ? 'scheduled' : 'regular';
  });

  // Computed: label for the selection count button
  readonly selectionLabel = computed(() => {
    const mode = this.selectionMode();
    if (mode === 'scheduled') {
      const count = this.selectedScheduledCount();
      return `${count} Planned`;
    }
    if (mode === 'mixed') {
      const count = this.totalSelectedCount();
      return `${count} Selected`;
    }
    const count = this.selectedCount();
    return `${count} Transaction${count === 1 ? '' : 's'}`;
  });

  // Enter now is offered only when the selection is exclusively scheduled transactions
  readonly canEnterNow = computed(() => this.selectionMode() === 'scheduled');

  // Transaction-only actions (approve / status) only make sense for a regular-only selection
  readonly isRegularOnly = computed(() => this.selectionMode() === 'regular');

  // Computed: check if any selected transaction needs review approval
  // Matches the backend logic: reviewStatus='needs_review' OR (reviewed + hasUncategorized) OR (reviewed + hasMissingPayee)
  readonly hasSelectedNeedsReview = computed(() => {
    if (!this.isRegularOnly()) return false;
    const selectedIds = this.selectionService.selectedTransactionIds();
    if (selectedIds.size === 0) return false;
    return this.transactions().some(
      (t) =>
        selectedIds.has(t._id) &&
        (t.reviewStatus === 'needs_review' ||
          (t.reviewStatus === 'reviewed' && t.hasUncategorized === true) ||
          (t.reviewStatus === 'reviewed' && t.hasMissingPayee === true))
    );
  });

  /**
   * Deselect all transactions
   */
  onDeselectAll(): void {
    this.selectionService.deselectAll();
  }

  /**
   * Enter every selected scheduled transaction now (only shown for scheduled-only selections).
   */
  async enterNowSelected(): Promise<void> {
    const scheduledIds = Array.from(this.selectionService.selectedScheduledIds()) as Id<'scheduledTransaction'>[];
    if (scheduledIds.length === 0) return;

    this.isBulkActionInProgress.set(true);
    let succeeded = 0;
    for (const id of scheduledIds) {
      try {
        await this.scheduledService.enterNow(id);
        succeeded++;
      } catch {
        // keep going; report a partial-failure summary below
      }
    }

    const label = `${succeeded} planned transaction${succeeded === 1 ? '' : 's'}`;
    if (succeeded === scheduledIds.length) {
      toast.success(`Entered ${label}`);
    } else if (succeeded > 0) {
      toast.warning(`Entered ${label}; some failed`);
    } else {
      toast.error('Failed to enter planned transactions');
    }

    this.selectionService.deselectAll();
    this.isBulkActionInProgress.set(false);
  }

  /**
   * Bulk approve selected transactions that need review.
   * Transfer suggestions are routed to the appropriate transfer approval methods.
   */
  async bulkApprove(): Promise<void> {
    const selectedIds = this.selectionService.selectedTransactionIds();
    const needsReviewTransactions = this.transactions().filter(
      (t) =>
        selectedIds.has(t._id) &&
        (t.reviewStatus === 'needs_review' ||
          (t.reviewStatus === 'reviewed' && t.hasUncategorized === true) ||
          (t.reviewStatus === 'reviewed' && t.hasMissingPayee === true))
    );

    if (needsReviewTransactions.length === 0) return;

    this.isBulkActionInProgress.set(true);

    // Separate transfer suggestions from regular transactions
    const transferSuggestions: TransactionWithRelations[] = [];
    const regularIds: Id<'transaction'>[] = [];
    // Track linked transfer pairs already handled (to avoid approving both sides separately)
    const handledLinkedPairs = new Set<string>();

    for (const t of needsReviewTransactions) {
      const suggestion = t.suggestedTransfer;
      if (suggestion && (suggestion.status === 'pending' || suggestion.status === 'linked_pending_approval')) {
        // Skip if paired transaction was already handled (linked pair approved from the other side)
        if (suggestion.matchedTransactionId && handledLinkedPairs.has(t._id)) {
          continue;
        }
        transferSuggestions.push(t);
        // Mark the paired transaction as handled so we don't double-approve
        if (suggestion.status === 'linked_pending_approval' && suggestion.matchedTransactionId) {
          handledLinkedPairs.add(suggestion.matchedTransactionId);
        }
      } else {
        regularIds.push(t._id);
      }
    }

    let allSuccess = true;

    // Approve transfer suggestions individually using the correct methods
    for (const t of transferSuggestions) {
      try {
        const txId = t._id;
        const suggestion = t.suggestedTransfer!;
        if (suggestion.status === 'linked_pending_approval') {
          await this.transactionService.approveLinkedTransfer(txId);
        } else {
          await this.transactionService.approveTransferSuggestion(txId, suggestion.suggestedCounterpartAccountId);
        }
      } catch {
        allSuccess = false;
      }
    }

    // Approve regular transactions in bulk
    if (regularIds.length > 0) {
      const success = await this.transactionService.approveTransactions(regularIds);
      if (!success) allSuccess = false;
    }

    const count = needsReviewTransactions.length;
    const label = `${count} transaction${count === 1 ? '' : 's'}`;
    if (allSuccess) {
      toast.success(`Approved ${label}`);
    } else {
      toast.error('Some transactions failed to approve');
    }

    this.selectionService.deselectAll();
    this.isBulkActionInProgress.set(false);
  }

  /**
   * Bulk delete the selection. Regular transactions and planned transactions are routed to
   * their respective mutations and registered as one undoable action.
   */
  async bulkDelete(): Promise<void> {
    const regularIds = Array.from(this.selectionService.selectedTransactionIds()) as Id<'transaction'>[];
    const scheduledIds = Array.from(this.selectionService.selectedScheduledIds()) as Id<'scheduledTransaction'>[];
    if (regularIds.length === 0 && scheduledIds.length === 0) return;

    this.isBulkActionInProgress.set(true);

    let scheduledSuccess = true;
    for (const id of scheduledIds) {
      try {
        await this.scheduledService.deleteScheduledTransaction(id);
      } catch {
        scheduledSuccess = false;
      }
    }

    // Regular deletes
    let regularSuccess = true;
    if (regularIds.length > 0) {
      regularSuccess = await this.transactionService.deleteTransactions(regularIds);
    }

    const total = regularIds.length + scheduledIds.length;
    if (regularSuccess && scheduledSuccess) {
      const label =
        scheduledIds.length === 0
          ? `${total} transaction${total === 1 ? '' : 's'}`
          : regularIds.length === 0
            ? `${total} planned transaction${total === 1 ? '' : 's'}`
            : `${total} item${total === 1 ? '' : 's'}`;
      this.undoRedoService.pushAction({
        description: `${label} deleted`,
        type: scheduledIds.length === 0 ? 'transaction-bulk-delete' : 'planned-transaction-bulk-delete',
        timestamp: Date.now(),
        undo: async () => {
          if (regularIds.length > 0) {
            const restored = await this.transactionService.restoreTransactions(regularIds);
            if (!restored) throw new Error('Failed to restore transactions');
          }
          for (const id of scheduledIds) {
            await this.scheduledService.restoreScheduledTransaction(id);
          }
        },
        redo: async () => {
          if (regularIds.length > 0) {
            const deleted = await this.transactionService.deleteTransactions(regularIds);
            if (!deleted) throw new Error('Failed to delete transactions');
          }
          for (const id of scheduledIds) {
            await this.scheduledService.deleteScheduledTransaction(id);
          }
        },
      });
      toast(`Deleted ${label}`, {
        action: {
          label: 'Undo',
          onClick: () => void this.undoRedoService.undo(),
        },
      });
    } else {
      toast.error('Some items failed to delete');
    }

    this.selectionService.deselectAll();
    this.isBulkActionInProgress.set(false);
  }

  /**
   * Bulk update status for selected transactions
   */
  async bulkUpdateStatus(status: 'pending' | 'cleared'): Promise<void> {
    const selectedIds = Array.from(this.selectionService.selectedTransactionIds()) as Id<'transaction'>[];
    if (selectedIds.length === 0) return;

    this.moreMenuState.set('closed');
    this.isBulkActionInProgress.set(true);
    const count = selectedIds.length;
    const statusLabel = status === 'pending' ? 'pending' : 'cleared';

    const updatePromise = this.transactionService.updateTransactionsStatus(selectedIds, status);

    toast.promise(updatePromise, {
      loading: `Marking ${count} transaction${count === 1 ? '' : 's'} as ${statusLabel}...`,
      success: `Marked ${count} transaction${count === 1 ? '' : 's'} as ${statusLabel}`,
      error: 'Failed to update transactions',
    });

    await updatePromise;
    this.selectionService.deselectAll();
    this.isBulkActionInProgress.set(false);
  }
}
