import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { DISCORD_NOTIFICATIONS_CHANNEL } from '../lib/discord';
import {
  acceptFamilyGroupInviteImpl,
  ensureOwnedFamilyGroup,
  failInviteSendImpl,
  leaveFamilyGroupImpl,
  prepareInviteForSendImpl,
} from './mutations';

type FakeRecord = Record<string, unknown> & { _id: string };
type FakeScheduledCall = {
  delayMs: number;
  args: Record<string, unknown>;
};
type TableName =
  | 'familyGroup'
  | 'familyGroupMember'
  | 'familyGroupInvite'
  | 'userProfile'
  | 'workspace'
  | 'bankLink'
  | 'bankLinkAccount'
  | 'bankAccount';
type FakeFilter = { field: string; operator: 'eq' | 'neq'; value: unknown };

const NOW = new Date('2026-06-10T12:00:00.000Z');
const FUTURE = '2026-06-24T12:00:00.000Z';

class FakeIndexBuilder {
  readonly filters: FakeFilter[] = [];

  eq(field: string, value: unknown): FakeIndexBuilder {
    this.filters.push({ field, operator: 'eq', value });
    return this;
  }
}

class FakeFilterBuilder {
  readonly filters: FakeFilter[] = [];

  field(fieldName: string): string {
    return fieldName;
  }

  eq(field: string, value: unknown): FakeFilterBuilder {
    this.filters.push({ field, operator: 'eq', value });
    return this;
  }

  neq(field: string, value: unknown): FakeFilterBuilder {
    this.filters.push({ field, operator: 'neq', value });
    return this;
  }
}

class FakeQuery {
  constructor(
    private readonly records: FakeRecord[],
    private readonly filters: FakeFilter[]
  ) {}

  filter(callback: (q: FakeFilterBuilder) => FakeFilterBuilder): FakeQuery {
    const builder = new FakeFilterBuilder();
    callback(builder);
    return new FakeQuery(this.records, [...this.filters, ...builder.filters]);
  }

  async first(): Promise<FakeRecord | null> {
    return this.applyFilters()[0] ?? null;
  }

  async collect(): Promise<FakeRecord[]> {
    return this.applyFilters();
  }

  async take(limit: number): Promise<FakeRecord[]> {
    return this.applyFilters().slice(0, limit);
  }

  private applyFilters(): FakeRecord[] {
    return this.records.filter((record) =>
      this.filters.every((filter) =>
        filter.operator === 'eq' ? record[filter.field] === filter.value : record[filter.field] !== filter.value
      )
    );
  }
}

class FakeDb {
  private nextInsertedId = 1;

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

