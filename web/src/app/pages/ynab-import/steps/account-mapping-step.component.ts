import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import {
  nucleoMoney as Banknote,
  nucleoBank as Building2,
  nucleoCreditCard as CreditCard,
  NucleoIcon,
  nucleoPiggyBank as PiggyBank,
  nucleoTrendUp as TrendingUp,
  nucleoAccounts as Wallet,
  type NucleoIconData,
} from '@kualia/icons';
import { CurrencySelectorComponent } from '../../../components/currency-selector/currency-selector.component';
import type { AccountTypeMapping, ImportPreview } from '../../../services/ynab-import.service';
import { ACCOUNT_TYPE_OPTIONS } from '../types';

// Account type prefix to icon mapping
const ACCOUNT_TYPE_ICONS: Record<string, NucleoIconData> = {
  credit_: CreditCard,
  investment_: TrendingUp,
  loan_: Building2,
  banking_savings: PiggyBank,
  banking_cash: Wallet,
};

@Component({
  selector: 'app-account-mapping-step',
  imports: [FormsModule, HlmSelectImports, NucleoIcon, HlmInput, CurrencySelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <!-- Import Settings -->
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="min-w-0">
          <label for="workspace-name" class="text-foreground mb-2 block text-sm font-medium">Workspace Name</label>
          <input
            id="workspace-name"
            hlmInput
            type="text"
            class="w-full"
            [ngModel]="workspaceName()"
            (ngModelChange)="workspaceNameChanged.emit($event)"
            placeholder="Enter workspace name"
          />
        </div>

        <div class="min-w-0">
          <label for="ynab-import-currency" class="text-foreground mb-2 block text-sm font-medium">Currency</label>
          <app-currency-selector
            id="ynab-import-currency"
            [selectedCurrency]="currency()"
            (currencyChange)="currencyChanged.emit($event)"
          />
        </div>
      </div>

      <!-- Preview Stats -->
      @if (preview()) {
        <div class="bg-muted/50 grid grid-cols-2 gap-4 rounded-lg p-4 sm:grid-cols-4">
          <div class="text-center">
            <p class="text-2xl font-bold">{{ preview()!.accountCount }}</p>
            <p class="text-muted-foreground text-sm">Accounts</p>
          </div>
          <div class="text-center">
            <p class="text-2xl font-bold">{{ preview()!.monthCount }}</p>
            <p class="text-muted-foreground text-sm">Months</p>
          </div>
          <div class="text-center">
            <p class="text-2xl font-bold">{{ preview()!.categoryCount }}</p>
            <p class="text-muted-foreground text-sm">Categories</p>
          </div>
          <div class="text-center">
            <p class="text-2xl font-bold">{{ preview()!.transactionCount }}</p>
            <p class="text-muted-foreground text-sm">Transactions</p>
          </div>
        </div>
      }

      <!-- Account Type Mappings -->
      <div>
        <h3 class="text-foreground mb-4 font-medium">Account Types</h3>
        <p class="text-muted-foreground mb-4 text-sm">
          We've detected these accounts. Please confirm or adjust the account type for each.
        </p>

        <div class="space-y-3">
          @for (mapping of accountMappings(); track mapping.accountName) {
            <div class="border-border flex items-center gap-4 rounded-lg border p-4">
              <!-- Account Icon -->
              <div class="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <nucleo-icon [icon]="getAccountIcon(mapping.confirmedType)" class="h-5 w-5" />
              </div>

              <!-- Account Name -->
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ mapping.accountName }}</p>
                @if (mapping.inferredType !== null && mapping.inferredType !== mapping.confirmedType) {
                  <p class="text-muted-foreground text-xs">
                    Originally detected: {{ getTypeLabel(mapping.inferredType) }}
                  </p>
                }
              </div>

              <!-- Account Type Selector -->
              <hlm-select [value]="mapping.confirmedType" (valueChange)="onTypeChange(mapping.accountName, $event)">
                <hlm-select-trigger class="w-full">
                  <hlm-select-value />
                </hlm-select-trigger>
                <hlm-select-content *hlmSelectPortal>
                  @for (option of accountTypeOptions; track option.value) {
                    <hlm-select-item [value]="option.value">{{ option.label }}</hlm-select-item>
                  }
                </hlm-select-content>
              </hlm-select>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class AccountMappingStepComponent {
  protected readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;

  readonly accountMappings = input<AccountTypeMapping[]>([]);
  readonly preview = input<ImportPreview | null>(null);
  readonly workspaceName = input<string>('');
  readonly currency = input<string>('USD');

  readonly accountTypeChanged = output<{ accountName: string; accountType: string }>();
  readonly workspaceNameChanged = output<string>();
  readonly currencyChanged = output<string>();

  onTypeChange(accountName: string, accountType: string | null | undefined): void {
    if (!accountType) return;

    this.accountTypeChanged.emit({ accountName, accountType });
  }

  getTypeLabel(type: string | null): string {
    if (type === null) {
      return 'Unknown';
    }
    const option = ACCOUNT_TYPE_OPTIONS.find((o) => o.value === type);
    return option?.label ?? type;
  }

  getAccountIcon(type: string | null): NucleoIconData {
    if (type === null) {
      return Banknote;
    }
    // Check exact match first, then prefix match
    if (ACCOUNT_TYPE_ICONS[type]) {
      return ACCOUNT_TYPE_ICONS[type];
    }
    for (const [prefix, icon] of Object.entries(ACCOUNT_TYPE_ICONS)) {
      if (type.startsWith(prefix)) {
        return icon;
      }
    }
    // Default for banking_checking and others
    return Banknote;
  }
}
