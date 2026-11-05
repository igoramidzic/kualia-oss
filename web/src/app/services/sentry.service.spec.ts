import * as Sentry from '@sentry/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SentryService, sanitizeSentryBreadcrumb, sanitizeSentryEvent } from './sentry.service';

vi.mock('../../environments/environment', () => ({
  environment: { production: true, sentry: { dsn: 'test-dsn' } },
}));
vi.mock('@sentry/angular', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('operational error reporting privacy', () => {
  it('removes account identity, request data, and URL queries while retaining error details', () => {
    const event: Sentry.Event = {
      message: 'Request failed: https://app.kualia.com/budget?oppref=secret&fbclid=secret#account',
      user: { id: 'user-1', email: 'person@example.com', username: 'Person' },
      request: {
        url: 'https://app.kualia.com/budget?oppref=secret#account',
        method: 'GET',
        data: { name: 'Person' },
        query_string: { fbclid: 'secret' },
        cookies: { kualia_ad_click: 'secret' },
        headers: { Referer: 'https://kualia.com/?oppref=secret' },
      },
      extra: { operation: 'load_budget', oppref: 'secret', email: 'person@example.com', utm_source: 'facebook' },
      contexts: { trace: { trace_id: 'trace-1', span_id: 'span-1', op: 'http.client' } },
      spans: [
        {
          trace_id: 'trace-1',
          span_id: 'span-2',
          start_timestamp: 1,
          timestamp: 2,
          description: 'GET https://app.kualia.com/api?fbclid=secret',
          data: { 'http.query': '?fbclid=secret', 'http.fragment': '#account', 'http.response.status_code': 500 },
        },
      ],
    };
    const sanitized = sanitizeSentryEvent(event);
    expect(sanitized.user).toBeUndefined();
    expect(sanitized.request).toEqual({ url: 'https://app.kualia.com/budget', method: 'GET' });
    expect(sanitized.message).toBe('Request failed: https://app.kualia.com/budget');
    expect(sanitized.extra).toEqual({ operation: 'load_budget' });
    expect(sanitized.spans?.[0].description).toBe('GET https://app.kualia.com/api');
    expect(sanitized.spans?.[0].data).toEqual({ 'http.response.status_code': 500 });
    expect(sanitized.contexts?.trace?.trace_id).toBe('trace-1');
  });

  it('sanitizes navigation breadcrumbs before they enter the diagnostic buffer', () => {
    expect(
      sanitizeSentryBreadcrumb({
        category: 'navigation',
        data: { from: '/signup?fbclid=secret', to: '/onboarding?oppref=secret#account' },
      })
    ).toEqual({ category: 'navigation', data: { from: '/signup', to: '/onboarding' } });
  });

  it('keeps exception capture working without setting an account identity', () => {
    const service = new SentryService();
    service.setUser('user-1', 'person@example.com', { name: 'Person' });
    const error = new Error('Budget unavailable');
    service.captureException(error);
    expect(Sentry.setUser).toHaveBeenCalledWith(null);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
