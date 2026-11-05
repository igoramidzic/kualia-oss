import { DatePipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmCard } from '@spartan-ng/helm/card';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoEmail as Box,
  nucleoChevronDown as ChevronDown,
  nucleoHistory as History,
  nucleoBank as Landmark,
  nucleoLink as Link,
  NucleoIcon,
  type NucleoIconData,
  nucleoShop as Store,
} from '@kualia/icons';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { InfiniteScrollDirective } from '../../../directives/infinite-scroll.directive';
import { ConvexService } from '../../../services/convex.service';
import { NavigationService } from '../../../services/navigation.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { formatAccountType } from '../../../shared/utils/account-type-utils';
import { formatDateForDisplay } from '../../../shared/utils/date-utils';
import { formatCurrency, formatMonth } from '../../../shared/utils/formatters';

type ActivityPage = FunctionReturnType<typeof api.activityLogs.listActivity>;
type ActivityEntry = ActivityPage['page'][number];
type ActivityDetails = ActivityEntry['details'];
type TransactionDetails = Extract<ActivityDetails, { kind: 'transaction' }>;
type TransactionSnapshot = NonNullable<TransactionDetails['after']>;
type BankAccountDetails = Extract<ActivityDetails, { kind: 'bank_account' }>;
type BankAccountSnapshot = NonNullable<BankAccountDetails['after']>;
type CategoryDetails = Extract<ActivityDetails, { kind: 'category' }>;
type CategorySnapshot = NonNullable<CategoryDetails['after']>;
type MerchantDetails = Extract<ActivityDetails, { kind: 'merchant' }>;
type MerchantSnapshot = NonNullable<MerchantDetails['after']>;
type MoneyMovementDetails = Extract<ActivityDetails, { kind: 'money_movement' }>;
type MoneyLocation = MoneyMovementDetails['movements'][number]['from'];
type BankConnectionDetails = Extract<ActivityDetails, { kind: 'bank_connection' }>;

interface SnapshotChange {
  label: string;
  before: string;
  after: string;
}

interface ActivityGroup {
  date: Date;
  dateKey: string;
  entries: ActivityEntry[];
}

const PAGE_SIZE = 50;
const COLLAPSED_ACTIVITY_HEIGHT = 144;

interface ActivityMeasurement {
  height: number;
  overflows: boolean;
}

@Directive({
  selector: '[appActivityOverflow]',
})
export class ActivityOverflowDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private resizeObserver?: ResizeObserver;

  readonly measured = output<ActivityMeasurement>();

  private readonly handleWindowResize = (): void => {
    this.measure();
  };

  ngAfterViewInit(): void {
    queueMicrotask(() => this.measure());
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize);
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this.elementRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
    }
    this.resizeObserver?.disconnect();
  }

  private measure(): void {
    const height = this.elementRef.nativeElement.scrollHeight;
    this.measured.emit({
      height,
      overflows: height > COLLAPSED_ACTIVITY_HEIGHT,
    });
  }
}

