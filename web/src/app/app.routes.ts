import type { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';
import { noAuthGuard } from './guards/no-auth.guard';
import { noSubscriptionGuard } from './guards/no-subscription.guard';
import { noUserOnboardingGuard } from './guards/no-user-onboarding.guard';
import { rootGuard } from './guards/root.guard';
import { subscriptionGuard } from './guards/subscription.guard';
import { userOnboardingGuard } from './guards/user-onboarding.guard';
import { workspaceGuard } from './guards/workspace.guard';

export const routes: Routes = [
  {
    path: 'oauth/authorize',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/oauth-authorize/oauth-authorize.component').then((m) => m.OauthAuthorizeComponent),
  },
  {
    path: 'auth/callback',
    redirectTo: 'login',
  },
  {
    path: 'login',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'user-onboarding',
    canActivate: [authGuard, userOnboardingGuard],
    loadComponent: () => import('./pages/user-onboarding/user-onboarding').then((m) => m.UserOnboardingComponent),
  },
  {
    path: 'subscribe',
    canActivate: [authGuard, noUserOnboardingGuard, noSubscriptionGuard],
    loadComponent: () => import('./pages/subscribe/subscribe').then((m) => m.SubscribeComponent),
  },
  {
    path: 'workspaces',
    canActivate: [authGuard, noUserOnboardingGuard, subscriptionGuard],
    loadComponent: () => import('./pages/workspaces/workspaces').then((m) => m.WorkspacesComponent),
  },
  {
    path: 'family/subscription-required',
    canActivate: [authGuard, noUserOnboardingGuard],
    loadComponent: () =>
      import('./pages/family-subscription-required/family-subscription-required').then(
        (m) => m.FamilySubscriptionRequiredComponent
      ),
  },
  {
    path: 'family/join/:token',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/family-join/family-join').then((m) => m.FamilyJoinComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard, noUserOnboardingGuard],
    loadChildren: () => import('./routes/account-settings.routes').then((m) => m.accountSettingsRoutes),
  },
  // Landing page, privacy, and terms-of-service are served by the marketing site (kualia.com)
  {
    path: ':workspaceShortId',
    canActivate: [authGuard, noUserOnboardingGuard, subscriptionGuard, workspaceGuard],
    loadChildren: () => import('./routes/workspace.routes').then((m) => m.workspaceRoutes),
  },
  {
    path: '',
    canActivate: [rootGuard],
    children: [],
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full',
  },
];
