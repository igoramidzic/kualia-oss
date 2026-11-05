import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { DISCORD_NOTIFICATIONS_CHANNEL, type DiscordNotificationArgs } from '../lib/discord';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_APP_BASE_URL = 'https://app.kualia.com';
const MAX_FAMILY_GROUP_MEMBERS_FOR_JOIN_CHECK = 7;

export const FAMILY_GROUP_MAX_ADDITIONAL_MEMBERS = 5;
export const FAMILY_GROUP_INVITE_EXPIRATION_DAYS = 14;
export const FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT = 10;
export const FAMILY_GROUP_INVITE_EMAIL_QUOTA_WINDOW_DAYS = 30;

export interface FamilyGroupInviteEmailQuotaState {
  limit: number;
  used: number;
  remaining: number;
  windowStartedAt: string | null;
  windowEndsAt: string | null;
  isExhausted: boolean;
}

export type FamilyGroupInviteJoinStatus =
  | 'available'
  | 'not_found'
  | 'email_mismatch'
  | 'already_in_family'
  | 'must_leave_current_family'
  | 'owner_must_remove_members'
  | 'accepted'
  | 'revoked'
  | 'expired'
  | 'unavailable';

export interface CurrentFamilyGroupJoinState {
  _id: Id<'familyGroup'>;
  name: string;
  role: Doc<'familyGroupMember'>['role'];
  activeMemberCount: number;
  otherActiveMemberCount: number;
}

export interface FamilyGroupInviteJoinAvailability {
  status: FamilyGroupInviteJoinStatus;
  canAccept: boolean;
  invite: Doc<'familyGroupInvite'> | null;
  familyGroup: Doc<'familyGroup'> | null;
  currentUserEmail: string | null;
  currentFamilyGroup: CurrentFamilyGroupJoinState | null;
  activeMembership: Doc<'familyGroupMember'> | null;
}

type FamilyGroupJoinReadCtx = QueryCtx | MutationCtx;

export function normalizeFamilyGroupName(name: string | undefined, ownerName: string | undefined): string {
  const normalizedName = name?.trim().replace(/\s+/g, ' ');
  if (normalizedName && normalizedName.length > 0) {
    return normalizedName;
  }

  const normalizedOwnerName = ownerName?.trim().replace(/\s+/g, ' ');
  return normalizedOwnerName ? `${normalizedOwnerName}'s Family` : 'Kualia Family';
}

export function normalizeInviteEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeInviteName(name: string): string | null {
  const normalized = name.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

export function isWithinFamilyGroupMemberLimit(additionalMemberCount: number): boolean {
  return additionalMemberCount <= FAMILY_GROUP_MAX_ADDITIONAL_MEMBERS;
}

export function getFamilyGroupInviteExpiresAt(now: Date): string {
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + FAMILY_GROUP_INVITE_EXPIRATION_DAYS);
  return expiresAt.toISOString();
}

export function getFamilyGroupInviteEmailQuotaWindowEndsAt(windowStartedAt: Date): string {
  const windowEndsAt = new Date(windowStartedAt);
  windowEndsAt.setUTCDate(windowEndsAt.getUTCDate() + FAMILY_GROUP_INVITE_EMAIL_QUOTA_WINDOW_DAYS);
  return windowEndsAt.toISOString();
}

export function getFamilyGroupInviteEmailQuotaState(
  profile: Pick<Doc<'userProfile'>, 'familyInviteEmailQuotaWindowStartedAt' | 'familyInviteEmailSendsInWindow'>,
  now: Date = new Date()
): FamilyGroupInviteEmailQuotaState {
  const windowStartedAt = profile.familyInviteEmailQuotaWindowStartedAt ?? null;
  const rawUsed = profile.familyInviteEmailSendsInWindow ?? 0;

  if (!windowStartedAt) {
    return {
      limit: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      used: 0,
      remaining: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      windowStartedAt: null,
      windowEndsAt: null,
      isExhausted: false,
    };
  }

  const parsedWindowStartedAt = new Date(windowStartedAt);
  const windowStartedAtTime = parsedWindowStartedAt.getTime();
  if (Number.isNaN(windowStartedAtTime)) {
    return {
      limit: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      used: 0,
      remaining: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      windowStartedAt: null,
      windowEndsAt: null,
      isExhausted: false,
    };
  }

  const windowEndsAt = getFamilyGroupInviteEmailQuotaWindowEndsAt(parsedWindowStartedAt);
  if (new Date(windowEndsAt).getTime() <= now.getTime()) {
    return {
      limit: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      used: 0,
      remaining: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      windowStartedAt: null,
      windowEndsAt: null,
      isExhausted: false,
    };
  }

  const used = Math.min(FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT, Math.max(0, Math.trunc(rawUsed)));
  const remaining = Math.max(0, FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT - used);

  return {
    limit: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
    used,
    remaining,
    windowStartedAt,
    windowEndsAt,
    isExhausted: remaining === 0,
  };
}

