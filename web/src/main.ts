import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from './app/services/sentry.service';
import { environment } from './environments/environment';

// Initialize Sentry BEFORE Angular bootstraps to capture errors during initialization
if (environment.sentry?.dsn) {
  Sentry.init({
    dsn: environment.sentry.dsn,
    tunnel: environment.sentry.tunnel,
    environment: environment.sentry.environment,
    integrations: [Sentry.browserTracingIntegration(), Sentry.breadcrumbsIntegration({ console: false, dom: false })],
    sendDefaultPii: false,
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryEvent,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    tracesSampleRate: environment.sentry.tracesSampleRate,
    enabled: environment.production,
    ignoreErrors: [
      // Browser extensions
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      // Common benign errors
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // Expected Convex auth guard errors (not actual failures)
      'Authentication required',
    ],
  });
}

bootstrapApplication(App, appConfig).catch((err) => {
  console.error(err);
  if (environment.sentry?.dsn) {
    Sentry.captureException(err);
  }
});
