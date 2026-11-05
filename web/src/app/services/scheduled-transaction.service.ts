import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import type { Doc, Id } from 'convex/_generated/dataModel';
import type { ScheduledTransactionWithRelations } from 'convex/scheduledTransactions/queries';
import type { EntryMode, Recurrence, ScheduledReminderOffset } from 'convex/scheduledTransactions/types';
import { confirmEnterScheduledTransaction } from '../components/dialogs/enter-scheduled-transaction-dialog/enter-scheduled-transaction-dialog';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

export type { EntryMode, ScheduledReminderOffset, ScheduledTransactionWithRelations };

export type ScheduledReminderSelection = ScheduledReminderOffset | 'none';

export const SCHEDULED_REMINDER_OPTIONS: readonly {
  value: ScheduledReminderSelection;
  label: string;
}[] = [
  { value: 'none', label: 'No reminder' },
  { value: 'on_due_date', label: 'On due date' },
  { value: '1_day_before', label: '1 day before' },
  { value: '2_days_before', label: '2 days before' },
  { value: '1_week_before', label: '1 week before' },
  { value: '1_month_before', label: '1 month before' },
];

export type EnterScheduledTransactionNowResult =
  | {
      scheduledTransactionId: Id<'scheduledTransaction'>;
      transactionId: Id<'transaction'>;
      status: 'active';
      nextDate: string;
    }
  | {
      scheduledTransactionId: Id<'scheduledTransaction'>;
      transactionId: Id<'transaction'>;
      status: 'completed';
      nextDate?: undefined;
    };

export type UpdateScheduledTransactionResult =
  | {
      entered: true;
      scheduledTransactionId: Id<'scheduledTransaction'>;
      transactionId: Id<'transaction'>;
      status: 'active';
      nextDate: string;
    }
  | {
      entered: true;
      scheduledTransactionId: Id<'scheduledTransaction'>;
      transactionId: Id<'transaction'>;
      status: 'completed';
      nextDate?: undefined;
    }
  | {
      entered: false;
      scheduledTransactionId: Id<'scheduledTransaction'>;
      status: 'active' | 'paused' | 'completed';
      nextDate: string;
    };

export type SkipScheduledTransactionResult =
  | {
      scheduledTransactionId: Id<'scheduledTransaction'>;
      status: 'completed';
      nextDate?: undefined;
    }
  | {
      scheduledTransactionId: Id<'scheduledTransaction'>;
      status: 'active';
      nextDate: string;
    };

/** One movement of a scheduled transaction, as accepted by updateScheduledTransaction. */
export interface ScheduledMovementInput {
  amount: bigint;
  categoryId?: Id<'category'>;
  readyToAssign?: boolean;
  notes?: string;
}

/** Fields an inline editor / detail page can patch on a scheduled transaction. */
export interface UpdateScheduledTransactionInput {
  scheduledTransactionId: Id<'scheduledTransaction'>;
  // Only send `date` when it actually changed: a date write re-anchors the recurrence,
  // and a date <= today requires confirmed entry via `enterDue`.
  date?: string;
  transactionType?: 'regular' | 'transfer';
  bankAccountId?: Id<'bankAccount'>;
  transferToAccountId?: Id<'bankAccount'> | null;
  merchantId?: Id<'merchant'> | null;
  notes?: string | null;
  movements?: ScheduledMovementInput[];
  entryStatus?: 'pending' | 'cleared';
  recurrence?: Recurrence;
  /** 'auto' enters occurrences on the due date; 'manual' shows them as due until entered. */
  entryMode?: EntryMode;
  /** true parks the schedule (no auto entry / reminders / overdue); false resumes it. */
  paused?: boolean;
  reminderEnabled?: boolean;
  reminderOffset?: ScheduledReminderOffset | null;
  /** Required when `date` is today or earlier and the user confirmed entry. */
  enterDue?: boolean;
}

/**
 * Subscribes to the workspace's active scheduled (planned) transactions and exposes the
 * enter-now / update / skip / delete mutations. Mirrors PlannedTransactionService's
 * workspace-scoped subscription lifecycle.
 */
