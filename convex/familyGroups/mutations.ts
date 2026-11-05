import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from '../_generated/server';
import { unlinkBankAccountsForSeparatedFamilyMember } from '../bankLinks/helpers';
import { requireUserProfile } from '../lib/auth';
import {
  buildFamilyInviteAcceptedDiscordNotification,
  getFamilyGroupInviteEmailQuotaState,
  getFamilyGroupInviteExpiresAt,
  getFamilyGroupInviteJoinAvailability,
  isWithinFamilyGroupMemberLimit,
  normalizeFamilyGroupName,
  normalizeInviteEmail,
  normalizeInviteName,
} from './helpers';

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

interface PreparedInviteForSend extends InviteRecord {
  invitedByName: string;
  invitedByEmail: string;
  familyGroupName: string;
}

interface AcceptInviteResult {
  accepted: true;
  familyGroupId: Id<'familyGroup'>;
  memberId: Id<'familyGroupMember'>;
  previousFamilyDeleted: boolean;
  alreadyMember: boolean;
}

interface LeaveFamilyGroupResult {
  left: true;
  familyGroupDeleted: boolean;
}

const FAMILY_GROUP_INVITE_STATUSES: Doc<'familyGroupInvite'>['status'][] = [
  'sending',
  'pending',
  'accepted',
  'revoked',
  'expired',
  'send_failed',
];
const FAMILY_GROUP_INVITE_RESERVING_STATUSES: Doc<'familyGroupInvite'>['status'][] = ['sending', 'pending'];

function familyGroupInviteEmailQuotaErrorMessage(windowEndsAt: string | null): string {
  const retryDate = windowEndsAt ? windowEndsAt.slice(0, 10) : 'later';
  return `You can send up to 10 family invite emails every 30 days. Try again after ${retryDate}.`;
}

async function reserveFamilyGroupInviteEmailSend(
  ctx: MutationCtx,
  userProfile: Doc<'userProfile'>,
  now: Date
): Promise<void> {
  const senderProfile = await ctx.db.get(userProfile._id);
  if (!senderProfile || senderProfile.clerkId !== userProfile.clerkId) {
    throw new ConvexError('User profile not found');
  }

  const quota = getFamilyGroupInviteEmailQuotaState(senderProfile, now);
  if (quota.isExhausted) {
    throw new ConvexError(familyGroupInviteEmailQuotaErrorMessage(quota.windowEndsAt));
  }

  const nowIso = now.toISOString();
  await ctx.db.patch(senderProfile._id, {
    familyInviteEmailQuotaWindowStartedAt: quota.windowStartedAt ?? nowIso,
    familyInviteEmailSendsInWindow: quota.used + 1,
  });
}

async function getActiveFamilyGroupByOwnerClerkId(
  ctx: MutationCtx,
  ownerClerkId: string
): Promise<Doc<'familyGroup'> | null> {
  return await ctx.db
    .query('familyGroup')
    .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', ownerClerkId).eq('isDeleted', false))
    .first();
}

async function getActiveFamilyGroupMembership(
  ctx: MutationCtx,
  clerkId: string
): Promise<Doc<'familyGroupMember'> | null> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId).eq('isDeleted', false))
    .first();
}

async function getFamilyGroupMembership(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>,
  clerkId: string
): Promise<Doc<'familyGroupMember'> | null> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_clerkId', (q) => q.eq('familyGroupId', familyGroupId).eq('clerkId', clerkId))
    .first();
}

async function getActiveFamilyGroupMembers(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>
): Promise<Doc<'familyGroupMember'>[]> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', familyGroupId).eq('isDeleted', false))
    .collect();
}

async function getOtherActiveFamilyGroupMembers(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>,
  clerkId: string
): Promise<Doc<'familyGroupMember'>[]> {
  const members = await getActiveFamilyGroupMembers(ctx, familyGroupId);
  return members.filter((member) => member.clerkId !== clerkId);
}