export function buildFamilyGroupInviteUrl(inviteToken: string, appBaseUrl?: string): string {
  const rawBaseUrl = appBaseUrl?.trim() ?? DEFAULT_APP_BASE_URL;

  try {
    const parsedBaseUrl = new URL(rawBaseUrl);
    parsedBaseUrl.hash = '';
    parsedBaseUrl.search = '';

    const inviteUrl = new URL(`/family/join/${encodeURIComponent(inviteToken)}`, parsedBaseUrl.toString());
    return inviteUrl.toString();
  } catch (error: unknown) {
    void error;
    const inviteUrl = new URL(`/family/join/${encodeURIComponent(inviteToken)}`, DEFAULT_APP_BASE_URL);
    return inviteUrl.toString();
  }
}

function formatInvitePerson(name: string, email: string): string {
  const normalizedName = name.trim();
  const normalizedEmail = email.trim();

  if (!normalizedName) {
    return normalizedEmail;
  }

  if (!normalizedEmail) {
    return normalizedName;
  }

  if (normalizedName.toLowerCase() === normalizedEmail.toLowerCase()) {
    return normalizedEmail;
  }

  return `${normalizedName} <${normalizedEmail}>`;
}

export function buildFamilyInviteSentDiscordNotification({
  familyGroupName,
  invitedByName,
  invitedByEmail,
  invitedName,
  invitedEmail,
}: {
  familyGroupName: string;
  invitedByName: string;
  invitedByEmail: string;
  invitedName: string;
  invitedEmail: string;
}): DiscordNotificationArgs {
  return {
    channel: DISCORD_NOTIFICATIONS_CHANNEL,
    title: 'Family Invite Sent',
    description: `${invitedByName} invited ${invitedName} to ${familyGroupName}`,
    emoji: '👋',
    userEmail: invitedByEmail,
    metadata: {
      from: formatInvitePerson(invitedByName, invitedByEmail),
      to: formatInvitePerson(invitedName, invitedEmail),
      familyGroup: familyGroupName,
    },
  };
}

export function buildFamilyInviteAcceptedDiscordNotification({
  familyGroupName,
  invitedByName,
  invitedByEmail,
  acceptedByClerkId,
  acceptedByName,
  acceptedByEmail,
}: {
  familyGroupName: string;
  invitedByName: string;
  invitedByEmail: string;
  acceptedByClerkId: string;
  acceptedByName: string;
  acceptedByEmail: string;
}): DiscordNotificationArgs {
  return {
    channel: DISCORD_NOTIFICATIONS_CHANNEL,
    title: 'Family Invite Accepted',
    description: `${acceptedByName} accepted ${invitedByName}'s family invite`,
    emoji: '👋',
    userId: acceptedByClerkId,
    userEmail: acceptedByEmail,
    metadata: {
      from: formatInvitePerson(invitedByName, invitedByEmail),
      to: formatInvitePerson(acceptedByName, acceptedByEmail),
      familyGroup: familyGroupName,
    },
  };
}

function isExpiredInvite(invite: Doc<'familyGroupInvite'>, now: Date): boolean {
  return new Date(invite.expiresAt).getTime() <= now.getTime();
}

function unavailableJoinStatus(invite: Doc<'familyGroupInvite'>, now: Date): FamilyGroupInviteJoinStatus | null {
  if (invite.status === 'revoked') {
    return 'revoked';
  }

  if (invite.status === 'expired' || isExpiredInvite(invite, now)) {
    return 'expired';
  }

  if (invite.status === 'accepted') {
    return 'accepted';
  }

  if (invite.status === 'sending' || invite.status === 'send_failed') {
    return 'unavailable';
  }

  return null;
}

async function getActiveFamilyGroupMembership(
  ctx: FamilyGroupJoinReadCtx,
  clerkId: string
): Promise<Doc<'familyGroupMember'> | null> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId).eq('isDeleted', false))
    .first();
}

async function getActiveFamilyGroupMembers(
  ctx: FamilyGroupJoinReadCtx,
  familyGroupId: Id<'familyGroup'>
): Promise<Doc<'familyGroupMember'>[]> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', familyGroupId).eq('isDeleted', false))
    .take(MAX_FAMILY_GROUP_MEMBERS_FOR_JOIN_CHECK);
}

