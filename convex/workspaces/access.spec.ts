import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  canManageWorkspace,
  getWorkspaceAccessForClerkId,
  listAccessibleWorkspacesForClerkId,
  listWorkspaceMemberClerkIds,
  selectDefaultAccessibleWorkspace,
} from './access';
import { getWorkspaceSectionsForClerkId } from './queries';

type TableName = 'workspace' | 'familyGroup' | 'familyGroupMember' | 'userProfile';
type FakeRecord = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};
type FakeFilter = { field: string; value: unknown };

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, value });
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly filters: FakeFilter[] = []
  ) {}

  withIndex(_indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.filters);
  }

  async first(): Promise<FakeRecord | null> {
    return this.applyFilters()[0] ?? null;
  }

  async collect(): Promise<FakeRecord[]> {
    return this.applyFilters();
  }

  private applyFilters(): FakeRecord[] {
    return this.records
      .filter((record) => this.filters.every((filter) => record[filter.field] === filter.value))
      .sort((left, right) => left._creationTime - right._creationTime);
  }
}

class FakeDb {
  constructor(private readonly recordsByTable: Map<TableName, Map<string, FakeRecord>>) {}

  async get(id: string): Promise<FakeRecord | null> {
    for (const records of this.recordsByTable.values()) {
      const record = records.get(id);
      if (record) {
        return record;
      }
    }

    return null;
  }

  query(tableName: TableName): FakeQuery {
    return new FakeQuery(Array.from((this.recordsByTable.get(tableName) ?? new Map()).values()));
  }
}

function createTestContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): QueryCtx {
  const tableMaps = new Map<TableName, Map<string, FakeRecord>>();
  for (const tableName of ['workspace', 'familyGroup', 'familyGroupMember', 'userProfile'] as const) {
    const records = recordsByTable[tableName] ?? [];
    tableMaps.set(tableName, new Map(records.map((record) => [record._id, record])));
  }

  return { db: new FakeDb(tableMaps) } as unknown as QueryCtx;
}

function workspace(id: Id<'workspace'>, ownerClerkId: string, overrides: Record<string, unknown> = {}): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: String(id),
    ownerClerkId,
    transactionDefaultPendingStatus: false,
    ...overrides,
  };
}

function familyGroup(id: Id<'familyGroup'>, overrides: Record<string, unknown> = {}): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: String(id),
    ownerUserProfileId: 'profile_owner',
    ownerClerkId: 'clerk_owner',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function familyMember(
  id: Id<'familyGroupMember'>,
  familyGroupId: Id<'familyGroup'>,
  clerkId: string,
  overrides: Record<string, unknown> = {}
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    familyGroupId,
    userProfileId: `${clerkId}_profile`,
    clerkId,
    role: 'member',
    joinedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function userProfile(clerkId: string, name: string, email: string): FakeRecord {
  return {
    _id: `${clerkId}_profile`,
    _creationTime: 1,
    clerkId,
    name,
    email,
    onboardingCompleted: true,
  };
}

describe('getWorkspaceAccessForClerkId', () => {
  it('allows workspace owners', async () => {
    const workspaceId = 'workspace_owner' as Id<'workspace'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_owner');

    expect(access?.kind).toBe('owner');
    expect(access?.role).toBe('admin');
  });

  it('allows active family members to access each other owned workspaces', async () => {
    const workspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
      ],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_user');

    expect(access?.kind).toBe('family');
    expect(access?.role).toBe('member');
  });

  it('gives family owners admin access to active family member workspaces', async () => {
    const workspaceId = 'workspace_family_member' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_member')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_member'),
      ],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_owner');

    expect(access?.kind).toBe('family');
    expect(access?.role).toBe('admin');
  });

  it('denies access through a soft-deleted family membership', async () => {
    const workspaceId = 'workspace_private' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_removed' as Id<'familyGroupMember'>, familyGroupId, 'clerk_removed', {
          isDeleted: true,
        }),
      ],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_removed');

    expect(access).toBeNull();
  });

  it('denies access when the workspace owner is no longer an active family member', async () => {
    const workspaceId = 'workspace_private' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_removed_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_removed_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_removed_owner', {
          role: 'owner',
          isDeleted: true,
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
      ],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_user');

    expect(access).toBeNull();
  });

  it('denies non-family members when an owner is present', async () => {
    const workspaceId = 'workspace_private' as Id<'workspace'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_user');

    expect(access).toBeNull();
  });
});

