import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';
import type { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getCurrentYearMonthForTimezone } from '../lib/dates';
import {
  completeUserOnboarding as registeredComplete,
  finishGuidedOnboarding as registeredFinish,
  prepareGuidedOnboarding as registeredPrepare,
  prepareGuidedOnboardingTarget as registeredTarget,
} from './update';

vi.mock('../activityLogs/helpers', () => ({
  buildActivityContext: vi.fn(async () => ({})),
  recordCategoryActivity: vi.fn(async () => undefined),
}));

// Match the repository's registered-handler unit-test pattern. Auth, category
// generation, and target writes execute against an indexed in-memory context.
function handler<Args, Result>(registered: unknown) {
  return (registered as { _handler: (ctx: MutationCtx, args: Args) => Promise<Result> })._handler;
}
const complete = handler<
  FunctionArgs<typeof api.userProfiles.completeUserOnboarding>,
  FunctionReturnType<typeof api.userProfiles.completeUserOnboarding>
>(registeredComplete);
const prepare = handler<
  FunctionArgs<typeof api.userProfiles.prepareGuidedOnboarding>,
  FunctionReturnType<typeof api.userProfiles.prepareGuidedOnboarding>
>(registeredPrepare);
const saveTarget = handler<
  FunctionArgs<typeof api.userProfiles.prepareGuidedOnboardingTarget>,
  FunctionReturnType<typeof api.userProfiles.prepareGuidedOnboardingTarget>
>(registeredTarget);
const finish = handler<
  FunctionArgs<typeof api.userProfiles.finishGuidedOnboarding>,
  FunctionReturnType<typeof api.userProfiles.finishGuidedOnboarding>
>(registeredFinish);

type Row = Record<string, unknown> & { _id: string };
function setup(signedIn = true) {
  const profile: Row = {
    _id: 'profile-1',
    clerkId: 'user-1',
    email: 'test@example.com',
    onboardingCompleted: false,
  };
  const tables = new Map<string, Row[]>([['userProfile', [profile]]]);
  const row = (id: string) => [...tables.values()].flat().find((value) => value._id === id) ?? null;
  const query = (table: string) => {
    const constraints: Array<[string, unknown]> = [];
    const range = {
      eq: (field: string, value: unknown) => {
        constraints.push([field, value]);
        return range;
      },
    };
    const matches = () =>
      (tables.get(table) ?? []).filter((value) => constraints.every(([field, expected]) => value[field] === expected));
    const builder = {
      withIndex: (_index: string, build: (q: typeof range) => unknown) => {
        build(range);
        return builder;
      },
      first: async () => matches()[0] ?? null,
      take: async (count: number) => matches().slice(0, count),
    };
    return builder;
  };
  const runAfter = vi.fn(async (_delay: number, _reference: unknown, _args: Record<string, unknown>) => 'scheduled-1');
  const ctx = {
    scheduler: { runAfter },
    auth: { getUserIdentity: async () => (signedIn ? { subject: 'user-1', tokenIdentifier: 'clerk|user-1' } : null) },
    db: {
      query,
      get: async (id: string) => row(id),
      insert: async (table: string, fields: Record<string, unknown>) => {
        const values = tables.get(table) ?? [];
        const id = `${table}-${values.length + 1}`;
        values.push({ ...fields, _id: id });
        tables.set(table, values);
        return id;
      },
      patch: async (id: string, fields: Record<string, unknown>) => {
        const value = row(id);
        if (!value) throw new Error(`Missing ${id}`);
        Object.assign(value, fields);
      },
    },
  } as unknown as MutationCtx;
  return { ctx, tables, row, profile, runAfter };
}

const answers: FunctionArgs<typeof api.userProfiles.prepareGuidedOnboarding> = {
  currency: 'usd',
  timezone: 'America/New_York',
  onboardingAnswers: {
    housing: 'rent',
    transportation: ['transit'],
    household: ['children', 'pets'],
    financialGoals: ['emergency', 'vacation'],
  },
};

