import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { nucleoArrowLeft as ArrowLeft, NucleoIcon } from '@kualia/icons';
import type { FunctionReturnType } from 'convex/server';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from 'ngx-sonner';
import { api } from '../../../../../convex/_generated/api';
import { UserNavbarComponent } from '../../components/user-navbar/user-navbar';
import { AuthService } from '../../services/auth.service';
import { ConvexService } from '../../services/convex.service';
import { ReportingService, TrackingEvent, WEB_ONBOARDING_ANALYTICS_PROPERTIES } from '../../services/reporting.service';
import { HlmProgress, HlmProgressIndicator } from '../../ui/progress/src';
import { CompleteStepComponent } from './steps/complete-step.component';
import { FinancialGoalsStepComponent } from './steps/financial-goals-step.component';
import { HouseholdStepComponent } from './steps/household-step.component';
import { HousingStepComponent } from './steps/housing-step.component';
import { NameStepComponent } from './steps/name-step.component';
import { TransportationStepComponent } from './steps/transportation-step.component';
import {
  type FinancialGoal,
  type HouseholdType,
  type HousingType,
  ONBOARDING_STEP_ANALYTICS_KEYS,
  OnboardingStep,
  STEP_CONFIGS,
  TOTAL_STEPS,
  type TransportationType,
} from './types';

@Component({
  selector: 'app-user-onboarding',
  imports: [
    HlmButton,
    HlmProgress,
    HlmProgressIndicator,
    NucleoIcon,
    UserNavbarComponent,
    NameStepComponent,
    HousingStepComponent,
    TransportationStepComponent,
    HouseholdStepComponent,
    FinancialGoalsStepComponent,
    CompleteStepComponent,
  ],
  templateUrl: './user-onboarding.html',
  styleUrl: './user-onboarding.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserOnboardingComponent {
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly OnboardingStep = OnboardingStep;

  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly convexService = inject(ConvexService);
  private readonly reportingService = inject(ReportingService);

  // Current step
  readonly currentStep = signal<OnboardingStep>(OnboardingStep.Name);

  // Form data - pre-populate first name from auth if available
  readonly name = signal<string>(this.getAuthFirstName());

  constructor() {
    this.reportingService.capture(TrackingEvent.ONBOARDING_STARTED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      entry_step: ONBOARDING_STEP_ANALYTICS_KEYS[OnboardingStep.Name],
    });

    // Update first name if auth user loads after component init
    effect(() => {
      const firstName = this.getAuthFirstName();
      if (firstName && !this.name()) {
        this.name.set(firstName);
      }
    });
  }
  readonly housing = signal<HousingType | null>(null);
  readonly transportation = signal<TransportationType[]>([]);
  readonly household = signal<HouseholdType[]>([]);
  readonly financialGoals = signal<FinancialGoal[]>([]);

  // Loading state
  readonly loading = signal(false);

  // Computed values
  readonly stepConfig = computed(() => STEP_CONFIGS[this.currentStep()]);

  readonly progress = computed(() => ((this.currentStep() + 1) / TOTAL_STEPS) * 100);

  readonly canGoBack = computed(() => this.currentStep() > OnboardingStep.Name);

  readonly canContinue = computed(() => {
    switch (this.currentStep()) {
      case OnboardingStep.Name:
        return this.name().trim().length > 0;
      case OnboardingStep.Housing:
        return this.housing() !== null;
      case OnboardingStep.Transportation:
        return this.transportation().length > 0;
      case OnboardingStep.Household:
        return this.household().length > 0;
      case OnboardingStep.FinancialGoals:
        return this.financialGoals().length > 0;
      case OnboardingStep.Complete:
        return true;
      default:
        return false;
    }
  });

  readonly continueButtonText = computed(() => {
    if (this.currentStep() === OnboardingStep.Complete) {
      return this.loading() ? 'Getting Started...' : 'Get Started';
    }
    return 'Continue';
  });

  goBack(): void {
    if (this.canGoBack()) {
      this.currentStep.update((step) => step - 1);
    }
  }

  async continue(): Promise<void> {
    if (!this.canContinue() || this.loading()) {
      return;
    }

    if (this.currentStep() === OnboardingStep.Complete) {
      await this.completeOnboarding();
    } else {
      // Save name in the background when leaving the name step
      if (this.currentStep() === OnboardingStep.Name) {
        this.saveNameInBackground();
      }
      this.captureStepCompleted(this.currentStep());
      this.currentStep.update((step) => step + 1);
    }
  }

  private saveNameInBackground(): void {
    const trimmedName = this.name().trim();
    // Fire and forget - don't await, don't block UI
    this.convexService.mutation(api.userProfiles.updateProfile, { name: trimmedName }).catch((error: unknown) => {
      console.error('Failed to save name:', error instanceof Error ? error.message : String(error));
    });
  }

  private async completeOnboarding(): Promise<void> {
    this.loading.set(true);

    try {
      // Complete onboarding with questionnaire answers (name already saved in background)
      const trimmedName = this.name().trim();
      await this.convexService.mutation<FunctionReturnType<typeof api.userProfiles.completeUserOnboarding>>(
        api.userProfiles.completeUserOnboarding,
        {
          onboardingAnswers: {
            housing: this.housing()!,
            transportation: this.transportation(),
            household: this.household(),
            financialGoals: this.financialGoals(),
          },
          workspaceName: `${trimmedName}'s Budget`,
        }
      );
      this.captureStepCompleted(OnboardingStep.Complete);
      this.reportingService.capture(TrackingEvent.ONBOARDING_COMPLETED, WEB_ONBOARDING_ANALYTICS_PROPERTIES);

      // Navigate to subscribe page
      await this.router.navigate(['/subscribe']);
    } catch (error: unknown) {
      console.error('Failed to complete onboarding:', error instanceof Error ? error.message : String(error));
      toast.error('Failed to complete onboarding. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  private captureStepCompleted(step: OnboardingStep): void {
    this.reportingService.capture(TrackingEvent.ONBOARDING_STEP_COMPLETED, {
      ...WEB_ONBOARDING_ANALYTICS_PROPERTIES,
      step: ONBOARDING_STEP_ANALYTICS_KEYS[step],
      step_index: step,
      ...this.getStepSelectionProperties(step),
    });
  }

  private getStepSelectionProperties(step: OnboardingStep): Record<string, unknown> {
    switch (step) {
      case OnboardingStep.Housing: {
        const housing = this.housing();
        return housing ? { value: housing } : {};
      }
      case OnboardingStep.Transportation:
        return { values: this.transportation() };
      case OnboardingStep.Household:
        return { values: this.household() };
      case OnboardingStep.FinancialGoals:
        return { values: this.financialGoals() };
      case OnboardingStep.Name:
      case OnboardingStep.Complete:
        return {};
      default:
        return {};
    }
  }

  private getAuthFirstName(): string {
    return this.authService.user()?.firstName?.trim().replace(/\s+/g, ' ') ?? '';
  }

  // Handlers for step changes
  onNameChange(value: string): void {
    this.name.set(value);
  }

  onHousingChange(value: HousingType): void {
    this.housing.set(value);
  }

  onTransportationChange(value: TransportationType[]): void {
    this.transportation.set(value);
  }

  onHouseholdChange(value: HouseholdType[]): void {
    this.household.set(value);
  }

  onFinancialGoalsChange(value: FinancialGoal[]): void {
    this.financialGoals.set(value);
  }
}
