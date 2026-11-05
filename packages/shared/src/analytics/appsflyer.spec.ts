import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSessionReplay } from './session-replay';
import { recordAdPixelMilestone, syncAdPixels } from './ad-pixels';

vi.mock('./session-replay', () => ({ syncSessionReplay: vi.fn() }));
vi.mock('./ad-pixels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ad-pixels')>()),
  syncAdPixels: vi.fn(),
  recordAdPixelMilestone: vi.fn(),
}));

let measurement: typeof import('./appsflyer');
const sdkSelector = '#kualia-appsflyer';
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.body.innerHTML = '';
  document.querySelector(sdkSelector)?.remove();
  document.cookie = 'kualia_measurement_choice=; Path=/; Domain=kualia.com; Max-Age=0';
  document.cookie = 'kualia_measurement_choice_v2=; Path=/; Domain=kualia.com; Max-Age=0';
  history.replaceState({}, '', '/?utm_source=facebook&invitation=private');
  sessionStorage.clear();
  vi.stubGlobal('AF', undefined);
  vi.stubGlobal('AF_SDK', undefined);
  vi.stubGlobal('AppsFlyerSdkObject', undefined);
  measurement = await import('./appsflyer');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function finishLoading() {
  const plugin = { enableMeasurement: vi.fn(), disableMeasurement: vi.fn() };
  window.AF_SDK = { PLUGINS: { PBA: plugin } };
  document.querySelector(sdkSelector)?.dispatchEvent(new Event('load'));
  return plugin;
}

