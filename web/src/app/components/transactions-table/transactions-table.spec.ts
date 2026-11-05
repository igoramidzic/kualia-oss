import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionWithRelations } from '../../services/transaction.service';
import { TransactionsTableComponent } from './transactions-table';

// Mock matchMedia for jsdom environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Helper function to create mock transactions
function createMockTransaction(overrides?: Partial<TransactionWithRelations>): TransactionWithRelations {
  return {
    _id: 'test-transaction-id' as any,
    _creationTime: Date.now(),
    amount: 5000n,
    bankAccount: null,
    merchant: null,
    merchantName: 'Test Merchant',
    merchantLogo: null,
    project: null,
    movements: [],
    transferPairAccountName: null,
    date: '2024-01-15',
    type: 'expense',
    ...overrides,
  } as TransactionWithRelations;
}

describe('TransactionsTableComponent', () => {
  let component: TransactionsTableComponent;
  let fixture: ComponentFixture<TransactionsTableComponent>;
  let mockRouter: Router;
  let routerEventsSubject: Subject<any>;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    // Create subject for router events
    routerEventsSubject = new Subject<any>();

    await TestBed.configureTestingModule({
      imports: [TransactionsTableComponent, RouterTestingModule],
    }).compileComponents();

    // Get the Router from RouterTestingModule and configure events and url
    mockRouter = TestBed.inject(Router);
    Object.defineProperty(mockRouter, 'events', {
      value: routerEventsSubject.asObservable(),
      writable: true,
      configurable: true,
    });
    Object.defineProperty(mockRouter, 'url', {
      value: '/workspace/transactions',
      writable: true,
      configurable: true,
    });

    fixture = TestBed.createComponent(TransactionsTableComponent);
    component = fixture.componentInstance;

    // Set required inputs using setInput (Angular's way to set input signals in tests)
    fixture.componentRef.setInput('transactions', []);
    fixture.componentRef.setInput('loading', false);
  });

  describe('trackByTransactionId', () => {
    it('should return transaction _id', () => {
      const transaction = createMockTransaction({
        _id: 'unique-id-123' as any,
      });

      const result = component.trackByTransactionId(0, transaction);
      expect(result).toBe('unique-id-123');
    });
  });
});
