import { computed, signal } from '@angular/core';
import { Id } from 'convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BankAccountWithRelations } from '../../../services/bank-account.service';
import { Merchant } from '../../../services/merchant.service';
import { SCHEDULED_REMINDER_OPTIONS } from '../../../services/scheduled-transaction.service';
import { PayeeChangeEvent } from '../../transaction/payee-selector.component';
import { buildPlannedOptionsUpdate, shouldShowPlannedOptions } from './create-transaction-dialog-content';

// Helper function to create mock merchant
function createMockMerchant(overrides?: Partial<Merchant>): Merchant {
  return {
    _id: 'merchant-1' as Id<'merchant'>,
    _creationTime: Date.now(),
    name: 'Test Merchant',
    workspaceId: 'workspace-1' as Id<'workspace'>,
    isDeleted: false,
    transactionCount: 5,
    logoUrl: undefined,
    ...overrides,
  } as Merchant;
}

// Helper function to create mock bank account
function createMockBankAccount(overrides?: Partial<BankAccountWithRelations>): BankAccountWithRelations {
  return {
    _id: 'bank-1' as Id<'bankAccount'>,
    _creationTime: Date.now(),
    name: 'Checking Account',
    workspaceId: 'workspace-1' as Id<'workspace'>,
    isDeleted: false,
    institution: null,
    ...overrides,
  } as BankAccountWithRelations;
}

/**
 * These tests verify the payee selection logic that would be used in CreateTransactionDialogContentComponent.
 * Since the component requires complex dialog context injection, we test the core logic directly
 * to ensure the payee selector integration works correctly.
 */
