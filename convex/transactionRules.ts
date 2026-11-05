// Re-export all types
export { actionsValidator, conditionsValidator } from './transactionRules/types';
export type { Transaction, TransactionRule } from './transactionRules/types';

// Re-export all queries
export { countMatchingTransactions, listRules } from './transactionRules/queries';

// Re-export all mutations
export { createRule } from './transactionRules/create';
export { deleteRule } from './transactionRules/delete';
export { applyRuleToExisting, updateRule } from './transactionRules/update';

// Re-export helpers that might be used elsewhere
export {
  applyRulesToTransaction,
  applyRulesToTransactionData,
  evaluateAmountCondition,
  evaluateBankAccountCondition,
  evaluateRule,
  evaluateRuleWithCache,
  evaluateStringCondition,
  getMerchantName,
} from './transactionRules/helpers';
