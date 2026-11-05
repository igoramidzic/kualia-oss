import type { Auth, UserIdentity } from 'convex/server';
import { describe, expect, it } from 'vitest';
import { getIdentity } from './identity';

function context(subject: string | null): { auth: Auth } {
  return {
    auth: {
      getUserIdentity: async () =>
        subject === null
          ? null
          : ({
              subject,
              issuer: 'http://127.0.0.1:3211',
              tokenIdentifier: `local|${subject}`,
              email: 'test@example.test',
            } satisfies UserIdentity),
    },
  };
}
describe('local auth identity', () => {
  it('keeps ownership stable across sign-in sessions', async () => {
    expect((await getIdentity(context('user1|session1')))?.subject).toBe('user1');
    expect((await getIdentity(context('user1|session2')))?.subject).toBe('user1');
    expect((await getIdentity(context('user2|session1')))?.subject).toBe('user2');
  });
  it('preserves identity claims and anonymous denial', async () => {
    expect(await getIdentity(context(null))).toBeNull();
    expect((await getIdentity(context('user1')))?.email).toBe('test@example.test');
  });
});
