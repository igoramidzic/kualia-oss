import type { CaptureResult } from 'posthog-js';
import { describe, expect, it } from 'vitest';
import { productAnalyticsProperties, sanitizePostHogEvent } from './posthog-config';

describe('PostHog browser data minimization', () => {
  it('retains product metadata while removing financial records, contact details, chat text and arbitrary objects', () => {
    expect(
      productAnalyticsProperties({
        platform: 'web',
        step_index: 2,
        is_linked: true,
        query_length: 6,
        amount: 250,
        merchant: 'Private',
        email: 'private@example.com',
        content: 'Private chat',
        value: 'onboarding answer',
        status: { private: 'value' },
        prompt_chars: Number.NaN,
      })
    ).toEqual({ platform: 'web', step_index: 2, is_linked: true, query_length: 6 });
  });

  it('strips query strings and fragments from page URLs and initial person properties', () => {
    const event: CaptureResult = {
      uuid: 'test',
      event: '$pageview',
      properties: {
        $current_url: 'https://app.kualia.com/signup?invite=secret#token',
        $referrer: 'https://example.com/search?q=private',
        $prev_pageview_pathname: '/login?email=private@example.com',
        $session_id: 'session',
        utm_term: 'private',
        $title: 'Private page',
        $set: { $initial_referrer: 'https://example.com/?token=private' },
      },
      $set_once: { $initial_current_url: 'https://kualia.com/?token=private' },
    };
    const result = sanitizePostHogEvent(event);
    expect(result?.properties).toEqual({
      $current_url: 'https://app.kualia.com/signup',
      $referrer: 'https://example.com/search',
      $prev_pageview_pathname: '/login',
      $session_id: 'session',
      $set: { $initial_referrer: 'https://example.com/' },
    });
    expect(result?.$set_once).toEqual({ $initial_current_url: 'https://kualia.com/' });
    expect(sanitizePostHogEvent(null)).toBeNull();
  });
});
