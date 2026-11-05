import { describe, expect, it } from 'vitest';

import type { DetectionInput } from './detectTransfer';
import { detectTransfer } from './detectTransfer';

function detectionInput(overrides: Partial<DetectionInput> = {}): DetectionInput {
  return {
    plaidCategory: [],
    originalStatement: undefined,
    merchantName: undefined,
    amount: 10_000n,
    ...overrides,
  };
}

describe('detectTransfer', () => {
  it('does not stack correlated Plaid classification fields', () => {
    const result = detectTransfer(
      detectionInput({
        plaidCategory: ['Transfer', 'Debit'],
        plaidTransactionCode: 'transfer',
        plaidPersonalFinanceCategory: {
          primary: 'TRANSFER_OUT',
          detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
          confidence: 'HIGH',
        },
        amount: -10_000n,
      })
    );

    expect(result.transferConfidence).toBe(45);
    expect(result.matchedSignals).toEqual(['PFC: TRANSFER_OUT_ACCOUNT_TRANSFER (HIGH)']);
    expect(result.isTransferCandidate).toBe(true);
    expect(result.isLikelyTransfer).toBe(false);
  });

  it.each([
    ['VERY_HIGH', 50],
    ['HIGH', 45],
    ['MEDIUM', 25],
    ['LOW', 10],
  ])('weights %s provider confidence proportionally', (confidence, expectedScore) => {
    const result = detectTransfer(
      detectionInput({
        plaidPersonalFinanceCategory: {
          primary: 'TRANSFER_IN',
          detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
          confidence,
        },
      })
    );

    expect(result.transferConfidence).toBe(expectedScore);
    expect(result.isLikelyTransfer).toBe(false);
  });

  it.each(['Venmo', 'Cash App', 'CashApp', 'Square Cash', 'Zelle', 'PayPal'])(
    'treats the payment-app name %s as match-only context, not confidence',
    (merchantName) => {
      const result = detectTransfer(detectionInput({ merchantName }));

      expect(result.transferConfidence).toBe(0);
      expect(result.matchedSignals).toEqual([]);
      expect(result.requiresCounterpart).toBe(true);
      expect(result.isTransferCandidate).toBe(true);
      expect(result.isLikelyTransfer).toBe(false);
    }
  );

  it('hard-vetoes payroll income even when Plaid calls it a transfer', () => {
    const result = detectTransfer(
      detectionInput({
        plaidCategory: ['Transfer', 'Credit'],
        plaidTransactionCode: 'transfer',
        plaidPersonalFinanceCategory: {
          primary: 'TRANSFER_IN',
          detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
          confidence: 'VERY_HIGH',
        },
        originalStatement: 'ACME PAYROLL DIRECT DEP',
        merchantName: 'Acme Payroll',
        amount: 366_518n,
      })
    );

    expect(result.transferConfidence).toBe(0);
    expect(result.isTransferCandidate).toBe(false);
    expect(result.isLikelyTransfer).toBe(false);
  });

  it('keeps a very-high-confidence credit card payment actionable', () => {
    const result = detectTransfer(
      detectionInput({
        plaidPersonalFinanceCategory: {
          primary: 'CREDIT_CARD_PAYMENT',
          detailed: 'CREDIT_CARD_PAYMENT_OTHER_CARD_PAYMENT',
          confidence: 'VERY_HIGH',
        },
        originalStatement: 'AUTOPAY PAYMENT',
        amount: -25_000n,
      })
    );

    expect(result.transferConfidence).toBe(80);
    expect(result.isStrongCreditCardPayment).toBe(true);
    expect(result.isLikelyTransfer).toBe(true);
  });

  it('falls back to a strong legacy credit-card classification when the transaction code is unrelated', () => {
    const result = detectTransfer(
      detectionInput({
        plaidCategory: ['Payment', 'Credit Card'],
        plaidTransactionCode: 'direct debit',
        amount: -25_000n,
      })
    );

    expect(result.transferConfidence).toBe(60);
    expect(result.isStrongCreditCardPayment).toBe(true);
    expect(result.isLikelyTransfer).toBe(true);
  });

  it('penalizes a provider direction that conflicts with the signed amount', () => {
    const result = detectTransfer(
      detectionInput({
        plaidPersonalFinanceCategory: {
          primary: 'TRANSFER_IN',
          detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
          confidence: 'VERY_HIGH',
        },
        amount: -10_000n,
      })
    );

    expect(result.transferConfidence).toBe(25);
    expect(result.isLikelyTransfer).toBe(false);
  });
});
