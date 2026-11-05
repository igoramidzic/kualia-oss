import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import {
  nucleoCreditCard as CreditCard,
  nucleoLoader as Loader2,
  NucleoIcon,
  nucleoArrowRight as MoveRight,
  nucleoSparkles as Sparkles,
} from '@kualia/icons';
import { environment } from '../../../../environments/environment';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { AppAccessService } from '../../../services/app-access.service';
import { LocalAuthService } from '../../../services/local-auth.service';
import { RevenueCatService } from '../../../services/revenuecat.service';

const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

export function formatBillingDate(expirationDate: Date | string, now = new Date()): string | null {
  const date = expirationDate instanceof Date ? expirationDate : new Date(expirationDate);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const isSameYear = date.getFullYear() === now.getFullYear();

  return date.toLocaleDateString('en-US', {
    year: isSameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getStoreManagementURL(store: string | null | undefined): string | null {
  switch (store) {
    case 'app_store':
      return APP_STORE_SUBSCRIPTIONS_URL;
    default:
      return null;
  }
}

export function resolveManagementURL({
  currentUserId,
  hasFamilyAccess,
  revenueCatManagementURL,
  sdkInitializedUserId,
  storeManagementURL,
}: {
  currentUserId: string | null;
  hasFamilyAccess: boolean;
  revenueCatManagementURL: string | null;
  sdkInitializedUserId: string | null;
  storeManagementURL: string | null;
}): string | null {
  if (hasFamilyAccess || !currentUserId) {
    return null;
  }

  if (sdkInitializedUserId === currentUserId && revenueCatManagementURL) {
    return revenueCatManagementURL;
  }

  return storeManagementURL;
}

@Component({
  selector: 'app-billing',
  imports: [HlmButton, HlmCard, SettingsPageHeaderComponent, NucleoIcon],
  templateUrl: './billing.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class BillingComponent {
  protected readonly Loader2 = Loader2;
  protected readonly CreditCard = CreditCard;
  protected readonly Sparkles = Sparkles;
  protected readonly manageSubscriptionIcon = MoveRight;

  private readonly appAccessService = inject(AppAccessService);
  private readonly clerkService = inject(LocalAuthService);
  private readonly revenueCatService = inject(RevenueCatService);

  protected readonly isLoadingPortal = signal(false);

  protected readonly appAccess = this.appAccessService.appAccess;
  protected readonly currentSubscription = this.appAccessService.subscription;
  protected readonly isTrialing = this.appAccessService.isTrialing;

  protected readonly subscription = computed(() => {
    const subscription = this.currentSubscription();
    if (!subscription?.isActive) return null;

    return {
      planName: 'Kualia Premium',
      isActive: subscription.isActive,
      status: subscription.status,
      subscriptionType: subscription.subscriptionType,
      periodType: subscription.periodType,
      expirationDate: subscription.expiresAt ?? null,
      willRenew: subscription.status !== 'canceled' && subscription.expiresAt !== null,
      store: subscription.store ?? null,
    };
  });

  protected readonly hasFamilyAccess = computed(() => this.appAccess()?.accessSource === 'family_owner_subscription');
  protected readonly revenueCatManagementURL = this.revenueCatService.managementURL;
  protected readonly storeManagementURL = computed(() => getStoreManagementURL(this.subscription()?.store));
  protected readonly currentUserId = computed(() => this.clerkService.user()?.id ?? null);
  protected readonly managementURL = computed(() =>
    resolveManagementURL({
      currentUserId: this.currentUserId(),
      hasFamilyAccess: this.hasFamilyAccess(),
      revenueCatManagementURL: this.revenueCatManagementURL(),
      sdkInitializedUserId: this.revenueCatService.initializedUserId(),
      storeManagementURL: this.storeManagementURL(),
    })
  );

  constructor() {
    effect(() => {
      const hasFamilyAccess = this.hasFamilyAccess();
      const userId = this.currentUserId();

      console.log('[Billing] RevenueCat initialization state', {
        hasFamilyAccess,
        userId,
        sdkInitialized: this.revenueCatService.initialized(),
        sdkInitializing: this.revenueCatService.initializing(),
        sdkInitializedUserId: this.revenueCatService.initializedUserId(),
      });

      if (hasFamilyAccess) {
        return;
      }

      if (!userId) {
        this.revenueCatService.reset();
        return;
      }

      void this.revenueCatService.initialize(userId);
    });

    effect(() => {
      const customerInfo = this.revenueCatService.customerInfo();
      const subscription = this.subscription();
      const managementURL = this.managementURL();
      const revenueCatManagementURL = this.revenueCatManagementURL();
      const storeManagementURL = this.storeManagementURL();

      console.log('[Billing] Manage button state', {
        hasFamilyAccess: this.hasFamilyAccess(),
        hasManagementURL: managementURL !== null,
        managementURL,
        revenueCatManagementURL,
        storeManagementURL,
        sdkInitialized: this.revenueCatService.initialized(),
        sdkInitializing: this.revenueCatService.initializing(),
        sdkInitializedUserId: this.revenueCatService.initializedUserId(),
        sdkLoading: this.revenueCatService.loading(),
        sdkError: this.revenueCatService.error(),
        activeSubscriptions: customerInfo ? Array.from(customerInfo.activeSubscriptions) : [],
        activeEntitlementIds: customerInfo ? Object.keys(customerInfo.entitlements.active) : [],
        originalAppUserId: customerInfo?.originalAppUserId ?? null,
        convexSubscriptionStatus: subscription?.status ?? null,
        convexSubscriptionStore: subscription?.store ?? null,
        convexSubscriptionExpiresAt: subscription?.expirationDate ?? null,
      });
    });
  }

  protected readonly familyOwnerName = computed(() => {
    const owner = this.appAccess()?.familyAccess?.owner;
    const normalizedName = owner?.name?.trim() ?? '';
    if (normalizedName.length > 0) {
      return normalizedName;
    }

    const normalizedEmail = owner?.email?.trim() ?? '';
    return normalizedEmail.length > 0 ? normalizedEmail : 'your family group manager';
  });

  protected readonly isCancelled = computed(() => {
    const sub = this.subscription();
    if (!sub) return false;
    return sub.status === 'canceled' && sub.isActive;
  });

  protected readonly statusLabel = computed(() => {
    const sub = this.subscription();
    if (!sub) return null;

    const isCancelled = this.isCancelled();
    const isTrialing = sub.status === 'trialing';

    if (isTrialing && isCancelled) {
      return 'Cancelled';
    } else if (isTrialing) {
      return 'Trial';
    } else if (isCancelled) {
      return 'Cancelled';
    } else {
      return 'Active';
    }
  });

  protected readonly renewalDate = computed(() => {
    const sub = this.subscription();
    if (!sub?.expirationDate) return null;

    return formatBillingDate(sub.expirationDate);
  });

  protected readonly showLifetimeOption = computed(() => {
    const sub = this.subscription();
    if (!sub?.isActive) return false;
    return sub.subscriptionType !== 'lifetime';
  });

  protected readonly purchaseUrl = computed(() => {
    const userId = this.clerkService.user()?.id;
    return userId ? `${environment.revenueCat.billingUrl}/${userId}` : null;
  });

  protected openCustomerPortal(): void {
    const url = this.managementURL();
    if (url) {
      window.open(url, '_blank');
    }
  }

  protected openLifetimePurchase(): void {
    const url = this.purchaseUrl();
    if (url) {
      window.open(url, '_blank');
    }
  }
}
