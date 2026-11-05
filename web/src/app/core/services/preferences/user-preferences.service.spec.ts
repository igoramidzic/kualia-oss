import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserPreferencesService } from './user-preferences.service';

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [UserPreferencesService],
    });
    service = TestBed.inject(UserPreferencesService);
  });

  describe('budgetSidebarOpen', () => {
    describe('initial state', () => {
      it('should default to true when no preference is stored', () => {
        expect(service.budgetSidebarOpen()).toBe(true);
      });

      it('should load true from localStorage if stored', () => {
        localStorage.setItem('kualia-user-preferences', JSON.stringify({ theme: 'system', budgetSidebarOpen: true }));

        // Reset TestBed to create a fresh instance that reads from localStorage
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [UserPreferencesService],
        });
        const newService = TestBed.inject(UserPreferencesService);
        expect(newService.budgetSidebarOpen()).toBe(true);
      });

      it('should load false from localStorage if stored', () => {
        localStorage.setItem('kualia-user-preferences', JSON.stringify({ theme: 'system', budgetSidebarOpen: false }));

        // Reset TestBed to create a fresh instance that reads from localStorage
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [UserPreferencesService],
        });
        const newService = TestBed.inject(UserPreferencesService);
        expect(newService.budgetSidebarOpen()).toBe(false);
      });
    });

    describe('setBudgetSidebarOpen', () => {
      it('should set sidebar open to true', () => {
        service.setBudgetSidebarOpen(true);
        expect(service.budgetSidebarOpen()).toBe(true);
      });

      it('should set sidebar open to false', () => {
        service.setBudgetSidebarOpen(true);
        service.setBudgetSidebarOpen(false);
        expect(service.budgetSidebarOpen()).toBe(false);
      });

      it('should persist to localStorage', () => {
        service.setBudgetSidebarOpen(true);

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.budgetSidebarOpen).toBe(true);
      });
    });

    describe('toggleBudgetSidebar', () => {
      it('should toggle from true to false', () => {
        expect(service.budgetSidebarOpen()).toBe(true);
        service.toggleBudgetSidebar();
        expect(service.budgetSidebarOpen()).toBe(false);
      });

      it('should toggle from false to true', () => {
        service.setBudgetSidebarOpen(false);
        service.toggleBudgetSidebar();
        expect(service.budgetSidebarOpen()).toBe(true);
      });

      it('should toggle multiple times', () => {
        expect(service.budgetSidebarOpen()).toBe(true);

        service.toggleBudgetSidebar();
        expect(service.budgetSidebarOpen()).toBe(false);

        service.toggleBudgetSidebar();
        expect(service.budgetSidebarOpen()).toBe(true);

        service.toggleBudgetSidebar();
        expect(service.budgetSidebarOpen()).toBe(false);
      });

      it('should persist toggle state to localStorage', () => {
        service.toggleBudgetSidebar();

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.budgetSidebarOpen).toBe(false);
      });
    });
  });

  describe('bankAccountSidebarOpen', () => {
    describe('initial state', () => {
      it('should default to true when no preference is stored', () => {
        expect(service.bankAccountSidebarOpen()).toBe(true);
      });

      it('should load true from localStorage if stored', () => {
        localStorage.setItem(
          'kualia-user-preferences',
          JSON.stringify({ theme: 'system', bankAccountSidebarOpen: true })
        );

        // Reset TestBed to create a fresh instance that reads from localStorage
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [UserPreferencesService],
        });
        const newService = TestBed.inject(UserPreferencesService);
        expect(newService.bankAccountSidebarOpen()).toBe(true);
      });

      it('should load false from localStorage if stored', () => {
        localStorage.setItem(
          'kualia-user-preferences',
          JSON.stringify({ theme: 'system', bankAccountSidebarOpen: false })
        );

        // Reset TestBed to create a fresh instance that reads from localStorage
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [UserPreferencesService],
        });
        const newService = TestBed.inject(UserPreferencesService);
        expect(newService.bankAccountSidebarOpen()).toBe(false);
      });
    });

    describe('setBankAccountSidebarOpen', () => {
      it('should set sidebar open to true', () => {
        service.setBankAccountSidebarOpen(true);
        expect(service.bankAccountSidebarOpen()).toBe(true);
      });

      it('should set sidebar open to false', () => {
        service.setBankAccountSidebarOpen(true);
        service.setBankAccountSidebarOpen(false);
        expect(service.bankAccountSidebarOpen()).toBe(false);
      });

      it('should persist to localStorage', () => {
        service.setBankAccountSidebarOpen(false);

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.bankAccountSidebarOpen).toBe(false);
      });
    });

    describe('toggleBankAccountSidebar', () => {
      it('should toggle from true to false', () => {
        expect(service.bankAccountSidebarOpen()).toBe(true);
        service.toggleBankAccountSidebar();
        expect(service.bankAccountSidebarOpen()).toBe(false);
      });

      it('should toggle from false to true', () => {
        service.setBankAccountSidebarOpen(false);
        service.toggleBankAccountSidebar();
        expect(service.bankAccountSidebarOpen()).toBe(true);
      });

      it('should toggle multiple times', () => {
        expect(service.bankAccountSidebarOpen()).toBe(true);

        service.toggleBankAccountSidebar();
        expect(service.bankAccountSidebarOpen()).toBe(false);

        service.toggleBankAccountSidebar();
        expect(service.bankAccountSidebarOpen()).toBe(true);

        service.toggleBankAccountSidebar();
        expect(service.bankAccountSidebarOpen()).toBe(false);
      });

      it('should persist toggle state to localStorage', () => {
        service.toggleBankAccountSidebar();

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.bankAccountSidebarOpen).toBe(false);
      });
    });
  });

  describe('plannedTransactionsSectionOpen', () => {
    it('should default to open when no preference is stored', () => {
      expect(service.plannedTransactionsSectionOpen()).toBe(true);
    });

    it('should load a closed preference from localStorage', () => {
      localStorage.setItem(
        'kualia-user-preferences',
        JSON.stringify({ theme: 'system', plannedTransactionsSectionOpen: false })
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [UserPreferencesService] });

      expect(TestBed.inject(UserPreferencesService).plannedTransactionsSectionOpen()).toBe(false);
    });

    it('should toggle and persist the preference', () => {
      service.togglePlannedTransactionsSection();

      expect(service.plannedTransactionsSectionOpen()).toBe(false);
      const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
      expect(stored.plannedTransactionsSectionOpen).toBe(false);
    });
  });

  describe('bankAccountGroupCollapsedStates', () => {
    describe('getBankAccountGroupCollapsedState', () => {
      it('should return false by default for any group', () => {
        expect(service.getBankAccountGroupCollapsedState('Banking')).toBe(false);
        expect(service.getBankAccountGroupCollapsedState('Credit')).toBe(false);
        expect(service.getBankAccountGroupCollapsedState('Investment')).toBe(false);
      });

      it('should return stored collapsed state for a group', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);
        expect(service.getBankAccountGroupCollapsedState('Banking')).toBe(true);
      });

      it('should return false for non-collapsed groups', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);
        expect(service.getBankAccountGroupCollapsedState('Credit')).toBe(false);
      });
    });

    describe('setBankAccountGroupCollapsedState', () => {
      it('should set group collapsed state to true', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);
        expect(service.getBankAccountGroupCollapsedState('Banking')).toBe(true);
      });

      it('should set group collapsed state to false and remove from map', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);
        service.setBankAccountGroupCollapsedState('Banking', false);
        expect(service.getBankAccountGroupCollapsedState('Banking')).toBe(false);

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.bankAccountGroupCollapsedStates).toBeUndefined();
      });

      it('should handle multiple groups independently', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);
        service.setBankAccountGroupCollapsedState('Credit', true);

        expect(service.getBankAccountGroupCollapsedState('Banking')).toBe(true);
        expect(service.getBankAccountGroupCollapsedState('Credit')).toBe(true);
        expect(service.getBankAccountGroupCollapsedState('Investment')).toBe(false);
      });

      it('should persist to localStorage', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.bankAccountGroupCollapsedStates).toEqual({ Banking: true });
      });

      it('should persist multiple groups to localStorage', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);
        service.setBankAccountGroupCollapsedState('Credit', true);

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.bankAccountGroupCollapsedStates).toEqual({ Banking: true, Credit: true });
      });

      it('should remove from localStorage when all groups are opened', () => {
        service.setBankAccountGroupCollapsedState('Banking', true);
        service.setBankAccountGroupCollapsedState('Banking', false);

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.bankAccountGroupCollapsedStates).toBeUndefined();
      });
    });

    describe('persistence and loading', () => {
      it('should load collapsed states from localStorage', () => {
        localStorage.setItem(
          'kualia-user-preferences',
          JSON.stringify({
            theme: 'system',
            bankAccountGroupCollapsedStates: { Banking: true, Credit: true },
          })
        );

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [UserPreferencesService],
        });
        const newService = TestBed.inject(UserPreferencesService);

        expect(newService.getBankAccountGroupCollapsedState('Banking')).toBe(true);
        expect(newService.getBankAccountGroupCollapsedState('Credit')).toBe(true);
        expect(newService.getBankAccountGroupCollapsedState('Investment')).toBe(false);
      });
    });
  });

  describe('preferences validation', () => {
    it('should handle invalid budgetSidebarOpen type gracefully', () => {
      localStorage.setItem(
        'kualia-user-preferences',
        JSON.stringify({ theme: 'system', budgetSidebarOpen: 'invalid' })
      );

      // Reset TestBed to create a fresh instance that reads from localStorage
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [UserPreferencesService],
      });
      // Should fall back to defaults when validation fails
      const newService = TestBed.inject(UserPreferencesService);
      expect(newService.budgetSidebarOpen()).toBe(true);
    });

    it('should handle missing budgetSidebarOpen property', () => {
      localStorage.setItem('kualia-user-preferences', JSON.stringify({ theme: 'system' }));

      // Reset TestBed to create a fresh instance that reads from localStorage
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [UserPreferencesService],
      });
      const newService = TestBed.inject(UserPreferencesService);
      expect(newService.budgetSidebarOpen()).toBe(true);
    });

    it('should handle invalid bankAccountSidebarOpen type gracefully', () => {
      localStorage.setItem(
        'kualia-user-preferences',
        JSON.stringify({ theme: 'system', bankAccountSidebarOpen: 'invalid' })
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [UserPreferencesService],
      });
      const newService = TestBed.inject(UserPreferencesService);
      expect(newService.bankAccountSidebarOpen()).toBe(true);
    });

    it('should handle missing bankAccountSidebarOpen property', () => {
      localStorage.setItem('kualia-user-preferences', JSON.stringify({ theme: 'system' }));

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [UserPreferencesService],
      });
      const newService = TestBed.inject(UserPreferencesService);
      expect(newService.bankAccountSidebarOpen()).toBe(true);
    });

    it('should handle invalid bankAccountGroupCollapsedStates type gracefully', () => {
      localStorage.setItem(
        'kualia-user-preferences',
        JSON.stringify({ theme: 'system', bankAccountGroupCollapsedStates: 'invalid' })
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [UserPreferencesService],
      });
      const newService = TestBed.inject(UserPreferencesService);
      expect(newService.getBankAccountGroupCollapsedState('Banking')).toBe(false);
    });
  });

  describe('quickAssignAllowNegativeRta', () => {
    describe('initial state', () => {
      it('should default to false when no preference is stored', () => {
        expect(service.quickAssignAllowNegativeRta()).toBe(false);
      });

      it('should load true from localStorage if stored', () => {
        localStorage.setItem(
          'kualia-user-preferences',
          JSON.stringify({ theme: 'system', quickAssignAllowNegativeRta: true })
        );

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [UserPreferencesService],
        });
        const newService = TestBed.inject(UserPreferencesService);
        expect(newService.quickAssignAllowNegativeRta()).toBe(true);
      });

      it('should load false from localStorage if stored', () => {
        localStorage.setItem(
          'kualia-user-preferences',
          JSON.stringify({ theme: 'system', quickAssignAllowNegativeRta: false })
        );

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [UserPreferencesService],
        });
        const newService = TestBed.inject(UserPreferencesService);
        expect(newService.quickAssignAllowNegativeRta()).toBe(false);
      });
    });

    describe('setQuickAssignAllowNegativeRta', () => {
      it('should set allow negative RTA to true', () => {
        service.setQuickAssignAllowNegativeRta(true);
        expect(service.quickAssignAllowNegativeRta()).toBe(true);
      });

      it('should set allow negative RTA to false', () => {
        service.setQuickAssignAllowNegativeRta(true);
        service.setQuickAssignAllowNegativeRta(false);
        expect(service.quickAssignAllowNegativeRta()).toBe(false);
      });

      it('should persist to localStorage', () => {
        service.setQuickAssignAllowNegativeRta(true);

        const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
        expect(stored.quickAssignAllowNegativeRta).toBe(true);
      });
    });

    describe('toggleQuickAssignAllowNegativeRta', () => {
      it('should toggle from false to true', () => {
        expect(service.quickAssignAllowNegativeRta()).toBe(false);
        service.toggleQuickAssignAllowNegativeRta();
        expect(service.quickAssignAllowNegativeRta()).toBe(true);
      });

      it('should toggle from true to false', () => {
        service.setQuickAssignAllowNegativeRta(true);
        service.toggleQuickAssignAllowNegativeRta();
        expect(service.quickAssignAllowNegativeRta()).toBe(false);
      });
    });
  });
});
