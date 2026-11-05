import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BrnCommand, BrnCommandEmpty, BrnCommandGroup, BrnCommandList } from '@spartan-ng/brain/command';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import {
  nucleoWarningCircle as AlertCircle,
  nucleoArrowLeft as ArrowLeft,
  nucleoMoney as Banknote,
  nucleoBank as Building2,
  nucleoCheck as Check,
  nucleoCheckCircle as CheckCircle2,
  nucleoChevronDown as ChevronDown,
  nucleoCreditCard as CreditCard,
  nucleoTable as FileSpreadsheet,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoParty as PartyPopper,
  nucleoPiggyBank as PiggyBank,
  nucleoTrendUp as TrendingUp,
  nucleoUpload as Upload,
  nucleoAccounts as Wallet,
  nucleoCloseCircle as XCircle,
  type NucleoIconData,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { YnabImportService } from '../../../services/ynab-import.service';
import { getShortId } from '../../../shared/utils/id-utils';
import { HlmProgress, HlmProgressIndicator } from '../../../ui/progress/src';
import { CurrencySelectorComponent } from '../../currency-selector/currency-selector.component';

// Step definitions
enum YnabImportStep {
  Upload = 0,
  AccountMapping = 1,
  Importing = 2,
  Complete = 3,
}

const TOTAL_STEPS = 4;

// Account type options
interface AccountTypeOption {
  value: string;
  label: string;
}

interface AccountTypeGroup {
  label: string;
  options: AccountTypeOption[];
}

const ACCOUNT_TYPE_GROUPS: AccountTypeGroup[] = [
  {
    label: 'Cash',
    options: [
      { value: 'banking_checking', label: 'Checking' },
      { value: 'banking_savings', label: 'Savings' },
      { value: 'banking_cash', label: 'Cash' },
      { value: 'banking_money_market', label: 'Money Market' },
      { value: 'banking_cd', label: 'CD' },
      { value: 'banking_other', label: 'Other Cash' },
    ],
  },
  {
    label: 'Credit',
    options: [
      { value: 'credit_credit_card', label: 'Credit Card' },
      { value: 'credit_line_of_credit', label: 'Line of Credit' },
      { value: 'credit_other', label: 'Other Credit' },
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
      { value: 'investment_other', label: 'Other Investment' },
    ],
  },
  {
    label: 'Loan',
    options: [
      { value: 'loan_auto', label: 'Auto Loan' },
      { value: 'loan_mortgage', label: 'Mortgage' },
      { value: 'loan_student', label: 'Student Loan' },
      { value: 'loan_home_equity', label: 'Home Equity' },
      { value: 'loan_other', label: 'Other Loan' },
    ],
  },
];

// Account type prefix to icon mapping
const ACCOUNT_TYPE_ICONS: Record<string, NucleoIconData> = {
  credit_: CreditCard,
  investment_: TrendingUp,
  loan_: Building2,
  banking_savings: PiggyBank,
  banking_cash: Wallet,
};

interface DialogContext {
  onClose: (workspaceId?: string) => void;
}

@Component({
  selector: 'app-ynab-import-dialog',
  imports: [
    FormsModule,
    NgTemplateOutlet,
    HlmButton,
    HlmDialogHeader,
    HlmDialogFooter,
    HlmInput,
    HlmProgress,
    HlmProgressIndicator,
    NucleoIcon,
    BrnCommand,
    BrnCommandEmpty,
    BrnCommandGroup,
    BrnCommandList,
    BrnPopover,
    BrnPopoverContent,
    BrnPopoverTrigger,
    HlmCommandImports,
    HlmPopoverContent,
    CurrencySelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <div class="flex items-center gap-2">
        @if (canGoBack()) {
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground -ml-1 p-1 transition-colors"
            (click)="goBack()"
          >
            <nucleo-icon [icon]="ArrowLeft" class="h-4 w-4" />
          </button>
        }
        <div>
          <h2 class="flex items-center gap-2 text-lg font-semibold">
            {{ stepTitle() }}
            <span class="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-medium uppercase">
              Beta
            </span>
          </h2>
          @if (stepSubtitle()) {
            <p class="text-muted-foreground text-sm">{{ stepSubtitle() }}</p>
          }
        </div>
      </div>
    </hlm-dialog-header>

    <!-- Progress Bar -->
    <div class="px-4 pt-2">
      <hlm-progress class="h-1.5" [value]="progress()">
        <hlm-progress-indicator class="bg-primary transition-all duration-300" />
      </hlm-progress>
      <p class="text-muted-foreground mt-1 text-center text-xs">Step {{ currentStep() + 1 }} of {{ totalSteps }}</p>
    </div>

    <div class="max-h-[60vh] overflow-y-auto p-4">
      @switch (currentStep()) {
        <!-- Upload Step -->
        @case (YnabImportStep.Upload) {
          <div class="flex flex-col gap-4">
            <!-- Instructions -->
            <div class="bg-accent/50 rounded-lg p-3 text-sm">
              <h3 class="mb-1 font-medium">How to export from YNAB:</h3>
              <ol class="text-muted-foreground list-inside list-decimal space-y-0.5 text-xs">
                <li>Open YNAB and go to your budget</li>
                <li>Click the export icon in the top toolbar</li>
                <li>Download both the "Budget" (plan.csv) and "Register" (register.csv) files</li>
              </ol>
            </div>

            <!-- Plan CSV Upload -->
            <button
              type="button"
              class="border-border hover:border-primary/50 relative flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg border-2 p-6 transition-colors"
              [class.border-dashed]="!planCsvContent()"
              [class.border-solid]="planCsvContent()"
              [class.border-primary]="planCsvContent()"
              [class.bg-primary/5]="planCsvContent()"
              (click)="planInput.click()"
              (dragover)="onDragOver($event)"
              (drop)="onDrop($event, 'plan')"
            >
              <input #planInput type="file" accept=".csv" class="hidden" (change)="onFileSelected($event, 'plan')" />

              <div
                class="flex h-12 w-12 items-center justify-center rounded-full"
                [class.bg-primary/10]="planCsvContent()"
                [class.bg-accent]="!planCsvContent()"
              >
                @if (planCsvContent()) {
                  <nucleo-icon [icon]="Check" class="text-primary h-6 w-6" />
                } @else {
                  <nucleo-icon [icon]="FileSpreadsheet" class="text-muted-foreground h-6 w-6" />
                }
              </div>
              <div class="text-center">
                <p class="text-sm font-medium" [class.text-primary]="planCsvContent()">Upload plan.csv</p>
                <p class="text-muted-foreground text-xs">Budget assignments and category targets</p>
              </div>
              <div class="text-muted-foreground flex items-center gap-1 text-xs">
                <nucleo-icon [icon]="Upload" class="h-3 w-3" />
                <span>{{ planCsvContent() ? 'Click to replace' : 'Click or drag and drop' }}</span>
              </div>
            </button>

            <!-- Register CSV Upload -->
            <button
              type="button"
              class="border-border hover:border-primary/50 relative flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg border-2 p-6 transition-colors"
              [class.border-dashed]="!registerCsvContent()"
              [class.border-solid]="registerCsvContent()"
              [class.border-primary]="registerCsvContent()"
              [class.bg-primary/5]="registerCsvContent()"
              (click)="registerInput.click()"
              (dragover)="onDragOver($event)"
              (drop)="onDrop($event, 'register')"
            >
              <input
                #registerInput
                type="file"
                accept=".csv"
                class="hidden"
                (change)="onFileSelected($event, 'register')"
              />

              <div
                class="flex h-12 w-12 items-center justify-center rounded-full"
                [class.bg-primary/10]="registerCsvContent()"
                [class.bg-accent]="!registerCsvContent()"
              >
                @if (registerCsvContent()) {
                  <nucleo-icon [icon]="Check" class="text-primary h-6 w-6" />
                } @else {
                  <nucleo-icon [icon]="FileSpreadsheet" class="text-muted-foreground h-6 w-6" />
                }
              </div>
              <div class="text-center">
                <p class="text-sm font-medium" [class.text-primary]="registerCsvContent()">Upload register.csv</p>
                <p class="text-muted-foreground text-xs">All your transactions</p>
              </div>
              <div class="text-muted-foreground flex items-center gap-1 text-xs">
                <nucleo-icon [icon]="Upload" class="h-3 w-3" />
                <span>{{ registerCsvContent() ? 'Click to replace' : 'Click or drag and drop' }}</span>
              </div>
            </button>
          </div>
        }

        <!-- Account Mapping Step -->
        @case (YnabImportStep.AccountMapping) {
          <div class="flex flex-col gap-4">
            <!-- Import Settings -->
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="min-w-0">
                <label for="workspace-name" class="text-foreground mb-1.5 block text-sm font-medium"
                  >Workspace Name</label
                >
                <input
                  id="workspace-name"
                  hlmInput
                  type="text"
                  class="w-full"
                  [ngModel]="workspaceName()"
                  (ngModelChange)="onWorkspaceNameChanged($event)"
                  placeholder="Enter workspace name"
                />
              </div>

              <div class="min-w-0">
                <label for="ynab-dialog-currency" class="text-foreground mb-1.5 block text-sm font-medium"
                  >Currency</label
                >
                <app-currency-selector
                  id="ynab-dialog-currency"
                  [selectedCurrency]="currency()"
                  (currencyChange)="onCurrencyChanged($event)"
                />
              </div>
            </div>

            <!-- Preview Stats -->
            @if (preview()) {
              <div class="bg-accent/50 grid grid-cols-4 gap-2 rounded-lg p-3">
                <div class="text-center">
                  <p class="text-lg font-bold">{{ preview()!.accountCount }}</p>
                  <p class="text-muted-foreground text-xs">Accounts</p>
                </div>
                <div class="text-center">
                  <p class="text-lg font-bold">{{ preview()!.monthCount }}</p>
                  <p class="text-muted-foreground text-xs">Months</p>
                </div>
                <div class="text-center">
                  <p class="text-lg font-bold">{{ preview()!.categoryCount }}</p>
                  <p class="text-muted-foreground text-xs">Categories</p>
                </div>
                <div class="text-center">
                  <p class="text-lg font-bold">{{ preview()!.transactionCount }}</p>
                  <p class="text-muted-foreground text-xs">Transactions</p>
                </div>
              </div>
            }

            <!-- Account Type Mappings -->
            <div class="space-y-4">
              <!-- Needs Review Section -->
              @if (accountsNeedingReview().length > 0) {
                <div>
                  <div class="mb-2 flex items-center gap-2">
                    <nucleo-icon [icon]="AlertCircle" class="text-warning h-4 w-4" />
                    <h3 class="text-warning text-sm font-medium">Needs Review</h3>
                  </div>
                  <div class="space-y-2">
                    @for (mapping of accountsNeedingReview(); track mapping.accountName) {
                      <ng-container
                        *ngTemplateOutlet="accountMappingItem; context: { mapping: mapping, needsReview: true }"
                      />
                    }
                  </div>
                </div>
              }

              <!-- Confident Accounts Section -->
              @if (confidentAccounts().length > 0) {
                <div>
                  @if (accountsNeedingReview().length > 0) {
                    <h3 class="text-foreground mb-2 text-sm font-medium">Detected Accounts</h3>
                  } @else {
                    <h3 class="text-foreground mb-2 text-sm font-medium">Account Types</h3>
                    <p class="text-muted-foreground mb-3 text-xs">
                      Please confirm or adjust the account type for each.
                    </p>
                  }
                  <div class="space-y-2">
                    @for (mapping of confidentAccounts(); track mapping.accountName) {
                      <ng-container
                        *ngTemplateOutlet="accountMappingItem; context: { mapping: mapping, needsReview: false }"
                      />
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Account Mapping Item Template -->
            <ng-template #accountMappingItem let-mapping="mapping" let-needsReview="needsReview">
              <div
                class="flex items-center gap-3 rounded-lg border p-3"
                [class.border-border]="!needsReview"
                [class.border-warning]="needsReview"
                [class.bg-warning/5]="needsReview"
              >
                <!-- Account Icon -->
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  [class.bg-accent]="!needsReview"
                  [class.bg-warning/20]="needsReview"
                >
                  @if (needsReview) {
                    <nucleo-icon [icon]="AlertCircle" class="text-warning h-4 w-4" />
                  } @else {
                    <nucleo-icon [icon]="getAccountIcon(mapping.confirmedType)" class="h-4 w-4" />
                  }
                </div>

                <!-- Account Name -->
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ mapping.accountName }}</p>
                  @if (mapping.inferredType !== null && mapping.inferredType !== mapping.confirmedType) {
                    <p class="text-muted-foreground text-xs">Originally: {{ getTypeLabel(mapping.inferredType) }}</p>
                  }
                </div>

                <!-- Account Type Selector -->
                <brn-popover
                  [state]="getPopoverState(mapping.accountName)"
                  (stateChanged)="setPopoverState(mapping.accountName, $event)"
                  sideOffset="5"
                >
                  <button
                    type="button"
                    hlmBtn
                    variant="outline"
                    size="sm"
                    class="w-36 justify-between"
                    brnPopoverTrigger
                  >
                    <span
                      class="min-w-0 flex-1 truncate text-left text-xs"
                      [class.text-muted-foreground]="mapping.confirmedType === null"
                    >
                      {{ mapping.confirmedType === null ? 'Select type...' : getTypeLabel(mapping.confirmedType) }}
                    </span>
                    <nucleo-icon [icon]="ChevronDown" [size]="14" class="flex-shrink-0" />
                  </button>
                  <hlm-command
                    *brnPopoverContent="let ctx"
                    hlmPopoverContent
                    class="!w-[200px] p-0"
                    [search]="accountTypeSearchQuery()"
                    (searchChange)="accountTypeSearchQuery.set($event)"
                  >
                    <hlm-command-input placeholder="Search..." />
                    <div *brnCommandEmpty hlmCommandEmpty>No account types found.</div>
                    <hlm-command-list class="max-h-48">
                      @for (group of filteredAccountTypeGroups(); track group.label) {
                        @if (group.options.length > 0) {
                          <hlm-command-group class="mt-1 min-w-0 overflow-hidden pt-1 first:mt-0 first:pt-0">
                            <hlm-command-group-label
                              class="border-border text-foreground mb-1 max-w-full min-w-0 overflow-hidden border-b px-2 py-1 text-xs font-semibold"
                            >
                              <span class="inline-block max-w-full truncate">{{ group.label }}</span>
                            </hlm-command-group-label>
                            @for (option of group.options; track option.value) {
                              <button
                                hlm-command-item
                                [value]="option.label"
                                (selected)="selectAccountType(mapping.accountName, option.value)"
                                class="flex w-full items-center justify-between px-2 py-1.5"
                              >
                                <span class="text-foreground min-w-0 flex-1 truncate text-left text-xs">{{
                                  option.label
                                }}</span>
                                @if (option.value === mapping.confirmedType) {
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
              </div>
            </ng-template>
          </div>
        }

        <!-- Importing Step -->
        @case (YnabImportStep.Importing) {
          <div class="flex flex-col items-center gap-6 py-6">
            @if (importStatus(); as status) {
              @switch (status.status) {
                @case ('importing') {
                  <div class="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
                    <nucleo-icon [icon]="LoaderCircle" class="text-primary h-8 w-8 animate-spin" />
                  </div>

                  <div class="text-center">
                    <p class="font-medium">{{ status.progress?.currentStep ?? 'Processing...' }}</p>
                    <p class="text-muted-foreground mt-1 text-xs">Please don't close this window</p>
                  </div>

                  @if (status.progress) {
                    <div class="w-full max-w-sm space-y-3">
                      @if (status.progress.accountsTotal > 0) {
                        <div>
                          <div class="mb-1 flex justify-between text-xs">
                            <span>Accounts</span>
                            <span class="text-muted-foreground"
                              >{{ status.progress.accountsImported }} / {{ status.progress.accountsTotal }}</span
                            >
                          </div>
                          <hlm-progress
                            class="h-1.5"
                            [value]="
                              getProgressPercent(status.progress.accountsImported, status.progress.accountsTotal)
                            "
                          >
                            <hlm-progress-indicator class="bg-primary transition-all duration-300" />
                          </hlm-progress>
                        </div>
                      }

                      @if (status.progress.categoriesTotal > 0) {
                        <div>
                          <div class="mb-1 flex justify-between text-xs">
                            <span>Categories</span>
                            <span class="text-muted-foreground"
                              >{{ status.progress.categoriesImported }} / {{ status.progress.categoriesTotal }}</span
                            >
                          </div>
                          <hlm-progress
                            class="h-1.5"
                            [value]="
                              getProgressPercent(status.progress.categoriesImported, status.progress.categoriesTotal)
                            "
                          >
                            <hlm-progress-indicator class="bg-primary transition-all duration-300" />
                          </hlm-progress>
                        </div>
                      }

                      @if (status.progress.transactionsTotal > 0) {
                        <div>
                          <div class="mb-1 flex justify-between text-xs">
                            <span>Transactions</span>
                            <span class="text-muted-foreground"
                              >{{ status.progress.transactionsImported }} /
                              {{ status.progress.transactionsTotal }}</span
                            >
                          </div>
                          <hlm-progress
                            class="h-1.5"
                            [value]="
                              getProgressPercent(
                                status.progress.transactionsImported,
                                status.progress.transactionsTotal
                              )
                            "
                          >
                            <hlm-progress-indicator class="bg-primary transition-all duration-300" />
                          </hlm-progress>
                        </div>
                      }
                    </div>
                  }
                }
                @case ('failed') {
                  <div class="bg-destructive/10 flex h-16 w-16 items-center justify-center rounded-full">
                    <nucleo-icon [icon]="XCircle" class="text-destructive h-8 w-8" />
                  </div>
                  <div class="text-center">
                    <p class="font-medium">Import Failed</p>
                    <p class="text-muted-foreground mt-1 text-sm">
                      {{ status.errorMessage ?? 'An error occurred during import' }}
                    </p>
                  </div>
                }
                @default {
                  <div class="bg-accent flex h-16 w-16 items-center justify-center rounded-full">
                    <nucleo-icon [icon]="LoaderCircle" class="text-muted-foreground h-8 w-8 animate-spin" />
                  </div>
                  <div class="text-center">
                    <p class="font-medium">Preparing import...</p>
                  </div>
                }
              }
            } @else {
              <div class="bg-accent flex h-16 w-16 items-center justify-center rounded-full">
                <nucleo-icon [icon]="LoaderCircle" class="text-muted-foreground h-8 w-8 animate-spin" />
              </div>
              <div class="text-center">
                <p class="font-medium">Starting import...</p>
                <p class="text-muted-foreground mt-1 text-xs">Please wait</p>
              </div>
            }
          </div>
        }

        <!-- Complete Step -->
        @case (YnabImportStep.Complete) {
          <div class="flex flex-col items-center gap-6 py-6">
            <div class="bg-success/10 flex h-20 w-20 items-center justify-center rounded-full">
              <nucleo-icon [icon]="PartyPopper" class="text-success h-10 w-10" />
            </div>

            <div class="text-center">
              <h2 class="text-xl font-semibold">Welcome to Kualia!</h2>
              <p class="text-muted-foreground mt-1 text-sm">Your YNAB data has been imported successfully.</p>
            </div>

            <div class="bg-accent/50 w-full rounded-lg p-4">
              <h3 class="mb-3 text-sm font-medium">What's next?</h3>
              <ul class="space-y-2">
                <li class="flex items-start gap-2">
                  <nucleo-icon [icon]="CheckCircle2" class="text-success mt-0.5 h-4 w-4 shrink-0" />
                  <span class="text-xs">Your accounts and balances are ready</span>
                </li>
                <li class="flex items-start gap-2">
                  <nucleo-icon [icon]="CheckCircle2" class="text-success mt-0.5 h-4 w-4 shrink-0" />
                  <span class="text-xs">Categories and budget assignments imported</span>
                </li>
                <li class="flex items-start gap-2">
                  <nucleo-icon [icon]="CheckCircle2" class="text-success mt-0.5 h-4 w-4 shrink-0" />
                  <span class="text-xs">All transactions are in place</span>
                </li>
              </ul>
            </div>

            <!-- YNAB vs Kualia differences -->
            <div class="bg-muted/50 w-full rounded-lg border p-4">
              <h3 class="mb-2 text-sm font-medium">Why your numbers might look different</h3>
              <p class="text-muted-foreground text-xs leading-relaxed">
                YNAB resets negative category balances to zero each month. Kualia carries over negative balances, so
                you'll see overspending reflected in future months. This gives you a more accurate picture of your
                actual budget situation.
              </p>
              <p class="text-muted-foreground mt-3 text-xs">
                If something doesn't look right, reach out to us at
                <a href="mailto:support@kualia.com" class="text-primary hover:underline">support&#64;kualia.com</a>
                and we'll help you get it sorted out.
              </p>
            </div>
          </div>
        }
      }
    </div>

    @if (currentStep() !== YnabImportStep.Importing) {
      <hlm-dialog-footer>
        <button hlmBtn size="sm" variant="outline" (click)="cancel()" [disabled]="loading()">
          {{ currentStep() === YnabImportStep.Complete ? 'Close' : 'Cancel' }}
        </button>
        <button hlmBtn size="sm" (click)="continue()" [disabled]="!canContinue() || loading()">
          @if (loading()) {
            <nucleo-icon [icon]="LoaderCircle" class="mr-2 h-4 w-4 animate-spin" />
          }
          {{ continueButtonText() }}
        </button>
      </hlm-dialog-footer>
    }
  `,
})
export class YnabImportDialogComponent {
  protected readonly AlertCircle = AlertCircle;
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly Check = Check;
  protected readonly CheckCircle2 = CheckCircle2;
  protected readonly ChevronDown = ChevronDown;
  protected readonly FileSpreadsheet = FileSpreadsheet;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly PartyPopper = PartyPopper;
  protected readonly Upload = Upload;
  protected readonly XCircle = XCircle;
  protected readonly YnabImportStep = YnabImportStep;
  protected readonly totalSteps = TOTAL_STEPS;

  private readonly router = inject(Router);
  private readonly ynabImportService = inject(YnabImportService);
  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  // Current step
  readonly currentStep = signal<YnabImportStep>(YnabImportStep.Upload);

  // Service signals
  readonly planCsvContent = this.ynabImportService.planCsvContent;
  readonly registerCsvContent = this.ynabImportService.registerCsvContent;
  readonly accountMappings = this.ynabImportService.accountMappings;
  readonly preview = this.ynabImportService.preview;
  readonly workspaceName = this.ynabImportService.workspaceName;
  readonly currency = this.ynabImportService.currency;
  readonly parsing = this.ynabImportService.parsing;
  readonly importing = this.ynabImportService.importing;
  readonly error = this.ynabImportService.error;
  readonly importStatus = this.ynabImportService.importStatus;

  // Account type picker state
  readonly accountTypeGroups = signal<AccountTypeGroup[]>(ACCOUNT_TYPE_GROUPS);
  readonly accountTypeSearchQuery = signal<string>('');
  private readonly popoverStates = signal<Record<string, 'open' | 'closed'>>({});

  // Loading state
  readonly loading = computed(() => this.parsing() || this.importing());

  // Separate accounts by confidence
  readonly accountsNeedingReview = computed(() => this.accountMappings().filter((m) => m.inferredType === null));
  readonly confidentAccounts = computed(() => this.accountMappings().filter((m) => m.inferredType !== null));

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

  // Computed values
  readonly stepTitle = computed(() => {
    switch (this.currentStep()) {
      case YnabImportStep.Upload:
        return 'Import from YNAB';
      case YnabImportStep.AccountMapping:
        return 'Confirm Account Types';
      case YnabImportStep.Importing:
        return 'Importing Your Data';
      case YnabImportStep.Complete:
        return 'Import Complete!';
    }
  });

  readonly stepSubtitle = computed(() => {
    switch (this.currentStep()) {
      case YnabImportStep.Upload:
        return 'Export your plan.csv and register.csv from YNAB';
      case YnabImportStep.AccountMapping:
        return 'Review and adjust the detected account types';
      case YnabImportStep.Importing:
        return 'Please wait while we import your budget';
      case YnabImportStep.Complete:
        return 'Your YNAB data has been successfully imported';
    }
  });

  readonly progress = computed(() => ((this.currentStep() + 1) / TOTAL_STEPS) * 100);

  readonly canGoBack = computed(() => {
    return this.currentStep() === YnabImportStep.AccountMapping;
  });

  readonly canContinue = computed(() => {
    if (this.loading()) {
      return false;
    }

    switch (this.currentStep()) {
      case YnabImportStep.Upload:
        return !!this.planCsvContent() && !!this.registerCsvContent();
      case YnabImportStep.AccountMapping:
        // All accounts must have a type selected
        return this.accountMappings().length > 0 && this.accountMappings().every((m) => m.confirmedType !== null);
      case YnabImportStep.Importing:
        return false;
      case YnabImportStep.Complete:
        return true;
      default:
        return false;
    }
  });

  readonly continueButtonText = computed(() => {
    const step = this.currentStep();

    if (step === YnabImportStep.Upload) {
      return this.parsing() ? 'Parsing...' : 'Continue';
    }
    if (step === YnabImportStep.AccountMapping) {
      return this.importing() ? 'Starting...' : 'Start Import';
    }
    if (step === YnabImportStep.Complete) {
      return 'Go to Workspace';
    }
    return 'Continue';
  });

  constructor() {
    // Reset service state when dialog opens
    this.ynabImportService.reset();
  }

  // Popover state management
  getPopoverState(accountName: string): 'open' | 'closed' {
    return this.popoverStates()[accountName] ?? 'closed';
  }

  setPopoverState(accountName: string, state: 'open' | 'closed'): void {
    this.popoverStates.update((states) => ({ ...states, [accountName]: state }));
    if (state === 'closed') {
      this.accountTypeSearchQuery.set('');
    }
  }

  selectAccountType(accountName: string, accountType: string): void {
    this.ynabImportService.updateAccountType(accountName, accountType);
    this.setPopoverState(accountName, 'closed');
  }

  goBack(): void {
    if (this.canGoBack()) {
      this.currentStep.update((step) => step - 1);
    }
  }

  async continue(): Promise<void> {
    if (!this.canContinue() || this.loading()) {
      return;
    }

    const step = this.currentStep();

    if (step === YnabImportStep.Upload) {
      await this.parseFiles();
    } else if (step === YnabImportStep.AccountMapping) {
      await this.startImport();
    } else if (step === YnabImportStep.Complete) {
      await this.goToWorkspace();
    }
  }

  cancel(): void {
    this.ynabImportService.reset();
    this.dialogContext.onClose();
  }

  // File handling
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent, type: 'plan' | 'register'): void {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.readFile(files[0], type);
    }
  }

  onFileSelected(event: Event, type: 'plan' | 'register'): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.readFile(input.files[0], type);
    }
  }

  private readFile(file: File, type: 'plan' | 'register'): void {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      if (type === 'plan') {
        this.ynabImportService.setPlanCsv(content);
      } else {
        this.ynabImportService.setRegisterCsv(content);
      }
    };
    reader.readAsText(file);
  }

  // Account mapping handlers
  onWorkspaceNameChanged(name: string): void {
    this.ynabImportService.setWorkspaceName(name);
  }

  onCurrencyChanged(currency: string): void {
    this.ynabImportService.setCurrency(currency);
  }

  getTypeLabel(type: string | null): string {
    if (type === null) {
      return 'Unknown';
    }
    for (const group of this.accountTypeGroups()) {
      const option = group.options.find((opt) => opt.value === type);
      if (option) {
        return option.label;
      }
    }
    return type;
  }

  getAccountIcon(type: string): NucleoIconData {
    if (ACCOUNT_TYPE_ICONS[type]) {
      return ACCOUNT_TYPE_ICONS[type];
    }
    for (const [prefix, icon] of Object.entries(ACCOUNT_TYPE_ICONS)) {
      if (type.startsWith(prefix)) {
        return icon;
      }
    }
    return Banknote;
  }

  getProgressPercent(current: number, total: number): number {
    if (total === 0) return 0;
    return (current / total) * 100;
  }

  // Import flow
  private async parseFiles(): Promise<void> {
    const success = await this.ynabImportService.parseFiles();
    if (success) {
      this.currentStep.set(YnabImportStep.AccountMapping);
    } else {
      const errorMsg = this.error() ?? 'Failed to parse files';
      toast.error(errorMsg, {
        description: 'Make sure plan.csv contains budget data and register.csv contains transactions.',
      });
    }
  }

  private async startImport(): Promise<void> {
    const success = await this.ynabImportService.startImport();
    if (success) {
      this.currentStep.set(YnabImportStep.Importing);
      // Watch for completion
      this.watchImportStatus();
    } else {
      toast.error(this.error() ?? 'Failed to start import');
    }
  }

  private watchImportStatus(): void {
    const checkStatus = () => {
      const status = this.importStatus();
      if (status?.status === 'completed') {
        this.currentStep.set(YnabImportStep.Complete);
      } else if (status?.status === 'failed') {
        toast.error(status.errorMessage ?? 'Import failed');
        this.currentStep.set(YnabImportStep.AccountMapping);
      } else if (this.currentStep() === YnabImportStep.Importing) {
        // Keep checking
        setTimeout(checkStatus, 500);
      }
    };
    checkStatus();
  }

  private async goToWorkspace(): Promise<void> {
    const status = this.importStatus();
    if (status?.workspaceId) {
      this.ynabImportService.reset();
      const shortId = getShortId(status.workspaceId);
      this.dialogContext.onClose(status.workspaceId);
      await this.router.navigate([shortId, 'transactions']);
    } else {
      toast.error('Workspace not found');
    }
  }
}
