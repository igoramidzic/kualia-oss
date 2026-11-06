import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { openKualiaImport } from '../../../components/dialogs/kualia-import-dialog/kualia-import-dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import type { FunctionReturnType } from 'convex/server';
import {
  nucleoDownload as Download,
  nucleoFileArchive as FileArchive,
  nucleoTable as FileSpreadsheet,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

type WorkspaceExportResult = FunctionReturnType<typeof api.dataExports.generateWorkspaceExport>;

@Component({
  selector: 'app-data-export',
  imports: [HlmButton, HlmCard, NucleoIcon, SettingsPageHeaderComponent],
  templateUrl: './export.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class DataExportComponent {
  protected openKualiaImportDialog(): void {
    openKualiaImport(this.dialogService);
  }

  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);

  private readonly dialogService = inject(HlmDialogService);
  protected readonly Download = Download;
  protected readonly FileArchive = FileArchive;
  protected readonly FileSpreadsheet = FileSpreadsheet;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly isExporting = signal(false);
  protected readonly workspaceName = computed(() => this.workspaceService.workspace()?.name ?? 'this workspace');

  protected async exportData(): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId || this.isExporting()) {
      return;
    }

    this.isExporting.set(true);
    try {
      const result = await this.convexService.action<WorkspaceExportResult>(api.dataExports.generateWorkspaceExport, {
        workspaceId: workspaceId as Id<'workspace'>,
      });
      this.startDownload(result.downloadUrl);
      toast.success('Your data export is downloading');
    } catch (error: unknown) {
      toast.error(extractConvexErrorMessage(error, 'Failed to export your data. Please try again.'));
    } finally {
      this.isExporting.set(false);
    }
  }

  private startDownload(downloadUrl: string): void {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}
