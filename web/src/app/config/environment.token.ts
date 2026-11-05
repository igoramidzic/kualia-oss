import { InjectionToken } from '@angular/core';

export interface Environment {
  production: boolean;
  posthog: {
    apiKey: string;
    apiHost: string;
  };
  userjot: {
    projectId: string;
  };
  convex: {
    url: string;
    siteUrl: string;
  };
  clerk: {
    publishableKey: string;
    emailLoginEnabled: boolean;
  };
  logoDev: {
    token: string;
  };
  revenueCat?: {
    publicKey: string;
  };
  sentry?: {
    dsn: string;
    tunnel?: string;
    environment: string;
    tracesSampleRate: number;
  };
}

export const ENVIRONMENT = new InjectionToken<Environment>('app.environment');
