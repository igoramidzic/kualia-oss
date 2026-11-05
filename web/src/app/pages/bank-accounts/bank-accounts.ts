import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCollapsibleImports } from '@spartan-ng/helm/collapsible';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import {
  nucleoChevronDown as ChevronDown,
  nucleoChevronRight as ChevronRight,
  nucleoEye as Eye,
  nucleoEyeOff as EyeOff,
  nucleoHeart as Heart,
  nucleoCreditCard as CreditCard,
  nucleoHouse as House,
  nucleoLayers as Layers,
  nucleoTrendUp as TrendingUp,
  NucleoIcon,
  nucleoPlus as Plus,
  nucleoBank as Wallet,
} from '@kualia/icons';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { BankLinkStatusBadgeComponent } from '../../components/bank_account/bank-link-status-badge';
import { ClosedAccountBadgeComponent } from '../../components/bank_account/closed-account-badge';
import { LastSyncedBadgeComponent } from '../../components/bank_account/last-synced-badge';
import {
  type FilterConfig,
  ResponsiveFilterRowComponent,
} from '../../components/budget/responsive-filter-row.component';
import { CreateBankAccountDialogOrchestratorComponent } from '../../components/dialogs/create-bank-account-dialog/create-bank-account-dialog-orchestrator';
import { EntityMarkComponent } from '../../components/entity-mark/entity-mark.component';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { DragGapDirective } from '../../directives/drag-gap.directive';
import type { DragData } from '../../directives/drag-source.directive';
import { DragSourceDirective } from '../../directives/drag-source.directive';
import { DropEvent, DropTargetDirective } from '../../directives/drop-target.directive';
import { BankAccountService, BankAccountWithRelations } from '../../services/bank-account.service';
import { ConvexService } from '../../services/convex.service';
import { CurrencyService } from '../../services/currency.service';
import { DragContextService } from '../../services/drag-context.service';
import { NavigationService } from '../../services/navigation.service';
import { WorkspaceService } from '../../services/workspace.service';
import { AccountTypeCategory, formatAccountTypeCategory } from '../../shared/utils/account-type-utils';
import { DEFAULT_BANK_ACCOUNT_ICON_NAME } from '../../shared/utils/entity-identity';
import { HlmContextMenuImports } from '../../ui/context-menu/src';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';
import type { AccountsNetWorthReport } from './account-balance-chart';
import { NetWorthChartComponent } from './net-worth-chart';

interface BankAccountGroup {
  label: AccountTypeCategory;
  accounts: BankAccountWithRelations[];
}

const ACCOUNT_TYPE_FILTERS = [
  { id: 'cash', label: 'Cash', category: 'Banking', icon: Wallet },
  { id: 'credit', label: 'Credit', category: 'Credit', icon: CreditCard },
  { id: 'investments', label: 'Investments', category: 'Investment', icon: TrendingUp },
  { id: 'loans', label: 'Loans', category: 'Loan', icon: House },
] as const;

interface BankAccountGroupWithSeparation {
  label: AccountTypeCategory;
  accounts: BankAccountWithRelations[];
  openAccounts: BankAccountWithRelations[];
  closedAccounts: BankAccountWithRelations[];
  closedCount: number;
}

