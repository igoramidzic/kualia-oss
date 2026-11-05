import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { requireBankLinkAccountAccessForWorkspace, unlinkBankAccountsForSeparatedFamilyMember } from './helpers';

type TableName =
  | 'workspace'
  | 'familyGroup'
  | 'familyGroupMember'
  | 'bankLink'
  | 'bankLinkAccount'
  | 'financeKitConnection'
  | 'financeKitSyncToken'
  | 'financeKitAccount'
  | 'bankAccount'
  | 'widgetToken';
type FakeRecord = Record<string, unknown> & { _id: string };
type FakeFilter = { field: string; operator: 'eq' | 'neq'; value: unknown };

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
    private readonly filters: FakeFilter[] = []
  ) {}

  withIndex(_indexName: string, callback: (q: FakeIndexBuilder) => FakeIndexBuilder): FakeQuery {
    const builder = new FakeIndexBuilder();
    callback(builder);
    return new FakeQuery(this.records, builder.filters);
  }

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

  private applyFilters(): FakeRecord[] {
    return this.records.filter((record) =>
      this.filters.every((filter) =>
        filter.operator === 'eq' ? record[filter.field] === filter.value : record[filter.field] !== filter.value
      )
    );
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

  async patch(id: string, updates: Record<string, unknown>): Promise<void> {
    const record = await this.get(id);
    if (!record) {
      throw new Error(`Missing fake record: ${id}`);
    }

    Object.assign(record, updates);
  }

  record(id: string): FakeRecord {
    for (const records of this.recordsByTable.values()) {
      const record = records.get(id);
      if (record) {
        return record;
      }
    }

    throw new Error(`Missing fake record: ${id}`);
  }
}

function createTestContext(recordsByTable: Partial<Record<TableName, FakeRecord[]>>): { ctx: MutationCtx; db: FakeDb } {
  const tableMaps = new Map<TableName, Map<string, FakeRecord>>();
  for (const tableName of [
    'workspace',
    'familyGroup',
    'familyGroupMember',
    'bankLink',
    'bankLinkAccount',
    'financeKitConnection',
    'financeKitSyncToken',
    'financeKitAccount',
    'bankAccount',
    'widgetToken',
  ] as const) {
    const records = recordsByTable[tableName] ?? [];
    tableMaps.set(tableName, new Map(records.map((record) => [record._id, record])));
  }

  const db = new FakeDb(tableMaps);
  return { ctx: { db } as unknown as MutationCtx, db };
}

function workspace(id: Id<'workspace'>, ownerClerkId: string): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: String(id),
    ownerClerkId,
    transactionDefaultPendingStatus: false,
    isDeleted: false,
  };
}

function familyGroup(id: Id<'familyGroup'>): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: String(id),
    ownerUserProfileId: 'profile_owner' as Id<'userProfile'>,
    ownerClerkId: 'clerk_owner',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    isDeleted: false,
  };
}

function familyMember(
  id: Id<'familyGroupMember'>,
  familyGroupId: Id<'familyGroup'>,
  clerkId: string,
  role: 'owner' | 'member'
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
  };
}

function bankLink(id: Id<'bankLink'>, ownerId: string): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    accessToken: `${id}_access_token`,
    globalInstitutionId: 'global_institution_1' as Id<'globalInstitution'>,
    itemId: `${id}_item`,
    itemStatus: 'Healthy',
    ownerId,
    provider: 'plaid',
    isDeleted: false,
  };
}

function bankLinkAccount(id: Id<'bankLinkAccount'>, linkId: Id<'bankLink'>): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    accountType: 'banking_checking',
    bankLinkId: linkId,
    name: String(id),
    plaidAccountId: `${id}_plaid`,
    updatedAt: '2026-06-01T00:00:00.000Z',
    isDeleted: false,
  };
}