  query(tableName: TableName): {
    withIndex: (indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder) => FakeQuery;
  } {
    return {
      withIndex: (_indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery => {
        const builder = new FakeIndexBuilder();
        callback(builder);
        return new FakeQuery(this.recordsFor(tableName), builder.filters);
      },
    };
  }

  async insert(tableName: TableName, value: Record<string, unknown>): Promise<string> {
    const id = `${tableName}_inserted_${this.nextInsertedId}`;
    this.nextInsertedId += 1;
    this.mapFor(tableName).set(id, {
      _id: id,
      _creationTime: 1,
      ...value,
    });
    return id;
  }

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Missing fake record: ${id}`);
    }

    Object.assign(record, updates);
  }

  record(id: string): FakeRecord {
    let record: FakeRecord | undefined;
    for (const records of this.recordsByTable.values()) {
      record = records.get(id);
      if (record) {
        break;
      }
    }
    if (!record) {
      throw new Error(`Missing fake record: ${id}`);
    }
    return record;
  }

  records(tableName: TableName): FakeRecord[] {
    return this.recordsFor(tableName);
  }

  private recordsFor(tableName: TableName): FakeRecord[] {
    return Array.from(this.mapFor(tableName).values());
  }

  private mapFor(tableName: TableName): Map<string, FakeRecord> {
    const records = this.recordsByTable.get(tableName);
    if (!records) {
      throw new Error(`Missing fake table: ${tableName}`);
    }

    return records;
  }
}

class FakeScheduler {
  readonly calls: FakeScheduledCall[] = [];
  private failure: Error | null = null;

  failNextRunAfter(error: Error): void {
    this.failure = error;
  }

  async runAfter(delayMs: number, _functionReference: unknown, args: Record<string, unknown>): Promise<void> {
    this.calls.push({ delayMs, args });
    if (this.failure) {
      const failure = this.failure;
      this.failure = null;
      throw failure;
    }
  }
}

function createTestContext({
  familyGroups = [],
  familyGroupMembers = [],
  familyGroupInvites = [],
  userProfiles = [userProfile()],
}: {
  familyGroups?: FakeRecord[];
  familyGroupMembers?: FakeRecord[];
  familyGroupInvites?: FakeRecord[];
  userProfiles?: FakeRecord[];
}): { ctx: MutationCtx; db: FakeDb; scheduler: FakeScheduler } {
  const recordsByTable = new Map<TableName, Map<string, FakeRecord>>();
  recordsByTable.set('familyGroup', new Map(familyGroups.map((record) => [record._id, record])));
  recordsByTable.set('familyGroupMember', new Map(familyGroupMembers.map((record) => [record._id, record])));
  recordsByTable.set('familyGroupInvite', new Map(familyGroupInvites.map((record) => [record._id, record])));
  recordsByTable.set('userProfile', new Map(userProfiles.map((record) => [record._id, record])));
  recordsByTable.set('workspace', new Map());
  recordsByTable.set('bankLink', new Map());
  recordsByTable.set('bankLinkAccount', new Map());
  recordsByTable.set('bankAccount', new Map());

  const db = new FakeDb(recordsByTable);
  const scheduler = new FakeScheduler();

  return { ctx: { db, scheduler } as unknown as MutationCtx, db, scheduler };
}

function userProfile(overrides: Partial<Doc<'userProfile'>> = {}): Doc<'userProfile'> {
  return {
    _id: 'profile_invitee' as Id<'userProfile'>,
    _creationTime: 1,
    clerkId: 'clerk_invitee',
    email: 'invitee@example.com',
    onboardingCompleted: true,
    ...overrides,
  };
}

function familyGroup(
  id: Id<'familyGroup'>,
  ownerClerkId: string,
  overrides: Partial<Doc<'familyGroup'>> = {}
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: `${id} Family`,
    ownerUserProfileId: 'profile_owner' as Id<'userProfile'>,
    ownerClerkId,
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
  role: Doc<'familyGroupMember'>['role'],
  overrides: Partial<Doc<'familyGroupMember'>> = {}
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    familyGroupId,
    userProfileId: `${clerkId}_profile` as Id<'userProfile'>,
    clerkId,
    role,
    joinedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function familyInvite(
  id: Id<'familyGroupInvite'>,
  familyGroupId: Id<'familyGroup'>,
  overrides: Partial<Doc<'familyGroupInvite'>> = {}
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    familyGroupId,
    invitedEmail: 'invitee@example.com',
    invitedName: 'Invitee',
    invitedByUserProfileId: 'profile_owner' as Id<'userProfile'>,
    invitedByClerkId: 'clerk_owner',
    invitedByName: 'Owner',
    invitedByEmail: 'owner@example.com',
    inviteToken: 'invite-token',
    status: 'pending',
    sendCount: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    lastSentAt: '2026-06-01T00:00:00.000Z',
    expiresAt: FUTURE,
    isDeleted: false,
    ...overrides,
  };
}

describe('acceptFamilyGroupInviteImpl', () => {
  it('accepts a pending invite when the signed-in email matches', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const invitee = userProfile({ onboardingCompleted: false });
    const { ctx, db, scheduler } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
      ],
      familyGroupInvites: [familyInvite(inviteId, targetFamilyGroupId)],
      userProfiles: [invitee],
    });

    const result = await acceptFamilyGroupInviteImpl(ctx, {
      inviteToken: 'invite-token',
      userProfile: invitee,
      now: NOW,
    });

    expect(result).toMatchObject({
      accepted: true,
      familyGroupId: targetFamilyGroupId,
      previousFamilyDeleted: false,
      alreadyMember: false,
    });
    expect(db.record(inviteId).status).toBe('accepted');

    const insertedMember = db
      .records('familyGroupMember')
      .find((record) => record.clerkId === 'clerk_invitee' && record.familyGroupId === targetFamilyGroupId);
    expect(insertedMember).toMatchObject({
      role: 'member',
      isDeleted: false,
    });
    expect(db.record(invitee._id)).toMatchObject({
      onboardingCompleted: true,
      updatedAt: NOW.toISOString(),
    });
    expect(scheduler.calls).toHaveLength(1);
    expect(scheduler.calls[0]).toMatchObject({
      delayMs: 0,
      args: {
        channel: DISCORD_NOTIFICATIONS_CHANNEL,
        title: 'Family Invite Accepted',
        description: "invitee@example.com accepted Owner's family invite",
        userId: 'clerk_invitee',
        userEmail: 'invitee@example.com',
        metadata: {
          from: 'Owner <owner@example.com>',
          to: 'invitee@example.com',
          familyGroup: 'family_target Family',
        },
      },
    });
  });

  it('rejects an invite when the signed-in email does not match the invite email', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const { ctx } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupInvites: [familyInvite('invite_target' as Id<'familyGroupInvite'>, targetFamilyGroupId)],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile({ email: 'wrong@example.com' }),
        now: NOW,
      })
    ).rejects.toThrow('email address');
  });

  it('accepts the invite when Discord notification scheduling fails', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const invitee = userProfile({ onboardingCompleted: false });
    const { ctx, db, scheduler } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
      ],
      familyGroupInvites: [familyInvite(inviteId, targetFamilyGroupId)],
      userProfiles: [invitee],
    });
    scheduler.failNextRunAfter(new Error('scheduler unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: invitee,
        now: NOW,
      });

      expect(result).toMatchObject({
        accepted: true,
        familyGroupId: targetFamilyGroupId,
        previousFamilyDeleted: false,
        alreadyMember: false,
      });
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to schedule Discord notification for family invite acceptance:',
        {
          error: 'scheduler unavailable',
        }
      );
    } finally {
      consoleError.mockRestore();
    }

    expect(db.record(inviteId).status).toBe('accepted');
    expect(db.record(invitee._id)).toMatchObject({
      onboardingCompleted: true,
      updatedAt: NOW.toISOString(),
    });
    expect(
      db
        .records('familyGroupMember')
        .some((record) => record.clerkId === 'clerk_invitee' && record.familyGroupId === targetFamilyGroupId)
    ).toBe(true);
    expect(scheduler.calls).toHaveLength(1);
  });

  it('does not let an accepted invite be replayed by another account using the invited email', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
        familyMember('member_original' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_invitee', 'member'),
      ],
      familyGroupInvites: [
        familyInvite(inviteId, targetFamilyGroupId, {
          status: 'accepted',
        }),
      ],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile({
          _id: 'profile_attacker' as Id<'userProfile'>,
          clerkId: 'clerk_attacker',
          email: 'invitee@example.com',
        }),
        now: NOW,
      })
    ).rejects.toThrow('already been accepted');

    expect(db.record(inviteId).status).toBe('accepted');
    expect(db.records('familyGroupMember').some((record) => record.clerkId === 'clerk_attacker')).toBe(false);
  });

  it('treats deleted invite links as not found without creating membership', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
      ],
      familyGroupInvites: [
        familyInvite(inviteId, targetFamilyGroupId, {
          isDeleted: true,
        }),
      ],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('Family invite not found');

    expect(db.records('familyGroupMember').some((record) => record.clerkId === 'clerk_invitee')).toBe(false);
    expect(db.record(inviteId).status).toBe('pending');
  });

  it('treats invite links for deleted family groups as not found without creating membership', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [
        familyGroup(targetFamilyGroupId, 'clerk_owner', {
          isDeleted: true,
        }),
      ],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
      ],
      familyGroupInvites: [familyInvite(inviteId, targetFamilyGroupId)],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('Family invite not found');

    expect(db.records('familyGroupMember').some((record) => record.clerkId === 'clerk_invitee')).toBe(false);
    expect(db.record(inviteId).status).toBe('pending');
  });

  it('does not accept revoked invite links', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
      ],
      familyGroupInvites: [
        familyInvite(inviteId, targetFamilyGroupId, {
          status: 'revoked',
        }),
      ],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('has been revoked');

    expect(db.record(inviteId).status).toBe('revoked');
    expect(db.records('familyGroupMember').some((record) => record.clerkId === 'clerk_invitee')).toBe(false);
  });

  it('expires stale pending invite links without creating membership', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
      ],
      familyGroupInvites: [
        familyInvite(inviteId, targetFamilyGroupId, {
          expiresAt: '2026-06-10T11:59:59.000Z',
        }),
      ],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('has expired');

    expect(db.record(inviteId).status).toBe('expired');
    expect(db.records('familyGroupMember').some((record) => record.clerkId === 'clerk_invitee')).toBe(false);
  });

  it('does not accept invite links that have not been finalized as pending', async () => {
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(targetFamilyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, targetFamilyGroupId, 'clerk_owner', 'owner'),
      ],
      familyGroupInvites: [
        familyInvite(inviteId, targetFamilyGroupId, {
          status: 'sending',
        }),
      ],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('no longer available');

    expect(db.record(inviteId).status).toBe('sending');
    expect(db.records('familyGroupMember').some((record) => record.clerkId === 'clerk_invitee')).toBe(false);
  });

  it('requires a non-owner member to leave their current family before accepting', async () => {
    const currentFamilyGroupId = 'family_current' as Id<'familyGroup'>;
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const currentMemberId = 'member_current' as Id<'familyGroupMember'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [
        familyGroup(currentFamilyGroupId, 'clerk_current_owner'),
        familyGroup(targetFamilyGroupId, 'clerk_target_owner'),
      ],
      familyGroupMembers: [
        familyMember(
          'member_current_owner' as Id<'familyGroupMember'>,
          currentFamilyGroupId,
          'clerk_current_owner',
          'owner'
        ),
        familyMember(currentMemberId, currentFamilyGroupId, 'clerk_invitee', 'member'),
      ],
      familyGroupInvites: [familyInvite(inviteId, targetFamilyGroupId)],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('Leave your current family group');

    expect(db.record(currentMemberId).isDeleted).toBe(false);
    expect(db.record(inviteId).status).toBe('pending');
  });

  it('auto-deletes an owned empty family before accepting another family invite', async () => {
    const currentFamilyGroupId = 'family_current' as Id<'familyGroup'>;
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const currentMemberId = 'member_current_owner' as Id<'familyGroupMember'>;
    const oldInviteId = 'invite_old' as Id<'familyGroupInvite'>;
    const newInviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [
        familyGroup(currentFamilyGroupId, 'clerk_invitee'),
        familyGroup(targetFamilyGroupId, 'clerk_target_owner'),
      ],
      familyGroupMembers: [familyMember(currentMemberId, currentFamilyGroupId, 'clerk_invitee', 'owner')],
      familyGroupInvites: [
        familyInvite(oldInviteId, currentFamilyGroupId, {
          invitedEmail: 'old@example.com',
          inviteToken: 'old-token',
        }),
        familyInvite(newInviteId, targetFamilyGroupId),
      ],
    });

    const result = await acceptFamilyGroupInviteImpl(ctx, {
      inviteToken: 'invite-token',
      userProfile: userProfile(),
      now: NOW,
    });

    expect(result.previousFamilyDeleted).toBe(true);
    expect(db.record(currentFamilyGroupId).isDeleted).toBe(true);
    expect(db.record(currentMemberId).isDeleted).toBe(true);
    expect(db.record(oldInviteId)).toMatchObject({
      status: 'revoked',
      isDeleted: true,
    });
    expect(db.record(newInviteId).status).toBe('accepted');
  });

  it('blocks an owner from accepting when their current family still has members', async () => {
    const currentFamilyGroupId = 'family_current' as Id<'familyGroup'>;
    const targetFamilyGroupId = 'family_target' as Id<'familyGroup'>;
    const currentMemberId = 'member_current_owner' as Id<'familyGroupMember'>;
    const otherMemberId = 'member_other' as Id<'familyGroupMember'>;
    const inviteId = 'invite_target' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [
        familyGroup(currentFamilyGroupId, 'clerk_invitee'),
        familyGroup(targetFamilyGroupId, 'clerk_target_owner'),
      ],
      familyGroupMembers: [
        familyMember(currentMemberId, currentFamilyGroupId, 'clerk_invitee', 'owner'),
        familyMember(otherMemberId, currentFamilyGroupId, 'clerk_other', 'member'),
      ],
      familyGroupInvites: [familyInvite(inviteId, targetFamilyGroupId)],
    });

    await expect(
      acceptFamilyGroupInviteImpl(ctx, {
        inviteToken: 'invite-token',
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('Remove family members');

    expect(db.record(currentFamilyGroupId).isDeleted).toBe(false);
    expect(db.record(currentMemberId).isDeleted).toBe(false);
    expect(db.record(otherMemberId).isDeleted).toBe(false);
    expect(db.record(inviteId).status).toBe('pending');
  });
});

describe('prepareInviteForSendImpl', () => {
  it('starts the sender invite email quota window on the first send attempt', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const sender = userProfile();
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
      ],
      userProfiles: [sender],
    });

    const result = await prepareInviteForSendImpl(ctx, {
      invitedEmail: 'new-member@example.com',
      invitedName: 'New Member',
      userProfile: sender,
      now: NOW,
      createInviteToken: () => 'new-token',
    });

    expect(result).toMatchObject({
      invitedEmail: 'new-member@example.com',
      inviteToken: 'new-token',
      created: true,
    });
    expect(db.record(sender._id)).toMatchObject({
      familyInviteEmailQuotaWindowStartedAt: NOW.toISOString(),
      familyInviteEmailSendsInWindow: 1,
    });
  });

  it('allows ten invite email attempts per quota window and rejects the eleventh', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const inviteId = 'invite_pending' as Id<'familyGroupInvite'>;
    const sender = userProfile();
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
      ],
      familyGroupInvites: [
        familyInvite(inviteId, familyGroupId, {
          invitedEmail: 'repeat@example.com',
          inviteToken: 'repeat-token',
          status: 'pending',
        }),
      ],
      userProfiles: [sender],
    });

    for (let index = 0; index < 10; index += 1) {
      const result = await prepareInviteForSendImpl(ctx, {
        invitedEmail: 'repeat@example.com',
        invitedName: 'Repeat Member',
        userProfile: sender,
        now: NOW,
        createInviteToken: () => `new-token-${index}`,
      });
      expect(result._id).toBe(inviteId);
    }

    expect(db.record(sender._id).familyInviteEmailSendsInWindow).toBe(10);
    await expect(
      prepareInviteForSendImpl(ctx, {
        invitedEmail: 'repeat@example.com',
        invitedName: 'Repeat Member',
        userProfile: sender,
        now: NOW,
        createInviteToken: () => 'blocked-token',
      })
    ).rejects.toThrow('You can send up to 10 family invite emails every 30 days. Try again after 2026-07-10.');
    expect(db.record(sender._id).familyInviteEmailSendsInWindow).toBe(10);
  });

  it('resets the sender invite email quota after the rolling window expires', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const sender = userProfile({
      familyInviteEmailQuotaWindowStartedAt: '2026-05-01T12:00:00.000Z',
      familyInviteEmailSendsInWindow: 10,
    });
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
      ],
      familyGroupInvites: [
        familyInvite('invite_pending' as Id<'familyGroupInvite'>, familyGroupId, {
          invitedEmail: 'repeat@example.com',
          inviteToken: 'repeat-token',
          status: 'pending',
        }),
      ],
      userProfiles: [sender],
    });

    await prepareInviteForSendImpl(ctx, {
      invitedEmail: 'repeat@example.com',
      invitedName: 'Repeat Member',
      userProfile: sender,
      now: NOW,
      createInviteToken: () => 'new-token',
    });

    expect(db.record(sender._id)).toMatchObject({
      familyInviteEmailQuotaWindowStartedAt: NOW.toISOString(),
      familyInviteEmailSendsInWindow: 1,
    });
  });

  it('counts reusing a revoked invite against the sender invite email quota', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const inviteId = 'invite_revoked' as Id<'familyGroupInvite'>;
    const sender = userProfile();
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
      ],
      familyGroupInvites: [
        familyInvite(inviteId, familyGroupId, {
          invitedEmail: 'revoked@example.com',
          inviteToken: 'revoked-token',
          status: 'revoked',
        }),
      ],
      userProfiles: [sender],
    });

    const result = await prepareInviteForSendImpl(ctx, {
      invitedEmail: 'revoked@example.com',
      invitedName: 'Revoked Member',
      userProfile: sender,
      now: NOW,
      createInviteToken: () => 'new-token',
    });

    expect(result).toMatchObject({
      _id: inviteId,
      inviteToken: 'new-token',
      created: false,
    });
    expect(db.record(inviteId).status).toBe('sending');
    expect(db.record(sender._id).familyInviteEmailSendsInWindow).toBe(1);
  });

  it('does not refund sender invite email quota when delivery fails', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const sender = userProfile();
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
      ],
      userProfiles: [sender],
    });

    const result = await prepareInviteForSendImpl(ctx, {
      invitedEmail: 'new-member@example.com',
      invitedName: 'New Member',
      userProfile: sender,
      now: NOW,
      createInviteToken: () => 'new-token',
    });

    await failInviteSendImpl(ctx, {
      inviteId: result._id,
      errorMessage: 'No sending domain configured',
      failedAt: '2026-06-10T12:01:00.000Z',
    });

    expect(db.record(result._id)).toMatchObject({
      status: 'send_failed',
      lastSendError: 'No sending domain configured',
    });
    expect(db.record(sender._id).familyInviteEmailSendsInWindow).toBe(1);
  });

  it('keeps sender invite email quota after family group recreation', async () => {
    const deletedFamilyGroupId = 'family_deleted' as Id<'familyGroup'>;
    const activeFamilyGroupId = 'family_current' as Id<'familyGroup'>;
    const sender = userProfile({
      familyInviteEmailQuotaWindowStartedAt: '2026-06-01T12:00:00.000Z',
      familyInviteEmailSendsInWindow: 10,
    });
    const { ctx, db } = createTestContext({
      familyGroups: [
        familyGroup(deletedFamilyGroupId, 'clerk_invitee', {
          isDeleted: true,
          deletedAt: '2026-06-09T12:00:00.000Z',
        }),
        familyGroup(activeFamilyGroupId, 'clerk_invitee'),
      ],
      familyGroupMembers: [
        familyMember(
          'member_deleted_owner' as Id<'familyGroupMember'>,
          deletedFamilyGroupId,
          'clerk_invitee',
          'owner',
          {
            isDeleted: true,
            deletedAt: '2026-06-09T12:00:00.000Z',
          }
        ),
        familyMember('member_owner' as Id<'familyGroupMember'>, activeFamilyGroupId, 'clerk_invitee', 'owner'),
      ],
      userProfiles: [sender],
    });

    await expect(
      prepareInviteForSendImpl(ctx, {
        invitedEmail: 'new-member@example.com',
        invitedName: 'New Member',
        userProfile: sender,
        now: NOW,
        createInviteToken: () => 'new-token',
      })
    ).rejects.toThrow('Try again after 2026-07-01');
    expect(db.records('familyGroupInvite')).toHaveLength(0);
    expect(db.record(sender._id).familyInviteEmailSendsInWindow).toBe(10);
  });

  it('counts in-flight sending invites before reserving another invite slot', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const sender = userProfile();
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
      ],
      familyGroupInvites: Array.from({ length: 5 }, (_, index) =>
        familyInvite(`invite_sending_${index}` as Id<'familyGroupInvite'>, familyGroupId, {
          invitedEmail: `pending-${index}@example.com`,
          inviteToken: `sending-token-${index}`,
          status: 'sending',
        })
      ),
      userProfiles: [sender],
    });

    await expect(
      prepareInviteForSendImpl(ctx, {
        invitedEmail: 'new-member@example.com',
        invitedName: 'New Member',
        userProfile: sender,
        now: NOW,
        createInviteToken: () => 'new-token',
      })
    ).rejects.toThrow('up to five additional members');
    expect(db.record(sender._id).familyInviteEmailSendsInWindow).toBeUndefined();
  });

  it('allows an existing sending invite to be resent when all slots are already reserved', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const existingInviteId = 'invite_sending_0' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
      ],
      familyGroupInvites: Array.from({ length: 5 }, (_, index) =>
        familyInvite(`invite_sending_${index}` as Id<'familyGroupInvite'>, familyGroupId, {
          invitedEmail: index === 0 ? 'existing-member@example.com' : `pending-${index}@example.com`,
          inviteToken: `sending-token-${index}`,
          status: 'sending',
        })
      ),
    });

    const result = await prepareInviteForSendImpl(ctx, {
      invitedEmail: 'existing-member@example.com',
      invitedName: 'Existing Member',
      userProfile: userProfile(),
      now: NOW,
      createInviteToken: () => 'resent-token',
    });

    expect(result._id).toBe(existingInviteId);
    expect(result.created).toBe(false);
    expect(db.records('familyGroupInvite')).toHaveLength(5);
  });

  it('allows re-inviting an email after its accepted membership was removed', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const acceptedInviteId = 'invite_accepted' as Id<'familyGroupInvite'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
        familyMember('member_removed' as Id<'familyGroupMember'>, familyGroupId, 'clerk_removed', 'member', {
          isDeleted: true,
          deletedAt: '2026-06-09T12:00:00.000Z',
        }),
      ],
      familyGroupInvites: [
        familyInvite(acceptedInviteId, familyGroupId, {
          invitedEmail: 'removed@example.com',
          inviteToken: 'accepted-token',
          status: 'accepted',
        }),
      ],
    });

    const result = await prepareInviteForSendImpl(ctx, {
      invitedEmail: 'removed@example.com',
      invitedName: 'Removed Member',
      userProfile: userProfile(),
      now: NOW,
      createInviteToken: () => 'new-token',
    });

    expect(result).toMatchObject({
      invitedEmail: 'removed@example.com',
      inviteToken: 'new-token',
      created: true,
    });
    expect(db.record(acceptedInviteId).status).toBe('accepted');
    expect(db.records('familyGroupInvite')).toHaveLength(2);
  });
});

describe('leaveFamilyGroupImpl', () => {
  it('lets a non-owner member leave their current family', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const memberId = 'member_current' as Id<'familyGroupMember'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_owner')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', 'owner'),
        familyMember(memberId, familyGroupId, 'clerk_invitee', 'member'),
      ],
    });

    const result = await leaveFamilyGroupImpl(ctx, {
      userProfile: userProfile(),
      now: NOW,
    });

    expect(result).toEqual({ left: true, familyGroupDeleted: false });
    expect(db.record(memberId)).toMatchObject({
      isDeleted: true,
      deletedAt: NOW.toISOString(),
    });
    expect(db.record(familyGroupId).isDeleted).toBe(false);
  });

  it('blocks an owner from leaving until they remove active members', async () => {
    const familyGroupId = 'family_current' as Id<'familyGroup'>;
    const { ctx } = createTestContext({
      familyGroups: [familyGroup(familyGroupId, 'clerk_invitee')],
      familyGroupMembers: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_invitee', 'owner'),
        familyMember('member_other' as Id<'familyGroupMember'>, familyGroupId, 'clerk_other', 'member'),
      ],
    });

    await expect(
      leaveFamilyGroupImpl(ctx, {
        userProfile: userProfile(),
        now: NOW,
      })
    ).rejects.toThrow('Remove family members');
  });
});

describe('family group creation recovery', () => {
  it.each(['missing', 'deleted'] as const)('recovers a membership pointing to a %s family', async (state) => {
    const profile = userProfile();
    const oldGroupId = 'old_family' as Id<'familyGroup'>;
    const staleMemberId = 'stale_member' as Id<'familyGroupMember'>;
    const { ctx, db } = createTestContext({
      familyGroups: state === 'deleted' ? [familyGroup(oldGroupId, profile.clerkId, { isDeleted: true })] : [],
      familyGroupMembers: [familyMember(staleMemberId, oldGroupId, profile.clerkId, 'owner')],
    });

    const group = await ensureOwnedFamilyGroup(ctx, profile, NOW.toISOString());
    expect(group._id).not.toBe(oldGroupId);
    expect(group.ownerClerkId).toBe(profile.clerkId);
    expect(group.isDeleted).toBe(false);
    expect(db.record(staleMemberId)).toMatchObject({ isDeleted: true, deletedAt: NOW.toISOString() });
    expect(db.records('familyGroupMember').filter((member) => !member.isDeleted)).toHaveLength(1);
    expect((await ensureOwnedFamilyGroup(ctx, profile, NOW.toISOString()))._id).toBe(group._id);
    expect(db.records('familyGroupMember').filter((member) => !member.isDeleted)).toHaveLength(1);
    if (state === 'deleted') expect(db.record(oldGroupId).isDeleted).toBe(true);
  });

  it('recovers a former regular member without changing other memberships', async () => {
    const profile = userProfile();
    const oldGroupId = 'old_family' as Id<'familyGroup'>;
    const otherMemberId = 'other_member' as Id<'familyGroupMember'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(oldGroupId, 'other_owner', { isDeleted: true })],
      familyGroupMembers: [
        familyMember('stale_member' as Id<'familyGroupMember'>, oldGroupId, profile.clerkId, 'member'),
        familyMember(otherMemberId, oldGroupId, 'other_user', 'member'),
      ],
    });
    expect((await ensureOwnedFamilyGroup(ctx, profile, NOW.toISOString())).ownerClerkId).toBe(profile.clerkId);
    expect(db.record(otherMemberId).isDeleted).toBe(false);
  });

  it('still rejects a member of a live family', async () => {
    const profile = userProfile();
    const groupId = 'live_family' as Id<'familyGroup'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(groupId, 'other_owner')],
      familyGroupMembers: [familyMember('live_member' as Id<'familyGroupMember'>, groupId, profile.clerkId, 'member')],
    });
    await expect(ensureOwnedFamilyGroup(ctx, profile, NOW.toISOString())).rejects.toThrow(
      'You already belong to a family group'
    );
    expect(db.records('familyGroup')).toHaveLength(1);
    expect(db.record('live_member').isDeleted).toBe(false);
  });

  it('reuses an existing owned family after retiring a stale membership', async () => {
    const profile = userProfile();
    const liveGroupId = 'live_family' as Id<'familyGroup'>;
    const { ctx, db } = createTestContext({
      familyGroups: [familyGroup(liveGroupId, profile.clerkId)],
      familyGroupMembers: [
        familyMember(
          'stale_member' as Id<'familyGroupMember'>,
          'missing_family' as Id<'familyGroup'>,
          profile.clerkId,
          'owner'
        ),
        familyMember('old_owner' as Id<'familyGroupMember'>, liveGroupId, profile.clerkId, 'owner', {
          isDeleted: true,
        }),
      ],
    });
    expect((await ensureOwnedFamilyGroup(ctx, profile, NOW.toISOString()))._id).toBe(liveGroupId);
    expect(db.records('familyGroup')).toHaveLength(1);
    expect(db.record('old_owner').isDeleted).toBe(false);
    expect(db.record('stale_member').isDeleted).toBe(true);
  });
});
