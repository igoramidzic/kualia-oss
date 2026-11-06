import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { openKualiaImport } from '../../components/dialogs/kualia-import-dialog/kualia-import-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from 'ngx-sonner';
import { UserNavbarComponent } from '../../components/user-navbar/user-navbar';
import { ReportingService, TrackingEvent, WEB_ONBOARDING_ANALYTICS_PROPERTIES } from '../../services/reporting.service';
import { WorkspaceService } from '../../services/workspace.service';
import { getShortId } from '../../shared/utils/id-utils';

@Component({
  selector: 'app-onboarding',
  imports: [HlmButton, UserNavbarComponent],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  private readonly router = inject(Router);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);

  private readonly dialogs = inject(HlmDialogService);

  protected importFromKualia(): void {
    openKualiaImport(this.dialogs);
  }

  readonly loading = signal(false);

  async continue() {
    if (this.loading()) {
      return;
    }

    this.loading.set(true);
    try {
      this.reportingService.capture(TrackingEvent.WORKSPACE_ONBOARDING_STEP_COMPLETED, {
        ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
        step: 'complete',
        step_index: 0,
      });
      await this.workspaceService.completeOnboarding();
      this.reportingService.capture(TrackingEvent.WORKSPACE_ONBOARDING_COMPLETED, WEB_ONBOARDING_ANALYTICS_PROPERTIES);

      const workspaceId = this.workspaceService.workspaceId();
      if (workspaceId) {
        const shortId = getShortId(workspaceId);
        await this.router.navigate([shortId, 'budget']);
      }
    } catch (error: unknown) {
      console.error('Failed to complete onboarding:', error instanceof Error ? error.message : String(error));
      toast.error('Failed to complete onboarding. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
