import { Routes } from '@angular/router';
import { noOnboardingGuard } from '../guards/no-onboarding.guard';
import { onboardingGuard } from '../guards/onboarding.guard';
import { WorkspaceLayoutComponent } from '../layouts/workspace-layout/workspace-layout';
import { BankAccountComponent } from '../pages/bank-account/bank-account';
import { BankAccountsComponent } from '../pages/bank-accounts/bank-accounts';
import { BudgetComponent } from '../pages/budget/budget';
import { OnboardingComponent } from '../pages/onboarding/onboarding';
import { PlannedTransactionDetailsComponent } from '../pages/planned-transaction-details/planned-transaction-details';
import { PlannedTransactionComponent } from '../pages/planned-transaction/planned-transaction';
import { PlannedComponent } from '../pages/planned/planned';
import { ReportsComponent } from '../pages/reports/reports';
import { TransactionDetailsComponent } from '../pages/transaction-details/transaction-details';
import { TransactionComponent } from '../pages/transaction/transaction';
import { TransactionsComponent } from '../pages/transactions/transactions';

export const workspaceRoutes: Routes = [
  {
    path: '',
    component: WorkspaceLayoutComponent,
    children: [
      {
        path: 'onboarding',
        component: OnboardingComponent,
        canActivate: [noOnboardingGuard],
      },
      {
        path: '',
        canActivate: [onboardingGuard],
        children: [
          {
            path: 'bank-accounts',
            component: BankAccountsComponent,
          },
          {
            path: 'bank-accounts/:slug/details',
            redirectTo: 'bank-accounts/:slug',
          },
          {
            path: 'bank-accounts/:slug/transactions',
            redirectTo: 'bank-accounts/:slug',
          },
          {
            path: 'bank-accounts/:slug',
            component: BankAccountComponent,
          },
          {
            path: 'transactions',
            component: TransactionsComponent,
          },
          {
            path: 'budget',
            component: BudgetComponent,
          },
          {
            path: 'reports',
            component: ReportsComponent,
          },
          {
            path: 'planned',
            component: PlannedComponent,
          },
          {
            path: 'transactions/:id',
            component: TransactionComponent,
            children: [
              {
                path: '',
                redirectTo: 'details',
                pathMatch: 'full',
              },
              {
                path: 'details',
                component: TransactionDetailsComponent,
              },
              {
                path: '**',
                redirectTo: 'details',
                pathMatch: 'full',
              },
            ],
          },
          {
            path: 'planned/:id',
            component: PlannedTransactionComponent,
            children: [
              {
                path: '',
                redirectTo: 'details',
                pathMatch: 'full',
              },
              {
                path: 'details',
                component: PlannedTransactionDetailsComponent,
              },
              {
                path: '**',
                redirectTo: 'details',
                pathMatch: 'full',
              },
            ],
          },
          // Legacy scheduled URLs now live under planned/:id
          {
            path: 'scheduled/:id',
            redirectTo: 'planned/:id',
          },
          {
            path: 'scheduled/:id/:page',
            redirectTo: 'planned/:id/:page',
          },
          {
            path: '',
            redirectTo: 'budget',
            pathMatch: 'full',
          },
        ],
      },
      {
        path: 'settings',
        canActivate: [onboardingGuard],
        loadChildren: () => import('./settings.routes').then((m) => m.settingsRoutes),
      },
    ],
  },
];
