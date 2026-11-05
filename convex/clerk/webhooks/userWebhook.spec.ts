import { describe, expect, it } from 'vitest';

import { extractClerkUserWebhookData } from './userWebhook';

describe('extractClerkUserWebhookData', () => {
  it('extracts split names and primary email from Clerk user payloads', () => {
    const result = extractClerkUserWebhookData({
      type: 'user.created',
      data: {
        id: 'user_123',
        primary_email_address_id: 'email_primary',
        email_addresses: [
          {
            id: 'email_secondary',
            email_address: 'secondary@example.com',
          },
          {
            id: 'email_primary',
            email_address: 'primary@example.com',
          },
        ],
        first_name: ' Igor ',
        last_name: ' Amidzic ',
      },
    });

    expect(result).toEqual({
      clerkId: 'user_123',
      email: 'primary@example.com',
      firstName: 'Igor',
      lastName: 'Amidzic',
    });
  });

  it('omits blank or null name fields', () => {
    const result = extractClerkUserWebhookData({
      type: 'user.created',
      data: {
        id: 'user_123',
        email_addresses: [
          {
            id: 'email_primary',
            email_address: 'primary@example.com',
          },
        ],
        first_name: '',
        last_name: null,
      },
    });

    expect(result).toEqual({
      clerkId: 'user_123',
      email: 'primary@example.com',
      firstName: undefined,
      lastName: undefined,
    });
  });
});
