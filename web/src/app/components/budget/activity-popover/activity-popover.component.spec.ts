import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { CurrencyService } from '../../../services/currency.service';
import { TransactionService } from '../../../services/transaction.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { ActivityPopoverComponent } from './activity-popover.component';

type ActivityTransactions = FunctionReturnType<typeof api.transactions.listTransactionsByMonth>;

function catId(id: string): Id<'category'> {
  return id as Id<'category'>;
}

function workspaceId(id: string): Id<'workspace'> {
  return id as Id<'workspace'>;
}

describe('ActivityPopoverComponent', () => {
  let queryCallback: ((value: ActivityTransactions | undefined) => void) | null;

  function createFixture(): ComponentFixture<ActivityPopoverComponent> {
    const fixture = TestBed.createComponent(ActivityPopoverComponent);
    fixture.componentRef.setInput('categoryId', catId('groceries'));
    fixture.componentRef.setInput('categoryName', 'Groceries');
    fixture.componentRef.setInput('activityAmount', -1234n);
    fixture.componentRef.setInput('yearMonth', 202606);
    fixture.detectChanges();
    return fixture;
  }

  function findScrollBody(): HTMLElement | null {
    return document.querySelector('.activity-popover-scroll');
  }

  function findPopoverContent(): HTMLElement | null {
    return document.querySelector('.cdk-overlay-pane [data-state]');
  }

  function findSkeletons(): NodeListOf<HTMLElement> {
    return document.querySelectorAll('hlm-skeleton');
  }

  function expectFixedScrollViewport(element: HTMLElement | null): void {
    expect(element).not.toBeNull();
    const styles = getComputedStyle(element!);
    expect(styles.height).toBe('200px');
    expect(styles.overflowY).toBe('auto');
  }

  beforeEach(() => {
    queryCallback = null;

    const workspaceIdSignal = signal<Id<'workspace'> | null>(workspaceId('workspace-1'));
    const convexServiceMock: Pick<ConvexService, 'watchQuery'> = {
      watchQuery: <T>() => ({
        subscribe: (callback: (value: T | undefined) => void) => {
          queryCallback = callback as unknown as (value: ActivityTransactions | undefined) => void;
          return vi.fn();
        },
      }),
    };
    const workspaceServiceMock: Pick<WorkspaceService, 'workspaceId'> = {
      workspaceId: workspaceIdSignal.asReadonly(),
    };
    const transactionServiceMock: Pick<TransactionService, 'populateTransactions'> = {
      populateTransactions: vi.fn(() => []),
    };

    TestBed.configureTestingModule({
      imports: [ActivityPopoverComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: convexServiceMock },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: CurrencyService, useValue: { format: (amount: bigint) => `$${Number(amount) / 100}` } },
        { provide: TransactionService, useValue: transactionServiceMock },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((element) => element.remove());
  });

  it('reserves the full scroll viewport while activity transactions load and after they load', async () => {
    const fixture = createFixture();
    const trigger = fixture.nativeElement.querySelector('button[brnPopoverTrigger]') as HTMLButtonElement | null;

    expect(trigger).not.toBeNull();
    trigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const loadingBody = findScrollBody();
    expectFixedScrollViewport(loadingBody);
    expect(loadingBody?.getAttribute('aria-busy')).toBe('true');
    expect(findSkeletons()).toHaveLength(0);

    queryCallback?.([]);
    fixture.detectChanges();
    await fixture.whenStable();

    const loadedBody = findScrollBody();
    expectFixedScrollViewport(loadedBody);
    expect(loadedBody?.getAttribute('aria-busy')).toBe('false');
  });

  it('keeps the exit animation at its final keyframe while closing', async () => {
    const fixture = createFixture();
    const trigger = fixture.nativeElement.querySelector('button[brnPopoverTrigger]') as HTMLButtonElement | null;

    expect(trigger).not.toBeNull();
    trigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const content = findPopoverContent();
    expect(content).not.toBeNull();
    expect(content?.classList.contains('data-closed:fill-mode-forwards')).toBe(true);

    fixture.componentInstance.onPopoverStateChange('closed');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(content?.getAttribute('data-state')).toBe('closed');
  });
});
