import { Injectable } from '@angular/core';
import { clearLegacyAnalyticsStorage } from '@kualia/shared/analytics/attribution';
import { initializeWebMeasurement, recordWebMilestone } from '@kualia/shared/analytics/appsflyer';
import { browserPostHogConfig, productAnalyticsProperties } from '@kualia/shared/analytics/posthog-config';
import posthog from 'posthog-js';
import { environment } from '../../environments/environment';

export const TrackingEvent = {
  // Auth
  SIGNED_IN: 'signed_in',
  SIGNED_OUT: 'signed_out',

  // Onboarding
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  WORKSPACE_ONBOARDING_STEP_COMPLETED: 'workspace_onboarding_step_completed',
  WORKSPACE_ONBOARDING_COMPLETED: 'workspace_onboarding_completed',
  PAYWALL_VIEWED: 'paywall_viewed',
  CHECKOUT_STARTED: 'checkout_started',

  // Accounts
  ACCOUNT_CREATED: 'account_created',
  ACCOUNT_UPDATED: 'account_updated',
  ACCOUNT_DELETED: 'account_deleted',

  // Transactions
  TRANSACTION_CREATED: 'transaction_created',
  TRANSACTION_UPDATED: 'transaction_updated',
  TRANSACTION_DELETED: 'transaction_deleted',
  SEARCH_PERFORMED: 'search_performed',

  // Budget
  MONEY_ASSIGNED: 'money_assigned',

  // Targets
  TARGET_SET: 'target_set',
  TARGET_REMOVED: 'target_removed',

  // Categories
  CATEGORY_CREATED: 'category_created',
  CATEGORY_DELETED: 'category_deleted',
  CATEGORY_REORDERED: 'category_reordered',
  CATEGORY_GROUP_CREATED: 'category_group_created',
  CATEGORY_GROUP_DELETED: 'category_group_deleted',

  // Bank Links
  BANK_LINK_CONNECTED: 'bank_link_connected',
  BANK_LINK_RECONNECTED: 'bank_link_reconnected',
  BANK_LINK_DISCONNECTED: 'bank_link_disconnected',

  // Workspaces
  WORKSPACE_SWITCHED: 'workspace_switched',
  WORKSPACE_CREATED: 'workspace_created',

  // AI Chat
  AI_CHAT_OPENED: 'ai_chat_opened',
  AI_CHAT_MESSAGE_SENT: 'ai_chat_message_sent',
  AI_CHAT_THREAD_ARCHIVED: 'ai_chat_thread_archived',
  AI_CHAT_THREAD_DELETED: 'ai_chat_thread_deleted',
} as const;

export const WEB_ONBOARDING_ANALYTICS_PROPERTIES = {
  platform: 'web',
  onboarding_flow: 'web',
  version: '1',
} as const satisfies Record<string, unknown>;

@Injectable({
  providedIn: 'root',
})
export class ReportingService {
  private initialized = false;

  /** Only explicitly allowed conversion names go to advertising measurement providers; product properties never do. */
  init(): void {
    if (this.initialized) return;
    clearLegacyAnalyticsStorage({
      preserveCampaignParameters: true,
      preservePostHog: true,
      preservePixelCookies: true,
    });
    initializeWebMeasurement();
    if (!environment.production || !environment.posthog.apiKey) return;
    posthog.init(environment.posthog.apiKey, {
      ...browserPostHogConfig(),
      api_host: environment.posthog.apiHost,
    });
    this.initialized = true;
  }

  identify(userId: string, properties?: Record<string, unknown>): void {
    if (this.initialized) posthog.identify(userId, productAnalyticsProperties(properties));
  }

  capture(eventName: string, properties?: Record<string, unknown>): void {
    if (this.initialized) posthog.capture(eventName, productAnalyticsProperties(properties));
    if (eventName === TrackingEvent.ONBOARDING_COMPLETED) recordWebMilestone('af_tutorial_completion', 'onboarding');
    if (eventName === TrackingEvent.CHECKOUT_STARTED) recordWebMilestone('af_initiated_checkout');
  }

  recordSignup(sessionId: string): void {
    recordWebMilestone('af_complete_registration', sessionId);
  }

  reset(): void {
    if (this.initialized) posthog.reset();
  }

  setPersonProperties(properties: Record<string, unknown>): void {
    if (this.initialized) posthog.setPersonProperties(productAnalyticsProperties(properties));
  }

  group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void {
    if (this.initialized) posthog.group(groupType, groupKey, productAnalyticsProperties(properties));
  }

  isFeatureEnabled(featureFlag: string): boolean {
    return this.initialized ? (posthog.isFeatureEnabled(featureFlag) ?? false) : false;
  }

  getFeatureFlag(featureFlag: string): unknown {
    return this.initialized ? posthog.getFeatureFlag(featureFlag) : undefined;
  }

  reloadFeatureFlags(): void {
    if (this.initialized) posthog.reloadFeatureFlags();
  }
}
