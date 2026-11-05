import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type WorkspaceAccessCtx = QueryCtx | MutationCtx;

export type WorkspaceAccessKind = 'owner' | 'family';
export type WorkspaceAccessRole = 'admin' | 'member';

export interface WorkspaceAccess {
  kind: WorkspaceAccessKind;
  ownerClerkId: string;
  role: WorkspaceAccessRole;
  workspace: Doc<'workspace'>;
}

export interface AccessibleWorkspace {
  kind: WorkspaceAccessKind;
  ownerClerkId: string;
  role: WorkspaceAccessRole;
  workspace: Doc<'workspace'>;
}

export function selectDefaultAccessibleWorkspace(
  accessibleWorkspaces: AccessibleWorkspace[]
): AccessibleWorkspace | undefined {
  return (
    accessibleWorkspaces.find(({ kind, workspace }) => kind !== 'family' && workspace.isArchived !== true) ??
    accessibleWorkspaces.find(({ workspace }) => workspace.isArchived !== true)
  );
}

export function canManageWorkspace(access: Pick<WorkspaceAccess, 'role'>): boolean {
  return access.role === 'admin';
}

async function getActiveFamilyMembership(
  ctx: WorkspaceAccessCtx,
  clerkId: string
): Promise<Doc<'familyGroupMember'> | null> {
  return await ctx.db
    .query('familyGroupMember')
    .withIndex('by_clerkId_isDeleted', (q) => q.eq('clerkId', clerkId).eq('isDeleted', false))
    .first();
}

function canManageFamilyWorkspaces(familyGroup: Doc<'familyGroup'>, membership: Doc<'familyGroupMember'>): boolean {
  return membership.role === 'owner' || familyGroup.ownerClerkId === membership.clerkId;
}

async function getFamilyWorkspaceAccessRole(
  ctx: WorkspaceAccessCtx,
  clerkId: string,
  ownerClerkId: string
): Promise<WorkspaceAccessRole | null> {
  if (clerkId === ownerClerkId) {
    return 'admin';
  }

  const membership = await getActiveFamilyMembership(ctx, clerkId);
  if (!membership) {
    return null;
  }

  const familyGroup = await ctx.db.get(membership.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    return null;
  }

  const ownerMembership = await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_clerkId_isDeleted', (q) =>
      q.eq('familyGroupId', familyGroup._id).eq('clerkId', ownerClerkId).eq('isDeleted', false)
    )
    .first();

  if (!ownerMembership) {
    return null;
  }

  return canManageFamilyWorkspaces(familyGroup, membership) ? 'admin' : 'member';
}

export async function getWorkspaceAccessForClerkId(
  ctx: WorkspaceAccessCtx,
  workspaceId: Id<'workspace'>,
  clerkId: string
): Promise<WorkspaceAccess | null> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.isDeleted) {
    return null;
  }

  const ownerClerkId = workspace.ownerClerkId;
  if (ownerClerkId === clerkId) {
    return {
      kind: 'owner',
      ownerClerkId,
      role: 'admin',
      workspace,
    };
  }

  const familyRole = await getFamilyWorkspaceAccessRole(ctx, clerkId, ownerClerkId);
  if (familyRole) {
    return {
      kind: 'family',
      ownerClerkId,
      role: familyRole,
      workspace,
    };
  }

  return null;
}

async function addOwnedWorkspaces(
  ctx: WorkspaceAccessCtx,
  clerkId: string,
  workspacesById: Map<Id<'workspace'>, AccessibleWorkspace>
): Promise<void> {
  const workspaces = await ctx.db
    .query('workspace')
    .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', clerkId))
    .collect();

  for (const workspace of workspaces) {
    if (workspace.isDeleted) {
      continue;
    }

    workspacesById.set(workspace._id, {
      kind: 'owner',
      ownerClerkId: clerkId,
      role: 'admin',
      workspace,
    });
  }
}

async function addSharedFamilyWorkspaces(
  ctx: WorkspaceAccessCtx,
  clerkId: string,
  workspacesById: Map<Id<'workspace'>, AccessibleWorkspace>
): Promise<void> {
  const membership = await getActiveFamilyMembership(ctx, clerkId);
  if (!membership) {
    return;
  }

  const familyGroup = await ctx.db.get(membership.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    return;
  }
  const sharedWorkspaceRole: WorkspaceAccessRole = canManageFamilyWorkspaces(familyGroup, membership)
    ? 'admin'
    : 'member';

  const familyMembers = await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', familyGroup._id).eq('isDeleted', false))
    .collect();

  for (const familyMember of familyMembers) {
    if (familyMember.clerkId === clerkId) {
      continue;
    }

    const workspaces = await ctx.db
      .query('workspace')
      .withIndex('by_ownerClerkId_isDeleted', (q) => q.eq('ownerClerkId', familyMember.clerkId))
      .collect();

    for (const workspace of workspaces) {
      if (workspace.isDeleted || workspacesById.has(workspace._id)) {
        continue;
      }

      workspacesById.set(workspace._id, {
        kind: 'family',
        ownerClerkId: familyMember.clerkId,
        role: sharedWorkspaceRole,
        workspace,
      });
    }
  }
}

export async function listWorkspaceMemberClerkIds(
  ctx: WorkspaceAccessCtx,
  workspaceId: Id<'workspace'>
): Promise<string[]> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.isDeleted) {
    return [];
  }

  const ownerClerkId = workspace.ownerClerkId;
  const ownerMembership = await getActiveFamilyMembership(ctx, ownerClerkId);
  if (!ownerMembership) {
    return [ownerClerkId];
  }

  const familyGroup = await ctx.db.get(ownerMembership.familyGroupId);
  if (!familyGroup || familyGroup.isDeleted) {
    return [ownerClerkId];
  }

  const familyMembers = await ctx.db
    .query('familyGroupMember')
    .withIndex('by_familyGroupId_isDeleted', (q) => q.eq('familyGroupId', familyGroup._id).eq('isDeleted', false))
    .collect();

  return Array.from(new Set([ownerClerkId, ...familyMembers.map((member) => member.clerkId)]));
}

export async function listAccessibleWorkspacesForClerkId(
  ctx: WorkspaceAccessCtx,
  clerkId: string
): Promise<AccessibleWorkspace[]> {
  const workspacesById = new Map<Id<'workspace'>, AccessibleWorkspace>();

  await addOwnedWorkspaces(ctx, clerkId, workspacesById);
  await addSharedFamilyWorkspaces(ctx, clerkId, workspacesById);

  return Array.from(workspacesById.values()).sort(
    (left, right) => left.workspace._creationTime - right.workspace._creationTime
  );
}
