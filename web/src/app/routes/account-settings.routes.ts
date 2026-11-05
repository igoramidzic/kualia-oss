import type { Routes } from '@angular/router';
import { SettingsLayoutComponent } from '../layouts/settings-layout/settings-layout';

export const accountSettingsRoutes: Routes = [
  {
    path: '',
    component: SettingsLayoutComponent,
    data: { settingsScope: 'account' },
    children: [
      {
        path: '',
        redirectTo: 'profile',
        pathMatch: 'full',
      },
      {
        path: 'profile',
        loadComponent: () => import('../pages/settings/profile/profile').then((m) => m.ProfileComponent),
      },
      {
        path: 'preferences',
        loadComponent: () => import('../pages/settings/preferences/preferences').then((m) => m.PreferencesComponent),
      },
      {
        path: 'family/members/:userId',
        loadComponent: () =>
          import('../pages/settings/family/member/family-member').then((m) => m.FamilyMemberComponent),
      },
      {
        path: 'family',
        loadComponent: () => import('../pages/settings/family/family').then((m) => m.FamilyComponent),
      },
      {
        path: 'billing',
        loadComponent: () => import('../pages/settings/billing/billing').then((m) => m.BillingComponent),
      },
      {
        path: 'api-keys',
        loadComponent: () => import('../pages/settings/api-keys/api-keys').then((m) => m.ApiKeysComponent),
      },
      {
        path: 'mcp-connections',
        loadComponent: () =>
          import('../pages/settings/mcp-connections/mcp-connections').then((m) => m.McpConnectionsComponent),
      },
    ],
  },
];
