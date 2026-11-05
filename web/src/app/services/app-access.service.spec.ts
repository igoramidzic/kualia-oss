import type { Id } from 'convex/_generated/dataModel';
import { describe, expect, it } from 'vitest';
import { isBlockedByFamilyOwnerSubscription, type AppAccess } from './app-access.service';

function createAccess(overrides: Partial<AppAccess> = {}): AppAccess {
  return {
    hasAppAccess: false,
    accessSource: null,
    ownSubscription: null,
    familyAccess: null,
    ...overrides,
  };
}

describe('isBlockedByFamilyOwnerSubscription', () => {
  it('matches family members blocked by an unsubscribed owner', () => {
    const access = createAccess({
      familyAccess: {
        familyGroupId: 'family_group_1' as Id<'familyGroup'>,
        role: 'member',
        ownerClerkId: 'clerk_owner',
        owner: {
          clerkId: 'clerk_owner',
          name: 'Taylor Owner',
          email: 'taylor@example.com',
        },
        ownerHasValidSubscription: false,
      },
    });

    expect(isBlockedByFamilyOwnerSubscription(access)).toBe(true);
  });

  it('does not match family owners without access', () => {
    const access = createAccess({
      familyAccess: {
        familyGroupId: 'family_group_1' as Id<'familyGroup'>,
        role: 'owner',
        ownerClerkId: 'clerk_owner',
        owner: {
          clerkId: 'clerk_owner',
          name: 'Taylor Owner',
          email: 'taylor@example.com',
        },
        ownerHasValidSubscription: false,
      },
    });

    expect(isBlockedByFamilyOwnerSubscription(access)).toBe(false);
  });
});
