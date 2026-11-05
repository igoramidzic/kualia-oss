import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { nucleoCoins as Coins, NucleoIcon } from '@kualia/icons';
import { CurrencyInfo, getAllCurrencies, getCurrencyInfo } from '../../shared/utils/currency-info';

@Component({
  selector: 'app-currency-selector',
  imports: [NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      [value]="selectedCurrency()"
      (valueChange)="selectCurrency($event)"
      [disabled]="disabled()"
      [filter]="filterCurrency"
      [itemToString]="currencyToString"
      sideOffset="5"
      autoFocus="first-tabbable"
    >
      <hlm-combobox-trigger class="w-full max-w-full min-w-0 justify-between font-normal">
        <span class="flex min-w-0 flex-1 items-center gap-2">
          @if (selectedCurrencyInfo(); as info) {
            @if (info.flagEmoji) {
              <span class="shrink-0">{{ info.flagEmoji }}</span>
            } @else {
              <nucleo-icon [icon]="Coins" [size]="14" class="shrink-0" />
            }
            <span class="min-w-0 truncate">{{ info.code }} - {{ info.name }}</span>
          } @else {
            <nucleo-icon [icon]="Coins" [size]="14" class="shrink-0" />
            <span class="text-muted-foreground min-w-0 truncate">Select currency</span>
          }
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="w-[300px] **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent"
      >
        <div class="border-border border-b">
          <hlm-combobox-input placeholder="Search currencies..." [showTrigger]="false" />
        </div>
        <div hlmComboboxList>
          <div hlmComboboxGroup>
            @for (currency of allCurrencies(); track currency.code) {
              <hlm-combobox-item [value]="currency.code">
                <div class="flex min-w-0 items-center gap-2">
                  @if (currency.flagEmoji) {
                    <span class="shrink-0">{{ currency.flagEmoji }}</span>
                  } @else {
                    <nucleo-icon [icon]="Coins" [size]="14" class="text-muted-foreground shrink-0" />
                  }
                  <span class="min-w-0 truncate">{{ currency.code }} - {{ currency.name }}</span>
                </div>
              </hlm-combobox-item>
            }
          </div>
        </div>
        <hlm-combobox-empty>No currencies found.</hlm-combobox-empty>
      </div>
    </hlm-combobox>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        max-width: 100%;
      }
    `,
  ],
})
export class CurrencySelectorComponent {
  // Inputs
  readonly selectedCurrency = input<string>('USD');
  readonly disabled = input<boolean>(false);

  // Outputs
  readonly currencyChange = output<string>();

  // Icons
  readonly Coins = Coins;

  // All currencies
  readonly allCurrencies = signal<CurrencyInfo[]>(getAllCurrencies());

  // Computed values
  readonly selectedCurrencyInfo = computed((): CurrencyInfo | undefined => {
    return getCurrencyInfo(this.selectedCurrency());
  });

  // Filter function for combobox
  filterCurrency = (code: string, search: string): boolean => {
    const currency = getCurrencyInfo(code);
    if (!currency) return false;
    const searchLower = search.toLowerCase();
    return currency.code.toLowerCase().includes(searchLower) || currency.name.toLowerCase().includes(searchLower);
  };

  // Convert currency code to display string
  currencyToString = (code: string): string => {
    const currency = getCurrencyInfo(code);
    return currency ? `${currency.code} - ${currency.name}` : code;
  };

  selectCurrency(currencyCode: string | null | undefined) {
    if (this.disabled()) {
      return;
    }

    if (currencyCode) {
      this.currencyChange.emit(currencyCode);
    }
  }
}
