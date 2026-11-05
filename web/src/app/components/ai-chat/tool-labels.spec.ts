import { describe, expect, it } from 'vitest';
import { doneLabel, runningLabel } from './tool-labels';

describe('tool-labels', () => {
  it('returns curated present-progressive labels for known tool slugs', () => {
    expect(runningLabel('kualia_list_transactions')).toBe('Fetching transactions');
    expect(runningLabel('kualia_get_envelope_month_status')).toBe('Checking envelope status');
    expect(runningLabel('kualia_list_workspaces')).toBe('Looking up workspaces');
  });

  it('returns curated past-tense labels for known tool slugs', () => {
    expect(doneLabel('kualia_list_transactions')).toBe('Fetched transactions');
    expect(doneLabel('kualia_get_account_balances_report')).toBe('Fetched account balances');
    expect(doneLabel('kualia_set_category_assigned_amount')).toBe('Updated envelope amount');
  });

  it('strips the kualia_ prefix and title-cases unknown slugs as a fallback', () => {
    expect(runningLabel('kualia_brand_new_tool')).toBe('Brand new tool');
    expect(doneLabel('kualia_brand_new_tool')).toBe('Brand new tool');
  });

  it('handles non-kualia slugs by replacing separators and capitalizing', () => {
    expect(runningLabel('search_docs')).toBe('Search docs');
    expect(doneLabel('search-docs')).toBe('Search docs');
  });

  it('returns a generic placeholder for an empty slug', () => {
    expect(runningLabel('')).toBe('Working');
    expect(doneLabel('')).toBe('Worked');
  });

  it('returns curated labels for the file-import tool slugs', () => {
    expect(runningLabel('kualia_list_bank_accounts')).toBe('Reading accounts');
    expect(doneLabel('kualia_list_bank_accounts')).toBe('Read accounts');
    expect(runningLabel('kualia_reconcile_bank_account')).toBe('Reconciling account');
    expect(doneLabel('kualia_reconcile_bank_account')).toBe('Reconciled account');
    expect(runningLabel('kualia_create_transactions')).toBe('Creating transactions');
    expect(doneLabel('kualia_create_transactions')).toBe('Created transactions');
    expect(runningLabel('kualia_delete_transactions')).toBe('Deleting transactions');
    expect(doneLabel('kualia_delete_transactions')).toBe('Deleted transactions');
    expect(runningLabel('kualia_restore_transactions')).toBe('Restoring transactions');
    expect(doneLabel('kualia_restore_transactions')).toBe('Restored transactions');
    expect(runningLabel('kualia_update_transactions')).toBe('Updating transactions');
    expect(doneLabel('kualia_update_transactions')).toBe('Updated transactions');
  });

  it('switches batch tool labels to singular when itemCount is 1', () => {
    expect(runningLabel('kualia_create_transactions', 1)).toBe('Creating transaction');
    expect(doneLabel('kualia_create_transactions', 1)).toBe('Created transaction');
    expect(runningLabel('kualia_update_transactions', 1)).toBe('Updating transaction');
    expect(doneLabel('kualia_update_transactions', 1)).toBe('Updated transaction');
    expect(runningLabel('kualia_delete_transactions', 1)).toBe('Deleting transaction');
    expect(doneLabel('kualia_delete_transactions', 1)).toBe('Deleted transaction');
    expect(runningLabel('kualia_restore_transactions', 1)).toBe('Restoring transaction');
    expect(doneLabel('kualia_restore_transactions', 1)).toBe('Restored transaction');
  });

  it('keeps batch tool labels plural when itemCount is greater than 1 or missing', () => {
    expect(runningLabel('kualia_create_transactions', 3)).toBe('Creating transactions');
    expect(doneLabel('kualia_create_transactions', 0)).toBe('Created transactions');
    expect(runningLabel('kualia_create_transactions', undefined)).toBe('Creating transactions');
  });

  it('ignores itemCount for non-batch tools', () => {
    expect(runningLabel('kualia_list_transactions', 1)).toBe('Fetching transactions');
    expect(doneLabel('kualia_set_category_assigned_amount', 1)).toBe('Updated envelope amount');
  });
});
