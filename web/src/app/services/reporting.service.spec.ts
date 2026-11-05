import posthog from 'posthog-js';
import { initializeWebMeasurement, recordWebMilestone } from '@kualia/shared/analytics/appsflyer';
vi.mock('@kualia/shared/analytics/appsflyer', () => ({
  initializeWebMeasurement: vi.fn(),
  recordWebMilestone: vi.fn(),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportingService, TrackingEvent } from './reporting.service';
import { environment } from '../../environments/environment';

vi.mock('../../environments/environment', () => ({
  environment: { production: true, posthog: { apiKey: 'phc_test', apiHost: '/ingest' } },
}));

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    setPersonProperties: vi.fn(),
    group: vi.fn(),
    reloadFeatureFlags: vi.fn(),
    isFeatureEnabled: vi.fn(),
    getFeatureFlag: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  environment.production = true;
  history.replaceState(
    { preserved: true },
    '',
    '/?utm_source=chatgpt&utm_content=family_sharing&ph_distinct_id=visitor#start'
  );
});

describe('ReportingService browser analytics', () => {
  it('initializes PostHog once through the same-origin proxy while preserving visitor identity', () => {
    document.cookie = 'kualia_campaign=old-campaign; Path=/';
    document.cookie = 'kualia_ad_measurement_v2=granted; Path=/';
    document.cookie = '_fbp=current; Path=/';
    localStorage.setItem('ph_phc_old_posthog', 'visitor');
    const reporting = new ReportingService();
    reporting.init();
    reporting.init();
    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        capture_pageview: 'history_change',
        disable_session_recording: true,
        autocapture: false,
      })
    );
    expect(document.cookie).not.toContain('kualia_campaign');
    expect(document.cookie).not.toContain('kualia_ad_');
    expect(document.cookie).toContain('_fbp=current');
    expect(location.search).toBe('?utm_source=chatgpt&utm_content=family_sharing');
    expect(initializeWebMeasurement).toHaveBeenCalled();
    expect(localStorage.getItem('ph_phc_old_posthog')).toBe('visitor');
    expect(history.state).toEqual({ preserved: true });
    expect(location.href).not.toContain('ph_distinct_id');
    expect(location.hash).toBe('#start');
  });

  it('captures product events with safe metadata and keeps advertising milestones separate', () => {
    const reporting = new ReportingService();
    reporting.init();
    reporting.identify('test-user', { email: 'person@example.com' });
    reporting.capture(TrackingEvent.ONBOARDING_COMPLETED, { platform: 'web' });
    reporting.capture(TrackingEvent.TRANSACTION_CREATED, { amount: 200, merchant: 'Private' });
    reporting.capture(TrackingEvent.AI_CHAT_MESSAGE_SENT, { content: 'Private chat' });
    reporting.recordSignup('session-1');
    expect(posthog.identify).toHaveBeenCalledWith('test-user', {});
    expect(posthog.capture).toHaveBeenCalledWith(TrackingEvent.ONBOARDING_COMPLETED, { platform: 'web' });
    expect(posthog.capture).toHaveBeenCalledWith(TrackingEvent.TRANSACTION_CREATED, {});
    expect(posthog.capture).toHaveBeenCalledWith(TrackingEvent.AI_CHAT_MESSAGE_SENT, {});
    expect(recordWebMilestone).toHaveBeenCalledTimes(2);
    expect(recordWebMilestone).toHaveBeenCalledWith('af_tutorial_completion', 'onboarding');
    expect(recordWebMilestone).toHaveBeenCalledWith('af_complete_registration', 'session-1');
    reporting.setPersonProperties({ email: 'person@example.com' });
    reporting.group('workspace', 'workspace-1');
    reporting.reset();
    reporting.reloadFeatureFlags();
    expect(reporting.isFeatureEnabled('feature')).toBe(false);
    expect(reporting.getFeatureFlag('feature')).toBeUndefined();
    expect(posthog.setPersonProperties).toHaveBeenCalledWith({});
    expect(posthog.group).toHaveBeenCalledWith('workspace', 'workspace-1', {});
    expect(posthog.reset).toHaveBeenCalledOnce();
    expect(posthog.reloadFeatureFlags).toHaveBeenCalledOnce();
  });

  it('reads feature flags when initialized and keeps local development disabled', () => {
    const reporting = new ReportingService();
    expect(reporting.isFeatureEnabled('feature')).toBe(false);
    reporting.init();
    vi.mocked(posthog.isFeatureEnabled).mockReturnValue(true);
    vi.mocked(posthog.getFeatureFlag).mockReturnValue('variant-a');
    expect(reporting.isFeatureEnabled('feature')).toBe(true);
    expect(reporting.getFeatureFlag('feature')).toBe('variant-a');

    vi.clearAllMocks();
    environment.production = false;
    const local = new ReportingService();
    local.init();
    local.capture(TrackingEvent.SIGNED_IN);
    local.identify('user');
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});
