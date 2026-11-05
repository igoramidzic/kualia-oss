import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { CheckIn } from './types';
import { recordCheckIn, updateApnsDeviceToken } from './update';

const record = (
  recordCheckIn as unknown as {
    _handler: (ctx: MutationCtx, args: { timezone: string }) => Promise<CheckIn>;
  }
)._handler;

const updateToken = (
  updateApnsDeviceToken as unknown as {
    _handler: (ctx: MutationCtx, args: { apnsDeviceToken: string }) => Promise<{ success: true }>;
  }
)._handler;

function setup(subject: string | null = 'user-1', deleted = false) {
  const profiles: Doc<'userProfile'>[] = ['user-1', 'user-2'].map((clerkId) => ({
    _id: clerkId as Id<'userProfile'>,
    _creationTime: 1,
    clerkId,
    email: `${clerkId}@example.com`,
    onboardingCompleted: true,
    isDeleted: deleted,
  }));
  const patch = vi.fn(async (id: Id<'userProfile'>, fields: Partial<Doc<'userProfile'>>) => {
    const profile = profiles.find((p) => p._id === id);
    if (!profile) throw new Error('Missing profile');
    Object.assign(profile, fields);
  });
  const ctx = {
    auth: { getUserIdentity: async () => (subject ? { subject, tokenIdentifier: `clerk|${subject}` } : null) },
    db: {
      query: (table: string) => {
        expect(table).toBe('userProfile');
        return {
          withIndex: (index: string, range: (q: { eq: (field: string, value: string) => string }) => string) => {
            expect(index).toBe('by_clerkId');
            const id = range({
              eq: (field, value) => {
                expect(field).toBe('clerkId');
                return value;
              },
            });
            return { first: async () => profiles.find((p) => p.clerkId === id) ?? null };
          },
        };
      },
      patch,
    },
  } as unknown as MutationCtx;
  return { ctx, profiles, patch };
}

afterEach(() => vi.useRealTimers());

describe('recordCheckIn', () => {
  it('writes only the authenticated profile and performs no repeated-day write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T18:00:00Z'));
    const { ctx, profiles, patch } = setup();
    const first = await record(ctx, { timezone: 'America/New_York' });
    expect(first.days).toBe(1);
    expect(profiles[1].checkIn).toBeUndefined();
    expect(await record(ctx, { timezone: 'Asia/Tokyo' })).toEqual(first);
    expect(patch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-12T18:00:00Z'));
    expect((await record(ctx, { timezone: 'UTC' })).days).toBe(2);
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it.each([null, 'missing-user'])('rejects missing authentication/profile: %s', async (subject) => {
    const { ctx, patch } = setup(subject);
    await expect(record(ctx, { timezone: 'UTC' })).rejects.toThrow();
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects deleted accounts', async () => {
    const { ctx, patch } = setup('user-1', true);
    await expect(record(ctx, { timezone: 'UTC' })).rejects.toThrow('User profile not found');
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('APNs launch registration', () => {
  it('does not rewrite the profile or its updatedAt timestamp when the registered token is unchanged', async () => {
    const { ctx, profiles, patch } = setup();
    profiles[0].apnsDeviceToken = 'registered';
    profiles[0].updatedAt = '2026-09-01T00:00:00.000Z';
    await expect(updateToken(ctx, { apnsDeviceToken: 'registered' })).resolves.toEqual({ success: true });
    expect(patch).not.toHaveBeenCalled();
    expect(profiles[0].updatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('persists first registration and token rotation only for the authenticated profile', async () => {
    const { ctx, profiles, patch } = setup();
    await updateToken(ctx, { apnsDeviceToken: 'first' });
    await updateToken(ctx, { apnsDeviceToken: 'rotated' });
    await updateToken(ctx, { apnsDeviceToken: 'rotated' });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(profiles[0].apnsDeviceToken).toBe('rotated');
    expect(profiles[1].apnsDeviceToken).toBeUndefined();
  });

  it.each([null, 'missing-user'])(
    'requires authentication and a profile even for a repeated token: %s',
    async (subject) => {
      const { ctx, profiles, patch } = setup(subject);
      profiles[0].apnsDeviceToken = 'registered';
      await expect(updateToken(ctx, { apnsDeviceToken: 'registered' })).rejects.toThrow();
      expect(patch).not.toHaveBeenCalled();
    }
  );

  it('rejects deleted profiles before accepting an unchanged token', async () => {
    const { ctx, profiles, patch } = setup('user-1', true);
    profiles[0].apnsDeviceToken = 'registered';
    await expect(updateToken(ctx, { apnsDeviceToken: 'registered' })).rejects.toThrow('User profile not found');
    expect(patch).not.toHaveBeenCalled();
  });
});
