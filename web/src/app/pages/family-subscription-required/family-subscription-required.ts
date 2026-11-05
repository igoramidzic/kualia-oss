import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoLoader as LoaderCircle, nucleoUsers as UsersRound } from '@kualia/icons';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { AppAccessService, isBlockedByFamilyOwnerSubscription } from '../../services/app-access.service';
import { LocalAuthService } from '../../services/local-auth.service';

@Component({
  selector: 'app-family-subscription-required',
  imports: [HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './family-subscription-required.html',
})
export class FamilySubscriptionRequiredComponent {
  private readonly appAccessService = inject(AppAccessService);
  private readonly clerkService = inject(LocalAuthService);
  private readonly router = inject(Router);
  private readonly userPreferences = inject(UserPreferencesService);

  protected readonly LoaderCircle = LoaderCircle;
  protected readonly UsersRound = UsersRound;

  protected readonly loading = this.appAccessService.loading;
  protected readonly owner = computed(() => this.appAccessService.appAccess()?.familyAccess?.owner ?? null);

  protected readonly logoPath = computed(() => {
    const theme = this.userPreferences.resolvedTheme();
    return theme === 'dark' ? '/images/kualia-logo-light.svg' : '/images/kualia-logo-dark.svg';
  });

  protected readonly ownerName = computed(() => {
    const owner = this.owner();
    const normalizedName = owner?.name?.trim() ?? '';
    if (normalizedName.length > 0) {
      return normalizedName;
    }

    const normalizedEmail = owner?.email?.trim() ?? '';
    return normalizedEmail.length > 0 ? normalizedEmail : 'your family group manager';
  });

  protected readonly ownerEmail = computed(() => {
    const normalizedEmail = this.owner()?.email?.trim() ?? '';
    return normalizedEmail.length > 0 ? normalizedEmail : null;
  });

  constructor() {
    effect(() => {
      const isLoading = this.appAccessService.loading();
      const appAccess = this.appAccessService.appAccess();

      if (isLoading || appAccess === undefined) {
        return;
      }

      if (appAccess?.hasAppAccess) {
        void this.router.navigate(['/workspaces']);
        return;
      }

      if (!isBlockedByFamilyOwnerSubscription(appAccess)) {
        void this.router.navigate(['/subscribe']);
      }
    });
  }

  protected async logout(): Promise<void> {
    await this.clerkService.logout();
    await this.router.navigate(['/login']);
  }
}
