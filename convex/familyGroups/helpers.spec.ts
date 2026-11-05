import { describe, expect, it } from 'vitest';

import { DISCORD_NOTIFICATIONS_CHANNEL } from '../lib/discord';
import {
  FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
  FAMILY_GROUP_INVITE_EMAIL_QUOTA_WINDOW_DAYS,
  FAMILY_GROUP_MAX_ADDITIONAL_MEMBERS,
  buildFamilyGroupInviteUrl,
  buildFamilyInviteAcceptedDiscordNotification,
  buildFamilyInviteSentDiscordNotification,
  getFamilyGroupInviteEmailQuotaState,
  getFamilyGroupInviteEmailQuotaWindowEndsAt,
  getFamilyGroupInviteExpiresAt,
  isWithinFamilyGroupMemberLimit,
  normalizeFamilyGroupName,
  normalizeInviteEmail,
  normalizeInviteName,
} from './helpers';

describe('family group helpers', () => {
  it('normalizes family group names', () => {
    expect(normalizeFamilyGroupName('  The   Amidzics  ', 'Igor')).toBe('The Amidzics');
    expect(normalizeFamilyGroupName(undefined, '  Igor   Amidzic  ')).toBe("Igor Amidzic's Family");
    expect(normalizeFamilyGroupName(undefined, 'James')).toBe("James's Family");
    expect(normalizeFamilyGroupName('   ', undefined)).toBe('Kualia Family');
  });

  it('normalizes valid invite emails', () => {
    expect(normalizeInviteEmail('  CASEY@Example.COM  ')).toBe('casey@example.com');
  });

  it('rejects invalid invite emails', () => {
    expect(normalizeInviteEmail('not-an-email')).toBeNull();
    expect(normalizeInviteEmail('missing@example')).toBeNull();
  });

  it('normalizes invite names', () => {
    expect(normalizeInviteName('  Casey   Jones  ')).toBe('Casey Jones');
    expect(normalizeInviteName('   ')).toBeNull();
  });

  it('enforces the YNAB-style five additional member limit', () => {
    expect(isWithinFamilyGroupMemberLimit(FAMILY_GROUP_MAX_ADDITIONAL_MEMBERS)).toBe(true);
    expect(isWithinFamilyGroupMemberLimit(FAMILY_GROUP_MAX_ADDITIONAL_MEMBERS + 1)).toBe(false);
  });

  it('sets invite expiration 14 days out', () => {
    expect(getFamilyGroupInviteExpiresAt(new Date('2026-06-10T12:00:00.000Z'))).toBe('2026-06-24T12:00:00.000Z');
  });

  it('sets invite email quota windows 30 days out', () => {
    expect(getFamilyGroupInviteEmailQuotaWindowEndsAt(new Date('2026-06-10T12:00:00.000Z'))).toBe(
      '2026-07-10T12:00:00.000Z'
    );
    expect(FAMILY_GROUP_INVITE_EMAIL_QUOTA_WINDOW_DAYS).toBe(30);
  });

  it('computes invite email quota state', () => {
    expect(getFamilyGroupInviteEmailQuotaState({}, new Date('2026-06-10T12:00:00.000Z'))).toMatchObject({
      limit: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      used: 0,
      remaining: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      windowStartedAt: null,
      windowEndsAt: null,
      isExhausted: false,
    });

    expect(
      getFamilyGroupInviteEmailQuotaState(
        {
          familyInviteEmailQuotaWindowStartedAt: '2026-06-01T12:00:00.000Z',
          familyInviteEmailSendsInWindow: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
        },
        new Date('2026-06-10T12:00:00.000Z')
      )
    ).toMatchObject({
      used: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      remaining: 0,
      windowEndsAt: '2026-07-01T12:00:00.000Z',
      isExhausted: true,
    });

    expect(
      getFamilyGroupInviteEmailQuotaState(
        {
          familyInviteEmailQuotaWindowStartedAt: '2026-05-01T12:00:00.000Z',
          familyInviteEmailSendsInWindow: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
        },
        new Date('2026-06-10T12:00:00.000Z')
      )
    ).toMatchObject({
      used: 0,
      remaining: FAMILY_GROUP_INVITE_EMAIL_QUOTA_LIMIT,
      windowStartedAt: null,
      windowEndsAt: null,
      isExhausted: false,
    });
  });

  it('builds tokenized family group invite URLs', () => {
    expect(buildFamilyGroupInviteUrl('invite-token')).toBe('https://app.kualia.com/family/join/invite-token');
    expect(buildFamilyGroupInviteUrl('invite-token', 'https://preview.kualia.com/')).toBe(
      'https://preview.kualia.com/family/join/invite-token'
    );
    expect(buildFamilyGroupInviteUrl('invite-token', 'not a url')).toBe(
      'https://app.kualia.com/family/join/invite-token'
    );
  });

  it('builds family invite sent Discord notifications on the existing notifications channel', () => {
    expect(
      buildFamilyInviteSentDiscordNotification({
        familyGroupName: 'Amidzic Family',
        invitedByName: 'Igor',
        invitedByEmail: 'igor@example.com',
        invitedName: 'Casey',
        invitedEmail: 'casey@example.com',
      })
    ).toMatchObject({
      channel: DISCORD_NOTIFICATIONS_CHANNEL,
      title: 'Family Invite Sent',
      description: 'Igor invited Casey to Amidzic Family',
      userEmail: 'igor@example.com',
      metadata: {
        from: 'Igor <igor@example.com>',
        to: 'Casey <casey@example.com>',
        familyGroup: 'Amidzic Family',
      },
    });
  });

  it('builds family invite accepted Discord notifications on the existing notifications channel', () => {
    expect(
      buildFamilyInviteAcceptedDiscordNotification({
        familyGroupName: 'Amidzic Family',
        invitedByName: 'Igor',
        invitedByEmail: 'igor@example.com',
        acceptedByClerkId: 'clerk_casey',
        acceptedByName: 'Casey',
        acceptedByEmail: 'casey@example.com',
      })
    ).toMatchObject({
      channel: DISCORD_NOTIFICATIONS_CHANNEL,
      title: 'Family Invite Accepted',
      description: "Casey accepted Igor's family invite",
      userId: 'clerk_casey',
      userEmail: 'casey@example.com',
      metadata: {
        from: 'Igor <igor@example.com>',
        to: 'Casey <casey@example.com>',
        familyGroup: 'Amidzic Family',
      },
    });
  });
});
