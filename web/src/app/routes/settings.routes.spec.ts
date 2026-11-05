import type { Route, Routes } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { settingsRoutes } from './settings.routes';

function settingsChildRoutes(): Routes {
  return settingsRoutes[0]?.children ?? [];
}

function findSettingsRoute(path: string): Route | undefined {
  return settingsChildRoutes().find((route) => route.path === path);
}

describe('settingsRoutes', () => {
  it('redirects the workspace settings root to general settings', () => {
    const rootRoute = findSettingsRoute('');

    expect(rootRoute?.redirectTo).toBe('general');
    expect(rootRoute?.pathMatch).toBe('full');
  });

  it('serves workspace general settings at the general URL', () => {
    expect(findSettingsRoute('general')?.loadComponent).toBeDefined();
    expect(findSettingsRoute('workspace')?.redirectTo).toBe('general');
  });

  it('redirects legacy account settings URLs to global account settings', () => {
    expect(findSettingsRoute('profile')?.redirectTo).toBeTypeOf('function');
    expect(findSettingsRoute('preferences')?.redirectTo).toBeTypeOf('function');
    expect(findSettingsRoute('family')?.redirectTo).toBeTypeOf('function');
    expect(findSettingsRoute('billing')?.redirectTo).toBeTypeOf('function');
    expect(findSettingsRoute('api-keys')?.redirectTo).toBeTypeOf('function');
  });

  it('serves general workspace settings without a child management guard', () => {
    const generalRoute = findSettingsRoute('general');

    expect(generalRoute?.loadComponent).toBeDefined();
    expect(generalRoute?.canActivate).toBeUndefined();
  });

  it('serves the activity settings page', () => {
    expect(findSettingsRoute('activity')?.loadComponent).toBeDefined();
  });

  it('serves the data export settings page', () => {
    expect(findSettingsRoute('export')?.loadComponent).toBeDefined();
  });

  it('redirects legacy together URLs to family URLs', () => {
    expect(findSettingsRoute('together')?.redirectTo).toBeTypeOf('function');
    expect(findSettingsRoute('together/members/:userId')?.redirectTo).toBeTypeOf('function');
  });
});
