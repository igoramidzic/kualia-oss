import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { CategoryGroup } from '../../../services/category.service';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

interface DialogContext {
  categoryGroup: CategoryGroup;
  categoryCount: number;
  availableGroups: CategoryGroup[];
  onClose: (deleted?: boolean) => void;
}

@Component({
  selector: 'app-delete-category-group-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter, FormsModule, HlmSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Delete Category Group</h2>
    </hlm-dialog-header>

    <div class="p-3">
      <p class="text-muted-foreground text-sm">
        Are you sure you want to delete
        <span class="text-foreground font-medium">{{ groupToDelete().name }}</span
        >?
      </p>

      @if (categoryCount() > 0) {
        <div class="border-primary/20 bg-primary/10 mt-4 rounded-lg border p-3">
          <p class="text-sm font-medium">
            This group contains {{ categoryCount() }} {{ categoryCount() === 1 ? 'category' : 'categories' }}.
          </p>
          <p class="text-muted-foreground mt-2 text-sm">
            You need to move {{ categoryCount() === 1 ? 'this category' : 'these categories' }} to another group before
            deleting.
          </p>
        </div>

        @if (availableGroups().length > 0) {
          <div class="mt-4">
            <div class="text-foreground mb-2 block text-sm font-medium">
              Move {{ categoryCount() }} {{ categoryCount() === 1 ? 'category' : 'categories' }} to:
            </div>
            <hlm-select [value]="selectedGroupId()" (valueChange)="onGroupSelected($event)" [disabled]="deleting()">
              <hlm-select-trigger class="w-full">
                <hlm-select-value placeholder="Select a group" />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (group of availableGroups(); track group._id) {
                  <hlm-select-item [value]="group._id">{{ group.name }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          </div>
        } @else {
          <div class="bg-destructive/10 text-destructive border-destructive/20 mt-4 rounded-lg border p-3">
            <p class="text-sm">
              Cannot delete this group - there are no other groups available to move the categories to.
            </p>
          </div>
        }
      }

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 mt-4 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="cancel()">Cancel</button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDelete()" [disabled]="deleting() || !canDelete()">
        @if (deleting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Deleting...
        } @else {
          Delete
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DeleteCategoryGroupDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  protected readonly groupToDelete = signal<CategoryGroup>(this.dialogContext.categoryGroup);
  protected readonly categoryCount = signal<number>(this.dialogContext.categoryCount);
  protected readonly availableGroups = signal<CategoryGroup[]>(this.dialogContext.availableGroups);

  protected readonly selectedGroupId = signal<Id<'categoryGroup'> | null>(null);

  protected readonly canDelete = computed(() => {
    const count = this.categoryCount();
    // Can delete if no categories, or if there are categories and a new group is selected
    return count === 0 || (count > 0 && this.selectedGroupId() !== null);
  });

  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);

  // Track deletion promise for toast handling
  private deletionPromise: Promise<void> | null = null;
  private dialogClosed = false;

  constructor() {
    // When component is destroyed (dialog closes), check if deletion is in progress
    this.destroyRef.onDestroy(() => {
      if (this.deleting() && this.deletionPromise && !this.dialogClosed) {
        this.dialogClosed = true;

        toast.promise(this.deletionPromise, {
          loading: 'Deleting group...',
          success: 'Group deleted successfully',
          error: 'Failed to delete group',
        });
      }
    });
  }

  onGroupSelected(groupId: Id<'categoryGroup'> | null | undefined): void {
    if (!groupId) return;

    this.selectedGroupId.set(groupId);
  }

  cancel(): void {
    // If deletion is in progress, show promise toast
    if (this.deleting() && this.deletionPromise) {
      this.dialogClosed = true;

      toast.promise(this.deletionPromise, {
        loading: 'Deleting group...',
        success: 'Group deleted successfully',
        error: 'Failed to delete group',
      });
    }
    this.dialogContext.onClose(false);
  }

  async confirmDelete(): Promise<void> {
    if (this.deleting() || !this.canDelete()) {
      return;
    }

    this.deleting.set(true);
    this.error.set(null);

    // Create and store the deletion promise
    this.deletionPromise = (async () => {
      try {
        const workspaceId = this.workspaceService.workspaceId();
        if (!workspaceId) {
          throw new Error('No workspace selected');
        }

        const hasCategories = this.categoryCount() > 0;
        const newCategoryGroupId = hasCategories ? this.selectedGroupId() : undefined;

        await this.convexService.mutation(api.categoryGroups.deleteCategoryGroupWithMove, {
          workspaceId: workspaceId as Id<'workspace'>,
          categoryGroupId: this.groupToDelete()._id,
          newCategoryGroupId: newCategoryGroupId ?? undefined,
        });

        // If dialog is still open, show success toast
        if (!this.dialogClosed) {
          toast.success('Group deleted successfully');
          this.dialogClosed = true;
        }

        this.dialogContext.onClose(true);
      } catch (err: unknown) {
        this.error.set(extractConvexErrorMessage(err, 'Failed to delete group'));
        this.deleting.set(false);
        throw err;
      }
    })();

    await this.deletionPromise;
  }
}