async function ensureInviteCapacity(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>,
  { reserveAdditionalSlot }: { reserveAdditionalSlot: boolean }
): Promise<void> {
  const activeMembers = await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', familyGroupId).eq('isDeleted', false))
    .take(7);
  let reservedInviteCount = 0;
  for (const status of FAMILY_GROUP_INVITE_RESERVING_STATUSES) {
    const invites = await ctx.db
      .query('familyGroupInvite')
      .withIndex('by_familyGroupId_status_isDeleted', (q) =>
        q.eq('familyGroupId', familyGroupId).eq('status', status).eq('isDeleted', false)
      )
      .take(6);
    reservedInviteCount += invites.length;
  }
  const additionalMemberCount = activeMembers.filter((member) => member.role === 'member').length;
  const requestedSlotCount = additionalMemberCount + reservedInviteCount + (reserveAdditionalSlot ? 1 : 0);

  if (!isWithinFamilyGroupMemberLimit(requestedSlotCount)) {
    throw new ConvexError('A family group can include up to five additional members');
  }
}

async function ensureMemberCapacityForAccept(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>,
  clerkId: string
): Promise<void> {
  const activeMembers = await getActiveFamilyGroupMembers(ctx, familyGroupId);
  if (activeMembers.some((member) => member.clerkId === clerkId)) {
    return;
  }

  const additionalMemberCount = activeMembers.filter((member) => member.role === 'member').length;
  if (!isWithinFamilyGroupMemberLimit(additionalMemberCount + 1)) {
    throw new ConvexError('This family group is full');
  }
}

async function getInviteByEmailAndStatus(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>,
  invitedEmail: string,
  status: Doc<'familyGroupInvite'>['status']
): Promise<Doc<'familyGroupInvite'> | null> {
  return await ctx.db
    .query('familyGroupInvite')
    .withIndex('by_familyGroupId_invitedEmail_status_isDeleted', (q) =>
      q.eq('familyGroupId', familyGroupId).eq('invitedEmail', invitedEmail).eq('status', status).eq('isDeleted', false)
    )
    .first();
}

async function isActiveFamilyGroupMemberEmail(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>,
  invitedEmail: string
): Promise<boolean> {
  const activeMembers = await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', familyGroupId).eq('isDeleted', false))
    .take(7);

  for (const member of activeMembers) {
    const profile = await ctx.db.get(member.userProfileId);
    if (profile && normalizeInviteEmail(profile.email) === invitedEmail) {
      return true;
    }
  }

  return false;
}

export async function ensureOwnedFamilyGroup(
  ctx: MutationCtx,
  userProfile: Doc<'userProfile'>,
  now: string
): Promise<Doc<'familyGroup'>> {
  const activeMembership = await getActiveFamilyGroupMembership(ctx, userProfile.clerkId);
  if (activeMembership) {
    const familyGroup = await ctx.db.get(activeMembership.familyGroupId);
    if (familyGroup && !familyGroup.isDeleted) {
      if (activeMembership.role !== 'owner' || familyGroup.ownerClerkId !== userProfile.clerkId) {
        throw new ConvexError('You already belong to a family group');
      }
      return familyGroup;
    }

    // getMine already treats this orphaned membership as no family. Retire it
    // in the same transaction so creation can recover without reviving the old group.
    await softDeleteMembership(ctx, activeMembership, now);
  }

  const existingFamilyGroup = await getActiveFamilyGroupByOwnerClerkId(ctx, userProfile.clerkId);
  if (!existingFamilyGroup) {
    const familyGroupId = await ctx.db.insert('familyGroup', {
      name: normalizeFamilyGroupName(undefined, userProfile.name ?? userProfile.email),
      ownerUserProfileId: userProfile._id,
      ownerClerkId: userProfile.clerkId,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    });

    await ctx.db.insert('familyGroupMember', {
      familyGroupId,
      userProfileId: userProfile._id,
      clerkId: userProfile.clerkId,
      role: 'owner',
      joinedAt: now,
      updatedAt: now,
      isDeleted: false,
    });

    const familyGroup = await ctx.db.get(familyGroupId);
    if (!familyGroup) {
      throw new ConvexError('Family group could not be created');
    }

    return familyGroup;
  }

  const existingMembership = await getFamilyGroupMembership(ctx, existingFamilyGroup._id, userProfile.clerkId);
  if (existingMembership) {
    await ctx.db.patch(existingMembership._id, {
      userProfileId: userProfile._id,
      role: 'owner',
      updatedAt: now,
      isDeleted: false,
      deletedAt: undefined,
    });
  } else {
    await ctx.db.insert('familyGroupMember', {
      familyGroupId: existingFamilyGroup._id,
      userProfileId: userProfile._id,
      clerkId: userProfile.clerkId,
      role: 'owner',
      joinedAt: now,
      updatedAt: now,
      isDeleted: false,
    });
  }

  return existingFamilyGroup;
}

