import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { TransactionSelectionService } from './transaction-selection.service';

describe('TransactionSelectionService', () => {
  let service: TransactionSelectionService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [TransactionSelectionService],
    });
    service = TestBed.inject(TransactionSelectionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Basic selection', () => {
    it('should select a transaction', () => {
      service.selectTransaction('tx1');
      expect(service.selectedTransactions()).toContain('tx1');
      expect(service.hasSelections()).toBe(true);
    });

    it('should deselect a transaction', () => {
      service.selectTransaction('tx1');
      service.deselectTransaction('tx1');
      expect(service.selectedTransactions()).not.toContain('tx1');
      expect(service.hasSelections()).toBe(false);
    });

    it('should toggle a transaction', () => {
      service.toggleTransaction('tx1');
      expect(service.selectedTransactions()).toContain('tx1');
      service.toggleTransaction('tx1');
      expect(service.selectedTransactions()).not.toContain('tx1');
    });

    it('should select multiple transactions', () => {
      service.selectAllTransactions(['tx1', 'tx2', 'tx3']);
      expect(service.selectedTransactions()).toContain('tx1');
      expect(service.selectedTransactions()).toContain('tx2');
      expect(service.selectedTransactions()).toContain('tx3');
      expect(service.selectedTransactions()).toHaveLength(3);
    });

    it('should deselect all transactions', () => {
      service.selectAllTransactions(['tx1', 'tx2', 'tx3']);
      service.deselectAll();
      expect(service.selectedTransactions()).toHaveLength(0);
      expect(service.hasSelections()).toBe(false);
    });
  });

  describe('Transaction selected check', () => {
    it('should return true if transaction is selected', () => {
      service.selectTransaction('tx1');
      const isSelected = service.isTransactionSelected('tx1');
      expect(isSelected()).toBe(true);
    });

    it('should return false if transaction is not selected', () => {
      const isSelected = service.isTransactionSelected('tx1');
      expect(isSelected()).toBe(false);
    });
  });

  describe('Visible transactions tracking', () => {
    it('should update visible transaction IDs', () => {
      const visibleIds = ['tx1', 'tx2', 'tx3'];
      service.setVisibleTransactionIds(visibleIds);
      expect(service.getVisibleTransactionIds()).toEqual(visibleIds);
    });
  });

  describe('Last clicked tracking', () => {
    it('should track last clicked transaction', () => {
      service.setLastClickedTransactionId('tx1');
      expect(service.getLastClickedTransactionId()).toBe('tx1');
    });

    it('should allow clearing last clicked transaction', () => {
      service.setLastClickedTransactionId('tx1');
      service.setLastClickedTransactionId(null);
      expect(service.getLastClickedTransactionId()).toBeNull();
    });
  });

  describe('Range selection', () => {
    beforeEach(() => {
      const visibleIds = ['tx1', 'tx2', 'tx3', 'tx4', 'tx5'];
      service.setVisibleTransactionIds(visibleIds);
    });

    it('should select range forward', () => {
      service.selectRange('tx2', 'tx4');
      const selected = service.selectedTransactions();
      expect(selected).toContain('tx2');
      expect(selected).toContain('tx3');
      expect(selected).toContain('tx4');
      expect(selected).toHaveLength(3);
    });

    it('should select range backward', () => {
      service.selectRange('tx4', 'tx2');
      const selected = service.selectedTransactions();
      expect(selected).toContain('tx2');
      expect(selected).toContain('tx3');
      expect(selected).toContain('tx4');
      expect(selected).toHaveLength(3);
    });

    it('should select single item range', () => {
      service.selectRange('tx3', 'tx3');
      const selected = service.selectedTransactions();
      expect(selected).toContain('tx3');
      expect(selected).toHaveLength(1);
    });

    it('should handle invalid from index', () => {
      service.selectRange('tx99', 'tx3');
      const selected = service.selectedTransactions();
      expect(selected).toHaveLength(0);
    });

    it('should handle invalid to index', () => {
      service.selectRange('tx2', 'tx99');
      const selected = service.selectedTransactions();
      expect(selected).toHaveLength(0);
    });

    it('should preserve existing selections when adding range', () => {
      service.selectTransaction('tx1');
      service.selectRange('tx3', 'tx5');
      const selected = service.selectedTransactions();
      expect(selected).toContain('tx1');
      expect(selected).toContain('tx3');
      expect(selected).toContain('tx4');
      expect(selected).toContain('tx5');
      expect(selected).toHaveLength(4);
    });
  });

  describe('hasSelections', () => {
    it('should return false when no selections', () => {
      expect(service.hasSelections()).toBe(false);
    });

    it('should return true when has selections', () => {
      service.selectTransaction('tx1');
      expect(service.hasSelections()).toBe(true);
    });
  });
});
