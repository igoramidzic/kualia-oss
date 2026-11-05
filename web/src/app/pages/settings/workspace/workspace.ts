import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { nucleoArchive as Archive, nucleoInfo as Info, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { CurrencySelectorComponent } from '../../../components/currency-selector/currency-selector.component';
import { ArchiveWorkspaceDialogComponent } from '../../../components/dialogs/archive-workspace-dialog/archive-workspace-dialog';
import { DeleteWorkspaceDialogComponent } from '../../../components/dialogs/delete-workspace-dialog/delete-workspace-dialog';
import { TimezoneSelectorComponent } from '../../../components/timezone-selector/timezone-selector.component';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { HlmAlertImports } from '../../../ui/alert/src';

@Component({
  selector: 'app-workspace',
  imports: [
    ReactiveFormsModule,
    HlmButton,
    HlmCard,
    HlmInput,
    HlmLabel,
    NucleoIcon,
    ...HlmAlertImports,
    SettingsPageHeaderComponent,
    CurrencySelectorComponent,
    TimezoneSelectorComponent,
  ],
  templateUrl: './workspace.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class WorkspaceComponent implements OnInit {
  protected readonly workspaceService = inject(WorkspaceService);
  protected readonly convexService = inject(ConvexService);
  protected readonly fb = inject(FormBuilder);
  private readonly dialogService = inject(HlmDialogService);
  private readonly router = inject(Router);

  protected readonly Archive = Archive;
  protected readonly Info = Info;

  protected readonly settingsLoading = signal(false);
  protected readonly timezoneLoading = signal(false);
  protected readonly currencyLoading = signal(false);
  private readonly initialValues = signal<{ name: string } | null>(null);

  protected readonly workspace = computed(() => this.workspaceService.workspace());
  protected readonly canManageWorkspace = computed(() => this.workspace()?.canManage === true);

  protected readonly workspaceForm = this.fb.group({
    name: ['', [Validators.required.bind(Validators)]],
  });

  protected readonly currentTimezone = computed(() => {
    return this.workspace()?.timezone ?? 'America/New_York';
  });

  protected readonly currentCurrency = computed(() => {
    return this.workspace()?.currency ?? 'USD';
  });

  protected readonly workspaceOwnerName = computed(() => {
    const owner = this.workspace()?.owner;
    return owner?.name ?? owner?.email ?? 'the workspace owner';
  });

  constructor() {
    effect(() => {
      const shouldDisable = this.settingsLoading() || !this.canManageWorkspace();
      const nameControl = this.workspaceForm.controls.name;

      if (shouldDisable && nameControl.enabled) {
        nameControl.disable({ emitEvent: false });
        return;
      }

      if (!shouldDisable && nameControl.disabled) {
        nameControl.enable({ emitEvent: false });
      }
    });
  }

  ngOnInit(): void {
    const workspace = this.workspace();
    if (workspace) {
      this.workspaceForm.patchValue({
        name: workspace.name,
      });
      this.initialValues.set({
        name: workspace.name,
      });
    }
  }

  protected onFieldBlur(): void {
    if (this.settingsLoading()) {
      return;
    }

    const initial = this.initialValues();
    if (!initial) return;

    const currentName = this.workspaceForm.get('name')?.value?.trim() ?? '';

    // Reset empty fields to original values
    if (!currentName) {
      this.workspaceForm.patchValue({ name: initial.name });
      this.workspaceForm.get('name')?.markAsUntouched();
      return;
    }

    // Don't save if form is invalid
    if (this.workspaceForm.invalid) {
      return;
    }

    // Check if values have actually changed
    if (currentName === initial.name) {
      return;
    }

    // Save the changes
    void this.saveWorkspaceSettings();
  }

  protected async saveWorkspaceSettings(): Promise<void> {
    if (!this.canManageWorkspace()) {
      return;
    }

    if (this.workspaceForm.invalid) {
      this.workspaceForm.markAllAsTouched();
      return;
    }

    const name = this.workspaceForm.get('name')?.value?.trim();
    const workspaceId = this.workspaceService.workspaceId();

    if (!name || !workspaceId) return;

    this.settingsLoading.set(true);

    try {
      await this.convexService.mutation(api.workspaces.updateWorkspaceName, {
        workspaceId: workspaceId as Id<'workspace'>,
        name,
      });

      toast.success('Workspace settings saved successfully');

      // Update initial values after successful save
      this.initialValues.set({ name });
    } catch (error: unknown) {
      console.error('Error updating workspace:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update workspace');
    } finally {
      this.settingsLoading.set(false);
    }
  }

  protected async selectTimezone(timezone: string): Promise<void> {
    if (!this.canManageWorkspace()) {
      return;
    }

    this.timezoneLoading.set(true);

    try {
      await this.workspaceService.updateTimezone(timezone);
      toast.success('Timezone updated successfully');
    } catch (error: unknown) {
      console.error('Error updating timezone:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update timezone');
    } finally {
      this.timezoneLoading.set(false);
    }
  }

  protected async selectCurrency(currency: string): Promise<void> {
    if (!this.canManageWorkspace()) {
      return;
    }

    this.currencyLoading.set(true);

    try {
      await this.workspaceService.updateCurrency(currency);
      toast.success('Currency updated successfully');
    } catch (error: unknown) {
      console.error('Error updating currency:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update currency');
    } finally {
      this.currencyLoading.set(false);
    }
  }

  get nameError() {
    const control = this.workspaceForm.get('name');
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Required';
    }
    return null;
  }

  protected openArchiveDialog(): void {
    const workspace = this.workspace();
    if (!workspace || !this.canManageWorkspace()) return;

    const dialogRef = this.dialogService.open(ArchiveWorkspaceDialogComponent, {
      context: {
        workspaceName: workspace.name,
        workspaceId: workspace._id,
        onClose: async (archived?: boolean) => {
          dialogRef.close();
          if (archived) {
            // Navigate to workspaces page after successful archiving
            await this.router.navigate(['/workspaces']);
          }
        },
      },
    });
  }

  protected openDeleteDialog(): void {
    const workspace = this.workspace();
    if (!workspace || !this.canManageWorkspace()) return;

    const dialogRef = this.dialogService.open(DeleteWorkspaceDialogComponent, {
      context: {
        workspaceName: workspace.name,
        workspaceId: workspace._id,
        onClose: async (deleted?: boolean) => {
          dialogRef.close();
          if (deleted) {
            // Navigate to workspaces page after successful deletion
            await this.router.navigate(['/workspaces']);
          }
        },
      },
    });
  }
}
