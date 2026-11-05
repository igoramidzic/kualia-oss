import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pixels: typeof import('./ad-pixels');
let consent = false;
let pageAllowed = true;
const metaId = '1646871749572056';
const openaiId = 'A5ePqjBz2Ly985CQJWAtdt';
const scriptIds = ['kualia-meta-pixel', 'kualia-openai-pixel'];

function sync(): void {
  pixels.syncAdPixels(
    () => consent,
    () => pageAllowed
  );
}
function loaded(): void {
  for (const id of scriptIds) document.getElementById(id)?.dispatchEvent(new Event('load'));
}
function metaEvents() {
  return window.fbq?.queue.filter(([command]) => command.startsWith('track')) ?? [];
}
function openaiEvents() {
  return window.oaiq?.q.filter(([command]) => command === 'measure') ?? [];
}

beforeEach(async () => {
  vi.resetModules();
  consent = false;
  pageAllowed = true;
  history.replaceState({}, '', '/');
  for (const id of scriptIds) document.getElementById(id)?.remove();
  vi.stubGlobal('fbq', undefined);
  vi.stubGlobal('_fbq', undefined);
  vi.stubGlobal('oaiq', undefined);
  pixels = await import('./ad-pixels');
});
afterEach(() => vi.unstubAllGlobals());

