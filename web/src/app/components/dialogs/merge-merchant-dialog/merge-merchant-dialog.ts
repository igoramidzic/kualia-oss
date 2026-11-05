import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BrnCommand, BrnCommandEmpty, BrnCommandGroup, BrnCommandList } from '@spartan-ng/brain/command';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoArrowDown as ArrowDown,
  nucleoSort as ArrowUpDown,
  nucleoChevronRight as ChevronRight,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoPlus as Plus,
  nucleoShop as Store,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { Merchant, MerchantService } from '../../../services/merchant.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

type ViewMode = 'setup' | 'picker';
type MerchantDialogMode = 'merge' | 'delete';

@Component({
  selector: 'app-merge-merchant-dialog',
  imports: [
    HlmButton,
    NucleoIcon,
    HlmDialogHeader,
    HlmDialogFooter,
    BrnCommand,
    BrnCommandEmpty,
    BrnCommandGroup,
    BrnCommandList,
    HlmCommandImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>{{ dialogTitle() }}</h2>
    </hlm-dialog-header>

    @if (viewMode() === 'setup') {
      <!-- Setup View -->
      <div class="space-y-4 p-4">
        <!-- Source Merchant Section -->
        <div class="space-y-2">
          <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ sourceLabel() }}</span>
          <div class="bg-accent/30 rounded-lg p-3">
            <div class="flex items-center gap-3">
              <!-- Logo -->
              @if (currentSource()?.logoUrl) {
                <img
                  [src]="currentSource()!.logoUrl!"
                  [alt]="currentSource()!.name"
                  class="h-10 w-10 rounded-full border object-cover"
                />
              } @else {
                <div class="bg-accent flex h-10 w-10 items-center justify-center rounded-full border">
                  <nucleo-icon [icon]="Store" class="text-muted-foreground" size="16" />
                </div>
              }

              <!-- Name and transaction count -->
              <div class="min-w-0 flex-1">
                <p class="font-medium break-all">{{ currentSource()?.name }}</p>
                <p class="text-muted-foreground text-sm" [class.line-through]="currentTarget()">
                  {{ referenceSummary(currentSource()) }}
                </p>
              </div>

              <!-- Delete indicator -->
              <nucleo-icon [icon]="Trash2" class="text-warning flex-shrink-0" size="20" />
            </div>

            <!-- Warning text -->
            <p class="text-muted-foreground mt-2 text-xs">{{ sourceWarningText() }}</p>
          </div>
        </div>

        <!-- Swap Button or Arrow -->
        <div class="flex justify-center">
          @if (currentTarget() && !isDeleteMode()) {
            <button hlmBtn size="sm" variant="outline" class="gap-2" (click)="swapMerchants()" [disabled]="merging()">
              <nucleo-icon [icon]="ArrowUpDown" size="14" />
              Swap
            </button>
          } @else {
            <nucleo-icon [icon]="ArrowDown" class="text-muted-foreground" size="20" />
          }
        </div>

        <!-- Target Merchant Section -->
        <div class="space-y-2">
          <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ targetLabel() }}</span>

          @if (currentTarget(); as target) {
            <!-- Target selected - clickable to change -->
            <button
              class="bg-accent/30 hover:bg-accent/50 w-full rounded-lg p-3 text-left transition-colors"
              (click)="openPicker()"
              [disabled]="merging()"
            >
              <div class="flex items-center gap-3">
                <!-- Logo -->
                @if (target.logoUrl) {
                  <img [src]="target.logoUrl" [alt]="target.name" class="h-10 w-10 rounded-full border object-cover" />
                } @else {
                  <div class="bg-accent flex h-10 w-10 items-center justify-center rounded-full border">
                    <nucleo-icon [icon]="Store" class="text-muted-foreground" size="16" />
                  </div>
                }

                <!-- Name and transaction count -->
                <div class="min-w-0 flex-1">
                  <p class="font-medium break-all">{{ target.name }}</p>
                  <p class="text-muted-foreground text-sm">
                    {{ referenceSummary(target) }}
                  </p>
                  <p class="text-primary text-sm">+{{ referenceSummary(currentSource()) }}</p>
                </div>

                <!-- Chevron -->
                <nucleo-icon [icon]="ChevronRight" class="text-muted-foreground flex-shrink-0" size="16" />
              </div>
            </button>
          } @else {
            <!-- No target - show select button -->
            <button
              class="bg-accent/30 hover:bg-accent/50 w-full rounded-lg p-3 text-left transition-colors"
              (click)="openPicker()"
            >
              <div class="flex items-center gap-3">
                <div class="bg-accent flex h-10 w-10 items-center justify-center rounded-full border">
                  <nucleo-icon [icon]="Plus" class="text-muted-foreground" size="16" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">Select Merchant</p>
                  <p class="text-muted-foreground text-sm">{{ selectTargetDescription() }}</p>
                </div>
                <nucleo-icon [icon]="ChevronRight" class="text-muted-foreground flex-shrink-0" size="16" />
              </div>
            </button>
          }
        </div>

        <!-- Error message -->
        @if (error()) {
          <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
            <p class="text-sm">{{ error() }}</p>
          </div>
        }
      </div>

      <hlm-dialog-footer>
        @if (currentTarget()) {
          <button hlmBtn size="sm" (click)="confirmAction()" [disabled]="merging()">
            @if (merging()) {
              <nucleo-icon [icon]="LoaderCircle" class="mr-2 h-4 w-4 animate-spin" />
              {{ loadingText() }}
            } @else {
              {{ primaryActionText() }}
            }
          </button>
        }
      </hlm-dialog-footer>
    } @else {
      <!-- Picker View -->
      <div class="max-h-[400px] min-h-[200px] overflow-hidden p-3">
        <hlm-command
          class="border-border rounded-md border"
          [filter]="customFilter"
          [search]="searchTerm()"
          (searchChange)="onSearchChange($event)"
        >
          <hlm-command-input placeholder="Search merchants..." />
          <div *brnCommandEmpty hlmCommandEmpty>
            <span class="text-muted-foreground text-sm">No merchants found.</span>
          </div>
          <hlm-command-list class="max-h-[250px]">
            <hlm-command-group>
              @for (merchant of filteredMerchants(); track merchant._id) {
                <button
                  hlm-command-item
                  [value]="merchant.name"
                  (selected)="selectTarget(merchant)"
                  class="flex w-full items-center justify-between"
                >
                  <div class="flex items-center gap-2">
                    @if (merchant.logoUrl) {
                      <img
                        [src]="merchant.logoUrl"
                        [alt]="merchant.name"
                        class="h-6 w-6 rounded-full border object-cover"
                      />
                    } @else {
                      <div class="bg-accent/50 flex h-6 w-6 items-center justify-center rounded-full border">
                        <nucleo-icon [icon]="Store" class="text-muted-foreground" size="12" />
                      </div>
                    }
                    <span>{{ merchant.name }}</span>
                  </div>
                  <span class="text-muted-foreground text-xs">{{ referenceSummary(merchant) }}</span>
                </button>
              }
            </hlm-command-group>
          </hlm-command-list>
        </hlm-command>
      </div>

      <hlm-dialog-footer>
        <button hlmBtn size="sm" variant="outline" (click)="closePicker()">Back</button>
      </hlm-dialog-footer>
    }
  `,
})
export class MergeMerchantDialogComponent {
  protected readonly Store = Store;
  protected readonly ArrowDown = ArrowDown;
  protected readonly ArrowUpDown = ArrowUpDown;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Plus = Plus;
  protected readonly Trash2 = Trash2;
  protected readonly LoaderCircle = LoaderCircle;

  private readonly merchantService = inject(MerchantService);
  protected readonly dialogContext = injectBrnDialogContext<{
    merchant: Merchant;
    mode?: MerchantDialogMode;
    onClose: (completed?: boolean) => void;
  }>();

  private readonly initialMerchant = this.dialogContext.merchant;
  private readonly mode: MerchantDialogMode = this.dialogContext.mode ?? 'merge';

  // Track current source and target IDs (for swapping)
  protected readonly currentSourceId = signal<string>(this.initialMerchant._id);
  protected readonly currentTargetId = signal<string | null>(null);

  protected readonly viewMode = signal<ViewMode>('setup');
  protected readonly searchTerm = signal('');
  protected readonly merging = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly isDeleteMode = computed(() => this.mode === 'delete');
  protected readonly dialogTitle = computed(() => {
    if (this.viewMode() === 'picker') {
      return 'Select Merchant';
    }
    return this.isDeleteMode() ? 'Move & Delete Merchant' : 'Merge Merchant';
  });
  protected readonly sourceLabel = computed(() =>
    this.isDeleteMode() ? 'Delete this merchant' : 'Merge this merchant'
  );
  protected readonly targetLabel = computed(() =>
    this.isDeleteMode() ? 'Move activity to this merchant' : 'Into this merchant'
  );
  protected readonly sourceWarningText = computed(() =>
    this.isDeleteMode()
      ? 'This merchant will be deleted after its activity is moved'
      : 'This merchant will be deleted after merging'
  );
  protected readonly selectTargetDescription = computed(() =>
    this.isDeleteMode() ? 'Choose the merchant to move activity to' : 'Choose the merchant to merge into'
  );
  protected readonly primaryActionText = computed(() => (this.isDeleteMode() ? 'Move & Delete' : 'Merge Merchants'));
  protected readonly loadingText = computed(() => (this.isDeleteMode() ? 'Deleting...' : 'Merging...'));

  // Get current source merchant from the service
  protected readonly currentSource = computed(() => {
    const sourceId = this.currentSourceId();
    return this.merchantService.activeMerchants().find((m) => m._id === sourceId) ?? null;
  });

  // Get current target merchant from the service
  protected readonly currentTarget = computed(() => {
    const targetId = this.currentTargetId();
    if (!targetId) return null;
    return this.merchantService.activeMerchants().find((m) => m._id === targetId) ?? null;
  });

  // Get all merchants except the current source and filter by search term
  protected readonly filteredMerchants = computed(() => {
    const merchants = this.merchantService.activeMerchants();
    const search = this.searchTerm().toLowerCase().trim();
    const sourceId = this.currentSourceId();

    // Exclude source merchant and filter by search
    let filtered = merchants.filter((m) => m._id !== sourceId && !m.globalMerchantId);

    if (search) {
      filtered = filtered.filter((m) => m.name.toLowerCase().includes(search));
    }

    // Sort by transaction count
    return filtered.sort((a, b) => b.transactionCount - a.transactionCount);
  });

  // Custom filter for command component - we handle filtering ourselves
  protected readonly customFilter = () => true;

  openPicker(): void {
    this.searchTerm.set('');
    this.viewMode.set('picker');
  }

  closePicker(): void {
    this.viewMode.set('setup');
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  selectTarget(merchant: Merchant): void {
    this.currentTargetId.set(merchant._id);
    this.viewMode.set('setup');
  }

  swapMerchants(): void {
    if (this.isDeleteMode()) return;

    const currentSourceId = this.currentSourceId();
    const currentTargetId = this.currentTargetId();
    if (!currentTargetId) return;

    this.currentSourceId.set(currentTargetId);
    this.currentTargetId.set(currentSourceId);
  }

  referenceSummary(merchant: Merchant | null | undefined): string {
    const transactionCount = merchant?.transactionCount ?? 0;
    const recurringCount = merchant?.activeRecurringTransactionCount ?? 0;
    const transactionText = `${transactionCount} transaction${transactionCount === 1 ? '' : 's'}`;

    if (recurringCount === 0) {
      return transactionText;
    }

    const recurringText = `${recurringCount} recurring template${recurringCount === 1 ? '' : 's'}`;
    if (transactionCount === 0) {
      return recurringText;
    }

    return `${transactionText} · ${recurringText}`;
  }

  async confirmAction(): Promise<void> {
    const sourceId = this.currentSourceId();
    const targetId = this.currentTargetId();
    if (!targetId || this.merging()) return;

    this.merging.set(true);
    this.error.set(null);

    try {
      if (this.isDeleteMode()) {
        await this.merchantService.deleteMerchant(sourceId as Id<'merchant'>, targetId as Id<'merchant'>);
      } else {
        await this.merchantService.mergeMerchants(sourceId as Id<'merchant'>, targetId as Id<'merchant'>);
      }
      this.dialogContext.onClose(true);
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to update merchants'));
      this.merging.set(false);
    }
  }
}