describe('canManageWorkspace', () => {
  it('allows workspace owners to manage workspace settings and lifecycle', async () => {
    const workspaceId = 'workspace_owner' as Id<'workspace'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_owner');
    if (!access) {
      throw new Error('Expected owner workspace access');
    }

    expect(canManageWorkspace(access)).toBe(true);
  });

  it('denies family members from managing another member workspace settings and lifecycle', async () => {
    const workspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
      ],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_user');
    if (!access) {
      throw new Error('Expected family workspace access');
    }

    expect(access.kind).toBe('family');
    expect(canManageWorkspace(access)).toBe(false);
  });

  it('allows family owners to manage active family member workspace settings and lifecycle', async () => {
    const workspaceId = 'workspace_family_member' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_member')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_member'),
      ],
    });

    const access = await getWorkspaceAccessForClerkId(ctx, workspaceId, 'clerk_owner');
    if (!access) {
      throw new Error('Expected family owner workspace access');
    }

    expect(access.kind).toBe('family');
    expect(access.role).toBe('admin');
    expect(canManageWorkspace(access)).toBe(true);
  });
});

describe('listAccessibleWorkspacesForClerkId', () => {
  it('does not list workspaces owned by removed family members', async () => {
    const ownWorkspaceId = 'workspace_own' as Id<'workspace'>;
    const removedMemberWorkspaceId = 'workspace_removed_member' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(ownWorkspaceId, 'clerk_user'), workspace(removedMemberWorkspaceId, 'clerk_removed_member')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
        familyMember('member_removed' as Id<'familyGroupMember'>, familyGroupId, 'clerk_removed_member', {
          isDeleted: true,
        }),
      ],
    });

    const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, 'clerk_user');

    expect(accessibleWorkspaces.map(({ workspace: item }) => item._id)).toEqual([ownWorkspaceId]);
  });

  it('does not list shared workspaces through a deleted family group', async () => {
    const ownWorkspaceId = 'workspace_own' as Id<'workspace'>;
    const sharedWorkspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_deleted' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(ownWorkspaceId, 'clerk_user'), workspace(sharedWorkspaceId, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId, { isDeleted: true })],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
      ],
    });

    const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, 'clerk_user');

    expect(accessibleWorkspaces.map(({ workspace: item }) => item._id)).toEqual([ownWorkspaceId]);
  });
});

describe('selectDefaultAccessibleWorkspace', () => {
  it('prefers owned workspaces over older family shared workspaces', async () => {
    const ownWorkspaceId = 'workspace_own' as Id<'workspace'>;
    const sharedWorkspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [
        workspace(sharedWorkspaceId, 'clerk_owner', { _creationTime: 1 }),
        workspace(ownWorkspaceId, 'clerk_user', { _creationTime: 2 }),
      ],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
      ],
    });

    const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, 'clerk_user');
    const selectedWorkspace = selectDefaultAccessibleWorkspace(accessibleWorkspaces);

    expect(accessibleWorkspaces.map(({ workspace: item }) => item._id)).toEqual([sharedWorkspaceId, ownWorkspaceId]);
    expect(selectedWorkspace?.kind).toBe('owner');
    expect(selectedWorkspace?.workspace._id).toBe(ownWorkspaceId);
  });

  it('falls back to a family shared workspace when no own workspace is available', async () => {
    const sharedWorkspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(sharedWorkspaceId, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
      ],
    });

    const accessibleWorkspaces = await listAccessibleWorkspacesForClerkId(ctx, 'clerk_user');
    const selectedWorkspace = selectDefaultAccessibleWorkspace(accessibleWorkspaces);

    expect(selectedWorkspace?.kind).toBe('family');
    expect(selectedWorkspace?.workspace._id).toBe(sharedWorkspaceId);
  });
});