describe('consented Meta and ChatGPT pixels', () => {
  it('does not download SDKs, initialize globals, or remember events before acceptance', () => {
    sync();
    pixels.recordAdPixelMilestone('af_complete_registration', 'before-consent');
    expect(window.fbq).toBeUndefined();
    expect(window.oaiq).toBeUndefined();
    for (const id of scriptIds) expect(document.getElementById(id)).toBeNull();
    consent = true;
    sync();
    loaded();
    expect(JSON.stringify([...metaEvents(), ...openaiEvents()])).not.toContain('before-consent');
  });

  it('loads both existing pixels once and waits for readiness with consent initially denied', () => {
    consent = true;
    sync();
    sync();
    expect(window.fbq?.queue).toEqual([['consent', 'revoke']]);
    expect(window.oaiq?.q).toEqual([]);
    for (const id of scriptIds) expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
    loaded();
    sync();
    expect(window.fbq?.queue).toContainEqual(['init', metaId]);
    expect(window.fbq?.queue).toContainEqual(['set', 'autoConfig', false, metaId]);
    expect(window.fbq?.disablePushState).toBe(true);
    expect(window.oaiq?.q).toContainEqual(['init', { pixelId: openaiId }]);
    expect(window.oaiq?.q).not.toContainEqual(['consent', false]);
    expect(metaEvents()).toHaveLength(1);
    expect(openaiEvents()).toHaveLength(1);
  });

  it('maps milestones with the same event ID, without adding account or financial data', () => {
    consent = true;
    sync();
    pixels.recordAdPixelMilestone('af_complete_registration', 'signup-event');
    pixels.recordAdPixelMilestone('af_tutorial_completion', 'onboarding-event');
    pixels.recordAdPixelMilestone('af_initiated_checkout', 'checkout-event');
    loaded();
    expect(metaEvents().slice(1)).toEqual([
      ['trackSingle', metaId, 'CompleteRegistration', {}, { eventID: 'signup-event' }],
      ['trackSingleCustom', metaId, 'CompleteTutorial', {}, { eventID: 'onboarding-event' }],
      ['trackSingle', metaId, 'InitiateCheckout', {}, { eventID: 'checkout-event' }],
    ]);
    expect(openaiEvents().slice(1)).toEqual([
      ['measure', 'registration_completed', { type: 'customer_action' }, { event_id: 'signup-event' }],
      [
        'measure',
        'custom',
        { type: 'custom' },
        { event_id: 'onboarding-event', custom_event_name: 'onboarding_completed' },
      ],
      ['measure', 'checkout_started', { type: 'contents' }, { event_id: 'checkout-event' }],
    ]);
  });

  it('drops queued events and does not initialize if permission is withdrawn while downloading', () => {
    consent = true;
    sync();
    pixels.recordAdPixelMilestone('af_complete_registration', 'withdrawn');
    consent = false;
    sync();
    loaded();
    expect(window.fbq?.queue).toEqual([['consent', 'revoke']]);
    expect(window.oaiq?.q).toEqual([]);
    consent = true;
    sync();
    expect(JSON.stringify([...metaEvents(), ...openaiEvents()])).not.toContain('withdrawn');
  });

  it('revokes both loaded SDKs, clears their cookies and ignores subsequent conversions', () => {
    consent = true;
    sync();
    loaded();
    for (const name of ['_fbp', '_fbc', '__oppref', '__obref']) {
      document.cookie = `${name}=tracking; Path=/`;
      document.cookie = `${name}=tracking; Path=/; Domain=kualia.com`;
    }
    consent = false;
    sync();
    pixels.recordAdPixelMilestone('af_complete_registration', 'declined');
    expect(window.fbq?.queue.at(-1)).toEqual(['consent', 'revoke']);
    expect(window.oaiq?.q.at(-1)).toEqual(['consent', false]);
    expect(document.cookie).not.toContain('tracking');
    expect(metaEvents()).toHaveLength(1);
    expect(openaiEvents()).toHaveLength(1);
  });

  it('revokes before private navigation and never reports a private page or action', () => {
    consent = true;
    sync();
    loaded();
    pageAllowed = false;
    sync();
    history.replaceState({}, '', '/workspace/transactions?query=medical');
    pixels.recordAdPixelMilestone('af_initiated_checkout', 'private');
    sync();
    expect(window.fbq?.queue.at(-1)).toEqual(['consent', 'revoke']);
    expect(window.oaiq?.q.at(-1)).toEqual(['consent', false]);
    expect(metaEvents()).toHaveLength(1);
    history.replaceState({}, '', '/subscribe');
    pageAllowed = true;
    sync();
    expect(metaEvents()).toHaveLength(2);
    expect(openaiEvents()).toHaveLength(2);
    expect(JSON.stringify([...metaEvents(), ...openaiEvents()])).not.toContain('private');
  });

  it.each(['/auth/callback?code=secret', '/signup?invitation=secret', '/signup#token=secret'])(
    'waits for a safe page after %s, retaining only consented milestones',
    (path) => {
      history.replaceState({}, '', path);
      consent = true;
      sync();
      pixels.recordAdPixelMilestone('af_complete_registration', 'signup-event');
      expect(window.fbq).toBeUndefined();
      expect(window.oaiq).toBeUndefined();
      history.replaceState({}, '', '/user-onboarding');
      sync();
      loaded();
      expect(metaEvents()).toContainEqual([
        'trackSingle',
        metaId,
        'CompleteRegistration',
        {},
        { eventID: 'signup-event' },
      ]);
      expect(JSON.stringify([...metaEvents(), ...openaiEvents()])).not.toContain('secret');
    }
  );

  it('keeps a broken provider from blocking the other provider or the application', () => {
    consent = true;
    sync();
    loaded();
    if (window.fbq)
      window.fbq.callMethod = () => {
        throw new Error('Blocked');
      };
    expect(() => pixels.recordAdPixelMilestone('af_complete_registration', 'signup-event')).not.toThrow();
    expect(openaiEvents()).toContainEqual([
      'measure',
      'registration_completed',
      { type: 'customer_action' },
      { event_id: 'signup-event' },
    ]);
  });

  it('can retry failed SDK downloads without replaying old events', () => {
    consent = true;
    sync();
    pixels.recordAdPixelMilestone('af_initiated_checkout', 'lost-event');
    for (const id of scriptIds) document.getElementById(id)?.dispatchEvent(new Event('error'));
    sync();
    loaded();
    expect(metaEvents()).toHaveLength(1);
    expect(openaiEvents()).toHaveLength(1);
  });
});
