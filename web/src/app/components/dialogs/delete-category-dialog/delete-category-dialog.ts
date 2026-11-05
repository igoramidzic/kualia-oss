import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BudgetMonthService } from '../../../services/budget-month.service';
import { Category, CategoryService } from '../../../services/category.service';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { MoveMoneyCategoryPickerComponent } from '../../budget/available-amount-button/move-money-category-picker.component';

interface CategoryWithTransactionCount {
  category: Category;
  transactionCount: bigint;
}

interface DialogContext {
  categories: Category[];
  transactionCounts?: Map<string, bigint>; // Optional map of categoryId -> transactionCount
  onClose: (deleted?: boolean) => void;
}

@Component({
  selector: 'app-delete-category-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter, MoveMoneyCategoryPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">
        {{ categoriesToDelete().length === 1 ? 'Delete Category' : 'Delete Categories' }}
      </h2>
    </hlm-dialog-header>

    <div class="p-3">
      @if (categoriesWithCounts().length === 1) {
        @if (categoriesWithCounts()[0]; as categoryData) {
          <p class="text-muted-foreground text-sm">
            Are you sure you want to delete
            <span class="text-foreground font-medium">{{ categoryData.category.name }}</span
            >?
          </p>

          @if (hasSingleCategoryWithTransactions()) {
            <div class="border-primary/20 bg-primary/10 mt-4 rounded-lg border p-3">
              <p class="text-sm font-medium">
                This category is assigned to {{ formatTransactionCount(categoryData.transactionCount) }} transaction{{
                  isPlural(categoryData.transactionCount)
                }}.
              </p>
              <p class="text-muted-foreground mt-2 text-sm">
                You need to move or re-categorize
                {{ isSingular(categoryData.transactionCount) ? 'this' : 'these' }} transaction{{
                  isPlural(categoryData.transactionCount)
                }}
                before deleting.
              </p>
            </div>

            <div class="mt-4">
              <div class="text-foreground mb-2 block text-sm font-medium">
                Move {{ formatTransactionCount(categoryData.transactionCount) }} transaction{{
                  isPlural(categoryData.transactionCount)
                }}
                to:
              </div>
              <app-move-money-category-picker
                [selectedCategoryId]="selectedNewCategoryId()"
                [excludeCategoryId]="categoriesToDeleteIds()"
                [yearMonth]="yearMonth()"
                [hideReadyToAssign]="true"
                [disabled]="deleting()"
                (categorySelected)="onCategorySelected($event)"
              />
            </div>
          }
        }
      } @else {
        <p class="text-muted-foreground mb-3 text-sm">
          Are you sure you want to delete {{ categoriesWithCounts().length }} categories?
        </p>

        @if (hasMultipleCategoriesWithTransactions()) {
          <div class="border-primary/20 bg-primary/10 mt-4 mb-4 rounded-lg border p-3">
            <p class="text-sm font-medium">
              These categories are assigned to {{ formatTransactionCount(totalTransactionCount()) }} transaction{{
                isPlural(totalTransactionCount())
              }}
              in total.
            </p>
            <p class="text-muted-foreground mt-2 text-sm">
              You need to move or re-categorize these transactions before deleting.
            </p>
          </div>

          <div class="bg-muted mb-4 max-h-48 overflow-y-auto rounded-lg border">
            <table class="w-full text-sm">
              <thead class="bg-accent/50 text-xs uppercase">
                <tr>
                  <th class="border-border border-b px-3 py-2 text-left font-medium">Category</th>
                  <th class="border-border border-b px-3 py-2 text-right font-medium">Transactions</th>
                </tr>
              </thead>
              <tbody>
                @for (categoryData of categoriesWithCounts(); track categoryData.category._id) {
                  <tr class="border-border border-b last:border-0">
                    <td class="px-3 py-2">{{ categoryData.category.name }}</td>
                    <td class="text-muted-foreground px-3 py-2 text-right tabular-nums">
                      {{ formatTransactionCount(categoryData.transactionCount) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="mt-4">
            <div class="text-foreground mb-2 block text-sm font-medium">Move all transactions to:</div>
            <app-move-money-category-picker
              [selectedCategoryId]="selectedNewCategoryId()"
              [excludeCategoryId]="categoriesToDeleteIds()"
              [yearMonth]="yearMonth()"
              [hideReadyToAssign]="true"
              [disabled]="deleting()"
              (categorySelected)="onCategorySelected($event)"
            />
          </div>
        }
      }

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 mt-4 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="cancel()">Cancel</button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDelete()" [disabled]="deleting() || !canDelete()">
        @if (deleting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Deleting...
        } @else {
          Delete
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DeleteCategoryDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly categoryService = inject(CategoryService);
  private readonly budgetMonthService = inject(BudgetMonthService);
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  protected readonly categoriesToDelete = signal<Category[]>(this.dialogContext.categories);
  protected readonly categoriesToDeleteIds = computed(() => this.categoriesToDelete().map((c) => c._id));
  protected readonly transactionCounts = signal<Map<string, bigint>>(
    this.dialogContext.transactionCounts ?? new Map<string, bigint>()
  );

  protected readonly categoriesWithCounts = computed<CategoryWithTransactionCount[]>(() => {
    const counts = this.transactionCounts();
    return this.categoriesToDelete().map((category) => ({
      category,
      transactionCount: counts.get(category._id) ?? 0n,
    }));
  });

  protected readonly totalTransactionCount = computed(() => {
    return this.categoriesWithCounts().reduce((sum, c) => sum + c.transactionCount, 0n);
  });

  protected readonly hasSingleCategoryWithTransactions = computed(() => {
    return this.categoriesWithCounts().length === 1 && this.categoriesWithCounts()[0].transactionCount > 0n;
  });

  protected readonly hasMultipleCategoriesWithTransactions = computed(() => {
    return this.totalTransactionCount() > 0n;
  });

  protected readonly selectedNewCategoryId = signal<Id<'category'> | null>(null);
  protected readonly yearMonth = computed(() => this.budgetMonthService.getLastViewedMonth());

  protected readonly canDelete = computed(() => {
    const hasTransactions = this.totalTransactionCount() > 0n;
    // Can delete if no transactions, or if there are transactions and a new category is selected
    return !hasTransactions || (hasTransactions && this.selectedNewCategoryId() !== null);
  });

  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);

  // Track deletion promise for toast handling
  private deletionPromise: Promise<void> | null = null;
  private dialogClosed = false;

  constructor() {
    // When component is destroyed (dialog closes), check if deletion is in progress
    this.destroyRef.onDestroy(() => {
      // If deletion is in progress and we haven't already shown the toast
      if (this.deleting() && this.deletionPromise && !this.dialogClosed) {
        this.dialogClosed = true;
        const categoryCount = this.categoriesToDelete().length;
        const categoryText = categoryCount === 1 ? 'category' : 'categories';

        toast.promise(this.deletionPromise, {
          loading: `Deleting ${categoryCount} ${categoryText}...`,
          success: `Successfully deleted ${categoryCount} ${categoryText}`,
          error: 'Failed to delete categories',
        });
      }
    });
  }

  formatTransactionCount(count: bigint): string {
    return count.toString();
  }

  isPlural(count: bigint): string {
    return count === 1n ? '' : 's';
  }

  isSingular(count: bigint): boolean {
    return count === 1n;
  }

  onCategorySelected(categoryId: Id<'category'> | 'ready-to-assign'): void {
    // Only allow selecting a regular category, not ready-to-assign
    // (categories being deleted are already filtered out by the picker)
    if (categoryId !== 'ready-to-assign') {
      this.selectedNewCategoryId.set(categoryId);
    } else {
      this.selectedNewCategoryId.set(null);
    }
  }

  cancel(): void {
    // If deletion is in progress, show promise toast
    if (this.deleting() && this.deletionPromise) {
      this.dialogClosed = true;
      const categoryCount = this.categoriesToDelete().length;
      const categoryText = categoryCount === 1 ? 'category' : 'categories';

      toast.promise(this.deletionPromise, {
        loading: `Deleting ${categoryCount} ${categoryText}...`,
        success: `Successfully deleted ${categoryCount} ${categoryText}`,
        error: 'Failed to delete categories',
      });
    }
    this.dialogContext.onClose(false);
  }

  async confirmDelete(): Promise<void> {
    if (this.deleting() || !this.canDelete()) {
      return;
    }

    this.deleting.set(true);
    this.error.set(null);

    // Create and store the deletion promise
    this.deletionPromise = (async () => {
      try {
        const workspaceId = this.workspaceService.workspaceId();
        if (!workspaceId) {
          throw new Error('No workspace selected');
        }

        const hasTransactions = this.totalTransactionCount() > 0n;
        const newCategoryId = hasTransactions ? this.selectedNewCategoryId() : undefined;

        // Call the deleteCategoriesWithRecategorization mutation with timeout handling
        await this.convexService.mutation(api.categories.deleteCategoriesWithRecategorization, {
          workspaceId: workspaceId as Id<'workspace'>,
          categoryIds: this.categoriesToDeleteIds(),
          newCategoryId: newCategoryId ?? undefined,
        });
        // If dialog is still open, show success toast
        if (!this.dialogClosed) {
          const categoryCount = this.categoriesToDelete().length;
          const categoryText = categoryCount === 1 ? 'category' : 'categories';
          toast.success(`Successfully deleted ${categoryCount} ${categoryText}`);
          this.dialogClosed = true; // Prevent onDestroy from showing another toast
        }

        this.dialogContext.onClose(true);
      } catch (err: unknown) {
        this.error.set(extractConvexErrorMessage(err, 'Failed to delete categories'));
        this.deleting.set(false);
        throw err; // Re-throw for promise toast to catch
      }
    })();

    await this.deletionPromise;
  }
}
