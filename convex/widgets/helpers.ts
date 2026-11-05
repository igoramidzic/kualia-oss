import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';

/** Informational usage metadata needs hour-level precision, not a write per widget. */
export function shouldRecordWidgetTokenUse(lastUsedAt: string | undefined, now: number): boolean {
  const previous = lastUsedAt === undefined ? Number.NaN : Date.parse(lastUsedAt);
  return !Number.isFinite(previous) || now - previous >= 60 * 60 * 1_000;
}

/**
 * Validate a widget token from an HTTP request.
 * Returns the clerkId and workspaceId associated with the token,
 * or null if the token is invalid/revoked.
 */
export async function validateWidgetToken(
  ctx: ActionCtx,
  token: string
): Promise<{ clerkId: string; workspaceId: string } | null> {
  const result = await ctx.runQuery(internal.widgets.queries.getWidgetTokenByToken, { token });

  if (!result || result.isRevoked) {
    return null;
  }

  if (shouldRecordWidgetTokenUse(result.lastUsedAt, Date.now())) {
    await ctx.runMutation(internal.widgets.mutations.updateWidgetTokenLastUsed, {
      tokenId: result._id,
    });
  }

  return {
    clerkId: result.clerkId,
    workspaceId: result.workspaceId,
  };
}

/**
 * Extract Bearer token from Authorization header.
 * Returns null if header is missing or malformed.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Generate a cryptographically random token string.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
