import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { AppAccessService, type AppAccess } from '../../services/app-access.service';
import { LocalAuthService } from '../../services/local-auth.service';
import { ReportingService, TrackingEvent, WEB_ONBOARDING_ANALYTICS_PROPERTIES } from '../../services/reporting.service';
import { SubscribeComponent } from './subscribe';

describe('SubscribeComponent analytics', () => {
  let component: SubscribeComponent;
  let capture: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let appAccess: WritableSignal<AppAccess | null | undefined>;

  function createAppAccess(hasAppAccess: boolean): AppAccess {
    return {
      hasAppAccess,
      accessSource: hasAppAccess ? 'own_subscription' : null,
      ownSubscription: null,
      familyAccess: null,
    };
  }

  beforeEach(() => {
    capture = vi.fn();
    navigate = vi.fn().mockResolvedValue(true);
    appAccess = signal(createAppAccess(false));

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: LocalAuthService,
          useValue: {
            user: signal({ id: 'user_123' }),
            logout: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AppAccessService,
          useValue: {
            appAccess,
            hasActiveAccess: signal(false),
            loading: signal(false),
            refresh: vi.fn().mockResolvedValue(createAppAccess(false)),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            resolvedTheme: signal<'light' | 'dark'>('light'),
          },
        },
        { provide: ReportingService, useValue: { capture } },
        { provide: Router, useValue: { navigate } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new SubscribeComponent());
    TestBed.flushEffects();
  });

  it('captures paywall view when opening RevenueCat billing', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    component.openPaywall();

    expect(capture).toHaveBeenCalledWith(TrackingEvent.PAYWALL_VIEWED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      source: 'subscribe_page',
      paywall_provider: 'revenuecat',
      paywall_surface: 'web_billing',
    });
    expect(openSpy).toHaveBeenCalledWith(`${environment.revenueCat.billingUrl}/user_123`, '_blank');

    openSpy.mockRestore();
  });

  it('navigates away when app access is granted', () => {
    appAccess.set(createAppAccess(true));
    TestBed.flushEffects();

    expect(navigate).toHaveBeenCalledWith(['/workspaces']);
  });
});