@Component({
  selector: 'app-activity',
  imports: [
    DatePipe,
    ActivityOverflowDirective,
    HlmBadge,
    HlmCard,
    InfiniteScrollDirective,
    NucleoIcon,
    RouterLink,
    SettingsPageHeaderComponent,
  ],
  templateUrl: './activity.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class ActivityComponent {
  private readonly convexService = inject(ConvexService);
  private readonly navigationService = inject(NavigationService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly History = History;
  protected readonly ChevronDown = ChevronDown;
  protected readonly entries = signal<ActivityEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly cursor = signal<string | null>(null);
  private readonly isDone = signal(false);
  private readonly expandedEntryIds = signal<ReadonlySet<string>>(new Set());
  private readonly activityMeasurements = signal<ReadonlyMap<string, ActivityMeasurement>>(new Map());
  private watchedWorkspaceId: Id<'workspace'> | null = null;
  private activitySubscription?: () => void;
  private initialRequest = 0;

  protected readonly hasMore = computed(() => !this.isDone() && this.cursor() !== null);
  protected readonly activityGroups = computed<ActivityGroup[]>(() => {
    const groups: ActivityGroup[] = [];
    const groupsByDate = new Map<string, ActivityGroup>();

    for (const entry of this.entries()) {
      const date = new Date(entry.occurredAt);
      const dateKey = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
      const existingGroup = groupsByDate.get(dateKey);

      if (existingGroup) {
        existingGroup.entries.push(entry);
      } else {
        const group = { date, dateKey, entries: [entry] };
        groupsByDate.set(dateKey, group);
        groups.push(group);
      }
    }

    return groups;
  });
  protected readonly formatCurrency = formatCurrency;
  protected readonly formatAccountType = formatAccountType;
  protected readonly formatDateForDisplay = formatDateForDisplay;

  protected isActivityOverflowing(entryId: string): boolean {
    return this.activityMeasurements().get(entryId)?.overflows ?? false;
  }

  protected isActivityExpanded(entryId: string): boolean {
    return this.expandedEntryIds().has(entryId);
  }

  protected activityMaxHeight(entryId: string): number {
    if (!this.isActivityExpanded(entryId)) {
      return COLLAPSED_ACTIVITY_HEIGHT;
    }

    return this.activityMeasurements().get(entryId)?.height ?? COLLAPSED_ACTIVITY_HEIGHT;
  }

  protected activityEntityRoute(entry: ActivityEntry): string[] | null {
    if (entry.entityType === 'transaction' && entry.type !== 'transaction_deleted') {
      return this.navigationService.getTransactionRoute(entry.entityId);
    }

    if (entry.entityType === 'bank_account' && entry.type !== 'bank_account_deleted') {
      return this.navigationService.getBankAccountRoute(entry.entityId);
    }

    if (entry.entityType === 'merchant' && entry.type !== 'merchant_deleted') {
      const merchantId = entry.details.kind === 'merchant' ? (entry.details.mergeTarget?.id ?? entry.entityId) : null;
      return merchantId ? this.navigationService.getMerchantRoute(merchantId) : null;
    }

    return null;
  }

  protected activityEntityLinkLabel(entry: ActivityEntry): string {
    switch (entry.entityType) {
      case 'transaction':
        return 'View transaction';
      case 'bank_account':
        return 'View account';
      case 'merchant':
        return 'View merchant';
      default:
        return 'View details';
    }
  }

  protected updateActivityMeasurement(entryId: string, measurement: ActivityMeasurement): void {
    const current = this.activityMeasurements().get(entryId);
    if (current?.height === measurement.height && current.overflows === measurement.overflows) {
      return;
    }

    this.activityMeasurements.update((measurements) => {
      const next = new Map(measurements);
      next.set(entryId, measurement);
      return next;
    });

    if (!measurement.overflows && this.isActivityExpanded(entryId)) {
      this.expandedEntryIds.update((entryIds) => {
        const next = new Set(entryIds);
        next.delete(entryId);
        return next;
      });
    }
  }

  protected toggleActivity(entryId: string): void {
    if (!this.isActivityOverflowing(entryId)) {
      return;
    }

    this.expandedEntryIds.update((entryIds) => {
      const next = new Set(entryIds);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  constructor() {
    effect(() => {
      const workspaceId = this.workspaceService.workspaceId() as Id<'workspace'> | null;
      if (!workspaceId) {
        this.watchedWorkspaceId = null;
        this.reset();
        this.loading.set(false);
        return;
      }

      if (workspaceId === this.watchedWorkspaceId) {
        return;
      }

      this.watchedWorkspaceId = workspaceId;
      void this.loadInitial(workspaceId);
    });

    this.destroyRef.onDestroy(() => {
      this.initialRequest += 1;
      this.stopWatching();
    });
  }

  async loadMore(): Promise<void> {
    const workspaceId = this.workspaceService.workspaceId() as Id<'workspace'> | null;
    const cursor = this.cursor();
    if (!workspaceId || !cursor || this.loadingMore() || this.isDone()) {
      return;
    }

    this.loadingMore.set(true);
    this.error.set(null);

    try {
      const result = await this.convexService.getClient().query(api.activityLogs.listActivity, {
        workspaceId,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      });

      if (this.workspaceService.workspaceId() !== workspaceId) {
        return;
      }

      const entriesById = new Map(this.entries().map((entry) => [entry._id, entry]));
      for (const entry of result.page) {
        entriesById.set(entry._id, entry);
      }

      this.entries.set(Array.from(entriesById.values()));
      this.cursor.set(result.continueCursor);
      this.isDone.set(result.isDone);
      this.startWatching(workspaceId);
    } catch (error: unknown) {
      console.error('Failed to load more activity:', error);
      this.error.set('Failed to load more activity. Please try again.');
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected entryIcon(entityType: ActivityEntry['entityType']): NucleoIconData {
    switch (entityType) {
      case 'transaction':
        return ArrowLeftRight;
      case 'bank_account':
        return Landmark;
      case 'category':
        return Box;
      case 'merchant':
        return Store;
      case 'budget_assignment':
        return Box;
      case 'bank_connection':
        return Link;
    }
  }

  protected actorLabel(entry: ActivityEntry): string {
    const name = entry.actor.name?.trim();
    if (name) return name;

    const email = entry.actor.email?.trim();
    if (email) return email;

    return entry.actor.clerkId === 'system' ? 'Kualia' : entry.actor.clerkId;
  }

  protected sourceLabel(source: ActivityEntry['source']): string {
    switch (source.type) {
      case 'kualia_ui':
        return 'Kualia UI';
      case 'public_api':
        return 'Public API';
      case 'mcp':
        return 'MCP';
      case 'system':
        switch (source.process) {
          case 'scheduled_transaction':
            return 'Scheduled transaction';
          case 'bank_import':
            return 'Bank import';
          case 'financekit_sync':
            return 'Apple Wallet sync';
          case 'system':
            return 'Automatic';
        }
    }
  }

  protected sourceDetail(source: ActivityEntry['source']): string | null {
    switch (source.type) {
      case 'public_api':
        return `${source.apiKeyLabel} (${source.apiKeyPrefix}…)`;
      case 'mcp':
        return source.clientName ?? source.clientId ?? null;
      case 'kualia_ui':
      case 'system':
        return null;
    }
  }

  protected transactionBefore(entry: ActivityEntry): TransactionSnapshot | null {
    return entry.details.kind === 'transaction' ? (entry.details.before ?? null) : null;
  }

  protected transactionAfter(entry: ActivityEntry): TransactionSnapshot | null {
    return entry.details.kind === 'transaction' ? (entry.details.after ?? null) : null;
  }

  protected primaryTransaction(entry: ActivityEntry): TransactionSnapshot | null {
    return this.transactionAfter(entry) ?? this.transactionBefore(entry);
  }

  protected transactionPayee(transaction: TransactionSnapshot): string {
    return transaction.transferAccount?.name ?? transaction.merchant?.name ?? 'No payee';
  }

  protected transactionDisplayAmount(transaction: TransactionSnapshot): bigint {
    return transaction.type === 'transfer' && transaction.amount < 0n ? -transaction.amount : transaction.amount;
  }

  protected transferFromName(transaction: TransactionSnapshot): string {
    return transaction.amount < 0n
      ? transaction.account.name
      : (transaction.transferAccount?.name ?? 'another account');
  }

  protected transferToName(transaction: TransactionSnapshot): string {
    return transaction.amount < 0n
      ? (transaction.transferAccount?.name ?? 'another account')
      : transaction.account.name;
  }

  protected transactionCategories(transaction: TransactionSnapshot): string {
    const categories = transaction.movements.map((movement) => {
      if (movement.readyToAssign) return 'Ready to Assign';
      return movement.category?.name ?? 'Uncategorized';
    });

    const summary = Array.from(new Set(categories)).join(', ');
    const omitted = transaction.movementCount - transaction.movements.length;
    return transaction.movementsTruncated && omitted > 0 ? `${summary}, +${omitted} more` : summary;
  }

  protected transactionChanges(
    before: TransactionSnapshot,
    after: TransactionSnapshot,
    currencyCode: string
  ): SnapshotChange[] {
    return this.changedValues([
      {
        label: 'Amount',
        before: formatCurrency(this.transactionDisplayAmount(before), currencyCode),
        after: formatCurrency(this.transactionDisplayAmount(after), currencyCode),
      },
      { label: 'Payee', before: this.transactionPayee(before), after: this.transactionPayee(after) },
      { label: 'Account', before: before.account.name, after: after.account.name },
      {
        label: 'Categories',
        before: this.transactionMovementSummary(before, currencyCode),
        after: this.transactionMovementSummary(after, currencyCode),
      },
      {
        label: 'Date',
        before: formatDateForDisplay(before.date),
        after: formatDateForDisplay(after.date),
      },
      { label: 'Status', before: this.humanize(before.status), after: this.humanize(after.status) },
      {
        label: 'Review status',
        before: this.humanize(before.reviewStatus),
        after: this.humanize(after.reviewStatus),
      },
      { label: 'Notes', before: before.notes ?? 'None', after: after.notes ?? 'None' },
    ]);
  }

  protected bankAccountBefore(entry: ActivityEntry): BankAccountSnapshot | null {
    return entry.details.kind === 'bank_account' ? (entry.details.before ?? null) : null;
  }

  protected bankAccountAfter(entry: ActivityEntry): BankAccountSnapshot | null {
    return entry.details.kind === 'bank_account' ? (entry.details.after ?? null) : null;
  }

  protected primaryBankAccount(entry: ActivityEntry): BankAccountSnapshot | null {
    return this.bankAccountAfter(entry) ?? this.bankAccountBefore(entry);
  }

  protected bankAccountChanges(
    before: BankAccountSnapshot,
    after: BankAccountSnapshot,
    currencyCode: string
  ): SnapshotChange[] {
    return this.changedValues([
      { label: 'Name', before: before.name, after: after.name },
      {
        label: 'Type',
        before: formatAccountType(before.accountType),
        after: formatAccountType(after.accountType),
      },
      {
        label: 'Balance',
        before: formatCurrency(before.currentBalance, currencyCode),
        after: formatCurrency(after.currentBalance, currencyCode),
      },
      {
        label: 'Status',
        before: before.isClosed ? 'Closed' : 'Open',
        after: after.isClosed ? 'Closed' : 'Open',
      },
      {
        label: 'Connection',
        before: this.accountConnectionLabel(before),
        after: this.accountConnectionLabel(after),
      },
      { label: 'Notes', before: before.notes ?? 'None', after: after.notes ?? 'None' },
      {
        label: 'Appearance',
        before: before.visualIdentityMode ? this.humanize(before.visualIdentityMode) : 'Default',
        after: after.visualIdentityMode ? this.humanize(after.visualIdentityMode) : 'Default',
      },
      { label: 'Icon', before: before.iconName ?? 'Default', after: after.iconName ?? 'Default' },
      { label: 'Icon color', before: before.iconColorId ?? 'Default', after: after.iconColorId ?? 'Default' },
      { label: 'Logo', before: this.accountLogoLabel(before), after: this.accountLogoLabel(after) },
    ]);
  }

  protected categoryBefore(entry: ActivityEntry): CategorySnapshot | null {
    return entry.details.kind === 'category' ? (entry.details.before ?? null) : null;
  }

  protected categoryAfter(entry: ActivityEntry): CategorySnapshot | null {
    return entry.details.kind === 'category' ? (entry.details.after ?? null) : null;
  }

  protected primaryCategory(entry: ActivityEntry): CategorySnapshot | null {
    return this.categoryAfter(entry) ?? this.categoryBefore(entry);
  }

  protected merchantBefore(entry: ActivityEntry): MerchantSnapshot | null {
    return entry.details.kind === 'merchant' ? (entry.details.before ?? null) : null;
  }

  protected merchantAfter(entry: ActivityEntry): MerchantSnapshot | null {
    return entry.details.kind === 'merchant' ? (entry.details.after ?? null) : null;
  }

  protected primaryMerchant(entry: ActivityEntry): MerchantSnapshot | null {
    return this.merchantAfter(entry) ?? this.merchantBefore(entry);
  }

  protected merchantDetails(entry: ActivityEntry): MerchantDetails | null {
    return entry.details.kind === 'merchant' ? entry.details : null;
  }

  protected merchantChanges(before: MerchantSnapshot, after: MerchantSnapshot): SnapshotChange[] {
    return this.changedValues([
      { label: 'Name', before: before.name, after: after.name },
      {
        label: 'Appearance',
        before: before.visualIdentityMode ? this.humanize(before.visualIdentityMode) : 'Default',
        after: after.visualIdentityMode ? this.humanize(after.visualIdentityMode) : 'Default',
      },
      { label: 'Icon', before: before.iconName ?? 'Default', after: after.iconName ?? 'Default' },
      { label: 'Icon color', before: before.iconColorId ?? 'Default', after: after.iconColorId ?? 'Default' },
      { label: 'Logo', before: this.merchantLogoLabel(before), after: this.merchantLogoLabel(after) },
    ]);
  }

  protected merchantMoveSummary(details: MerchantDetails): string | null {
    const parts: string[] = [];
    const transactionCount = details.movedTransactionCount ?? 0;
    const recurringCount = details.updatedRecurringTransactionCount ?? 0;

    if (transactionCount > 0) {
      parts.push(`${transactionCount} ${transactionCount === 1 ? 'transaction' : 'transactions'}`);
    }
    if (recurringCount > 0) {
      parts.push(`${recurringCount} ${recurringCount === 1 ? 'planned transaction' : 'planned transactions'}`);
    }

    return parts.length > 0 ? `${parts.join(' and ')} moved.` : null;
  }

  protected categoryChanges(before: CategorySnapshot, after: CategorySnapshot, currencyCode: string): SnapshotChange[] {
    return this.changedValues([
      { label: 'Name', before: before.name, after: after.name },
      { label: 'Group', before: before.group?.name ?? 'No group', after: after.group?.name ?? 'No group' },
      {
        label: 'Status',
        before: before.isArchived ? 'Archived' : 'Active',
        after: after.isArchived ? 'Archived' : 'Active',
      },
      {
        label: 'Type',
        before: before.categoryType ? this.humanize(before.categoryType) : 'Standard',
        after: after.categoryType ? this.humanize(after.categoryType) : 'Standard',
      },
      { label: 'Icon', before: before.iconName ?? 'Default', after: after.iconName ?? 'Default' },
      { label: 'Order', before: before.sortOrder.toString(), after: after.sortOrder.toString() },
      {
        label: 'Target',
        before: this.categoryTargetSummary(before, currencyCode),
        after: this.categoryTargetSummary(after, currencyCode),
      },
    ]);
  }

  protected moneyMovementDetails(entry: ActivityEntry): MoneyMovementDetails | null {
    return entry.details.kind === 'money_movement' ? entry.details : null;
  }

  protected moneyLocationName(location: MoneyLocation): string {
    return location.type === 'ready_to_assign' ? 'Ready to Assign' : location.category.name;
  }

  protected formatYearMonth(yearMonth: number): string {
    return formatMonth(yearMonth.toString());
  }

  protected bankConnectionDetails(entry: ActivityEntry): BankConnectionDetails | null {
    return entry.details.kind === 'bank_connection' ? entry.details : null;
  }

  protected bankConnectionProvider(provider: BankConnectionDetails['connection']['provider']): string {
    return provider === 'plaid' ? 'Plaid' : 'Apple Wallet';
  }

  private transactionMovementSummary(transaction: TransactionSnapshot, currencyCode: string): string {
    const summary = transaction.movements
      .map((movement) => {
        const location = movement.readyToAssign ? 'Ready to Assign' : (movement.category?.name ?? 'Uncategorized');
        return `${location}: ${formatCurrency(movement.amount, currencyCode)}`;
      })
      .join(', ');
    const omitted = transaction.movementCount - transaction.movements.length;
    return transaction.movementsTruncated && omitted > 0 ? `${summary}, +${omitted} more` : summary;
  }

  private accountConnectionLabel(account: BankAccountSnapshot): string {
    if (!account.connection) return 'Manual';
    return account.connection.provider === 'plaid' ? 'Plaid' : 'Apple Wallet';
  }

  private accountLogoLabel(account: BankAccountSnapshot): string {
    if (account.logoUrl === null) return 'None';
    return account.logoUrl ? 'Custom' : 'Institution default';
  }

  private merchantLogoLabel(merchant: MerchantSnapshot): string {
    if (merchant.logoUrl === null) return 'None';
    return merchant.logoUrl ? 'Custom' : 'Default';
  }

  private categoryTargetSummary(category: CategorySnapshot, currencyCode: string): string {
    const target = category.target;
    if (!target.enabled) return 'None';

    const details = [target.type ? this.humanize(target.type) : 'Enabled'];
    if (target.amount !== undefined) details.push(formatCurrency(target.amount, currencyCode));
    if (target.frequency) {
      const interval =
        target.frequencyInterval && target.frequencyInterval > 1 ? `every ${target.frequencyInterval} ` : '';
      details.push(`${interval}${target.frequency}`);
    }
    if (target.targetDate) details.push(`by ${formatDateForDisplay(target.targetDate)}`);
    if (target.monthlyContribution !== undefined) {
      details.push(`${formatCurrency(target.monthlyContribution, currencyCode)}/month`);
    }
    return details.join(' · ');
  }

  private changedValues(changes: SnapshotChange[]): SnapshotChange[] {
    return changes.filter((change) => change.before !== change.after);
  }

  private humanize(value: string): string {
    return value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private async loadInitial(workspaceId: Id<'workspace'>): Promise<void> {
    const request = ++this.initialRequest;
    this.stopWatching();
    this.reset();
    this.loading.set(true);

    try {
      const result = await this.convexService.getClient().query(api.activityLogs.listActivity, {
        workspaceId,
        paginationOpts: { numItems: PAGE_SIZE, cursor: null },
      });

      if (request !== this.initialRequest || this.workspaceService.workspaceId() !== workspaceId) {
        return;
      }

      this.entries.set(result.page);
      this.cursor.set(result.continueCursor);
      this.isDone.set(result.isDone);
      this.startWatching(workspaceId);
    } catch (error: unknown) {
      if (request !== this.initialRequest) {
        return;
      }

      console.error('Failed to load activity:', error);
      this.error.set('Failed to load activity. Please try again.');
    } finally {
      if (request === this.initialRequest) {
        this.loading.set(false);
      }
    }
  }

  private startWatching(workspaceId: Id<'workspace'>): void {
    this.stopWatching();

    const numItems = Math.max(this.entries().length, PAGE_SIZE);
    const watcher = this.convexService.watchQuery<ActivityPage>(api.activityLogs.listActivity, {
      workspaceId,
      paginationOpts: { numItems, cursor: null },
    });

    this.activitySubscription = watcher.subscribe((result) => {
      if (result === undefined || this.workspaceService.workspaceId() !== workspaceId) {
        return;
      }

      this.entries.set(result.page);
      this.cursor.set(result.continueCursor);
      this.isDone.set(result.isDone);
    });
  }

  private stopWatching(): void {
    this.activitySubscription?.();
    this.activitySubscription = undefined;
  }

  private reset(): void {
    this.stopWatching();
    this.entries.set([]);
    this.expandedEntryIds.set(new Set());
    this.activityMeasurements.set(new Map());
    this.cursor.set(null);
    this.isDone.set(false);
    this.loadingMore.set(false);
    this.error.set(null);
  }
}
