import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { nucleoHistory as History, NucleoIcon } from '@kualia/icons';
import { ConvexService } from '../../services/convex.service';
import { WorkspaceService } from '../../services/workspace.service';
import { formatCurrency, formatMonth } from '../../shared/utils/formatters';

type BudgetHistoryResponse = FunctionReturnType<typeof api.activityLogs.listBudgetHistory>;
type BudgetHistoryEntry = BudgetHistoryResponse['entries'][number];
type MoneyMovementDetails = Extract<BudgetHistoryEntry['details'], { kind: 'money_movement' }>;
type MoneyMovement = MoneyMovementDetails['movements'][number];
type MoneyMovementEntry = BudgetHistoryEntry & { details: MoneyMovementDetails };

const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const BUDGET_HISTORY_DAYS = 34;

function isMoneyMovementEntry(entry: BudgetHistoryEntry): entry is MoneyMovementEntry {
  return entry.type === 'money_moved' && entry.details.kind === 'money_movement';
}

@Component({
  selector: 'app-budget-history-popover',
  imports: [BrnPopover, BrnPopoverContent, BrnPopoverTrigger, DatePipe, HlmButton, HlmPopoverContent, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
  },
  styles: [
    `
      .budget-history-scroll {
        height: min(320px, calc(100vh - 6rem));
        min-height: 180px;
        overflow-y: auto;
      }
    `,
  ],
  template: `
    <brn-popover
      [state]="popoverState()"
      (stateChanged)="onPopoverStateChange($event)"
      side="bottom"
      align="start"
      sideOffset="5"
    >
      <button
        hlmBtn
        variant="ghost"
        size="sm"
        type="button"
        [class]="popoverState() === 'open' ? 'bg-accent w-7 shrink-0' : 'w-7 shrink-0'"
        [attr.aria-expanded]="popoverState() === 'open'"
        brnPopoverTrigger
        aria-label="Budget history"
        data-testid="budget-history-trigger"
      >
        <nucleo-icon [icon]="History" [size]="14" class="text-muted-foreground" />
      </button>

      <div
        *brnPopoverContent
        class="w-[min(380px,calc(100vw-1rem))] p-0"
        hlmPopoverContent
        role="dialog"
        aria-labelledby="budget-history-title"
        data-testid="budget-history-popover"
      >
        <div class="border-b px-3 py-2.5">
          <p id="budget-history-title" class="text-sm font-semibold">Budget history</p>
          <p class="text-muted-foreground mt-0.5 text-xs">Assignments and money moves from the last 34 days</p>
        </div>

        <div class="budget-history-scroll" [attr.aria-busy]="loading()" data-testid="budget-history-scroll">
          @if (loading()) {
            <div class="text-muted-foreground flex h-full items-center justify-center text-sm" role="status">
              Loading history…
            </div>
          } @else if (error()) {
            <div
              class="flex h-full flex-col items-center justify-center px-6 text-center"
              role="alert"
              data-testid="budget-history-error"
            >
              <p class="text-sm font-medium">Couldn’t load budget history</p>
              <p class="text-muted-foreground mt-1 text-xs">Close this popover and try again.</p>
            </div>
          } @else if (entries().length === 0) {
            <div
              class="flex h-full flex-col items-center justify-center px-6 text-center"
              data-testid="budget-history-empty"
            >
              <nucleo-icon [icon]="History" class="text-muted-foreground h-5 w-5" />
              <p class="mt-2 text-sm font-medium">No assignment history</p>
              <p class="text-muted-foreground mt-1 text-xs">
                Assignments and moves from the last 34 days will appear here.
              </p>
            </div>
          } @else {
            <ol class="px-3 py-1" data-testid="budget-history-list">
              @for (entry of entries(); track entry._id; let isLast = $last) {
                <li class="flex gap-2.5 py-2.5" [attr.data-testid]="'budget-history-entry-' + entry._id">
                  <div class="relative flex w-3 shrink-0 justify-center" aria-hidden="true">
                    @if (!isLast) {
                      <span class="bg-border absolute top-3.5 -bottom-3 w-px"></span>
                    }
                    <span class="bg-primary ring-popover relative mt-1.5 h-2 w-2 rounded-full ring-2"></span>
                  </div>

                  <div class="min-w-0 flex-1">
                    @if (entry.details.movements.length > 1) {
                      <p class="text-sm font-medium">Updated {{ entry.details.movements.length }} assignments</p>
                      <div class="text-muted-foreground mt-1 space-y-0.5 text-xs">
                        @for (movement of entry.details.movements; track $index) {
                          <p>{{ movementDescription(movement, entry.currencyCode) }}</p>
                        }
                      </div>
                    } @else {
                      @for (movement of entry.details.movements; track $index) {
                        <p class="text-sm font-medium">{{ movementDescription(movement, entry.currencyCode) }}</p>
                      }
                    }

                    <div class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-1 text-[11px] leading-4">
                      <span>{{ monthLabel(entry.details.yearMonth) }}</span>
                      <span aria-hidden="true">·</span>
                      <span class="truncate">{{ actorLabel(entry) }}</span>
                      @if (sourceLabel(entry); as source) {
                        <span aria-hidden="true">·</span>
                        <span>{{ source }}</span>
                      }
                      <span aria-hidden="true">·</span>
                      <time [attr.datetime]="entry.occurredAt">{{ entry.occurredAt | date: 'MMM d, h:mm a' }}</time>
                    </div>
                  </div>
                </li>
              }
            </ol>
            @if (hasMore()) {
              <p
                class="text-muted-foreground border-t px-3 py-2 text-center text-[11px]"
                data-testid="budget-history-limit"
              >
                Showing the 100 most recent changes in this 34-day window.
              </p>
            }
          }
        </div>
      </div>
    </brn-popover>
  `,
})
export class BudgetHistoryPopoverComponent {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  readonly History = History;
  readonly popoverState = signal<'open' | 'closed'>('closed');

