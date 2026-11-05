import type { Route, Routes } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { accountSettingsRoutes } from './account-settings.routes';

function accountSettingsChildRoutes(): Routes {
  return accountSettingsRoutes[0]?.children ?? [];
}

function findAccountSettingsRoute(path: string): Route | undefined {
  return accountSettingsChildRoutes().find((route) => route.path === path);
}

describe('accountSettingsRoutes', () => {
  it('marks the layout as account settings and redirects its root to profile', () => {
    expect(accountSettingsRoutes[0]?.data?.['settingsScope']).toBe('account');
    expect(findAccountSettingsRoute('')?.redirectTo).toBe('profile');
  });

  it.each(['profile', 'preferences', 'family', 'family/members/:userId', 'billing', 'api-keys', 'mcp-connections'])(
    'serves the %s account settings route',
    (path) => {
      expect(findAccountSettingsRoute(path)?.loadComponent).toBeDefined();
    }
  );

  it('does not include workspace-owned export settings', () => {
    expect(findAccountSettingsRoute('export')).toBeUndefined();
  });
});
