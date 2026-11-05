import { describe, expect, it } from 'vitest';
import type { Id } from '../_generated/dataModel';
import {
  EnvelopeMonthStatusFilterError,
  filterEnvelopeMonthStatus,
  parseEnvelopeMonthStatusFilterInput,
  type EnvelopeMonthStatusFilter,
  type EnvelopeMonthStatusFilterErrorCode,
  type EnvelopeMonthStatusPayload,
} from './budgetTools';

const WORKSPACE_ID = 'workspace_1' as Id<'workspace'>;

function categoryId(value: string): Id<'category'> {
  return value as Id<'category'>;
}

function groupId(value: string): Id<'categoryGroup'> {
  return value as Id<'categoryGroup'>;
}

function makeTarget() {
  return {
    assignmentNeeded: 0n,
    remainingToAssign: 0n,
    overfundedByAmount: 0n,
    underfundedAmount: 0n,
    fundedRatio: 1,
  };
}

function makePayload(): EnvelopeMonthStatusPayload {
  return {
    workspaceId: WORKSPACE_ID,
    yearMonth: 202604,
    yearMonthString: 'April 2026',
    currency: 'USD',
    currencyCode: 'USD',
    minorUnit: 2,
    amountEncoding: 'decimal_string',
    readyToAssign: 10000n,
    summary: {
      percentageFunded: 100,
      totalTargetAmount: 0n,
      totalFunded: 0n,
      totalRemainingToFund: 0n,
      totalOverspent: 0n,
      extraFunding: 0n,
      coverOverspending: 0n,
    },
    groups: [
      {
        groupId: groupId('group_food'),
        name: 'Food',
        type: 'expense',
        sortOrder: 1,
        isSystemGroup: false,
        categories: [
          {
            categoryId: categoryId('category_groceries'),
            name: 'Groceries',
            sortOrder: 1,
            isSystemCategory: false,
            isArchived: false,
            categoryType: 'custom',
            assignedAmount: 50000n,
            totalSpent: 12000n,
            carryoverFromPrevious: 0n,
            available: 38000n,
            activity: -12000n,
            inflowAmount: 0n,
            outflowAmount: 12000n,
            target: makeTarget(),
          },
          {
            categoryId: categoryId('category_restaurants'),
            name: 'Restaurants',
            sortOrder: 2,
            isSystemCategory: false,
            isArchived: false,
            categoryType: 'custom',
            assignedAmount: 30000n,
            totalSpent: 10000n,
            carryoverFromPrevious: 0n,
            available: 20000n,
            activity: -10000n,
            inflowAmount: 0n,
            outflowAmount: 10000n,
            target: makeTarget(),
          },
        ],
      },
      {
        groupId: groupId('group_bills'),
        name: 'Bills',
        type: 'expense',
        sortOrder: 2,
        isSystemGroup: false,
        categories: [
          {
            categoryId: categoryId('category_rent'),
            name: 'Rent',
            sortOrder: 1,
            isSystemCategory: false,
            isArchived: false,
            categoryType: 'custom',
            assignedAmount: 200000n,
            totalSpent: 200000n,
            carryoverFromPrevious: 0n,
            available: 0n,
            activity: -200000n,
            inflowAmount: 0n,
            outflowAmount: 200000n,
            target: makeTarget(),
          },
        ],
      },
    ],
  };
}

function expectFilterError(filter: EnvelopeMonthStatusFilter, code: EnvelopeMonthStatusFilterErrorCode): void {
  try {
    filterEnvelopeMonthStatus(makePayload(), filter);
    throw new Error('Expected filterEnvelopeMonthStatus to throw');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EnvelopeMonthStatusFilterError);
    if (error instanceof EnvelopeMonthStatusFilterError) {
      expect(error.code).toBe(code);
    }
  }
}

describe('filterEnvelopeMonthStatus', () => {
  it('parses no filter and rejects multiple filters', () => {
    expect(parseEnvelopeMonthStatusFilterInput({})).toBeUndefined();
    expect(parseEnvelopeMonthStatusFilterInput({ categoryName: 'Groceries' })).toEqual({
      kind: 'categoryName',
      value: 'Groceries',
    });

    try {
      parseEnvelopeMonthStatusFilterInput({ categoryName: 'Groceries', groupName: 'Food' });
      throw new Error('Expected multiple selectors to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvelopeMonthStatusFilterError);
      if (error instanceof EnvelopeMonthStatusFilterError) {
        expect(error.code).toBe('INVALID_ARGUMENT');
      }
    }
  });

  it('returns the full payload when no filter is provided', () => {
    const payload = makePayload();

    expect(filterEnvelopeMonthStatus(payload, undefined)).toBe(payload);
  });

  it('filters to one category by categoryId', () => {
    const result = filterEnvelopeMonthStatus(makePayload(), {
      kind: 'categoryId',
      value: categoryId('category_restaurants'),
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('Food');
    expect(result.groups[0].categories.map((category) => category.name)).toEqual(['Restaurants']);
    expect(result.readyToAssign).toBe(10000n);
    expect(result.summary).toEqual(makePayload().summary);
  });

  it('filters to one category by trimmed case-insensitive categoryName', () => {
    const result = filterEnvelopeMonthStatus(makePayload(), {
      kind: 'categoryName',
      value: '  groceries  ',
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].categories).toHaveLength(1);
    expect(result.groups[0].categories[0].categoryId).toBe(categoryId('category_groceries'));
  });

  it('filters to one full group by groupId', () => {
    const result = filterEnvelopeMonthStatus(makePayload(), {
      kind: 'groupId',
      value: groupId('group_food'),
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('Food');
    expect(result.groups[0].categories.map((category) => category.name)).toEqual(['Groceries', 'Restaurants']);
  });

  it('filters to one full group by trimmed case-insensitive groupName', () => {
    const result = filterEnvelopeMonthStatus(makePayload(), {
      kind: 'groupName',
      value: ' bills ',
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupId).toBe(groupId('group_bills'));
    expect(result.groups[0].categories.map((category) => category.name)).toEqual(['Rent']);
  });

  it('reports not found for missing categories and groups', () => {
    expectFilterError({ kind: 'categoryName', value: 'Travel' }, 'NOT_FOUND');
    expectFilterError({ kind: 'groupName', value: 'Savings' }, 'NOT_FOUND');
  });

  it('reports duplicate category names as invalid arguments', () => {
    const payload = makePayload();
    payload.groups[1].categories[0].name = 'Groceries';

    try {
      filterEnvelopeMonthStatus(payload, { kind: 'categoryName', value: 'groceries' });
      throw new Error('Expected duplicate category names to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvelopeMonthStatusFilterError);
      if (error instanceof EnvelopeMonthStatusFilterError) {
        expect(error.code).toBe('INVALID_ARGUMENT');
        expect(error.message).toContain('category_groceries');
        expect(error.message).toContain('category_rent');
      }
    }
  });

  it('reports duplicate group names as invalid arguments', () => {
    const payload = makePayload();
    payload.groups[1].name = 'Food';

    try {
      filterEnvelopeMonthStatus(payload, { kind: 'groupName', value: 'food' });
      throw new Error('Expected duplicate group names to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvelopeMonthStatusFilterError);
      if (error instanceof EnvelopeMonthStatusFilterError) {
        expect(error.code).toBe('INVALID_ARGUMENT');
        expect(error.message).toContain('group_food');
        expect(error.message).toContain('group_bills');
      }
    }
  });
});
