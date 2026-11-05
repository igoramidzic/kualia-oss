import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { ActivityComponent } from './activity';

type ActivityPage = FunctionReturnType<typeof api.activityLogs.listActivity>;
type ActivityEntry = ActivityPage['page'][number];
type ActivitySource = ActivityEntry['source'];

const WORKSPACE_ID = 'workspace_123' as Id<'workspace'>;

function page(entries: ActivityEntry[], continueCursor = 'done', isDone = true): ActivityPage {
  return { page: entries, continueCursor, isDone };
}

function moneyMovedEntry(
  id: string,
  source: ActivitySource = {
    type: 'public_api',
    apiKeyId: 'api_key_123' as Id<'apiKey'>,
    apiKeyLabel: 'Budget Bot',
    apiKeyPrefix: 'kual_live',
  }
): ActivityEntry {
  return {
    _id: id as Id<'activityLog'>,
    _creationTime: 1,
    workspaceId: WORKSPACE_ID,
    actor: {
      clerkId: 'user_123',
      name: 'Taylor',
      email: 'taylor@example.com',
    },
    source,
    type: 'money_moved',
    entityType: 'budget_assignment',
    entityId: '202607',
    currencyCode: 'USD',
    details: {
      kind: 'money_movement',
      yearMonth: 202607,
      movements: [
        {
          amount: 10_000n,
          from: { type: 'ready_to_assign' },
          to: {
            type: 'category',
            category: { id: 'category_123', name: 'Dining Out' },
          },
        },
      ],
    },
    occurredAt: '2026-07-10T18:30:00.000Z',
  };
}

function moneyMovedBetweenCategoriesEntry(id: string): ActivityEntry {
  const entry = moneyMovedEntry(id, { type: 'kualia_ui' });
  return {
    ...entry,
    details: {
      kind: 'money_movement',
      yearMonth: 202607,
      movements: [
        {
          amount: 5_000n,
          from: {
            type: 'category',
            category: { id: 'category_123', name: 'Dining Out' },
          },
          to: {
            type: 'category',
            category: { id: 'category_456', name: 'Fun Money' },
          },
        },
      ],
    },
  };
}

function moneyUnassignedEntry(id: string): ActivityEntry {
  const entry = moneyMovedEntry(id, { type: 'kualia_ui' });
  return {
    ...entry,
    details: {
      kind: 'money_movement',
      yearMonth: 202607,
      movements: [
        {
          amount: 2_500n,
          from: {
            type: 'category',
            category: { id: 'category_123', name: 'Dining Out' },
          },
          to: { type: 'ready_to_assign' },
        },
      ],
    },
  };
}

function scheduledTransactionEntry(id: string): ActivityEntry {
  return {
    _id: id as Id<'activityLog'>,
    _creationTime: 2,
    workspaceId: WORKSPACE_ID,
    actor: {
      clerkId: 'user_123',
      name: 'Taylor',
      email: 'taylor@example.com',
    },
    source: { type: 'system', process: 'scheduled_transaction' },
    type: 'scheduled_transaction_entered',
    entityType: 'transaction',
    entityId: 'transaction_123',
    currencyCode: 'USD',
    details: {
      kind: 'transaction',
      after: {
        id: 'transaction_123' as Id<'transaction'>,
        type: 'regular',
        date: '2026-07-10',
        amount: -2_500n,
        account: { id: 'account_123', name: 'Checking' },
        merchant: { id: 'merchant_123', name: 'Coffee Shop' },
        movements: [
          {
            amount: -2_500n,
            category: { id: 'category_456', name: 'Coffee' },
            readyToAssign: false,
          },
        ],
        movementCount: 1,
        movementsTruncated: false,
        status: 'cleared',
        reviewStatus: 'reviewed',
      },
    },
    occurredAt: '2026-07-10T16:00:00.000Z',
  };
}

