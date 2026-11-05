import type { CaptureResult, PostHogConfig } from 'posthog-js';
import { POSTHOG_PROXY_PATH } from './telemetry-config';

/** Keep product usage metadata; never forward arbitrary financial records or user-entered text. */
export function productAnalyticsProperties(properties: Record<string, unknown> = {}): Record<string, unknown> {
  const allowed = new Set([
    'platform',
    'onboarding_flow',
    'version',
    'step',
    'step_index',
    'entry_step',
    'source',
    'type',
    'method',
    'status',
    'has_category',
    'is_linked',
    'is_first_message',
    'prompt_chars',
    'query_length',
    'created_at',
    'paywall_provider',
    'paywall_surface',
  ]);
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        allowed.has(key) &&
        (typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)))
    )
  );
}

function sanitizeUrlProperties(properties: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(properties)) {
    if (key === '$set' || key === '$set_once') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitizeUrlProperties(value as Record<string, unknown>);
      }
    } else if (
      ['$current_url', '$initial_current_url', '$referrer', '$initial_referrer', '$prev_pageview_pathname'].includes(
        key
      )
    ) {
      if (typeof value !== 'string') continue;
      try {
        const url = new URL(value, location.origin);
        properties[key] = value.startsWith('/') ? url.pathname : `${url.origin}${url.pathname}`;
      } catch (_error: unknown) {
        delete properties[key];
      }
    } else if (
      /^(?:\$initial_)?(?:utm_|gclid|fbclid|msclkid)/.test(key) ||
      key === '$search_keyword' ||
      key === '$title'
    ) {
      delete properties[key];
    }
  }
}

export function sanitizePostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (event) {
    sanitizeUrlProperties(event.properties);
    if (event.$set) sanitizeUrlProperties(event.$set);
    if (event.$set_once) sanitizeUrlProperties(event.$set_once);
  }
  return event;
}

export function browserPostHogConfig(): Partial<PostHogConfig> {
  return {
    api_host: POSTHOG_PROXY_PATH,
    ui_host: 'https://us.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: 'history_change',
    capture_pageleave: true,
    cross_subdomain_cookie: true,
    autocapture: false,
    capture_dead_clicks: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    enable_heatmaps: false,
    respect_dnt: true,
    save_campaign_params: false,
    save_referrer: false,
    before_send: sanitizePostHogEvent,
  };
}
