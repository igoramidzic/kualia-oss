import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoArrowLeft as ArrowLeft, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { UserNavbarComponent } from '../../components/user-navbar/user-navbar';
import { YnabImportService } from '../../services/ynab-import.service';
import { HlmProgress, HlmProgressIndicator } from '../../ui/progress/src';
import { AccountMappingStepComponent } from './steps/account-mapping-step.component';
import { CompleteStepComponent } from './steps/complete-step.component';
import { ImportingStepComponent } from './steps/importing-step.component';
import { UploadStepComponent } from './steps/upload-step.component';
import { STEP_CONFIGS, TOTAL_STEPS, YnabImportStep } from './types';

@Component({
  selector: 'app-ynab-import',
  imports: [
    HlmButton,
    HlmProgress,
    HlmProgressIndicator,
    NucleoIcon,
    UserNavbarComponent,
    UploadStepComponent,
    AccountMappingStepComponent,
    ImportingStepComponent,
    CompleteStepComponent,
  ],
  templateUrl: './ynab-import.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YnabImportComponent {
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly YnabImportStep = YnabImportStep;

  private readonly router = inject(Router);
  private readonly ynabImportService = inject(YnabImportService);

  // Current step
  readonly currentStep = signal<YnabImportStep>(YnabImportStep.Upload);

  // Service signals
  readonly planCsvContent = this.ynabImportService.planCsvContent;
  readonly registerCsvContent = this.ynabImportService.registerCsvContent;
  readonly accountMappings = this.ynabImportService.accountMappings;
  readonly preview = this.ynabImportService.preview;
  readonly workspaceName = this.ynabImportService.workspaceName;
  readonly currency = this.ynabImportService.currency;
  readonly parsing = this.ynabImportService.parsing;
  readonly importing = this.ynabImportService.importing;
  readonly error = this.ynabImportService.error;
  readonly importStatus = this.ynabImportService.importStatus;

  // Loading state for any async operation
  readonly loading = computed(() => this.parsing() || this.importing());

  // Computed values
  readonly stepConfig = computed(() => STEP_CONFIGS[this.currentStep()]);

  readonly progress = computed(() => ((this.currentStep() + 1) / TOTAL_STEPS) * 100);

  readonly canGoBack = computed(() => {
    const step = this.currentStep();
    // Can go back from Account Mapping only
    return step === YnabImportStep.AccountMapping;
  });

  readonly canContinue = computed(() => {
    if (this.loading()) {
      return false;
    }

    switch (this.currentStep()) {
      case YnabImportStep.Upload:
        return !!this.planCsvContent() && !!this.registerCsvContent();
      case YnabImportStep.AccountMapping:
        return this.accountMappings().length > 0;
      case YnabImportStep.Importing:
        return false; // No manual continue during import
      case YnabImportStep.Complete:
        return true;
      default:
        return false;
    }
  });

  readonly continueButtonText = computed(() => {
    const step = this.currentStep();

    if (step === YnabImportStep.Upload) {
      return this.parsing() ? 'Parsing...' : 'Continue';
    }
    if (step === YnabImportStep.AccountMapping) {
      return this.importing() ? 'Starting Import...' : 'Start Import';
    }
    if (step === YnabImportStep.Complete) {
      return 'Go to Workspace';
    }
    return 'Continue';
  });

  goBack(): void {
    if (this.canGoBack()) {
      this.currentStep.update((step) => step - 1);
    }
  }

  async continue(): Promise<void> {
    if (!this.canContinue() || this.loading()) {
      return;
    }

    const step = this.currentStep();

    if (step === YnabImportStep.Upload) {
      await this.parseFiles();
    } else if (step === YnabImportStep.AccountMapping) {
      await this.startImport();
    } else if (step === YnabImportStep.Complete) {
      await this.goToWorkspace();
    }
  }

  private async parseFiles(): Promise<void> {
    const success = await this.ynabImportService.parseFiles();
    if (success) {
      this.currentStep.set(YnabImportStep.AccountMapping);
    } else {
      toast.error(this.error() ?? 'Failed to parse files');
    }
  }

  private async startImport(): Promise<void> {
    const success = await this.ynabImportService.startImport();
    if (success) {
      this.currentStep.set(YnabImportStep.Importing);
    } else {
      toast.error(this.error() ?? 'Failed to start import');
    }
  }

  private async goToWorkspace(): Promise<void> {
    const status = this.importStatus();
    if (status?.workspaceId) {
      // Reset the service state
      this.ynabImportService.reset();
      // Navigate to the workspace
      // The workspaceId is actually a Convex Id, need to get the shortId
      // For now, navigate to workspaces list
      await this.router.navigate(['/workspaces']);
    } else {
      toast.error('Workspace not found');
    }
  }

  // Handlers for step events
  onPlanFileSelected(content: string): void {
    this.ynabImportService.setPlanCsv(content);
  }

  onRegisterFileSelected(content: string): void {
    this.ynabImportService.setRegisterCsv(content);
  }

  onAccountTypeChanged(event: { accountName: string; accountType: string }): void {
    this.ynabImportService.updateAccountType(event.accountName, event.accountType);
  }

  onWorkspaceNameChanged(name: string): void {
    this.ynabImportService.setWorkspaceName(name);
  }

  onCurrencyChanged(currency: string): void {
    this.ynabImportService.setCurrency(currency);
  }

  onImportComplete(): void {
    this.currentStep.set(YnabImportStep.Complete);
  }

  onImportFailed(errorMessage: string): void {
    toast.error(errorMessage);
    // Go back to account mapping step
    this.currentStep.set(YnabImportStep.AccountMapping);
  }
}