async function requireOwnedFamilyGroupForManagement(
  ctx: MutationCtx,
  userProfile: Doc<'userProfile'>,
  missingGroupMessage: string,
  permissionMessage: string
): Promise<Doc<'familyGroup'>> {
  const activeMembership = await getActiveFamilyGroupMembership(ctx, userProfile.clerkId);
  if (!activeMembership) {
    throw new ConvexError(missingGroupMessage);
  }

  const familyGroup = await ctx.db.get(activeMembership.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    throw new ConvexError('Family group not found');
  }

  if (activeMembership.role !== 'owner' || familyGroup.ownerClerkId !== userProfile.clerkId) {
    throw new ConvexError(permissionMessage);
  }

  return familyGroup;
}

function toPreparedInviteForSend(
  familyGroup: Doc<'familyGroup'>,
  invite: {
    _id: Id<'familyGroupInvite'>;
    invitedEmail: string;
    invitedName: string;
    inviteToken: string;
    expiresAt: string;
    sendCount: number;
  },
  userProfile: Doc<'userProfile'>,
  created: boolean
): PreparedInviteForSend {
  const invitedByName = userProfile.name ?? userProfile.email;

  return {
    _id: invite._id,
    familyGroupId: familyGroup._id,
    invitedEmail: invite.invitedEmail,
    invitedName: invite.invitedName,
    invitedByName,
    invitedByEmail: userProfile.email,
    familyGroupName: familyGroup.name,
    inviteToken: invite.inviteToken,
    expiresAt: invite.expiresAt,
    sendCount: invite.sendCount,
    created,
  };
}

async function prepareExistingPendingInviteForSend(
  familyGroup: Doc<'familyGroup'>,
  existingInvite: Doc<'familyGroupInvite'>,
  userProfile: Doc<'userProfile'>,
  invitedName: string,
  expiresAt: string
): Promise<PreparedInviteForSend> {
  return toPreparedInviteForSend(
    familyGroup,
    {
      _id: existingInvite._id,
      invitedEmail: existingInvite.invitedEmail,
      invitedName,
      inviteToken: existingInvite.inviteToken,
      expiresAt,
      sendCount: existingInvite.sendCount + 1,
    },
    userProfile,
    false
  );
}

async function prepareReusableInviteForSend(
  ctx: MutationCtx,
  familyGroup: Doc<'familyGroup'>,
  existingInvite: Doc<'familyGroupInvite'>,
  userProfile: Doc<'userProfile'>,
  invitedEmail: string,
  invitedName: string,
  inviteToken: string,
  expiresAt: string,
  updatedAt: string
): Promise<PreparedInviteForSend> {
  const sendCount = existingInvite.sendCount + 1;
  const invitedByName = userProfile.name ?? userProfile.email;

  await ctx.db.patch(existingInvite._id, {
    invitedName,
    invitedByUserProfileId: userProfile._id,
    invitedByClerkId: userProfile.clerkId,
    invitedByName,
    invitedByEmail: userProfile.email,
    inviteToken,
    status: 'sending',
    updatedAt,
    lastSendError: undefined,
    lastSendFailedAt: undefined,
    expiresAt,
  });

  return toPreparedInviteForSend(
    familyGroup,
    {
      _id: existingInvite._id,
      invitedEmail,
      invitedName,
      inviteToken,
      expiresAt,
      sendCount,
    },
    userProfile,
    false
  );
}

async function softDeleteMembership(
  ctx: MutationCtx,
  membership: Doc<'familyGroupMember'>,
  nowIso: string
): Promise<void> {
  await ctx.db.patch(membership._id, {
    updatedAt: nowIso,
    isDeleted: true,
    deletedAt: nowIso,
  });
}

