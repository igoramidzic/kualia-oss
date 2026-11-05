import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { toast } from 'ngx-sonner';
import { filter, map, startWith } from 'rxjs';
import { WorkspaceService } from './workspace.service';

const MAX_STACK_SIZE = 50;

type UndoRedoScope = 'budget' | 'transactions' | 'bank-account';

export interface UndoableAction {
  description: string;
  type: string;
  timestamp: number;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface ScopedAction extends UndoableAction {
  scope: UndoRedoScope;
}

@Injectable({
  providedIn: 'root',
})
export class UndoRedoService {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly router = inject(Router);

  private readonly _undoStack = signal<ScopedAction[]>([]);
  private readonly _redoStack = signal<ScopedAction[]>([]);
  private readonly _isExecuting = signal(false);
  private readonly _lastCompletedVersion = signal(0);

  private readonly _currentScope = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.deriveScope()),
      startWith(this.deriveScope())
    ),
    { initialValue: this.deriveScope() }
  );

  readonly canUndo = computed(() => {
    const scope = this._currentScope();
    return this._undoStack().some((a) => a.scope === scope) && !this._isExecuting();
  });
  readonly canRedo = computed(() => {
    const scope = this._currentScope();
    return this._redoStack().some((a) => a.scope === scope) && !this._isExecuting();
  });

  /** Increments after each successful undo/redo. Components can watch this to refresh their state. */
  readonly completedVersion = this._lastCompletedVersion.asReadonly();

  constructor() {
    // Clear stacks on workspace change
    let previousWorkspaceId: string | null | undefined;
    effect(() => {
      const currentWorkspaceId = this.workspaceService.workspaceId();
      if (previousWorkspaceId !== undefined && currentWorkspaceId !== previousWorkspaceId) {
        this.clear();
      }
      previousWorkspaceId = currentWorkspaceId;
    });
  }

  pushAction(action: UndoableAction): void {
    const scopedAction: ScopedAction = { ...action, scope: this._currentScope() };
    this._undoStack.update((stack) => {
      const newStack = [...stack, scopedAction];
      if (newStack.length > MAX_STACK_SIZE) {
        return newStack.slice(newStack.length - MAX_STACK_SIZE);
      }
      return newStack;
    });
    this._redoStack.set([]);
  }

  async undo(): Promise<void> {
    if (this._isExecuting()) return;

    // Find and remove atomically inside the update callback to avoid race conditions
    let action: ScopedAction | undefined;
    let removedIndex = -1;
    this._undoStack.update((s) => {
      const index = this.findScopedIndexFromStack(s);
      if (index === -1) return s;
      action = s[index];
      removedIndex = index;
      return s.filter((_, i) => i !== index);
    });
    if (!action) return;

    this._isExecuting.set(true);

    try {
      await action.undo();
      this._redoStack.update((s) => [...s, action!]);
      this._lastCompletedVersion.update((v) => v + 1);
      toast.success(`Undone: ${action.description}`);
    } catch (error: unknown) {
      console.error('Undo failed:', error);
      // Push action back to undo stack on failure (at original position)
      this._undoStack.update((s) => {
        const newStack = [...s];
        newStack.splice(removedIndex, 0, action!);
        return newStack;
      });
      const errorMessage = error instanceof Error ? error.message : 'Undo failed';
      toast.error(errorMessage);
    } finally {
      this._isExecuting.set(false);
    }
  }

  async redo(): Promise<void> {
    if (this._isExecuting()) return;

    // Find and remove atomically inside the update callback to avoid race conditions
    let action: ScopedAction | undefined;
    let removedIndex = -1;
    this._redoStack.update((s) => {
      const index = this.findScopedIndexFromStack(s);
      if (index === -1) return s;
      action = s[index];
      removedIndex = index;
      return s.filter((_, i) => i !== index);
    });
    if (!action) return;

    this._isExecuting.set(true);

    try {
      await action.redo();
      this._undoStack.update((s) => [...s, action!]);
      this._lastCompletedVersion.update((v) => v + 1);
      toast.success(`Redone: ${action.description}`);
    } catch (error: unknown) {
      console.error('Redo failed:', error);
      // Push action back to redo stack on failure
      this._redoStack.update((s) => {
        const newStack = [...s];
        newStack.splice(removedIndex, 0, action!);
        return newStack;
      });
      const errorMessage = error instanceof Error ? error.message : 'Redo failed';
      toast.error(errorMessage);
    } finally {
      this._isExecuting.set(false);
    }
  }

  clear(): void {
    this._undoStack.set([]);
    this._redoStack.set([]);
  }

  private deriveScope(): UndoRedoScope {
    if (this.router.url.includes('/budget')) return 'budget';
    if (this.router.url.includes('/bank-account')) return 'bank-account';
    return 'transactions';
  }

  private findScopedIndexFromStack(stack: ScopedAction[]): number {
    const scope = this._currentScope();
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]?.scope === scope) {
        return i;
      }
    }
    return -1;
  }
}
