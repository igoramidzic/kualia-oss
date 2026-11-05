import { type Infer, v } from 'convex/values';

export const checkInValidator = v.object({
  days: v.number(),
  lastDate: v.string(),
  timezone: v.string(),
  startedAt: v.string(),
});

export type CheckIn = Infer<typeof checkInValidator>;
