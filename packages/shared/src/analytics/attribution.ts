interface AnalyticsCleanupOptions {
  preserveCampaignParameters?: boolean;
  preservePostHog?: boolean;
  preservePixelCookies?: boolean;
}

/** Remove retired analytics parameters; preserve navigation, auth and invitation state. */
export function stripTrackingParameters(url: URL, options: AnalyticsCleanupOptions = {}): void {
  for (const key of [...url.searchParams.keys()]) {
    if (
      options.preserveCampaignParameters &&
      /^(utm_(source|medium|campaign|content|term)|fbclid|gclid|msclkid|oppref)$/i.test(key)
    )
      continue;
    if (
      /^(?:utm_.*|oppref|fbclid|gclid|dclid|msclkid|gbraid|wbraid|fbc|fbp|ph_distinct_id|ph_session_id)$/i.test(key)
    ) {
      url.searchParams.delete(key);
    }
  }
}

/** Remove identifiers left behind by retired integrations. */
export function clearLegacyAnalyticsStorage(options: AnalyticsCleanupOptions = {}): void {
  const isLegacyKey = (key: string): boolean =>
    key === 'kualia_campaign' ||
    (!options.preservePostHog && key.startsWith('ph_phc_')) ||
    key.startsWith('kualia_ad_') ||
    key === 'kualia_facebook_ad_click' ||
    (!options.preservePixelCookies && ['_fbc', '_fbp', '__oppref', '__obref'].includes(key));
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.trim().split('=')[0];
      if (!isLegacyKey(name)) continue;
      const expired = `${name}=; Path=/; SameSite=Lax; Max-Age=0`;
      document.cookie = expired;
      if (/(^|\.)kualia\.com$/.test(location.hostname)) {
        document.cookie = `${expired}; Domain=kualia.com`;
      }
    }
  } catch (error: unknown) {
    void error;
  }
  for (const storageName of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[storageName];
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key && isLegacyKey(key)) storage.removeItem(key);
      }
    } catch (error: unknown) {
      void error;
    }
  }
  const url = new URL(location.href);
  stripTrackingParameters(url, options);
  if (url.href !== location.href) {
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
}

/** Clean owned links without decorating navigation with campaign or visitor identifiers. */
export function cleanNavigationLink(href: string, base: string): string {
  const url = new URL(href, base);
  if (
    ![new URL(base).origin, 'https://app.kualia.com', 'https://kualia.com', 'https://www.kualia.com'].includes(
      url.origin
    )
  )
    return href;
  stripTrackingParameters(url);
  return url.toString();
}
