import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../services/convex.service';
import { WorkspaceService } from '../../services/workspace.service';
import { BUDGET_HISTORY_DAYS, BudgetHistoryPopoverComponent } from './budget-history-popover.component';

type BudgetHistoryResponse = FunctionReturnType<typeof api.activityLogs.listBudgetHistory>;
type BudgetHistoryEntry = BudgetHistoryResponse['entries'][number];
type MoneyMovementDetails = Extract<BudgetHistoryEntry['details'], { kind: 'money_movement' }>;
type MoneyMovement = MoneyMovementDetails['movements'][number];

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function workspaceId(id: string): Id<'workspace'> {
  return id as Id<'workspace'>;
}

function historyEntry(
  id: string,
  movements: MoneyMovement[],
  options: {
    yearMonth?: number;
    occurredAt?: string;
    actorName?: string;
  } = {}
): BudgetHistoryEntry {
  return {
    _id: id as Id<'activityLog'>,
    _creationTime: Date.parse(options.occurredAt ?? '2026-07-11T14:30:00.000Z'),
    workspaceId: workspaceId('workspace-1'),
    actor: {
      clerkId: 'user_1',
      name: options.actorName ?? 'Taylor',
    },
    source: { type: 'kualia_ui' },
    type: 'money_moved',
    entityType: 'budget_assignment',
    entityId: 'category_1',
    currencyCode: 'USD',
    details: {
      kind: 'money_movement',
      yearMonth: options.yearMonth ?? 202607,
      movements,
    },
    occurredAt: options.occurredAt ?? '2026-07-11T14:30:00.000Z',
  };
}

