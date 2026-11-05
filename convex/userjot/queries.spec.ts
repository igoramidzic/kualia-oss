import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { createUserJotIdentityToken } from './queries';

describe('createUserJotIdentityToken', () => {
  it('creates a one-hour HS256 token with the Widget v3 identity claims', async () => {
    const issuedAt = 1_800_000_000;
    const secret = 'test-userjot-secret';
    const token = await createUserJotIdentityToken(
      {
        id: 'user_123',
        email: 'user@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avatar: 'https://example.com/avatar.png',
      },
      'project_123',
      secret,
      issuedAt
    );

    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: 'project_123',
      audience: 'userjot',
      algorithms: ['HS256'],
      currentDate: new Date(issuedAt * 1000),
    });

    expect(protectedHeader).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      sub: 'user_123',
      iss: 'project_123',
      aud: 'userjot',
      iat: issuedAt,
      exp: issuedAt + 3600,
      email: 'user@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatar: 'https://example.com/avatar.png',
    });
  });
});
