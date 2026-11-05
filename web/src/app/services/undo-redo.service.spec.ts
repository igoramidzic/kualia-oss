import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoableAction, UndoRedoService } from './undo-redo.service';
import { WorkspaceService } from './workspace.service';

describe('UndoRedoService', () => {
  let service: UndoRedoService;
  let routerEvents: Subject<NavigationEnd>;
  let mockRouter: { url: string; events: Subject<NavigationEnd> };
  const workspaceId = signal<string | null>('workspace-1');

  function createAction(overrides: Partial<UndoableAction> = {}): UndoableAction {
    return {
      description: 'Test action',
      type: 'test',
      timestamp: Date.now(),
      undo: vi.fn().mockResolvedValue(undefined),
      redo: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  beforeEach(() => {
    workspaceId.set('workspace-1');
    routerEvents = new Subject<NavigationEnd>();
    mockRouter = { url: '/ws/transactions', events: routerEvents };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        UndoRedoService,
        {
          provide: WorkspaceService,
          useValue: { workspaceId: workspaceId.asReadonly() },
        },
        {
          provide: Router,
          useValue: mockRouter,
        },
      ],
    });

    service = TestBed.inject(UndoRedoService);
  });

  describe('initial state', () => {
    it('should start with empty stacks', () => {
      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(false);
    });
  });

  describe('pushAction', () => {
    it('should enable canUndo after pushing an action', () => {
      service.pushAction(createAction());
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);
    });

    it('should clear redo stack when pushing a new action', async () => {
      const action = createAction();
      service.pushAction(action);
      await service.undo();
      expect(service.canRedo()).toBe(true);

      service.pushAction(createAction());
      expect(service.canRedo()).toBe(false);
    });

    it('should enforce max stack size of 50', async () => {
      for (let i = 0; i < 60; i++) {
        service.pushAction(createAction({ description: `Action ${i}` }));
      }
      expect(service.canUndo()).toBe(true);

      let undoCount = 0;
      while (service.canUndo()) {
        await service.undo();
        undoCount++;
      }
      expect(undoCount).toBe(50);
    });
  });

  describe('undo', () => {
    it('should call the undo function on the last action', async () => {
      const action = createAction();
      service.pushAction(action);
      await service.undo();
      expect(action.undo).toHaveBeenCalledOnce();
    });

    it('should move action to redo stack after undo', async () => {
      service.pushAction(createAction());
      expect(service.canRedo()).toBe(false);
      await service.undo();
      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(true);
    });

    it('should undo actions in LIFO order', async () => {
      const order: number[] = [];
      service.pushAction(
        createAction({
          undo: vi.fn(() => {
            order.push(1);
          }),
        })
      );
      service.pushAction(
        createAction({
          undo: vi.fn(() => {
            order.push(2);
          }),
        })
      );
      service.pushAction(
        createAction({
          undo: vi.fn(() => {
            order.push(3);
          }),
        })
      );

      await service.undo();
      await service.undo();
      await service.undo();

      expect(order).toEqual([3, 2, 1]);
    });

    it('should do nothing when undo stack is empty', async () => {
      await service.undo();
      expect(service.canUndo()).toBe(false);
    });

    it('should push action back to undo stack on failure', async () => {
      const failingAction = createAction({
        undo: vi.fn().mockRejectedValue(new Error('Undo failed')),
      });
      service.pushAction(failingAction);
      await service.undo();

      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);
    });
  });

  describe('redo', () => {
    it('should call the redo function on the last undone action', async () => {
      const action = createAction();
      service.pushAction(action);
      await service.undo();
      await service.redo();
      expect(action.redo).toHaveBeenCalledOnce();
    });

    it('should move action back to undo stack after redo', async () => {
      service.pushAction(createAction());
      await service.undo();
      expect(service.canRedo()).toBe(true);
      await service.redo();
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);
    });

    it('should do nothing when redo stack is empty', async () => {
      await service.redo();
      expect(service.canRedo()).toBe(false);
    });

    it('should push action back to redo stack on failure', async () => {
      const failingRedoAction = createAction({
        redo: vi.fn().mockRejectedValue(new Error('Redo failed')),
      });
      service.pushAction(failingRedoAction);
      await service.undo();
      await service.redo();

      expect(service.canRedo()).toBe(true);
      expect(service.canUndo()).toBe(false);
    });
  });

  describe('undo/redo cycle', () => {
    it('should support full undo/redo cycle', async () => {
      const action = createAction();
      service.pushAction(action);

      await service.undo();
      expect(action.undo).toHaveBeenCalledOnce();
      expect(service.canRedo()).toBe(true);

      await service.redo();
      expect(action.redo).toHaveBeenCalledOnce();
      expect(service.canUndo()).toBe(true);
    });
  });

  describe('clear', () => {
    it('should empty both stacks', async () => {
      service.pushAction(createAction());
      service.pushAction(createAction());
      await service.undo();

      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(true);

      service.clear();

      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(false);
    });
  });

  describe('scope filtering', () => {
    function navigateTo(url: string): void {
      mockRouter.url = url;
      routerEvents.next(new NavigationEnd(0, url, url));
      TestBed.flushEffects();
    }

    it('should only undo actions pushed from matching scope', async () => {
      // Push action from transactions page
      navigateTo('/ws/transactions');
      const txAction = createAction({ description: 'Tx action' });
      service.pushAction(txAction);

      // Push action from budget page
      navigateTo('/ws/budget');
      const budgetAction = createAction({ description: 'Budget action' });
      service.pushAction(budgetAction);

      // On transactions page — should undo txAction (skipping budgetAction)
      navigateTo('/ws/transactions');
      await service.undo();
      expect(txAction.undo).toHaveBeenCalledOnce();
      expect(budgetAction.undo).not.toHaveBeenCalled();
    });

    it('should not undo when no actions match current scope', async () => {
      // Push action from budget page
      navigateTo('/ws/budget');
      service.pushAction(createAction());

      // On transactions page — no matching actions
      navigateTo('/ws/transactions');
      await service.undo(); // Should do nothing
    });

    it('should only redo actions matching the scope where they were created', async () => {
      // Push and undo on budget page
      navigateTo('/ws/budget');
      const budgetAction = createAction();
      service.pushAction(budgetAction);
      await service.undo();

      // On transactions page — can't redo budget action
      navigateTo('/ws/transactions');
      await service.redo(); // Should do nothing
      expect(budgetAction.redo).not.toHaveBeenCalled();

      // Back on budget page — can redo
      navigateTo('/ws/budget');
      await service.redo();
      expect(budgetAction.redo).toHaveBeenCalledOnce();
    });

    it('should scope transaction created from budget page to budget', async () => {
      // Create transaction from budget page
      navigateTo('/ws/budget');
      const txFromBudget = createAction({ type: 'transaction-create' });
      service.pushAction(txFromBudget);

      // Should be undoable on budget page
      await service.undo();
      expect(txFromBudget.undo).toHaveBeenCalledOnce();
    });
  });

  describe('concurrent execution guard', () => {
    it('should prevent concurrent undo calls', async () => {
      let resolveUndo: () => void;
      const slowUndo = new Promise<void>((resolve) => {
        resolveUndo = resolve;
      });

      const action = createAction({
        undo: vi.fn(() => slowUndo),
      });
      service.pushAction(action);

      const firstUndo = service.undo();

      service.pushAction(createAction());
      expect(service.canUndo()).toBe(false); // isExecuting blocks

      resolveUndo!();
      await firstUndo;
    });
  });
});