function bankAccount(
  id: Id<'bankAccount'>,
  workspaceId: Id<'workspace'>,
  linkAccountId: Id<'bankLinkAccount'>
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: String(id),
    workspaceId,
    bankLinkAccountId: linkAccountId,
    accountType: 'banking_checking',
    currentBalance: 0n,
    isClosed: false,
    isDeleted: false,
  };
}

function financeKitConnection(
  id: Id<'financeKitConnection'>,
  workspaceId: Id<'workspace'>,
  ownerClerkId: string
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    workspaceId,
    ownerClerkId,
    deviceId: `${id}_device`,
    status: 'active',
    syncStartDate: '2026-06-01',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    isDeleted: false,
  };
}

function financeKitAccount(
  id: Id<'financeKitAccount'>,
  workspaceId: Id<'workspace'>,
  connectionId: Id<'financeKitConnection'>,
  bankAccountId: Id<'bankAccount'>
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    workspaceId,
    connectionId,
    externalAccountId: `${id}_external`,
    accountKind: 'asset',
    accountType: 'banking_checking',
    displayName: String(id),
    currencyCode: 'USD',
    hasCompletedInitialSync: true,
    bankAccountId,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    isDeleted: false,
  };
}

function financeKitBankAccount(
  id: Id<'bankAccount'>,
  workspaceId: Id<'workspace'>,
  financeKitAccountId: Id<'financeKitAccount'>
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    name: String(id),
    workspaceId,
    financeKitAccountId,
    accountType: 'banking_checking',
    currentBalance: 0n,
    isClosed: false,
    isDeleted: false,
  };
}

function widgetToken(id: Id<'widgetToken'>, workspaceId: Id<'workspace'>, clerkId: string): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    workspaceId,
    clerkId,
    token: `${id}_token`,
    createdAt: '2026-06-01T00:00:00.000Z',
    isRevoked: false,
  };
}

function financeKitSyncToken(
  id: Id<'financeKitSyncToken'>,
  workspaceId: Id<'workspace'>,
  ownerClerkId: string
): FakeRecord {
  return {
    _id: id,
    _creationTime: 1,
    workspaceId,
    ownerClerkId,
    deviceId: `${id}_device`,
    token: `${id}_token`,
    createdAt: '2026-06-01T00:00:00.000Z',
    refreshedAt: '2026-06-01T00:00:00.000Z',
    isRevoked: false,
  };
}

describe('requireBankLinkAccountAccessForWorkspace', () => {
  it('allows a workspace to use a bank link account owned by a family member', async () => {
    const workspaceId = 'workspace_owner' as Id<'workspace'>;
    const familyGroupId = 'family_one' as Id<'familyGroup'>;
    const linkId = 'bank_link_member' as Id<'bankLink'>;
    const linkAccountId = 'bank_link_account_member' as Id<'bankLinkAccount'>;
    const { ctx } = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
      familyGroup: [familyGroup(familyGroupId)],
      familyGroupMember: [
        familyMember('member_owner' as Id<'familyGroupMember'>, familyGroupId, 'clerk_owner', 'owner'),
        familyMember('member_user' as Id<'familyGroupMember'>, familyGroupId, 'clerk_member', 'member'),
      ],
      bankLink: [bankLink(linkId, 'clerk_member')],
      bankLinkAccount: [bankLinkAccount(linkAccountId, linkId)],
    });

    const access = await requireBankLinkAccountAccessForWorkspace(ctx, workspaceId, linkAccountId);

    expect(access.bankLink.ownerId).toBe('clerk_member');
    expect(access.bankLinkAccount._id).toBe(linkAccountId);
  });

  it('rejects a bank link account owned outside the workspace family', async () => {
    const workspaceId = 'workspace_owner' as Id<'workspace'>;
    const linkId = 'bank_link_outside' as Id<'bankLink'>;
    const linkAccountId = 'bank_link_account_outside' as Id<'bankLinkAccount'>;
    const { ctx } = createTestContext({
      workspace: [workspace(workspaceId, 'clerk_owner')],
      bankLink: [bankLink(linkId, 'clerk_outside')],
      bankLinkAccount: [bankLinkAccount(linkAccountId, linkId)],
    });

    await expect(requireBankLinkAccountAccessForWorkspace(ctx, workspaceId, linkAccountId)).rejects.toThrow(
      'cannot be used'
    );
  });
});

