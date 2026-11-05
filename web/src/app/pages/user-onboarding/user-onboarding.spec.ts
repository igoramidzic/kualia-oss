import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../../../convex/_generated/api';
import { AuthService } from '../../services/auth.service';
import { ConvexService } from '../../services/convex.service';
import { ReportingService, TrackingEvent, WEB_ONBOARDING_ANALYTICS_PROPERTIES } from '../../services/reporting.service';
import { OnboardingStep } from './types';
import { UserOnboardingComponent } from './user-onboarding';

describe('UserOnboardingComponent analytics', () => {
  let component: UserOnboardingComponent;
  let capture: ReturnType<typeof vi.fn>;
  let mutation: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    capture = vi.fn();
    mutation = vi.fn().mockResolvedValue({ success: true, workspaceId: 'workspace_12345678' });
    navigate = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { user: signal({ name: 'Igor Amidzic', firstName: 'Igor' }) } },
        { provide: ConvexService, useValue: { mutation } },
        { provide: ReportingService, useValue: { capture } },
        { provide: Router, useValue: { navigate } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new UserOnboardingComponent());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('captures onboarding start with web flow properties', () => {
    expect(capture).toHaveBeenCalledWith(TrackingEvent.ONBOARDING_STARTED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      entry_step: 'name',
    });
  });

  it('prefills from Clerk first name instead of full name', () => {
    expect(component.name()).toBe('Igor');
  });

  it('captures completed step names and selected values', async () => {
    capture.mockClear();
    component.currentStep.set(OnboardingStep.Housing);
    component.onHousingChange('rent');

    await component.continue();

    expect(capture).toHaveBeenCalledWith(TrackingEvent.ONBOARDING_STEP_COMPLETED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      step: 'housing',
      step_index: OnboardingStep.Housing,
      value: 'rent',
    });
    expect(component.currentStep()).toBe(OnboardingStep.Transportation);
  });

  it('captures onboarding completion after creating the workspace', async () => {
    capture.mockClear();
    const capability = { profileId: 'profile-1', token: 'a'.repeat(64) };
    mutation.mockResolvedValue({ success: true, workspaceId: 'workspace_12345678', adConsentRevocation: capability });
    component.currentStep.set(OnboardingStep.Complete);
    component.onHousingChange('own');
    component.onTransportationChange(['car']);
    component.onHouseholdChange(['just_me']);
    component.onFinancialGoalsChange(['emergency']);

    await component.continue();

    expect(mutation).toHaveBeenCalledWith(api.userProfiles.completeUserOnboarding, {
      onboardingAnswers: {
        housing: 'own',
        transportation: ['car'],
        household: ['just_me'],
        financialGoals: ['emergency'],
      },
      workspaceName: "Igor's Budget",
    });
    expect(capture).toHaveBeenCalledWith(TrackingEvent.ONBOARDING_STEP_COMPLETED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      step: 'complete',
      step_index: OnboardingStep.Complete,
    });
    expect(capture).toHaveBeenCalledWith(TrackingEvent.ONBOARDING_COMPLETED, WEB_ONBOARDING_ANALYTICS_PROPERTIES);
    expect(navigate).toHaveBeenCalledWith(['/subscribe']);
    expect(document.cookie).not.toContain('kualia_ad_revocation=');
  });

  it('completes signup without fetching measurement eligibility or attaching ad identifiers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    component.currentStep.set(OnboardingStep.Complete);
    component.onHousingChange('own');
    await component.continue();
    expect(mutation).toHaveBeenCalledWith(
      api.userProfiles.completeUserOnboarding,
      expect.not.objectContaining({ adAttribution: expect.anything() })
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/subscribe']);
  });
});