async function softDeleteFamilyGroup(ctx: MutationCtx, familyGroup: Doc<'familyGroup'>, nowIso: string): Promise<void> {
  await ctx.db.patch(familyGroup._id, {
    updatedAt: nowIso,
    isDeleted: true,
    deletedAt: nowIso,
  });

  const activeMembers = await getActiveFamilyGroupMembers(ctx, familyGroup._id);
  for (const member of activeMembers) {
    await softDeleteMembership(ctx, member, nowIso);
  }

  for (const status of FAMILY_GROUP_INVITE_STATUSES) {
    const invites = await ctx.db
      .query('familyGroupInvite')
      .withIndex('by_familyGroupId_status_isDeleted', (q) =>
        q.eq('familyGroupId', familyGroup._id).eq('status', status).eq('isDeleted', false)
      )
      .collect();

    for (const invite of invites) {
      await ctx.db.patch(invite._id, {
        status: invite.status === 'pending' || invite.status === 'sending' ? 'revoked' : invite.status,
        updatedAt: nowIso,
        isDeleted: true,
        deletedAt: nowIso,
      });
    }
  }
}

function isFamilyOwner(familyGroup: Doc<'familyGroup'>, membership: Doc<'familyGroupMember'>): boolean {
  return membership.role === 'owner' || familyGroup.ownerClerkId === membership.clerkId;
}

async function leaveCurrentFamilyForInviteIfAllowed(
  ctx: MutationCtx,
  membership: Doc<'familyGroupMember'>,
  targetFamilyGroupId: Id<'familyGroup'>,
  userProfile: Doc<'userProfile'>,
  nowIso: string
): Promise<{ previousFamilyDeleted: boolean; alreadyMember: boolean }> {
  if (membership.familyGroupId === targetFamilyGroupId) {
    return { previousFamilyDeleted: false, alreadyMember: true };
  }

  const currentFamilyGroup = await ctx.db.get(membership.familyGroupId);
  if (!currentFamilyGroup || currentFamilyGroup.isDeleted) {
    await softDeleteMembership(ctx, membership, nowIso);
    return { previousFamilyDeleted: false, alreadyMember: false };
  }

  if (!isFamilyOwner(currentFamilyGroup, membership)) {
    throw new ConvexError('Leave your current family group before accepting this invite');
  }

  const otherMembers = await getOtherActiveFamilyGroupMembers(ctx, currentFamilyGroup._id, userProfile.clerkId);
  if (otherMembers.length > 0) {
    throw new ConvexError('Remove family members before joining a new family group');
  }

  await softDeleteFamilyGroup(ctx, currentFamilyGroup, nowIso);
  return { previousFamilyDeleted: true, alreadyMember: false };
}

async function upsertAcceptedFamilyGroupMembership(
  ctx: MutationCtx,
  familyGroupId: Id<'familyGroup'>,
  userProfile: Doc<'userProfile'>,
  nowIso: string
): Promise<{ memberId: Id<'familyGroupMember'>; alreadyMember: boolean }> {
  const existingMembership = await getFamilyGroupMembership(ctx, familyGroupId, userProfile.clerkId);
  if (existingMembership && !existingMembership.isDeleted) {
    await ctx.db.patch(existingMembership._id, {
      userProfileId: userProfile._id,
      role: existingMembership.role === 'owner' ? 'owner' : 'member',
      updatedAt: nowIso,
    });

    return { memberId: existingMembership._id, alreadyMember: true };
  }

  if (existingMembership) {
    await ctx.db.patch(existingMembership._id, {
      userProfileId: userProfile._id,
      role: 'member',
      joinedAt: nowIso,
      updatedAt: nowIso,
      isDeleted: false,
      deletedAt: undefined,
    });

    return { memberId: existingMembership._id, alreadyMember: false };
  }

  const memberId = await ctx.db.insert('familyGroupMember', {
    familyGroupId,
    userProfileId: userProfile._id,
    clerkId: userProfile.clerkId,
    role: 'member',
    joinedAt: nowIso,
    updatedAt: nowIso,
    isDeleted: false,
  });

  return { memberId, alreadyMember: false };
}

