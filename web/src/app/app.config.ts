import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import * as Sentry from '@sentry/angular';
import { provideHlmSidebarConfig } from '@spartan-ng/helm/sidebar';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { ENVIRONMENT } from './config/environment.token';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHlmSidebarConfig({
      mobileBreakpoint: '1023px', // Use 1023px to align with Tailwind lg breakpoint (min-width: 1024px)
    }),
    provideCharts(withDefaultRegisterables()),
    { provide: ENVIRONMENT, useValue: environment },
    // CDK 21 puts overlays into the browser's top layer via the Popover API,
    // which sits above iframes with z-index: 2147483647 (e.g. Plaid Link).
    // Opt out so Plaid's modal can render on top of our dialogs.
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    // Sentry error handler - only when DSN is configured
    ...(environment.sentry?.dsn
      ? [
          {
            provide: ErrorHandler,
            useValue: Sentry.createErrorHandler({
              showDialog: false,
              logErrors: !environment.production,
            }),
          },
        ]
      : []),
  ],
};
