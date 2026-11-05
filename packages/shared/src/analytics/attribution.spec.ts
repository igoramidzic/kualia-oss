import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanNavigationLink, clearLegacyAnalyticsStorage } from './attribution';

beforeEach(() => {
  history.replaceState({}, '', '/');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('retired browser tracking cleanup', () => {
  it('preserves active PostHog identities while still removing retired advertising storage', () => {
    document.cookie = 'ph_phc_current_posthog=visitor; Path=/; Domain=kualia.com';
    localStorage.setItem('ph_phc_current_posthog', 'visitor');
    sessionStorage.setItem('ph_phc_current_posthog', 'session');
    localStorage.setItem('kualia_campaign', 'retired');

    clearLegacyAnalyticsStorage({ preservePostHog: true });

    expect(document.cookie).toContain('ph_phc_current_posthog=visitor');
    expect(localStorage.getItem('ph_phc_current_posthog')).toBe('visitor');
    expect(sessionStorage.getItem('ph_phc_current_posthog')).toBe('session');
    expect(localStorage.getItem('kualia_campaign')).toBeNull();
  });

  it('preserves current pixel identifiers when shared consent management owns their lifecycle', () => {
    for (const name of ['_fbp', '_fbc', '__oppref', '__obref']) document.cookie = `${name}=current; Path=/`;
    document.cookie = 'kualia_ad_click=retired; Path=/';
    clearLegacyAnalyticsStorage({ preservePixelCookies: true });
    for (const name of ['_fbp', '_fbc', '__oppref', '__obref']) expect(document.cookie).toContain(`${name}=current`);
    expect(document.cookie).not.toContain('kualia_ad_click=');
  });
  it('preserves campaign URL context while deleting retired Meta cookies', () => {
    document.cookie = '_fbp=browser; Path=/';
    document.cookie = '_fbc=click; Path=/; Domain=kualia.com';
    document.cookie = 'kualia_ad_click=retired; Path=/';
    localStorage.setItem('kualia_campaign', 'retired');
    history.replaceState({}, '', '/?fbclid=click&utm_source=facebook&oppref=retired&invite=keep');

    clearLegacyAnalyticsStorage({ preserveCampaignParameters: true });

    expect(document.cookie).not.toContain('_fbp=browser');
    expect(document.cookie).not.toContain('_fbc=click');
    expect(document.cookie).not.toContain('kualia_ad_click=');
    expect(localStorage.getItem('kualia_campaign')).toBeNull();
    expect(location.search).toBe('?fbclid=click&utm_source=facebook&oppref=retired&invite=keep');
    expect(cleanNavigationLink('https://app.kualia.com/signup?fbclid=click', location.href)).toBe(
      'https://app.kualia.com/signup'
    );
  });

  it('removes legacy identifiers and grants from both storage types and cookie scopes, retaining app state', () => {
    const retired = [
      'kualia_campaign',
      'ph_phc_old_posthog',
      'kualia_ad_click',
      'kualia_facebook_ad_click',
      'kualia_ad_measurement',
      'kualia_ad_measurement_v2',
      'kualia_ad_choice_at',
      'kualia_ad_revocation',
      '_fbc',
      '_fbp',
    ];
    for (const key of retired) {
      document.cookie = `${key}=old; Path=/`;
      document.cookie = `${key}=old; Path=/; Domain=kualia.com`;
      localStorage.setItem(key, 'old');
      sessionStorage.setItem(key, 'old');
    }
    document.cookie = 'app-preference=keep; Path=/';
    localStorage.setItem('app-preference', 'keep');
    sessionStorage.setItem('auth-state', 'keep');
    history.replaceState(
      { preserved: true },
      '',
      '/signup?utm_source=chatgpt&utm_term=private&oppref=click&fbclid=click&ph_distinct_id=person&invite=keep#start'
    );
    clearLegacyAnalyticsStorage();
    for (const key of retired) {
      expect(document.cookie).not.toContain(`${key}=`);
      expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
    expect(document.cookie).toContain('app-preference=keep');
    expect(localStorage.getItem('app-preference')).toBe('keep');
    expect(sessionStorage.getItem('auth-state')).toBe('keep');
    expect(location.search).toBe('?invite=keep');
    expect(location.hash).toBe('#start');
    expect(history.state).toEqual({ preserved: true });
  });

  it('survives blocked cookies and storage while still cleaning the URL', () => {
    for (const access of ['get', 'set'] as const) {
      vi.spyOn(document, 'cookie', access).mockImplementation(() => {
        throw new Error('Blocked');
      });
    }
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('Blocked');
    });
    history.replaceState({}, '', '/?oppref=click');
    expect(() => clearLegacyAnalyticsStorage()).not.toThrow();
    expect(location.search).toBe('');
  });

  it('removes all campaign and click parameters without changing unrelated navigation or external destinations', () => {
    const base = 'https://kualia.com/?utm_source=chatgpt&oppref=click';
    for (const origin of ['https://kualia.com', 'https://www.kualia.com', 'https://app.kualia.com']) {
      expect(
        cleanNavigationLink(
          `${origin}/signup?UTM_SOURCE=x&utm_custom=x&gclid=x&gbraid=x&wbraid=x&msclkid=x&ph_session_id=x&next=budget#start`,
          base
        )
      ).toBe(`${origin}/signup?next=budget#start`);
    }
    expect(cleanNavigationLink('/family?fbclid=x&oppref=x', base)).toBe('https://kualia.com/family');
    for (const external of [
      'https://app.kualia.com.evil.example/signup?utm_source=example',
      'https://example.com/?ref=keep',
      'mailto:hello@kualia.com',
    ]) {
      expect(cleanNavigationLink(external, base)).toBe(external);
    }
  });
});