describe('guided iOS onboarding', () => {
  it('creates personalized real categories and locale settings while leaving completion false', async () => {
    const test = setup();
    const result = await prepare(test.ctx, answers);
    expect(test.profile.activeWorkspaceId).toBe(result.workspaceId);
    expect(test.profile.onboardingCompleted).toBe(false);
    expect(test.row(result.workspaceId)).toMatchObject({
      currency: 'USD',
      timezone: 'America/New_York',
      readyToAssign: 0n,
      onboardingCompleted: false,
    });
    const names = (test.tables.get('category') ?? []).map((value) => value.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '🏠 Rent',
        '🚇 Transit Pass',
        '👶 Childcare',
        '🐾 Pet Care',
        '🏦 Emergency Fund',
        '✈️ Vacation',
      ])
    );
    expect(names).not.toContain('🚗 Auto Loan');
    expect(names).not.toContain('🏠 Mortgage');
  });

  it('retries workspace preparation without duplicating workspaces, groups, or categories', async () => {
    const test = setup();
    const first = await prepare(test.ctx, answers);
    const categories = test.tables.get('category')?.length;
    const groups = test.tables.get('categoryGroup')?.length;
    expect(await prepare(test.ctx, { ...answers, currency: 'EUR' })).toEqual(first);
    expect(test.tables.get('workspace')).toHaveLength(1);
    expect(test.tables.get('category')).toHaveLength(categories ?? 0);
    expect(test.tables.get('categoryGroup')).toHaveLength(groups ?? 0);
    expect(test.row(first.workspaceId)?.currency).toBe('USD');
  });

  it('rejects unauthenticated and already-completed preparation', async () => {
    await expect(prepare(setup(false).ctx, answers)).rejects.toThrow('Authentication required');
    const test = setup();
    test.profile.onboardingCompleted = true;
    await expect(prepare(test.ctx, answers)).rejects.toThrow('already complete');
    expect(test.tables.get('workspace')).toBeUndefined();
  });

  it('rebuilds deleted envelopes and reuses their existing groups', async () => {
    const test = setup();
    const first = await prepare(test.ctx, answers);
    const originalGroups = test.tables.get('categoryGroup')?.length;
    for (const category of test.tables.get('category') ?? []) category.isDeleted = true;
    expect(await prepare(test.ctx, answers)).toEqual(first);
    const activeCategories = test.tables.get('category')?.filter((category) => !category.isDeleted);
    expect(activeCategories?.length).toBeGreaterThan(0);
    expect(activeCategories?.some((category) => category.name === '🛒 Groceries')).toBe(true);
    expect(test.tables.get('categoryGroup')).toHaveLength(originalGroups ?? 0);
  });

  it('validates currency and timezone before creating anything', async () => {
    const test = setup();
    await expect(prepare(test.ctx, { ...answers, currency: 'made-up' })).rejects.toThrow('supported currency');
    await expect(prepare(test.ctx, { ...answers, timezone: 'Moon/SeaOfTranquility' })).rejects.toThrow(
      'valid timezone'
    );
    expect(test.tables.get('workspace')).toBeUndefined();
  });

  it('deduplicates repeated questionnaire answers', async () => {
    const test = setup();
    await prepare(test.ctx, {
      ...answers,
      onboardingAnswers: { ...answers.onboardingAnswers, financialGoals: ['emergency', 'emergency'] },
    });
    expect(test.tables.get('category')?.filter((value) => value.name === '🏦 Emergency Fund')).toHaveLength(1);
  });

  it('saves and retries a real target, allowing an intentional amount revision', async () => {
    const test = setup();
    const { workspaceId } = await prepare(test.ctx, answers);
    const categoryId = test.tables.get('category')?.[0]._id as Id<'category'>;
    const request = { workspaceId, categoryId, amount: 10_000 };
    await saveTarget(test.ctx, request);
    await saveTarget(test.ctx, request);
    expect(test.row(categoryId)).toMatchObject({
      enableTarget: true,
      target_type: 'recurring',
      target_frequency: 'monthly',
      target_amount: 10_000n,
    });
    expect(test.profile.onboardingCompleted).toBe(false);
    await saveTarget(test.ctx, { ...request, amount: 25_000 });
    expect(test.row(categoryId)?.target_amount).toBe(25_000n);
    await expect(saveTarget(test.ctx, { ...request, amount: 0 })).rejects.toThrow('positive target');
    await expect(saveTarget(test.ctx, { ...request, amount: 1.5 })).rejects.toThrow('positive target');
    await expect(saveTarget(test.ctx, { ...request, amount: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow(
      'positive target'
    );
  });

  it('requires an actual target and assignment before completing a funded budget', async () => {
    const test = setup();
    const { workspaceId } = await prepare(test.ctx, answers);
    const categoryId = test.tables.get('category')?.[0]._id as Id<'category'>;
    const request = { workspaceId, categoryId, practicedWithoutFunds: false };
    await expect(finish(test.ctx, request)).rejects.toThrow('first category target');
    await saveTarget(test.ctx, { workspaceId, categoryId, amount: 10_000 });
    const workspace = test.row(workspaceId);
    if (!workspace) throw new Error('Missing workspace');
    workspace.readyToAssign = 50_000n;
    await expect(finish(test.ctx, request)).rejects.toThrow('Quick Assign');
    await expect(finish(test.ctx, { ...request, practicedWithoutFunds: true })).rejects.toThrow('Quick Assign');
    expect(test.profile.onboardingCompleted).toBe(false);
    test.tables.set('categoryBudget', [
      {
        _id: 'budget-1',
        workspaceId,
        categoryId,
        monthlyAssignedAmounts: { [String(getCurrentYearMonthForTimezone('America/New_York'))]: 10_000n },
      },
    ]);
    expect(await finish(test.ctx, request)).toEqual({ success: true });
    expect(test.profile.onboardingCompleted).toBe(true);
    expect(workspace.onboardingCompleted).toBe(true);
    expect(await finish(test.ctx, request)).toEqual({ success: true });
  });

  it.each([0n, -500n])(
    'permits explicit practice at RTA %s without inventing a balance or assignment',
    async (readyToAssign) => {
      const test = setup();
      const { workspaceId } = await prepare(test.ctx, answers);
      const categoryId = test.tables.get('category')?.[0]._id as Id<'category'>;
      await saveTarget(test.ctx, { workspaceId, categoryId, amount: 10_000 });
      const workspace = test.row(workspaceId);
      if (!workspace) throw new Error('Missing workspace');
      workspace.readyToAssign = readyToAssign;
      await expect(finish(test.ctx, { workspaceId, categoryId, practicedWithoutFunds: false })).rejects.toThrow(
        'Quick Assign'
      );
      expect(await finish(test.ctx, { workspaceId, categoryId, practicedWithoutFunds: true })).toEqual({
        success: true,
      });
      expect(workspace.readyToAssign).toBe(readyToAssign);
      expect(test.tables.get('categoryBudget')).toBeUndefined();
    }
  );

  it('rejects foreign and deleted workspace/category identifiers', async () => {
    const test = setup();
    const { workspaceId } = await prepare(test.ctx, answers);
    const categoryId = test.tables.get('category')?.[0]._id as Id<'category'>;
    const workspace = test.row(workspaceId);
    if (!workspace) throw new Error('Missing workspace');
    workspace.ownerClerkId = 'someone-else';
    await expect(saveTarget(test.ctx, { workspaceId, categoryId, amount: 100 })).rejects.toThrow('no longer available');
    await expect(finish(test.ctx, { workspaceId, categoryId, practicedWithoutFunds: true })).rejects.toThrow(
      'no longer available'
    );
    workspace.ownerClerkId = 'user-1';
    const category = test.row(categoryId);
    if (!category) throw new Error('Missing category');
    category.workspaceId = 'foreign';
    await expect(saveTarget(test.ctx, { workspaceId, categoryId, amount: 100 })).rejects.toThrow(
      'spending or saving categories'
    );
    category.workspaceId = workspaceId;
    category.isDeleted = true;
    await expect(saveTarget(test.ctx, { workspaceId, categoryId, amount: 100 })).rejects.toThrow(
      'spending or saving categories'
    );
  });
});

describe('onboarding conversion privacy boundary', () => {
  function attributedProfile() {
    const test = setup();
    const timestamp = new Date().toISOString();
    const attribution = {
      consent: true,
      measurementPolicy: 'us-opt-out-v1' as const,
      oppref: 'previous-web-click',
      clickedAt: timestamp,
      facebook: { fbclid: 'previous-facebook-click', clickedAt: timestamp, clientUserAgent: 'browser' },
    };
    test.profile.adAttribution = { ...attribution, updatedAt: timestamp };
    test.profile.adConsentRevocationKey = 'existing-revocation-seed';
    return { ...test, attribution };
  }

  it('does not reuse a stored web click when native onboarding omits ad measurement', async () => {
    const test = attributedProfile();
    const result = await complete(test.ctx, { workspaceName: 'Native budget' });
    expect(result.success).toBe(true);
    expect(result.adConsentRevocation).toBeNull();
    expect(test.profile.onboardingCompleted).toBe(true);
    expect(test.runAfter).not.toHaveBeenCalled();
  });

  it.each([{ consent: false }, { consent: true }])(
    'does not queue conversions for a current payload without US web measurement permission: %j',
    async (adAttribution) => {
      const test = attributedProfile();
      await complete(test.ctx, { adAttribution });
      expect(test.profile.onboardingCompleted).toBe(true);
      expect(test.runAfter).not.toHaveBeenCalled();
    }
  );

  it('ignores even explicitly permitted attribution from old clients and clears stored identifiers', async () => {
    const test = attributedProfile();
    await complete(test.ctx, { adAttribution: test.attribution });
    expect(test.profile.onboardingCompleted).toBe(true);
    expect(test.runAfter).not.toHaveBeenCalled();
    expect(test.profile.adAttribution).toBeUndefined();
    expect(test.profile.adConsentRevocationKey).toBeUndefined();
  });
});