@Injectable({
  providedIn: 'root',
})
export class ScheduledTransactionService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(HlmDialogService);

  private readonly _scheduledTransactions = signal<ScheduledTransactionWithRelations[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);

  readonly scheduledTransactions = this._scheduledTransactions.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly count = computed(() => this._scheduledTransactions().length);

  private scheduledSubscription?: () => void;
  private lastWorkspaceId: string | null = null;

  constructor() {
    // Watch for workspace changes and start/stop the subscription
    effect(() => {
      const workspaceId = this.workspaceService.workspaceId();
      const hasWorkspace = !!workspaceId;
      const isAuthenticated = this.convexService.isAuthenticated();

      const workspaceChanged = this.lastWorkspaceId !== null && this.lastWorkspaceId !== workspaceId;

      if (isAuthenticated && hasWorkspace) {
        if (workspaceChanged) {
          this.stopWatching();
          this._scheduledTransactions.set([]);
          this._hasLoaded.set(false);
        }
        if (workspaceChanged || !this.scheduledSubscription) {
          this.startWatching();
        }
      } else {
        this.stopWatching();
        this._scheduledTransactions.set([]);
        this._hasLoaded.set(false);
      }

      this.lastWorkspaceId = workspaceId;
    });

    this.destroyRef.onDestroy(() => {
      this.stopWatching();
    });
  }

  private startWatching(): void {
    this.stopWatching();

    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return;
    }

    this._loading.set(true);

    const watcher = this.convexService.watchQuery<ScheduledTransactionWithRelations[]>(
      api.scheduledTransactions.listScheduledTransactions,
      {
        workspaceId: workspaceId as Id<'workspace'>,
      }
    );

    this.scheduledSubscription = watcher.subscribe((result) => {
      if (result !== undefined) {
        this._scheduledTransactions.set(result);
        this._hasLoaded.set(true);
        this._loading.set(false);
      }
    });
  }

  private stopWatching(): void {
    if (this.scheduledSubscription) {
      this.scheduledSubscription();
      this.scheduledSubscription = undefined;
    }
  }

  /**
   * Enter a scheduled transaction into the register now (with today's date). A recurring
   * schedule advances to its next occurrence; a 'once' schedule completes.
   */
  async enterNow(scheduledTransactionId: Id<'scheduledTransaction'>): Promise<EnterScheduledTransactionNowResult> {
    const workspaceId = this.requireWorkspaceId();
    return this.convexService.mutation<EnterScheduledTransactionNowResult>(
      api.scheduledTransactions.enterScheduledTransactionNow,
      {
        workspaceId,
        scheduledTransactionId,
      }
    );
  }

  /**
   * Patch a scheduled transaction. Callers must omit `date` unless the user actually changed
   * it, and must set `enterDue` only after confirming a date that is today or earlier.
   */
  async updateScheduledTransaction(input: UpdateScheduledTransactionInput): Promise<UpdateScheduledTransactionResult> {
    const workspaceId = this.requireWorkspaceId();
    return this.convexService.mutation<UpdateScheduledTransactionResult>(
      api.scheduledTransactions.updateScheduledTransaction,
      {
        workspaceId,
        ...input,
      }
    );
  }

  confirmEnterDueDate(scheduled: ScheduledTransactionWithRelations, dateIso: string): Promise<boolean> {
    return confirmEnterScheduledTransaction(this.dialogService, scheduled, dateIso);
  }

  /**
   * Skip only the current occurrence without entering it. A repeating schedule moves to
   * its next unpaid occurrence; a 'once' schedule completes.
   */
  async skip(scheduledTransactionId: Id<'scheduledTransaction'>): Promise<SkipScheduledTransactionResult> {
    const workspaceId = this.requireWorkspaceId();
    return this.convexService.mutation<SkipScheduledTransactionResult>(
      api.scheduledTransactions.skipScheduledTransaction,
      {
        workspaceId,
        scheduledTransactionId,
      }
    );
  }

  /**
   * One-shot fetch of a single scheduled transaction by id (for deep links / detail page
   * fallback). Returns null when not found or access is denied.
   */
  async getScheduledTransactionById(
    scheduledTransactionId: Id<'scheduledTransaction'>
  ): Promise<ScheduledTransactionWithRelations | null> {
    const workspaceId = this.requireWorkspaceId();
    try {
      return await this.convexService.getClient().query(api.scheduledTransactions.getScheduledTransaction, {
        workspaceId,
        scheduledTransactionId,
      });
    } catch {
      return null;
    }
  }

  /**
   * List the real transactions this schedule has already entered (raw docs; caller repopulates).
   */
  async getLinkedTransactions(
    scheduledTransactionId: Id<'scheduledTransaction'>,
    limit?: number
  ): Promise<Doc<'transaction'>[]> {
    const workspaceId = this.requireWorkspaceId();
    return this.convexService.getClient().query(api.scheduledTransactions.getLinkedTransactions, {
      workspaceId,
      scheduledTransactionId,
      ...(limit !== undefined && { limit }),
    });
  }

  /**
   * Soft-delete a scheduled transaction. Already-entered transactions are unaffected.
   */
  async deleteScheduledTransaction(scheduledTransactionId: Id<'scheduledTransaction'>): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    await this.convexService.mutation(api.scheduledTransactions.deleteScheduledTransaction, {
      workspaceId,
      scheduledTransactionId,
    });
  }

  /**
   * Restore a soft-deleted scheduled transaction for delete undo.
   */
  async restoreScheduledTransaction(scheduledTransactionId: Id<'scheduledTransaction'>): Promise<void> {
    const workspaceId = this.requireWorkspaceId();
    await this.convexService.mutation(api.scheduledTransactions.restoreScheduledTransaction, {
      workspaceId,
      scheduledTransactionId,
    });
  }

  private requireWorkspaceId(): Id<'workspace'> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }
    return workspaceId as Id<'workspace'>;
  }
}
