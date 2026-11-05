import { computed, effect, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import { LocalAuthService } from './local-auth.service';
import { ConvexService } from './convex.service';

export type AppAccess = FunctionReturnType<typeof api.appAccess.getCurrentAppAccess>;
export type CurrentSubscription = FunctionReturnType<typeof api.revenuecat.queries.getUserSubscription>;

export function isBlockedByFamilyOwnerSubscription(access: AppAccess | null | undefined): boolean {
  return (
    !!access &&
    !access.hasAppAccess &&
    access.familyAccess !== null &&
    access.familyAccess.role === 'member' &&
    !access.familyAccess.ownerHasValidSubscription
  );
}

@Injectable({
  providedIn: 'root',
})
export class AppAccessService implements OnDestroy {
  private readonly clerkService = inject(LocalAuthService);
  private readonly convexService = inject(ConvexService);

  private readonly _appAccess = signal<AppAccess | null | undefined>(undefined);
  private readonly _subscription = signal<CurrentSubscription | null | undefined>(undefined);

  private accessUnsubscribe?: () => void;
  private subscriptionUnsubscribe?: () => void;
  private watchingUserId: string | null = null;

  readonly appAccess = this._appAccess.asReadonly();
  readonly subscription = this._subscription.asReadonly();

  readonly loading = computed(() => this.clerkService.isAuthenticated() && this._appAccess() === undefined);
  readonly hasActiveAccess = computed(() => this._appAccess()?.hasAppAccess ?? false);
  readonly familyOwnerBlocked = computed(() => isBlockedByFamilyOwnerSubscription(this._appAccess()));
  readonly isTrialing = computed(() => this._subscription()?.isTrialing ?? false);
  readonly expirationDate = computed(() => this._subscription()?.expiresAt ?? null);

  constructor() {
    effect(() => {
      const loading = this.clerkService.loading();
      const user = this.clerkService.user();
      const isAuthenticated = this.clerkService.isAuthenticated();

      if (loading) {
        return;
      }

      if (!isAuthenticated || !user) {
        this.reset();
        return;
      }

      this.startWatching(user.id);
    });
  }

  async refresh(): Promise<AppAccess | null> {
    if (!this.clerkService.isAuthenticated()) {
      this.reset();
      return null;
    }

    try {
      const [appAccess, subscription] = await Promise.all([
        this.convexService.getClient().query(api.appAccess.getCurrentAppAccess, {}),
        this.convexService.getClient().query(api.revenuecat.queries.getUserSubscription, {}),
      ]);

      this._appAccess.set(appAccess);
      this._subscription.set(subscription);
      return appAccess;
    } catch (error: unknown) {
      void error;
      this._appAccess.set(null);
      this._subscription.set(null);
      return null;
    }
  }

  private startWatching(userId: string): void {
    if (this.watchingUserId === userId) {
      return;
    }

    this.stopWatching();
    this.watchingUserId = userId;
    this._appAccess.set(undefined);
    this._subscription.set(undefined);

    this.accessUnsubscribe = this.convexService
      .watchQuery<AppAccess>(api.appAccess.getCurrentAppAccess, {})
      .subscribe((appAccess) => {
        this._appAccess.set(appAccess ?? null);
      });

    this.subscriptionUnsubscribe = this.convexService
      .watchQuery<CurrentSubscription>(api.revenuecat.queries.getUserSubscription, {})
      .subscribe((subscription) => {
        this._subscription.set(subscription ?? null);
      });
  }

  private reset(): void {
    this.stopWatching();
    this.watchingUserId = null;
    this._appAccess.set(null);
    this._subscription.set(null);
  }

  private stopWatching(): void {
    this.accessUnsubscribe?.();
    this.subscriptionUnsubscribe?.();
    this.accessUnsubscribe = undefined;
    this.subscriptionUnsubscribe = undefined;
  }

  ngOnDestroy(): void {
    this.stopWatching();
  }
}
