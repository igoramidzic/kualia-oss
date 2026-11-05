import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoArchive as Archive,
  nucleoTransfer as ArrowRightLeft,
  nucleoBell as Bell,
  nucleoCreditCard as CreditCard,
  nucleoHardDrive as HardDrive,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { ConvexService } from '../../../services/convex.service';
import { extractMappedConvexErrorMessage } from '../../../shared/utils/convex-error-message';

interface DialogContext {
  workspaceName: string;
  workspaceId: Id<'workspace'>;
  onClose: (archived?: boolean) => void;
}

function toWorkspaceArchiveErrorMessage(error: unknown): string {
  return extractMappedConvexErrorMessage(error, 'Failed to archive workspace', toFriendlyWorkspaceArchiveError);
}

function toFriendlyWorkspaceArchiveError(message: string): string {
  if (message.includes('permission to manage this workspace')) {
    return 'You do not have permission to archive this workspace.';
  }

  if (message.includes('access to this workspace')) {
    return 'You do not have access to this workspace.';
  }

  return message;
}

@Component({
  selector: 'app-archive-workspace-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Archive Workspace</h2>
    </hlm-dialog-header>

    <div class="p-3">
      <p class="text-muted-foreground text-sm">
        Are you sure you want to archive
        <span class="text-foreground font-medium">{{ workspaceName() }}</span
        >?
      </p>

      <div class="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
        <p class="text-sm font-medium">Archiving will pause all workspace activity.</p>
        <p class="text-muted-foreground mt-2 text-sm">Your data will be preserved and you can restore it anytime.</p>
      </div>

      <div class="text-muted-foreground mt-4 space-y-2 text-sm">
        <div class="flex items-center gap-2">
          <nucleo-icon [icon]="ArrowRightLeft" class="h-4 w-4" />
          <span>Bank syncing will be paused</span>
        </div>
        <div class="flex items-center gap-2">
          <nucleo-icon [icon]="CreditCard" class="h-4 w-4" />
          <span>No new transactions will be imported</span>
        </div>
        <div class="flex items-center gap-2">
          <nucleo-icon [icon]="Bell" class="h-4 w-4" />
          <span>Budget notifications will stop</span>
        </div>
        <div class="flex items-center gap-2">
          <nucleo-icon [icon]="HardDrive" class="h-4 w-4" />
          <span>All data will be preserved</span>
        </div>
      </div>

      @if (error()) {
        <div class="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
          <p class="text-sm text-amber-700 dark:text-amber-400">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="cancel()">Cancel</button>
      <button
        hlmBtn
        size="sm"
        class="bg-amber-500 text-white hover:bg-amber-600"
        (click)="confirmArchive()"
        [disabled]="archiving()"
      >
        @if (archiving()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Archiving...
        } @else {
          <nucleo-icon [icon]="Archive" class="mr-1 h-4 w-4" />
          Archive
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class ArchiveWorkspaceDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Archive = Archive;
  protected readonly ArrowRightLeft = ArrowRightLeft;
  protected readonly CreditCard = CreditCard;
  protected readonly Bell = Bell;
  protected readonly HardDrive = HardDrive;

  private readonly convexService = inject(ConvexService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  protected readonly workspaceName = signal<string>(this.dialogContext.workspaceName);
  protected readonly workspaceId = signal<Id<'workspace'>>(this.dialogContext.workspaceId);

  protected readonly archiving = signal(false);
  protected readonly error = signal<string | null>(null);

  // Track archiving promise for toast handling
  private archivingPromise: Promise<void> | null = null;
  private dialogClosed = false;

  constructor() {
    // When component is destroyed (dialog closes), check if archiving is in progress
    this.destroyRef.onDestroy(() => {
      if (this.archiving() && this.archivingPromise && !this.dialogClosed) {
        this.dialogClosed = true;

        toast.promise(this.archivingPromise, {
          loading: 'Archiving workspace...',
          success: 'Workspace archived successfully',
          error: 'Failed to archive workspace',
        });
      }
    });
  }

  cancel(): void {
    // If archiving is in progress, show promise toast
    if (this.archiving() && this.archivingPromise) {
      this.dialogClosed = true;

      toast.promise(this.archivingPromise, {
        loading: 'Archiving workspace...',
        success: 'Workspace archived successfully',
        error: 'Failed to archive workspace',
      });
    }
    this.dialogContext.onClose(false);
  }

  async confirmArchive(): Promise<void> {
    if (this.archiving()) {
      return;
    }

    this.archiving.set(true);
    this.error.set(null);

    // Create and store the archiving promise
    this.archivingPromise = (async () => {
      try {
        await this.convexService.mutation(api.workspaces.archiveWorkspaces, {
          workspaceIds: [this.workspaceId()],
          isArchived: true,
        });

        // If dialog is still open, show success toast
        if (!this.dialogClosed) {
          toast.success('Workspace archived successfully');
          this.dialogClosed = true;
        }

        this.dialogContext.onClose(true);
      } catch (err) {
        this.error.set(toWorkspaceArchiveErrorMessage(err));
        this.archiving.set(false);
        throw err;
      }
    })();

    await this.archivingPromise;
  }
}
