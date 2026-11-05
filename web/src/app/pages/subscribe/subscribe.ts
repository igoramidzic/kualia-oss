import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { nucleoLoader as LoaderCircle, NucleoIcon, nucleoSparkles as Sparkles } from '@kualia/icons';
import { HlmButton } from '@spartan-ng/helm/button';

import { environment } from '../../../environments/environment';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { AppAccessService, isBlockedByFamilyOwnerSubscription } from '../../services/app-access.service';
import { LocalAuthService } from '../../services/local-auth.service';
import { ReportingService, TrackingEvent, WEB_ONBOARDING_ANALYTICS_PROPERTIES } from '../../services/reporting.service';

@Component({
  selector: 'app-subscribe',
  imports: [HlmButton, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './subscribe.html',
  styleUrl: './subscribe.css',
})
export class SubscribeComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly clerkService = inject(LocalAuthService);
  private readonly appAccessService = inject(AppAccessService);
  private readonly reportingService = inject(ReportingService);
  private readonly userPreferences = inject(UserPreferencesService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Sparkles = Sparkles;

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly showPaywall = signal(false);

  protected readonly logoPath = computed(() => {
    const theme = this.userPreferences.resolvedTheme();
    return theme === 'dark' ? '/images/kualia-logo-light.svg' : '/images/kualia-logo-dark.svg';
  });

  protected readonly isInitializing = computed(() => {
    return this.appAccessService.loading();
  });

  constructor() {
    // Watch for app access changes and navigate away when access updates.
    effect(() => {
      const appAccess = this.appAccessService.appAccess();
      const hasAccess = appAccess?.hasAppAccess ?? false;
      const isInitializing = this.appAccessService.loading();

      // Only navigate after initialization is complete and user has access
      if (!isInitializing && hasAccess) {
        void this.router.navigate(['/workspaces']);
      } else if (!isInitializing && isBlockedByFamilyOwnerSubscription(appAccess)) {
        void this.router.navigate(['/family/subscription-required']);
      }
    });
  }

  ngOnInit(): void {
    // Refresh access when returning to tab after billing completes.
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void this.appAccessService.refresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Clean up listener when component is destroyed
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    });
  }

  openPaywall(): void {
    const userId = this.clerkService.user()?.id;
    if (!userId) {
      this.errorMessage.set('User not found. Please log in again.');
      return;
    }

    this.reportingService.capture(TrackingEvent.PAYWALL_VIEWED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      source: 'subscribe_page',
      paywall_provider: 'revenuecat',
      paywall_surface: 'web_billing',
    });

    // Open RevenueCat payment portal in new tab
    this.reportingService.capture(TrackingEvent.CHECKOUT_STARTED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      source: 'subscribe_page',
      paywall_provider: 'revenuecat',
    });
    window.open(`${environment.revenueCat.billingUrl}/${userId}`, '_blank');
  }

  async logout(): Promise<void> {
    await this.clerkService.logout();
    await this.router.navigate(['/login']);
  }
}
