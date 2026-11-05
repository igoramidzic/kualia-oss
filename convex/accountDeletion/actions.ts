import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireAuthAction } from '../lib/auth';

export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';

export function isValidAccountDeletionConfirmation(value: string): boolean {
  return value === ACCOUNT_DELETION_CONFIRMATION;
}

export const deleteAccount = action({
  args: {
    confirmation: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: true }> => {
    if (!isValidAccountDeletionConfirmation(args.confirmation)) {
      throw new ConvexError(`Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm account deletion`);
    }

    const identity = await requireAuthAction(ctx);
    return await ctx.runAction(internal.accountDeletion.actionsNode.deleteAccountImpl, {
      clerkId: identity.subject,
    });
  },
});
