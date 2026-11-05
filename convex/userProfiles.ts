// Re-export all types

// Re-export all mutations
export { createProfile, ensureCurrentProfile } from './userProfiles/create';

// Re-export all queries
export { getCurrentProfile, getProfileById, searchProfiles } from './userProfiles/queries';
export type {} from './userProfiles/types';
export {
  completeUserOnboarding,
  finishGuidedOnboarding,
  prepareGuidedOnboarding,
  prepareGuidedOnboardingTarget,
  recordCheckIn,
  requestFreeMonth,
  setUserOnboardingCompleted,
  updateApnsDeviceToken,
  updateNotificationPreference,
  updateNotificationPreferences,
  updateProfile,
} from './userProfiles/update';

// Re-export helpers that might be used elsewhere
// (helpers.ts is currently empty, but reserved for future helper functions)
