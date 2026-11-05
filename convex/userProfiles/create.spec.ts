import { describe, expect, it } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import { buildProfileBootstrapUpdates } from './create';

function profile(overrides: Partial<Doc<'userProfile'>> = {}): Doc<'userProfile'> {
  return {
    _id: 'profile_1' as Id<'userProfile'>,
    _creationTime: 1,
    clerkId: 'user_1',
    email: 'old@example.com',
    name: 'Preferred',
    onboardingCompleted: true,
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildProfileBootstrapUpdates', () => {
  it('updates current identity data without overwriting a chosen profile name', () => {
    expect(
      buildProfileBootstrapUpdates(
        profile(),
        { email: 'NEW@example.com', givenName: 'Clerk' },
        '2026-08-03T12:00:00.000Z'
      )
    ).toEqual({
      email: 'new@example.com',
      updatedAt: '2026-08-03T12:00:00.000Z',
    });
  });

  it('reactivates a retained profile into a fresh onboarding state', () => {
    expect(
      buildProfileBootstrapUpdates(
        profile({
          isDeleted: true,
          deletedAt: '2026-08-02T12:00:00.000Z',
          clerkMarkedDeletedAt: '2026-08-02T12:00:01.000Z',
          clerkSessionsRevokedAt: '2026-08-02T12:00:02.000Z',
          loopsUnsubscribedAt: '2026-08-02T12:00:03.000Z',
          externalCleanupCompletedAt: '2026-08-02T12:00:04.000Z',
          activeWorkspaceId: 'workspace_1' as Id<'workspace'>,
          checkIn: {
            days: 50,
            lastDate: '2026-08-02',
            timezone: 'UTC',
            startedAt: '2026-05-01T12:00:00.000Z',
          },
        }),
        { email: 'new@example.com', givenName: 'Clerk' },
        '2026-08-03T12:00:00.000Z'
      )
    ).toEqual({
      activeWorkspaceId: undefined,
      apnsDeviceToken: undefined,
      notificationsEnabled: false,
      notificationPreferences: undefined,
      checkIn: undefined,
      onboardingCompleted: false,
      isDeleted: false,
      deletedAt: undefined,
      clerkMarkedDeletedAt: undefined,
      clerkSessionsRevokedAt: undefined,
      loopsUnsubscribedAt: undefined,
      externalCleanupLastAttemptAt: undefined,
      externalCleanupCompletedAt: undefined,
      externalCleanupError: undefined,
      purgeStartedAt: undefined,
      purgeCompletedAt: undefined,
      lastReactivatedAt: '2026-08-03T12:00:00.000Z',
      email: 'new@example.com',
      updatedAt: '2026-08-03T12:00:00.000Z',
    });
  });

  it('waits for external cleanup before allowing reactivation', () => {
    expect(() =>
      buildProfileBootstrapUpdates(
        profile({
          isDeleted: true,
          deletedAt: '2026-08-02T12:00:00.000Z',
        }),
        { email: 'new@example.com', givenName: 'Clerk' },
        '2026-08-03T12:00:00.000Z'
      )
    ).toThrow('Your account deletion is still finishing');
  });

  it('waits for an in-progress permanent purge before allowing reactivation', () => {
    expect(() =>
      buildProfileBootstrapUpdates(
        profile({
          isDeleted: true,
          deletedAt: '2026-07-01T12:00:00.000Z',
          externalCleanupCompletedAt: '2026-07-01T12:00:05.000Z',
          purgeStartedAt: '2026-08-03T00:00:00.000Z',
        }),
        { email: 'new@example.com', givenName: 'Clerk' },
        '2026-08-03T12:00:00.000Z'
      )
    ).toThrow('Your previous account cleanup is still finishing');
  });
});
