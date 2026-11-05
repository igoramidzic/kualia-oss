import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { requireUserProfile } from '../lib/auth';
import {
  getFamilyGroupInviteEmailQuotaState,
  getFamilyGroupInviteJoinAvailability,
  type CurrentFamilyGroupJoinState,
  type FamilyGroupInviteJoinStatus,
} from './helpers';

const MAX_FAMILY_GROUP_MEMBERS = 6;
const MAX_PENDING_INVITES = 50;

interface FamilyGroupMemberView {
  _id: Doc<'familyGroupMember'>['_id'];
  clerkId: string;
  name: string | null;
  email: string | null;
  role: Doc<'familyGroupMember'>['role'];
  isCurrentUser: boolean;
  joinedAt: string;
}

interface FamilyGroupInviteView {
  _id: Doc<'familyGroupInvite'>['_id'];
  invitedEmail: string;
  invitedName: string;
  invitedByName: string;
  status: Doc<'familyGroupInvite'>['status'];
  createdAt: string;
  lastSentAt: string;
  expiresAt: string;
}

interface FamilyGroupInviteEmailQuotaView {
  limit: number;
  used: number;
  remaining: number;
  windowStartedAt: string | null;
  windowEndsAt: string | null;
}

interface FamilyGroupView {
  _id: Doc<'familyGroup'>['_id'];
  name: string;
  ownerClerkId: string;
  currentUserRole: Doc<'familyGroupMember'>['role'];
  members: FamilyGroupMemberView[];
  pendingInvites: FamilyGroupInviteView[];
  inviteEmailQuota: FamilyGroupInviteEmailQuotaView | null;
}

interface JoinedFamilyGroupMemberDetails {
  kind: 'member';
  _id: Id<'familyGroupMember'>;
  familyGroupId: Id<'familyGroup'>;
  clerkId: string;
  name: string | null;
  email: string | null;
  role: Doc<'familyGroupMember'>['role'];
  isCurrentUser: boolean;
  joinedAt: string;
  currentUserRole: Doc<'familyGroupMember'>['role'];
  canRemove: boolean;
}

interface InvitedFamilyGroupMemberDetails {
  kind: 'invite';
  _id: Id<'familyGroupInvite'>;
  familyGroupId: Id<'familyGroup'>;
  name: string;
  email: string;
  invitedByName: string;
  status: Doc<'familyGroupInvite'>['status'];
  createdAt: string;
  lastSentAt: string;
  expiresAt: string;
  currentUserRole: Doc<'familyGroupMember'>['role'];
  canRemove: boolean;
}

type FamilyGroupMemberDetails = JoinedFamilyGroupMemberDetails | InvitedFamilyGroupMemberDetails;

interface CurrentFamilyGroupPreview {
  name: string;
  role: Doc<'familyGroupMember'>['role'];
  activeMemberCount: number;
  otherActiveMemberCount: number;
}

interface FamilyGroupInvitePreview {
  status: FamilyGroupInviteJoinStatus;
  canAccept: boolean;
  familyGroupName: string | null;
  invitedByName: string | null;
  expiresAt: string | null;
  currentFamilyGroup: CurrentFamilyGroupPreview | null;
}

const NOT_FOUND_INVITE_PREVIEW: FamilyGroupInvitePreview = {
  status: 'not_found',
  canAccept: false,
  familyGroupName: null,
  invitedByName: null,
  expiresAt: null,
  currentFamilyGroup: null,
};

function invitePreview(
  status: FamilyGroupInviteJoinStatus,
  canAccept: boolean,
  invite: Doc<'familyGroupInvite'>,
  familyGroup: Doc<'familyGroup'>,
  currentFamilyGroup: CurrentFamilyGroupJoinState | null
): FamilyGroupInvitePreview {
  return {
    status,
    canAccept,
    familyGroupName: familyGroup.name,
    invitedByName: invite.invitedByName,
    expiresAt: invite.expiresAt,
    currentFamilyGroup: currentFamilyGroup
      ? {
          name: currentFamilyGroup.name,
          role: currentFamilyGroup.role,
          activeMemberCount: currentFamilyGroup.activeMemberCount,
          otherActiveMemberCount: currentFamilyGroup.otherActiveMemberCount,
        }
      : null,
  };
}

export const getInvitePreview = query({
  args: {
    inviteToken: v.string(),
  },
  handler: async (ctx, args): Promise<FamilyGroupInvitePreview> => {
    const { userProfile } = await requireUserProfile(ctx);
    const availability = await getFamilyGroupInviteJoinAvailability(ctx, {
      inviteToken: args.inviteToken,
      userProfile,
    });

    if (!availability.invite || !availability.familyGroup) {
      return NOT_FOUND_INVITE_PREVIEW;
    }

    return invitePreview(
      availability.status,
      availability.canAccept,
      availability.invite,
      availability.familyGroup,
      availability.currentFamilyGroup
    );
  },
});

