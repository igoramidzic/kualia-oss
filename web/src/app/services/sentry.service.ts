import { Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { environment } from '../../environments/environment';

/** Keep operational diagnostics without ad IDs, URL queries, or account identity. */
export function sanitizeSentryEvent<T extends Sentry.Event>(event: T): T {
  delete event.user;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  scrubDiagnosticData(event, new WeakSet<object>());
  return event;
}

export function sanitizeSentryBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  scrubDiagnosticData(breadcrumb, new WeakSet<object>());
  return breadcrumb;
}

function stripUrlDetails(value: string): string {
  const strip = (url: string): string => url.split(/[?#]/, 1)[0];
  if (value.startsWith('/')) return strip(value);
  return value.replace(/https?:\/\/[^\s"'<>]+/g, strip);
}

function scrubDiagnosticData(value: unknown, seen: WeakSet<object>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (
      /^(?:oppref|fbclid|fbc|fbp|ph_distinct_id|ph_session_id|(?:first_|latest_)?utm_.*|email|http\.query|http\.fragment)$/i.test(
        key
      )
    ) {
      Reflect.deleteProperty(value, key);
      continue;
    }
    const entry: unknown = Reflect.get(value, key);
    if (typeof entry === 'string') Reflect.set(value, key, stripUrlDetails(entry));
    else scrubDiagnosticData(entry, seen);
  }
}

@Injectable({
  providedIn: 'root',
})
export class SentryService {
  private initialized = false;

  constructor() {
    this.initialized = !!environment.sentry?.dsn && environment.production;
  }

  setUser(_userId: string, _email?: string, _additionalData?: Record<string, unknown>): void {
    if (!this.initialized) return;

    // Error diagnostics do not need the signed-in account or its contact details.
    Sentry.setUser(null);
  }

  clearUser(): void {
    if (!this.initialized) return;
    Sentry.setUser(null);
  }

  setContext(name: string, context: Record<string, unknown>): void {
    if (!this.initialized) return;
    Sentry.setContext(name, context);
  }

  setTag(key: string, value: string): void {
    if (!this.initialized) return;
    Sentry.setTag(key, value);
  }

  captureException(error: unknown, context?: Record<string, unknown>): void {
    if (!this.initialized) return;

    if (context) {
      Sentry.withScope((scope) => {
        scope.setExtras(context);
        Sentry.captureException(error);
      });
    } else {
      Sentry.captureException(error);
    }
  }

  captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
    if (!this.initialized) return;
    Sentry.captureMessage(message, level);
  }

  addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
    if (!this.initialized) return;
    Sentry.addBreadcrumb(breadcrumb);
  }
}
