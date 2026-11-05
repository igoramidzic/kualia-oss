import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportingService, TrackingEvent, WEB_ONBOARDING_ANALYTICS_PROPERTIES } from '../../services/reporting.service';
import { WorkspaceService } from '../../services/workspace.service';
import { OnboardingComponent } from './onboarding';

describe('OnboardingComponent analytics', () => {
  let component: OnboardingComponent;
  let capture: ReturnType<typeof vi.fn>;
  let completeOnboarding: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    capture = vi.fn();
    completeOnboarding = vi.fn().mockResolvedValue(undefined);
    navigate = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: WorkspaceService,
          useValue: {
            completeOnboarding,
            workspaceId: signal('workspace_12345678'),
          },
        },
        { provide: ReportingService, useValue: { capture } },
        { provide: Router, useValue: { navigate } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new OnboardingComponent());
  });

  it('captures workspace onboarding step and completion events', async () => {
    await component.continue();

    expect(capture).toHaveBeenCalledWith(TrackingEvent.WORKSPACE_ONBOARDING_STEP_COMPLETED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      step: 'complete',
      step_index: 0,
    });
    expect(capture).toHaveBeenCalledWith(
      TrackingEvent.WORKSPACE_ONBOARDING_COMPLETED,
      WEB_ONBOARDING_ANALYTICS_PROPERTIES
    );
    expect(navigate).toHaveBeenCalledWith(['12345678', 'budget']);
  });
});
