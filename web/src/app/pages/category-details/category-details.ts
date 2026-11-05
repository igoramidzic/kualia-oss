import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { nucleoLock as Lock, NucleoIcon } from '@kualia/icons';
import { IconPickerComponent } from '../../components/icon-picker/icon-picker.component';
import { Category, CategoryService } from '../../services/category.service';
import { CurrencyService } from '../../services/currency.service';
import { IconService } from '../../services/icon.service';
import { NavigationService } from '../../services/navigation.service';
import { WorkspaceService } from '../../services/workspace.service';
import { CategoryOverviewPageService } from './category-overview-page.service';

@Component({
  selector: 'app-category-details',
  imports: [IconPickerComponent, NucleoIcon, RouterLink, HlmBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './category-details.html',
})
export class CategoryDetailsComponent {
  private readonly navigationService = inject(NavigationService);
  private readonly categoryConvexService = inject(CategoryService);
  private readonly categoryPageService = inject(CategoryOverviewPageService);
  private readonly iconService = inject(IconService);
  private readonly currencyService = inject(CurrencyService);
  private readonly workspaceService = inject(WorkspaceService);

  readonly category = this.categoryPageService.category;
  readonly loading = this.categoryPageService.isLoading;
  readonly categoryTransactions = this.categoryPageService.recentTransactions;

  readonly categoryName = signal<string>('');
  readonly categoryType = signal<'income' | 'expense' | 'transfer' | 'credit_card'>('expense');
  readonly categoryIcon = signal<string>('Box');
  protected readonly systemCategoryIcon = Lock;
  readonly saving = signal(false);
  readonly savingIcon = signal(false);
  readonly error = signal<string | null>(null);

  // Get stats from category
  readonly totalTransactions = computed(() => {
    const category = this.category();
    if (!category || !('transactionCount' in category)) return 0;
    return category.transactionCount;
  });

  readonly totalAmount = computed(() => {
    const category = this.category();
    if (!category || !('totalAmount' in category)) return 0;
    return this.toNumber(category.totalAmount);
  });

  constructor() {
    // Update categoryName and categoryType when category changes
    effect(() => {
      const category = this.category();
      if (category) {
        this.categoryName.set(category.name);
        this.categoryType.set(category.type);
        this.categoryIcon.set(category.iconName ?? 'Box');
      }
    });
  }

  protected toNumber(value: bigint): number {
    return Number(value);
  }

  onNameInput() {
    // Track changes but don't save yet
    // We'll save on blur or Enter key
  }

  onNameFocus(event: FocusEvent) {
    // Place cursor at the end of the text
    const target = event.target as HTMLElement;
    const range = document.createRange();
    const selection = window.getSelection();

    if (selection && target.childNodes.length > 0) {
      range.selectNodeContents(target);
      range.collapse(false); // false = collapse to end
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  onNameBlur(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const newName = target.textContent?.trim() ?? '';

    if (newName && newName !== this.category()?.name) {
      this.categoryName.set(newName);
      void this.saveCategoryName();
    } else {
      // Revert to original name if empty
      target.textContent = this.category()?.name ?? '';
    }
  }

  onNameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = event.target as HTMLElement;
      target.blur();
    }
  }

  private async saveCategoryName() {
    const currentCategory = this.category();
    const newName = this.categoryName().trim();

    if (!currentCategory || !newName || newName === currentCategory.name) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      const success = await this.categoryConvexService.updateCategory(currentCategory._id, { name: newName });

      if (success) {
        // Wait for subscription to update
        await new Promise((resolve) => setTimeout(resolve, 100));
        const updatedCategory = this.categoryConvexService
          .categories()
          .find((c: Category) => c._id === currentCategory._id);
        if (updatedCategory) {
          // TODO: navigateToCategory method doesn't exist yet - comment out for now
          // Update the URL with the new slug
          // const newSlug = this.generateSlug(updatedCategory.name, updatedCategory._id);
          // void this.navigationService.navigateToCategory(newSlug, 'details', { replaceUrl: true });
        }
      } else {
        throw new Error(this.categoryConvexService.error() ?? 'Failed to save category name');
      }
    } catch (err) {
      this.error.set('Failed to save category name');
      console.error('Error updating category:', err);
      // Revert the name on error
      this.categoryName.set(currentCategory.name);
      // Also update the contenteditable element
      const element = document.querySelector('[role="textbox"]');
      if (element) {
        element.textContent = currentCategory.name;
      }
    } finally {
      this.saving.set(false);
    }
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

  formatAmount(amount: number): string {
    return this.currencyService.format(amount);
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

  getTransactionRoute(transactionId: string): string {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) return '';
    return `/${workspaceShortId}/transactions/${transactionId}`;
  }

  async onIconChange(iconName: string) {
    const currentCategory = this.category();
    if (!currentCategory || iconName === currentCategory.iconName) {
      return;
    }

    this.savingIcon.set(true);
    this.error.set(null);

    try {
      const success = await this.categoryConvexService.updateCategory(currentCategory._id, { iconName });
      if (success) {
        this.categoryIcon.set(iconName);
      } else {
        throw new Error('Update failed');
      }
    } catch (err) {
      this.error.set('Failed to update category icon');
      console.error('Error updating category icon:', err);
      // Revert the icon on error
      this.categoryIcon.set(currentCategory.iconName ?? 'Box');
    } finally {
      this.savingIcon.set(false);
    }
  }

  getIconData(iconName: string) {
    return this.iconService.getIconByName(iconName);
  }
}