describe('CreateTransactionDialog Payee Selection Logic', () => {
  let merchants: ReturnType<typeof signal<Merchant[]>>;
  let bankAccounts: ReturnType<typeof signal<BankAccountWithRelations[]>>;
  let selectedMerchantIdValue: ReturnType<typeof signal<string | null>>;
  let pendingMerchantName: ReturnType<typeof signal<string | null>>;
  let isTransfer: ReturnType<typeof signal<boolean>>;
  let selectedPayeeBankAccountId: ReturnType<typeof signal<string | null>>;
  let selectedBankAccount: ReturnType<typeof signal<BankAccountWithRelations | null>>;
  let transactionAmountValue: ReturnType<typeof signal<number | null>>;
  let amountSign: ReturnType<typeof signal<'inflow' | 'outflow'>>;

  beforeEach(() => {
    merchants = signal([
      createMockMerchant({ _id: 'merchant-1' as Id<'merchant'>, name: 'Amazon' }),
      createMockMerchant({ _id: 'merchant-2' as Id<'merchant'>, name: 'Walmart' }),
    ]);

    bankAccounts = signal([
      createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' }),
      createMockBankAccount({ _id: 'bank-2' as Id<'bankAccount'>, name: 'Savings' }),
    ]);

    selectedMerchantIdValue = signal<string | null>(null);
    pendingMerchantName = signal<string | null>(null);
    isTransfer = signal(false);
    selectedPayeeBankAccountId = signal<string | null>(null);
    selectedBankAccount = signal<BankAccountWithRelations | null>(null);
    transactionAmountValue = signal<number | null>(null);
    amountSign = signal<'inflow' | 'outflow'>('outflow');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('onPayeeChange logic', () => {
    function onPayeeChange(event: PayeeChangeEvent) {
      if (event.type === 'merchant') {
        // Selecting a merchant - clear transfer state
        isTransfer.set(false);
        selectedPayeeBankAccountId.set(null);

        if (event.pendingName) {
          // New merchant to be created
          pendingMerchantName.set(event.pendingName);
          selectedMerchantIdValue.set(null);
        } else {
          // Existing merchant or no merchant
          pendingMerchantName.set(null);
          selectedMerchantIdValue.set(event.id);
        }
      } else if (event.type === 'bankAccount') {
        // Selecting a bank account for transfer
        isTransfer.set(true);
        selectedPayeeBankAccountId.set(event.id);
        selectedMerchantIdValue.set(null);
        pendingMerchantName.set(null);

        // If payee is same as from account, clear from account
        if (selectedBankAccount()?._id === event.id) {
          selectedBankAccount.set(null);
        }
      }
    }

    describe('selecting a merchant', () => {
      it('should set selectedMerchantIdValue when merchant is selected', () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-1' };
        onPayeeChange(change);

        expect(selectedMerchantIdValue()).toBe('merchant-1');
        expect(isTransfer()).toBe(false);
      });

      it('should clear transfer state when switching from transfer to merchant', () => {
        // First set up as transfer
        isTransfer.set(true);
        selectedPayeeBankAccountId.set('bank-2');

        // Then select a merchant
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-1' };
        onPayeeChange(change);

        expect(isTransfer()).toBe(false);
        expect(selectedPayeeBankAccountId()).toBeNull();
        expect(selectedMerchantIdValue()).toBe('merchant-1');
      });

      it('should handle null merchant (no payee)', () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: null };
        onPayeeChange(change);

        expect(selectedMerchantIdValue()).toBeNull();
        expect(pendingMerchantName()).toBeNull();
        expect(isTransfer()).toBe(false);
      });

      it('should set pendingMerchantName when creating new merchant', () => {
        const change: PayeeChangeEvent = { type: 'merchant', id: null, pendingName: 'New Store' };
        onPayeeChange(change);

        expect(pendingMerchantName()).toBe('New Store');
        expect(selectedMerchantIdValue()).toBeNull();
        expect(isTransfer()).toBe(false);
      });

      it('should clear pendingMerchantName when selecting existing merchant', () => {
        // First set a pending name
        pendingMerchantName.set('Pending');

        // Then select an existing merchant
        const change: PayeeChangeEvent = { type: 'merchant', id: 'merchant-1' };
        onPayeeChange(change);

        expect(pendingMerchantName()).toBeNull();
        expect(selectedMerchantIdValue()).toBe('merchant-1');
      });
    });

    describe('selecting a bank account (transfer)', () => {
      it('should set isTransfer to true when bank account is selected', () => {
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };
        onPayeeChange(change);

        expect(isTransfer()).toBe(true);
        expect(selectedPayeeBankAccountId()).toBe('bank-2');
      });

      it('should clear merchant selection when selecting bank account', () => {
        // First select a merchant
        selectedMerchantIdValue.set('merchant-1');
        pendingMerchantName.set('Some Name');

        // Then select a bank account
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-2' };
        onPayeeChange(change);

        expect(selectedMerchantIdValue()).toBeNull();
        expect(pendingMerchantName()).toBeNull();
        expect(isTransfer()).toBe(true);
      });

      it('should clear from bank account if payee is same as from account', () => {
        // Set up from account
        selectedBankAccount.set(createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' }));

        // Select same account as payee (should clear from account)
        const change: PayeeChangeEvent = { type: 'bankAccount', id: 'bank-1' };
        onPayeeChange(change);

        expect(selectedBankAccount()).toBeNull();
      });
    });
  });

  describe('payeeBankAccounts computed', () => {
    it('should exclude currently selected bank account from payee options', () => {
      selectedBankAccount.set(createMockBankAccount({ _id: 'bank-1' as Id<'bankAccount'>, name: 'Checking' }));

      const payeeBankAccounts = computed(() => {
        const currentBankAccount = selectedBankAccount();
        return bankAccounts().filter((acc) => acc._id !== currentBankAccount?._id);
      });

      const payeeAccounts = payeeBankAccounts();
      expect(payeeAccounts).toHaveLength(1);
      expect(payeeAccounts[0].name).toBe('Savings');
    });

    it('should return all bank accounts when none is selected', () => {
      selectedBankAccount.set(null);

      const payeeBankAccounts = computed(() => {
        const currentBankAccount = selectedBankAccount();
        return bankAccounts().filter((acc) => acc._id !== currentBankAccount?._id);
      });

      const payeeAccounts = payeeBankAccounts();
      expect(payeeAccounts).toHaveLength(2);
    });
  });

  describe('onBankAccountChangeForTransfer', () => {
    function onBankAccountChangeForTransfer(newBankAccountId: string) {
      // If the new from-account is the same as the payee account, clear the payee
      if (selectedPayeeBankAccountId() === newBankAccountId) {
        selectedPayeeBankAccountId.set(null);
        isTransfer.set(false);
      }

      // Update the from bank account
      const newAccount = bankAccounts().find((acc) => acc._id === newBankAccountId);
      if (newAccount) {
        selectedBankAccount.set(newAccount);
      }
    }

    it('should clear payee bank account if it matches from account', () => {
      // Set up payee
      isTransfer.set(true);
      selectedPayeeBankAccountId.set('bank-2');

      // Change from account to same as payee
      onBankAccountChangeForTransfer('bank-2');

      expect(selectedPayeeBankAccountId()).toBeNull();
      expect(isTransfer()).toBe(false);
    });

    it('should update from bank account normally if no conflict', () => {
      isTransfer.set(true);
      selectedPayeeBankAccountId.set('bank-2');

      onBankAccountChangeForTransfer('bank-1');

      expect(selectedPayeeBankAccountId()).toBe('bank-2');
      expect(selectedBankAccount()?._id).toBe('bank-1');
    });
  });

  describe('selectedMerchant computed', () => {
    it('should return null when no merchant is selected', () => {
      selectedMerchantIdValue.set(null);

      const selectedMerchant = computed(() => {
        const id = selectedMerchantIdValue();
        if (!id) return null;
        return merchants().find((m) => m._id === id) ?? null;
      });

      expect(selectedMerchant()).toBeNull();
    });

    it('should find merchant by ID', () => {
      selectedMerchantIdValue.set('merchant-1');

      const selectedMerchant = computed(() => {
        const id = selectedMerchantIdValue();
        if (!id) return null;
        return merchants().find((m) => m._id === id) ?? null;
      });

      const merchant = selectedMerchant();
      expect(merchant).not.toBeNull();
      expect(merchant?.name).toBe('Amazon');
    });

    it('should return null when ID does not match any merchant', () => {
      selectedMerchantIdValue.set('non-existent');

      const selectedMerchant = computed(() => {
        const id = selectedMerchantIdValue();
        if (!id) return null;
        return merchants().find((m) => m._id === id) ?? null;
      });

      expect(selectedMerchant()).toBeNull();
    });
  });

  describe('amount handling', () => {
    it('should apply sign when amount changes (outflow)', () => {
      amountSign.set('outflow');
      const rawAmount = 5000;
      const signedAmount = amountSign() === 'outflow' ? -rawAmount : rawAmount;

      transactionAmountValue.set(signedAmount);

      expect(transactionAmountValue()).toBe(-5000);
    });

    it('should apply sign when amount changes (inflow)', () => {
      amountSign.set('inflow');
      const rawAmount = 5000;
      const signedAmount = amountSign() === 'outflow' ? -rawAmount : rawAmount;

      transactionAmountValue.set(signedAmount);

      expect(transactionAmountValue()).toBe(5000);
    });

    it('should update sign and recalculate amount', () => {
      transactionAmountValue.set(-5000);

      // Flip sign from outflow to inflow
      const currentAmount = transactionAmountValue();
      if (currentAmount !== null) {
        transactionAmountValue.set(Math.abs(currentAmount)); // convert to positive for inflow
      }
      amountSign.set('inflow');

      expect(amountSign()).toBe('inflow');
      expect(transactionAmountValue()).toBe(5000);
    });

    it('should handle null amount', () => {
      transactionAmountValue.set(null);
      expect(transactionAmountValue()).toBeNull();
    });

    it('should display absolute value in UI', () => {
      transactionAmountValue.set(-5000);

      const transactionAmountDisplay = computed(() => {
        const amount = transactionAmountValue();
        return amount !== null ? Math.abs(amount) : null;
      });

      expect(transactionAmountDisplay()).toBe(5000);
    });

    it('should use amount sign for payee transfer direction before an amount is entered', () => {
      const payeeSelectorTransactionAmount = computed(() => {
        const amount = transactionAmountValue();
        if (amount !== null) {
          return amount;
        }
        return amountSign() === 'outflow' ? -1 : 1;
      });

      amountSign.set('outflow');
      transactionAmountValue.set(null);
      expect(payeeSelectorTransactionAmount()).toBe(-1);

      amountSign.set('inflow');
      expect(payeeSelectorTransactionAmount()).toBe(1);
    });

    it('should prefer the entered signed amount for payee transfer direction', () => {
      const payeeSelectorTransactionAmount = computed(() => {
        const amount = transactionAmountValue();
        if (amount !== null) {
          return amount;
        }
        return amountSign() === 'outflow' ? -1 : 1;
      });

      amountSign.set('outflow');
      transactionAmountValue.set(5000);

      expect(payeeSelectorTransactionAmount()).toBe(5000);
    });
  });

  describe('transfer direction', () => {
    it('should determine outflow direction for negative amounts', () => {
      transactionAmountValue.set(-5000);

      const isOutflow = (transactionAmountValue() ?? 0) < 0;
      expect(isOutflow).toBe(true);
    });

    it('should determine inflow direction for positive amounts', () => {
      transactionAmountValue.set(5000);

      const isOutflow = (transactionAmountValue() ?? 0) < 0;
      expect(isOutflow).toBe(false);
    });

    it('should use correct from/to accounts based on direction', () => {
      const fromAccountId = 'bank-1';
      selectedPayeeBankAccountId.set('bank-2');

      // Outflow: from selected bank account to payee
      transactionAmountValue.set(-5000);
      const isOutflow = (transactionAmountValue() ?? 0) < 0;

      const transferFromAccount = isOutflow ? fromAccountId : selectedPayeeBankAccountId();
      const transferToAccount = isOutflow ? selectedPayeeBankAccountId() : fromAccountId;

      expect(transferFromAccount).toBe('bank-1');
      expect(transferToAccount).toBe('bank-2');
    });

    it('should swap accounts for inflow transfers', () => {
      const fromAccountId = 'bank-1';
      selectedPayeeBankAccountId.set('bank-2');

      // Inflow: from payee to selected bank account
      transactionAmountValue.set(5000);
      const isOutflow = (transactionAmountValue() ?? 0) < 0;

      const transferFromAccount = isOutflow ? fromAccountId : selectedPayeeBankAccountId();
      const transferToAccount = isOutflow ? selectedPayeeBankAccountId() : fromAccountId;

      expect(transferFromAccount).toBe('bank-2');
      expect(transferToAccount).toBe('bank-1');
    });
  });

  describe('isDateTodayOrPast', () => {
    it('should return true for today', () => {
      const selectedDate = signal(new Date());

      const isDateTodayOrPast = computed(() => {
        const date = selectedDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selected = new Date(date);
        selected.setHours(0, 0, 0, 0);
        return selected <= today;
      });

      expect(isDateTodayOrPast()).toBe(true);
    });

    it('should return true for past date', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);
      const selectedDate = signal(pastDate);

      const isDateTodayOrPast = computed(() => {
        const date = selectedDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selected = new Date(date);
        selected.setHours(0, 0, 0, 0);
        return selected <= today;
      });

      expect(isDateTodayOrPast()).toBe(true);
    });

    it('should return false for future date', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const selectedDate = signal(futureDate);

      const isDateTodayOrPast = computed(() => {
        const date = selectedDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selected = new Date(date);
        selected.setHours(0, 0, 0, 0);
        return selected <= today;
      });

      expect(isDateTodayOrPast()).toBe(false);
    });
  });

  describe('scheduling logic', () => {
    type CreateRegularTransactionResult =
      | string
      | {
          transactionId?: string;
          transferPairTransactionId?: string;
          scheduledTransactionId: string;
          nextDate: string;
        };

    it('treats a plain string result as an entered transaction (legacy path)', () => {
      const result: CreateRegularTransactionResult = 'transaction-1';
      expect(typeof result === 'string').toBe(true);
    });

    it('treats an object without transactionId as scheduled-only', () => {
      const result: CreateRegularTransactionResult = {
        scheduledTransactionId: 'scheduled-1',
        nextDate: '2026-08-01',
      };
      const transactionId = typeof result === 'string' ? result : result.transactionId;
      expect(transactionId).toBeUndefined();
    });

    it('treats an object with transactionId as entered plus scheduled next occurrence', () => {
      const result: CreateRegularTransactionResult = {
        transactionId: 'transaction-1',
        scheduledTransactionId: 'scheduled-1',
        nextDate: '2026-08-01',
      };
      const transactionId = typeof result === 'string' ? result : result.transactionId;
      expect(transactionId).toBe('transaction-1');
    });

    it('treats an immediate recurring transfer result as entered plus scheduled next occurrence', () => {
      const result: CreateRegularTransactionResult = {
        transactionId: 'transfer-from-1',
        transferPairTransactionId: 'transfer-to-1',
        scheduledTransactionId: 'scheduled-1',
        nextDate: '2026-08-01',
      };
      const transactionId = typeof result === 'string' ? result : result.transactionId;
      const pairId = typeof result === 'string' ? undefined : result.transferPairTransactionId;
      expect(transactionId).toBe('transfer-from-1');
      expect(pairId).toBe('transfer-to-1');
    });

    it('shows planned options for future or repeating transactions', () => {
      expect(shouldShowPlannedOptions(true, false, 'once')).toBe(true);
      expect(shouldShowPlannedOptions(true, true, 'monthly')).toBe(true);
      expect(shouldShowPlannedOptions(true, true, 'once')).toBe(false);
      expect(shouldShowPlannedOptions(false, false, 'monthly')).toBe(false);
    });

    it('builds automatic-entry options with no reminder by default', () => {
      expect(SCHEDULED_REMINDER_OPTIONS.find((option) => option.value === 'none')?.label).toBe('No reminder');
      expect(buildPlannedOptionsUpdate('scheduled-1' as Id<'scheduledTransaction'>, true, 'none')).toEqual({
        scheduledTransactionId: 'scheduled-1',
        entryMode: 'auto',
        reminderEnabled: false,
        reminderOffset: null,
      });
    });

    it('builds manual-entry options with the selected reminder', () => {
      expect(buildPlannedOptionsUpdate('scheduled-1' as Id<'scheduledTransaction'>, false, '1_week_before')).toEqual({
        scheduledTransactionId: 'scheduled-1',
        entryMode: 'manual',
        reminderEnabled: true,
        reminderOffset: '1_week_before',
      });
    });

    it('allows scheduling for regular transactions and transfers', () => {
      const systemType = signal<'starting_balance' | 'balance_adjustment' | null>(null);
      isTransfer.set(false);

      const transactionType = computed(() => {
        const system = systemType();
        if (system) return system;
        if (isTransfer()) return 'transfer';
        return 'regular';
      });
      const canSchedule = computed(() => transactionType() === 'regular' || transactionType() === 'transfer');
      // null lifts the date picker's max; undefined keeps the default max of today
      const datePickerMax = computed(() => (canSchedule() ? null : undefined));

      expect(canSchedule()).toBe(true);
      expect(datePickerMax()).toBeNull();

      isTransfer.set(true);
      expect(canSchedule()).toBe(true);
      expect(datePickerMax()).toBeNull();

      isTransfer.set(false);
      systemType.set('starting_balance');
      expect(canSchedule()).toBe(false);
    });

    it('keeps a future date available when switching to a transfer', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const selectedDate = signal(futureDate);

      const isDateTodayOrPast = () => {
        const selected = new Date(selectedDate());
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        selected.setHours(0, 0, 0, 0);
        return selected <= today;
      };

      expect(isDateTodayOrPast()).toBe(false);
      expect(selectedDate()).toBe(futureDate);
    });
  });

  describe('state flags', () => {
    it('should track creating state', () => {
      const creating = signal(false);

      // Simulate starting creation
      creating.set(true);
      expect(creating()).toBe(true);

      // Simulate completion
      creating.set(false);
      expect(creating()).toBe(false);
    });

    it('should track isPending state', () => {
      const isPending = signal(true);

      expect(isPending()).toBe(true);

      isPending.set(false);
      expect(isPending()).toBe(false);

      isPending.set(true);
      expect(isPending()).toBe(true);
    });
  });
});
