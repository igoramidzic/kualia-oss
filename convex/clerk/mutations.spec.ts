import { describe, expect, it } from 'vitest';

import { buildExistingClerkProfileUpdates } from './mutations';

describe('buildExistingClerkProfileUpdates', () => {
  it('does not overwrite an existing profile name with Clerk first name', () => {
    expect(
      buildExistingClerkProfileUpdates(
        {
          email: 'old@example.com',
          name: 'Preferred Name',
        },
        {
          email: 'old@example.com',
          firstName: 'Clerk',
        }
      )
    ).toEqual({});
  });

  it('updates changed emails while preserving existing profile names', () => {
    expect(
      buildExistingClerkProfileUpdates(
        {
          email: 'old@example.com',
          name: 'Preferred Name',
        },
        {
          email: 'new@example.com',
          firstName: 'Clerk',
        }
      )
    ).toEqual({ email: 'new@example.com' });
  });

  it('backfills missing profile names from Clerk first name', () => {
    expect(
      buildExistingClerkProfileUpdates(
        {
          email: 'user@example.com',
          name: '   ',
        },
        {
          email: 'user@example.com',
          firstName: '  Clerk  ',
        }
      )
    ).toEqual({ name: 'Clerk' });
  });
});
