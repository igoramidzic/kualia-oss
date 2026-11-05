import type { MeasurementEvent } from './appsflyer';

// Public pixel IDs from Kualia's existing advertising accounts.
const META_PIXEL_ID = '1646871749572056';
const OPENAI_PIXEL_ID = 'A5ePqjBz2Ly985CQJWAtdt';
type MetaCommand =
  | ['consent', 'grant' | 'revoke']
  | ['set', 'autoConfig', false, string]
  | ['init', string]
  | ['trackSingle' | 'trackSingleCustom', string, string, Record<string, never>, { eventID: string }];
type OpenAICommand =
  | ['consent', boolean]
  | ['init', { pixelId: string }]
  | [
      'measure',
      string,
      { type: 'contents' | 'customer_action' | 'custom' },
      { event_id: string; custom_event_name?: string },
    ];
interface MetaPixel {
  (...args: MetaCommand): void;
  callMethod?: (...args: MetaCommand) => void;
  queue: MetaCommand[];
  push: MetaPixel;
  loaded: boolean;
  version: string;
  disablePushState: boolean;
}
interface OpenAIPixel {
  (...args: OpenAICommand): void;
  q: OpenAICommand[];
}
declare global {
  interface Window {
    fbq?: MetaPixel;
    _fbq?: MetaPixel;
    oaiq?: OpenAIPixel;
  }
}
interface PixelState {
  ready: boolean;
  initialized: boolean;
  allowed: boolean;
  page?: string;
  pending: { name: MeasurementEvent; id: string }[];
}
const meta: PixelState = { ready: false, initialized: false, allowed: false, pending: [] };
const openai: PixelState = { ready: false, initialized: false, allowed: false, pending: [] };
let consentAllowed = (): boolean => false;
let pageAllowed = (): boolean => false;

/** Pixels read the current URL themselves. Never initialize or emit on auth callback/secret-bearing URLs. */
export function isSafePixelUrl(url: URL): boolean {
  if (url.hash || url.pathname.replace(/\/$/, '') === '/auth/callback') return false;
  return [...url.searchParams.keys()].every((key) =>
    /^(utm_(source|medium|campaign|content|term)|fbclid|gclid|msclkid|oppref|af_url|af_url_mask)$/i.test(key)
  );
}
function safePage(): boolean {
  return pageAllowed() && isSafePixelUrl(new URL(location.href));
}

function clearPixelCookies(): void {
  for (const name of ['_fbp', '_fbc', '__oppref', '__obref']) {
    for (const domain of ['', `; Domain=${location.hostname}`, '; Domain=kualia.com']) {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${domain}`;
    }
  }
}

function loadScript(id: string, src: string, state: PixelState, apply: () => void): void {
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.src = src;
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.onload = () => {
    state.ready = true;
    safely(apply);
  };
  script.onerror = () => {
    state.pending.length = 0;
    script.remove();
  };
  document.head.append(script);
}

function safely(action: () => void): void {
  try {
    action();
  } catch (error: unknown) {
    // Blockers and SDK failures must not affect signup, navigation or the other providers.
    void error;
  }
}

function prepareMeta(): void {
  if (!window.fbq) {
    const fbq = ((...args: MetaCommand): void => {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    }) as MetaPixel;
    Object.assign(fbq, { queue: [], push: fbq, loaded: true, version: '2.0', disablePushState: true });
    window.fbq = window._fbq = fbq;
    fbq('consent', 'revoke');
  }
  loadScript('kualia-meta-pixel', 'https://connect.facebook.net/en_US/fbevents.js', meta, applyMeta);
}

function prepareOpenAI(): void {
  if (!window.oaiq) {
    const q: OpenAICommand[] = [];
    window.oaiq = Object.assign(
      (...args: OpenAICommand): void => {
        q.push(args);
      },
      { q }
    );
    // Keep the SDK queue empty until onload rechecks our consent. Queuing false here
    // would erase the shared click/browser cookies on every opted-in page load.
  }
  loadScript('kualia-openai-pixel', 'https://bzrcdn.openai.com/sdk/oaiq.min.js', openai, applyOpenAI);
}

function applyMeta(): void {
  if (!meta.ready) return;
  const allowed = consentAllowed() && safePage();
  if (allowed && !meta.initialized) {
    window.fbq?.('set', 'autoConfig', false, META_PIXEL_ID);
    window.fbq?.('init', META_PIXEL_ID);
    meta.initialized = true;
  }
  if (meta.allowed !== allowed) window.fbq?.('consent', allowed ? 'grant' : 'revoke');
  meta.allowed = allowed;
  if (!allowed) return;
  const page = location.origin + location.pathname;
  if (meta.page !== page) {
    window.fbq?.('trackSingle', META_PIXEL_ID, 'PageView', {}, { eventID: crypto.randomUUID() });
    meta.page = page;
  }
  for (const event of meta.pending.splice(0)) {
    const name =
      event.name === 'af_complete_registration'
        ? 'CompleteRegistration'
        : event.name === 'af_initiated_checkout'
          ? 'InitiateCheckout'
          : 'CompleteTutorial';
    window.fbq?.(
      event.name === 'af_tutorial_completion' ? 'trackSingleCustom' : 'trackSingle',
      META_PIXEL_ID,
      name,
      {},
      { eventID: event.id }
    );
  }
}

function applyOpenAI(): void {
  if (!openai.ready) return;
  const allowed = consentAllowed() && safePage();
  if (allowed && !openai.initialized) {
    window.oaiq?.('consent', true);
    window.oaiq?.('init', { pixelId: OPENAI_PIXEL_ID });
    openai.initialized = true;
    openai.allowed = true;
  }
  if (openai.allowed !== allowed) window.oaiq?.('consent', allowed);
  openai.allowed = allowed;
  if (!allowed) return;
  const page = location.origin + location.pathname;
  if (openai.page !== page) {
    window.oaiq?.('measure', 'page_viewed', { type: 'contents' }, { event_id: crypto.randomUUID() });
    openai.page = page;
  }
  for (const event of openai.pending.splice(0)) {
    if (event.name === 'af_tutorial_completion') {
      window.oaiq?.(
        'measure',
        'custom',
        { type: 'custom' },
        { event_id: event.id, custom_event_name: 'onboarding_completed' }
      );
    } else {
      window.oaiq?.(
        'measure',
        event.name === 'af_complete_registration' ? 'registration_completed' : 'checkout_started',
        { type: event.name === 'af_complete_registration' ? 'customer_action' : 'contents' },
        { event_id: event.id }
      );
    }
  }
}

/** No SDK download before consent. Recheck consent and route when each asynchronous download finishes. */
export function syncAdPixels(isConsented: () => boolean, isPageAllowed: () => boolean): void {
  consentAllowed = isConsented;
  pageAllowed = isPageAllowed;
  if (!consentAllowed()) {
    meta.pending.length = openai.pending.length = 0;
    meta.page = openai.page = undefined;
  }
  safely(() => {
    if (consentAllowed() && safePage()) prepareMeta();
    applyMeta();
  });
  safely(() => {
    if (consentAllowed() && safePage()) prepareOpenAI();
    applyOpenAI();
  });
  if (!consentAllowed()) safely(clearPixelCookies);
}

/** Event IDs are shared with AppsFlyer; account IDs and event properties never enter pixel payloads. */
export function recordAdPixelMilestone(name: MeasurementEvent, id: string): void {
  if (!consentAllowed() || !pageAllowed()) return;
  meta.pending.push({ name, id });
  openai.pending.push({ name, id });
  syncAdPixels(consentAllowed, pageAllowed);
}
