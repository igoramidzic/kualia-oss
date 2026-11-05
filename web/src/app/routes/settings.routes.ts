import { inject } from '@angular/core';
import { type RedirectFunction, Router, type Routes } from '@angular/router';
import { SettingsLayoutComponent } from '../layouts/settings-layout/settings-layout';

function redirectToAccountSettings(path: string): RedirectFunction {
  return () => inject(Router).parseUrl(`/settings/${path}`);
}

const redirectToFamilyMember: RedirectFunction = ({ params }) => {
  const userId: unknown = params['userId'];
  const segments = ['/settings/family/members'];
  if (typeof userId === 'string') {
    segments.push(userId);
  }
  return inject(Router).createUrlTree(segments);
};

export const settingsRoutes: Routes = [
  {
    path: '',
    component: SettingsLayoutComponent,
    data: { settingsScope: 'workspace' },
    children: [
      {
        path: '',
        redirectTo: 'general',
        pathMatch: 'full',
      },
      {
        path: 'general',
        loadComponent: () => import('../pages/settings/workspace/workspace').then((m) => m.WorkspaceComponent),
      },
      {
        path: 'workspace',
        redirectTo: 'general',
        pathMatch: 'full',
      },
      {
        path: 'profile',
        redirectTo: redirectToAccountSettings('profile'),
        pathMatch: 'full',
      },
      {
        path: 'preferences',
        redirectTo: redirectToAccountSettings('preferences'),
        pathMatch: 'full',
      },
      {
        path: 'export',
        loadComponent: () => import('../pages/settings/export/export').then((m) => m.DataExportComponent),
      },
      {
        path: 'family/members/:userId',
        redirectTo: redirectToFamilyMember,
      },
      {
        path: 'family',
        redirectTo: redirectToAccountSettings('family'),
        pathMatch: 'full',
      },
      {
        path: 'together/members/:userId',
        redirectTo: redirectToFamilyMember,
      },
      {
        path: 'together',
        redirectTo: redirectToAccountSettings('family'),
        pathMatch: 'full',
      },
      {
        path: 'bank-connections',
        loadComponent: () =>
          import('../pages/settings/bank-connections/bank-connections').then((m) => m.BankConnectionsComponent),
      },
      {
        path: 'activity',
        loadComponent: () => import('../pages/settings/activity/activity').then((m) => m.ActivityComponent),
      },
      {
        path: 'merchants',
        loadComponent: () => import('../pages/settings/merchants/merchants').then((m) => m.MerchantsComponent),
      },
      {
        path: 'rules',
        loadComponent: () => import('../pages/settings/rules/rules').then((m) => m.RulesComponent),
      },
      {
        path: 'billing',
        redirectTo: redirectToAccountSettings('billing'),
        pathMatch: 'full',
      },
      {
        path: 'api-keys',
        redirectTo: redirectToAccountSettings('api-keys'),
        pathMatch: 'full',
      },
      {
        path: 'merchants/:slug',
        loadComponent: () => import('../pages/merchant/merchant').then((m) => m.MerchantComponent),
        children: [
          {
            path: '',
            redirectTo: 'details',
            pathMatch: 'full',
          },
          {
            path: 'details',
            loadComponent: () =>
              import('../pages/merchant-details/merchant-details').then((m) => m.MerchantDetailsComponent),
          },
          {
            path: 'transactions',
            loadComponent: () =>
              import('../pages/merchant-transactions/merchant-transactions').then(
                (m) => m.MerchantTransactionsComponent
              ),
          },
        ],
      },
    ],
  },
];
