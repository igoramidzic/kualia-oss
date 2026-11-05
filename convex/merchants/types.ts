import { type Infer, v } from 'convex/values';

export const merchantChoiceValidator = v.object({
  _id: v.id('merchant'),
  name: v.string(),
  logoUrl: v.optional(v.string()),
  isDeleted: v.boolean(),
  suggestedCategoryIds: v.optional(v.array(v.id('category'))),
  suggestedBankAccountId: v.optional(v.id('bankAccount')),
});

export type MerchantChoice = Infer<typeof merchantChoiceValidator>;
