import { syncSessionReplay } from './session-replay';
import { isSafePixelUrl, recordAdPixelMilestone, syncAdPixels } from './ad-pixels';

/** AppsFlyer's public web SDK ID, shared by the marketing site and web app. */
const WEB_APP_ID = 'd6c83fad-2149-466f-9919-c3e4ef0343ac';
// A previous ad-only opt-in does not authorize newly restored session replay.
const CONSENT_COOKIE = 'kualia_measurement_choice_v2';
const SCRIPT_ID = 'kualia-appsflyer';
const DISMISS_DURATION = 200;
export type MeasurementEvent = 'af_complete_registration' | 'af_tutorial_completion' | 'af_initiated_checkout';
type Command = [
  'pba',
  'event',
  {
    eventType: 'EVENT';
    eventName: MeasurementEvent;
    eventValue: { af_customer_event_id: string };
  },
];
interface AppsFlyerQueue {
  (...args: Command): void;
  q: [number, ...Command][];
  id: { pba: { webAppId: string; measurementStatus: boolean } };
  plugins: Record<string, never>;
}
declare global {
  interface Window {
    AppsFlyerSdkObject?: string;
    AF?: AppsFlyerQueue;
    AF_SDK?: { PLUGINS?: { PBA?: { enableMeasurement(): void; disableMeasurement(): void } } };
  }
}
let choice: 'allow' | 'decline' | undefined;
let initialized = false;
const recorded = new Set<string>();
const pendingEvents: Command[] = [];
let sdkReady = false;
let navigating = false;
let publicPixelNavigation = false;
let dismissTimer: number | undefined;
let preferencesTrigger: HTMLElement | undefined;

function applyMeasurementChoice(): void {
  void syncSessionReplay(canUseOptionalTracking);
  syncAdPixels(canUseOptionalTracking, () => canMeasureWeb() || (publicPixelNavigation && canUseOptionalTracking()));
  try {
    applyReadyMeasurementChoice();
  } catch (error: unknown) {
    void error;
  }
}

function applyReadyMeasurementChoice(): void {
  const plugin = window.AF_SDK?.PLUGINS?.PBA;
  if (!plugin) return;
  if (canMeasureWeb()) {
    plugin.enableMeasurement();
    for (const command of pendingEvents.splice(0)) window.AF?.(...command);
  } else {
    pendingEvents.length = 0;
    plugin.disableMeasurement();
  }
}

function productionHost(): boolean {
  return (
    location.protocol === 'https:' && ['kualia.com', 'www.kualia.com', 'app.kualia.com'].includes(location.hostname)
  );
}
function privacySignal(): boolean {
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ||
    navigator.doNotTrack === '1' ||
    navigator.doNotTrack === 'yes'
  );
}
function readChoice(): typeof choice {
  try {
    const value = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
      ?.split('=')[1];
    if (value === 'allow' || value === 'decline') return value;
    // Keep earlier refusals without asking visitors to decline again.
    return document.cookie.split(';').some((part) => part.trim() === 'kualia_measurement_choice=decline')
      ? 'decline'
      : undefined;
  } catch (error: unknown) {
    void error;
    return undefined;
  }
}
function canUseOptionalTracking(): boolean {
  return productionHost() && !privacySignal() && choice === 'allow' && readChoice() === 'allow';
}
export function canMeasureWeb(): boolean {
  return !navigating && isPublicAppPage(new URL(location.href)) && canUseOptionalTracking();
}
function isPublicAppPage(url: URL): boolean {
  return (
    url.hostname !== 'app.kualia.com' ||
    ['/login', '/signup', '/auth/callback', '/user-onboarding', '/subscribe'].includes(url.pathname.replace(/\/$/, ''))
  );
}

function loadSDK(): void {
  if (!canMeasureWeb()) return;
  if (document.getElementById(SCRIPT_ID)) {
    if (sdkReady) applyMeasurementChoice();
    return;
  }
  const q: AppsFlyerQueue['q'] = [];
  const af: AppsFlyerQueue = Object.assign(
    (...args: Command): void => {
      q.push([Date.now(), ...args]);
    },
    { q, id: { pba: { webAppId: WEB_APP_ID, measurementStatus: false } }, plugins: {} }
  );
  window.AppsFlyerSdkObject = 'AF';
  window.AF = af;
  // AppsFlyer strips URL queries from reports. On the app, exclude all query data;
  // on public pages retain only campaign fields, never auth codes or invitation data.
  const url = new URL(location.href);
  const campaign = /^(utm_(source|medium|campaign|content|term)|fbclid|gclid|msclkid|oppref)$/;
  if (location.hostname === 'app.kualia.com') url.searchParams.set('af_url', 'true');
  else {
    const masked = [...url.searchParams.keys()].filter((key) => !campaign.test(key));
    if (masked.length) url.searchParams.set('af_url_mask', masked.join(';'));
  }
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://websdk.appsflyersdk.com?st=pba&af_id=${WEB_APP_ID}`;
  script.onload = () => {
    let attempts = 0;
    const ready = (): void => {
      if (window.AF_SDK?.PLUGINS?.PBA) {
        sdkReady = true;
        applyMeasurementChoice();
      } else if (++attempts < 200) window.setTimeout(ready, 50);
    };
    ready();
  };
  document.head.append(script);
}

