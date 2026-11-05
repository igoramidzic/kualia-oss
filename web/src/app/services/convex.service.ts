import { computed, effect, inject, Injectable, OnDestroy, signal, untracked } from '@angular/core';
import { api } from 'convex/_generated/api';
import { ConvexClient } from 'convex/browser';
import { environment } from '../../environments/environment';
import { LocalAuthService } from './local-auth.service';

@Injectable({
  providedIn: 'root',
})
export class ConvexService implements OnDestroy {
  private readonly client: ConvexClient;
  private readonly clerkService = inject(LocalAuthService);
  private readonly authUserId = computed(() => this.clerkService.user()?.id ?? null);
  private readonly _isAuthenticated = signal<boolean>(false);
  private authTokenSubscription?: { unsubscribe: () => void };
  private querySubscriptions: (() => void)[] = [];
  private ensuredProfileClerkId?: string;
  private profileBootstrap?: { clerkId: string; promise: Promise<void> };

  constructor() {
    const convexUrl = environment.convex.url;
    this.client = new ConvexClient(convexUrl);

    // Attach the local authentication provider to the reactive client.
    this.setupAuthTokenSync();
  }

  private setupAuthTokenSync() {
    // Reconfigure only when the user changes, not on every token rotation.
    effect(() => {
      const userId = this.authUserId();
      untracked(() => this.syncAuthToken(userId));
    });
  }

  private syncAuthToken(userId: string | null): void {
    if (userId) {
      // Set up auth with a token fetcher function
      this.client.setAuth(
        async ({ forceRefreshToken }) => {
          try {
            const token = await this.clerkService.getConvexToken(forceRefreshToken);
            return token;
          } catch {
            this._isAuthenticated.set(false);
            return null;
          }
        },
        (isAuthenticated) => {
          this._isAuthenticated.set(isAuthenticated);
        }
      );
    } else {
      // Pass null to clear auth
      this.client.setAuth(() => Promise.resolve(null));
      this._isAuthenticated.set(false);
      this.ensuredProfileClerkId = undefined;
      this.profileBootstrap = undefined;
    }
  }

  getClient(): ConvexClient {
    return this.client;
  }

  isAuthenticated() {
    return this._isAuthenticated();
  }

  async ensureCurrentUserProfile(): Promise<void> {
    const clerkId = this.clerkService.session()?.userId ?? this.clerkService.user()?.id;
    if (!clerkId) throw new Error('Authentication required to bootstrap the user profile');
    if (this.ensuredProfileClerkId === clerkId) return;
    if (this.profileBootstrap?.clerkId === clerkId) return this.profileBootstrap.promise;

    const promise = this.client
      .mutation(api.userProfiles.ensureCurrentProfile, {})
      .then(() => {
        this.ensuredProfileClerkId = clerkId;
      })
      .finally(() => {
        if (this.profileBootstrap?.clerkId === clerkId) this.profileBootstrap = undefined;
      });
    this.profileBootstrap = { clerkId, promise };
    return promise;
  }

  // Subscribe to a query with real-time updates
  watchQuery<T>(
    // biome-ignore lint/suspicious/noExplicitAny: Convex SDK type boundary requires its underlying generic shape.
    query: any,
    // biome-ignore lint/suspicious/noExplicitAny: Convex SDK type boundary requires its underlying generic shape.
    args?: any
  ): { subscribe: (callback: (value: T | undefined) => void) => () => void } {
    const subscribe = (callback: (value: T | undefined) => void) => {
      const unsubscribe = this.client.onUpdate(
        query,
        args ?? {},
        (value: T) => {
          callback(value);
        },
        () => {
          callback(undefined);
        }
      ) as () => void;
      return unsubscribe;
    };

    return { subscribe };
  }

  // Query with real-time updates that returns a signal
  query<T>(
    // biome-ignore lint/suspicious/noExplicitAny: Convex SDK type boundary requires its underlying generic shape.
    query: any,
    // biome-ignore lint/suspicious/noExplicitAny: Convex SDK type boundary requires its underlying generic shape.
    args?: any
  ) {
    const result = signal<T | undefined>(undefined);

    const unsubscribe = this.client.onUpdate(
      query,
      args ?? {},
      (value: T) => {
        result.set(value);
      },
      () => {
        result.set(undefined);
      }
    ) as () => void;

    // Track subscription for cleanup
    this.querySubscriptions.push(unsubscribe);

    return result.asReadonly();
  }

  // Execute a mutation
  // biome-ignore lint/suspicious/noExplicitAny: Convex SDK type boundary requires its underlying generic shape.
  async mutation<T>(mutation: any, args?: any): Promise<T> {
    return this.client.mutation(mutation, args ?? {}) as Promise<T>;
  }

  // Execute an action
  // biome-ignore lint/suspicious/noExplicitAny: Convex SDK type boundary requires its underlying generic shape.
  async action<T>(action: any, args?: any): Promise<T> {
    return this.client.action(action, args ?? {}) as Promise<T>;
  }

  ngOnDestroy() {
    if (this.authTokenSubscription) {
      this.authTokenSubscription.unsubscribe();
    }
    // Clean up all query subscriptions
    this.querySubscriptions.forEach((unsubscribe) => unsubscribe());
    this.querySubscriptions = [];
  }
}