describe('BudgetHistoryPopoverComponent', () => {
  let queryCallback: ((value: BudgetHistoryResponse | undefined) => void) | null;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let watchQuery: ReturnType<typeof vi.fn>;

  function createFixture(): ComponentFixture<BudgetHistoryPopoverComponent> {
    const fixture = TestBed.createComponent(BudgetHistoryPopoverComponent);
    fixture.detectChanges();
    return fixture;
  }

  async function openPopover(fixture: ComponentFixture<BudgetHistoryPopoverComponent>): Promise<void> {
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="budget-history-trigger"]'
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    trigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function emitHistory(value: BudgetHistoryResponse | undefined): void {
    if (!queryCallback) {
      throw new Error('Budget history query is not subscribed');
    }
    queryCallback(value);
  }

  beforeEach(() => {
    queryCallback = null;
    unsubscribe = vi.fn();
    watchQuery = vi.fn(() => ({
      subscribe: (callback: (value: BudgetHistoryResponse | undefined) => void) => {
        queryCallback = callback;
        return unsubscribe;
      },
    }));

    const workspaceIdSignal = signal<Id<'workspace'> | null>(workspaceId('workspace-1'));
    const convexServiceMock: Pick<ConvexService, 'watchQuery'> = {
      watchQuery: watchQuery as unknown as ConvexService['watchQuery'],
    };
    const workspaceServiceMock: Pick<WorkspaceService, 'workspaceId'> = {
      workspaceId: workspaceIdSignal.asReadonly(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetHistoryPopoverComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: convexServiceMock },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((element) => element.remove());
  });

  it('loads a fresh 34-day window only when opened', async () => {
    const fixture = createFixture();

    expect(watchQuery).not.toHaveBeenCalled();

    await openPopover(fixture);

    expect(watchQuery).toHaveBeenCalledOnce();
    const args = watchQuery.mock.calls[0]?.[1] as { workspaceId: Id<'workspace'>; since: string };
    expect(watchQuery).toHaveBeenCalledWith(api.activityLogs.listBudgetHistory, args);
    expect(args.workspaceId).toBe(workspaceId('workspace-1'));
    expect(Math.abs(Date.parse(args.since) - (Date.now() - BUDGET_HISTORY_DAYS * DAY_IN_MS))).toBeLessThan(2_000);
    expect(document.querySelector('[data-testid="budget-history-popover"]')?.getAttribute('aria-labelledby')).toBe(
      'budget-history-title'
    );
    expect(document.querySelector('[data-testid="budget-history-popover"]')?.getAttribute('role')).toBe('dialog');
    expect(document.querySelector('[data-testid="budget-history-scroll"]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders assignments, unassignments, direct moves, and multi-assignment events', async () => {
    const fixture = createFixture();
    await openPopover(fixture);

    emitHistory({
      entries: [
        historyEntry('assigned', [
          {
            amount: 12_500n,
            from: { type: 'ready_to_assign' },
            to: { type: 'category', category: { id: 'groceries', name: 'Groceries' } },
          },
        ]),
        historyEntry('unassigned', [
          {
            amount: 2_500n,
            from: { type: 'category', category: { id: 'dining', name: 'Dining Out' } },
            to: { type: 'ready_to_assign' },
          },
        ]),
        historyEntry('moved', [
          {
            amount: 5_000n,
            from: { type: 'category', category: { id: 'fun', name: 'Fun Money' } },
            to: { type: 'category', category: { id: 'rent', name: 'Rent' } },
          },
        ]),
        historyEntry('batch', [
          {
            amount: 10_000n,
            from: { type: 'ready_to_assign' },
            to: { type: 'category', category: { id: 'rent', name: 'Rent' } },
          },
          {
            amount: 3_000n,
            from: { type: 'category', category: { id: 'travel', name: 'Travel' } },
            to: { type: 'ready_to_assign' },
          },
        ]),
      ],
      hasMore: true,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const popoverText = document.querySelector('[data-testid="budget-history-popover"]')?.textContent ?? '';
    expect(popoverText).toContain('Assigned $125.00 to Groceries');
    expect(popoverText).toContain('Unassigned $25.00 from Dining Out');
    expect(popoverText).toContain('Moved $50.00 from Fun Money to Rent');
    expect(popoverText).toContain('Updated 2 assignments');
    expect(popoverText).toContain('Assigned $100.00 to Rent');
    expect(popoverText).toContain('Unassigned $30.00 from Travel');
    expect(popoverText).toContain('July 2026');
    expect(popoverText).toContain('Taylor');
    expect(popoverText).toContain('Showing the 100 most recent changes in this 34-day window.');
    expect(document.querySelectorAll('[data-testid^="budget-history-entry-"]')).toHaveLength(4);
    expect(document.querySelector('[data-testid="budget-history-scroll"]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('shows an empty state without leaving the popover busy', async () => {
    const fixture = createFixture();
    await openPopover(fixture);

    emitHistory({ entries: [], hasMore: false });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.querySelector('[data-testid="budget-history-empty"]')?.textContent).toContain(
      'No assignment history'
    );
    expect(document.querySelector('[data-testid="budget-history-scroll"]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('shows an error state without leaving the popover busy', async () => {
    const fixture = createFixture();
    await openPopover(fixture);
    emitHistory(undefined);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.querySelector('[data-testid="budget-history-error"]')?.textContent).toContain(
      'Couldn’t load budget history'
    );
    expect(document.querySelector('[data-testid="budget-history-error"]')?.getAttribute('role')).toBe('alert');
    expect(document.querySelector('[data-testid="budget-history-scroll"]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('unsubscribes and clears the list when closed', async () => {
    const fixture = createFixture();
    await openPopover(fixture);
    emitHistory({
      entries: [
        historyEntry('assigned', [
          {
            amount: 1_000n,
            from: { type: 'ready_to_assign' },
            to: { type: 'category', category: { id: 'groceries', name: 'Groceries' } },
          },
        ]),
      ],
      hasMore: false,
    });
    fixture.detectChanges();

    fixture.componentInstance.onPopoverStateChange('closed');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.entries()).toEqual([]);
  });
});
