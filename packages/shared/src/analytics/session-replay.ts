import type { PostHog } from 'posthog-js';
import { POSTHOG_API_KEY, POSTHOG_PROXY_PATH } from './telemetry-config';

let client: PostHog | undefined;
let loading: Promise<void> | undefined;
let recording = false;

function applyChoice(isAllowed: () => boolean): void {
  if (!client) return;
  if (isAllowed()) {
    if (recording) return;
    client.opt_in_capturing({ captureEventName: false });
    client.startSessionRecording();
    recording = true;
  } else {
    client.opt_out_capturing();
    client.stopSessionRecording();
    recording = false;
  }
}

function safePageUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.origin + (url.hostname === 'app.kualia.com' ? '/app' : url.pathname);
  } catch (error: unknown) {
    void error;
    return '';
  }
}

/** Load only after consent, and recheck it when the asynchronous import completes. */
export async function syncSessionReplay(isAllowed: () => boolean): Promise<void> {
  try {
    if (client) {
      applyChoice(isAllowed);
      return;
    }
    if (!isAllowed()) return;
    loading ??= import('posthog-js')
      .then(({ default: posthog }) => {
        if (!isAllowed()) return;
        // Replay must not reconfigure the product analytics client or share its opt-out storage.
        client = posthog.init(
          POSTHOG_API_KEY,
          {
            api_host: POSTHOG_PROXY_PATH,
            ui_host: 'https://us.posthog.com',
            persistence_name: 'kualia_replay',
            consent_persistence_name: 'kualia_replay_consent',
            cookie_expiration: 180,
            person_profiles: 'never',
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            capture_dead_clicks: false,
            capture_exceptions: false,
            capture_performance: false,
            rageclick: false,
            disable_surveys: true,
            enable_recording_console_log: false,
            disable_session_recording: true,
            opt_out_capturing_by_default: true,
            opt_out_persistence_by_default: true,
            ip: false,
            session_recording: {
              maskAllInputs: true,
              maskTextSelector: location.hostname === 'app.kualia.com' ? '*' : undefined,
              blockSelector:
                '.ph-no-capture, [data-private], input, textarea, select, [contenteditable], iframe, canvas, img, video, audio, svg',
              recordCrossOriginIframes: false,
              recordHeaders: false,
              recordBody: false,
              captureCanvas: { recordCanvas: false },
              maskCapturedNetworkRequestFn: () => null,
              // This SDK hook also redacts the page URL stored in replay metadata.
              maskNetworkRequestFn: (request) => ({ ...request, url: safePageUrl(request.url) }),
            },
            before_send: (event) => {
              if (!event || !isAllowed()) return null;
              for (const key of Object.keys(event.properties)) {
                if (/url|referrer|pathname|\$initial_|\$set/.test(key)) delete event.properties[key];
              }
              return event;
            },
            loaded: () => applyChoice(isAllowed),
          },
          'kualiaReplay'
        );
      })
      .finally(() => {
        loading = undefined;
      });
    await loading;
    applyChoice(isAllowed);
  } catch (error: unknown) {
    // Tracking must never interrupt signup, navigation, or privacy controls.
    void error;
  }
}