async function markInviteAccepted(ctx: MutationCtx, invite: Doc<'familyGroupInvite'>, nowIso: string): Promise<void> {
  if (invite.status !== 'accepted') {
    await ctx.db.patch(invite._id, {
      status: 'accepted',
      updatedAt: nowIso,
    });
  }
}

async function markUserOnboardingCompleted(
  ctx: MutationCtx,
  userProfile: Doc<'userProfile'>,
  nowIso: string
): Promise<void> {
  if (userProfile.onboardingCompleted === true) {
    return;
  }

  await ctx.db.patch(userProfile._id, {
    onboardingCompleted: true,
    updatedAt: nowIso,
  });
}

async function scheduleFamilyInviteAcceptedDiscordNotification(
  ctx: MutationCtx,
  invite: Doc<'familyGroupInvite'>,
  familyGroup: Doc<'familyGroup'>,
  userProfile: Doc<'userProfile'>
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(
      0,
      internal.discord.sendDiscordNotification,
      buildFamilyInviteAcceptedDiscordNotification({
        familyGroupName: familyGroup.name,
        invitedByName: invite.invitedByName,
        invitedByEmail: invite.invitedByEmail,
        acceptedByClerkId: userProfile.clerkId,
        acceptedByName: userProfile.name ?? userProfile.email,
        acceptedByEmail: userProfile.email,
      })
    );
  } catch (error: unknown) {
    console.error('Failed to schedule Discord notification for family invite acceptance:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function acceptFamilyGroupInviteImpl(
  ctx: MutationCtx,
  {
    inviteToken,
    userProfile,
    now = new Date(),
  }: {
    inviteToken: string;
    userProfile: Doc<'userProfile'>;
    now?: Date;
  }
): Promise<AcceptInviteResult> {
  const normalizedInviteToken = inviteToken.trim();
  if (!normalizedInviteToken) {
    throw new ConvexError('Family invite not found');
  }

  const availability = await getFamilyGroupInviteJoinAvailability(ctx, {
    inviteToken: normalizedInviteToken,
    userProfile,
    now,
  });
  const invite = availability.invite;
  const familyGroup = availability.familyGroup;

  if (!invite || !familyGroup) {
    throw new ConvexError('Family invite not found');
  }

  if (availability.status === 'email_mismatch') {
    throw new ConvexError('Sign in with the email address that received this family invite');
  }

  const nowIso = now.toISOString();
  const targetMembership = await getFamilyGroupMembership(ctx, familyGroup._id, userProfile.clerkId);
  if (invite.status === 'accepted') {
    if (targetMembership && !targetMembership.isDeleted) {
      await markUserOnboardingCompleted(ctx, userProfile, nowIso);
      return {
        accepted: true,
        familyGroupId: familyGroup._id,
        memberId: targetMembership._id,
        previousFamilyDeleted: false,
        alreadyMember: true,
      };
    }

    throw new ConvexError('This family invite has already been accepted');
  }

  if (availability.status === 'expired') {
    await ctx.db.patch(invite._id, {
      status: 'expired',
      updatedAt: nowIso,
    });
    throw new ConvexError('This family invite has expired');
  }

  if (availability.status === 'revoked') {
    throw new ConvexError('This family invite has been revoked');
  }

  if (availability.status === 'unavailable') {
    throw new ConvexError('This family invite is no longer available');
  }

  if (availability.status === 'must_leave_current_family') {
    throw new ConvexError('Leave your current family group before accepting this invite');
  }

  if (availability.status === 'owner_must_remove_members') {
    throw new ConvexError('Remove family members before joining a new family group');
  }

  if (invite.status !== 'pending') {
    throw new ConvexError('This family invite is no longer available');
  }

  const activeMembership =
    availability.activeMembership ?? (await getActiveFamilyGroupMembership(ctx, userProfile.clerkId));
  const currentFamilyResult = activeMembership
    ? await leaveCurrentFamilyForInviteIfAllowed(ctx, activeMembership, familyGroup._id, userProfile, nowIso)
    : { previousFamilyDeleted: false, alreadyMember: false };

  await ensureMemberCapacityForAccept(ctx, familyGroup._id, userProfile.clerkId);

  const membershipResult = await upsertAcceptedFamilyGroupMembership(ctx, familyGroup._id, userProfile, nowIso);
  await markInviteAccepted(ctx, invite, nowIso);
  await markUserOnboardingCompleted(ctx, userProfile, nowIso);
  await scheduleFamilyInviteAcceptedDiscordNotification(ctx, invite, familyGroup, userProfile);

  return {
    accepted: true,
    familyGroupId: familyGroup._id,
    memberId: membershipResult.memberId,
    previousFamilyDeleted: currentFamilyResult.previousFamilyDeleted,
    alreadyMember: currentFamilyResult.alreadyMember || membershipResult.alreadyMember,
  };
}

export async function leaveFamilyGroupImpl(
  ctx: MutationCtx,
  {
    userProfile,
    now = new Date(),
  }: {
    userProfile: Doc<'userProfile'>;
    now?: Date;
  }
): Promise<LeaveFamilyGroupResult> {
  const activeMembership = await getActiveFamilyGroupMembership(ctx, userProfile.clerkId);
  if (!activeMembership) {
    throw new ConvexError('You are not in a family group');
  }

  const nowIso = now.toISOString();
  const familyGroup = await ctx.db.get(activeMembership.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    await softDeleteMembership(ctx, activeMembership, nowIso);
    return { left: true, familyGroupDeleted: false };
  }

  const activeFamilyMemberClerkIds = (await getActiveFamilyGroupMembers(ctx, familyGroup._id)).map(
    (member) => member.clerkId
  );

  if (isFamilyOwner(familyGroup, activeMembership)) {
    const otherMembers = await getOtherActiveFamilyGroupMembers(ctx, familyGroup._id, userProfile.clerkId);
    if (otherMembers.length > 0) {
      throw new ConvexError('Remove family members before leaving this family group');
    }

    await unlinkBankAccountsForSeparatedFamilyMember(ctx, {
      memberClerkId: userProfile.clerkId,
      familyMemberClerkIds: activeFamilyMemberClerkIds,
      nowIso,
    });
    await softDeleteFamilyGroup(ctx, familyGroup, nowIso);
    return { left: true, familyGroupDeleted: true };
  }

  await unlinkBankAccountsForSeparatedFamilyMember(ctx, {
    memberClerkId: userProfile.clerkId,
    familyMemberClerkIds: activeFamilyMemberClerkIds,
    nowIso,
  });
  await softDeleteMembership(ctx, activeMembership, nowIso);
  return { left: true, familyGroupDeleted: false };
}

export const createGroup = mutation({
  args: {},
  handler: async (ctx): Promise<Id<'familyGroup'>> => {
    const { userProfile } = await requireUserProfile(ctx);

    const nowIso = new Date().toISOString();
    const familyGroup = await ensureOwnedFamilyGroup(ctx, userProfile, nowIso);

    return familyGroup._id;
  },
});

export const acceptInvite = mutation({
  args: {
    inviteToken: v.string(),
  },
  handler: async (ctx, args): Promise<AcceptInviteResult> => {
    const { userProfile } = await requireUserProfile(ctx);
    return await acceptFamilyGroupInviteImpl(ctx, {
      inviteToken: args.inviteToken,
      userProfile,
    });
  },
});

export const leaveGroup = mutation({
  args: {},
  handler: async (ctx): Promise<LeaveFamilyGroupResult> => {
    const { userProfile } = await requireUserProfile(ctx);
    return await leaveFamilyGroupImpl(ctx, { userProfile });
  },
});

export async function prepareInviteForSendImpl(
  ctx: MutationCtx,
  {
    invitedEmail: rawInvitedEmail,
    invitedName: rawInvitedName,
    userProfile,
    now = new Date(),
    createInviteToken = () => crypto.randomUUID(),
  }: {
    invitedEmail: string;
    invitedName: string;
    userProfile: Doc<'userProfile'>;
    now?: Date;
    createInviteToken?: () => string;
  }
): Promise<PreparedInviteForSend> {
  const invitedEmail = normalizeInviteEmail(rawInvitedEmail);
  if (!invitedEmail) {
    throw new ConvexError('Enter a valid email address');
  }

  const invitedName = normalizeInviteName(rawInvitedName);
  if (!invitedName) {
    throw new ConvexError('Enter a name for the invite');
  }

  if (normalizeInviteEmail(userProfile.email) === invitedEmail) {
    throw new ConvexError("You can't invite yourself to your family group");
  }

  const nowIso = now.toISOString();
  const familyGroup = await requireOwnedFamilyGroupForManagement(
    ctx,
    userProfile,
    'Create a family group before inviting members',
    'Only the family group owner can invite members'
  );
  if (await isActiveFamilyGroupMemberEmail(ctx, familyGroup._id, invitedEmail)) {
    throw new ConvexError('This person is already in your family group');
  }

  const expiresAt = getFamilyGroupInviteExpiresAt(now);
  const invitedByName = userProfile.name ?? userProfile.email;
  const inviteToken = createInviteToken();
  const existingPendingInvite = await getInviteByEmailAndStatus(ctx, familyGroup._id, invitedEmail, 'pending');

  if (existingPendingInvite) {
    await reserveFamilyGroupInviteEmailSend(ctx, userProfile, now);
    return await prepareExistingPendingInviteForSend(
      familyGroup,
      existingPendingInvite,
      userProfile,
      invitedName,
      expiresAt
    );
  }

  const reusableInvite =
    (await getInviteByEmailAndStatus(ctx, familyGroup._id, invitedEmail, 'sending')) ??
    (await getInviteByEmailAndStatus(ctx, familyGroup._id, invitedEmail, 'send_failed')) ??
    (await getInviteByEmailAndStatus(ctx, familyGroup._id, invitedEmail, 'expired')) ??
    (await getInviteByEmailAndStatus(ctx, familyGroup._id, invitedEmail, 'revoked'));

  if (reusableInvite) {
    await ensureInviteCapacity(ctx, familyGroup._id, { reserveAdditionalSlot: reusableInvite.status !== 'sending' });
    await reserveFamilyGroupInviteEmailSend(ctx, userProfile, now);
    return await prepareReusableInviteForSend(
      ctx,
      familyGroup,
      reusableInvite,
      userProfile,
      invitedEmail,
      invitedName,
      inviteToken,
      expiresAt,
      nowIso
    );
  }

  await ensureInviteCapacity(ctx, familyGroup._id, { reserveAdditionalSlot: true });
  await reserveFamilyGroupInviteEmailSend(ctx, userProfile, now);

  const inviteId = await ctx.db.insert('familyGroupInvite', {
    familyGroupId: familyGroup._id,
    invitedEmail,
    invitedName,
    invitedByUserProfileId: userProfile._id,
    invitedByClerkId: userProfile.clerkId,
    invitedByName,
    invitedByEmail: userProfile.email,
    inviteToken,
    status: 'sending',
    sendCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastSentAt: nowIso,
    expiresAt,
    isDeleted: false,
  });

  return toPreparedInviteForSend(
    familyGroup,
    {
      _id: inviteId,
      invitedEmail,
      invitedName,
      inviteToken,
      expiresAt,
      sendCount: 1,
    },
    userProfile,
    true
  );
}

export const prepareInviteForSend = internalMutation({
  args: {
    invitedEmail: v.string(),
    invitedName: v.string(),
  },
  handler: async (ctx, args): Promise<PreparedInviteForSend> => {
    const { userProfile } = await requireUserProfile(ctx);
    return await prepareInviteForSendImpl(ctx, {
      invitedEmail: args.invitedEmail,
      invitedName: args.invitedName,
      userProfile,
    });
  },
});

export const finalizeInviteSend = internalMutation({
  args: {
    inviteId: v.id('familyGroupInvite'),
    invitedName: v.string(),
    invitedByName: v.string(),
    invitedByEmail: v.string(),
    inviteToken: v.string(),
    expiresAt: v.string(),
    sendCount: v.number(),
    sentAt: v.string(),
    created: v.boolean(),
  },
  handler: async (ctx, args): Promise<InviteRecord> => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.isDeleted) {
      throw new ConvexError('Family group invite not found');
    }

    if (invite.status !== 'sending' && invite.status !== 'pending') {
      throw new ConvexError('Family group invite is no longer available');
    }

    await ctx.db.patch(invite._id, {
      invitedName: args.invitedName,
      invitedByName: args.invitedByName,
      invitedByEmail: args.invitedByEmail,
      inviteToken: args.inviteToken,
      status: 'pending',
      sendCount: args.sendCount,
      updatedAt: args.sentAt,
      lastSentAt: args.sentAt,
      lastSendError: undefined,
      lastSendFailedAt: undefined,
      expiresAt: args.expiresAt,
      isDeleted: false,
      deletedAt: undefined,
    });

    return {
      _id: invite._id,
      familyGroupId: invite.familyGroupId,
      invitedEmail: invite.invitedEmail,
      invitedName: args.invitedName,
      inviteToken: args.inviteToken,
      expiresAt: args.expiresAt,
      sendCount: args.sendCount,
      created: args.created,
    };
  },
});