function updatedTransactionEntry(id: string): ActivityEntry {
  const scheduled = scheduledTransactionEntry(id);
  if (scheduled.details.kind !== 'transaction' || !scheduled.details.after) {
    throw new Error('Expected a transaction snapshot');
  }

  const before = scheduled.details.after;
  return {
    ...scheduled,
    source: { type: 'kualia_ui' },
    type: 'transaction_updated',
    details: {
      kind: 'transaction',
      before,
      after: {
        ...before,
        amount: -3_000n,
        movements: [
          {
            amount: -3_000n,
            category: { id: 'category_999', name: 'Dining Out' },
            readyToAssign: false,
          },
        ],
      },
    },
  };
}

function startingBalanceEntry(id: string): ActivityEntry {
  const scheduled = scheduledTransactionEntry(id);
  if (scheduled.details.kind !== 'transaction' || !scheduled.details.after) {
    throw new Error('Expected a transaction snapshot');
  }

  return {
    ...scheduled,
    source: { type: 'kualia_ui' },
    type: 'transaction_created',
    details: {
      kind: 'transaction',
      after: {
        ...scheduled.details.after,
        type: 'starting_balance',
        amount: 1_231_300n,
        account: { id: 'account_starting_balance', name: 'Test' },
        merchant: undefined,
        movements: [
          {
            amount: 1_231_300n,
            readyToAssign: true,
          },
        ],
      },
    },
  };
}

function transferTransactionEntry(id: string): ActivityEntry {
  const scheduled = scheduledTransactionEntry(id);
  if (scheduled.details.kind !== 'transaction' || !scheduled.details.after) {
    throw new Error('Expected a transaction snapshot');
  }

  return {
    ...scheduled,
    source: { type: 'kualia_ui' },
    type: 'transaction_created',
    details: {
      kind: 'transaction',
      after: {
        ...scheduled.details.after,
        type: 'transfer',
        amount: -10_000n,
        account: { id: 'account_amex', name: 'Amex' },
        transferAccount: { id: 'account_sofi', name: 'SoFi Checking' },
        merchant: undefined,
        movements: [
          {
            amount: -10_000n,
            readyToAssign: false,
          },
        ],
      },
    },
  };
}

function deletedTransactionEntry(id: string): ActivityEntry {
  const scheduled = scheduledTransactionEntry(id);
  if (scheduled.details.kind !== 'transaction' || !scheduled.details.after) {
    throw new Error('Expected a transaction snapshot');
  }

  return {
    ...scheduled,
    source: { type: 'kualia_ui' },
    type: 'transaction_deleted',
    details: {
      kind: 'transaction',
      before: scheduled.details.after,
    },
  };
}

function mcpCategoryEntry(id: string): ActivityEntry {
  return {
    _id: id as Id<'activityLog'>,
    _creationTime: 3,
    workspaceId: WORKSPACE_ID,
    actor: {
      clerkId: 'user_456',
      email: 'morgan@example.com',
    },
    source: { type: 'mcp', clientName: 'Claude Desktop' },
    type: 'category_archived',
    entityType: 'category',
    entityId: 'category_789',
    currencyCode: 'USD',
    details: {
      kind: 'category',
      before: {
        id: 'category_789' as Id<'category'>,
        name: 'Old Goal',
        group: { id: 'group_123', name: 'Goals' },
        isArchived: false,
        sortOrder: 100,
        target: { enabled: false },
      },
      after: {
        id: 'category_789' as Id<'category'>,
        name: 'Old Goal',
        group: { id: 'group_123', name: 'Goals' },
        isArchived: true,
        sortOrder: 100,
        target: { enabled: false },
      },
    },
    occurredAt: '2026-07-09T15:00:00.000Z',
  };
}

function restoredBankAccountEntry(id: string): ActivityEntry {
  const account = {
    id: 'account_restored' as Id<'bankAccount'>,
    name: 'Emergency Savings',
    accountType: 'banking_savings',
    currentBalance: 123_456n,
    isClosed: false,
  } as const;

  return {
    _id: id as Id<'activityLog'>,
    _creationTime: 4,
    workspaceId: WORKSPACE_ID,
    actor: {
      clerkId: 'user_123',
      name: 'Taylor',
      email: 'taylor@example.com',
    },
    source: { type: 'kualia_ui' },
    type: 'bank_account_restored',
    entityType: 'bank_account',
    entityId: account.id,
    currencyCode: 'USD',
    details: {
      kind: 'bank_account',
      before: account,
      after: account,
    },
    occurredAt: '2026-07-08T14:00:00.000Z',
  };
}