async function getCurrentFamilyGroupJoinState(
  ctx: FamilyGroupJoinReadCtx,
  membership: Doc<'familyGroupMember'>
): Promise<CurrentFamilyGroupJoinState | null> {
  const familyGroup = await ctx.db.get(membership.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    return null;
  }

  const members = await getActiveFamilyGroupMembers(ctx, familyGroup._id);

  return {
    _id: familyGroup._id,
    name: familyGroup.name,
    role: membership.role,
    activeMemberCount: members.length,
    otherActiveMemberCount: members.filter((member) => member.clerkId !== membership.clerkId).length,
  };
}

function joinAvailability(
  status: FamilyGroupInviteJoinStatus,
  canAccept: boolean,
  invite: Doc<'familyGroupInvite'>,
  familyGroup: Doc<'familyGroup'>,
  currentUserEmail: string | null,
  currentFamilyGroup: CurrentFamilyGroupJoinState | null,
  activeMembership: Doc<'familyGroupMember'> | null
): FamilyGroupInviteJoinAvailability {
  return {
    status,
    canAccept,
    invite,
    familyGroup,
    currentUserEmail,
    currentFamilyGroup,
    activeMembership,
  };
}

export async function getFamilyGroupInviteJoinAvailability(
  ctx: FamilyGroupJoinReadCtx,
  {
    inviteToken,
    userProfile,
    now = new Date(),
  }: {
    inviteToken: string;
    userProfile: Doc<'userProfile'>;
    now?: Date;
  }
): Promise<FamilyGroupInviteJoinAvailability> {
  const normalizedInviteToken = inviteToken.trim();
  if (!normalizedInviteToken) {
    return {
      status: 'not_found',
      canAccept: false,
      invite: null,
      familyGroup: null,
      currentUserEmail: null,
      currentFamilyGroup: null,
      activeMembership: null,
    };
  }

  const invite = await ctx.db
    .query('familyGroupInvite')
    .withIndex('by_inviteToken', (q) => q.eq('inviteToken', normalizedInviteToken))
    .first();

  if (!invite || invite.isDeleted) {
    return {
      status: 'not_found',
      canAccept: false,
      invite: null,
      familyGroup: null,
      currentUserEmail: null,
      currentFamilyGroup: null,
      activeMembership: null,
    };
  }

  const familyGroup = await ctx.db.get(invite.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    return {
      status: 'not_found',
      canAccept: false,
      invite: null,
      familyGroup: null,
      currentUserEmail: null,
      currentFamilyGroup: null,
      activeMembership: null,
    };
  }

  const currentUserEmail = normalizeInviteEmail(userProfile.email);
  const rawActiveMembership = await getActiveFamilyGroupMembership(ctx, userProfile.clerkId);
  const currentFamilyGroup = rawActiveMembership
    ? await getCurrentFamilyGroupJoinState(ctx, rawActiveMembership)
    : null;
  const activeMembership = currentFamilyGroup ? rawActiveMembership : null;
  const unavailable = unavailableJoinStatus(invite, now);

  if (unavailable) {
    if (unavailable === 'accepted' && activeMembership?.familyGroupId === familyGroup._id) {
      return joinAvailability(
        'already_in_family',
        false,
        invite,
        familyGroup,
        currentUserEmail,
        currentFamilyGroup,
        activeMembership
      );
    }

    return joinAvailability(
      unavailable,
      false,
      invite,
      familyGroup,
      currentUserEmail,
      currentFamilyGroup,
      activeMembership
    );
  }

  if (currentUserEmail !== invite.invitedEmail) {
    return joinAvailability(
      'email_mismatch',
      false,
      invite,
      familyGroup,
      currentUserEmail,
      currentFamilyGroup,
      activeMembership
    );
  }

  if (activeMembership) {
    if (activeMembership.familyGroupId === familyGroup._id) {
      return joinAvailability(
        'already_in_family',
        false,
        invite,
        familyGroup,
        currentUserEmail,
        currentFamilyGroup,
        activeMembership
      );
    }

    if (activeMembership.role === 'member') {
      return joinAvailability(
        'must_leave_current_family',
        false,
        invite,
        familyGroup,
        currentUserEmail,
        currentFamilyGroup,
        activeMembership
      );
    }

    if ((currentFamilyGroup?.otherActiveMemberCount ?? 0) > 0) {
      return joinAvailability(
        'owner_must_remove_members',
        false,
        invite,
        familyGroup,
        currentUserEmail,
        currentFamilyGroup,
        activeMembership
      );
    }
  }

  return joinAvailability(
    'available',
    true,
    invite,
    familyGroup,
    currentUserEmail,
    currentFamilyGroup,
    activeMembership
  );
}