export async function failInviteSendImpl(
  ctx: MutationCtx,
  {
    inviteId,
    errorMessage,
    failedAt,
  }: {
    inviteId: Id<'familyGroupInvite'>;
    errorMessage: string;
    failedAt: string;
  }
): Promise<{ recorded: true }> {
  const invite = await ctx.db.get(inviteId);
  if (!invite) {
    return { recorded: true };
  }

  const basePatch = {
    lastSendError: errorMessage,
    lastSendFailedAt: failedAt,
    updatedAt: failedAt,
  };

  if (invite.status === 'sending') {
    await ctx.db.patch(invite._id, {
      ...basePatch,
      status: 'send_failed',
    });
  } else {
    await ctx.db.patch(invite._id, basePatch);
  }

  return { recorded: true };
}

export const failInviteSend = internalMutation({
  args: {
    inviteId: v.id('familyGroupInvite'),
    errorMessage: v.string(),
    failedAt: v.string(),
  },
  handler: async (ctx, args): Promise<{ recorded: true }> => {
    return await failInviteSendImpl(ctx, args);
  },
});

export const removeMember = mutation({
  args: {
    memberId: v.id('familyGroupMember'),
  },
  handler: async (ctx, args): Promise<{ removed: true }> => {
    const { userProfile } = await requireUserProfile(ctx);
    const familyGroup = await requireOwnedFamilyGroupForManagement(
      ctx,
      userProfile,
      'Create a family group before removing members',
      'Only the family group owner can remove members'
    );
    const member = await ctx.db.get(args.memberId);

    if (!member || member.familyGroupId !== familyGroup._id || member.isDeleted) {
      throw new ConvexError('Family group member not found');
    }

    if (member.role === 'owner') {
      throw new ConvexError('The family group owner cannot be removed');
    }

    const nowIso = new Date().toISOString();
    const activeFamilyMemberClerkIds = (await getActiveFamilyGroupMembers(ctx, familyGroup._id)).map(
      (familyMember) => familyMember.clerkId
    );

    await unlinkBankAccountsForSeparatedFamilyMember(ctx, {
      memberClerkId: member.clerkId,
      familyMemberClerkIds: activeFamilyMemberClerkIds,
      nowIso,
    });

    await ctx.db.patch(member._id, {
      updatedAt: nowIso,
      isDeleted: true,
      deletedAt: nowIso,
    });

    return { removed: true };
  },
});

export const revokeInvite = mutation({
  args: {
    inviteId: v.id('familyGroupInvite'),
  },
  handler: async (ctx, args): Promise<{ revoked: true }> => {
    const { userProfile } = await requireUserProfile(ctx);
    const familyGroup = await requireOwnedFamilyGroupForManagement(
      ctx,
      userProfile,
      'Create a family group before revoking invites',
      'Only the family group owner can revoke invites'
    );
    const invite = await ctx.db.get(args.inviteId);

    if (!invite || invite.familyGroupId !== familyGroup._id || invite.isDeleted) {
      throw new ConvexError('Family group invite not found');
    }

    if (invite.status !== 'pending') {
      throw new ConvexError('Only pending family group invites can be revoked');
    }

    await ctx.db.patch(invite._id, {
      status: 'revoked',
      updatedAt: new Date().toISOString(),
    });

    return { revoked: true };
  },
});
