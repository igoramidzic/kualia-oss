import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BankAccountService } from '../../../services/bank-account.service';
import { CurrencyService } from '../../../services/currency.service';
import { TransactionService, TransactionWithRelations } from '../../../services/transaction.service';
import { TransferApprovalDialogComponent } from './transfer-approval-dialog';

function createTransaction(amount: bigint, id = 'tx-1'): TransactionWithRelations {
  return {
    _id: id as Id<'transaction'>,
    amount,
    bankAccountId: 'bank-1' as Id<'bankAccount'>,
    bankAccount: {
      _id: 'bank-1' as Id<'bankAccount'>,
      name: 'Checking',
    },
    date: '2026-08-30',
    suggestedTransfer: {
      transferConfidence: 80,
      suggestedCounterpartAccountId: 'bank-2' as Id<'bankAccount'>,
      detectionReason: 'amount_match',
      status: 'pending',
    },
  } as unknown as TransactionWithRelations;
}

describe('TransferApprovalDialogComponent', () => {
  let fixture: ComponentFixture<TransferApprovalDialogComponent>;
  let component: TransferApprovalDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransferApprovalDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: TransactionService,
          useValue: {
            transactions: signal<TransactionWithRelations[]>([]),
            approveTransferSuggestion: vi.fn(),
            approveLinkedTransfer: vi.fn(),
            rejectTransferSuggestion: vi.fn(),
          },
        },
        { provide: BankAccountService, useValue: { bankAccounts: signal([]) } },
        { provide: CurrencyService, useValue: { currencyCode: signal('USD') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransferApprovalDialogComponent);
    component = fixture.componentInstance;
  });

  it('labels a positive imported transaction as coming from the selected account', () => {
    fixture.componentRef.setInput('transaction', createTransaction(366518n));

    fixture.detectChanges();

    expect(component.currentAccountLabel()).toBe('To account');
    expect(component.counterpartAccountLabel()).toBe('From account');
    expect(component.accountSelectionDescription()).toContain('account it came from');
    expect(component.confirmationDescription()).toContain('paired outflow');
    expect(fixture.nativeElement.textContent).toContain('Possible Transfer');
    expect(fixture.nativeElement.textContent).toContain('From account');
  });

  it('labels a negative imported transaction as going to the selected account', () => {
    fixture.componentRef.setInput('transaction', createTransaction(-366518n));

    fixture.detectChanges();

    expect(component.currentAccountLabel()).toBe('From account');
    expect(component.counterpartAccountLabel()).toBe('To account');
    expect(component.accountSelectionDescription()).toContain('account receiving it');
    expect(component.confirmationDescription()).toContain('paired inflow');
    expect(fixture.nativeElement.textContent).toContain('To account');
  });

  it('does not carry a manually selected counterpart to a different transaction input', () => {
    fixture.componentRef.setInput('transaction', createTransaction(-366518n));
    component.selectAccount('bank-3');
    expect(component.effectiveSelectedAccountId()).toBe('bank-3');

    fixture.componentRef.setInput('transaction', createTransaction(-2500n, 'tx-2'));

    expect(component.effectiveSelectedAccountId()).toBe('bank-2');
  });

  it('does not change the selected counterpart after approval starts', async () => {
    let resolveApproval: (success: boolean) => void = () => undefined;
    const approveTransferSuggestion = vi.mocked(TestBed.inject(TransactionService).approveTransferSuggestion);
    approveTransferSuggestion.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveApproval = resolve;
        })
    );
    fixture.componentRef.setInput('transaction', createTransaction(-366518n));
    component.selectAccount('bank-3');

    const approval = component.approveTransfer();
    component.selectAccount('bank-4');

    expect(component.effectiveSelectedAccountId()).toBe('bank-3');
    expect(approveTransferSuggestion).toHaveBeenCalledWith('tx-1', 'bank-3');
    resolveApproval(false);
    await approval;
  });

  it('does not emit or close for a stale rejection success', async () => {
    let resolveRejection: (success: boolean) => void = () => undefined;
    vi.mocked(TestBed.inject(TransactionService).rejectTransferSuggestion).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRejection = resolve;
        })
    );
    const rejectedTransactionIds: Id<'transaction'>[] = [];
    let closeCount = 0;
    component.reject.subscribe((transactionId) => rejectedTransactionIds.push(transactionId));
    component.closed.subscribe(() => closeCount++);
    fixture.componentRef.setInput('transaction', createTransaction(-366518n));

    const rejection = component.rejectTransfer();
    fixture.componentRef.setInput('transaction', createTransaction(2500n, 'tx-2'));
    resolveRejection(true);
    await rejection;

    expect(rejectedTransactionIds).toEqual([]);
    expect(closeCount).toBe(0);
    expect(component.error()).toBeNull();
    expect(component.processing()).toBe(false);
  });

  it('does not expose a stale rejection failure on the new transaction', async () => {
    let rejectRejection: (error: Error) => void = () => undefined;
    vi.mocked(TestBed.inject(TransactionService).rejectTransferSuggestion).mockImplementationOnce(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectRejection = reject;
        })
    );
    let closeCount = 0;
    component.closed.subscribe(() => closeCount++);
    fixture.componentRef.setInput('transaction', createTransaction(-366518n));

    const rejection = component.rejectTransfer();
    fixture.componentRef.setInput('transaction', createTransaction(2500n, 'tx-2'));
    rejectRejection(new Error('stale failure'));
    await rejection;

    expect(closeCount).toBe(0);
    expect(component.error()).toBeNull();
    expect(component.processing()).toBe(false);
  });
});
