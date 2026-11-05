import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { environment as defaultEnvironment } from '../../environments/environment';
import { ENVIRONMENT } from '../config/environment.token';
import { UserPreferencesService } from '../core/services/preferences/user-preferences.service';
import { ConvexService } from './convex.service';

interface UserJotUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
}

interface UserJotIdentifyOptions {
  token?: string;
  user?: UserJotUser;
}

interface UserJotState {
  unreadCount: number | null;
  widget?: {
    open?: boolean;
  };
}

interface UserJotIdentifyResult {
  viewer: UserJotUser | null;
  identityTrust: 'signed' | 'unsigned' | null;
  warnings: string[];
}

type UserJotTheme = 'auto' | 'light' | 'dark';

declare global {
  interface Window {
    $ujq: [string, ...unknown[]][];
    uj: {
      init: (
        projectId: string,
        options?: {
          widget?: boolean | { launcher?: boolean; position?: 'left' | 'right'; theme?: UserJotTheme };
          pageContext?: 'origin' | 'path' | 'none';
          onReady?: () => void;
        }
      ) => void;
      identify: (input: UserJotIdentifyOptions) => Promise<UserJotIdentifyResult>;
      logout: () => void | Promise<void>;
      open: (target?: {
        to: 'home' | 'feedback' | 'roadmap' | 'updates' | 'messages' | 'notifications';
      }) => void | Promise<void>;
      setTheme: (theme: UserJotTheme) => void;
      getState: () => UserJotState;
      on: {
        (event: 'unread', listener: (payload: { count: number }) => void): () => void;
        (event: 'open' | 'close', listener: () => void): () => void;
      };
    };
  }
}

@Injectable({
  providedIn: 'root',
})
export class UserJotService {
  private readonly injector = inject(Injector);
  private readonly userPreferencesService = inject(UserPreferencesService);
  // Make environment optional - fallback to default if not provided in tests
  private readonly environment = inject(ENVIRONMENT, { optional: true }) ?? defaultEnvironment;
  private initialized = false;
  private identitySyncStarted = false;
  private hadAuthenticatedSession = false;
  private readonly _isReady = signal(false);
  private readonly _unreadCount = signal(0);
  private readonly _isOpen = signal(false);
  private readonly _identityTrust = signal<'signed' | 'unsigned' | null>(null);

  readonly unreadCount = this._unreadCount.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();
  readonly identityTrust = this._identityTrust.asReadonly();

  constructor() {
    // Watch for theme changes and update UserJot widget theme
    effect(() => {
      // Defensive check: ensure theme is a function before calling
      if (typeof this.userPreferencesService.theme === 'function') {
        const theme = this.userPreferencesService.theme();
        if (this.initialized) {
          this.setTheme(theme);
        }
      }
    });
  }

  init(): void {
    if (this.initialized) {
      return;
    }

    if (this.environment.userjot?.projectId) {
      // The proxy is created synchronously in index.html, so uj.init is available immediately
      // It will queue the call if the script hasn't loaded yet
      if (window.uj?.init) {
        // Defensive check: ensure theme is a function before calling
        if (typeof this.userPreferencesService.theme === 'function') {
          const currentTheme = this.userPreferencesService.theme();
          window.uj.init(this.environment.userjot.projectId, {
            widget: {
              launcher: false,
              position: 'left',
              theme: this.mapThemeToUserJot(currentTheme),
            },
            pageContext: 'origin',
            onReady: () => {
              const state = window.uj.getState();
              this._isReady.set(true);
              this._unreadCount.set(state.unreadCount ?? 0);
              this._isOpen.set(state.widget?.open ?? false);
              window.uj.on('unread', ({ count }) => this._unreadCount.set(count));
              window.uj.on('open', () => this._isOpen.set(true));
              window.uj.on('close', () => this._isOpen.set(false));
            },
          });
          this.initialized = true;
          this.startIdentitySync();
        }
      }
    }
  }

  private startIdentitySync(): void {
    if (this.identitySyncStarted) {
      return;
    }

    this.identitySyncStarted = true;
    const convexService = this.injector.get(ConvexService);

    effect(
      () => {
        if (!this._isReady()) {
          return;
        }

        if (convexService.isAuthenticated()) {
          this.hadAuthenticatedSession = true;
          void this.identifyUser();
        } else if (this.hadAuthenticatedSession) {
          this.hadAuthenticatedSession = false;
          this.logout();
        }
      },
      { injector: this.injector }
    );
  }

  /**
   * Map application theme to UserJot theme
   * 'system' -> 'auto', 'light' -> 'light', 'dark' -> 'dark'
   */
  private mapThemeToUserJot(theme: 'light' | 'dark' | 'system'): UserJotTheme {
    if (theme === 'system') {
      return 'auto';
    }
    return theme;
  }

  /**
   * Set UserJot widget theme
   */
  setTheme(theme: 'light' | 'dark' | 'system'): void {
    if (!this.initialized || typeof window.uj === 'undefined') return;
    if (window.uj.setTheme) {
      window.uj.setTheme(this.mapThemeToUserJot(theme));
    }
  }

  async identify(input: UserJotIdentifyOptions): Promise<UserJotIdentifyResult | null> {
    if (!this.initialized || !this._isReady() || typeof window.uj === 'undefined') return null;
    if (!window.uj.identify) return null;

    return await window.uj.identify(input);
  }

  /**
   * Automatically identify user with token from Convex backend
   * This method checks if user is authenticated and only then fetches the token
   * If not authenticated, the widget remains initialized but without user identification
   */
  async identifyUser(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      // Lazy inject ConvexService to avoid circular dependency
      const convexService = this.injector.get(ConvexService);

      // Check if user is authenticated - if not, skip identification
      // Widget will remain initialized but without user identification
      const isAuthenticated = convexService.isAuthenticated();

      if (!isAuthenticated) {
        return;
      }

      await convexService.ensureCurrentUserProfile();

      // Get token from Convex backend
      // Access the query directly from the API, same pattern as other services
      const tokenData = await convexService.getClient().query(api.userjot.generateIdentityToken, {});

      if (!tokenData?.token) {
        return;
      }

      const result = await this.identify({ token: tokenData.token });
      if (result?.identityTrust !== 'signed') {
        throw new Error('UserJot did not accept the signed identity');
      }

      this._identityTrust.set(result.identityTrust);
      if (result.warnings.length > 0) {
        console.warn('UserJot identity warnings:', result.warnings);
      }
    } catch (error: unknown) {
      this._identityTrust.set(null);
      console.error('Failed to authenticate the user with UserJot:', error);
    }
  }

  open(): void {
    if (!this.initialized || typeof window.uj === 'undefined') return;
    if (window.uj.open) {
      void Promise.resolve(window.uj.open({ to: 'home' })).catch(() => undefined);
    }
  }

  logout(): void {
    this._identityTrust.set(null);
    if (!this.initialized || typeof window.uj === 'undefined') return;
    if (window.uj.logout) {
      void Promise.resolve(window.uj.logout()).catch(() => undefined);
      this._unreadCount.set(0);
    }
  }
}
