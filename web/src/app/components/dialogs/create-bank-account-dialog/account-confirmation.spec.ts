import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrencyService } from '../../../services/currency.service';
import { AccountConfirmationComponent } from './account-confirmation';
import type { BankLinkAccount, BankLinkGroup } from './bank-link-list';

function createBankLinkAccount(overrides: Partial<BankLinkAccount> = {}): BankLinkAccount {
  return {
    _id: 'bank_link_account_123' as Id<'bankLinkAccount'>,
    name: 'Credit Card',
    accountType: 'credit_card',
    accountNumberMask: '4242',
    initialBalance: 317368,
    isLinked: false,
    linkedToBankAccount: null,
    ...overrides,
  };
}

function createBankLinkGroup(account: BankLinkAccount): BankLinkGroup {
  return {
    bankLinkId: 'bank_link_123' as Id<'bankLink'>,
    itemStatus: 'Healthy',
    lastSyncedAt: null,
    owner: null,
    isOwnedByCurrentUser: true,
    canManageConnection: true,
    institution: {
      name: 'Test Bank',
      logo: null,
      primaryColor: null,
    },
    accounts: [account],
  };
}

describe('AccountConfirmationComponent', () => {
  let fixture: ComponentFixture<AccountConfirmationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountConfirmationComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CurrencyService,
          useValue: {
            currencyCode: signal('USD').asReadonly(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountConfirmationComponent);
  });

  it('formats linked account initial balances from cents', () => {
    const account = createBankLinkAccount({ initialBalance: 317368 });

    fixture.componentRef.setInput('bankLink', createBankLinkGroup(account));
    fixture.componentRef.setInput('selectedAccounts', [account]);
    fixture.detectChanges();

    const textContent = fixture.nativeElement.textContent as string;

    expect(textContent).toContain('Starting balance: $3,173.68');
    expect(textContent).not.toContain('$317,368.00');
  });
});
