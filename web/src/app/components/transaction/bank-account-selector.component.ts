import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { NucleoIcon, nucleoBank as Wallet } from '@kualia/icons';
import { BankAccountService } from '../../services/bank-account.service';
import { DEFAULT_BANK_ACCOUNT_ICON_NAME } from '../../shared/utils/entity-identity';
import { EntityMarkComponent } from '../entity-mark/entity-mark.component';

const NO_ACCOUNT_VALUE = '__NO_ACCOUNT__';

@Component({
  selector: 'app-bank-account-selector',
  imports: [NucleoIcon, EntityMarkComponent, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      [value]="comboboxValue()"
      (valueChange)="selectBankAccount($event)"
      [filter]="filterBankAccount"
      [itemToString]="bankAccountToString"
      [disabled]="disabled()"
      sideOffset="5"
      autoFocus="first-tabbable"
    >
      <hlm-combobox-trigger [class]="buttonClass()" [variant]="variant()" [showIcon]="false" stopPropagation>
        <span class="flex items-center gap-2">
          @if (selectedBankAccount(); as account) {
            <app-entity-mark
              [mode]="account.visualIdentityMode"
              [logoUrl]="account.resolvedLogoUrl"
              [iconName]="account.iconName ?? defaultBankAccountIconName"
              [iconColorId]="account.iconColorId"
              [defaultIconName]="defaultBankAccountIconName"
              [alt]="account.name"
              size="xxs"
            />
          } @else {
            <nucleo-icon [icon]="Wallet" [size]="14" class="text-muted-foreground" />
          }
          <span>{{ displayBankAccount() }}</span>
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="w-[250px] **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input placeholder="Search bank accounts..." [showTrigger]="false" />
        </div>
        <div hlmComboboxList>
          <div hlmComboboxGroup>
            @if (allowNone()) {
              <hlm-combobox-item [value]="NO_ACCOUNT_VALUE">
                <span class="text-muted-foreground">No bank account</span>
              </hlm-combobox-item>
            }
            @for (account of bankAccounts(); track account._id) {
              <hlm-combobox-item [value]="account._id">
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
                  <span class="min-w-0 truncate">{{ account.name }}</span>
                </div>
              </hlm-combobox-item>
            }
          </div>
        </div>
        <hlm-combobox-empty>No bank accounts found.</hlm-combobox-empty>
      </div>
    </hlm-combobox>
  `,
})
export class BankAccountSelectorComponent {
  // Injected services
  private readonly bankAccountConvexService = inject(BankAccountService);

  // Constants
  readonly NO_ACCOUNT_VALUE = NO_ACCOUNT_VALUE;
  readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;

  // Inputs
  readonly bankAccountId = input<string | null>(null);
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('outline');
  readonly buttonClass = input<string>('w-fit justify-between text-xs');
  readonly allowNone = input<boolean>(true);
  /** Bank account IDs to exclude from the list (e.g., transfer pair account for transfers) */
  readonly excludeAccountIds = input<string[]>([]);
  /** Hide accounts that have been closed */
  readonly hideClosed = input<boolean>(false);

  // Output
  readonly bankAccountChange = output<string | null>();

  // Icons
  readonly Wallet = Wallet;

  // Computed values
  readonly bankAccounts = computed(() => {
    const excludeIds = this.excludeAccountIds();
    const hideClosed = this.hideClosed();
    let accounts = this.bankAccountConvexService.activeBankAccounts();
    if (hideClosed) {
      accounts = accounts.filter((account) => !account.isClosed);
    }
    if (excludeIds.length === 0) {
      return accounts;
    }
    return accounts.filter((account) => !excludeIds.includes(account._id));
  });

  readonly selectedBankAccount = computed(() => {
    const id = this.bankAccountId();
    if (!id) return null;
    return this.bankAccounts().find((account) => account._id === id) ?? null;
  });

  readonly displayBankAccount = computed(() => {
    const account = this.selectedBankAccount();
    if (!account) {
      return this.allowNone() ? 'No account' : 'Select account';
    }
    return account.name;
  });

  // Convert bankAccountId to combobox value (handle null -> special value)
  readonly comboboxValue = computed(() => {
    const id = this.bankAccountId();
    return id ?? (this.allowNone() ? NO_ACCOUNT_VALUE : '');
  });

  // Filter function for combobox
  filterBankAccount = (value: string, search: string): boolean => {
    if (value === NO_ACCOUNT_VALUE) {
      return 'no bank account'.includes(search.toLowerCase());
    }
    const account = this.bankAccounts().find((a) => a._id === value);
    if (!account) return false;
    return account.name.toLowerCase().includes(search.toLowerCase());
  };

  // Convert value to display string
  bankAccountToString = (value: string): string => {
    if (value === NO_ACCOUNT_VALUE) return 'No bank account';
    const account = this.bankAccounts().find((a) => a._id === value);
    return account?.name ?? value;
  };

  selectBankAccount(value: string | null | undefined) {
    if (value === undefined) return;

    const accountId = value === NO_ACCOUNT_VALUE ? null : value;
    this.bankAccountChange.emit(accountId);
  }
}
