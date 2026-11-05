import { computed, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

export type MerchantSortOrder = 'transactionCount' | 'totalSpent';

export interface QuickAssignPreferences {
  assignedLastMonth: boolean;
  spentLastMonth: boolean;
  averageAssigned: boolean;
  averageSpent: boolean;
  resetAssignedAmounts: boolean;
  resetAvailableAmounts: boolean;
}

export const DEFAULT_QUICK_ASSIGN_PREFERENCES: QuickAssignPreferences = {
  assignedLastMonth: true,
  spentLastMonth: true,
  averageAssigned: true,
  averageSpent: true,
  resetAssignedAmounts: true,
  resetAvailableAmounts: true,
};

export interface UserPreferences {
  theme: Theme;
  budgetGroupCollapsedStates?: Record<string, boolean>;
  budgetSidebarOpen?: boolean;
  bankAccountGroupCollapsedStates?: Record<string, boolean>;
  bankAccountSidebarOpen?: boolean;
  sidebarBankAccountGroupCollapsedStates?: Record<string, boolean>;
  sidebarNetWorthCardCollapsed?: boolean;
  closedAccountsVisibleStates?: Record<string, boolean>;
  hiddenCategoriesVisibleStates?: Record<string, boolean>;
  quickAssignCollapsed?: boolean;
  quickAssignPreferences?: QuickAssignPreferences;
  quickAssignAllowNegativeRta?: boolean;
  merchantSortOrder?: MerchantSortOrder;
  showCategoryProgressBars?: boolean;
  plannedTransactionsSectionOpen?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly STORAGE_KEY = 'kualia-user-preferences';

  private readonly preferences = signal<UserPreferences>(this.loadPreferences());

  readonly theme = computed(() => this.preferences().theme);

  readonly budgetSidebarOpen = computed(() => this.preferences().budgetSidebarOpen ?? true);

  readonly bankAccountSidebarOpen = computed(() => this.preferences().bankAccountSidebarOpen ?? true);

  readonly quickAssignCollapsed = computed(() => this.preferences().quickAssignCollapsed ?? false);

  readonly quickAssignPreferences = computed(
    () => this.preferences().quickAssignPreferences ?? DEFAULT_QUICK_ASSIGN_PREFERENCES
  );

  readonly quickAssignAllowNegativeRta = computed(() => this.preferences().quickAssignAllowNegativeRta ?? false);

  readonly merchantSortOrder = computed(() => this.preferences().merchantSortOrder ?? 'transactionCount');

  readonly showCategoryProgressBars = computed(() => this.preferences().showCategoryProgressBars ?? true);

  readonly plannedTransactionsSectionOpen = computed(() => this.preferences().plannedTransactionsSectionOpen ?? true);

  readonly systemTheme = signal<'light' | 'dark'>(this.getSystemTheme());

  readonly resolvedTheme = computed(() => {
    const theme = this.theme();
    if (theme === 'system') {
      return this.systemTheme();
    }
    return theme;
  });

  constructor() {
    // Use effect to reactively monitor system theme changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      // Update system theme when it changes
      const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
        const newTheme = e.matches ? 'dark' : 'light';
        this.systemTheme.set(newTheme);
      };

      // Use addEventListener for modern browsers
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
      }
      // Fallback to addListener for older browsers
      else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleChange);
      }
    }

    window.addEventListener('storage', (e) => {
      if (e.key === this.STORAGE_KEY && e.newValue) {
        try {
          const newPreferences = JSON.parse(e.newValue) as UserPreferences;
          if (this.isValidPreferences(newPreferences)) {
            this.preferences.set(newPreferences);
          }
        } catch (error) {
          console.warn('Failed to parse preferences from storage event:', error);
        }
      }
    });
  }

  private getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  setTheme(theme: Theme): void {
    this.preferences.update((prefs) => ({ ...prefs, theme }));
    this.savePreferences();
  }

  setBudgetSidebarOpen(open: boolean): void {
    this.preferences.update((prefs) => ({ ...prefs, budgetSidebarOpen: open }));
    this.savePreferences();
  }

  toggleBudgetSidebar(): void {
    this.setBudgetSidebarOpen(!this.budgetSidebarOpen());
  }

  setBankAccountSidebarOpen(open: boolean): void {
    this.preferences.update((prefs) => ({ ...prefs, bankAccountSidebarOpen: open }));
    this.savePreferences();
  }

  toggleBankAccountSidebar(): void {
    this.setBankAccountSidebarOpen(!this.bankAccountSidebarOpen());
  }

  setQuickAssignCollapsed(collapsed: boolean): void {
    this.preferences.update((prefs) => ({ ...prefs, quickAssignCollapsed: collapsed }));
    this.savePreferences();
  }

  toggleQuickAssignCollapsed(): void {
    this.setQuickAssignCollapsed(!this.quickAssignCollapsed());
  }

  setQuickAssignPreference(key: keyof QuickAssignPreferences, value: boolean): void {
    this.preferences.update((prefs) => ({
      ...prefs,
      quickAssignPreferences: {
        ...(prefs.quickAssignPreferences ?? DEFAULT_QUICK_ASSIGN_PREFERENCES),
        [key]: value,
      },
    }));
    this.savePreferences();
  }

  toggleQuickAssignPreference(key: keyof QuickAssignPreferences): void {
    const currentValue = this.quickAssignPreferences()[key];
    this.setQuickAssignPreference(key, !currentValue);
  }

  setQuickAssignAllowNegativeRta(allow: boolean): void {
    this.preferences.update((prefs) => ({
      ...prefs,
      quickAssignAllowNegativeRta: allow || undefined,
    }));
    this.savePreferences();
  }

  toggleQuickAssignAllowNegativeRta(): void {
    this.setQuickAssignAllowNegativeRta(!this.quickAssignAllowNegativeRta());
  }

  setMerchantSortOrder(sortOrder: MerchantSortOrder): void {
    this.preferences.update((prefs) => ({ ...prefs, merchantSortOrder: sortOrder }));
    this.savePreferences();
  }

  setShowCategoryProgressBars(show: boolean): void {
    this.preferences.update((prefs) => ({ ...prefs, showCategoryProgressBars: show }));
    this.savePreferences();
  }

  togglePlannedTransactionsSection(): void {
    this.preferences.update((prefs) => ({
      ...prefs,
      plannedTransactionsSectionOpen: !(prefs.plannedTransactionsSectionOpen ?? true),
    }));
    this.savePreferences();
  }

  getBudgetGroupCollapsedState(groupId: string): boolean {
    const states = this.preferences().budgetGroupCollapsedStates;
    if (!states) return false; // Default to open (not collapsed)
    return states[groupId] ?? false; // Default to open if not in map
  }

  setBudgetGroupCollapsedState(groupId: string, collapsed: boolean): void {
    this.preferences.update((prefs) => {
      const currentStates = prefs.budgetGroupCollapsedStates ?? {};
      const newStates = { ...currentStates };
      if (collapsed) {
        newStates[groupId] = true;
      } else {
        // Remove from map if opening (to keep map clean)
        delete newStates[groupId];
      }
      return {
        ...prefs,
        budgetGroupCollapsedStates: Object.keys(newStates).length > 0 ? newStates : undefined,
      };
    });
    this.savePreferences();
  }

  getBankAccountGroupCollapsedState(groupLabel: string): boolean {
    const states = this.preferences().bankAccountGroupCollapsedStates;
    if (!states) return false; // Default to open (not collapsed)
    return states[groupLabel] ?? false; // Default to open if not in map
  }

  setBankAccountGroupCollapsedState(groupLabel: string, collapsed: boolean): void {
    this.preferences.update((prefs) => {
      const currentStates = prefs.bankAccountGroupCollapsedStates ?? {};
      const newStates = { ...currentStates };
      if (collapsed) {
        newStates[groupLabel] = true;
      } else {
        // Remove from map if opening (to keep map clean)
        delete newStates[groupLabel];
      }
      return {
        ...prefs,
        bankAccountGroupCollapsedStates: Object.keys(newStates).length > 0 ? newStates : undefined,
      };
    });
    this.savePreferences();
  }

  getSidebarBankAccountGroupCollapsedState(groupLabel: string): boolean {
    const states = this.preferences().sidebarBankAccountGroupCollapsedStates;
    if (!states) return false; // Default to open (not collapsed)
    return states[groupLabel] ?? false; // Default to open if not in map
  }

  setSidebarBankAccountGroupCollapsedState(groupLabel: string, collapsed: boolean): void {
    this.preferences.update((prefs) => {
      const currentStates = prefs.sidebarBankAccountGroupCollapsedStates ?? {};
      const newStates = { ...currentStates };
      if (collapsed) {
        newStates[groupLabel] = true;
      } else {
        // Remove from map if opening (to keep map clean)
        delete newStates[groupLabel];
      }
      return {
        ...prefs,
        sidebarBankAccountGroupCollapsedStates: Object.keys(newStates).length > 0 ? newStates : undefined,
      };
    });
    this.savePreferences();
  }

  getSidebarNetWorthCardCollapsed(): boolean {
    return this.preferences().sidebarNetWorthCardCollapsed ?? false;
  }

  setSidebarNetWorthCardCollapsed(collapsed: boolean): void {
    this.preferences.update((prefs) => ({
      ...prefs,
      sidebarNetWorthCardCollapsed: collapsed || undefined,
    }));
    this.savePreferences();
  }

  getClosedAccountsVisibleState(groupLabel: string): boolean {
    const states = this.preferences().closedAccountsVisibleStates;
    if (!states) return false; // Default to hidden
    return states[groupLabel] ?? false;
  }

  setClosedAccountsVisibleState(groupLabel: string, visible: boolean): void {
    this.preferences.update((prefs) => {
      const currentStates = prefs.closedAccountsVisibleStates ?? {};
      const newStates = { ...currentStates };
      if (visible) {
        newStates[groupLabel] = true;
      } else {
        // Remove from map if hiding (to keep map clean)
        delete newStates[groupLabel];
      }
      return {
        ...prefs,
        closedAccountsVisibleStates: Object.keys(newStates).length > 0 ? newStates : undefined,
      };
    });
    this.savePreferences();
  }

  getHiddenCategoriesVisibleState(groupId: string): boolean {
    const states = this.preferences().hiddenCategoriesVisibleStates;
    if (!states) return false; // Default to hidden
    return states[groupId] ?? false;
  }

  setHiddenCategoriesVisibleState(groupId: string, visible: boolean): void {
    this.preferences.update((prefs) => {
      const currentStates = prefs.hiddenCategoriesVisibleStates ?? {};
      const newStates = { ...currentStates };
      if (visible) {
        newStates[groupId] = true;
      } else {
        // Remove from map if hiding (to keep map clean)
        delete newStates[groupId];
      }
      return {
        ...prefs,
        hiddenCategoriesVisibleStates: Object.keys(newStates).length > 0 ? newStates : undefined,
      };
    });
    this.savePreferences();
  }

  private loadPreferences(): UserPreferences {
    const defaultPreferences: UserPreferences = {
      theme: 'system',
    };

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as UserPreferences;
        if (this.isValidPreferences(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      console.warn('Failed to load user preferences, using defaults:', error);
    }

    return defaultPreferences;
  }

  private savePreferences(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.preferences()));
    } catch (error) {
      console.warn('Failed to save user preferences to localStorage:', error);
    }
  }

  private isValidPreferences(prefs: unknown): prefs is UserPreferences {
    if (!prefs || typeof prefs !== 'object') return false;
    const p = prefs as Record<string, unknown>;
    const themeValid = typeof p['theme'] === 'string' && ['light', 'dark', 'system'].includes(p['theme']);
    const budgetCollapsedStatesValid =
      p['budgetGroupCollapsedStates'] === undefined ||
      (typeof p['budgetGroupCollapsedStates'] === 'object' &&
        p['budgetGroupCollapsedStates'] !== null &&
        !Array.isArray(p['budgetGroupCollapsedStates']));
    const budgetSidebarValid = p['budgetSidebarOpen'] === undefined || typeof p['budgetSidebarOpen'] === 'boolean';
    const bankAccountCollapsedStatesValid =
      p['bankAccountGroupCollapsedStates'] === undefined ||
      (typeof p['bankAccountGroupCollapsedStates'] === 'object' &&
        p['bankAccountGroupCollapsedStates'] !== null &&
        !Array.isArray(p['bankAccountGroupCollapsedStates']));
    const bankAccountSidebarValid =
      p['bankAccountSidebarOpen'] === undefined || typeof p['bankAccountSidebarOpen'] === 'boolean';
    const sidebarBankAccountCollapsedStatesValid =
      p['sidebarBankAccountGroupCollapsedStates'] === undefined ||
      (typeof p['sidebarBankAccountGroupCollapsedStates'] === 'object' &&
        p['sidebarBankAccountGroupCollapsedStates'] !== null &&
        !Array.isArray(p['sidebarBankAccountGroupCollapsedStates']));
    const sidebarNetWorthCardCollapsedValid =
      p['sidebarNetWorthCardCollapsed'] === undefined || typeof p['sidebarNetWorthCardCollapsed'] === 'boolean';
    const closedAccountsVisibleValid =
      p['closedAccountsVisibleStates'] === undefined ||
      (typeof p['closedAccountsVisibleStates'] === 'object' &&
        p['closedAccountsVisibleStates'] !== null &&
        !Array.isArray(p['closedAccountsVisibleStates']));
    const hiddenCategoriesVisibleValid =
      p['hiddenCategoriesVisibleStates'] === undefined ||
      (typeof p['hiddenCategoriesVisibleStates'] === 'object' &&
        p['hiddenCategoriesVisibleStates'] !== null &&
        !Array.isArray(p['hiddenCategoriesVisibleStates']));
    const quickAssignCollapsedValid =
      p['quickAssignCollapsed'] === undefined || typeof p['quickAssignCollapsed'] === 'boolean';
    const quickAssignPrefsValid =
      p['quickAssignPreferences'] === undefined ||
      (typeof p['quickAssignPreferences'] === 'object' &&
        p['quickAssignPreferences'] !== null &&
        !Array.isArray(p['quickAssignPreferences']));
    const quickAssignAllowNegativeRtaValid =
      p['quickAssignAllowNegativeRta'] === undefined || typeof p['quickAssignAllowNegativeRta'] === 'boolean';
    const merchantSortOrderValid =
      p['merchantSortOrder'] === undefined ||
      (typeof p['merchantSortOrder'] === 'string' &&
        ['transactionCount', 'totalSpent'].includes(p['merchantSortOrder']));
    const showCategoryProgressBarsValid =
      p['showCategoryProgressBars'] === undefined || typeof p['showCategoryProgressBars'] === 'boolean';
    const plannedTransactionsSectionOpenValid =
      p['plannedTransactionsSectionOpen'] === undefined || typeof p['plannedTransactionsSectionOpen'] === 'boolean';
    return (
      themeValid &&
      budgetCollapsedStatesValid &&
      budgetSidebarValid &&
      bankAccountCollapsedStatesValid &&
      bankAccountSidebarValid &&
      sidebarBankAccountCollapsedStatesValid &&
      sidebarNetWorthCardCollapsedValid &&
      closedAccountsVisibleValid &&
      hiddenCategoriesVisibleValid &&
      quickAssignCollapsedValid &&
      quickAssignPrefsValid &&
      quickAssignAllowNegativeRtaValid &&
      merchantSortOrderValid &&
      showCategoryProgressBarsValid &&
      plannedTransactionsSectionOpenValid
    );
  }
}
