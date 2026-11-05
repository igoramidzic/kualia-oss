import { describe, expect, it } from 'vitest';

import {
  buildLoopsDeleteContactBody,
  buildLoopsUpdateContactBody,
  getLoopsApiMessage,
  parseLoopsApiResponse,
} from './loops';

describe('Loops API response helpers', () => {
  it('parses JSON response bodies', () => {
    expect(parseLoopsApiResponse('{"success":false,"message":"No sending domain configured."}')).toEqual({
      success: false,
      message: 'No sending domain configured.',
    });
  });

  it('falls back to raw text for non-JSON response bodies', () => {
    expect(parseLoopsApiResponse('Gateway timeout')).toEqual({ message: 'Gateway timeout' });
  });

  it('extracts message fields with a fallback', () => {
    expect(getLoopsApiMessage({ message: 'Invalid transactional ID' }, 'Fallback')).toBe('Invalid transactional ID');
    expect(getLoopsApiMessage({ success: false }, 'Fallback')).toBe('Fallback');
  });
});

describe('Loops contact payload helpers', () => {
  it('includes first and last name when updating contacts', () => {
    expect(
      buildLoopsUpdateContactBody({
        email: 'igor@example.com',
        firstName: 'Igor',
        lastName: 'Amidzic',
        userId: 'user_123',
        source: 'Kualia App',
      })
    ).toEqual({
      email: 'igor@example.com',
      firstName: 'Igor',
      lastName: 'Amidzic',
      userId: 'user_123',
      source: 'Kualia App',
    });
  });

  it('deletes contacts by their stable Clerk user ID', () => {
    expect(buildLoopsDeleteContactBody('user_123')).toEqual({ userId: 'user_123' });
  });

  it('keeps deleted-account contacts while unsubscribing them from workflows', () => {
    expect(
      buildLoopsUpdateContactBody({
        email: 'igor@example.com',
        userId: 'user_123',
        subscribed: false,
      })
    ).toEqual({
      email: 'igor@example.com',
      userId: 'user_123',
      subscribed: false,
    });
  });
});
