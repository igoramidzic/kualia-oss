import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { nucleoWorkspace as Building2, nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { ConvexService } from '../../../services/convex.service';

interface DialogContext {
  archivedWorkspaces: () => Workspace[];
  onClose: () => void;
}

type Workspace = {
  _id: string;
  _creationTime: number;
  name: string;
  role: string;
  isArchived: boolean;
};

@Component({
  selector: 'app-archived-workspaces-dialog',
  imports: [HlmButton, HlmCheckbox, HlmDialogHeader, HlmDialogFooter, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Archived Workspaces</h2>
    </hlm-dialog-header>

    <div class="p-3">
      @if (archivedWorkspaces().length === 0) {
        <p class="text-muted-foreground py-4 text-center text-sm">No archived workspaces</p>
      } @else {
        <div class="space-y-2">
          @for (workspace of archivedWorkspaces(); track workspace._id) {
            <div
              class="border-border hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
              [class.border-primary]="selectedIds().has(workspace._id)"
              [class.bg-primary/5]="selectedIds().has(workspace._id)"
              role="button"
              tabindex="0"
              (click)="toggleSelection(workspace._id)"
              (keydown.enter)="toggleSelection(workspace._id)"
              (keydown.space)="toggleSelection(workspace._id); $event.preventDefault()"
            >
              <hlm-checkbox
                [checked]="selectedIds().has(workspace._id)"
                (checkedChange)="toggleSelection(workspace._id)"
              />
              <nucleo-icon [icon]="Building2" class="text-muted-foreground h-5 w-5" />
              <span class="flex-1 font-medium">{{ workspace.name }}</span>
            </div>
          }
        </div>
      }

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 mt-4 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer class="flex-row justify-end gap-2">
      <button hlmBtn size="sm" variant="outline" (click)="dialogContext.onClose()">Cancel</button>
      <button hlmBtn size="sm" [disabled]="selectedIds().size === 0 || unarchiving()" (click)="unarchiveSelected()">
        @if (unarchiving()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
        }
        Unarchive{{ selectedIds().size > 0 ? ' (' + selectedIds().size + ')' : '' }}
      </button>
    </hlm-dialog-footer>
  `,
})
export class ArchivedWorkspacesDialogComponent {
  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();
  private readonly convexService = inject(ConvexService);

  readonly archivedWorkspaces = computed(() => this.dialogContext.archivedWorkspaces());
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly unarchiving = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly Building2 = Building2;
  protected readonly LoaderCircle = LoaderCircle;

  toggleSelection(workspaceId: string): void {
    this.selectedIds.update((ids) => {
      const newIds = new Set(ids);
      if (newIds.has(workspaceId)) {
        newIds.delete(workspaceId);
      } else {
        newIds.add(workspaceId);
      }
      return newIds;
    });
  }

  async unarchiveSelected(): Promise<void> {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;

    this.unarchiving.set(true);
    this.error.set(null);

    try {
      await this.convexService.mutation(api.workspaces.archiveWorkspaces, {
        workspaceIds: ids as Id<'workspace'>[],
        isArchived: false,
      });
      this.dialogContext.onClose();
    } catch {
      this.error.set('Failed to unarchive workspaces. Please try again.');
    } finally {
      this.unarchiving.set(false);
    }
  }
}
