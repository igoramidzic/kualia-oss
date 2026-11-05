import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';
import { CommandGroup } from '../shared/models/command.model';
import { getShortId } from '../shared/utils/id-utils';
import { CommandRegistryService } from './command-registry.service';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

export type CommandMenuContext = 'default' | 'workspace-selector';

interface Workspace {
  _id: string;
  _creationTime: number;
  name: string;
  role: string;
}

export interface WorkspaceItem {
  _id: string;
  _creationTime: number;
  name: string;
  role: string;
  number?: number;
  isCurrent: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class CommandMenuService {
  private readonly commandRegistry = inject(CommandRegistryService);
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly router = inject(Router);
  private readonly dialogService = inject(HlmDialogService);

  private dialogRef: ReturnType<HlmDialogService['open']> | null = null;

  readonly _context = signal<CommandMenuContext>('default');
  readonly _previousContext = signal<CommandMenuContext | null>(null);

  readonly context = this._context.asReadonly();
  readonly previousContext = this._previousContext.asReadonly();

  readonly isOpen = computed(() => {
    return this.dialogRef !== null;
  });

  readonly canGoBack = computed(() => {
    return this._previousContext() !== null;
  });

  readonly commandGroups = computed<CommandGroup[]>(() => {
    return this.commandRegistry.getCommandsForMenu();
  });

  readonly workspaces = this.convexService.query(api.workspaces.getUserWorkspaces, {});

  readonly workspaceItems = computed<WorkspaceItem[]>(() => {
    const workspaces = (this.workspaces() ?? []) as Workspace[];
    const currentId = this.workspaceService.workspaceId();

    const sorted = [...workspaces].sort((a, b) => a._creationTime - b._creationTime);

    return sorted.map((ws, index) => ({
      _id: ws._id,
      _creationTime: ws._creationTime,
      name: ws.name,
      role: ws.role,
      number: index < 9 ? index + 1 : undefined,
      isCurrent: ws._id === currentId,
    }));
  });

  open() {
    if (this.dialogRef) {
      return; // Dialog already open
    }

    // Lazy load the component to avoid circular dependencies
    void import('../shared/components/command-menu/command-menu.component').then(({ CommandMenuComponent }) => {
      this.dialogRef = this.dialogService.open(CommandMenuComponent, {
        hasBackdrop: true,
        backdropClass: 'bg-background/80',
        closeOnBackdropClick: true,
        contentClass: 'mx-auto w-[min(600px,90vw)] border-0 p-0 sm:border',
      });

      // Reset state when dialog closes
      this.dialogRef.closed$.subscribe(() => {
        this.dialogRef = null;
        // Delay context reset to avoid visual glitch during dialog close animation
        setTimeout(() => {
          this._context.set('default');
          this._previousContext.set(null);
        }, 200);
      });
    });
  }

  close() {
    if (this.dialogRef) {
      this.dialogRef.close();
    }
  }

  toggle() {
    if (this.dialogRef) {
      this.close();
    } else {
      this.open();
    }
  }

  switchContext(newContext: CommandMenuContext) {
    this._previousContext.set(this._context());
    this._context.set(newContext);
  }

  goBack() {
    const prev = this._previousContext();
    if (prev) {
      this._context.set(prev);
      this._previousContext.set(null);
    }
  }

  openWithContext(context: CommandMenuContext) {
    this._context.set(context);
    this._previousContext.set(null);
    this.open();
  }

  /**
   * Routes that can be preserved when switching workspaces.
   * These are top-level routes that don't contain workspace-specific IDs.
   */
  private readonly preservableRoutes = [
    'transactions',
    'budget',
    'bank-accounts',
    'onboarding',
    'settings',
    'settings/preferences',
    'settings/workspace',
    'settings/bank-connections',
    'settings/merchants',
  ];

  async selectWorkspace(workspace: WorkspaceItem) {
    try {
      await this.convexService.mutation(api.workspaces.updateActiveWorkspace, {
        workspaceId: workspace._id as Id<'workspace'>,
      });

      const newShortId = getShortId(workspace._id);

      // Get the current URL path after the workspace ID
      const currentUrl = this.router.url.split('?')[0]; // Remove query params for matching
      const urlParts = currentUrl.split('/').filter(Boolean);
      const pathAfterWorkspace = urlParts.slice(1).join('/');

      // Only preserve the path if it's a known safe route (no workspace-specific IDs)
      const shouldPreservePath = this.preservableRoutes.includes(pathAfterWorkspace);
      const newPath = shouldPreservePath ? `${newShortId}/${pathAfterWorkspace}` : newShortId;

      await this.router.navigateByUrl(`/${newPath}`);

      this.close();
    } catch (error: unknown) {
      console.error('Error selecting workspace:', error);
    }
  }
}
