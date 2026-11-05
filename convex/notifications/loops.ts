import { v } from 'convex/values';

import { internalAction } from '../_generated/server';

const LOOPS_API_BASE = 'https://app.loops.so/api/v1';
const LOOPS_API_KEY_ENV_VAR = 'LOOPS_API_KEY';
const LOOPS_FAMILY_INVITE_TRANSACTIONAL_ID_ENV_VAR = 'LOOPS_FAMILY_INVITE_TRANSACTIONAL_ID';

interface LoopsApiFetchOptions {
  method?: 'POST' | 'PUT';
  idempotencyKey?: string;
  tolerateNotFound?: boolean;
}

interface LoopsCreateContactBody {
  email: string;
  firstName?: string;
  lastName?: string;
  userId: string;
  source: string;
}

interface LoopsUpdateContactBody {
  email: string;
  firstName?: string;
  lastName?: string;
  userId?: string;
  source?: string;
  subscriptionStatus?: string;
  subscribed?: boolean;
}

interface LoopsUpdateContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  userId?: string;
  source?: string;
  subscriptionStatus?: string;
  subscribed?: boolean;
}

export function buildLoopsDeleteContactBody(userId: string): { userId: string } {
  return { userId };
}

export function parseLoopsApiResponse(text: string): Record<string, unknown> {
  if (text.length === 0) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { message: text };
  }

  return {};
}

export function getLoopsApiMessage(result: Record<string, unknown>, fallback: string): string {
  const message = result['message'];
  return typeof message === 'string' && message.trim().length > 0 ? message : fallback;
}

export function buildLoopsUpdateContactBody(args: LoopsUpdateContactInput): LoopsUpdateContactBody {
  const body: LoopsUpdateContactBody = {
    email: args.email,
  };

  if (args.firstName !== undefined) {
    body.firstName = args.firstName;
  }
  if (args.lastName !== undefined) {
    body.lastName = args.lastName;
  }
  if (args.userId !== undefined) {
    body.userId = args.userId;
  }
  if (args.source !== undefined) {
    body.source = args.source;
  }
  if (args.subscriptionStatus !== undefined) {
    body.subscriptionStatus = args.subscriptionStatus;
  }
  if (args.subscribed !== undefined) {
    body.subscribed = args.subscribed;
  }

  return body;
}

/**
 * Loops.so API client for managing contacts in the audience
 *
 * Environment variables required:
 * - LOOPS_API_KEY: API key from Loops settings
 */

/**
 * Call the Loops API with the given path and body.
 * Returns the parsed JSON response.
 */
