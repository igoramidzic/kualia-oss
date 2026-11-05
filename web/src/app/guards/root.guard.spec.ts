import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type RouterStateSnapshot, type UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../services/auth.service';
import { LocalAuthService } from '../services/local-auth.service';
import { ConvexService } from '../services/convex.service';
import { rootGuard } from './root.guard';

describe('rootGuard profile bootstrap', () => {
  let ensureCurrentUserProfile: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let query: ReturnType<typeof vi.fn>;
  let router: Router;

  beforeEach(() => {
    ensureCurrentUserProfile = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ onboardingCompleted: false });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            getSession: vi.fn().mockResolvedValue({
              token: 'token',
              expiresAt: new Date('2026-08-03T12:00:00.000Z'),
              userId: 'user_1',
            }),
          },
        },
        {
          provide: LocalAuthService,
          useValue: {
            loading: signal(false).asReadonly(),
          },
        },
        {
          provide: ConvexService,
          useValue: {
            isAuthenticated: vi.fn().mockReturnValue(true),
            ensureCurrentUserProfile,
            getClient: vi.fn().mockReturnValue({ query }),
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('ensures the profile once instead of polling getCurrentProfile', async () => {
    const result = await TestBed.runInInjectionContext(() => rootGuard({} as never, {} as RouterStateSnapshot));

    expect(ensureCurrentUserProfile).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(router.serializeUrl(result as UrlTree)).toBe('/user-onboarding');
  });
});
