import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBankLinkStatusChangeTemplate } from './emailTemplates';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getBankLinkStatusChangeTemplate', () => {
  it('links to bank connection settings on the configured app URL', () => {
    vi.stubEnv('KUALIA_APP_URL', 'https://budget.example.test/');
    const html = getBankLinkStatusChangeTemplate('Example Bank', 'Error', 'abc12345');
    expect(html).toContain('href="https://budget.example.test/abc12345/settings/bank-connections"');
    expect(html).not.toContain('kualia.com');
  });

  it('falls back to the local web app when KUALIA_APP_URL is unset', () => {
    vi.stubEnv('KUALIA_APP_URL', '');
    const html = getBankLinkStatusChangeTemplate('Example Bank', 'Disconnected', 'abc12345');
    expect(html).toContain('href="http://127.0.0.1:4200/abc12345/settings/bank-connections"');
  });
});
