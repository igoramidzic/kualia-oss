import type { Doc } from '../_generated/dataModel';

/**
 * Transfer Detection Algorithm
 *
 * Analyzes a raw transaction to determine if it's likely a transfer between accounts.
 * Uses weighted signals from Plaid data to calculate confidence scores.
 */

export type TransferDetectionKind = 'account_transfer' | 'credit_card_payment' | 'loan_payment' | 'unknown';

export interface DetectionResult {
  isTransferCandidate: boolean;
  isLikelyTransfer: boolean;
  isStrongCreditCardPayment: boolean;
  requiresCounterpart: boolean;
  transferKind: TransferDetectionKind;
  transferConfidence: number; // 0-100
  detectionReason: string;
  matchedSignals: string[];
}

export interface DetectionInput {
  plaidCategory: string[];
  plaidTransactionCode?: string;
  plaidPersonalFinanceCategory?: {
    primary: string;
    detailed: string;
    confidence?: string;
  };
  originalStatement?: string;
  merchantName?: string;
  amount: bigint;
}

// Provider fields describe the same underlying classification and must not be
// treated as independent votes. Prefer PFC when present, then fall back to the
// transaction code, then the deprecated category hierarchy.
const SIGNAL_WEIGHTS = {
  PFC_TRANSFER: 50,
  PFC_CREDIT_CARD_PAYMENT: 70,
  PFC_LOAN_PAYMENT: 40,
  TRANSACTION_CODE_TRANSFER: 45,
  PLAID_CATEGORY_TRANSFER: 40,
  PLAID_CATEGORY_PAYMENT_CC: 60,
  STATEMENT_PAYMENT: 10,
  STATEMENT_TRANSFER: 15,
  STATEMENT_ACH: 5,
  DIRECTION_MISMATCH: 25,
  INCOME_DESCRIPTION: 60,
} as const;

const PFC_CONFIDENCE_MULTIPLIERS = {
  VERY_HIGH: 1,
  HIGH: 0.9,
  MEDIUM: 0.5,
  LOW: 0.2,
  UNKNOWN: 0.4,
} as const;

// A candidate can participate in exact opposite-side matching without being
// strong enough to interrupt the normal transaction flow by itself.
export const TRANSFER_CANDIDATE_THRESHOLD = 10;
export const TRANSFER_CONFIDENCE_THRESHOLD = 60;

function pfcWeight(weight: number, confidence: string | undefined): number {
  const normalizedConfidence = confidence?.toUpperCase();
  let multiplier: number;
  switch (normalizedConfidence) {
    case 'VERY_HIGH':
      multiplier = PFC_CONFIDENCE_MULTIPLIERS.VERY_HIGH;
      break;
    case 'HIGH':
      multiplier = PFC_CONFIDENCE_MULTIPLIERS.HIGH;
      break;
    case 'MEDIUM':
      multiplier = PFC_CONFIDENCE_MULTIPLIERS.MEDIUM;
      break;
    case 'LOW':
      multiplier = PFC_CONFIDENCE_MULTIPLIERS.LOW;
      break;
    case undefined:
      multiplier = 0.65;
      break;
    default:
      multiplier = PFC_CONFIDENCE_MULTIPLIERS.UNKNOWN;
  }
  return Math.round(weight * multiplier);
}

function includesIncomeDescription(text: string): boolean {
  return (
    text.includes('PAYROLL') ||
    text.includes('PAYCHECK') ||
    text.includes('SALARY') ||
    text.includes('DIRECT DEP') ||
    text.includes('DIRECT DEPOSIT')
  );
}

function includesPaymentAppDescription(text: string): boolean {
  return (
    text.includes('VENMO') ||
    text.includes('CASH APP') ||
    text.includes('CASHAPP') ||
    text.includes('SQUARE CASH') ||
    text.includes('ZELLE') ||
    text.includes('PAYPAL')
  );
}

function pfcDirectionMismatches(primary: string, detailed: string, amount: bigint): boolean {
  const isTransferIn = primary === 'TRANSFER_IN' || detailed.startsWith('TRANSFER_IN_');
  const isTransferOut = primary === 'TRANSFER_OUT' || detailed.startsWith('TRANSFER_OUT_');
  return (isTransferIn && amount < 0n) || (isTransferOut && amount > 0n);
}

/**
 * Detects if a raw transaction is likely a transfer between accounts.
 *
 * @param input - Transaction data from Plaid
 * @returns Detection result with confidence score and matched signals
 */
