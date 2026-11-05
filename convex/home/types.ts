import { type Infer, v } from 'convex/values';

const transaction = v.object({
  id: v.id('transaction'),
  name: v.string(),
  accountName: v.string(),
  date: v.string(),
  amount: v.string(),
});
const attentionGroup = v.object({ count: v.number(), hasMore: v.boolean(), items: v.array(transaction) });
export const occurrence = v.object({
  id: v.string(),
  scheduledTransactionId: v.id('scheduledTransaction'),
  logoUrl: v.union(v.string(), v.null()),
  name: v.string(),
  accountId: v.id('bankAccount'),
  accountName: v.string(),
  transferToAccountId: v.union(v.id('bankAccount'), v.null()),
  transferToAccountName: v.union(v.string(), v.null()),
  date: v.string(),
  day: v.number(),
  amount: v.string(),
  isTransfer: v.boolean(),
  isOverdue: v.boolean(),
});
export const forecastAccount = v.object({
  id: v.id('bankAccount'),
  name: v.string(),
  currentBalance: v.string(),
  points: v.array(v.object({ day: v.number(), amount: v.string() })),
  lowestDay: v.number(),
  lowestBalance: v.string(),
  hasUpcoming: v.boolean(),
});
export const dashboard = v.object({
  workspace: v.object({
    id: v.id('workspace'),
    name: v.string(),
    currencyCode: v.string(),
    minorUnit: v.number(),
    timezoneIdentifier: v.string(),
  }),
  today: v.string(),
  throughDate: v.string(),
  isPartial: v.boolean(),
  reviews: attentionGroup,
  uncategorized: attentionGroup,
  accounts: v.array(forecastAccount),
  upcoming: v.array(occurrence),
  upcomingCount: v.number(),
  overdue: v.array(occurrence),
  overdueCount: v.number(),
  incoming: v.string(),
  outgoing: v.string(),
  spending: v.union(
    v.object({ current: v.string(), previous: v.string(), currentStart: v.string(), previousStart: v.string() }),
    v.null()
  ),
});

export type HomeOccurrence = Infer<typeof occurrence>;
export type HomeForecastAccount = Infer<typeof forecastAccount>;
export type HomeDashboard = Infer<typeof dashboard>;
