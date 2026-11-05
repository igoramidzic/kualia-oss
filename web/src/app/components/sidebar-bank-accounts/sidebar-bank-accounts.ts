import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCollapsibleImports } from '@spartan-ng/helm/collapsible';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { nucleoChevronDown as ChevronDown, nucleoChevronRight as ChevronRight, NucleoIcon } from '@kualia/icons';
import { filter, map, startWith } from 'rxjs/operators';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { BankAccountService, BankAccountWithRelations } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import { WorkspaceService } from '../../services/workspace.service';
import { AccountTypeCategory, formatAccountTypeCategory } from '../../shared/utils/account-type-utils';
import { DEFAULT_BANK_ACCOUNT_ICON_NAME } from '../../shared/utils/entity-identity';
import { getShortId } from '../../shared/utils/id-utils';
import { EntityMarkComponent } from '../entity-mark/entity-mark.component';

interface BankAccountGroup {
  label: AccountTypeCategory;
  accounts: BankAccountWithRelations[];
}

@Component({
  selector: 'app-sidebar-bank-accounts',
  imports: [RouterLink, HlmButton, NucleoIcon, EntityMarkComponent, ...HlmCollapsibleImports],
  templateUrl: './sidebar-bank-accounts.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarBankAccountsComponent {
  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;
  protected readonly formatAccountTypeCategory = formatAccountTypeCategory;
  protected readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  private readonly bankAccountService = inject(BankAccountService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly userPreferencesService = inject(UserPreferencesService);
  private readonly router = inject(Router);
  private readonly sidebarService = inject(HlmSidebarService);

  readonly bankAccounts = this.bankAccountService.bankAccounts;
  readonly hasBankAccounts = this.bankAccountService.hasAccounts;

  // Track current URL for active state
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  // Group collapse state (loaded from user preferences)
  private readonly groupCollapsedStates = signal<Record<string, boolean>>({});

  // Net worth card expand/collapse state
  readonly netWorthCardExpanded = signal<boolean>(true);

  constructor() {
    // Load initial sidebar group collapse states from preferences
    const preferences = this.userPreferencesService;
    this.groupCollapsedStates.set({
      Banking: preferences.getSidebarBankAccountGroupCollapsedState('Banking'),
      Credit: preferences.getSidebarBankAccountGroupCollapsedState('Credit'),
      Investment: preferences.getSidebarBankAccountGroupCollapsedState('Investment'),
      Loan: preferences.getSidebarBankAccountGroupCollapsedState('Loan'),
    });
    // Load net worth card collapse state
    this.netWorthCardExpanded.set(!preferences.getSidebarNetWorthCardCollapsed());
  }

  // Grouped bank accounts (only non-closed accounts)
  readonly groupedBankAccounts = computed(() => {
    const accounts = this.bankAccounts().filter((a) => !a.isClosed);
    const workspace = this.workspaceService.workspace();
    const savedAccountOrderByGroup = workspace?.bankAccountOrdering?.accountOrderByGroup;

    const groups: Record<AccountTypeCategory, BankAccountWithRelations[]> = {
      Banking: [],
      Credit: [],
      Investment: [],
      Loan: [],
    };

    for (const account of accounts) {
      const category = this.getAccountTypeCategory(account.accountType);
      groups[category].push(account);
    }

    // Sort accounts within each group using saved order if available
    if (savedAccountOrderByGroup) {
      for (const [groupLabel, groupAccounts] of Object.entries(groups)) {
        const savedOrder = savedAccountOrderByGroup[groupLabel];
        if (savedOrder && savedOrder.length > 0) {
          const accountMap = new Map(groupAccounts.map((a) => [a._id, a]));
          const orderedAccounts = savedOrder
            .map((id) => accountMap.get(id as Id<'bankAccount'>))
            .filter((a): a is BankAccountWithRelations => a !== undefined);
          // Add any accounts not in the saved order (newly created accounts)
          groupAccounts.forEach((a) => {
            if (!savedOrder.includes(a._id)) {
              orderedAccounts.push(a);
            }
          });
          groups[groupLabel as AccountTypeCategory] = orderedAccounts;
        }
      }
    }

    // Return groups ordered by saved group order
    const savedGroupOrder = workspace?.bankAccountOrdering?.groupOrder;
    const result: BankAccountGroup[] = [];

    if (savedGroupOrder && savedGroupOrder.length > 0) {
      // Use saved order, including only non-empty groups
      const groupMap = new Map(
        Object.entries(groups)
          .filter((entry) => entry[1].length > 0)
          .map(([label, accts]) => [label, { label: label as AccountTypeCategory, accounts: accts }])
      );

      for (const label of savedGroupOrder) {
        const group = groupMap.get(label);
        if (group) {
          result.push(group);
          groupMap.delete(label);
        }
      }

      // Add any remaining groups not in saved order
      for (const group of groupMap.values()) {
        result.push(group);
      }
    } else {
      // Default order
      for (const [label, accts] of Object.entries(groups)) {
        if (accts.length > 0) {
          result.push({ label: label as AccountTypeCategory, accounts: accts });
        }
      }
    }

    return result;
  });

  // Group totals (only non-closed accounts)
  readonly groupTotals = computed(() => {
    const groups = this.groupedBankAccounts();
    const totals: Record<string, bigint> = {};

    for (const group of groups) {
      let total = 0n;
      for (const account of group.accounts) {
        total += account.currentBalance;
      }
      totals[group.label] = total;
    }

    return totals;
  });

  // Net worth (sum of all non-closed account balances)
  readonly netWorth = computed(() => {
    const accounts = this.bankAccounts().filter((a) => !a.isClosed);
    return accounts.reduce((sum, account) => sum + account.currentBalance, 0n);
  });

  // Total assets (Banking + Investment accounts)
  readonly totalAssets = computed(() => {
    const accounts = this.bankAccounts().filter((a) => !a.isClosed);
    return accounts
      .filter((a) => a.accountType.startsWith('banking_') || a.accountType.startsWith('investment_'))
      .reduce((sum, a) => sum + a.currentBalance, 0n);
  });

  // Total liabilities (Credit + Loan accounts - already stored as negative values)
  readonly totalLiabilities = computed(() => {
    const accounts = this.bankAccounts().filter((a) => !a.isClosed);
    return accounts
      .filter((a) => a.accountType.startsWith('credit_') || a.accountType.startsWith('loan_'))
      .reduce((sum, a) => sum + a.currentBalance, 0n);
  });

  private getAccountTypeCategory(accountType: string): AccountTypeCategory {
    if (accountType.startsWith('banking_')) return 'Banking';
    if (accountType.startsWith('credit_')) return 'Credit';
    if (accountType.startsWith('investment_')) return 'Investment';
    if (accountType.startsWith('loan_')) return 'Loan';
    return 'Banking'; // default fallback
  }

  isGroupExpanded(groupLabel: string): boolean {
    const states = this.groupCollapsedStates();
    return !(states[groupLabel] ?? false); // Default to expanded
  }

  onGroupExpandedChange(groupLabel: string, expanded: boolean): void {
    const collapsed = !expanded;
    this.groupCollapsedStates.update((states) => {
      const newStates = { ...states };
      newStates[groupLabel] = collapsed;
      return newStates;
    });
    this.userPreferencesService.setSidebarBankAccountGroupCollapsedState(groupLabel, collapsed);
  }

  onNetWorthCardExpandedChange(expanded: boolean): void {
    this.netWorthCardExpanded.set(expanded);
    this.userPreferencesService.setSidebarNetWorthCardCollapsed(!expanded);
  }

  getBankAccountUrl(account: BankAccountWithRelations): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    const slug = this.generateSlug(account.name, account._id);
    return ['/', workspaceShortId, 'bank-accounts', slug];
  }

  private generateSlug(name: string, id: string): string {
    const nameSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
    const last8 = id.slice(-8);
    return `${nameSlug}-${last8}`;
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  isAccountActive(account: BankAccountWithRelations): boolean {
    const currentUrl = this.currentUrl();
    const currentPath = currentUrl.split('?')[0].split('#')[0];
    const pathSegments = currentPath.split('/').filter(Boolean);
    const bankAccountsIndex = pathSegments.indexOf('bank-accounts');
    const workspaceShortId = this.workspaceService.workspaceShortId();

    if (bankAccountsIndex < 1 || !workspaceShortId || pathSegments[bankAccountsIndex - 1] !== workspaceShortId) {
      return false;
    }

    const accountRouteSegment = pathSegments[bankAccountsIndex + 1];
    const routeShortId = accountRouteSegment?.split('-').at(-1);
    return routeShortId === getShortId(account._id);
  }

  handleAccountClick(): void {
    this.sidebarService.setOpenMobile(false);
  }
}
