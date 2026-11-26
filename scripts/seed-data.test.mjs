import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_COLUMNS } from '../convex/dataExports/columns.ts';
import { buildDemoBudget, localIsoDate, toCsv, DEMO_EMAIL, DEMO_WORKSPACE_NAME } from './seed-data.mjs';

const TODAY = '2026-03-10';

test('demo budget is deterministic for a given date and uses only synthetic identities', () => {
  assert.deepEqual(buildDemoBudget({ today: TODAY }), buildDemoBudget({ today: TODAY }));
  assert.match(DEMO_EMAIL, /@example\.test$/);
  assert.ok(DEMO_WORKSPACE_NAME.length <= 26);
});

test('demo budget covers the requested months and never dates transactions in the future', () => {
  const { summary, transactions } = buildDemoBudget({ today: TODAY, months: 4 });
  assert.deepEqual(summary.months, ['202512', '202601', '202602', '202603']);
  assert.equal(summary.startDate, '2025-12-01');
  assert.ok(transactions.every((t) => t.date >= summary.startDate && t.date <= TODAY));
  assert.ok(transactions.some((t) => t.status === 'pending' && t.reviewStatus === 'needs_review'));
  assert.ok(transactions.filter((t) => t.date < '2026-03-08').every((t) => t.status === 'cleared'));
});

test('demo budget includes a split, paired transfers, and a card refund with consistent totals', () => {
  const { summary, transactions } = buildDemoBudget({ today: TODAY });
  const byId = new Map(transactions.map((t) => [t.id, t]));
  assert.ok(summary.splitCount >= 1);
  assert.ok(summary.transferCount >= 2);
  for (const t of transactions) {
    assert.equal(t.total, t.movements.reduce((sum, m) => sum + m.amount, 0n));
    for (const m of t.movements) assert.equal(typeof m.amount, 'bigint');
    if (t.type !== 'transfer') continue;
    const pair = byId.get(t.transfer.pair);
    assert.equal(pair.transfer.pair, t.id);
    assert.equal(pair.account, t.transfer.account);
    assert.equal(pair.total, -t.total);
    assert.ok(t.movements.every((m) => !m.categoryId && !m.readyToAssign));
  }
  const cardPayments = transactions.filter((t) => t.type === 'transfer' && t.account === 'demo-acct-card');
  assert.ok(cardPayments.length >= 1 && cardPayments.every((t) => t.total > 0n));
  assert.ok(transactions.some((t) => t.account === 'demo-acct-card' && t.type === 'regular' && t.total > 0n));
});

test('demo budget balances and Ready to Assign are derived from its transactions', () => {
  const { summary, transactions } = buildDemoBudget({ today: TODAY });
  for (const account of summary.accounts) {
    const expected = transactions.filter((t) => t.account === account.id).reduce((sum, t) => sum + t.total, 0n);
    assert.equal(account.balance, expected);
  }
  assert.ok(summary.readyToAssign >= 0n, 'the demo should not start over-assigned');
  assert.equal(summary.readyToAssign, summary.income - summary.assigned);
  // Even on the first of the month (only one paycheck so far) the budget is not over-assigned.
  assert.ok(buildDemoBudget({ today: '2026-03-01' }).summary.readyToAssign >= 0n);
});

test('demo export files use the Kualia export headers and decimal money', () => {
  const { files } = buildDemoBudget({ today: TODAY });
  assert.deepEqual(files.map((f) => f.name).sort(), Object.keys(EXPORT_COLUMNS).sort());
  for (const file of files) {
    const [header, ...rows] = file.content.replace(/^﻿/, '').trimEnd().split('\r\n');
    assert.equal(header, EXPORT_COLUMNS[file.name].join(','));
    assert.ok(rows.length > 0);
  }
  const plan = files.find((f) => f.name === 'plan.csv').content;
  assert.match(plan, /,1650\.00,/);
  assert.doesNotMatch(plan, /\d\.\d{3}/);
});

test('generator rejects invalid input and unknown CSV columns', () => {
  assert.throws(() => buildDemoBudget({ today: '2026-02-30' }), /YYYY-MM-DD/);
  assert.throws(() => buildDemoBudget({ today: TODAY, months: 0 }), /months/);
  assert.throws(() => toCsv('plan.csv', [{ nope: '1' }]), /unknown columns/);
  assert.equal(toCsv('plan.csv', [{ year_month: '202601', category_name: 'A, "B"' }]).includes('"A, ""B"""'), true);
  assert.match(localIsoDate(new Date(2026, 0, 5)), /^2026-01-05$/);
});
