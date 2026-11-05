import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';

interface ClerkUserWebhookData {
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEmailFromClerkUserData(userData: Record<string, unknown>): string {
  const emailAddresses = userData['email_addresses'];
  if (!Array.isArray(emailAddresses)) {
    return '';
  }

  const primaryEmailAddressId = normalizeOptionalString(userData['primary_email_address_id']);
  const emailAddressRecords = emailAddresses.filter(isRecord);
  const primaryEmailAddress = emailAddressRecords.find(
    (emailAddress) => normalizeOptionalString(emailAddress['id']) === primaryEmailAddressId
  );
  const selectedEmailAddress = primaryEmailAddress ?? emailAddressRecords[0];

  return normalizeOptionalString(selectedEmailAddress?.['email_address']) ?? '';
}

export function extractClerkUserWebhookData(payload: Record<string, unknown>): ClerkUserWebhookData {
  const userData = payload['data'];

  if (!isRecord(userData)) {
    throw new Error('Clerk webhook payload is missing user data');
  }

  const clerkId = normalizeOptionalString(userData['id']);

  if (clerkId === undefined) {
    throw new Error('Clerk webhook payload is missing user ID');
  }

  return {
    clerkId,
    email: getEmailFromClerkUserData(userData),
    firstName: normalizeOptionalString(userData['first_name']),
    lastName: normalizeOptionalString(userData['last_name']),
  };
}

/**
 * Handle user.created and user.updated webhook events
 */
export async function handleUserWebhook(ctx: ActionCtx, payload: Record<string, unknown>): Promise<Response> {
  const eventType = payload['type'] as string;
  const { clerkId, email, firstName, lastName } = extractClerkUserWebhookData(payload);

  // Create or update the user profile
  await ctx.runMutation(internal.clerk.createUserFromClerk, {
    clerkId,
    email,
    firstName,
  });

  // Send notifications on user.created events
  if (eventType === 'user.created') {
    // NOTE: Workspace creation has been moved to the onboarding flow
    // The user will create their first workspace after completing onboarding
    // See userProfiles/update.ts -> completeUserOnboarding mutation

    // Create or update contact in Loops audience for marketing emails
    // Uses updateContact for upsert behavior - creates new contacts or updates existing ones
    try {
      await ctx.runAction(internal.notifications.loops.updateContact, {
        email,
        firstName,
        lastName,
        userId: clerkId,
        source: 'Kualia App',
      });
    } catch (error: unknown) {
      // Don't fail the webhook if Loops contact update fails
      console.error('Failed to update Loops contact:', {
        error: error instanceof Error ? error.message : String(error),
        email,
      });
    }

    // Send Discord notification for new user signup
    try {
      await ctx.runAction(internal.discord.sendDiscordNotification, {
        channel: 'user-signup',
        title: 'User Signed Up',
        description: email,
        emoji: '👋',
        userId: clerkId,
        metadata: { email },
      });
    } catch (error: unknown) {
      // Don't fail the webhook if Discord notification fails
      console.error('Failed to send Discord notification for user signup:', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return new Response('User profile created/updated', { status: 200 });
}

/**
 * Keep Kualia data deletion in sync when a user is removed directly in Clerk.
 */
export async function handleUserDeletedWebhook(ctx: ActionCtx, payload: Record<string, unknown>): Promise<Response> {
  const { clerkId } = extractClerkUserWebhookData(payload);
  const deletedAt = new Date().toISOString();
  const deletion = await ctx.runMutation(internal.accountDeletion.mutations.softDeleteAccountFromClerk, {
    clerkId,
    deletedAt,
  });

  if (deletion) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.actionsNode.retryExternalDeletion, {
      clerkId,
      attempt: 1,
    });
  }

  return new Response('User deletion recorded', { status: 200 });
}