  private readonly historyResponse = signal<BudgetHistoryResponse>({ entries: [], hasMore: false });
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private historySubscription?: () => void;

  readonly entries = computed<MoneyMovementEntry[]>(() => this.historyResponse().entries.filter(isMoneyMovementEntry));
  readonly hasMore = computed(() => this.historyResponse().hasMore);
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  constructor() {
    effect(() => {
      const state = this.popoverState();
      const workspaceId = this.workspaceService.workspaceId();

      if (state === 'open' && workspaceId) {
        this.subscribe(workspaceId as Id<'workspace'>);
      } else {
        this.unsubscribeAndReset();
      }
    });

    this.destroyRef.onDestroy(() => this.unsubscribe());
  }

  onPopoverStateChange(state: 'open' | 'closed'): void {
    this.popoverState.set(state);
  }

  movementDescription(movement: MoneyMovement, currencyCode: string): string {
    const amount = formatCurrency(movement.amount, currencyCode);

    if (movement.from.type === 'ready_to_assign' && movement.to.type === 'category') {
      return `Assigned ${amount} to ${movement.to.category.name}`;
    }

    if (movement.from.type === 'category' && movement.to.type === 'ready_to_assign') {
      return `Unassigned ${amount} from ${movement.from.category.name}`;
    }

    return `Moved ${amount} from ${this.moneyLocationName(movement.from)} to ${this.moneyLocationName(movement.to)}`;
  }

  monthLabel(yearMonth: number): string {
    return formatMonth(yearMonth.toString());
  }

  actorLabel(entry: MoneyMovementEntry): string {
    const name = entry.actor.name?.trim();
    if (name) return name;

    const email = entry.actor.email?.trim();
    if (email) return email;

    return entry.actor.clerkId === 'system' ? 'Kualia' : entry.actor.clerkId;
  }

  sourceLabel(entry: MoneyMovementEntry): string | null {
    switch (entry.source.type) {
      case 'kualia_ui':
        return null;
      case 'public_api':
        return entry.source.apiKeyLabel;
      case 'mcp':
        return entry.source.clientName ?? 'MCP';
      case 'system':
        return 'Kualia';
    }
  }

  private moneyLocationName(location: MoneyMovement['from']): string {
    return location.type === 'ready_to_assign' ? 'Ready to Assign' : location.category.name;
  }

  private subscribe(workspaceId: Id<'workspace'>): void {
    this.unsubscribe();
    this.historyResponse.set({ entries: [], hasMore: false });
    this.errorState.set(null);
    this.loadingState.set(true);

    const since = new Date(Date.now() - BUDGET_HISTORY_DAYS * DAY_IN_MS).toISOString();

    try {
      const watcher = this.convexService.watchQuery<BudgetHistoryResponse>(api.activityLogs.listBudgetHistory, {
        workspaceId,
        since,
      });

      this.historySubscription = watcher.subscribe((response) => {
        if (response === undefined) {
          this.historyResponse.set({ entries: [], hasMore: false });
          this.errorState.set('Failed to load budget history');
        } else {
          this.historyResponse.set(response);
          this.errorState.set(null);
        }
        this.loadingState.set(false);
      });
    } catch (error: unknown) {
      console.error('Failed to load budget history:', error);
      this.historyResponse.set({ entries: [], hasMore: false });
      this.errorState.set('Failed to load budget history');
      this.loadingState.set(false);
    }
  }

  private unsubscribeAndReset(): void {
    this.unsubscribe();
    this.historyResponse.set({ entries: [], hasMore: false });
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  private unsubscribe(): void {
    this.historySubscription?.();
    this.historySubscription = undefined;
  }
}
