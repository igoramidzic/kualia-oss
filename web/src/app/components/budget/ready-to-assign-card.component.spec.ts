import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetMonthService } from '../../services/budget-month.service';
import { BudgetService } from '../../services/budget.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { ReadyToAssignCardComponent } from './ready-to-assign-card.component';

vi.mock('../../../../convex/_generated/api', () => ({
  api: {
    categoryBudgets: {
      batchUpdateCategoryBudgets: vi.fn(),
    },
  },
}));

describe('ReadyToAssignCardComponent', () => {
  let component: ReadyToAssignCardComponent;
  let fixture: ComponentFixture<ReadyToAssignCardComponent>;
  let mockBudgetService: {
    readyToAssign: ReturnType<typeof signal<bigint>>;
    months: ReturnType<typeof signal<unknown[]>>;
  };

  beforeEach(() => {
    mockBudgetService = {
      readyToAssign: signal(0n),
      months: signal([]),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ReadyToAssignCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: BudgetMonthService, useValue: { getLastViewedMonth: vi.fn(() => 202601) } },
        { provide: ConvexService, useValue: { mutation: vi.fn() } },
        { provide: CurrencyService, useValue: { format: vi.fn((amount: number | bigint) => String(amount)) } },
        { provide: UndoRedoService, useValue: { pushAction: vi.fn() } },
        {
          provide: WorkspaceService,
          useValue: {
            workspaceId: vi.fn(() => 'workspace_123' as Id<'workspace'>),
            workspace: signal({ _id: 'workspace_123', currency: 'USD' }),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(ReadyToAssignCardComponent);
    component = fixture.componentInstance;
  });

  it('uses the regular secondary color when ready to assign is zero', () => {
    mockBudgetService.readyToAssign.set(0n);

    expect(component['cardColorClasses']()).toContain('bg-secondary');
    expect(component['cardColorClasses']()).not.toContain('bg-green');
    expect(component['cardColorClasses']()).not.toContain('bg-destructive');
  });

  it('uses green when ready to assign is positive', () => {
    mockBudgetService.readyToAssign.set(1n);

    expect(component['cardColorClasses']()).toContain('bg-green-100');
    expect(component['cardColorClasses']()).not.toContain('bg-secondary');
  });

  it('uses destructive styling when ready to assign is negative', () => {
    mockBudgetService.readyToAssign.set(-1n);

    expect(component['cardColorClasses']()).toContain('bg-destructive/10');
    expect(component['cardColorClasses']()).not.toContain('bg-secondary');
  });
});
