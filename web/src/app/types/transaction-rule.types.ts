import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';

// Match types for string conditions
export type MatchType = 'contains' | 'exactlyMatches';

// String condition used for originalStatement and merchantName matching
export interface StringCondition {
  matchType: MatchType;
  value: string;
}

// Infer the TransactionRule type from the Convex query
// listRules returns an array, so we extract the element type
type ListRulesReturn = FunctionReturnType<typeof api.transactionRules.listRules>;
export type TransactionRule = ListRulesReturn extends (infer T)[] ? T : never;

// Conditions structure for creating/updating rules
export interface RuleConditions {
  originalStatement?: StringCondition[];
  merchantName?: StringCondition[];
}

// Actions structure for creating/updating rules
export interface RuleActions {
  setMerchantId?: string;
  setCategoryId?: string;
}
