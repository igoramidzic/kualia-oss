import type { KualiaIconData } from '@kualia/icons';
import {
  kualiaKey,
  kualiaHouse,
  kualiaFamily,
  kualiaCar,
  kualiaBus,
  kualiaBicycle,
  kualiaUser,
  kualiaUsers,
  kualiaChild,
  kualiaPaw,
  kualiaShield,
  kualiaPlane,
  kualiaArrowDownRight,
  kualiaLeaf,
  kualiaGraduation,
} from '@kualia/icons';

// Step definitions
export enum OnboardingStep {
  Name = 0,
  Housing = 1,
  Transportation = 2,
  Household = 3,
  FinancialGoals = 4,
  Complete = 5,
}

export const TOTAL_STEPS = 6;

export type OnboardingStepAnalyticsKey =
  | 'name'
  | 'housing'
  | 'transportation'
  | 'household'
  | 'financialGoals'
  | 'complete';

export const ONBOARDING_STEP_ANALYTICS_KEYS = {
  [OnboardingStep.Name]: 'name',
  [OnboardingStep.Housing]: 'housing',
  [OnboardingStep.Transportation]: 'transportation',
  [OnboardingStep.Household]: 'household',
  [OnboardingStep.FinancialGoals]: 'financialGoals',
  [OnboardingStep.Complete]: 'complete',
} as const satisfies Record<OnboardingStep, OnboardingStepAnalyticsKey>;

// Option interface for selection cards
export interface OnboardingOption<T extends string> {
  value: T;
  title: string;
  description: string;
  icon: KualiaIconData;
}

// Housing types (single select)
export type HousingType = 'rent' | 'own' | 'family';

export const HOUSING_OPTIONS: OnboardingOption<HousingType>[] = [
  {
    value: 'rent',
    title: 'I rent',
    description: 'Apartment, house, or other rental',
    icon: kualiaKey,
  },
  {
    value: 'own',
    title: 'I own my home',
    description: 'Mortgage or paid off',
    icon: kualiaHouse,
  },
  {
    value: 'family',
    title: 'I live with family',
    description: 'Living with parents or relatives',
    icon: kualiaFamily,
  },
];

// Transportation types (multi select)
export type TransportationType = 'car' | 'transit' | 'walk_bike';

export const TRANSPORTATION_OPTIONS: OnboardingOption<TransportationType>[] = [
  {
    value: 'car',
    title: 'Car',
    description: 'Own or lease a vehicle',
    icon: kualiaCar,
  },
  {
    value: 'transit',
    title: 'Public transit',
    description: 'Bus, train, or subway',
    icon: kualiaBus,
  },
  {
    value: 'walk_bike',
    title: 'Walk or bike',
    description: 'Primarily walk or bicycle',
    icon: kualiaBicycle,
  },
];

// Household types (multi select)
export type HouseholdType = 'just_me' | 'partner' | 'children' | 'pets';

export const HOUSEHOLD_OPTIONS: OnboardingOption<HouseholdType>[] = [
  {
    value: 'just_me',
    title: 'Just me',
    description: 'Living solo',
    icon: kualiaUser,
  },
  {
    value: 'partner',
    title: 'Partner/Spouse',
    description: 'Living with a significant other',
    icon: kualiaUsers,
  },
  {
    value: 'children',
    title: 'Children',
    description: 'Have kids at home',
    icon: kualiaChild,
  },
  {
    value: 'pets',
    title: 'Pets',
    description: 'Have furry family members',
    icon: kualiaPaw,
  },
];

// Financial goals (multi select)
export type FinancialGoal = 'emergency' | 'vacation' | 'debt' | 'home' | 'retirement' | 'education' | 'car';

export const FINANCIAL_GOALS_OPTIONS: OnboardingOption<FinancialGoal>[] = [
  {
    value: 'emergency',
    title: 'Emergency fund',
    description: 'Build a safety net',
    icon: kualiaShield,
  },
  {
    value: 'vacation',
    title: 'Vacation',
    description: 'Save for travel',
    icon: kualiaPlane,
  },
  {
    value: 'debt',
    title: 'Pay off debt',
    description: 'Pay down credit cards or loans',
    icon: kualiaArrowDownRight,
  },
  {
    value: 'home',
    title: 'Save for a home',
    description: 'Down payment savings',
    icon: kualiaHouse,
  },
  {
    value: 'retirement',
    title: 'Retirement',
    description: 'Long-term investing',
    icon: kualiaLeaf,
  },
  {
    value: 'education',
    title: 'Education',
    description: 'School or training',
    icon: kualiaGraduation,
  },
  {
    value: 'car',
    title: 'Car fund',
    description: 'Save for a vehicle',
    icon: kualiaCar,
  },
];

// Onboarding answers structure (matches backend)
export interface OnboardingAnswers {
  housing: HousingType;
  transportation: TransportationType[];
  household: HouseholdType[];
  financialGoals: FinancialGoal[];
}

// Step metadata for display
export interface StepConfig {
  step: OnboardingStep;
  title: string;
  subtitle?: string;
}

export const STEP_CONFIGS: StepConfig[] = [
  {
    step: OnboardingStep.Name,
    title: "What's your first name?",
    subtitle: "We'll use this to personalize your experience",
  },
  {
    step: OnboardingStep.Housing,
    title: "What's your housing situation?",
    subtitle: 'This helps us suggest relevant budget categories',
  },
  {
    step: OnboardingStep.Transportation,
    title: 'How do you get around?',
    subtitle: 'Select all that apply',
  },
  {
    step: OnboardingStep.Household,
    title: "Who's in your household?",
    subtitle: 'Select all that apply',
  },
  {
    step: OnboardingStep.FinancialGoals,
    title: 'What are your financial priorities?',
    subtitle: 'Select all that apply',
  },
  {
    step: OnboardingStep.Complete,
    title: "You're all set!",
    subtitle: "We've created a personalized budget for you",
  },
];
