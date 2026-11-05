import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';
import { CurrencyService } from '../../../services/currency.service';
import { getCurrencyFormat } from '../../utils/currency';

@Component({
  selector: 'app-currency-input',
  imports: [FormsModule, NgxMaskDirective],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyInputComponent),
      multi: true,
    },
    provideNgxMask(),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      #inputElement
      type="text"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [mask]="maskPattern()"
      [prefix]="prefixValue()"
      [suffix]="suffixValue()"
      [thousandSeparator]="thousandSeparatorValue()"
      [separatorLimit]="'999999999999'"
      [allowNegativeNumbers]="allowNegative()"
      [dropSpecialCharacters]="false"
      [specialCharacters]="['.', ',']"
      [ngModel]="displayValue()"
      (ngModelChange)="onInputChange($event)"
      (focus)="onFocus()"
      (blur)="onBlur()"
      (keydown)="onKeydown($event)"
      [class]="
        inputClass() +
        ' placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'
      "
    />
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class CurrencyInputComponent implements ControlValueAccessor, AfterViewInit {
  private readonly currencyService = inject(CurrencyService);

  // Component inputs
  currency = input<string | undefined>(undefined);
  placeholderInput = input<string | undefined>(undefined);
  disabled = input<boolean>(false);
  inputClass = input<string>('');
  allowNegative = input<boolean>(true);
  autoFocus = input<boolean>(false);

  // Component outputs
  blurEvent = output<void>();
  enterEvent = output<void>();

  // View children
  readonly inputElement = viewChild<ElementRef<HTMLInputElement>>('inputElement');

  // Internal state
  private value = signal<number | null>(null);
  protected displayValue = signal<string>('');

  // Currency format computed from input or defaults to workspace currency
  private currencyFormat = computed(() => {
    const currencyCode = this.currency() ?? this.currencyService.currencyCode();
    return getCurrencyFormat(currencyCode);
  });

  // Dynamic placeholder based on currency format
  protected placeholder = computed(() => {
    if (this.placeholderInput()) {
      return this.placeholderInput()!;
    }
    const format = this.currencyFormat();
    const numberPart = format.decimalPlaces === 0 ? '0' : '0.' + '0'.repeat(format.decimalPlaces);

    // Include currency symbol in placeholder
    if (format.symbolPosition === 'before') {
      return format.symbol + (format.spaceBetweenSymbolAndValue ? ' ' : '') + numberPart;
    } else {
      return numberPart + (format.spaceBetweenSymbolAndValue ? ' ' : '') + format.symbol;
    }
  });

  // Computed mask configuration
  protected maskPattern = computed(() => {
    const format = this.currencyFormat();
    if (format.decimalPlaces > 0) {
      return `separator.${format.decimalPlaces}`;
    }
    return 'separator.0';
  });

  protected prefixValue = computed(() => {
    const format = this.currencyFormat();
    if (format.symbolPosition === 'before') {
      return format.symbol + (format.spaceBetweenSymbolAndValue ? ' ' : '');
    }
    return '';
  });

  protected suffixValue = computed(() => {
    const format = this.currencyFormat();
    if (format.symbolPosition === 'after') {
      return (format.spaceBetweenSymbolAndValue ? ' ' : '') + format.symbol;
    }
    return '';
  });

  protected thousandSeparatorValue = computed(() => {
    const format = this.currencyFormat();
    return format.thousandSeparator;
  });

  // ControlValueAccessor callbacks
  private onChange: (value: number | null) => void = () => {
    // No-op by default
  };
  protected onTouched: () => void = () => {
    // No-op by default
  };

  constructor() {
    // We'll update display value manually in writeValue and onInputChange
    // instead of using an effect to avoid stale closure issues
  }

  ngAfterViewInit(): void {
    if (this.autoFocus()) {
      // Use setTimeout to ensure the input is fully rendered
      setTimeout(() => {
        this.inputElement()?.nativeElement.focus();
        this.inputElement()?.nativeElement.select();
      });
    }
  }

  onInputChange(value: string): void {
    // If the input is empty or just contains currency symbols/spaces, set null
    const format = this.currencyFormat();
    const cleanedForEmpty = value
      .replace(new RegExp(`\\${format.symbol}`, 'g'), '')
      .replace(/\s/g, '')
      .trim();

    if (!cleanedForEmpty || cleanedForEmpty === '') {
      this.value.set(null);
      this.onChange(null);
      this.displayValue.set('');
      return;
    }

    // Check if it's just a negative sign
    if (cleanedForEmpty === '-') {
      // Keep null value but preserve the negative sign in display
      this.value.set(null);
      this.onChange(null);
      // Display value is already set to '-' by the user typing
      return;
    }

    // Parse the masked value
    const parsedValue = this.parseValue(value);

    if (parsedValue !== null) {
      this.value.set(parsedValue);
      this.onChange(parsedValue);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    // Toggle sign on hyphen/minus key (only if negative numbers are allowed)
    if (event.key === '-' || event.key === 'Minus') {
      event.preventDefault();
      if (this.allowNegative()) {
        this.toggleSign();
      }
      return;
    }
    // Format on Enter key (but not CMD+Enter or Ctrl+Enter, let parent handle those)
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      this.formatDisplayValue();
      this.enterEvent.emit();
      // Let the event bubble up
      return;
    }
    // Pass through Escape for parent components to handle
    if (event.key === 'Escape') {
      // Let the event bubble up
      return;
    }
  }

  onFocus(): void {
    this.inputElement()?.nativeElement.select();
  }

  onBlur(): void {
    this.formatDisplayValue();
    this.onTouched();
    this.blurEvent.emit();
  }

  private toggleSign(): void {
    const currentValue = this.value();
    const currentDisplay = this.displayValue();
    const format = this.currencyFormat();

    if (currentValue === null) {
      // If no value, just toggle the negative sign in display
      if (currentDisplay.startsWith('-')) {
        this.displayValue.set('');
      } else {
        this.displayValue.set('-');
      }
      return;
    }

    // Toggle the sign for actual values
    const newValue = -currentValue;
    this.value.set(newValue);
    this.onChange(newValue);

    // Update display value
    const displayVal = format.decimalPlaces === 0 ? newValue : newValue / Math.pow(10, format.decimalPlaces);
    this.displayValue.set(displayVal.toFixed(format.decimalPlaces));
  }

  private formatDisplayValue(): void {
    const format = this.currencyFormat();
    const currentValue = this.value();
    const currentDisplay = this.displayValue();

    // If value is null
    if (currentValue === null) {
      // Preserve negative sign if it was there
      if (currentDisplay === '-') {
        // Keep the negative sign
        return;
      }
      // Otherwise clear the display
      this.displayValue.set('');
      return;
    }

    // Convert from base units to display units (including 0)
    const displayVal = format.decimalPlaces === 0 ? currentValue : currentValue / Math.pow(10, format.decimalPlaces);

    // Format with proper decimal places
    this.displayValue.set(displayVal.toFixed(format.decimalPlaces));
  }

  private parseValue(rawValue: string): number | null {
    const format = this.currencyFormat();

    // Check if the value is negative
    const isNegative = rawValue.includes('-');

    // Remove currency symbol and spaces
    let cleanValue = rawValue.replace(new RegExp(`\\${format.symbol}`, 'g'), '').trim();

    // Remove thousand separators
    cleanValue = cleanValue.replace(new RegExp(`\\${format.thousandSeparator}`, 'g'), '');

    // Replace decimal separator with dot if needed
    if (format.decimalSeparator !== '.') {
      cleanValue = cleanValue.replace(format.decimalSeparator, '.');
    }

    // Remove any remaining non-numeric characters except dot (including minus sign)
    cleanValue = cleanValue.replace(/[^0-9.]/g, '');

    const parsed = parseFloat(cleanValue);
    if (isNaN(parsed)) {
      return null;
    }

    // Apply negative sign if needed
    const finalValue = isNegative ? -parsed : parsed;

    // For currencies with no decimal places (like JPY), don't multiply
    // For currencies with decimals, convert to base units (e.g., cents)
    if (format.decimalPlaces === 0) {
      return Math.round(finalValue);
    }
    return Math.round(finalValue * Math.pow(10, format.decimalPlaces));
  }

  // ControlValueAccessor implementation
  writeValue(value: number | null): void {
    // If value is null or undefined, treat as empty (show placeholder)
    if (value === null || value === undefined) {
      this.value.set(null);
      this.displayValue.set('');
      return;
    }

    // Set the value (including 0)
    this.value.set(value);

    // Manually update display value to ensure it's in sync
    const format = this.currencyFormat();
    // For currencies with no decimal places (like JPY), don't divide
    // For currencies with decimals, convert from base units (e.g., cents to dollars)
    const displayVal = format.decimalPlaces === 0 ? value : value / Math.pow(10, format.decimalPlaces);
    this.displayValue.set(displayVal.toFixed(format.decimalPlaces));
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    // The disabled state is handled via input binding
    // isDisabled parameter is not used because disabled state is controlled via input binding
    void isDisabled;
  }

  // Public method to focus the input
  focus(): void {
    this.inputElement()?.nativeElement.focus();
  }
}
