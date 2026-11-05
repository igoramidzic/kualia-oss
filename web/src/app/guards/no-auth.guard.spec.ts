import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../services/auth.service';
import { LocalAuthService } from '../services/local-auth.service';
import { noAuthGuard } from './no-auth.guard';

type GuardResult = boolean | UrlTree;
type Session = Awaited<ReturnType<AuthService['getSession']>>;

describe('noAuthGuard', () => {
  let getSession: ReturnType<typeof vi.fn<() => Promise<Session>>>;
  let router: Router;

  beforeEach(() => {
    getSession = vi.fn<() => Promise<Session>>();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            getSession,
          },
        },
        {
          provide: LocalAuthService,
          useValue: {
            loading: signal(false).asReadonly(),
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('allows users without a session to access auth pages', async () => {
    getSession.mockResolvedValue(null);

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects authenticated users to a safe redirect query param', async () => {
    getSession.mockResolvedValue(createSession());

    const result = await runGuard('/abcdefgh/settings/profile');

    expect(router.serializeUrl(result as UrlTree)).toBe('/abcdefgh/settings/profile');
  });

  it('preserves query params in a safe redirect query param', async () => {
    getSession.mockResolvedValue(createSession());

    const result = await runGuard('/abcdefgh/settings/profile?tab=billing');

    expect(router.serializeUrl(result as UrlTree)).toBe('/abcdefgh/settings/profile?tab=billing');
  });

  it.each(['https://example.com/abcdefgh/settings/profile', '//example.com/abcdefgh/settings/profile'])(
    'falls back to root for unsafe redirect %s',
    async (redirectUrl) => {
      getSession.mockResolvedValue(createSession());

      const result = await runGuard(redirectUrl);

      expect(router.serializeUrl(result as UrlTree)).toBe('/');
    }
  );

  async function runGuard(redirectUrl?: string): Promise<GuardResult> {
    const result = TestBed.runInInjectionContext(
      () => noAuthGuard(createRouteSnapshot(redirectUrl), {} as RouterStateSnapshot) as Observable<GuardResult>
    );
    return firstValueFrom(result);
  }

  function createRouteSnapshot(redirectUrl?: string): ActivatedRouteSnapshot {
    const queryParams: Record<string, string> = {};
    if (redirectUrl !== undefined) {
      queryParams['redirect'] = redirectUrl;
    }

    return {
      queryParamMap: convertToParamMap(queryParams),
    } as ActivatedRouteSnapshot;
  }

  function createSession(): Session {
    return {
      token: 'convex-token',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      userId: 'user_123',
    };
  }
});