function mergedMerchantEntry(id: string): ActivityEntry {
  const source = {
    id: 'merchant_source' as Id<'merchant'>,
    name: 'Old Coffee Shop',
    isDeleted: false,
  } as const;

  return {
    _id: id as Id<'activityLog'>,
    _creationTime: 5,
    workspaceId: WORKSPACE_ID,
    actor: {
      clerkId: 'user_123',
      name: 'Taylor',
      email: 'taylor@example.com',
    },
    source: { type: 'kualia_ui' },
    type: 'merchant_merged',
    entityType: 'merchant',
    entityId: source.id,
    currencyCode: 'USD',
    details: {
      kind: 'merchant',
      before: source,
      after: { ...source, isDeleted: true },
      mergeTarget: {
        id: 'merchant_target' as Id<'merchant'>,
        name: 'Coffee Shop',
        isDeleted: false,
      },
      movedTransactionCount: 3,
      updatedRecurringTransactionCount: 1,
    },
    occurredAt: '2026-07-10T14:00:00.000Z',
  };
}

function createdMerchantEntry(id: string): ActivityEntry {
  const merged = mergedMerchantEntry(id);
  if (merged.details.kind !== 'merchant' || !merged.details.mergeTarget) {
    throw new Error('Expected a merchant snapshot');
  }

  return {
    ...merged,
    type: 'merchant_created',
    entityId: merged.details.mergeTarget.id,
    details: { kind: 'merchant', after: merged.details.mergeTarget },
  };
}

function updatedMerchantEntry(id: string): ActivityEntry {
  const merged = mergedMerchantEntry(id);
  if (merged.details.kind !== 'merchant' || !merged.details.before) {
    throw new Error('Expected a merchant snapshot');
  }

  return {
    ...merged,
    type: 'merchant_updated',
    details: {
      kind: 'merchant',
      before: merged.details.before,
      after: { ...merged.details.before, name: 'New Coffee Shop' },
    },
  };
}

function deletedMerchantEntry(id: string): ActivityEntry {
  const merged = mergedMerchantEntry(id);
  if (merged.details.kind !== 'merchant' || !merged.details.before || !merged.details.after) {
    throw new Error('Expected a merchant snapshot');
  }

  return {
    ...merged,
    type: 'merchant_deleted',
    details: {
      kind: 'merchant',
      before: merged.details.before,
      after: merged.details.after,
    },
  };
}

