import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrnCommand, BrnCommandEmpty, BrnCommandGroup, BrnCommandList } from '@spartan-ng/brain/command';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmDialogFooter } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import {
  nucleoCheck as Check,
  nucleoChevronDown as ChevronDown,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
} from '@kualia/icons';
import { BankAccountService } from '../../../services/bank-account.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

interface AccountTypeOption {
  value: string;
  label: string;
}

interface AccountTypeGroup {
  label: string;
  options: AccountTypeOption[];
}

@Component({
  selector: 'app-bank-account-manual-form',
  imports: [
    FormsModule,
    BrnCommand,
    BrnCommandEmpty,
    BrnCommandGroup,
    BrnCommandList,
    BrnPopover,
    BrnPopoverContent,
    BrnPopoverTrigger,
    HlmCommandImports,
    HlmButton,
    HlmPopoverContent,
    NucleoIcon,
    HlmDialogFooter,
    HlmLabel,
    HlmInput,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-3">
      <div class="space-y-6">
        <div class="space-y-2">
          <label hlmLabel for="accountName">Bank Account Name</label>
          <input
            hlmInput
            type="text"
            id="accountName"
            placeholder="Enter account name"
            [value]="bankAccountName()"
            (input)="onNameInputChange($event)"
            [disabled]="creating()"
            class="w-full"
          />
          @if (nameError()) {
            <p class="text-destructive text-sm">{{ nameError() }}</p>
          }
        </div>

        <div class="space-y-2">
          <label hlmLabel>Account Type</label>
          <brn-popover
            [state]="accountTypePopoverState()"
            (stateChanged)="accountTypePopoverState.set($event)"
            sideOffset="5"
          >
            <button
              type="button"
              hlmBtn
              variant="outline"
              class="w-full justify-between"
              [disabled]="creating()"
              brnPopoverTrigger
            >
              <span [class]="(accountType() ? '' : 'text-muted-foreground') + ' min-w-0 flex-1 truncate text-left'">
                {{ getSelectedAccountTypeName() ?? 'Select account type...' }}
              </span>
              <nucleo-icon [icon]="ChevronDown" [size]="16" class="text-muted-foreground" />
            </button>
            <hlm-command
              *brnPopoverContent="let ctx"
              hlmPopoverContent
              class="!w-[var(--radix-popover-trigger-width)] p-0"
              [search]="accountTypeSearchQuery()"
              (searchChange)="accountTypeSearchQuery.set($event)"
            >
              <hlm-command-input placeholder="Search account types..." />
              <div *brnCommandEmpty hlmCommandEmpty>No account types found.</div>
              <hlm-command-list class="max-h-60">
                @for (group of filteredAccountTypeGroups(); track group.label) {
                  @if (group.options.length > 0) {
                    <hlm-command-group class="min-w-0 overflow-hidden">
                      <hlm-command-group-label class="max-w-full min-w-0 overflow-hidden">
                        <span class="inline-block max-w-full truncate">{{ group.label }}</span>
                      </hlm-command-group-label>
                      @for (option of group.options; track option.value) {
                        <button
                          hlm-command-item
                          [value]="option.label"
                          (selected)="selectAccountType(option.value)"
                          class="flex w-full items-center justify-between"
                        >
                          <span class="min-w-0 flex-1 truncate text-left">{{ option.label }}</span>
                          @if (option.value === accountType()) {
                            <nucleo-icon [icon]="Check" [size]="14" class="flex-shrink-0" />
                          }
                        </button>
                      }
                    </hlm-command-group>
                  }
                }
              </hlm-command-list>
            </hlm-command>
          </brn-popover>
          @if (accountTypeError()) {
            <p class="text-destructive text-sm">{{ accountTypeError() }}</p>
          }
        </div>

        <div class="space-y-2">
          <label hlmLabel for="startingBalance">Starting Balance (optional)</label>
          <input
            hlmInput
            type="number"
            id="startingBalance"
            placeholder="0.00"
            step="0.01"
            [value]="startingBalance()"
            (input)="onStartingBalanceChange($event)"
            [disabled]="creating()"
            class="w-full"
          />
          <p class="text-muted-foreground text-xs">Enter the current balance of this account</p>
        </div>
      </div>
    </div>

    <hlm-dialog-footer class="flex-col flex-row justify-end">
      <button hlmBtn type="button" variant="outline" class="w-auto" (click)="cancelled.emit()" [disabled]="creating()">
        Cancel
      </button>
      <button
        hlmBtn
        type="button"
        variant="default"
        class="w-auto"
        [disabled]="!canSave() || creating()"
        (click)="createBankAccount()"
      >
        @if (creating()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Creating...
        } @else {
          Create Bank Account
        }
      </button>
    </hlm-dialog-footer>
  `,
  styles: [
    `
      .ProseMirror.editor {
        cursor: text;
      }

      .ProseMirror.editor:focus {
        outline: none;
      }

      .text-node.editor-placeholder::before {
        content: attr(data-empty-text);
        color: hsl(var(--muted-foreground));
        pointer-events: none;
        position: absolute;
        opacity: 0.5;
      }

      .ProseMirror-trailingBreak {
        display: inline;
      }

      .text-node {
        position: relative;
        margin: 0;
      }
    `,
  ],
})
export class BankAccountManualFormComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly ChevronDown = ChevronDown;
  protected readonly Check = Check;

  private readonly bankAccountConvexService = inject(BankAccountService);

  readonly cancelled = output<void>();
  readonly errorOccurred = output<string>();

  private readonly _creating = signal<boolean>(false);
  readonly creating = this._creating.asReadonly();
  readonly bankAccountName = signal<string>('');
  readonly nameError = signal<string | null>(null);
  readonly accountType = signal<string>('');
  readonly accountTypeError = signal<string | null>(null);
  readonly accountTypePopoverState = signal<'open' | 'closed'>('closed');
  readonly accountTypeSearchQuery = signal<string>('');
  readonly startingBalance = signal<string>('');

  readonly accountTypeGroups = signal<AccountTypeGroup[]>([
    {
      label: 'Cash',
      options: [
        { value: 'banking_checking', label: 'Checking' },
        { value: 'banking_savings', label: 'Savings' },
        { value: 'banking_cash', label: 'Cash' },
        { value: 'banking_money_market', label: 'Money Market' },
        { value: 'banking_cd', label: 'CD' },
        { value: 'banking_other', label: 'Other' },
      ],
    },
    {
      label: 'Credit',
      options: [
        { value: 'credit_credit_card', label: 'Credit Card' },
        { value: 'credit_line_of_credit', label: 'Line of Credit' },
        { value: 'credit_other', label: 'Other' },
      ],
    },
    {
      label: 'Investment',
      options: [
        { value: 'investment_brokerage', label: 'Brokerage' },
        { value: 'investment_401k', label: '401(k)' },
        { value: 'investment_ira', label: 'IRA' },
        { value: 'investment_roth_ira', label: 'Roth IRA' },
        { value: 'investment_roth_401k', label: 'Roth 401(k)' },
        { value: 'investment_hsa', label: 'HSA' },
        { value: 'investment_529_plan', label: '529 Plan' },
        { value: 'investment_403b', label: '403(b)' },
        { value: 'investment_other', label: 'Other' },
      ],
    },
    {
      label: 'Loan',
      options: [
        { value: 'loan_auto', label: 'Auto' },
        { value: 'loan_mortgage', label: 'Mortgage' },
        { value: 'loan_student', label: 'Student' },
        { value: 'loan_home_equity', label: 'Home Equity' },
        { value: 'loan_other', label: 'Other' },
      ],
    },
  ]);

  readonly filteredAccountTypeGroups = computed(() => {
    const query = this.accountTypeSearchQuery().toLowerCase().trim();
    if (!query) {
      return this.accountTypeGroups();
    }

    return this.accountTypeGroups()
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => option.label.toLowerCase().includes(query)),
      }))
      .filter((group) => group.options.length > 0);
  });

  onNameInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.bankAccountName.set(input.value);
    this.nameError.set(null);
  }

  onStartingBalanceChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.startingBalance.set(input.value);
  }

  selectAccountType(value: string): void {
    this.accountType.set(value);
    this.accountTypeError.set(null);
    this.accountTypePopoverState.set('closed');
    this.accountTypeSearchQuery.set('');
  }

  getSelectedAccountTypeName(): string | null {
    const selectedValue = this.accountType();
    if (!selectedValue) return null;

    for (const group of this.accountTypeGroups()) {
      const option = group.options.find((opt) => opt.value === selectedValue);
      if (option) {
        return option.label;
      }
    }
    return null;
  }

  canSave(): boolean {
    const name = this.bankAccountName().trim();
    const type = this.accountType();
    return name.length > 0 && name.length <= 100 && type.length > 0;
  }

  async createBankAccount() {
    const name = this.bankAccountName().trim();
    const type = this.accountType();
    const balanceStr = this.startingBalance();

    if (!name) {
      this.nameError.set('Bank account name is required');
      return;
    }

    if (name.length > 100) {
      this.nameError.set('Bank account name must be less than 100 characters');
      return;
    }

    if (!type) {
      this.accountTypeError.set('Account type is required');
      return;
    }

    try {
      this._creating.set(true);
      this.nameError.set(null);
      this.accountTypeError.set(null);

      // Convert starting balance to cents (bigint)
      let initialBalance: bigint | undefined;
      if (balanceStr) {
        const balanceNum = parseFloat(balanceStr);
        if (!isNaN(balanceNum)) {
          initialBalance = BigInt(Math.round(balanceNum * 100));
        }
      }

      // Format today's date in local timezone (YYYY-MM-DD)
      // Note: We can't use toISOString() because it converts to UTC which may shift the date
      const now = new Date();
      const localDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const newBankAccountId = await this.bankAccountConvexService.createBankAccount({
        name,
        accountType: type,
        initialBalance,
        initialBalanceDate: initialBalance !== undefined ? localDateStr : undefined,
      });

      if (!newBankAccountId) {
        throw new Error('Failed to create bank account');
      }

      // Get the created bank account from the service
      const newBankAccount = await this.bankAccountConvexService.getBankAccount(newBankAccountId);
      if (!newBankAccount) {
        throw new Error('Failed to retrieve created bank account');
      }

      // Close the dialog - the orchestrator will handle this via the cancelled output
      this.cancelled.emit();
    } catch (error: unknown) {
      console.error('Error creating bank account:', error);
      const errorMessage = extractConvexErrorMessage(error, 'Failed to create bank account');
      this.nameError.set(errorMessage);
      this.errorOccurred.emit(errorMessage);
    } finally {
      this._creating.set(false);
    }
  }
}