@Component({
  selector: 'app-bank-accounts',
  imports: [
    RouterLink,
    NucleoIcon,
    HlmButton,
    EntityMarkComponent,
    BankLinkStatusBadgeComponent,
    ClosedAccountBadgeComponent,
    LastSyncedBadgeComponent,
    SidebarToggleComponent,
    NetWorthChartComponent,
    ResponsiveFilterRowComponent,
    DragSourceDirective,
    DropTargetDirective,
    DragGapDirective,
    ...HlmContextMenuImports,
    ...HlmDropdownMenuImports,
    ...HlmCollapsibleImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bank-accounts.html',
})
export class BankAccountsComponent {
  private readonly favoriteFilterStoragePrefix = 'kualia:bank-accounts:favorite-only';
  protected readonly Wallet = Wallet;
  protected readonly Plus = Plus;
  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Eye = Eye;
  protected readonly EyeOff = EyeOff;
  protected readonly Heart = Heart;
  protected readonly formatAccountTypeCategory = formatAccountTypeCategory;
  protected readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  private readonly bankAccountConvex = inject(BankAccountService);
  private readonly currencyService = inject(CurrencyService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly navigationService = inject(NavigationService);
  private readonly userPreferencesService = inject(UserPreferencesService);
  private readonly convex = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly dragContext = inject(DragContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly queryParams = toSignal(inject(ActivatedRoute).queryParamMap);

  readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');
  private autoScrollCleanup: (() => void) | null = null;

  readonly bankAccounts = this.bankAccountConvex.bankAccounts;
  readonly sortedBankAccounts = computed(() =>
    [...this.bankAccounts()].sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    })
  );
  readonly favoriteOnly = signal(false);
  readonly favoriteCount = computed(() => this.bankAccounts().filter((account) => account.isFavorite).length);
  readonly activeAccountType = computed(() => {
    const filter = ACCOUNT_TYPE_FILTERS.find((entry) => entry.id === this.queryParams()?.get('filter'));
    return filter &&
      this.bankAccounts().some((account) => this.getAccountTypeCategory(account.accountType) === filter.category)
      ? filter.category
      : 'all';
  });
  readonly typeFilteredBankAccounts = computed(() =>
    this.sortedBankAccounts().filter(
      (account) =>
        this.activeAccountType() === 'all' ||
        this.getAccountTypeCategory(account.accountType) === this.activeAccountType()
    )
  );
  readonly displayedBankAccounts = computed(() =>
    this.favoriteOnly()
      ? this.typeFilteredBankAccounts().filter((account) => account.isFavorite)
      : this.typeFilteredBankAccounts()
  );
  readonly responsiveFilters = computed<FilterConfig[]>(() => [
    {
      id: 'all',
      label: 'All',
      icon: Layers,
      queryParams: {},
      isActive: this.activeAccountType() === 'all',
      count: this.bankAccounts().length,
      showCount: true,
    },
    ...ACCOUNT_TYPE_FILTERS.map((filter) => {
      const count = this.bankAccounts().filter(
        (account) => this.getAccountTypeCategory(account.accountType) === filter.category
      ).length;
      return {
        id: filter.id,
        label: filter.label,
        icon: filter.icon,
        queryParams: { filter: filter.id },
        isActive: this.activeAccountType() === filter.category,
        isVisible: count > 0,
        count,
        showCount: true,
      };
    }),
  ]);
  readonly hasBankAccounts = this.bankAccountConvex.hasAccounts;
  readonly loading = this.bankAccountConvex.loading;
  readonly error = this.bankAccountConvex.error;

  readonly currentMonth = (() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  })();
  readonly netWorthReport = signal<AccountsNetWorthReport | undefined>(undefined);
  readonly historyLoading = signal(false);
  readonly historyError = signal(false);

  // Group collapse state
  private readonly groupCollapsedStates = signal<Record<string, boolean>>({});

  // Closed accounts visibility state
  private readonly closedAccountsVisibleStates = signal<Record<string, boolean>>({});

  // Drag state
  readonly isDraggingGroup = signal<boolean>(false);

  // Optimistic state for reordering
  private readonly optimisticGroupOrder = signal<string[] | null>(null);
  private readonly optimisticAccountOrderByGroup = signal<Record<string, string[]> | null>(null);

  // Grouped bank accounts
  readonly groupedBankAccounts = computed(() => {
    const accounts = this.displayedBankAccounts();
    const workspace = this.workspaceService.workspace();
    // Use optimistic state if available, otherwise fall back to saved state
    const savedAccountOrderByGroup =
      this.optimisticAccountOrderByGroup() ?? workspace?.bankAccountOrdering?.accountOrderByGroup;

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
          // Create a map for quick lookup
          const accountMap = new Map(groupAccounts.map((a) => [a._id, a]));
          // Reorder based on saved order
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

    // Return only non-empty groups
    const result: BankAccountGroup[] = [];
    for (const [label, accounts] of Object.entries(groups)) {
      if (accounts.length > 0) {
        result.push({ label: label as AccountTypeCategory, accounts });
      }
    }
    return result;
  });

  // Grouped bank accounts with open/closed separation
  readonly groupedBankAccountsWithSeparation = computed((): BankAccountGroupWithSeparation[] => {
    const groups = this.groupedBankAccounts();
    const workspace = this.workspaceService.workspace();
    // Use optimistic state if available, otherwise fall back to saved state
    const savedGroupOrder = this.optimisticGroupOrder() ?? workspace?.bankAccountOrdering?.groupOrder;

    // If we have a saved group order, reorder the groups
    let orderedGroups = groups;
    if (savedGroupOrder && savedGroupOrder.length > 0) {
      // Create a map for quick lookup
      const groupMap = new Map(groups.map((g) => [g.label, g]));
      // Reorder based on saved order, including only groups that exist
      orderedGroups = savedGroupOrder
        .map((label) => groupMap.get(label as AccountTypeCategory))
        .filter((g): g is BankAccountGroup => g !== undefined);
      // Add any groups that aren't in the saved order (shouldn't happen, but safe)
      groups.forEach((g) => {
        if (!savedGroupOrder.includes(g.label)) {
          orderedGroups.push(g);
        }
      });
    }

    return orderedGroups.map((group) => ({
      label: group.label,
      accounts: group.accounts,
      openAccounts: group.accounts.filter((a) => !a.isClosed),
      closedAccounts: group.accounts.filter((a) => a.isClosed),
      closedCount: group.accounts.filter((a) => a.isClosed).length,
    }));
  });

  // Group totals
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

  constructor() {
    effect((onCleanup) => {
      const workspaceId = this.workspaceService.workspaceId();
      const authenticated = this.convex.isAuthenticated();
      this.netWorthReport.set(undefined);
      this.historyError.set(false);
      this.historyLoading.set(authenticated && !!workspaceId);
      if (!workspaceId || !authenticated) return;

      const unsubscribe = this.convex.getClient().onUpdate(
        api.reports.getNetWorthReport,
        { workspaceId: workspaceId as Id<'workspace'>, currentYearMonth: BigInt(this.currentMonth.replace('-', '')) },
        (report) => {
          this.netWorthReport.set(report);
          this.historyLoading.set(false);
          this.historyError.set(false);
        },
        () => {
          this.netWorthReport.set(undefined);
          this.historyLoading.set(false);
          this.historyError.set(true);
        }
      );
      onCleanup(unsubscribe);
    });

    afterNextRender(() => {
      this.restoreFavoriteFilter();

      // Set up auto-scroll for drag-and-drop
      this.setupAutoScroll();

      // Set up global drop monitor as a fallback for edge cases
      // With getIsSticky enabled on drop targets, they handle their own drops directly
      monitorForElements({
        onDrop: ({ source, location }) => {
          // If there are drop targets, the directive's onDrop handler already processed this
          if (location.current.dropTargets.length > 0) {
            return;
          }

          // Fallback: use last known drop target (shouldn't normally reach here with sticky enabled)
          const sourceData = source.data as DragData;
          const lastDropTarget = this.dragContext.lastDropTargetData();

          // Use the last known drop target from the drag context
          if (lastDropTarget && sourceData.type === 'account') {
            const groupLabel = lastDropTarget['groupLabel'] as AccountTypeCategory | undefined;
            if (groupLabel && sourceData.groupLabel === groupLabel) {
              void this.handleAccountDrop(sourceData, lastDropTarget);
            }
          } else if (lastDropTarget && sourceData.type === 'group') {
            void this.handleGroupDrop(sourceData, lastDropTarget);
          }
        },
      });
    });

    // Clean up auto-scroll on destroy
    this.destroyRef.onDestroy(() => {
      this.autoScrollCleanup?.();
    });

    // Load initial group collapse states from preferences
    const preferences = this.userPreferencesService;
    this.groupCollapsedStates.set({
      Banking: preferences.getBankAccountGroupCollapsedState('Banking'),
      Credit: preferences.getBankAccountGroupCollapsedState('Credit'),
      Investment: preferences.getBankAccountGroupCollapsedState('Investment'),
      Loan: preferences.getBankAccountGroupCollapsedState('Loan'),
    });

    // Load initial closed accounts visibility states from preferences
    this.closedAccountsVisibleStates.set({
      Banking: preferences.getClosedAccountsVisibleState('Banking'),
      Credit: preferences.getClosedAccountsVisibleState('Credit'),
      Investment: preferences.getClosedAccountsVisibleState('Investment'),
      Loan: preferences.getClosedAccountsVisibleState('Loan'),
    });
  }

  private getAccountTypeCategory(accountType: string): AccountTypeCategory {
    if (accountType.startsWith('banking_')) return 'Banking';
    if (accountType.startsWith('credit_')) return 'Credit';
    if (accountType.startsWith('investment_')) return 'Investment';
    if (accountType.startsWith('loan_')) return 'Loan';
    return 'Banking'; // default fallback
  }

  /**
   * Set up auto-scroll for drag-and-drop operations.
   * This enables automatic scrolling when dragging items near the edges of the scroll container.
   */
  private setupAutoScroll(): void {
    const container = this.scrollContainer()?.nativeElement;
    if (!container) return;

    this.autoScrollCleanup = autoScrollForElements({
      element: container,
      getConfiguration: () => ({
        maxScrollSpeed: 'standard',
      }),
    });
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
    this.userPreferencesService.setBankAccountGroupCollapsedState(groupLabel, collapsed);
  }

  isClosedAccountsVisible(groupLabel: string): boolean {
    const states = this.closedAccountsVisibleStates();
    return states[groupLabel] ?? false; // Default to hidden
  }

  onClosedAccountsExpandedChange(groupLabel: string, expanded: boolean): void {
    this.closedAccountsVisibleStates.update((states) => {
      const newStates = { ...states };
      if (expanded) {
        newStates[groupLabel] = true;
      } else {
        delete newStates[groupLabel]; // Keep map clean
      }
      return newStates;
    });
    this.userPreferencesService.setClosedAccountsVisibleState(groupLabel, expanded);
  }

  openCreateBankAccountDialog() {
    const dialogRef = this.dialogService.open(CreateBankAccountDialogOrchestratorComponent, {
      context: {},
      contentClass: 'max-w-full sm:w-md',
    });

    dialogRef.closed$.subscribe(() => {
      // Item is already added to the store by the service
    });
  }

  navigateToBankAccount(account: BankAccountWithRelations) {
    const slug = this.generateSlug(account.name, account._id);
    void this.navigationService.navigateToBankAccount(slug);
  }

  getBankAccountUrl(account: BankAccountWithRelations): string[] {
    const slug = this.generateSlug(account.name, account._id);
    return [slug];
  }

  getInstitutionLogo(account: BankAccountWithRelations): string | null {
    return account.bankLinkAccount?.bankLink.institution.logoUrl ?? null;
  }

  getInstitutionName(account: BankAccountWithRelations): string | null {
    return account.bankLinkAccount?.bankLink.institution.name ?? null;
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

  formatDate(dateString: string | null): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    return date.toLocaleDateString('en-US', options);
  }

  formatCurrency(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  retryLoad() {
    this.bankAccountConvex.refresh();
  }

  toggleFavoriteFilter(): void {
    if (this.favoriteCount() === 0) return;
    this.setFavoriteFilter(!this.favoriteOnly());
  }

  isBankAccountFavorite(bankAccountId: Id<'bankAccount'>): boolean {
    return this.bankAccounts().find((account) => account._id === bankAccountId)?.isFavorite ?? false;
  }

  async onToggleAccountFavorite(bankAccountId: Id<'bankAccount'>, event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    const wasFavorite = this.isBankAccountFavorite(bankAccountId);
    const success = await this.bankAccountConvex.setBankAccountFavorite(bankAccountId, !wasFavorite);

    if (success && wasFavorite && this.favoriteOnly() && this.favoriteCount() <= 1) {
      this.setFavoriteFilter(false);
    }
  }

  private restoreFavoriteFilter(): void {
    const key = this.favoriteFilterStorageKey();
    if (key) {
      this.favoriteOnly.set(localStorage.getItem(key) === 'true');
    }
  }

  private setFavoriteFilter(active: boolean): void {
    this.favoriteOnly.set(active);
    const key = this.favoriteFilterStorageKey();
    if (key) {
      localStorage.setItem(key, String(active));
    }
  }

  private favoriteFilterStorageKey(): string | null {
    const workspaceId = this.workspaceService.workspaceId();
    return workspaceId ? `${this.favoriteFilterStoragePrefix}:${workspaceId}` : null;
  }

  // Drag-drop handlers for group reordering

  /** Called when group drag starts - collapses all groups */
  onGroupDragStart(): void {
    this.isDraggingGroup.set(true);
  }

  /** Called when group drag ends */
  onGroupDragEnd(): void {
    this.isDraggingGroup.set(false);
  }

  /** Called when a group is dropped on another group */
  async onGroupDropped(event: DropEvent): Promise<void> {
    if (event.source.type !== 'group' || event.target.type !== 'group') return;

    const groups = this.groupedBankAccountsWithSeparation();
    const sourceIndex = event.source.index;
    let targetIndex = event.target.index ?? 0;

    // Adjust target index based on edge position
    if (event.closestEdge === 'bottom') {
      targetIndex = targetIndex + 1;
    }
    // If dragging from before to after, account for the removed item
    if (sourceIndex < targetIndex) {
      targetIndex = targetIndex - 1;
    }

    if (sourceIndex === targetIndex) return;

    // Reorder using Pragmatic DnD utility
    const groupOrder = reorder({
      list: groups.map((g) => g.label),
      startIndex: sourceIndex,
      finishIndex: targetIndex,
    });

    // Set optimistic state immediately
    this.optimisticGroupOrder.set(groupOrder);

    // Save to backend
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.optimisticGroupOrder.set(null);
      return;
    }

    try {
      await this.convex.mutation(api.workspaces.updateBankAccountGroupOrder, {
        workspaceId: workspaceId as Id<'workspace'>,
        groupOrder,
      });
    } catch (error) {
      console.error('Failed to save bank account group order:', error);
      // Optimistic state will be cleared in finally, causing UI to revert to server state
    } finally {
      // Clear optimistic state after mutation completes
      setTimeout(() => {
        this.optimisticGroupOrder.set(null);
      }, 100);
    }
  }

  /** Called when an account is dropped on another account within the same group */
  async onAccountDropped(event: DropEvent, groupLabel: AccountTypeCategory): Promise<void> {
    // Only handle account drops within the same group
    if (event.source.type !== 'account' || event.source.groupLabel !== groupLabel) {
      return;
    }

    const group = this.groupedBankAccountsWithSeparation().find((g) => g.label === groupLabel);
    if (!group) {
      return;
    }

    const sourceIndex = event.source.index;
    let targetIndex = event.target.index ?? 0;

    // Adjust target index based on edge position
    if (event.closestEdge === 'bottom') {
      targetIndex = targetIndex + 1;
    }
    // If dragging from before to after, account for the removed item
    if (sourceIndex < targetIndex) {
      targetIndex = targetIndex - 1;
    }

    if (sourceIndex === targetIndex) {
      return;
    }

    // Reorder using Pragmatic DnD utility for the changed group
    const reorderedOpenAccountIds = reorder({
      list: group.openAccounts.map((a) => a._id),
      startIndex: sourceIndex,
      finishIndex: targetIndex,
    });
    // Include closed accounts at the end to ensure all accounts are in the saved order
    const reorderedGroupAccountIds = [...reorderedOpenAccountIds, ...group.closedAccounts.map((a) => a._id)];

    // Build complete accountOrderByGroup for ALL groups
    const allGroups = this.groupedBankAccountsWithSeparation();
    const accountOrderByGroup: Record<string, string[]> = {};
    for (const g of allGroups) {
      if (g.label === groupLabel) {
        // Use the reordered list for the group being edited
        accountOrderByGroup[g.label] = reorderedGroupAccountIds;
      } else {
        // Include all accounts (open + closed) for other groups
        accountOrderByGroup[g.label] = [...g.openAccounts.map((a) => a._id), ...g.closedAccounts.map((a) => a._id)];
      }
    }

    // Set optimistic state immediately
    this.optimisticAccountOrderByGroup.set(accountOrderByGroup);

    // Save to backend
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.optimisticAccountOrderByGroup.set(null);
      return;
    }

    try {
      await this.convex.mutation(api.workspaces.updateBankAccountOrderAllGroups, {
        workspaceId: workspaceId as Id<'workspace'>,
        accountOrderByGroup: accountOrderByGroup as Record<string, Id<'bankAccount'>[]>,
      });
    } catch (error) {
      console.error('Failed to save bank account order:', error);
      // Optimistic state will be cleared in finally, causing UI to revert to server state
    } finally {
      // Clear optimistic state after mutation completes
      setTimeout(() => {
        this.optimisticAccountOrderByGroup.set(null);
      }, 100);
    }
  }

  /**
   * Handle account drop via the global monitor.
   * This is called when the drop happens even if cursor left the target during gap animation.
   */
  private async handleAccountDrop(sourceData: DragData, dropTargetData: Record<string, unknown>): Promise<void> {
    const groupLabel = dropTargetData['groupLabel'] as AccountTypeCategory;
    const targetIndex = dropTargetData['index'] as number;
    const closestEdge = dropTargetData['closestEdge'] as 'top' | 'bottom' | null;

    const group = this.groupedBankAccountsWithSeparation().find((g) => g.label === groupLabel);
    if (!group) {
      return;
    }

    const sourceIndex = sourceData.index;
    let finalTargetIndex = targetIndex;

    // Adjust target index based on edge position
    if (closestEdge === 'bottom') {
      finalTargetIndex = finalTargetIndex + 1;
    }
    // If dragging from before to after, account for the removed item
    if (sourceIndex < finalTargetIndex) {
      finalTargetIndex = finalTargetIndex - 1;
    }

    if (sourceIndex === finalTargetIndex) {
      return;
    }

    // Reorder using Pragmatic DnD utility for the changed group
    const reorderedOpenAccountIds = reorder({
      list: group.openAccounts.map((a) => a._id),
      startIndex: sourceIndex,
      finishIndex: finalTargetIndex,
    });
    // Include closed accounts at the end to ensure all accounts are in the saved order
    const reorderedGroupAccountIds = [...reorderedOpenAccountIds, ...group.closedAccounts.map((a) => a._id)];

    // Build complete accountOrderByGroup for ALL groups
    const allGroups = this.groupedBankAccountsWithSeparation();
    const accountOrderByGroup: Record<string, string[]> = {};
    for (const g of allGroups) {
      if (g.label === groupLabel) {
        // Use the reordered list for the group being edited
        accountOrderByGroup[g.label] = reorderedGroupAccountIds;
      } else {
        // Include all accounts (open + closed) for other groups
        accountOrderByGroup[g.label] = [...g.openAccounts.map((a) => a._id), ...g.closedAccounts.map((a) => a._id)];
      }
    }

    // Set optimistic state immediately
    this.optimisticAccountOrderByGroup.set(accountOrderByGroup);

    // Save to backend
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.optimisticAccountOrderByGroup.set(null);
      return;
    }

    try {
      await this.convex.mutation(api.workspaces.updateBankAccountOrderAllGroups, {
        workspaceId: workspaceId as Id<'workspace'>,
        accountOrderByGroup: accountOrderByGroup as Record<string, Id<'bankAccount'>[]>,
      });
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setTimeout(() => {
        this.optimisticAccountOrderByGroup.set(null);
      }, 100);
    }
  }

  /**
   * Handle group drop via the global monitor.
   */
  private async handleGroupDrop(sourceData: DragData, dropTargetData: Record<string, unknown>): Promise<void> {
    const targetIndex = dropTargetData['index'] as number;
    const closestEdge = dropTargetData['closestEdge'] as 'top' | 'bottom' | null;

    const groups = this.groupedBankAccountsWithSeparation();
    const sourceIndex = sourceData.index;
    let finalTargetIndex = targetIndex;

    // Adjust target index based on edge position
    if (closestEdge === 'bottom') {
      finalTargetIndex = finalTargetIndex + 1;
    }
    // If dragging from before to after, account for the removed item
    if (sourceIndex < finalTargetIndex) {
      finalTargetIndex = finalTargetIndex - 1;
    }

    if (sourceIndex === finalTargetIndex) {
      return;
    }

    // Reorder using Pragmatic DnD utility
    const groupOrder = reorder({
      list: groups.map((g) => g.label),
      startIndex: sourceIndex,
      finishIndex: finalTargetIndex,
    });

    // Set optimistic state immediately
    this.optimisticGroupOrder.set(groupOrder);

    // Save to backend
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      this.optimisticGroupOrder.set(null);
      return;
    }

    try {
      await this.convex.mutation(api.workspaces.updateBankAccountGroupOrder, {
        workspaceId: workspaceId as Id<'workspace'>,
        groupOrder,
      });
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setTimeout(() => {
        this.optimisticGroupOrder.set(null);
      }, 100);
    }
  }
}
