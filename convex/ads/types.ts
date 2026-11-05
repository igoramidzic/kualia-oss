import { v } from 'convex/values';
import { WEB_MEASUREMENT_POLICY } from '../../packages/shared/src/analytics/measurement-policy';

export const adConsentRevocation = v.object({
  profileId: v.id('userProfile'),
  token: v.string(),
});

export const facebookAdClick = v.object({
  fbclid: v.string(),
  clickedAt: v.string(),
  clientUserAgent: v.string(),
});

export const adAttributionInput = v.object({
  consent: v.boolean(),
  // Present only after a deliberate browser preference choice, never an automatic regional grant.
  preferenceUpdatedAt: v.optional(v.string()),
  // Optional for stored/old-client compatibility; absent policies cannot send conversions.
  measurementPolicy: v.optional(v.literal(WEB_MEASUREMENT_POLICY)),
  oppref: v.optional(v.string()),
  clickedAt: v.optional(v.string()),
  facebook: v.optional(facebookAdClick),
});

export const storedAdAttribution = adAttributionInput.omit('preferenceUpdatedAt').extend({
  updatedAt: v.string(),
});

export const conversionValue = v.object({ value: v.number(), currency: v.string() });

export const conversionType = v.union(
  v.literal('registration_completed'),
  v.literal('trial_started'),
  v.literal('subscription_created'),
  v.literal('order_created')
);