export function setWebMeasurementChoice(value: 'allow' | 'decline'): void {
  choice = privacySignal() ? 'decline' : value;
  try {
    const domain = productionHost() ? '; Domain=kualia.com' : '';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${choice}; Path=/; Max-Age=15552000; SameSite=Lax${domain}${secure}`;
  } catch (error: unknown) {
    void error;
  }
  applyMeasurementChoice();
  if (canMeasureWeb()) loadSDK();
  else {
    pendingEvents.length = 0;
  }
  dismissPreferences();
}

export function recordWebMilestone(eventName: MeasurementEvent, actionKey?: string): void {
  try {
    recordAllowedMilestone(eventName, actionKey);
  } catch (error: unknown) {
    void error;
  }
}

function recordAllowedMilestone(eventName: MeasurementEvent, actionKey?: string): void {
  if (!canMeasureWeb()) return;
  const key = actionKey ? `${eventName}:${actionKey}` : undefined;
  // Action keys stay in this browser and are never sent to measurement providers.
  if (key) {
    if (recorded.has(key)) return;
    try {
      if (sessionStorage.getItem(`af-recorded:${key}`)) return;
    } catch (error: unknown) {
      void error;
    }
    recorded.add(key);
    try {
      sessionStorage.setItem(`af-recorded:${key}`, '1');
    } catch (error: unknown) {
      void error;
    }
  }
  loadSDK();
  const eventId = crypto.randomUUID();
  recordAdPixelMilestone(eventName, eventId);
  pendingEvents.push([
    'pba',
    'event',
    { eventType: 'EVENT', eventName, eventValue: { af_customer_event_id: eventId } },
  ]);
  if (sdkReady) applyMeasurementChoice();
}

/** Disable before SPA navigation so private workspace URLs never become automatic page views. */
export function pauseWebMeasurement(nextUrl?: string): void {
  // OpenAI consent revocation deletes attribution cookies. Preserve consent only
  // while moving between known public pages, and revoke before entering private UI.
  const destination = nextUrl ? new URL(nextUrl, location.origin) : undefined;
  publicPixelNavigation =
    !!destination &&
    destination.origin === location.origin &&
    isPublicAppPage(new URL(location.href)) &&
    isPublicAppPage(destination) &&
    isSafePixelUrl(destination);
  navigating = true;
  applyMeasurementChoice();
}

export function resumeWebMeasurement(): void {
  navigating = false;
  publicPixelNavigation = false;
  choice = readChoice();
  applyMeasurementChoice();
  if (canMeasureWeb()) loadSDK();
}

function dismissPreferences(): void {
  const panel = document.getElementById('kualia-measurement-dialog');
  if (!panel) return;
  window.clearTimeout(dismissTimer);
  if (panel.contains(document.activeElement)) preferencesTrigger?.focus({ preventScroll: true });
  preferencesTrigger?.setAttribute('aria-expanded', 'false');
  panel.inert = true;
  panel.style.opacity = '0';
  panel.style.pointerEvents = 'none';
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) panel.remove();
  else dismissTimer = window.setTimeout(() => panel.remove(), DISMISS_DURATION);
}

function showPreferences(trigger?: HTMLElement): void {
  const existing = document.getElementById('kualia-measurement-dialog');
  if (existing && !existing.inert) return;
  window.clearTimeout(dismissTimer);
  existing?.remove();
  preferencesTrigger = trigger ?? document.querySelector<HTMLElement>('[data-measurement-preferences]') ?? undefined;
  preferencesTrigger?.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('section');
  panel.id = 'kualia-measurement-dialog';
  panel.setAttribute('aria-label', 'Cookie preferences');
  panel.style.cssText = `position:fixed;bottom:8px;left:8px;right:8px;z-index:10000;display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;padding:12px 18px;padding-bottom:max(12px,env(safe-area-inset-bottom));border:1px solid #ddd;border-radius:12px;background:#fff;color:#333;box-shadow:0 2px 12px #0001;font:14px/1.5 system-ui;transition:opacity ${DISMISS_DURATION}ms ease;opacity:1`;
  const message = document.createElement('p');
  message.style.cssText = 'flex:1 1 480px;margin:0';
  message.textContent = privacySignal()
    ? 'Your browser has requested no tracking. Optional analytics, session replay, and advertising measurement are off.'
    : 'This site uses cookies for essential functionality, analytics (including masked session replay), and advertising measurement with analytics and advertising partners. Financial records and chat content are never shared for advertising.';
  panel.append(message);
  const link = document.createElement('a');
  link.href = 'https://kualia.com/privacy#ad-measurement';
  link.textContent = 'Privacy Policy';
  link.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px;white-space:nowrap';
  message.append(' ', link);
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center';
  for (const value of privacySignal() ? (['decline'] as const) : (['allow', 'decline'] as const)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = privacySignal() ? 'Got it' : value === 'allow' ? 'Accept' : 'Deny Non-Essential';
    button.style.cssText =
      'min-height:44px;padding:8px 16px;border:1px solid #ccc;border-radius:999px;background:#fff;color:#333;font:inherit;font-weight:600;cursor:pointer';
    button.addEventListener('click', () => setWebMeasurementChoice(value));
    actions.append(button);
  }
  panel.append(actions);
  document.body.append(panel);
  if (trigger) actions.querySelector('button')?.focus({ preventScroll: true });
}

/** No SDK request, cookies or event queue before opt-in. */
export function initializeWebMeasurement(): void {
  if (initialized) return;
  initialized = true;
  choice = readChoice();
  const render = (): void => {
    for (const preferences of document.querySelectorAll<HTMLElement>('[data-measurement-preferences]')) {
      preferences.setAttribute('aria-controls', 'kualia-measurement-dialog');
      preferences.setAttribute('aria-expanded', 'false');
      preferences.addEventListener('click', (event) => {
        event.preventDefault();
        showPreferences(preferences);
      });
    }
    if (!choice && !privacySignal()) showPreferences();
  };
  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render, { once: true });
  applyMeasurementChoice();
  if (canMeasureWeb()) loadSDK();
  window.addEventListener('focus', () => {
    choice = readChoice();
    applyMeasurementChoice();
    if (canMeasureWeb()) loadSDK();
  });
}
