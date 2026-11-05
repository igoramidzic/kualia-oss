import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { requireWorkspaceAccess } from '../lib/auth';

/**
 * Reject a suggested transaction link (LEGACY - deprecated).
 *
 * This mutation handles the OLD linking approach where:
 * - Imported transactions have suggestedLinkId pointing to manual transactions
 * - Rejections are stored in legacyRejectedLinkIds on the imported transaction
 *
 * For the NEW linking approach, use unlinkTransaction instead.
 *
 * Steps:
 * 1. Validates the transaction exists and belongs to the workspace
 * 2. Adds the rejected manual transaction ID to the legacyRejectedLinkIds array
 * 3. Clears the current link suggestion
 * 4. Keeps reviewStatus as 'needs_review' (user still needs to approve the imported transaction)
 *
 * @deprecated Use unlinkTransaction for the new linking approach
 */
export const rejectTransactionLink = mutation({
  args: {
    workspaceId: v.id('workspace'),
    importedTransactionId: v.id('transaction'),
    manualTransactionId: v.id('transaction'),
  },
  handler: async (ctx, args) => {
    const { workspaceId: verifiedWorkspaceId } = await requireWorkspaceAccess(ctx, args.workspaceId);

    const imported = await ctx.db.get(args.importedTransactionId);
    if (!imported || imported.isDeleted) {
      throw new ConvexError('Transaction not found');
    }
    if (imported.workspaceId !== verifiedWorkspaceId) {
      throw new ConvexError('Access denied');
    }

    // Validate this is the suggested link
    if (imported.suggestedLinkId !== args.manualTransactionId) {
      throw new ConvexError('Transaction link mismatch - this is not the suggested link');
    }

    // Add to legacy rejected links list (prevents re-suggesting)
    const rejectedLinks = [...(imported.legacyRejectedLinkIds ?? [])];
    if (!rejectedLinks.includes(args.manualTransactionId)) {
      rejectedLinks.push(args.manualTransactionId);
    }

    await ctx.db.patch(args.importedTransactionId, {
      suggestedLinkId: undefined,
      suggestedLinkConfidence: undefined,
      suggestedLinkReason: undefined,
      legacyRejectedLinkIds: rejectedLinks,
      // Keep as needs_review - user still needs to approve the imported transaction
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  },
});