describe('listWorkspaceMemberClerkIds', () => {
  it('returns only the owner when the owner is not in an active family group', async () => {
    const workspaceId = 'workspace_owner_only' as Id<'workspace'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
    });

    await expect(listWorkspaceMemberClerkIds(ctx, workspaceId)).resolves.toEqual(['clerk_owner']);
  });

  it('returns the owner and active family members for shared workspaces', async () => {
    const workspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
        familyMember('member_removed' as Id<'familyGroupMember'>, familyGroupId, 'clerk_removed', {
          isDeleted: true,
        }),
      ],
    });

    await expect(listWorkspaceMemberClerkIds(ctx, workspaceId)).resolves.toEqual(['clerk_owner', 'clerk_user']);
  });
});

describe('getWorkspaceSectionsForClerkId', () => {
  it('groups owned and shared family workspaces with owner metadata', async () => {
    const ownWorkspaceId = 'workspace_own' as Id<'workspace'>;
    const sharedWorkspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [
        workspace(ownWorkspaceId, 'clerk_user', { name: 'Mine', _creationTime: 1 }),
        workspace(sharedWorkspaceId, 'clerk_owner', {
          name: 'Shared',
          _creationTime: 2,
          currency: 'kwd',
          timezone: 'Asia/Kuwait',
        }),
      ],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_user'),
      ],
      userProfile: [
        userProfile('clerk_user', 'Current User', 'user@example.com'),
        userProfile('clerk_owner', 'Family Owner', 'owner@example.com'),
      ],
    });

    const sections = await getWorkspaceSectionsForClerkId(ctx, 'clerk_user');

    expect(sections.ownWorkspaces).toHaveLength(1);
    expect(sections.ownWorkspaces[0]).toMatchObject({
      _id: ownWorkspaceId,
      accessKind: 'owner',
      ownerClerkId: 'clerk_user',
      canManage: true,
      currencyCode: 'USD',
      minorUnit: 2,
      timezoneIdentifier: null,
    });
    expect(sections.sharedWorkspaces).toHaveLength(1);
    expect(sections.sharedWorkspaces[0]).toMatchObject({
      _id: sharedWorkspaceId,
      accessKind: 'family',
      ownerClerkId: 'clerk_owner',
      canManage: false,
      currencyCode: 'KWD',
      minorUnit: 3,
      timezoneIdentifier: 'Asia/Kuwait',
      owner: {
        clerkId: 'clerk_owner',
        name: 'Family Owner',
        email: 'owner@example.com',
      },
    });
  });

  it('marks shared family member workspaces manageable for the family owner', async () => {
    const ownWorkspaceId = 'workspace_own' as Id<'workspace'>;
    const sharedWorkspaceId = 'workspace_shared' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const ctx = createTestContext({
      workspace: [
        workspace(ownWorkspaceId, 'clerk_owner', { name: 'Owner Workspace', _creationTime: 1 }),
        workspace(sharedWorkspaceId, 'clerk_member', { name: 'Member Workspace', _creationTime: 2 }),
      ],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', {
          role: 'owner',
        }),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_member'),
      ],
      userProfile: [
        userProfile('clerk_owner', 'Family Owner', 'owner@example.com'),
        userProfile('clerk_member', 'Family Member', 'member@example.com'),
      ],
    });

    const sections = await getWorkspaceSectionsForClerkId(ctx, 'clerk_owner');

    expect(sections.ownWorkspaces).toHaveLength(1);
    expect(sections.sharedWorkspaces).toHaveLength(1);
    expect(sections.sharedWorkspaces[0]).toMatchObject({
      _id: sharedWorkspaceId,
      role: 'admin',
      accessKind: 'family',
      ownerClerkId: 'clerk_member',
      canManage: true,
      owner: {
        clerkId: 'clerk_member',
        name: 'Family Member',
        email: 'member@example.com',
      },
    });
  });
});
