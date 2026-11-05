import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { AppAccessService, type AppAccess } from '../../services/app-access.service';
import { LocalAuthService } from '../../services/local-auth.service';
import { FamilySubscriptionRequiredComponent } from './family-subscription-required';

function createBlockedFamilyAccess(): AppAccess {
  return {
    hasAppAccess: false,
    accessSource: null,
    ownSubscription: null,
    familyAccess: {
      familyGroupId: 'family_group_1' as Id<'familyGroup'>,
      role: 'member',
      ownerClerkId: 'clerk_owner',
      owner: {
        clerkId: 'clerk_owner',
        name: 'Taylor Owner',
        email: 'taylor@example.com',
      },
      ownerHasValidSubscription: false,
    },
  };
}

describe('FamilySubscriptionRequiredComponent', () => {
  let appAccess: WritableSignal<AppAccess | null | undefined>;
  let loading: WritableSignal<boolean>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appAccess = signal<AppAccess | null | undefined>(createBlockedFamilyAccess());
    loading = signal(false);
    navigate = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [FamilySubscriptionRequiredComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AppAccessService,
          useValue: {
            appAccess,
            loading,
          },
        },
        {
          provide: LocalAuthService,
          useValue: {
            logout: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            resolvedTheme: signal<'light' | 'dark'>('light'),
          },
        },
        { provide: Router, useValue: { navigate } },
      ],
    });
  });

  it('shows the family owner who needs to subscribe', () => {
    const fixture = TestBed.createComponent(FamilySubscriptionRequiredComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Taylor Owner');
    expect(text).toContain('taylor@example.com');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('redirects solo users back to subscribe', () => {
    appAccess.set({
      hasAppAccess: false,
      accessSource: null,
      ownSubscription: null,
      familyAccess: null,
    });

    TestBed.createComponent(FamilySubscriptionRequiredComponent);
    TestBed.flushEffects();

    expect(navigate).toHaveBeenCalledWith(['/subscribe']);
  });
});
