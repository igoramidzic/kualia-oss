import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import {
  nucleoCheckCircle as CheckCircle2,
  nucleoChevronRight as ChevronRight,
  nucleoCloseCircle as CircleX,
  nucleoDots as Ellipsis,
  nucleoInfo as Info,
  NucleoIcon,
  nucleoConnection as Plug,
  nucleoConnection as PlugZap,
  nucleoPlus as Plus,
  nucleoRedo as Redo2,
  nucleoSearch as Search,
  nucleoPhone as Smartphone,
  nucleoTrash as Trash2,
  nucleoUndo as Undo2,
  nucleoClose as X,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { CloseBankAccountDialogComponent } from '../../components/dialogs/close-bank-account-dialog/close-bank-account-dialog';
import { DeleteBankAccountDialogComponent } from '../../components/dialogs/delete-bank-account-dialog/delete-bank-account-dialog';
import { LinkBankAccountDialogComponent } from '../../components/dialogs/link-bank-account-dialog/link-bank-account-dialog';
import { ReconcileBankAccountDialogComponent } from '../../components/dialogs/reconcile-bank-account-dialog/reconcile-bank-account-dialog';
import { ReopenBankAccountDialogComponent } from '../../components/dialogs/reopen-bank-account-dialog/reopen-bank-account-dialog';
import { EntityMarkComponent } from '../../components/entity-mark/entity-mark.component';
import { LogoPickerComponent } from '../../components/logo-picker/logo-picker.component';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { TransactionsTableComponent } from '../../components/transactions-table/transactions-table';
import { AiChatService } from '../../services/ai-chat.service';
import { BankAccountService } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import { NavigationService } from '../../services/navigation.service';
import { TransactionService } from '../../services/transaction.service';
import { UndoRedoService } from '../../services/undo-redo.service';
import { WorkspaceService } from '../../services/workspace.service';
import { formatAccountType } from '../../shared/utils/account-type-utils';
import {
  DEFAULT_BANK_ACCOUNT_ICON_NAME,
  EntityIconColorId,
  randomEntityIconColorId,
  VisualIdentityMode,
} from '../../shared/utils/entity-identity';
import {
  HlmDropdownMenu,
  HlmDropdownMenuItem,
  HlmDropdownMenuSeparator,
  HlmDropdownMenuTrigger,
} from '../../ui/dropdown-menu/src';
import { BankAccountPageService } from './bank-account-page.service';

@Component({
  selector: 'app-bank-account',
  imports: [
    CommonModule,
    FormsModule,
    NucleoIcon,
    SidebarToggleComponent,
    HlmButton,
    RouterLink,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmDropdownMenuSeparator,
    HlmDropdownMenuTrigger,
    TransactionsTableComponent,
    EntityMarkComponent,
    LogoPickerComponent,
    BrnPopover,
    BrnPopoverTrigger,
    BrnPopoverContent,
    HlmPopoverContent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bank-account.html',
  providers: [BankAccountPageService],
})
export class BankAccountComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navigationService = inject(NavigationService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly bankAccountConvexService = inject(BankAccountService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly bankAccountPageService = inject(BankAccountPageService);
  private readonly transactionService = inject(TransactionService);
  private readonly currencyService = inject(CurrencyService);
  private readonly undoRedoService = inject(UndoRedoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly aiChat = inject(AiChatService);

  protected readonly ChevronRight = ChevronRight;
  protected readonly Search = Search;
  protected readonly X = X;
  protected readonly Ellipsis = Ellipsis;
  protected readonly Plug = Plug;
  protected readonly PlugZap = PlugZap;
  protected readonly Smartphone = Smartphone;
  protected readonly CheckCircle2 = CheckCircle2;
  protected readonly XCircle = CircleX;
  protected readonly Trash2 = Trash2;
  protected readonly Info = Info;
  protected readonly Plus = Plus;
  protected readonly Undo2 = Undo2;
  protected readonly Redo2 = Redo2;
  protected readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  // Undo/Redo
  readonly canUndo = this.undoRedoService.canUndo;
  readonly canRedo = this.undoRedoService.canRedo;

  // Search state
  readonly isSearchFocused = signal(false);
  readonly searchQuery = signal('');
  readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  readonly hasSearchQuery = computed(() => this.searchQuery().trim().length > 0);
  readonly isSearchExpanded = computed(() => this.isSearchFocused() || this.hasSearchQuery());

  // Bank account state
  readonly bankAccount = this.bankAccountConvexService.currentBankAccount;
  readonly populatedBankAccount = this.bankAccountConvexService.currentBankAccount;
  readonly isLoading = this.bankAccountConvexService.isLoadingCurrent;
  readonly error = computed(() => {
    if (this.isLoading()) return null;
    return !this.bankAccount() ? 'Bank account not found' : null;
  });
  readonly isPlaidConnected = computed(() => !!this.bankAccount()?.bankLinkAccount);
  readonly isFinanceKitConnected = computed(() => !!this.bankAccount()?.financeKitAccount);
  readonly isConnected = computed(() => this.isPlaidConnected() || this.isFinanceKitConnected());
  private bankAccountInitialized = false;
  private currentBankAccountUnsubscribe?: () => void;
  private isDestroyed = false;

  // Details signals (from BankAccountDetailsComponent)
  readonly bankAccountName = signal<string>('');
  readonly bankAccountNotes = signal<string>('');
  readonly saving = signal(false);
  readonly savingNotes = signal(false);
  readonly savingLogoUrl = signal(false);
  readonly logoPickerState = signal<BrnDialogState>('closed');
  readonly detailsError = signal<string | null>(null);
  private iconColorAssignmentInFlight = false;

  // Details computed (from BankAccountDetailsComponent)
  readonly logoState = computed(() => {
    const account = this.bankAccount();
    if (!account) return 'no-merchant' as const;

    const logoUrl = 'logoUrl' in account ? account.logoUrl : undefined;
    const institutionLogoUrl = 'institutionLogoUrl' in account ? account.institutionLogoUrl : undefined;

    if (logoUrl === null) {
      return 'removed' as const;
    } else if (logoUrl === undefined) {
      return institutionLogoUrl ? ('default' as const) : ('no-logo' as const);
    } else {
      return 'custom' as const;
    }
  });

  readonly defaultLogoUrl = computed(() => {
    const account = this.bankAccount();
    return account && 'institutionLogoUrl' in account ? account.institutionLogoUrl : undefined;
  });

  readonly displayLogoUrl = computed(() => {
    const account = this.bankAccount();
    return account && 'resolvedLogoUrl' in account ? account.resolvedLogoUrl : undefined;
  });

  readonly currentBalance = computed(() => this.bankAccount()?.currentBalance ?? 0n);
  readonly pendingBalance = computed(() => {
    const account = this.bankAccount();
    return (account as { pendingBalance?: bigint } | null | undefined)?.pendingBalance ?? 0n;
  });
  readonly clearedBalance = computed(() => {
    const account = this.bankAccount();
    return (account as { clearedBalance?: bigint } | null | undefined)?.clearedBalance ?? 0n;
  });
  readonly bankLinkAccount = computed(() => this.bankAccount()?.bankLinkAccount ?? null);
  readonly financeKitAccount = computed(() => this.bankAccount()?.financeKitAccount ?? null);
  readonly institutionName = computed(
    () => this.bankLinkAccount()?.bankLink?.institution?.name ?? this.financeKitAccount()?.institutionName ?? null
  );
  readonly accountMask = computed(() => this.bankLinkAccount()?.accountNumberMask ?? null);
  readonly accountType = computed(
    () =>
      this.bankLinkAccount()?.accountType ??
      this.financeKitAccount()?.accountType ??
      this.bankAccount()?.accountType ??
      null
  );

  // Transaction properties (from BankAccountTransactionsComponent)
  readonly sortedTransactions = this.bankAccountPageService.sortedTransactions;
  readonly transactionsLoading = this.bankAccountPageService.transactionsLoading;
  readonly loadingMore = this.bankAccountPageService.loadingMore;
  readonly hasMore = this.bankAccountPageService.hasMore;
  readonly transactionsError = this.bankAccountPageService.error;

  // Time-ago subtitle for connected accounts
  private readonly currentTime = signal(new Date());
  private timeIntervalId?: number;

  readonly headerSubtitle = computed(() => {
    const financeKitConnection = this.financeKitAccount()?.connection ?? null;
    const institution = this.institutionName() ?? (financeKitConnection ? 'Apple Wallet' : null);
    if (!institution) return null;

    const bankLink = this.bankLinkAccount()?.bankLink;
    const lastSyncedAt = bankLink?.lastSyncedAt ?? financeKitConnection?.lastSyncedAt ?? null;
    const managedSuffix = financeKitConnection ? 'Managed from iOS' : null;
    if (!lastSyncedAt) {
      return managedSuffix ? `${institution} · ${managedSuffix}` : `${institution}`;
    }

    const subtitle = `${institution} · Last synced ${this.formatRelativeSyncTime(lastSyncedAt)}`;
    return managedSuffix ? `${subtitle} · ${managedSuffix}` : subtitle;
  });

  readonly formatAccountType = formatAccountType;

  constructor() {
    // Start time-ago interval
    this.timeIntervalId = window.setInterval(() => {
      this.currentTime.set(new Date());
    }, 60000);

    // Watch for bank account deletion and navigate away
    effect(() => {
      const bankAccount = this.bankAccount();
      const isUpdatingSlug = this.bankAccountConvexService.isUpdatingSlug();
      const isLoading = this.isLoading();

      if (this.bankAccountInitialized && !bankAccount && !isLoading && !isUpdatingSlug) {
        void this.navigationService.navigateToBankAccounts();
      }
    });

    // Track previous bank account ID to avoid unnecessary updates
    let previousBankAccountId: string | undefined | null = undefined;
    effect(() => {
      const bankAccount = this.bankAccount();
      const currentId = bankAccount?._id ?? null;
      if (currentId !== previousBankAccountId) {
        previousBankAccountId = currentId;
        this.bankAccountPageService.setBankAccount(bankAccount ?? null);
        if (bankAccount) {
          this.transactionService.setCurrentBankAccountContext(bankAccount._id);
        }
        this.searchQuery.set('');
      }
    });

    // Update bankAccountName and bankAccountNotes when bank account changes
    effect(() => {
      const bankAccount = this.bankAccount();
      if (bankAccount) {
        this.bankAccountName.set(bankAccount.name);
        this.bankAccountNotes.set(bankAccount.notes ?? '');
      }
    });

    // Debounced search - update filters after 500ms of no typing
    toObservable(this.searchQuery)
      .pipe(debounceTime(500), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((searchTerm) => {
        // Strip non-alphanumeric characters to prevent Convex tokenization issues
        // Then remove spaces entirely for exact phrase matching
        const sanitized = searchTerm
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '');

        // Require at least 2 characters after sanitization to trigger search
        if (sanitized.length < 2) {
          void this.transactionService.updateFilters({ search: undefined });
          return;
        }

        void this.transactionService.updateFilters({ search: sanitized });
      });

    // Clean up subscription on destroy
    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
      if (this.currentBankAccountUnsubscribe) {
        this.currentBankAccountUnsubscribe();
      }
      this.transactionService.clearCurrentBankAccountContext();
    });
  }

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const slug = params.get('slug');
      if (slug) {
        const shortId = this.extractBankAccountIdFromSlug(slug);
        void this.initializeBankAccount(shortId);
      }
    });
  }

  ngOnDestroy() {
    if (this.timeIntervalId) {
      window.clearInterval(this.timeIntervalId);
    }
  }

  private async initializeBankAccount(shortId: string) {
    if (this.currentBankAccountUnsubscribe) {
      this.currentBankAccountUnsubscribe();
    }

    this.bankAccountConvexService.setLoadingCurrent(true);
    this.bankAccountConvexService.setCurrentBankAccount(null);

    await this.waitForWorkspace();

    this.currentBankAccountUnsubscribe = this.bankAccountConvexService.watchCurrentBankAccount(shortId);
    this.bankAccountInitialized = true;
  }

  private async waitForWorkspace(): Promise<void> {
    return new Promise((resolve) => {
      const checkWorkspace = () => {
        if (this.workspaceService.workspaceId()) {
          resolve();
        } else {
          setTimeout(checkWorkspace, 50);
        }
      };
      checkWorkspace();
    });
  }

  private extractBankAccountIdFromSlug(slug: string): string {
    const parts = slug.split('-');
    return parts[parts.length - 1];
  }

  // Helper method to safely set signals when component is not destroyed
  private safeSetSignal<T>(sig: { set: (value: T) => void }, value: T): void {
    if (!this.isDestroyed) {
      sig.set(value);
    }
  }

  openCreateTransactionDialog(): void {
    this.transactionService.openCreateDialog();
  }

  undo(): void {
    void this.undoRedoService.undo();
  }

  redo(): void {
    void this.undoRedoService.redo();
  }

  // --- Dialog methods ---

  openDeleteDialog() {
    const bankAccount = this.bankAccount();
    if (!bankAccount) return;

    const dialogRef = this.dialogService.open(DeleteBankAccountDialogComponent, {
      context: {
        bankAccount,
        onClose: (deleted?: boolean) => {
          dialogRef.close();
          if (deleted) {
            void this.navigationService.navigateToBankAccounts();
          }
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  openReconcileDialog() {
    const bankAccount = this.bankAccount();
    if (!bankAccount) return;

    const dialogRef = this.dialogService.open(ReconcileBankAccountDialogComponent, {
      context: {
        bankAccount,
        onClose: () => {
          dialogRef.close();
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  openLinkDialog(): void {
    const bankAccount = this.bankAccount();
    if (!bankAccount) return;

    if (this.isFinanceKitConnected()) {
      toast.info('Manage Apple Wallet connections from iOS. You can disconnect the connection in Bank Connections.');
      return;
    }

    this.dialogService.open(LinkBankAccountDialogComponent, {
      context: { bankAccount },
    });
  }

  openCloseAccountDialog(): void {
    const bankAccount = this.bankAccount();
    if (!bankAccount) return;

    const dialogRef = this.dialogService.open(CloseBankAccountDialogComponent, {
      context: {
        bankAccount,
        onClose: () => {
          dialogRef.close();
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  openReopenAccountDialog(): void {
    const bankAccount = this.bankAccount();
    if (!bankAccount) return;

    const dialogRef = this.dialogService.open(ReopenBankAccountDialogComponent, {
      context: {
        bankAccount,
        onClose: (success?: boolean) => {
          dialogRef.close();
          if (success) {
            const shortId = bankAccount._id.slice(-8);
            void this.refreshBankAccount(shortId);
          }
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  private async refreshBankAccount(shortId: string): Promise<void> {
    const updatedBankAccount = await this.bankAccountConvexService.fetchBankAccountByShortId(shortId);
    if (updatedBankAccount) {
      this.bankAccountConvexService.setCurrentBankAccount(updatedBankAccount);
    }
  }

  // --- Keyboard shortcut ---

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.aiChat.shouldCaptureShortcuts()) return;

    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      if (!this.isSearchFocused()) {
        event.preventDefault();
        this.focusSearch();
      }
    }
  }

  // --- Search methods ---

  focusSearch(): void {
    this.searchInput()?.nativeElement.focus();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    void this.transactionService.updateFilters({ search: undefined });
    this.searchInput()?.nativeElement.blur();
  }

  onSearchFocus(): void {
    this.isSearchFocused.set(true);
  }

  onSearchBlur(): void {
    this.isSearchFocused.set(false);
  }

  onSearchEscape(): void {
    if (this.hasSearchQuery()) {
      this.searchQuery.set('');
      void this.transactionService.updateFilters({ search: undefined });
    }
    this.searchInput()?.nativeElement.blur();
  }

  onWrapperSpaceKey(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (
      keyboardEvent.target === keyboardEvent.currentTarget ||
      (keyboardEvent.target as HTMLElement).tagName !== 'INPUT'
    ) {
      keyboardEvent.preventDefault();
      this.focusSearch();
    }
  }

  // --- Name editing methods ---

  onNameInput() {
    // Track changes but don't save yet
  }

  onNameFocus(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const range = document.createRange();
    const selection = window.getSelection();

    if (selection && target.childNodes.length > 0) {
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  onNameBlur(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const newName = target.textContent?.trim() ?? '';

    if (newName && newName !== this.bankAccount()?.name) {
      this.bankAccountName.set(newName);
      void this.saveBankAccountName();
    } else {
      target.textContent = this.bankAccount()?.name ?? '';
    }
  }

  onNameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = event.target as HTMLElement;
      target.blur();
    }
  }

  private async saveBankAccountName() {
    const currentBankAccount = this.bankAccount();
    const newName = this.bankAccountName().trim();

    if (!currentBankAccount || !newName || newName === currentBankAccount.name) {
      return;
    }

    const previousName = currentBankAccount.name;
    this.saving.set(true);
    this.detailsError.set(null);

    try {
      const success = await this.bankAccountConvexService.updateBankAccount(currentBankAccount._id, { name: newName });

      if (!success) {
        throw new Error('Update failed');
      }

      this.bankAccountConvexService.setCurrentBankAccount({
        ...currentBankAccount,
        name: newName,
      });

      if (!this.isDestroyed && this.router.url.includes('/bank-account')) {
        this.bankAccountConvexService.setUpdatingSlug(true);
        const newSlug = this.generateSlug(newName, currentBankAccount._id);
        await this.navigationService.navigateToBankAccount(newSlug, { replaceUrl: true });
        this.bankAccountConvexService.setUpdatingSlug(false);
      }
    } catch (err) {
      this.detailsError.set('Failed to save bank account name');
      console.error('Error updating bank account:', err);
      this.bankAccountConvexService.setUpdatingSlug(false);
      this.bankAccountName.set(previousName);
      const element = document.querySelector('[role="textbox"]')!;
      if (element) {
        element.textContent = previousName;
      }
    } finally {
      this.saving.set(false);
    }
  }

  // --- Notes editing methods ---

  onNotesInput() {
    // Track changes but don't save yet
  }

  onNotesFocus(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const range = document.createRange();
    const selection = window.getSelection();

    if (selection && target.childNodes.length > 0) {
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  onNotesBlur(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const newNotes = target.innerText ?? '';

    const currentNotes = this.bankAccount()?.notes ?? '';
    if (newNotes !== currentNotes) {
      this.bankAccountNotes.set(newNotes);
      void this.saveBankAccountNotes();
    }
  }

  onNotesKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      const target = event.target as HTMLElement;
      target.innerText = this.bankAccount()?.notes ?? '';
      this.bankAccountNotes.set(this.bankAccount()?.notes ?? '');
      target.blur();
    }
  }

  private async saveBankAccountNotes() {
    const currentBankAccount = this.bankAccount();
    const newNotes = this.bankAccountNotes();

    if (!currentBankAccount) {
      return;
    }

    const currentNotes = currentBankAccount.notes ?? '';
    if (newNotes === currentNotes) {
      return;
    }

    this.savingNotes.set(true);

    try {
      const success = await this.bankAccountConvexService.updateBankAccount(currentBankAccount._id, {
        notes: newNotes,
      });

      if (!success) {
        throw new Error('Update failed');
      }

      this.bankAccountConvexService.setCurrentBankAccount({
        ...currentBankAccount,
        notes: newNotes,
      });
    } catch (err) {
      console.error('Error updating bank account notes:', err);
      this.bankAccountNotes.set(currentNotes);
      const element = document.querySelector('[data-notes-editor]');
      if (element) {
        element.textContent = currentNotes;
      }
    } finally {
      this.savingNotes.set(false);
    }
  }

  // --- Logo picker methods ---

  onLogoPickerStateChanged(state: BrnDialogState): void {
    this.safeSetSignal(this.logoPickerState, state);
    if (state === 'open') {
      void this.ensureBankAccountIconColor();
    }
  }

  closeLogoPicker(): void {
    this.safeSetSignal(this.logoPickerState, 'closed');
  }

  async onLogoChange(logoUrl: string | null): Promise<void> {
    const account = this.bankAccount();
    if (!account) return;

    this.safeSetSignal(this.savingLogoUrl, true);

    try {
      await this.bankAccountConvexService.updateBankAccount(account._id, {
        logoUrl,
      });
      toast.success('Account logo updated');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update account logo';
      toast.error(errorMessage);
      console.error('Error updating account logo:', err);
    } finally {
      this.safeSetSignal(this.savingLogoUrl, false);
    }
  }

  async removeCustomLogo(): Promise<void> {
    const account = this.bankAccount();
    if (!account) return;

    this.safeSetSignal(this.savingLogoUrl, true);

    try {
      await this.bankAccountConvexService.updateBankAccount(account._id, {
        logoUrl: 'UNSET',
      });
      toast.success('Reset to institution logo');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset logo';
      toast.error(errorMessage);
      console.error('Error resetting logo:', err);
    } finally {
      this.safeSetSignal(this.savingLogoUrl, false);
    }
  }

  async removeDefaultLogo(): Promise<void> {
    const account = this.bankAccount();
    if (!account) return;

    this.safeSetSignal(this.savingLogoUrl, true);

    try {
      await this.bankAccountConvexService.updateBankAccount(account._id, {
        logoUrl: null,
      });
      toast.success('Logo removed');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove logo';
      toast.error(errorMessage);
      console.error('Error removing logo:', err);
    } finally {
      this.safeSetSignal(this.savingLogoUrl, false);
    }
  }

  async resetToDefaultLogo(): Promise<void> {
    await this.removeCustomLogo();
  }

  async onIdentityModeChange(mode: VisualIdentityMode): Promise<void> {
    const account = this.bankAccount();
    if (!account) return;

    const updates: {
      visualIdentityMode: VisualIdentityMode;
      iconName?: string;
      iconColorId?: EntityIconColorId;
    } = {
      visualIdentityMode: mode,
    };

    if (mode === 'icon') {
      updates.iconName = account.iconName ?? DEFAULT_BANK_ACCOUNT_ICON_NAME;
      updates.iconColorId = account.iconColorId ?? randomEntityIconColorId();
    }

    await this.saveBankAccountIdentity(updates);
  }

  async onIconChange(iconName: string): Promise<void> {
    const account = this.bankAccount();
    if (!account) return;

    await this.saveBankAccountIdentity({
      visualIdentityMode: 'icon',
      iconName,
      iconColorId: account.iconColorId ?? randomEntityIconColorId(),
    });
  }

  async onIconColorChange(iconColorId: EntityIconColorId): Promise<void> {
    const account = this.bankAccount();
    if (!account) return;

    await this.saveBankAccountIdentity({
      visualIdentityMode: 'icon',
      iconName: account.iconName ?? DEFAULT_BANK_ACCOUNT_ICON_NAME,
      iconColorId,
    });
  }

  private async saveBankAccountIdentity(updates: {
    visualIdentityMode?: VisualIdentityMode;
    iconName?: string;
    iconColorId?: EntityIconColorId;
  }): Promise<void> {
    const account = this.bankAccount();
    if (!account) return;

    this.safeSetSignal(this.savingLogoUrl, true);

    try {
      await this.bankAccountConvexService.updateBankAccount(account._id, updates);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update account identity';
      toast.error(errorMessage);
      console.error('Error updating account identity:', err);
    } finally {
      this.safeSetSignal(this.savingLogoUrl, false);
    }
  }

  private async ensureBankAccountIconColor(): Promise<void> {
    const account = this.bankAccount();
    if (!account || account.iconColorId || this.iconColorAssignmentInFlight) return;

    this.iconColorAssignmentInFlight = true;

    try {
      await this.bankAccountConvexService.updateBankAccount(account._id, {
        iconColorId: randomEntityIconColorId(),
      });
    } catch (err: unknown) {
      console.error('Error assigning bank account icon color:', err);
    } finally {
      this.iconColorAssignmentInFlight = false;
    }
  }

  // --- Currency formatting ---

  formatCurrency(amount: bigint | number | null | undefined): string {
    if (amount === null || amount === undefined) {
      return '\u2014';
    }
    return this.currencyService.format(amount);
  }

  formatAccountMask(mask: string | null): string {
    if (!mask) {
      return '\u2014';
    }
    return `\u2022\u2022\u2022\u2022 ${mask}`;
  }

  formatClosedDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  // --- Slug generation ---

  private generateSlug(name: string, id: string): string {
    const nameSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');
    const last8 = id.slice(-8);
    return `${nameSlug}-${last8}`;
  }

  private formatRelativeSyncTime(dateString: string): string {
    const date = new Date(dateString);
    const now = this.currentTime();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) {
      return 'Just now';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}${diffMinutes === 1 ? ' min' : ' mins'} ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}${diffHours === 1 ? ' hour' : ' hours'} ago`;
    }
    if (diffDays < 7) {
      return `${diffDays}${diffDays === 1 ? ' day' : ' days'} ago`;
    }

    const weeks = Math.floor(diffDays / 7);
    return `${weeks}${weeks === 1 ? ' week' : ' weeks'} ago`;
  }

  // --- Transaction loading ---

  loadMore() {
    void this.bankAccountPageService.loadMore();
  }
}
