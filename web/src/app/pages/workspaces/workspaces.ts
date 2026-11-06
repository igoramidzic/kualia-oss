import { openKualiaImport } from '../../components/dialogs/kualia-import-dialog/kualia-import-dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { api } from 'convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import {
  nucleoArchive as Archive,
  nucleoWorkspace as Building2,
  nucleoChevronRight as ChevronRight,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoUpload as Upload,
} from '@kualia/icons';
import { ArchivedWorkspacesDialogComponent } from '../../components/dialogs/archived-workspaces-dialog/archived-workspaces-dialog';
import { CreateWorkspaceDialogComponent } from '../../components/dialogs/create-workspace-dialog/create-workspace-dialog';
import { YnabImportDialogComponent } from '../../components/dialogs/ynab-import-dialog/ynab-import-dialog';
import { UserNavbarComponent } from '../../components/user-navbar/user-navbar';
import { ConvexService } from '../../services/convex.service';
import { ReportingService, TrackingEvent } from '../../services/reporting.service';
import { WorkspaceService } from '../../services/workspace.service';
import { getShortId } from '../../shared/utils/id-utils';

export type WorkspaceSections = FunctionReturnType<typeof api.workspaces.getWorkspaceSections>;
export type Workspace = WorkspaceSections['ownWorkspaces'][number];

type WorkspaceDisplaySection = {
  id: 'own' | 'shared';
  label: string;
  workspaces: Workspace[];
};

@Component({
  selector: 'app-workspaces',
  imports: [HlmButton, UserNavbarComponent, NucleoIcon, HlmSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspaces.html',
  styleUrl: './workspaces.css',
})
export class WorkspacesComponent {
  protected openKualiaImportDialog(): void {
    openKualiaImport(this.dialogService);
  }

  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private readonly router = inject(Router);
  private readonly dialogService = inject(HlmDialogService);

  private readonly emptyWorkspaceSections: WorkspaceSections = {
    ownWorkspaces: [],
    sharedWorkspaces: [],
  };

  // Real-time subscription to grouped workspaces
  private readonly workspaceSectionsQuery = this.convexService.query<WorkspaceSections>(
    api.workspaces.getWorkspaceSections,
    {}
  );

  readonly workspaceSections = computed(() => this.workspaceSectionsQuery() ?? this.emptyWorkspaceSections);
  readonly workspaces = computed(() => [
    ...this.workspaceSections().ownWorkspaces,
    ...this.workspaceSections().sharedWorkspaces,
  ]);
  readonly ownActiveWorkspaces = computed(() => this.workspaceSections().ownWorkspaces.filter((w) => !w.isArchived));
  readonly sharedActiveWorkspaces = computed(() =>
    this.workspaceSections().sharedWorkspaces.filter((w) => !w.isArchived)
  );
  readonly activeWorkspaceSections = computed(() => {
    const sections: WorkspaceDisplaySection[] = [];
    const ownWorkspaces = this.ownActiveWorkspaces();
    const sharedWorkspaces = this.sharedActiveWorkspaces();

    if (ownWorkspaces.length > 0) {
      sections.push({
        id: 'own',
        label: 'My workspaces',
        workspaces: ownWorkspaces,
      });
    }

    if (sharedWorkspaces.length > 0) {
      sections.push({
        id: 'shared',
        label: 'Shared with me',
        workspaces: sharedWorkspaces,
      });
    }

    return sections;
  });
  readonly archivedWorkspaces = computed(() => this.workspaces().filter((w) => w.isArchived));
  readonly archivedCount = computed(() => this.archivedWorkspaces().length);
  readonly errorMessage = signal<string | null>(null);
  readonly loadingWorkspaceId = signal<string | null>(null);
  readonly loading = computed(() => this.workspaceSectionsQuery() === undefined);

  protected readonly Archive = Archive;
  protected readonly Building2 = Building2;
  protected readonly ChevronRight = ChevronRight;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Upload = Upload;

  protected readonly hasWorkspaces = computed(() => this.activeWorkspaceSections().length > 0);

  protected isLoadingWorkspace(workspaceId: string): boolean {
    return this.loadingWorkspaceId() === workspaceId;
  }

  protected workspaceSubtitle(workspace: Workspace): string {
    if (workspace.accessKind !== 'family') {
      return 'Owner';
    }

    const ownerName = workspace.owner?.name ?? workspace.owner?.email ?? null;
    return ownerName ? `Shared by ${ownerName}` : 'Shared with you';
  }

  async selectWorkspace(workspace: Workspace): Promise<void> {
    if (this.loadingWorkspaceId() !== null) {
      return; // Prevent multiple simultaneous selections
    }

    this.loadingWorkspaceId.set(workspace._id);
    this.errorMessage.set(null);

    try {
      // Update active workspace ID
      await this.convexService.mutation(api.workspaces.updateActiveWorkspace, {
        workspaceId: workspace._id,
      });
      this.reportingService.capture(TrackingEvent.WORKSPACE_SWITCHED);

      // Navigate to workspace using short ID
      const shortId = getShortId(workspace._id);
      await this.router.navigate([shortId]);
    } catch (error: unknown) {
      void error;
      this.errorMessage.set('Failed to select workspace. Please try again.');
    } finally {
      this.loadingWorkspaceId.set(null);
    }
  }

  openCreateWorkspaceDialog(): void {
    const dialogRef = this.dialogService.open(CreateWorkspaceDialogComponent, {
      context: {
        currentCurrency: this.workspaceService.workspace()?.currency ?? 'USD',
        onClose: async (workspaceId?: string) => {
          dialogRef.close();
          if (workspaceId) {
            const shortId = getShortId(workspaceId);
            await this.router.navigate([shortId, 'transactions']);
          }
        },
      },
    });
  }

  openYnabImportDialog(): void {
    const dialogRef = this.dialogService.open(YnabImportDialogComponent, {
      context: {
        onClose: () => {
          dialogRef.close();
          // Navigation is handled by the dialog itself
        },
      },
      contentClass: 'w-full sm:w-lg',
      closeOnBackdropClick: false,
    });
  }

  openArchivedWorkspacesDialog(): void {
    const dialogRef = this.dialogService.open(ArchivedWorkspacesDialogComponent, {
      context: {
        archivedWorkspaces: this.archivedWorkspaces,
        onClose: () => dialogRef.close(),
      },
    });
  }
}