export function detectTransfer(input: DetectionInput): DetectionResult {
  let totalWeight = 0;
  const matchedSignals: string[] = [];
  let transferKind: TransferDetectionKind = 'unknown';

  // Provider classification. These fields are correlated, so only one source
  // contributes weight. Plaid recommends PFC over the legacy category array.
  if (input.plaidPersonalFinanceCategory) {
    const primary = input.plaidPersonalFinanceCategory.primary.toUpperCase();
    const detailed = input.plaidPersonalFinanceCategory.detailed.toUpperCase();
    const confidence = input.plaidPersonalFinanceCategory.confidence?.toUpperCase();

    if (primary.startsWith('TRANSFER_') || primary === 'TRANSFER') {
      transferKind = 'account_transfer';
      totalWeight += pfcWeight(SIGNAL_WEIGHTS.PFC_TRANSFER, confidence);
      matchedSignals.push(`PFC: ${detailed || primary}${confidence ? ` (${confidence})` : ''}`);

      if (pfcDirectionMismatches(primary, detailed, input.amount)) {
        totalWeight -= SIGNAL_WEIGHTS.DIRECTION_MISMATCH;
        matchedSignals.push('PFC direction conflicts with amount');
      }
    } else if (primary === 'CREDIT_CARD_PAYMENT' || detailed.includes('CREDIT_CARD_PAYMENT')) {
      transferKind = 'credit_card_payment';
      totalWeight += pfcWeight(SIGNAL_WEIGHTS.PFC_CREDIT_CARD_PAYMENT, confidence);
      matchedSignals.push(`PFC: Credit Card Payment${confidence ? ` (${confidence})` : ''}`);
    } else if (primary === 'LOAN_PAYMENTS' || detailed.includes('LOAN_PAYMENT')) {
      transferKind = 'loan_payment';
      totalWeight += pfcWeight(SIGNAL_WEIGHTS.PFC_LOAN_PAYMENT, confidence);
      matchedSignals.push(`PFC: Loan Payment${confidence ? ` (${confidence})` : ''}`);
    }
  } else if (input.plaidTransactionCode?.toLowerCase() === 'transfer') {
    transferKind = 'account_transfer';
    totalWeight += SIGNAL_WEIGHTS.TRANSACTION_CODE_TRANSFER;
    matchedSignals.push('Transaction Code: transfer');
  } else if (input.plaidCategory.length > 0) {
    const categoryLower = input.plaidCategory.map((c) => c.toLowerCase());
    const categoryString = categoryLower.join(' ');

    if (categoryString.includes('payment') && categoryString.includes('credit card')) {
      transferKind = 'credit_card_payment';
      totalWeight += SIGNAL_WEIGHTS.PLAID_CATEGORY_PAYMENT_CC;
      matchedSignals.push('Plaid Category: Credit Card Payment');
    } else if (categoryLower.some((c) => c.includes('transfer'))) {
      transferKind = 'account_transfer';
      totalWeight += SIGNAL_WEIGHTS.PLAID_CATEGORY_TRANSFER;
      matchedSignals.push('Plaid Category: Transfer');
    }
  }

  // Statement text provides secondary context. Payment-app names are
  // intentionally neutral: Venmo/Cash App/Zelle/PayPal transactions are often
  // purchases or reimbursements that still need a category.
  const statementUpper = input.originalStatement?.toUpperCase() ?? '';
  const merchantUpper = input.merchantName?.toUpperCase() ?? '';
  const textToAnalyze = `${statementUpper} ${merchantUpper}`;

  if (textToAnalyze.includes('TRANSFER')) {
    totalWeight += SIGNAL_WEIGHTS.STATEMENT_TRANSFER;
    matchedSignals.push('Statement: TRANSFER');
  }

  if (textToAnalyze.includes('PAYMENT')) {
    // Only count if it looks like an account payment, not a merchant payment
    if (
      textToAnalyze.includes('AUTOPAY') ||
      textToAnalyze.includes('BILL PAY') ||
      textToAnalyze.includes('ONLINE PAYMENT') ||
      textToAnalyze.includes('ACH PAYMENT')
    ) {
      totalWeight += SIGNAL_WEIGHTS.STATEMENT_PAYMENT;
      matchedSignals.push('Statement: Payment');
    }
  }

  if (textToAnalyze.includes('ACH')) {
    // ACH alone is a weak signal - many ACH transactions are not transfers
    if (textToAnalyze.includes('ACH CREDIT') || textToAnalyze.includes('ACH DEBIT')) {
      totalWeight += SIGNAL_WEIGHTS.STATEMENT_ACH;
      matchedSignals.push('Statement: ACH');
    }
  }

  const hasIncomeDescription = includesIncomeDescription(textToAnalyze);
  const requiresCounterpart = includesPaymentAppDescription(textToAnalyze);
  if (hasIncomeDescription) {
    totalWeight -= SIGNAL_WEIGHTS.INCOME_DESCRIPTION;
    matchedSignals.push('Statement: income/payroll');
  }

  const transferConfidence = Math.max(0, Math.min(100, totalWeight));
  const isTransferCandidate =
    input.amount !== 0n &&
    !hasIncomeDescription &&
    (requiresCounterpart || transferConfidence >= TRANSFER_CANDIDATE_THRESHOLD);
  const isLikelyTransfer = isTransferCandidate && transferConfidence >= TRANSFER_CONFIDENCE_THRESHOLD;
  const isStrongCreditCardPayment = transferKind === 'credit_card_payment' && isLikelyTransfer;

  // Build human-readable detection reason
  let detectionReason: string;
  if (matchedSignals.length === 0) {
    detectionReason = 'No transfer signals detected';
  } else if (matchedSignals.length === 1) {
    detectionReason = matchedSignals[0];
  } else {
    detectionReason = `Multiple signals: ${matchedSignals.join(', ')}`;
  }

  return {
    isTransferCandidate,
    isLikelyTransfer,
    isStrongCreditCardPayment,
    requiresCounterpart,
    transferKind,
    transferConfidence,
    detectionReason,
    matchedSignals,
  };
}

/**
 * Detects transfer for a transactionImportRaw document
 */
export function detectTransferFromRaw(rawTxn: Doc<'transactionImportRaw'>): DetectionResult {
  return detectTransfer({
    plaidCategory: rawTxn.plaidCategory,
    plaidTransactionCode: rawTxn.plaidTransactionCode,
    plaidPersonalFinanceCategory: rawTxn.plaidPersonalFinanceCategory,
    originalStatement: rawTxn.originalStatement,
    merchantName: rawTxn.merchantName,
    amount: rawTxn.amount,
  });
}
