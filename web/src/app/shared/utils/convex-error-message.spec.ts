import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { extractConvexErrorMessage, extractMappedConvexErrorMessage } from './convex-error-message';

describe('convex error message utilities', () => {
  it('returns ConvexError string data', () => {
    expect(extractConvexErrorMessage(new ConvexError('Bank link not found'), 'Fallback')).toBe('Bank link not found');
  });

  it('extracts the innermost message from wrapped action errors', () => {
    const error = new Error(
      '[CONVEX A(bankLinks:deleteBankLinkAction)] [Request ID: test] Server Error Uncaught ConvexError: Uncaught ConvexError: Access denied at handler (../../convex/bankProviders/plaid/disconnectPlaidItem.ts:41:30) at async handler (../../convex/bankLinks/delete.ts:79:8) Called by client'
    );

    expect(extractConvexErrorMessage(error, 'Fallback')).toBe('Access denied');
  });

  it('extracts data strings from legacy raw messages', () => {
    const error = new Error('[CONVEX M(workspaces:createWorkspace)] Server Error data: "Workspace already exists"');

    expect(extractConvexErrorMessage(error, 'Fallback')).toBe('Workspace already exists');
  });

  it('falls back when a wrapped Convex client error has no user message', () => {
    const error = new Error('[CONVEX M(example)] [Request ID: test] Server Error Called by client');

    expect(extractConvexErrorMessage(error, 'Fallback')).toBe('Fallback');
  });

  it('maps extracted messages when a flow needs friendlier copy', () => {
    const error = new Error('Uncaught ConvexError: Access denied');

    expect(
      extractMappedConvexErrorMessage(error, 'Fallback', (message) =>
        message === 'Access denied' ? 'You do not have permission.' : message
      )
    ).toBe('You do not have permission.');
  });
});
