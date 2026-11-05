import { computed, inject, Injectable, type OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { api } from 'convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import { decodeJwt } from 'jose';
import { environment } from '../../environments/environment';

interface Tokens {
  token: string;
  refreshToken: string;
}
interface Session {
  token: string;
  expiresAt: Date;
  userId: string;
}
interface User {
  id: string;
  email: string;
  imageUrl: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  authProviderLabel: string;
  emailVerified: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class LocalAuthService implements OnDestroy {
  private readonly router = inject(Router);
  private readonly client = new ConvexHttpClient(environment.convex.url);
  private readonly storageKey = `kualia.auth.${environment.convex.url}`;
  private tokens: Tokens | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private readonly _user = signal<User | null>(null);
  private readonly _session = signal<Session | null>(null);
  private readonly _loading = signal(true);
  private readonly _error = signal<string | null>(null);
  readonly user = this._user.asReadonly();
  readonly session = this._session.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  private readonly storageListener = (event: StorageEvent) => {
    if (event.key === this.storageKey) void this.restore();
  };

  constructor() {
    void this.restore();
    window.addEventListener('storage', this.storageListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('storage', this.storageListener);
  }

  private readTokens(): Tokens | null {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
      if (
        value &&
        typeof value === 'object' &&
        'token' in value &&
        'refreshToken' in value &&
        typeof value.token === 'string' &&
        typeof value.refreshToken === 'string'
      )
        return value as Tokens;
    } catch (_error: unknown) {
      /* A malformed saved session is treated as signed out. */
    }
    return null;
  }

  private setTokens(tokens: Tokens | null): void {
    this.tokens = tokens;
    if (!tokens) {
      localStorage.removeItem(this.storageKey);
      this.client.clearAuth();
      this._session.set(null);
      this._user.set(null);
      return;
    }
    const claims = decodeJwt(tokens.token);
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') throw new Error('Invalid session');
    const id = claims.sub.split('|')[0];
    localStorage.setItem(this.storageKey, JSON.stringify(tokens));
    this.client.setAuth(tokens.token);
    this._session.set({ token: tokens.token, userId: id, expiresAt: new Date(claims.exp * 1000) });
    this._user.set({
      id,
      email: typeof claims['email'] === 'string' ? claims['email'] : '',
      name: null,
      firstName: null,
      lastName: null,
      imageUrl: null,
      authProviderLabel: 'Password',
      emailVerified: false,
      createdAt: null,
      updatedAt: null,
    });
  }

  private async restore(): Promise<void> {
    try {
      this.tokens = this.readTokens();
      if (this.tokens) {
        await this.getConvexToken();
      } else {
        this._session.set(null);
        this._user.set(null);
        this.client.clearAuth();
      }
    } catch (_error: unknown) {
      this.setTokens(null);
    } finally {
      this._loading.set(false);
    }
  }

  async signInWithPassword(
    email: string,
    password: string,
    flow: 'signIn' | 'signUp'
  ): Promise<{ success: boolean; error?: string }> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const result = await this.client.action(api.auth.signIn, {
        provider: 'password',
        params: { email, password, flow },
      });
      if (!result.tokens) throw new Error('Unable to sign in');
      this.setTokens(result.tokens);
      return { success: true };
    } catch (_error: unknown) {
      const error =
        flow === 'signIn'
          ? 'Unable to sign in. Check your email and password.'
          : 'Unable to create an account. Use a valid email and a password of at least 12 characters, or sign in if you already have an account.';
      this._error.set(error);
      return { success: false, error };
    } finally {
      this._loading.set(false);
    }
  }

  async getConvexToken(forceRefresh = false): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.tokens) return null;
    const claims = decodeJwt(this.tokens.token);
    if (!forceRefresh && typeof claims.exp === 'number' && claims.exp * 1000 > Date.now() + 60_000) {
      if (!this._session()) this.setTokens(this.tokens);
      return this.tokens.token;
    }
    // Serialize refresh-token rotation across tabs, as well as concurrent callers.
    this.refreshPromise = Promise.resolve(
      navigator.locks.request(this.storageKey, async () => {
        const saved = this.readTokens();
        if (!saved) {
          this.setTokens(null);
          return null;
        }
        if (saved.token !== this.tokens?.token) {
          this.setTokens(saved);
          return saved.token;
        }
        try {
          const result = await this.client.action(api.auth.signIn, { refreshToken: saved.refreshToken });
          this.setTokens(result.tokens ?? null);
          return result.tokens?.token ?? null;
        } catch (_error: unknown) {
          this.setTokens(null);
          return null;
        }
      })
    )
      .then((token) => token)
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  getCurrentUser(): User | null {
    return this.user();
  }
  async getSession(): Promise<Session | null> {
    await this.getConvexToken();
    return this.session();
  }
  clearError(): void {
    this._error.set(null);
  }
  async logout(): Promise<void> {
    try {
      const token = await this.getConvexToken();
      if (token) {
        this.client.setAuth(token);
        await this.client.action(api.auth.signOut, {});
      }
    } finally {
      this.setTokens(null);
      await this.router.navigate(['/login']);
    }
  }
}
