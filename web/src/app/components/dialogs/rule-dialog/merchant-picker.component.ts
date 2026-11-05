import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { Id } from 'convex/_generated/dataModel';
import { nucleoCheck as Check, NucleoIcon, nucleoShop as Store } from '@kualia/icons';
import { Merchant, MerchantService } from '../../../services/merchant.service';

@Component({
  selector: 'app-rule-merchant-picker',
  imports: [NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      [value]="merchantId()"
      (valueChange)="selectMerchant($event)"
      sideOffset="5"
      autoFocus="first-tabbable"
      [filter]="noopFilter"
    >
      <hlm-combobox-trigger class="h-9 w-full justify-between" variant="outline">
        <div class="flex min-w-0 items-center gap-2" [class.text-muted-foreground]="!selectedMerchant()">
          @if (selectedMerchant()?.logoUrl) {
            <img
              [src]="selectedMerchant()!.logoUrl!"
              [alt]="selectedMerchant()!.name"
              class="h-5 w-5 flex-shrink-0 rounded-full border object-cover"
            />
          } @else if (selectedMerchant()) {
            <div class="bg-accent/50 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border">
              <nucleo-icon [icon]="Store" class="text-muted-foreground" size="12" />
            </div>
          }
          <span class="min-w-0 truncate">{{ displayMerchant() }}</span>
        </div>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="!max-h-100 !w-100 **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input
            placeholder="Search merchants..."
            [showTrigger]="false"
            (input)="searchQuery.set($any($event.target).value)"
          />
        </div>
        <div hlmComboboxList>
          <div hlmComboboxGroup>
            @for (merchant of filteredMerchants(); track merchant._id) {
              <hlm-combobox-item [value]="merchant._id">
                <div class="flex w-full min-w-0 items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-2">
                    @if (merchant.logoUrl) {
                      <img
                        [src]="merchant.logoUrl"
                        [alt]="merchant.name"
                        class="h-5 w-5 flex-shrink-0 rounded-full border object-cover"
                      />
                    } @else {
                      <div
                        class="bg-accent/50 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border"
                      >
                        <nucleo-icon [icon]="Store" class="text-muted-foreground" size="12" />
                      </div>
                    }
                    <span class="min-w-0 truncate text-left">{{ merchant.name }}</span>
                  </div>
                  <div class="flex flex-shrink-0 items-center gap-2">
                    @if (merchant.transactionCount && merchant.transactionCount > 0) {
                      <span class="text-muted-foreground text-[10px]">({{ merchant.transactionCount }})</span>
                    }
                    @if (merchant._id === merchantId()) {
                      <nucleo-icon [icon]="Check" size="14" />
                    }
                  </div>
                </div>
              </hlm-combobox-item>
            }
          </div>
        </div>
        <hlm-combobox-empty>No merchants found.</hlm-combobox-empty>
      </div>
    </hlm-combobox>
  `,
})
export class RuleMerchantPickerComponent {
  private readonly merchantService = inject(MerchantService);

  readonly Check = Check;
  readonly Store = Store;

  // No-op filter to disable combobox internal filtering (we handle filtering ourselves)
  readonly noopFilter = () => true;

  readonly merchantId = input<Id<'merchant'> | null>(null);

  readonly merchantChange = output<Id<'merchant'>>();

  readonly searchQuery = signal<string>('');

  readonly merchants = computed(() => this.merchantService.activeMerchants());

  readonly selectedMerchant = computed(() => {
    const id = this.merchantId();
    if (!id) return null;
    return this.merchants().find((m: Merchant) => m._id === id) ?? null;
  });

  readonly displayMerchant = computed(() => {
    const merchant = this.selectedMerchant();
    return merchant?.name ?? 'Select Merchant';
  });

  readonly filteredMerchants = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const merchantList = this.merchants();

    if (!query) {
      return merchantList;
    }

    return merchantList.filter((m: Merchant) => m.name.toLowerCase().includes(query));
  });

  selectMerchant(merchantId: string | null | undefined): void {
    if (merchantId) {
      this.merchantChange.emit(merchantId as Id<'merchant'>);
    }
  }
}
