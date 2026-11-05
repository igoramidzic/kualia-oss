import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogConfig } from 'posthog-js';
import { POSTHOG_API_KEY, POSTHOG_PROXY_PATH } from './telemetry-config';

const sdk = vi.hoisted(() => ({
  init: vi.fn<(token: string, options: Partial<PostHogConfig>, name?: string) => unknown>(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));
vi.mock('posthog-js', () => ({ default: sdk }));
let replay: typeof import('./session-replay');

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  sdk.init.mockReturnValue(sdk);
  replay = await import('./session-replay');
});

describe('consented PostHog session replay', () => {
  it('never initializes before permission or after a refusal while the SDK is loading', async () => {
    await replay.syncSessionReplay(() => false);
    expect(sdk.init).not.toHaveBeenCalled();
    let allowed = true;
    const pending = replay.syncSessionReplay(() => allowed);
    allowed = false;
    await pending;
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('starts once after permission and stops immediately when permission is withdrawn', async () => {
    await replay.syncSessionReplay(() => true);
    await replay.syncSessionReplay(() => true);
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.init).toHaveBeenCalledWith(
      POSTHOG_API_KEY,
      expect.objectContaining({
        api_host: POSTHOG_PROXY_PATH,
        persistence_name: 'kualia_replay',
        consent_persistence_name: 'kualia_replay_consent',
      }),
      'kualiaReplay'
    );
    expect(sdk.startSessionRecording).toHaveBeenCalledOnce();
    const stopped = replay.syncSessionReplay(() => false);
    expect(sdk.stopSessionRecording).toHaveBeenCalledOnce();
    expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
    await stopped;
    await replay.syncSessionReplay(() => true);
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.startSessionRecording).toHaveBeenCalledTimes(2);
  });

  it('masks inputs and private app text and excludes network, console, and identity capture', async () => {
    vi.stubGlobal('location', new URL('https://app.kualia.com/private-workspace/transactions?search=medical'));
    await replay.syncSessionReplay(() => true);
    const config = sdk.init.mock.calls[0]?.[1];
    expect(config).toMatchObject({
      person_profiles: 'never',
      autocapture: false,
      capture_pageview: false,
      enable_recording_console_log: false,
      capture_performance: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
        recordHeaders: false,
        recordBody: false,
        captureCanvas: { recordCanvas: false },
      },
    });
    expect(config?.session_recording?.maskNetworkRequestFn?.({ url: location.href })).toEqual({
      url: 'https://app.kualia.com/app',
    });
    expect(
      config?.session_recording?.maskNetworkRequestFn?.({ url: 'https://kualia.com/?email=private#secret' })
    ).toEqual({
      url: 'https://kualia.com/',
    });
    expect(config?.session_recording?.blockSelector).toContain('input');
    expect(config?.session_recording?.blockSelector).toContain('[contenteditable]');
  });

  it('keeps public site copy visible while blocking form fields', async () => {
    await replay.syncSessionReplay(() => true);
    const config = sdk.init.mock.calls[0]?.[1];
    expect(config?.session_recording?.maskTextSelector).toBeUndefined();
    expect(config?.session_recording?.maskAllInputs).toBe(true);
    expect(config?.session_recording?.blockSelector).toContain('textarea');
  });

  it('redacts event URLs and drops buffered events after consent is withdrawn', async () => {
    let allowed = true;
    await replay.syncSessionReplay(() => allowed);
    const beforeSend = sdk.init.mock.calls[0]?.[1].before_send;
    if (typeof beforeSend !== 'function') throw new Error('Missing replay consent guard');
    const event = {
      uuid: 'test-event',
      event: '$snapshot',
      properties: {
        $current_url: 'https://app.kualia.com/private?token=secret',
        $referrer: 'https://kualia.com/?email=private',
        $pathname: '/private-workspace/transactions',
        $session_id: 'random-session',
      },
    };
    expect(beforeSend(event)?.properties).toEqual({ $session_id: 'random-session' });
    allowed = false;
    expect(beforeSend(event)).toBeNull();
    expect(beforeSend(null)).toBeNull();
  });

  it('does not break the page if initialization fails and can retry later', async () => {
    sdk.init.mockImplementationOnce(() => {
      throw new Error('Blocked');
    });
    await expect(replay.syncSessionReplay(() => true)).resolves.toBeUndefined();
    await replay.syncSessionReplay(() => true);
    expect(sdk.startSessionRecording).toHaveBeenCalledOnce();
  });
});
