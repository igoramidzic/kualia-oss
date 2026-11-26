import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { completeSeededOwnerOnboarding, completeSeededUserOnboarding } from './devSeed';

const workspaceId = 'workspace_1' as Id<'workspace'>;
const profileId = 'profile_1' as Id<'userProfile'>;

function fakeCtx(workspace: Record<string, unknown> | null, profile: Record<string, unknown> | null) {
  const patch = vi.fn();
  const unique = vi.fn().mockResolvedValue(profile);
  const withIndex = vi.fn((_index: string, range: (q: { eq: (f: string, v: unknown) => unknown }) => unknown) => {
    range({ eq: (field, value) => expect([field, value]).toEqual(['clerkId', 'owner-1']) });
    return { unique };
  });
  const ctx = {
    db: { get: vi.fn().mockResolvedValue(workspace), query: vi.fn(() => ({ withIndex })), patch },
  } as unknown as Pick<MutationCtx, 'db'>;
  return { ctx, patch };
}

describe('completeSeededUserOnboarding', () => {
  const originalUrl = process.env['CONVEX_CLOUD_URL'];
  beforeEach(() => {
    process.env['CONVEX_CLOUD_URL'] = 'http://127.0.0.1:3210';
  });
  afterEach(() => {
    if (originalUrl === undefined) delete process.env['CONVEX_CLOUD_URL'];
    else process.env['CONVEX_CLOUD_URL'] = originalUrl;
  });

  it('is internal-only', () => {
    expect((completeSeededUserOnboarding as unknown as { isInternal?: boolean }).isInternal).toBe(true);
  });

  it('refuses to run outside a local deployment', async () => {
    process.env['CONVEX_CLOUD_URL'] = 'https://example.convex.cloud';
    const { ctx, patch } = fakeCtx({ ownerClerkId: 'owner-1', isDeleted: false }, { _id: profileId });
    await expect(completeSeededOwnerOnboarding(ctx, workspaceId, 'demo@example.test', 'Demo')).rejects.toThrow(
      /development/
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('marks only the workspace owner as onboarded without creating a workspace', async () => {
    const { ctx, patch } = fakeCtx(
      { ownerClerkId: 'owner-1', isDeleted: false },
      { _id: profileId, email: 'demo@example.test', isDeleted: false, onboardingCompleted: false }
    );
    await completeSeededOwnerOnboarding(ctx, workspaceId, 'demo@example.test', 'Demo');
    expect(patch).toHaveBeenCalledWith(
      profileId,
      expect.objectContaining({ name: 'Demo', onboardingCompleted: true, activeWorkspaceId: workspaceId })
    );
  });

  it('refuses to modify a profile that is not the seeded owner', async () => {
    const { ctx, patch } = fakeCtx(
      { ownerClerkId: 'owner-1', isDeleted: false },
      { _id: profileId, email: 'someone-else@example.test', isDeleted: false }
    );
    await expect(completeSeededOwnerOnboarding(ctx, workspaceId, 'demo@example.test', 'Demo')).rejects.toThrow(
      /not owned by the seeded user/
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['deleted', { ownerClerkId: 'owner-1', isDeleted: true }],
    ['still importing', { ownerClerkId: 'owner-1', isDeleted: false, kualiaImportPending: true }],
  ])('rejects a %s workspace', async (_label, workspace) => {
    const { ctx, patch } = fakeCtx(workspace, { _id: profileId, isDeleted: false });
    await expect(completeSeededOwnerOnboarding(ctx, workspaceId, 'demo@example.test', 'Demo')).rejects.toThrow(
      /not found/
    );
    expect(patch).not.toHaveBeenCalled();
  });
});
