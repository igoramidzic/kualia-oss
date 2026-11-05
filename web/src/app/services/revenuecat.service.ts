import { computed, inject, Injectable, signal } from '@angular/core';
import { Purchases, type CustomerInfo, type Offerings } from '@revenuecat/purchases-js';

import { environment as defaultEnvironment } from '../../environments/environment';
import { ENVIRONMENT } from '../config/environment.token';

@Injectable({
  providedIn: 'root',
})
export class RevenueCatService {
  private readonly environment = inject(ENVIRONMENT, { optional: true }) ?? defaultEnvironment;

  private readonly _initialized = signal(false);
  private readonly _initializing = signal(false);
  private readonly _initializedUserId = signal<string | null>(null);
  private readonly _customerInfo = signal<CustomerInfo | null>(null);
  private readonly _offerings = signal<Offerings | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly initialized = this._initialized.asReadonly();
  readonly initializing = this._initializing.asReadonly();
  readonly initializedUserId = this._initializedUserId.asReadonly();
  readonly customerInfo = this._customerInfo.asReadonly();
  readonly offerings = this._offerings.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly managementURL = computed(() => this._customerInfo()?.managementURL ?? null);

  async initialize(userId: string): Promise<void> {
    const previousUserId = this._initializedUserId();
    const isDifferentUser = previousUserId !== userId;
    console.log('[RevenueCat] initialize requested', {
      userId,
      initialized: this._initialized(),
      initializedUserId: previousUserId,
      sdkConfigured: Purchases.isConfigured(),
    });

    if (isDifferentUser) {
      this.clearCustomerState();
      this._initialized.set(false);
      this._initializedUserId.set(null);
    }

    if (this._initializing()) {
      console.log('[RevenueCat] initialize skipped because initialization is already running', { userId });
      return;
    }

    if (this._initialized() && this._initializedUserId() === userId) {
      console.log('[RevenueCat] initialize skipped because SDK is already initialized for user', { userId });
      return;
    }

    const publicKey = this.environment.revenueCat?.publicKey;
    if (!publicKey) {
      console.warn('[RevenueCat] No public key configured, skipping initialization');
      this._initialized.set(true);
      this._initializedUserId.set(userId);
      return;
    }

    this._initializing.set(true);
    this._error.set(null);

    try {
      let purchases: Purchases;
      if (Purchases.isConfigured()) {
        purchases = Purchases.getSharedInstance();
        if (purchases.getAppUserId() !== userId) {
          console.log('[RevenueCat] changing SDK user', {
            fromUserId: purchases.getAppUserId(),
            toUserId: userId,
          });
          const customerInfo = await purchases.changeUser(userId);
          this._customerInfo.set(customerInfo);
          this.logCustomerInfo('changeUser', customerInfo);
        } else {
          console.log('[RevenueCat] SDK already configured with requested user', { userId });
        }
      } else {
        purchases = Purchases.configure({
          apiKey: publicKey,
          appUserId: userId,
        });
        console.log('[RevenueCat] configured SDK', { userId });
      }

      if (!this._customerInfo()) {
        await this.refreshCustomerInfo();
      }

      this._initialized.set(true);
      this._initializedUserId.set(userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to initialize RevenueCat';
      console.error('[RevenueCat] initialize failed', { userId, message });
      this.clearCustomerState();
      this._error.set(message);
      this._initialized.set(true);
      this._initializedUserId.set(userId);
    } finally {
      this._initializing.set(false);
    }
  }

  async refreshCustomerInfo(): Promise<CustomerInfo | null> {
    if (!Purchases.isConfigured()) {
      console.log('[RevenueCat] refreshCustomerInfo skipped because SDK is not configured');
      return null;
    }

    console.log('[RevenueCat] refreshCustomerInfo started', {
      appUserId: Purchases.getSharedInstance().getAppUserId(),
    });
    this._loading.set(true);
    this._error.set(null);

    try {
      const purchases = Purchases.getSharedInstance();
      const info = await purchases.getCustomerInfo();
      this._customerInfo.set(info);
      this.logCustomerInfo('getCustomerInfo', info);
      return info;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch customer info';
      console.error('[RevenueCat] refreshCustomerInfo failed', {
        appUserId: Purchases.getSharedInstance().getAppUserId(),
        message,
      });
      this._error.set(message);
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  async getOfferings(): Promise<Offerings | null> {
    if (!Purchases.isConfigured()) {
      return null;
    }

    this._loading.set(true);
    this._error.set(null);

    try {
      const purchases = Purchases.getSharedInstance();
      const offerings = await purchases.getOfferings();
      this._offerings.set(offerings);
      return offerings;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch offerings';
      this._error.set(message);
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  reset(): void {
    console.log('[RevenueCat] reset service state');
    this._initialized.set(false);
    this._initializing.set(false);
    this._initializedUserId.set(null);
    this.clearCustomerState();
    this._loading.set(false);
    this._error.set(null);
  }

  private clearCustomerState(): void {
    this._customerInfo.set(null);
    this._offerings.set(null);
  }

  private logCustomerInfo(source: string, info: CustomerInfo): void {
    console.log('[RevenueCat] customer info received', {
      source,
      sdkAppUserId: Purchases.isConfigured() ? Purchases.getSharedInstance().getAppUserId() : null,
      originalAppUserId: info.originalAppUserId,
      managementURL: info.managementURL,
      activeSubscriptions: Array.from(info.activeSubscriptions),
      activeEntitlementIds: Object.keys(info.entitlements.active),
      allEntitlementIds: Object.keys(info.entitlements.all),
    });
  }
}
