import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { buildFamilyGroupInviteUrl, buildFamilyInviteSentDiscordNotification } from './helpers';

const KUALIA_APP_URL_ENV_VAR = 'KUALIA_APP_URL';

interface InviteRecord {
  _id: Id<'familyGroupInvite'>;
  familyGroupId: Id<'familyGroup'>;
  invitedEmail: string;
  invitedName: string;
  inviteToken: string;
  expiresAt: string;
  sendCount: number;
  created: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const convexError = error;
    if (typeof convexError.data === 'string') {
      return convexError.data;
    }
    if (convexError.data && typeof convexError.data === 'object' && 'message' in convexError.data) {
      const dataWithMessage = convexError.data as { message: string };
      return dataWithMessage.message;
    }
  }

  if (error instanceof Error) {
    const match = /(?:Uncaught\s+)?ConvexError:\s*([\s\S]*?)(?:\s+at\s+handler\s+\(|\s+Called by client|$)/.exec(
      error.message
    );

    return match ? match[1].trim() : error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown email delivery error';
}

export const createInvite = action({
  args: {
    invitedEmail: v.string(),
    invitedName: v.string(),
  },
  handler: async (ctx, args): Promise<InviteRecord> => {
    const prepared = await ctx
      .runMutation(internal.familyGroups.mutations.prepareInviteForSend, args)
      .catch((error: unknown) => {
        throw new ConvexError(getErrorMessage(error));
      });
    const idempotencyKey = `family-invite-${prepared._id}-${prepared.sendCount}`.slice(0, 100);

    try {
      await ctx.runAction(internal.notifications.loops.sendFamilyInviteEmail, {
        email: prepared.invitedEmail,
        inviteeName: prepared.invitedName,
        inviterName: prepared.invitedByName,
        inviterEmail: prepared.invitedByEmail,
        familyGroupName: prepared.familyGroupName,
        inviteLink: buildFamilyGroupInviteUrl(prepared.inviteToken, process.env[KUALIA_APP_URL_ENV_VAR]),
        expiresAt: prepared.expiresAt,
        idempotencyKey,
      });
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const failedAt = new Date().toISOString();

      try {
        await ctx.runMutation(internal.familyGroups.mutations.failInviteSend, {
          inviteId: prepared._id,
          errorMessage,
          failedAt,
        });
      } catch (recordError: unknown) {
        console.error('Failed to record family invite email error:', recordError);
      }

      throw new ConvexError('Failed to send invite. Please try again.');
    }

    const finalized = await ctx.runMutation(internal.familyGroups.mutations.finalizeInviteSend, {
      inviteId: prepared._id,
      invitedName: prepared.invitedName,
      invitedByName: prepared.invitedByName,
      invitedByEmail: prepared.invitedByEmail,
      inviteToken: prepared.inviteToken,
      expiresAt: prepared.expiresAt,
      sendCount: prepared.sendCount,
      sentAt: new Date().toISOString(),
      created: prepared.created,
    });

    try {
      await ctx.runAction(
        internal.discord.sendDiscordNotification,
        buildFamilyInviteSentDiscordNotification({
          familyGroupName: prepared.familyGroupName,
          invitedByName: prepared.invitedByName,
          invitedByEmail: prepared.invitedByEmail,
          invitedName: prepared.invitedName,
          invitedEmail: prepared.invitedEmail,
        })
      );
    } catch (error: unknown) {
      console.error('Failed to send Discord notification for family invite:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return finalized;
  },
});
