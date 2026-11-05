import { Migrations } from '@convex-dev/migrations';

import { components } from '../_generated/api';
import type { DataModel, Doc } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';

const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
  migrationsLocationPrefix: 'migrations/cleanupPlaidPendingReconciliationFields:',
});

type LegacyPlaidPendingReconciliationFields = Pick<
  Doc<'transactionImportRaw'>,
  | 'authorizedDatetime'
  | 'isoCurrencyCode'
  | 'originalDescription'
  | 'paymentChannel'
  | 'paymentReferenceNumber'
  | 'pendingReconciliationFingerprint'
  | 'reconciledAt'
  | 'reconciliationMethod'
  | 'storeNumber'
  | 'unofficialCurrencyCode'
>;

export function hasLegacyPlaidPendingReconciliationFields(rawImport: LegacyPlaidPendingReconciliationFields): boolean {
  return (
    rawImport.authorizedDatetime !== undefined ||
    rawImport.isoCurrencyCode !== undefined ||
    rawImport.originalDescription !== undefined ||
    rawImport.paymentChannel !== undefined ||
    rawImport.paymentReferenceNumber !== undefined ||
    rawImport.pendingReconciliationFingerprint !== undefined ||
    rawImport.reconciledAt !== undefined ||
    rawImport.reconciliationMethod !== undefined ||
    rawImport.storeNumber !== undefined ||
    rawImport.unofficialCurrencyCode !== undefined
  );
}

/**
 * Round one of removing the temporary Plaid pending-reconciliation fields.
 *
 * Deploy this migration while the fields remain optional in the schema, run it
 * to completion, and verify its component status before removing the validators
 * in a later deployment.
 *
 * Dry run:
 * npx convex run migrations/cleanupPlaidPendingReconciliationFields:unsetLegacyFields \
 *   '{"dryRun":true}' --prod
 *
 * Apply:
 * npx convex run migrations/cleanupPlaidPendingReconciliationFields:unsetLegacyFields --prod
 */
export const unsetLegacyFields = migrations.define({
  table: 'transactionImportRaw',
  batchSize: 100,
  migrateOne: async (ctx, rawImport) => {
    if (!hasLegacyPlaidPendingReconciliationFields(rawImport)) {
      return;
    }

    await ctx.db.patch(rawImport._id, {
      authorizedDatetime: undefined,
      isoCurrencyCode: undefined,
      originalDescription: undefined,
      paymentChannel: undefined,
      paymentReferenceNumber: undefined,
      pendingReconciliationFingerprint: undefined,
      reconciledAt: undefined,
      reconciliationMethod: undefined,
      storeNumber: undefined,
      unofficialCurrencyCode: undefined,
    });
  },
});
