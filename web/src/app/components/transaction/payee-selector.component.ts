import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { NucleoIcon, nucleoPlus as Plus, nucleoTransactions as Receipt, nucleoShop as Store } from '@kualia/icons';
import { BankAccountWithRelations } from '../../services/bank-account.service';
import { Merchant, MerchantService } from '../../services/merchant.service';
import { DEFAULT_BANK_ACCOUNT_ICON_NAME, DEFAULT_MERCHANT_ICON_NAME } from '../../shared/utils/entity-identity';
import { EntityMarkComponent } from '../entity-mark/entity-mark.component';

export interface PayeeChangeEvent {
  type: 'merchant' | 'bankAccount' | 'system';
  id: string | null;
  pendingName?: string;
  systemPayeeType?: 'starting_balance' | 'balance_adjustment';
}

interface SystemPayee {
  type: 'starting_balance' | 'balance_adjustment';
  label: string;
  icon: typeof Receipt;
}

const SYSTEM_PAYEES: readonly SystemPayee[] = [
  { type: 'starting_balance', label: 'Starting Balance', icon: Receipt },
  { type: 'balance_adjustment', label: 'Balance Adjustment', icon: Receipt },
] as const;

@Component({
  selector: 'app-payee-selector',
  imports: [NucleoIcon, EntityMarkComponent, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      sideOffset="5"
      autoFocus="first-tabbable"
      [filter]="noopFilter"
      [disabled]="isEffectivelyDisabled()"
      (valueChange)="onValueChange($event)"
    >
      <hlm-combobox-trigger [class]="buttonClass()" [variant]="variant()" [showIcon]="false" stopPropagation>
        <span class="flex max-w-full min-w-0 items-center gap-2">
          @if (showIcon()) {
            @if (displayIcon() === 'system') {
              <div class="bg-accent/50 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border">
                <nucleo-icon [icon]="Receipt" class="text-muted-foreground" size="12" />
              </div>
            } @else if (displayIcon() === 'bank') {
              <app-entity-mark
                [mode]="selectedBankAccount()?.visualIdentityMode"
                [logoUrl]="selectedBankAccount()?.resolvedLogoUrl"
                [iconName]="selectedBankAccount()?.iconName ?? defaultBankAccountIconName"
                [iconColorId]="selectedBankAccount()?.iconColorId"
                [defaultIconName]="defaultBankAccountIconName"
                [alt]="selectedBankAccount()?.name ?? 'Account'"
                size="xxs"
              />
            } @else {
              <app-entity-mark
                [mode]="selectedMerchant()?.visualIdentityMode"
                [logoUrl]="selectedMerchant()?.logoUrl"
                [iconName]="selectedMerchant()?.iconName ?? defaultMerchantIconName"
                [iconColorId]="selectedMerchant()?.iconColorId"
                [defaultIconName]="defaultMerchantIconName"
                [alt]="selectedMerchant()?.name ?? 'Merchant'"
                size="xxs"
              />
            }
          }
          <span class="min-w-0 truncate" [class.text-muted-foreground]="!hasSelection()">
            {{ displayPayee() }}
          </span>
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="w-[300px] **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input
            placeholder="Search payees..."
            [showTrigger]="false"
            (input)="onSearchChange($any($event.target).value)"
          />
        </div>
        <div hlmComboboxList>
          @if (showOriginalStatementGroup()) {
            <div hlmComboboxGroup>
              <div hlmComboboxLabel>Original statement</div>
              <hlm-combobox-item value="original-statement">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="bg-accent/50 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border">
                    <nucleo-icon [icon]="Store" class="text-muted-foreground h-3 w-3" />
                  </div>
                  <span class="min-w-0 truncate text-left">{{ originalStatementName() }}</span>
                </div>
              </hlm-combobox-item>
            </div>
          }

          <!-- Bank Accounts Group - Payments and Transfers -->
          @if (filteredBankAccounts().length > 0) {
            <div hlmComboboxGroup>
              <div hlmComboboxLabel>Payments and Transfers</div>
              @for (account of filteredBankAccounts(); track account._id) {
                <hlm-combobox-item [value]="'bank:' + account._id">
                  <div class="flex min-w-0 items-center gap-2">
                    <app-entity-mark
                      [mode]="account.visualIdentityMode"
                      [logoUrl]="account.resolvedLogoUrl"
                      [iconName]="account.iconName ?? defaultBankAccountIconName"
                      [iconColorId]="account.iconColorId"
                      [defaultIconName]="defaultBankAccountIconName"
                      [alt]="account.name"
                      size="xs"
                    />
                    <span class="min-w-0 truncate text-left">{{ transferDirectionPrefix() }} {{ account.name }}</span>
                  </div>
                </hlm-combobox-item>
              }
            </div>
          }

          <!-- Merchants Group -->
          <div hlmComboboxGroup>
            @if (filteredBankAccounts().length > 0 || showOriginalStatementGroup()) {
              <div hlmComboboxLabel>Merchants</div>
            }
            @if (allowNone() && !searchTerm()) {
              <hlm-combobox-item value="no-merchant">
                <span class="text-muted-foreground">No payee</span>
              </hlm-combobox-item>
            }
            @for (merchant of filteredMerchants(); track merchant._id) {
              <hlm-combobox-item [value]="'merchant:' + merchant._id">
                <div class="flex w-full min-w-0 items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <app-entity-mark
                      [mode]="merchant.visualIdentityMode"
                      [logoUrl]="merchant.logoUrl"
                      [iconName]="merchant.iconName ?? defaultMerchantIconName"
                      [iconColorId]="merchant.iconColorId"
                      [defaultIconName]="defaultMerchantIconName"
                      [alt]="merchant.name"
                      size="xs"
                    />
                    <span class="min-w-0 truncate text-left">{{ merchant.name }}</span>
                  </div>
                  @if (merchant.transactionCount && merchant.transactionCount > 0) {
                    <span class="text-muted-foreground flex-shrink-0 text-[10px]"
                      >({{ merchant.transactionCount }})</span
                    >
                  }
                </div>
              </hlm-combobox-item>
            }
            @if (showAddOption()) {
              <hlm-combobox-item value="add-new">
                <div class="flex min-w-0 items-center gap-2">
                  <nucleo-icon [icon]="Plus" [size]="14" class="flex-shrink-0" />
                  <span class="min-w-0 truncate">Add "{{ normalizedSearchTerm() }}"</span>
                </div>
              </hlm-combobox-item>
            }
          </div>
        </div>
        <hlm-combobox-empty>
          @if (normalizedSearchTerm()) {
            <button
              class="text-foreground hover:bg-accent hover:text-accent-foreground flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm p-2"
              (click)="selectNewMerchant(searchTerm())"
            >
              <nucleo-icon [icon]="Plus" [size]="14" class="flex-shrink-0" />
              <span class="min-w-0 truncate">Add "{{ normalizedSearchTerm() }}"</span>
            </button>
          } @else {
            <span>No payees found.</span>
          }
        </hlm-combobox-empty>
      </div>
    </hlm-combobox>
  `,
})
export class PayeeSelectorComponent {
  // Injected services
  private readonly merchantService = inject(MerchantService);

  // View children
  private readonly triggerButton = viewChild<ElementRef<HTMLButtonElement>>('triggerButton');

  // Inputs
  readonly availableBankAccounts = input<BankAccountWithRelations[]>([]);
  readonly merchantId = input<string | null>(null);
  readonly selectedBankAccountId = input<string | null>(null);
  readonly pendingMerchantName = input<string | null>(null);
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('outline');
  readonly buttonClass = input<string>('text-xs');
  readonly allowNone = input<boolean>(true);
  readonly placeholder = input<string | null>(null);
  readonly showIcon = input<boolean>(true);
  readonly transactionImportDetails = input<{
    provider: 'plaid' | 'financekit';
    originalStatement?: string;
    merchantName?: string;
    date: string;
    postedDate?: string;
    amount: bigint;
    authorizedDate?: string;
    // Deprecated field
    name?: string;
  } | null>(null);
  readonly transactionAmount = input<number>(0);
  readonly transactionType = input<'regular' | 'transfer' | 'starting_balance' | 'balance_adjustment'>('regular');

  // Outputs
  readonly payeeChange = output<PayeeChangeEvent>();

  // Internal state
  readonly searchTerm = signal<string>('');

  // Icons
  readonly Store = Store;
  readonly Plus = Plus;
  readonly Receipt = Receipt;
  readonly defaultMerchantIconName = DEFAULT_MERCHANT_ICON_NAME;
  readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  // System payees constant
  readonly SYSTEM_PAYEES = SYSTEM_PAYEES;

  // Disable editing for system type transactions (starting_balance, balance_adjustment)
  readonly isEffectivelyDisabled = computed(() => {
    const type = this.transactionType();
    return this.disabled() || type === 'starting_balance' || type === 'balance_adjustment';
  });

  // No-op filter to disable combobox internal filtering (we handle filtering ourselves)
  readonly noopFilter = () => true;

  // Computed values
  readonly merchants = this.merchantService.merchants;

  readonly selectedMerchant = computed(() => {
    const id = this.merchantId();
    if (!id) return null;
    return this.merchants().find((merchant) => merchant._id === id) ?? null;
  });

  readonly selectedBankAccount = computed(() => {
    const id = this.selectedBankAccountId();
    if (!id) return null;
    return this.availableBankAccounts().find((account) => account._id === id) ?? null;
  });

  readonly filteredBankAccounts = computed(() => {
    const search = this.searchTerm().toLowerCase().trim();
    const accounts = this.availableBankAccounts();

    // Sort alphabetically
    const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name));

    if (!search) {
      return sortedAccounts;
    }

    // Filter by search term - match against the visible transfer label.
    return sortedAccounts.filter((account) => {
      const displayName = `${this.transferDirectionPrefix()} ${account.name}`.toLowerCase();
      const genericTransferName = `transfer to/from ${account.name}`.toLowerCase();
      return (
        displayName.includes(search) ||
        genericTransferName.includes(search) ||
        account.name.toLowerCase().includes(search)
      );
    });
  });

  readonly filteredMerchants = computed(() => {
    const search = this.searchTerm().toLowerCase().trim();
    const allMerchants = this.merchantService.activeMerchants();

    // Sort by transaction count (descending), then alphabetically
    // Create a new array before sorting to avoid mutating the original
    const sortedMerchants = [...allMerchants].sort((a, b) => {
      // First sort by transaction count (highest first)
      const countDiff = (b.transactionCount ?? 0) - (a.transactionCount ?? 0);
      if (countDiff !== 0) return countDiff;

      // Then alphabetically as tiebreaker
      return a.name.localeCompare(b.name);
    });

    if (!search) {
      return sortedMerchants;
    }

    return sortedMerchants.filter((merchant) => merchant.name.toLowerCase().includes(search));
  });

  readonly normalizedSearchTerm = computed(() => {
    return this.searchTerm().trim().replace(/\s+/g, ' ');
  });

  readonly showAddOption = computed(() => {
    const normalizedSearch = this.normalizedSearchTerm();

    // Don't show if empty after normalization
    if (!normalizedSearch) return false;

    // Check if there's an exact match with the normalized search term
    const filtered = this.filteredMerchants();
    const hasExactMatch = filtered.some((merchant) => merchant.name.toLowerCase() === normalizedSearch.toLowerCase());

    return !hasExactMatch;
  });

  readonly selectedSystemPayee = computed(() => {
    const type = this.transactionType();
    if (type === 'starting_balance' || type === 'balance_adjustment') {
      return SYSTEM_PAYEES.find((p) => p.type === type) ?? null;
    }
    return null;
  });

  readonly hasSelection = computed(() => {
    return (
      !!this.selectedBankAccountId() ||
      !!this.merchantId() ||
      !!this.pendingMerchantName() ||
      !!this.selectedSystemPayee()
    );
  });

  readonly displayIcon = computed(() => {
    const systemPayee = this.selectedSystemPayee();
    if (systemPayee) {
      return 'system';
    }

    if (this.selectedBankAccountId()) {
      return 'bank';
    }
    return 'merchant';
  });

  // Determines "To" or "From" prefix for bank account transfers based on transaction amount
  // Negative amount (outflow) = "To", Positive amount (inflow) = "From"
  readonly transferDirectionPrefix = computed(() => {
    const amount = this.transactionAmount();
    return amount < 0 ? 'Transfer to' : 'Transfer from';
  });

  readonly displayPayee = computed(() => {
    // Show system payee if selected
    const systemPayee = this.selectedSystemPayee();
    if (systemPayee) {
      return systemPayee.label;
    }

    // Show pending merchant name if currently being created
    const pendingName = this.pendingMerchantName();
    if (pendingName) {
      return pendingName;
    }

    // Show bank account if selected
    const bankAccount = this.selectedBankAccount();
    if (bankAccount) {
      return `${this.transferDirectionPrefix()} ${bankAccount.name}`;
    }

    // Show merchant if selected
    const merchant = this.selectedMerchant();
    if (merchant) {
      return merchant.name;
    }

    // If no selection, show the original statement name if available
    const originalName = this.originalStatementName();
    if (originalName) {
      return originalName;
    }

    // Use custom placeholder if provided, otherwise use default
    const customPlaceholder = this.placeholder();
    if (customPlaceholder) {
      return customPlaceholder;
    }
    return this.allowNone() ? 'Payee' : 'Select payee';
  });

  readonly originalStatementName = computed(() => {
    const details = this.transactionImportDetails();
    if (!details) return null;

    // Prefer merchantName, fall back to originalStatement and deprecated field
    return details.merchantName ?? details.originalStatement ?? details.name ?? null;
  });

  readonly showOriginalStatementGroup = computed(() => {
    // Show group if:
    // 1. We have import details with a name
    // 2. Not currently searching (to avoid confusion)
    return !!this.originalStatementName() && !this.searchTerm().trim();
  });

  normalizeSearchTerm(term: string): string {
    return term.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  getMerchantInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  onSearchChange(value: string) {
    this.searchTerm.set(value);
  }

  onValueChange(value: string | null | undefined) {
    if (!value) return;

    if (value === 'original-statement' || value === 'no-merchant') {
      this.selectMerchant(null);
    } else if (value === 'add-new') {
      this.selectNewMerchant(this.searchTerm());
    } else if (value.startsWith('bank:')) {
      const accountId = value.slice(5);
      const account = this.availableBankAccounts().find((a) => a._id === accountId);
      if (account) this.selectBankAccount(account);
    } else if (value.startsWith('system:')) {
      const systemType = value.slice(7);
      const payee = SYSTEM_PAYEES.find((p) => p.type === systemType);
      if (payee) this.selectSystemPayee(payee);
    } else if (value.startsWith('merchant:')) {
      const merchantId = value.slice(9);
      const merchant = this.merchants().find((m) => m._id === merchantId) ?? null;
      this.selectMerchant(merchant);
    }
  }

  selectBankAccount(account: BankAccountWithRelations) {
    this.payeeChange.emit({ type: 'bankAccount', id: account._id });
    this.searchTerm.set('');
  }

  selectMerchant(merchant: Merchant | null) {
    this.payeeChange.emit({ type: 'merchant', id: merchant?._id ?? null });
    this.searchTerm.set('');
  }

  selectNewMerchant(name: string) {
    const normalizedName = name.trim().replace(/\s+/g, ' ');
    this.payeeChange.emit({ type: 'merchant', id: null, pendingName: normalizedName });
    this.searchTerm.set('');
  }

  selectSystemPayee(payee: SystemPayee): void {
    this.payeeChange.emit({
      type: 'system',
      id: null,
      systemPayeeType: payee.type,
    });
    this.searchTerm.set('');
  }

  // Public method to focus the trigger button
  focus(): void {
    this.triggerButton()?.nativeElement.focus();
  }
}
