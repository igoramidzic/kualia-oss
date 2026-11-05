import { describe, expect, it } from 'vitest';

import { slugifyTitle } from './userjotClient';

/**
 * Cases pulled from real UserJot posts on `feedback.kualia.com/sitemap.xml`.
 * Locking these in so the slugifier stays aligned with UserJot's own URL
 * generation — drift here produces broken links the model can't recover from.
 */
describe('slugifyTitle', () => {
  it.each([
    ['View transactions by category', 'view-transactions-by-category'],
    ['Double Reporting?', 'double-reporting'],
    ['MCP support is great', 'mcp-support-is-great'],
    ['Add an electron app for windows/mac/linux', 'add-an-electron-app-for-windows-mac-linux'],
    ['Café au lait — 50% off!', 'cafe-au-lait-50-off'],
  ])('matches UserJot slug for short title %j', (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });

  it.each([
    [
      'Automatically create recurring transactions from past spending patterns',
      'automatically-create-recurring-transactions-from-past',
    ],
    [
      "Would be great if there was a “remember me” option so I don't have to log out and back in to re-authenticate.",
      'would-be-great-if-there-was-a-remember-me-option-so-i-don-t',
    ],
    [
      'Can you add a rule option to ignore or delete imported pending transactions from certain retailers?',
      'can-you-add-a-rule-option-to-ignore-or-delete-imported',
    ],
    [
      'Export Transaction History Button on Category Activity Sheet and Report Tab',
      'export-transaction-history-button-on-category-activity',
    ],
    [
      'Ability to see all transactions in an envelope, not just the current month',
      'ability-to-see-all-transactions-in-an-envelope-not-just-the',
    ],
    [
      'Being able to add transaction from inside specific account view',
      'being-able-to-add-transaction-from-inside-specific-account',
    ],
  ])('truncates long title %j at the last word boundary under 60 chars', (title, expected) => {
    const slug = slugifyTitle(title);
    expect(slug).toBe(expected);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('falls back to a hard 60-char cut when the title has no hyphen-able break before the cap', () => {
    const slug = slugifyTitle('a'.repeat(80));
    expect(slug).toBe('a'.repeat(60));
  });
});