async function loopsApiFetch(
  apiKey: string,
  path: string,
  body: object,
  options?: LoopsApiFetchOptions
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (options?.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(`${LOOPS_API_BASE}${path}`, {
    method: options?.method ?? 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = parseLoopsApiResponse(text);

  if (response.status === 404 && options?.tolerateNotFound === true) {
    return { success: true, notFound: true };
  }

  if (response.status === 409 && options?.idempotencyKey !== undefined) {
    console.warn(`Loops API idempotency key already used: ${options.idempotencyKey}`);
    return { success: true, idempotentReplay: true };
  }

  if (!response.ok) {
    throw new Error(`Loops API error (${response.status}): ${getLoopsApiMessage(parsed, text)}`);
  }

  if (parsed['success'] === false) {
    throw new Error(getLoopsApiMessage(parsed, 'Loops API returned an unsuccessful response'));
  }

  return parsed;
}

/**
 * Create a contact in the Loops audience
 *
 * This is called when a new user signs up to add them to the marketing audience.
 * Uses userId (Clerk ID) as a unique identifier to prevent duplicates.
 */
export const createContact = internalAction({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    userId: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env[LOOPS_API_KEY_ENV_VAR];

    if (!apiKey) {
      console.warn('LOOPS_API_KEY environment variable is not set, skipping contact creation');
      return null;
    }

    try {
      const body: LoopsCreateContactBody = {
        email: args.email,
        userId: args.userId,
        source: 'Kualia App',
      };

      if (args.firstName !== undefined) {
        body.firstName = args.firstName;
      }
      if (args.lastName !== undefined) {
        body.lastName = args.lastName;
      }

      const result = await loopsApiFetch(apiKey, '/contacts/update', body);
      const resultIdField = 'id';
      const resultIdValue = result[resultIdField];
      const resultId = typeof resultIdValue === 'string' ? resultIdValue : null;

      if (resultId) {
        console.log(`Loops contact created for email: ${args.email}, id: ${resultId}`);
      } else {
        console.log(`Loops contact created/updated for email: ${args.email}`);
      }

      return result;
    } catch (error: unknown) {
      console.error('Failed to create contact in Loops:', error);
      throw error;
    }
  },
});

/**
 * Update or create a contact in the Loops audience (upsert)
 *
 * This is called when a new user signs up or updates their profile.
 * Uses email to identify the contact. If the contact doesn't exist, Loops will create it.
 * If the contact exists, it will update the fields (firstName, userId, etc.).
 *
 * This upsert behavior is important for v1->v2 migration: existing Supabase users
 * will have their userId updated to the new Clerk ID when they sign in.
 */
export const updateContact = internalAction({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    userId: v.optional(v.string()),
    source: v.optional(v.string()),
    subscriptionStatus: v.optional(v.string()),
    subscribed: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env[LOOPS_API_KEY_ENV_VAR];

    if (!apiKey) {
      console.warn('LOOPS_API_KEY environment variable is not set, skipping contact update');
      return null;
    }

    try {
      const body = buildLoopsUpdateContactBody(args);
      const result = await loopsApiFetch(apiKey, '/contacts/update', body);

      console.log(`Loops contact updated for email: ${args.email}`);
      return result;
    } catch (error: unknown) {
      console.error('Failed to update contact in Loops:', error);
      throw error;
    }
  },
});

/**
 * Permanently remove a contact from the Loops audience.
 * A missing contact is treated as success so account deletion is retry-safe.
 */
export const deleteContact = internalAction({
  args: {
    userId: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env[LOOPS_API_KEY_ENV_VAR];

    if (!apiKey) {
      throw new Error('LOOPS_API_KEY environment variable is not set');
    }

    return await loopsApiFetch(apiKey, '/contacts/delete', buildLoopsDeleteContactBody(args.userId), {
      method: 'POST',
      tolerateNotFound: true,
    });
  },
});

/**
 * Send a family group invite using a configured Loops transactional email.
 *
 * Environment variables required:
 * - LOOPS_API_KEY: API key from Loops settings
 * - LOOPS_FAMILY_INVITE_TRANSACTIONAL_ID: Transactional email ID from Loops
 */
export const sendFamilyInviteEmail = internalAction({
  args: {
    email: v.string(),
    inviteeName: v.string(),
    inviterName: v.string(),
    inviterEmail: v.string(),
    familyGroupName: v.string(),
    inviteLink: v.string(),
    expiresAt: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env[LOOPS_API_KEY_ENV_VAR];
    const transactionalId = process.env[LOOPS_FAMILY_INVITE_TRANSACTIONAL_ID_ENV_VAR];

    if (!apiKey) {
      throw new Error('LOOPS_API_KEY environment variable is not set');
    }

    if (!transactionalId) {
      throw new Error('LOOPS_FAMILY_INVITE_TRANSACTIONAL_ID environment variable is not set');
    }

    try {
      const result = await loopsApiFetch(
        apiKey,
        '/transactional',
        {
          email: args.email,
          transactionalId,
          addToAudience: false,
          dataVariables: {
            inviteeName: args.inviteeName,
            invitedName: args.inviteeName,
            inviterName: args.inviterName,
            invitedByName: args.inviterName,
            inviterEmail: args.inviterEmail,
            familyGroupName: args.familyGroupName,
            inviteLink: args.inviteLink,
            expiresAt: args.expiresAt,
          },
        },
        {
          method: 'POST',
          idempotencyKey: args.idempotencyKey,
        }
      );

      console.log(`Loops family invite email sent to ${args.email}`);
      return result;
    } catch (error: unknown) {
      console.error('Failed to send family invite email through Loops:', error);
      throw error;
    }
  },
});
