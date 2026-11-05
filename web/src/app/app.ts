import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { HlmToaster } from '@spartan-ng/helm/sonner';
import { KeyboardShortcutsSheetComponent } from './components/keyboard-shortcuts-sheet/keyboard-shortcuts-sheet';
import { MaintenanceBlockingComponent } from './components/maintenance-blocking/maintenance-blocking.component';
import { ThemeService } from './core/services/theme/theme.service';
import { MainLayoutComponent } from './layouts/main-layout/main-layout';
import { AppAccessService, isBlockedByFamilyOwnerSubscription } from './services/app-access.service';
import { AppInitializationService } from './services/app-initialization.service';
import { CheckInService } from './services/check-in.service';
import { LocalAuthService } from './services/local-auth.service';
import { KeyboardShortcutService } from './services/keyboard-shortcut.service';
import { ReportingService } from './services/reporting.service';
import { SystemStatusService } from './services/system-status.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  imports: [
    RouterOutlet,
    HlmToaster,
    KeyboardShortcutsSheetComponent,
    MainLayoutComponent,
    MaintenanceBlockingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly themeService = inject(ThemeService);
  private readonly posthogService = inject(ReportingService);
  private readonly keyboardShortcutService = inject(KeyboardShortcutService);
  private readonly appInitService = inject(AppInitializationService);
  private readonly appAccessService = inject(AppAccessService);
  private readonly clerkService = inject(LocalAuthService);
  private readonly checkInService = inject(CheckInService);
  private readonly systemStatusService = inject(SystemStatusService);
  private readonly router = inject(Router);

  // Track if user previously had access (to detect loss of subscription)
  private readonly hadAccess = signal(false);

  // Expose isAppReady signal to the template
  readonly isAppReady = this.appInitService.isAppReady;
  readonly usesMainLayout = this.appInitService.usesMainLayout;
  readonly usesSettingsLayout = this.appInitService.usesSettingsLayout;

  // System status signals for maintenance mode
  readonly isMaintenanceMode = this.systemStatusService.isMaintenanceMode;
  readonly maintenanceMessage = this.systemStatusService.maintenanceMessage;

  constructor() {
    // Start system status check FIRST (before auth)
    this.systemStatusService.startWatching();

    this.posthogService.init();

    // Watch for subscription changes
    effect(() => {
      const isAuthenticated = this.clerkService.isAuthenticated();
      const isLoading = this.appAccessService.loading();
      const appAccess = this.appAccessService.appAccess();
      const hasAccess = appAccess?.hasAppAccess ?? false;
      const previouslyHadAccess = this.hadAccess();

      // Skip if not authenticated or access is still loading.
      if (!isAuthenticated || isLoading) {
        return;
      }

      // Update tracking signal
      if (hasAccess && !previouslyHadAccess) {
        this.hadAccess.set(true);
      }

      // Detect loss of subscription - user had access but no longer does
      if (previouslyHadAccess && !hasAccess) {
        this.hadAccess.set(false);
        const target = isBlockedByFamilyOwnerSubscription(appAccess) ? '/family/subscription-required' : '/subscribe';
        void this.router.navigate([target]);
      }
    });
  }
}