describe('ActivityComponent', () => {
  let fixture: ComponentFixture<ActivityComponent>;
  let query: ReturnType<typeof vi.fn>;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let workspaceId: ReturnType<typeof signal<Id<'workspace'> | null>>;

  function createFixture(): ComponentFixture<ActivityComponent> {
    fixture = TestBed.createComponent(ActivityComponent);
    fixture.detectChanges();
    return fixture;
  }

  async function waitForLoad(): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="activity-list"], [data-testid="activity-empty"], [data-testid="activity-error"]'
        )
      ).not.toBeNull();
    });
  }

  beforeEach(() => {
    query = vi.fn().mockResolvedValue(page([]));
    unsubscribe = vi.fn();
    workspaceId = signal<Id<'workspace'> | null>(WORKSPACE_ID);

    const convexServiceMock: Pick<ConvexService, 'getClient' | 'watchQuery'> = {
      getClient: vi.fn().mockReturnValue({ query }),
      watchQuery: vi.fn().mockReturnValue({
        subscribe: vi.fn().mockReturnValue(unsubscribe),
      }),
    };

    const workspaceServiceMock: Pick<WorkspaceService, 'workspaceId' | 'workspaceShortId' | 'workspace'> = {
      workspaceId: workspaceId.asReadonly(),
      workspaceShortId: signal('personal').asReadonly(),
      workspace: signal({ name: 'Personal' }).asReadonly() as WorkspaceService['workspace'],
    };

    TestBed.configureTestingModule({
      imports: [ActivityComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ConvexService, useValue: convexServiceMock },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: HlmSidebarService, useValue: { toggleSidebar: vi.fn() } },
      ],
    });
  });

  it('reserves the scrollbar gutter and stays quiet before fading in the resolved state', async () => {
    let resolveInitial: ((value: ActivityPage) => void) | undefined;
    query.mockReturnValueOnce(
      new Promise<ActivityPage>((resolve) => {
        resolveInitial = resolve;
      })
    );

    createFixture();

    const scrollContainer = fixture.nativeElement.querySelector(
      '[data-testid="activity-scroll-container"]'
    ) as HTMLElement;
    expect(scrollContainer.classList.contains('[scrollbar-gutter:stable]')).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="activity-loading"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="activity-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="activity-list"]')).toBeNull();

    resolveInitial?.(page([]));
    await waitForLoad();

    expect(fixture.nativeElement.querySelector('[data-testid="activity-empty"]')?.classList).toContain('fade-in');
  });

  it('renders immutable money, transaction, actor, source, and date snapshots', async () => {
    query.mockResolvedValueOnce(
      page([
        moneyMovedEntry('activity_1'),
        scheduledTransactionEntry('activity_2'),
        mcpCategoryEntry('activity_3'),
        updatedTransactionEntry('activity_4'),
        restoredBankAccountEntry('activity_5'),
        moneyMovedBetweenCategoriesEntry('activity_6'),
        moneyUnassignedEntry('activity_7'),
        startingBalanceEntry('activity_8'),
        deletedTransactionEntry('activity_9'),
        mergedMerchantEntry('activity_10'),
        createdMerchantEntry('activity_11'),
        updatedMerchantEntry('activity_12'),
        deletedMerchantEntry('activity_13'),
        transferTransactionEntry('activity_14'),
      ])
    );

    createFixture();
    await waitForLoad();

    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('Assigned $100.00 to Dining Out for July 2026.');
    expect(text).toContain('Unassigned $25.00 from Dining Out for July 2026.');
    expect(text).toContain('Moved $50.00 from Dining Out to Fun Money for July 2026.');
    expect(text).toContain('Taylor');
    expect(text).toContain('Public API');
    expect(text).toContain('Budget Bot (kual_live…)');
    expect(text).toContain('Entered a scheduled -$25.00 transaction with Coffee Shop in Checking.');
    expect(text).toContain('Scheduled transaction');
    expect(text).toContain('Jul 10, 2026 · Coffee');
    expect(text).toContain('Archived category Old Goal.');
    expect(text).toContain('morgan@example.com');
    expect(text).toContain('MCP · Claude Desktop');
    expect(text).toContain('Restored bank account Emergency Savings with a balance of $1,234.56.');
    expect(text).toContain('Friday, July 10, 2026');
    expect(text).toContain('Thursday, July 9, 2026');
    expect(text).toContain('Wednesday, July 8, 2026');
    const dateGroups = fixture.nativeElement.querySelectorAll('[data-testid^="activity-date-group-"]');
    const dateCards = fixture.nativeElement.querySelectorAll('[data-testid^="activity-date-card-"]');
    expect(dateGroups).toHaveLength(3);
    expect(dateCards).toHaveLength(3);
    expect(dateCards[0].contains(dateGroups[0].querySelector('h2'))).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="activity-entry-activity_1"]')?.classList).toContain(
      'fade-in'
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="activity-entity-link-activity_2"]')?.getAttribute('href')
    ).toBe('/personal/transactions/transaction_123/details');
    expect(
      fixture.nativeElement.querySelector('[data-testid="activity-entity-link-activity_5"]')?.getAttribute('href')
    ).toBe('/personal/bank-accounts/restored');
    expect(fixture.nativeElement.querySelector('[data-testid="activity-entity-link-activity_9"]')).toBeNull();
    expect(text).toContain('Merged merchant Old Coffee Shop into Coffee Shop.');
    expect(text).toContain('3 transactions and 1 planned transaction moved.');
    expect(text).toContain('Created merchant Coffee Shop.');
    expect(text).toContain('Updated merchant New Coffee Shop.');
    expect(text).toContain('Name: Old Coffee Shop → New Coffee Shop');
    expect(text).toContain('Deleted merchant Old Coffee Shop.');
    expect(
      fixture.nativeElement.querySelector('[data-testid="activity-entity-link-activity_10"]')?.getAttribute('href')
    ).toBe('/personal/settings/merchants/t_target/details');
    expect(fixture.nativeElement.querySelector('[data-testid="activity-entity-link-activity_13"]')).toBeNull();

    const transferEntry = fixture.nativeElement.querySelector(
      '[data-testid="activity-entry-activity_14"]'
    ) as HTMLElement;
    const transferText = transferEntry.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(transferText).toContain('Transferred $100.00 from Amex to SoFi Checking.');
    expect(transferText).not.toContain('Uncategorized');

    const startingBalanceEntryElement = fixture.nativeElement.querySelector(
      '[data-testid="activity-entry-activity_8"]'
    ) as HTMLElement;
    const startingBalanceText = startingBalanceEntryElement.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(startingBalanceText).toContain('Set the starting balance for Test to $12,313.00.');
    expect(startingBalanceText).not.toContain('No payee');
    expect(startingBalanceText).not.toContain('Ready to Assign');

    const updatedEntry = fixture.nativeElement.querySelector(
      '[data-testid="activity-entry-activity_4"]'
    ) as HTMLElement;
    const updatedText = updatedEntry.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(updatedText).toContain('Amount: -$25.00 → -$30.00');
    expect(updatedText).toContain('Categories: Coffee: -$25.00 → Dining Out: -$30.00');

    const time = fixture.nativeElement.querySelector('time') as HTMLTimeElement;
    expect(time.dateTime).toBe('2026-07-10T18:30:00.000Z');
  });

  it('appends cursor pages without duplicating entries and stops when done', async () => {
    const first = moneyMovedEntry('activity_1');
    const second = scheduledTransactionEntry('activity_2');
    query.mockResolvedValueOnce(page([first], 'cursor_1', false)).mockResolvedValueOnce(page([first, second]));

    createFixture();
    await waitForLoad();

    await fixture.componentInstance.loadMore();
    fixture.detectChanges();

    expect(query).toHaveBeenNthCalledWith(
      2,
      api.activityLogs.listActivity,
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        paginationOpts: { numItems: 50, cursor: 'cursor_1' },
      })
    );
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="activity-entry-"]')).toHaveLength(2);

    await fixture.componentInstance.loadMore();
    expect(query).toHaveBeenCalledTimes(2);

    fixture.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('collapses overflowing activity and toggles it with animation state', async () => {
    query.mockResolvedValueOnce(page([updatedTransactionEntry('activity_long')]));

    createFixture();
    await waitForLoad();

    const content = fixture.nativeElement.querySelector(
      '[data-testid="activity-content-activity_long"]'
    ) as HTMLElement;
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 320 });

    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="activity-toggle-activity_long"]'
    ) as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(content.style.maxHeight).toBe('144px');
    expect(fixture.nativeElement.querySelector('[data-testid="activity-fade-activity_long"]')).not.toBeNull();
    const attribution = fixture.nativeElement.querySelector(
      '[data-testid="activity-attribution-activity_long"]'
    ) as HTMLElement;
    expect(attribution.textContent).toContain('Taylor');
    expect(attribution.textContent).toContain('via');
    expect(attribution.textContent).toContain('Kualia UI');
    expect(attribution.querySelector('time')?.dateTime).toBe('2026-07-10T16:00:00.000Z');
    expect(content.contains(attribution)).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="activity-toggle-activity_long"]')?.textContent).toContain(
      'Show more'
    );

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content.style.maxHeight).toBe('320px');
    expect(fixture.nativeElement.querySelector('[data-testid="activity-fade-activity_long"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="activity-toggle-activity_long"]')?.textContent).toContain(
      'Show less'
    );

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(content.style.maxHeight).toBe('144px');
  });

  it('shows a query error without an empty-state fallback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    query.mockRejectedValueOnce(new Error('Network unavailable'));

    createFixture();
    await waitForLoad();

    expect(fixture.nativeElement.querySelector('[data-testid="activity-error"]')?.textContent).toContain(
      'Failed to load activity'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="activity-empty"]')).toBeNull();
    consoleError.mockRestore();
  });
});
