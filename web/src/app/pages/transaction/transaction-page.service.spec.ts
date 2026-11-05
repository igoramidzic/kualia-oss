import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { TransactionWithRelations } from '../../services/transaction.service';
import { TransactionPageService } from './transaction-page.service';

describe('TransactionPageService', () => {
  let service: TransactionPageService;

  beforeEach(() => {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [TransactionPageService],
    });
    service = TestBed.inject(TransactionPageService);
  });

  describe('initial state', () => {
    it('should initialize with null transaction', () => {
      expect(service.transaction()).toBeNull();
    });

    it('should initialize with null populatedTransaction', () => {
      expect(service.populatedTransaction()).toBeNull();
    });

    it('should initialize with false loading state', () => {
      expect(service.isLoading()).toBe(false);
    });

    it('should initialize with zero transactionAmountEdit', () => {
      expect(service.transactionAmountEdit()).toBe(0);
    });
  });

  describe('setTransaction', () => {
    it('should set transaction and initialize edit amount', () => {
      const mockTransaction: TransactionWithRelations = {
        _id: 'test-id' as any,
        _creationTime: Date.now(),
        amount: 5000n, // $50.00 in cents
        bankAccount: null,
        merchant: null,
        merchantName: 'Test Merchant',
        merchantLogo: null,
        project: null,
        movements: [],
        transferPairAccountName: null,
      } as TransactionWithRelations;

      service.setTransaction(mockTransaction);

      expect(service.transaction()).toEqual(mockTransaction);
      expect(service.populatedTransaction()).toEqual(mockTransaction);
      expect(service.transactionAmountEdit()).toBe(5000);
    });

    it('should set transaction to null without resetting edit amount', () => {
      const mockTransaction: TransactionWithRelations = {
        _id: 'test-id' as any,
        _creationTime: Date.now(),
        amount: 5000n,
        bankAccount: null,
        merchant: null,
        merchantName: 'Test Merchant',
        merchantLogo: null,
        project: null,
        movements: [],
        transferPairAccountName: null,
      } as TransactionWithRelations;

      service.setTransaction(mockTransaction);
      service.setTransaction(null);

      expect(service.transaction()).toBeNull();
      expect(service.populatedTransaction()).toBeNull();
      // Edit amount is not reset when transaction is set to null
      expect(service.transactionAmountEdit()).toBe(5000);
    });

    it('should handle bigint amount conversion', () => {
      const mockTransaction: TransactionWithRelations = {
        _id: 'test-id' as any,
        _creationTime: Date.now(),
        amount: 123456n, // $1234.56 in cents
        bankAccount: null,
        merchant: null,
        merchantName: 'Test Merchant',
        merchantLogo: null,
        project: null,
        movements: [],
        transferPairAccountName: null,
      } as TransactionWithRelations;

      service.setTransaction(mockTransaction);

      expect(service.transactionAmountEdit()).toBe(123456);
    });
  });

  describe('setTransactionAmountEdit', () => {
    it('should update transactionAmountEdit signal', () => {
      service.setTransactionAmountEdit(10000);

      expect(service.transactionAmountEdit()).toBe(10000);
    });

    it('should handle negative amounts', () => {
      service.setTransactionAmountEdit(-5000);

      expect(service.transactionAmountEdit()).toBe(-5000);
    });

    it('should handle zero amount', () => {
      service.setTransactionAmountEdit(0);

      expect(service.transactionAmountEdit()).toBe(0);
    });
  });

  describe('setLoading', () => {
    it('should update loading state to true', () => {
      service.setLoading(true);

      expect(service.isLoading()).toBe(true);
    });

    it('should update loading state to false', () => {
      service.setLoading(true);
      service.setLoading(false);

      expect(service.isLoading()).toBe(false);
    });
  });

  describe('computed signals', () => {
    it('should return transaction from computed signal', () => {
      const mockTransaction: TransactionWithRelations = {
        _id: 'test-id' as any,
        _creationTime: Date.now(),
        amount: 5000n,
        bankAccount: null,
        merchant: null,
        merchantName: 'Test Merchant',
        merchantLogo: null,
        project: null,
        movements: [],
        transferPairAccountName: null,
      } as TransactionWithRelations;

      service.setTransaction(mockTransaction);

      expect(service.transaction()).toEqual(mockTransaction);
    });

    it('should return populatedTransaction from computed signal', () => {
      const mockTransaction: TransactionWithRelations = {
        _id: 'test-id' as any,
        _creationTime: Date.now(),
        amount: 5000n,
        bankAccount: null,
        merchant: null,
        merchantName: 'Test Merchant',
        merchantLogo: null,
        project: null,
        movements: [],
        transferPairAccountName: null,
      } as TransactionWithRelations;

      service.setTransaction(mockTransaction);

      expect(service.populatedTransaction()).toEqual(mockTransaction);
    });

    it('should return loading state from computed signal', () => {
      service.setLoading(true);
      expect(service.isLoading()).toBe(true);

      service.setLoading(false);
      expect(service.isLoading()).toBe(false);
    });

    it('should return transactionAmountEdit from computed signal', () => {
      service.setTransactionAmountEdit(7500);
      expect(service.transactionAmountEdit()).toBe(7500);
    });
  });
});