export const getMine = query({
  args: {},
  handler: async (ctx): Promise<FamilyGroupView | null> => {
    const { user, userProfile } = await requireUserProfile(ctx);

    const membership = await ctx.db
      .query('familyGroupMember')
      .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', user.subject).eq('isDeleted', false))
      .first();

    if (!membership) {
      return null;
    }

    const familyGroup = await ctx.db.get(membership.familyGroupId);
    if (!familyGroup || familyGroup.isDeleted) {
      return null;
    }

    const memberDocs = await ctx.db
      .query('familyGroupMember')
      .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', familyGroup._id).eq('isDeleted', false))
      .take(MAX_FAMILY_GROUP_MEMBERS);

    const members = await Promise.all(
      memberDocs.map(async (member): Promise<FamilyGroupMemberView> => {
        const profile = await ctx.db.get(member.userProfileId);

        return {
          _id: member._id,
          clerkId: member.clerkId,
          name: profile?.name ?? null,
          email: profile?.email ?? null,
          role: member.role,
          isCurrentUser: member.clerkId === user.subject,
          joinedAt: member.joinedAt,
        };
      })
    );

    const pendingInvites =
      familyGroup.ownerClerkId === user.subject
        ? await ctx.db
            .query('familyGroupInvite')
            .withIndex('by_familyGroupId_status_isDeleted', (q) =>
              q.eq('familyGroupId', familyGroup._id).eq('status', 'pending').eq('isDeleted', false)
            )
            .order('desc')
            .take(MAX_PENDING_INVITES)
        : [];
    const inviteEmailQuota =
      familyGroup.ownerClerkId === user.subject ? getFamilyGroupInviteEmailQuotaState(userProfile) : null;

    return {
      _id: familyGroup._id,
      name: familyGroup.name,
      ownerClerkId: familyGroup.ownerClerkId,
      currentUserRole: membership.role,
      members: members.sort((left, right) => {
        if (left.role !== right.role) return left.role === 'owner' ? -1 : 1;
        return (left.name ?? left.email ?? '').localeCompare(right.name ?? right.email ?? '');
      }),
      pendingInvites: pendingInvites.map((invite) => ({
        _id: invite._id,
        invitedEmail: invite.invitedEmail,
        invitedName: invite.invitedName,
        invitedByName: invite.invitedByName,
        status: invite.status,
        createdAt: invite.createdAt,
        lastSentAt: invite.lastSentAt,
        expiresAt: invite.expiresAt,
      })),
      inviteEmailQuota: inviteEmailQuota
        ? {
            limit: inviteEmailQuota.limit,
            used: inviteEmailQuota.used,
            remaining: inviteEmailQuota.remaining,
            windowStartedAt: inviteEmailQuota.windowStartedAt,
            windowEndsAt: inviteEmailQuota.windowEndsAt,
          }
        : null,
    };
  },
});

export const getMemberDetails = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<FamilyGroupMemberDetails | null> => {
    const { user } = await requireUserProfile(ctx);

    const membership = await ctx.db
      .query('familyGroupMember')
      .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', user.subject).eq('isDeleted', false))
      .first();

    if (!membership) {
      return null;
    }

    const familyGroup = await ctx.db.get(membership.familyGroupId);
    if (!familyGroup || familyGroup.isDeleted) {
      return null;
    }

    const memberId = ctx.db.normalizeId('familyGroupMember', args.userId);
    if (memberId) {
      const member = await ctx.db.get(memberId);
      if (member && member.familyGroupId === familyGroup._id && !member.isDeleted) {
        const profile = await ctx.db.get(member.userProfileId);

        return {
          kind: 'member',
          _id: member._id,
          familyGroupId: member.familyGroupId,
          clerkId: member.clerkId,
          name: profile?.name ?? null,
          email: profile?.email ?? null,
          role: member.role,
          isCurrentUser: member.clerkId === user.subject,
          joinedAt: member.joinedAt,
          currentUserRole: membership.role,
          canRemove: membership.role === 'owner' && member.role !== 'owner',
        };
      }
    }

    if (membership.role !== 'owner') {
      return null;
    }

    const inviteId = ctx.db.normalizeId('familyGroupInvite', args.userId);
    if (!inviteId) {
      return null;
    }

    const invite = await ctx.db.get(inviteId);
    if (!invite || invite.familyGroupId !== familyGroup._id || invite.isDeleted || invite.status !== 'pending') {
      return null;
    }

    return {
      kind: 'invite',
      _id: invite._id,
      familyGroupId: invite.familyGroupId,
      name: invite.invitedName,
      email: invite.invitedEmail,
      invitedByName: invite.invitedByName,
      status: invite.status,
      createdAt: invite.createdAt,
      lastSentAt: invite.lastSentAt,
      expiresAt: invite.expiresAt,
      currentUserRole: membership.role,
      canRemove: true,
    };
  },
});
