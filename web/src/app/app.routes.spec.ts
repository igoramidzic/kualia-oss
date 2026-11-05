import type { Route } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { authGuard } from './guards/auth.guard';
import { noUserOnboardingGuard } from './guards/no-user-onboarding.guard';
import { workspaceRoutes } from './routes/workspace.routes';

function findRoute(path: string): Route | undefined {
  return routes.find((route) => route.path === path);
}

describe('app routes', () => {
  it('serves family invite join links behind auth', () => {
    const route = findRoute('family/join/:token');

    expect(route?.loadComponent).toBeDefined();
    expect(route?.canActivate).toContain(authGuard);
  });

  it('matches family invite joins before workspace short IDs', () => {
    const familyJoinIndex = routes.findIndex((route) => route.path === 'family/join/:token');
    const workspaceIndex = routes.findIndex((route) => route.path === ':workspaceShortId');

    expect(familyJoinIndex).toBeGreaterThanOrEqual(0);
    expect(workspaceIndex).toBeGreaterThanOrEqual(0);
    expect(familyJoinIndex).toBeLessThan(workspaceIndex);
  });

  it('serves family subscription required before workspace short IDs', () => {
    const route = findRoute('family/subscription-required');
    const familySubscriptionIndex = routes.findIndex((route) => route.path === 'family/subscription-required');
    const workspaceIndex = routes.findIndex((route) => route.path === ':workspaceShortId');

    expect(route?.loadComponent).toBeDefined();
    expect(route?.canActivate).toContain(authGuard);
    expect(route?.canActivate).toContain(noUserOnboardingGuard);
    expect(familySubscriptionIndex).toBeGreaterThanOrEqual(0);
    expect(workspaceIndex).toBeGreaterThanOrEqual(0);
    expect(familySubscriptionIndex).toBeLessThan(workspaceIndex);
  });

  it('serves global account settings before workspace short IDs', () => {
    const settingsRoute = findRoute('settings');
    const settingsIndex = routes.findIndex((route) => route.path === 'settings');
    const workspaceIndex = routes.findIndex((route) => route.path === ':workspaceShortId');

    expect(settingsRoute?.loadChildren).toBeDefined();
    expect(settingsRoute?.canActivate).toContain(authGuard);
    expect(settingsRoute?.canActivate).toContain(noUserOnboardingGuard);
    expect(settingsIndex).toBeLessThan(workspaceIndex);
  });

  it('does not create a second routed layout for primary workspace pages', () => {
    const workspaceChildren = workspaceRoutes[0]?.children;
    const primaryWorkspaceRoute = workspaceChildren?.find((route) => route.path === '' && route.children);

    expect(primaryWorkspaceRoute?.component).toBeUndefined();
    expect(primaryWorkspaceRoute?.children?.some((route) => route.path === 'budget')).toBe(true);
  });
});