describe('AppsFlyer web consent and event boundary', () => {
  it('does not load or queue events before opt-in, and decline leaves the app usable', () => {
    measurement.initializeWebMeasurement();
    measurement.recordWebMilestone('af_complete_registration', 'signup');
    expect(window.AF).toBeUndefined();
    expect(document.querySelector(sdkSelector)).toBeNull();
    expect(document.getElementById('kualia-measurement-dialog')).not.toBeNull();
    measurement.setWebMeasurementChoice('decline');
    expect(document.getElementById('kualia-measurement-dialog')?.style.opacity).toBe('0');
    vi.advanceTimersByTime(200);
    expect(document.getElementById('kualia-measurement-dialog')).toBeNull();
    expect(document.getElementById('kualia-measurement-preferences')).toBeNull();
    expect(window.AF).toBeUndefined();
  });

  it.each(['/signup', '/kualia/workspace/transactions'])(
    'does not add a floating privacy control on the web app at %s',
    (path) => {
      vi.stubGlobal('location', new URL(path, 'https://app.kualia.com'));
      document.cookie = 'kualia_measurement_choice_v2=decline; Path=/; Domain=kualia.com';
      measurement.initializeWebMeasurement();
      expect(document.querySelector('[data-measurement-preferences]')).toBeNull();
      expect(document.getElementById('kualia-measurement-dialog')).toBeNull();
    }
  );

  it('loads once with measurement off, enables only after readiness, and sends deduplicated sparse events', () => {
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('allow');
    measurement.recordWebMilestone('af_complete_registration', 'private-session');
    measurement.recordWebMilestone('af_complete_registration', 'private-session');
    expect(window.AF?.id.pba.measurementStatus).toBe(false);
    expect(window.AF?.q).toEqual([]);
    const plugin = finishLoading();
    expect(plugin.enableMeasurement).toHaveBeenCalled();
    expect(document.querySelectorAll(sdkSelector)).toHaveLength(1);
    expect(window.AF?.q).toHaveLength(1);
    const event = window.AF?.q[0]?.[3];
    expect(event).toMatchObject({ eventName: 'af_complete_registration', eventType: 'EVENT' });
    expect(Object.keys(event?.eventValue ?? {})).toEqual(['af_customer_event_id']);
    expect(JSON.stringify(event)).not.toContain('private-session');
    expect(recordAdPixelMilestone).toHaveBeenCalledExactlyOnceWith(
      'af_complete_registration',
      event?.eventValue.af_customer_event_id
    );
    expect(new URL(location.href).searchParams.get('af_url_mask')).toBe('invitation');
  });

  it('drops pending events if consent is revoked while the script is downloading', () => {
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('allow');
    measurement.recordWebMilestone('af_tutorial_completion');
    measurement.setWebMeasurementChoice('decline');
    const plugin = finishLoading();
    expect(plugin.enableMeasurement).not.toHaveBeenCalled();
    expect(plugin.disableMeasurement).toHaveBeenCalled();
    measurement.recordWebMilestone('af_initiated_checkout');
    expect(window.AF?.q).toEqual([]);
  });

  it.each([{ globalPrivacyControl: true }, { doNotTrack: '1' }, { doNotTrack: 'yes' }])(
    'honors the browser opt-out %o even after an earlier opt-in',
    (privacy) => {
      document.cookie = 'kualia_measurement_choice_v2=allow; Path=/; Domain=kualia.com';
      vi.stubGlobal('navigator', privacy);
      measurement.initializeWebMeasurement();
      measurement.setWebMeasurementChoice('allow');
      expect(window.AF).toBeUndefined();
    }
  );

  it('disables measurement before SPA navigation and excludes private workspace routes', () => {
    vi.stubGlobal('location', new URL('https://app.kualia.com/signup'));
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('allow');
    const plugin = finishLoading();
    plugin.enableMeasurement.mockClear();
    measurement.pauseWebMeasurement();
    expect(plugin.disableMeasurement).toHaveBeenCalled();
    vi.stubGlobal('location', new URL('https://app.kualia.com/private-workspace/transactions?search=medical'));
    measurement.resumeWebMeasurement();
    measurement.recordWebMilestone('af_complete_registration');
    expect(plugin.enableMeasurement).not.toHaveBeenCalled();
    expect(window.AF?.q).toEqual([]);
  });

  it('preserves pixel attribution during public navigation but revokes before private or auth URLs', () => {
    vi.stubGlobal('location', new URL('https://app.kualia.com/signup'));
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('allow');
    measurement.pauseWebMeasurement('/user-onboarding');
    expect(measurement.canMeasureWeb()).toBe(false);
    expect(vi.mocked(syncAdPixels).mock.lastCall?.[1]()).toBe(true);
    for (const destination of ['/auth/callback?code=secret', '/subscribe?email=private', '/workspace/transactions']) {
      measurement.pauseWebMeasurement(destination);
      expect(vi.mocked(syncAdPixels).mock.lastCall?.[1]()).toBe(false);
    }
  });

  it('cannot interrupt signup when the SDK throws', () => {
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('allow');
    const plugin = finishLoading();
    plugin.enableMeasurement.mockImplementation(() => {
      throw new Error('SDK unavailable');
    });
    expect(() => measurement.recordWebMilestone('af_complete_registration')).not.toThrow();
  });

  it('does not send events from development or preview hosts', () => {
    vi.stubGlobal('location', new URL('https://preview.example.com'));
    document.body.innerHTML = '<footer><a href="/privacy" data-measurement-preferences>Privacy choices</a></footer>';
    measurement.initializeWebMeasurement();
    expect(document.getElementById('kualia-measurement-dialog')).not.toBeNull();
    measurement.setWebMeasurementChoice('allow');
    vi.advanceTimersByTime(200);
    document.querySelector<HTMLAnchorElement>('[data-measurement-preferences]')?.click();
    expect(document.getElementById('kualia-measurement-dialog')).not.toBeNull();
    measurement.recordWebMilestone('af_complete_registration');
    expect(window.AF).toBeUndefined();
    expect(vi.mocked(syncSessionReplay).mock.lastCall?.[0]()).toBe(false);
    expect(vi.mocked(syncAdPixels).mock.lastCall?.[0]()).toBe(false);
  });

  it.each(['Accept', 'Deny Non-Essential'])('saves %s immediately, then fades the banner out', (label) => {
    measurement.initializeWebMeasurement();
    const panel = document.getElementById('kualia-measurement-dialog');
    const button = [...(panel?.querySelectorAll('button') ?? [])].find((item) => item.textContent === label);
    button?.click();
    expect(document.cookie).toContain(`kualia_measurement_choice_v2=${label === 'Accept' ? 'allow' : 'decline'}`);
    expect(panel?.inert).toBe(true);
    expect(panel?.style.opacity).toBe('0');
    expect(panel?.isConnected).toBe(true);
    vi.advanceTimersByTime(200);
    expect(panel?.isConnected).toBe(false);
  });

  it('uses the footer control instead of a floating badge and lets visitors change their choice', () => {
    document.body.innerHTML = '<footer><a href="/privacy" data-measurement-preferences>Privacy choices</a></footer>';
    measurement.initializeWebMeasurement();
    expect(document.getElementById('kualia-measurement-preferences')).toBeNull();
    measurement.setWebMeasurementChoice('allow');
    vi.advanceTimersByTime(200);
    const footer = document.querySelector<HTMLAnchorElement>('[data-measurement-preferences]');
    footer?.click();
    expect(footer?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Accept');
    const panel = document.getElementById('kualia-measurement-dialog');
    panel?.querySelectorAll('button')[1]?.click();
    expect(document.cookie).toContain('kualia_measurement_choice_v2=decline');
    expect(footer?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(footer);
    expect(vi.mocked(syncSessionReplay).mock.lastCall?.[0]()).toBe(false);
    expect(vi.mocked(syncAdPixels).mock.lastCall?.[0]()).toBe(false);
    vi.advanceTimersByTime(200);
    expect(panel?.isConnected).toBe(false);
  });

  it('removes the banner immediately when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('decline');
    expect(document.getElementById('kualia-measurement-dialog')).toBeNull();
  });

  it('keeps a reopened banner when the previous dismissal timer would have expired', () => {
    document.body.innerHTML = '<footer><a href="/privacy" data-measurement-preferences>Privacy choices</a></footer>';
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('decline');
    document.querySelector<HTMLAnchorElement>('[data-measurement-preferences]')?.click();
    vi.advanceTimersByTime(200);
    const panel = document.getElementById('kualia-measurement-dialog');
    expect(panel).not.toBeNull();
    expect(panel?.inert).not.toBe(true);
  });

  it('asks for fresh consent when an earlier choice only allowed advertising measurement', () => {
    document.cookie = 'kualia_measurement_choice=allow; Path=/; Domain=kualia.com';
    measurement.initializeWebMeasurement();
    expect(document.getElementById('kualia-measurement-dialog')).not.toBeNull();
    expect(window.AF).toBeUndefined();
    expect(vi.mocked(syncSessionReplay).mock.lastCall?.[0]()).toBe(false);
  });

  it('remembers refusals and keeps a valid current choice across reloads', async () => {
    document.cookie = 'kualia_measurement_choice=decline; Path=/; Domain=kualia.com';
    measurement.initializeWebMeasurement();
    expect(document.getElementById('kualia-measurement-dialog')).toBeNull();
    measurement.setWebMeasurementChoice('allow');
    document.body.innerHTML = '';
    vi.resetModules();
    const reloaded = await import('./appsflyer');
    reloaded.initializeWebMeasurement();
    expect(document.getElementById('kualia-measurement-dialog')).toBeNull();
    expect(reloaded.canMeasureWeb()).toBe(true);
  });

  it('stops replay when another page changes the shared choice', () => {
    measurement.initializeWebMeasurement();
    measurement.setWebMeasurementChoice('allow');
    expect(vi.mocked(syncSessionReplay).mock.lastCall?.[0]()).toBe(true);
    document.cookie = 'kualia_measurement_choice_v2=decline; Path=/; Domain=kualia.com';
    window.dispatchEvent(new Event('focus'));
    expect(vi.mocked(syncSessionReplay).mock.lastCall?.[0]()).toBe(false);
  });
});
