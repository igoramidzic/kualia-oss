import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { conversionType, conversionValue, facebookAdClick } from './types';

// Keep the original validators so already-scheduled jobs drain safely after deployment.
// Advertising conversion sharing is retired, including retries and previously consented clicks.
export const send = internalAction({
  args: {
    profileId: v.id('userProfile'),
    type: conversionType,
    eventId: v.string(),
    timestamp: v.string(),
    attempt: v.number(),
    oppref: v.string(),
    clickedAt: v.string(),
  },
  returns: v.null(),
  handler: async (): Promise<null> => null,
});

export const sendFacebook = internalAction({
  args: {
    profileId: v.id('userProfile'),
    type: conversionType,
    eventId: v.string(),
    timestamp: v.string(),
    attempt: v.number(),
    facebook: facebookAdClick,
    value: v.optional(conversionValue),
  },
  returns: v.null(),
  handler: async (): Promise<null> => null,
});