describe('unlinkBankAccountsForSeparatedFamilyMember', () => {
  it('severs only bank account links crossing between the separated member and their old family', async () => {
    const nowIso = '2026-06-11T12:00:00.000Z';
    const ownerWorkspaceId = 'workspace_owner' as Id<'workspace'>;
    const removedWorkspaceId = 'workspace_removed' as Id<'workspace'>;
    const removedLinkId = 'bank_link_removed' as Id<'bankLink'>;
    const ownerLinkId = 'bank_link_owner' as Id<'bankLink'>;
    const removedLinkAccountId = 'bank_link_account_removed' as Id<'bankLinkAccount'>;
    const ownerLinkAccountId = 'bank_link_account_owner' as Id<'bankLinkAccount'>;
    const { ctx, db } = createTestContext({
      workspace: [workspace(ownerWorkspaceId, 'clerk_owner'), workspace(removedWorkspaceId, 'clerk_removed')],
      bankLink: [bankLink(removedLinkId, 'clerk_removed'), bankLink(ownerLinkId, 'clerk_owner')],
      bankLinkAccount: [
        bankLinkAccount(removedLinkAccountId, removedLinkId),
        bankLinkAccount(ownerLinkAccountId, ownerLinkId),
      ],
      bankAccount: [
        bankAccount(
          'bank_account_owner_using_removed_link' as Id<'bankAccount'>,
          ownerWorkspaceId,
          removedLinkAccountId
        ),
        bankAccount(
          'bank_account_removed_using_removed_link' as Id<'bankAccount'>,
          removedWorkspaceId,
          removedLinkAccountId
        ),
        bankAccount(
          'bank_account_removed_using_owner_link' as Id<'bankAccount'>,
          removedWorkspaceId,
          ownerLinkAccountId
        ),
        bankAccount('bank_account_owner_using_owner_link' as Id<'bankAccount'>, ownerWorkspaceId, ownerLinkAccountId),
      ],
      widgetToken: [
        widgetToken('widget_removed_owner' as Id<'widgetToken'>, ownerWorkspaceId, 'clerk_removed'),
        widgetToken('widget_removed_own' as Id<'widgetToken'>, removedWorkspaceId, 'clerk_removed'),
        widgetToken('widget_owner_removed' as Id<'widgetToken'>, removedWorkspaceId, 'clerk_owner'),
        widgetToken('widget_owner_own' as Id<'widgetToken'>, ownerWorkspaceId, 'clerk_owner'),
      ],
      financeKitSyncToken: [
        financeKitSyncToken(
          'financekit_token_removed_owner' as Id<'financeKitSyncToken'>,
          ownerWorkspaceId,
          'clerk_removed'
        ),
        financeKitSyncToken(
          'financekit_token_removed_own' as Id<'financeKitSyncToken'>,
          removedWorkspaceId,
          'clerk_removed'
        ),
        financeKitSyncToken(
          'financekit_token_owner_removed' as Id<'financeKitSyncToken'>,
          removedWorkspaceId,
          'clerk_owner'
        ),
        financeKitSyncToken('financekit_token_owner_own' as Id<'financeKitSyncToken'>, ownerWorkspaceId, 'clerk_owner'),
      ],
    });

    const unlinkedCount = await unlinkBankAccountsForSeparatedFamilyMember(ctx, {
      memberClerkId: 'clerk_removed',
      familyMemberClerkIds: ['clerk_owner', 'clerk_removed'],
      nowIso,
    });

    expect(unlinkedCount).toBe(2);
    expect(db.record('bank_account_owner_using_removed_link').bankLinkAccountId).toBeUndefined();
    expect(db.record('bank_account_owner_using_removed_link').updatedAt).toBe(nowIso);
    expect(db.record('bank_account_removed_using_owner_link').bankLinkAccountId).toBeUndefined();
    expect(db.record('bank_account_removed_using_owner_link').updatedAt).toBe(nowIso);
    expect(db.record('bank_account_removed_using_removed_link').bankLinkAccountId).toBe(removedLinkAccountId);
    expect(db.record('bank_account_owner_using_owner_link').bankLinkAccountId).toBe(ownerLinkAccountId);
    expect(db.record('widget_removed_owner').isRevoked).toBe(true);
    expect(db.record('widget_owner_removed').isRevoked).toBe(true);
    expect(db.record('widget_removed_own').isRevoked).toBe(false);
    expect(db.record('widget_owner_own').isRevoked).toBe(false);
    expect(db.record('financekit_token_removed_owner').isRevoked).toBe(true);
    expect(db.record('financekit_token_removed_owner').revokedAt).toBe(nowIso);
    expect(db.record('financekit_token_owner_removed').isRevoked).toBe(true);
    expect(db.record('financekit_token_removed_own').isRevoked).toBe(false);
    expect(db.record('financekit_token_owner_own').isRevoked).toBe(false);
  });

  it('severs FinanceKit bank account links crossing between the separated member and their old family', async () => {
    const nowIso = '2026-06-11T12:00:00.000Z';
    const ownerWorkspaceId = 'workspace_owner' as Id<'workspace'>;
    const removedWorkspaceId = 'workspace_removed' as Id<'workspace'>;
    const removedConnectionInOwnerWorkspaceId =
      'financekit_connection_removed_in_owner_workspace' as Id<'financeKitConnection'>;
    const removedConnectionInRemovedWorkspaceId =
      'financekit_connection_removed_in_removed_workspace' as Id<'financeKitConnection'>;
    const ownerConnectionInRemovedWorkspaceId =
      'financekit_connection_owner_in_removed_workspace' as Id<'financeKitConnection'>;
    const ownerConnectionInOwnerWorkspaceId =
      'financekit_connection_owner_in_owner_workspace' as Id<'financeKitConnection'>;
    const removedAccountInOwnerWorkspaceId = 'financekit_account_removed_in_owner_workspace' as Id<'financeKitAccount'>;
    const removedAccountInRemovedWorkspaceId =
      'financekit_account_removed_in_removed_workspace' as Id<'financeKitAccount'>;
    const ownerAccountInRemovedWorkspaceId = 'financekit_account_owner_in_removed_workspace' as Id<'financeKitAccount'>;
    const ownerAccountInOwnerWorkspaceId = 'financekit_account_owner_in_owner_workspace' as Id<'financeKitAccount'>;
    const bankAccountOwnerUsingRemovedFinanceKit = 'bank_account_owner_using_removed_financekit' as Id<'bankAccount'>;
    const bankAccountRemovedUsingRemovedFinanceKit =
      'bank_account_removed_using_removed_financekit' as Id<'bankAccount'>;
    const bankAccountRemovedUsingOwnerFinanceKit = 'bank_account_removed_using_owner_financekit' as Id<'bankAccount'>;
    const bankAccountOwnerUsingOwnerFinanceKit = 'bank_account_owner_using_owner_financekit' as Id<'bankAccount'>;
    const { ctx, db } = createTestContext({
      workspace: [workspace(ownerWorkspaceId, 'clerk_owner'), workspace(removedWorkspaceId, 'clerk_removed')],
      financeKitConnection: [
        financeKitConnection(removedConnectionInOwnerWorkspaceId, ownerWorkspaceId, 'clerk_removed'),
        financeKitConnection(removedConnectionInRemovedWorkspaceId, removedWorkspaceId, 'clerk_removed'),
        financeKitConnection(ownerConnectionInRemovedWorkspaceId, removedWorkspaceId, 'clerk_owner'),
        financeKitConnection(ownerConnectionInOwnerWorkspaceId, ownerWorkspaceId, 'clerk_owner'),
      ],
      financeKitAccount: [
        financeKitAccount(
          removedAccountInOwnerWorkspaceId,
          ownerWorkspaceId,
          removedConnectionInOwnerWorkspaceId,
          bankAccountOwnerUsingRemovedFinanceKit
        ),
        financeKitAccount(
          removedAccountInRemovedWorkspaceId,
          removedWorkspaceId,
          removedConnectionInRemovedWorkspaceId,
          bankAccountRemovedUsingRemovedFinanceKit
        ),
        financeKitAccount(
          ownerAccountInRemovedWorkspaceId,
          removedWorkspaceId,
          ownerConnectionInRemovedWorkspaceId,
          bankAccountRemovedUsingOwnerFinanceKit
        ),
        financeKitAccount(
          ownerAccountInOwnerWorkspaceId,
          ownerWorkspaceId,
          ownerConnectionInOwnerWorkspaceId,
          bankAccountOwnerUsingOwnerFinanceKit
        ),
      ],
      bankAccount: [
        financeKitBankAccount(
          bankAccountOwnerUsingRemovedFinanceKit,
          ownerWorkspaceId,
          removedAccountInOwnerWorkspaceId
        ),
        financeKitBankAccount(
          bankAccountRemovedUsingRemovedFinanceKit,
          removedWorkspaceId,
          removedAccountInRemovedWorkspaceId
        ),
        financeKitBankAccount(
          bankAccountRemovedUsingOwnerFinanceKit,
          removedWorkspaceId,
          ownerAccountInRemovedWorkspaceId
        ),
        financeKitBankAccount(bankAccountOwnerUsingOwnerFinanceKit, ownerWorkspaceId, ownerAccountInOwnerWorkspaceId),
      ],
    });

    const unlinkedCount = await unlinkBankAccountsForSeparatedFamilyMember(ctx, {
      memberClerkId: 'clerk_removed',
      familyMemberClerkIds: ['clerk_owner', 'clerk_removed'],
      nowIso,
    });

    expect(unlinkedCount).toBe(2);
    expect(db.record(bankAccountOwnerUsingRemovedFinanceKit).financeKitAccountId).toBeUndefined();
    expect(db.record(bankAccountOwnerUsingRemovedFinanceKit).updatedAt).toBe(nowIso);
    expect(db.record(removedAccountInOwnerWorkspaceId).bankAccountId).toBeUndefined();
    expect(db.record(removedAccountInOwnerWorkspaceId).updatedAt).toBe(nowIso);
    expect(db.record(bankAccountRemovedUsingOwnerFinanceKit).financeKitAccountId).toBeUndefined();
    expect(db.record(bankAccountRemovedUsingOwnerFinanceKit).updatedAt).toBe(nowIso);
    expect(db.record(ownerAccountInRemovedWorkspaceId).bankAccountId).toBeUndefined();
    expect(db.record(ownerAccountInRemovedWorkspaceId).updatedAt).toBe(nowIso);
    expect(db.record(bankAccountRemovedUsingRemovedFinanceKit).financeKitAccountId).toBe(
      removedAccountInRemovedWorkspaceId
    );
    expect(db.record(removedAccountInRemovedWorkspaceId).bankAccountId).toBe(bankAccountRemovedUsingRemovedFinanceKit);
    expect(db.record(bankAccountOwnerUsingOwnerFinanceKit).financeKitAccountId).toBe(ownerAccountInOwnerWorkspaceId);
    expect(db.record(ownerAccountInOwnerWorkspaceId).bankAccountId).toBe(bankAccountOwnerUsingOwnerFinanceKit);
  });
});
