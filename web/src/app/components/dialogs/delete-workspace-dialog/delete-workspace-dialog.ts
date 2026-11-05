import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { ConvexService } from '../../../services/convex.service';
import { extractMappedConvexErrorMessage } from '../../../shared/utils/convex-error-message';

interface DialogContext {
  workspaceName: string;
  workspaceId: Id<'workspace'>;
  onClose: (deleted?: boolean) => void;
}

function toWorkspaceDeleteErrorMessage(error: unknown): string {
  return extractMappedConvexErrorMessage(error, 'Failed to delete workspace', toFriendlyWorkspaceDeleteError);
}

function toFriendlyWorkspaceDeleteError(message: string): string {
  if (message.includes('permission to manage this workspace')) {
    return 'You do not have permission to delete this workspace.';
  }

  if (message.includes('access to this workspace')) {
    return 'You do not have access to this workspace.';
  }

  return message;
}

@Component({
  selector: 'app-delete-workspace-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Delete Workspace</h2>
    </hlm-dialog-header>

    <div class="p-3">
      <p class="text-muted-foreground text-sm">
        Are you sure you want to delete
        <span class="text-foreground font-medium">{{ workspaceName() }}</span
        >?
      </p>

      <div class="border-destructive/20 bg-destructive/10 mt-4 rounded-lg border p-3">
        <p class="text-sm font-medium">This action cannot be undone.</p>
        <p class="text-muted-foreground mt-2 text-sm">
          All data associated with this workspace including accounts, transactions, categories, and budgets will no
          longer be accessible.
        </p>
      </div>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 mt-4 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="cancel()">Cancel</button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDelete()" [disabled]="deleting()">
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
export class DeleteWorkspaceDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly convexService = inject(ConvexService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  protected readonly workspaceName = signal<string>(this.dialogContext.workspaceName);
  protected readonly workspaceId = signal<Id<'workspace'>>(this.dialogContext.workspaceId);

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
          loading: 'Deleting workspace...',
          success: 'Workspace deleted successfully',
          error: 'Failed to delete workspace',
        });
      }
    });
  }

  cancel(): void {
    // If deletion is in progress, show promise toast
    if (this.deleting() && this.deletionPromise) {
      this.dialogClosed = true;

      toast.promise(this.deletionPromise, {
        loading: 'Deleting workspace...',
        success: 'Workspace deleted successfully',
        error: 'Failed to delete workspace',
      });
    }
    this.dialogContext.onClose(false);
  }

  async confirmDelete(): Promise<void> {
    if (this.deleting()) {
      return;
    }

    this.deleting.set(true);
    this.error.set(null);

    // Create and store the deletion promise
    this.deletionPromise = (async () => {
      try {
        await this.convexService.mutation(api.workspaces.deleteWorkspace, {
          workspaceId: this.workspaceId(),
        });

        // If dialog is still open, show success toast
        if (!this.dialogClosed) {
          toast.success('Workspace deleted successfully');
          this.dialogClosed = true;
        }

        this.dialogContext.onClose(true);
      } catch (err) {
        this.error.set(toWorkspaceDeleteErrorMessage(err));
        this.deleting.set(false);
        throw err;
      }
    })();

    await this.deletionPromise;
  }
}
