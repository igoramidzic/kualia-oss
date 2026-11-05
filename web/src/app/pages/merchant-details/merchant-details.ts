import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BrnDialogState } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { nucleoTransfer as ArrowLeftRight, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { EntityMarkComponent } from '../../components/entity-mark/entity-mark.component';
import { LogoPickerComponent } from '../../components/logo-picker/logo-picker.component';
import { TransactionRowBriefComponent } from '../../components/transaction-row/transaction-row-brief';
import { BankAccountService } from '../../services/bank-account.service';
import { CategoryService } from '../../services/category.service';
import { CurrencyService } from '../../services/currency.service';
import { MerchantService, type Merchant } from '../../services/merchant.service';
import {
  DEFAULT_MERCHANT_ICON_NAME,
  EntityIconColorId,
  randomEntityIconColorId,
  VisualIdentityMode,
} from '../../shared/utils/entity-identity';
import { HlmCardImports } from '../../ui/card/src';
import { MerchantPageService } from '../merchant/merchant-page.service';

type LoadedMerchant = Exclude<Merchant, null>;

export interface MerchantIdentitySource {
  readonly logoUrl?: string;
  readonly rawLogoUrl?: string | null;
  readonly globalMerchantLogoUrl?: string;
  readonly visualIdentityMode?: VisualIdentityMode;
  readonly iconName?: string;
  readonly iconColorId?: EntityIconColorId;
}

export interface MerchantIdentityUpdate {
  readonly logoUrl?: string | null;
  readonly visualIdentityMode?: VisualIdentityMode;
  readonly iconName?: string;
  readonly iconColorId?: EntityIconColorId;
}

export interface MerchantIdentityPatch {
  readonly logoUrl: string | undefined;
  readonly rawLogoUrl: string | null | undefined;
  readonly visualIdentityMode: VisualIdentityMode;
  readonly iconName: string | undefined;
  readonly iconColorId: EntityIconColorId | undefined;
}

export function buildOptimisticMerchantIdentityPatch(
  merchant: MerchantIdentitySource,
  updates: MerchantIdentityUpdate
): MerchantIdentityPatch {
  let logoUrl = merchant.logoUrl;
  let rawLogoUrl = merchant.rawLogoUrl;
  let visualIdentityMode = updates.visualIdentityMode ?? merchant.visualIdentityMode ?? 'logo';

  if ('logoUrl' in updates) {
    visualIdentityMode = 'logo';

    if (updates.logoUrl === null) {
      logoUrl = undefined;
      rawLogoUrl = null;
    } else if (updates.logoUrl === 'UNSET') {
      logoUrl = merchant.globalMerchantLogoUrl;
      rawLogoUrl = undefined;
    } else {
      logoUrl = updates.logoUrl;
      rawLogoUrl = updates.logoUrl;
    }
  }

  return {
    logoUrl,
    rawLogoUrl,
    visualIdentityMode,
    iconName: updates.iconName ?? merchant.iconName,
    iconColorId: updates.iconColorId ?? merchant.iconColorId,
  };
}

interface MerchantIdentitySaveOptions {
  readonly successMessage?: string;
  readonly errorMessage: string;
  readonly consoleMessage: string;
  readonly showErrorToast?: boolean;
}

@Component({
  selector: 'app-merchant-details',
  imports: [
    RouterLink,
    FormsModule,
    NucleoIcon,
    EntityMarkComponent,
    LogoPickerComponent,
    BrnPopover,
    BrnPopoverTrigger,
    BrnPopoverContent,
    HlmPopoverContent,
    TransactionRowBriefComponent,
    HlmCardImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './merchant-details.html',
})
export class MerchantDetailsComponent {
  private readonly merchantPageService = inject(MerchantPageService);
  private readonly merchantService = inject(MerchantService);
  private readonly categoryService = inject(CategoryService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly currencyService = inject(CurrencyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly defaultMerchantIconName = DEFAULT_MERCHANT_ICON_NAME;

  readonly merchant = this.merchantPageService.merchant;
  readonly isLoading = this.merchantPageService.isLoading;

  private isDestroyed = false;

  readonly merchantName = signal<string>('');
  readonly merchantLogoUrl = signal<string | undefined>(undefined);
  readonly savingName = signal(false);
  readonly savingLogoUrl = signal(false);
  readonly logoPickerState = signal<BrnDialogState>('closed');
  private iconColorAssignmentInFlight = false;
  private identitySaveSequence = 0;

  // Computed state to determine logo status
  readonly logoState = computed(() => {
    const merchant = this.merchant();
    if (!merchant) return 'no-merchant' as const;

    const rawLogoUrl = 'rawLogoUrl' in merchant ? merchant.rawLogoUrl : undefined;
    const globalLogoUrl = 'globalMerchantLogoUrl' in merchant ? merchant.globalMerchantLogoUrl : undefined;

    if (rawLogoUrl === null) {
      // User explicitly removed the logo
      return 'removed' as const;
    } else if (rawLogoUrl === undefined) {
      // Using global merchant logo (if available)
      return globalLogoUrl ? ('default' as const) : ('no-logo' as const);
    } else {
      // Custom logo override
      return 'custom' as const;
    }
  });

  // Computed property to get default logo URL (from global merchant)
  readonly defaultLogoUrl = computed(() => {
    const merchant = this.merchant();
    if (!merchant) return undefined;

    const globalLogoUrl = 'globalMerchantLogoUrl' in merchant ? merchant.globalMerchantLogoUrl : undefined;
    return globalLogoUrl;
  });

  readonly merchantTransactions = this.merchantPageService.recentTransactions;
  readonly transactionsLoading = this.merchantPageService.transactionsLoading;

  // Get stats directly from merchant (calculated by Convex)
  readonly totalSpent = computed(() => {
    const merchant = this.merchant();
    if (!merchant || !('totalSpent' in merchant)) return 0;
    return this.toNumber(merchant.totalSpent ?? 0n);
  });

  // Suggested categories resolved from IDs
  readonly suggestedCategories = computed(() => {
    const merchant = this.merchant();
    if (!merchant || !('suggestedCategoryIds' in merchant)) return [];
    const suggestionIds = merchant.suggestedCategoryIds;
    if (!suggestionIds || suggestionIds.length === 0) return [];

    const allCategories = this.categoryService.categories();
    return suggestionIds
      .map((id) => allCategories.find((c) => c._id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
  });

  // Suggested bank account resolved from ID
  readonly suggestedBankAccount = computed(() => {
    const merchant = this.merchant();
    if (!merchant || !('suggestedBankAccountId' in merchant)) return null;
    const suggestionId = merchant.suggestedBankAccountId;
    if (!suggestionId) return null;

    const bankAccounts = this.bankAccountService.bankAccounts();
    return bankAccounts.find((a) => a._id === suggestionId) ?? null;
  });

  // Whether to show the suggestions section
  readonly hasSuggestions = computed(() => {
    return this.suggestedCategories().length > 0 || this.suggestedBankAccount() !== null;
  });

  // Comma-separated list of suggested category names
  readonly suggestedCategoriesText = computed(() => {
    return this.suggestedCategories()
      .map((c) => c.name)
      .join(', ');
  });

  protected toNumber(value: bigint): number {
    return Number(value);
  }

  protected safeSetSignal<T>(signal: { set: (value: T) => void }, value: T): void {
    if (!this.isDestroyed) {
      signal.set(value);
    }
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
    });

    // Initialize form values when merchant changes
    effect(() => {
      const merchant = this.merchant();
      if (merchant && !this.isDestroyed) {
        this.merchantName.set(merchant.name);
        this.merchantLogoUrl.set(merchant.logoUrl);
      }
    });
  }

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
    const merchant = this.merchant();

    if (!merchant) return;

    // Compare against the current saved name (merchantName signal), not the original merchant object
    const currentSavedName = this.merchantName();

    if (newName && newName !== currentSavedName) {
      // Save the new name (this will update merchantName signal on success)
      void this.saveMerchantName(newName);
    } else {
      // Reset to the current saved name
      target.textContent = currentSavedName;
    }
  }

  onNameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = event.target as HTMLElement;
      target.blur();
    }
  }

  private async saveMerchantName(newName: string) {
    const merchant = this.merchant();

    if (!merchant || !newName) return;

    // Get the current saved name for rollback
    const previousName = this.merchantName();

    this.safeSetSignal(this.savingName, true);

    try {
      await this.merchantService.updateMerchant(merchant._id, {
        name: newName,
      });

      // Update local signal with the new saved name
      this.safeSetSignal(this.merchantName, newName);
      // Update the page service with the new name so the header and URL update
      this.merchantPageService.setMerchantNameEdit(newName);
      toast.success('Merchant name updated');
    } catch (err: unknown) {
      // Extract error message from ConvexError or fallback to generic message
      const errorMessage = err instanceof Error ? err.message : 'Failed to update merchant name';
      toast.error(errorMessage);
      const element = document.querySelector('[role="textbox"]');
      if (element) {
        element.textContent = previousName;
      }
      console.error('Error updating merchant name:', err);
    } finally {
      this.safeSetSignal(this.savingName, false);
    }
  }

  async onLogoUrlBlur() {
    const merchant = this.merchant();
    if (!merchant) return;

    const newLogoUrl = this.merchantLogoUrl()?.trim();
    if (newLogoUrl === merchant.logoUrl) return;

    await this.saveMerchantIdentity(
      {
        logoUrl: newLogoUrl && newLogoUrl.length > 0 ? newLogoUrl : null,
      },
      {
        successMessage: 'Merchant logo updated',
        errorMessage: 'Failed to update merchant logo',
        consoleMessage: 'Error updating merchant logo:',
      }
    );
  }

  async onLogoChange(logoUrl: string | null) {
    await this.saveMerchantIdentity(
      {
        logoUrl,
      },
      {
        successMessage: 'Merchant logo updated',
        errorMessage: 'Failed to update merchant logo',
        consoleMessage: 'Error updating merchant logo:',
      }
    );
  }

  /**
   * Remove custom logo override and fall back to global merchant logo
   */
  async removeCustomLogo() {
    await this.saveMerchantIdentity(
      {
        logoUrl: 'UNSET',
      },
      {
        successMessage: 'Reset to default logo',
        errorMessage: 'Failed to reset logo',
        consoleMessage: 'Error resetting logo:',
      }
    );
  }

  /**
   * Explicitly set no logo (even if global merchant has one)
   */
  async removeDefaultLogo() {
    await this.saveMerchantIdentity(
      {
        logoUrl: null,
      },
      {
        successMessage: 'Logo removed',
        errorMessage: 'Failed to remove logo',
        consoleMessage: 'Error removing logo:',
      }
    );
  }

  /**
   * Reset to use global merchant logo
   */
  async resetToDefaultLogo() {
    await this.saveMerchantIdentity(
      {
        logoUrl: 'UNSET',
      },
      {
        successMessage: 'Logo restored to default',
        errorMessage: 'Failed to reset logo',
        consoleMessage: 'Error resetting logo:',
      }
    );
  }

  async onIdentityModeChange(mode: VisualIdentityMode): Promise<void> {
    const merchant = this.merchant();
    if (!merchant) return;

    const updates: {
      visualIdentityMode: VisualIdentityMode;
      iconName?: string;
      iconColorId?: EntityIconColorId;
    } = {
      visualIdentityMode: mode,
    };

    if (mode === 'icon') {
      updates.iconName = merchant.iconName ?? DEFAULT_MERCHANT_ICON_NAME;
      updates.iconColorId = merchant.iconColorId ?? randomEntityIconColorId();
    }

    await this.saveMerchantIdentity(updates, {
      errorMessage: 'Failed to update merchant identity',
      consoleMessage: 'Error updating merchant identity:',
    });
  }

  async onIconChange(iconName: string): Promise<void> {
    const merchant = this.merchant();
    if (!merchant) return;

    await this.saveMerchantIdentity(
      {
        visualIdentityMode: 'icon',
        iconName,
        iconColorId: merchant.iconColorId ?? randomEntityIconColorId(),
      },
      {
        errorMessage: 'Failed to update merchant identity',
        consoleMessage: 'Error updating merchant identity:',
      }
    );
  }

  async onIconColorChange(iconColorId: EntityIconColorId): Promise<void> {
    const merchant = this.merchant();
    if (!merchant) return;

    await this.saveMerchantIdentity(
      {
        visualIdentityMode: 'icon',
        iconName: merchant.iconName ?? DEFAULT_MERCHANT_ICON_NAME,
        iconColorId,
      },
      {
        errorMessage: 'Failed to update merchant identity',
        consoleMessage: 'Error updating merchant identity:',
      }
    );
  }

  private async saveMerchantIdentity(
    updates: MerchantIdentityUpdate,
    options: MerchantIdentitySaveOptions
  ): Promise<void> {
    const merchant = this.merchant();
    if (!merchant) return;

    const previousMerchant = merchant;
    const saveSequence = ++this.identitySaveSequence;
    const optimisticMerchant = this.applyMerchantIdentityPatch(merchant, updates);

    this.setCurrentMerchant(optimisticMerchant);
    this.safeSetSignal(this.savingLogoUrl, true);

    try {
      await this.merchantService.updateMerchant(merchant._id, updates);
      if (options.successMessage) {
        toast.success(options.successMessage);
      }
    } catch (err: unknown) {
      if (saveSequence === this.identitySaveSequence) {
        this.setCurrentMerchant(previousMerchant);
      }
      const errorMessage = err instanceof Error ? err.message : options.errorMessage;
      if (options.showErrorToast ?? true) {
        toast.error(errorMessage);
      }
      console.error(options.consoleMessage, err);
    } finally {
      if (saveSequence === this.identitySaveSequence) {
        this.safeSetSignal(this.savingLogoUrl, false);
      }
    }
  }

  private applyMerchantIdentityPatch(merchant: LoadedMerchant, updates: MerchantIdentityUpdate): LoadedMerchant {
    return {
      ...merchant,
      ...buildOptimisticMerchantIdentityPatch(merchant, updates),
    };
  }

  private setCurrentMerchant(merchant: LoadedMerchant): void {
    if (!this.isDestroyed) {
      this.merchantPageService.setCurrentMerchant(merchant);
    }
  }

  private async ensureMerchantIconColor(): Promise<void> {
    const merchant = this.merchant();
    if (!merchant || merchant.iconColorId || this.iconColorAssignmentInFlight) return;

    this.iconColorAssignmentInFlight = true;

    try {
      await this.saveMerchantIdentity(
        {
          iconColorId: randomEntityIconColorId(),
        },
        {
          errorMessage: 'Failed to assign merchant icon color',
          consoleMessage: 'Error assigning merchant icon color:',
          showErrorToast: false,
        }
      );
    } finally {
      this.iconColorAssignmentInFlight = false;
    }
  }

  formatAmount(amount: number): string {
    return this.currencyService.format(amount);
  }

  onLogoPickerStateChanged(state: BrnDialogState): void {
    this.logoPickerState.set(state);
    if (state === 'open') {
      void this.ensureMerchantIconColor();
    }
  }

  closeLogoPicker(): void {
    this.logoPickerState.set('closed');
  }
}
