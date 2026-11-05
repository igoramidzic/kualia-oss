import {
  Directive,
  ElementRef,
  HostListener,
  OnInit,
  Renderer2,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CurrencyService } from '../../services/currency.service';
import { getCurrencyFormat } from '../utils/currency';

@Directive({
  selector: '[appCurrencyInput]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyInputDirective),
      multi: true,
    },
  ],
})
export class CurrencyInputDirective implements OnInit, ControlValueAccessor {
  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly currencyService = inject(CurrencyService);

  // Optional input to override default currency
  currency = input<string | undefined>(undefined);

  // Track if we're using contenteditable
  private isContentEditable = false;
  private value = signal<number>(0);

  // Currency format computed from input or workspace currency
  private currencyFormat = computed(() => {
    const currencyCode = this.currency() ?? this.currencyService.currencyCode();
    return getCurrencyFormat(currencyCode);
  });

  // Track if input is focused
  private isFocused = false;

  // ControlValueAccessor callbacks
  private onChange: (value: number) => void = () => {
    // No-op by default
  };
  private onTouched: () => void = () => {
    // No-op by default
  };

  constructor() {
    // React to currency format changes
    effect(() => {
      this.currencyFormat(); // Trigger computation
      this.updateDisplay();
    });
  }

  ngOnInit() {
    const element = this.el.nativeElement as HTMLElement;
    this.isContentEditable = element.hasAttribute('contenteditable');

    // For contenteditable, we need to handle things differently
    if (this.isContentEditable) {
      this.setupContentEditable();
    }

    // Set initial display
    this.updateDisplay();
  }

  private setupContentEditable() {
    const element = this.el.nativeElement as HTMLElement;

    // Ensure element is focusable
    if (!element.hasAttribute('tabindex')) {
      this.renderer.setAttribute(element, 'tabindex', '0');
    }
  }

  private updateDisplay() {
    const format = this.currencyFormat();
    const val = this.value();

    // Convert from base units (cents) to display units
    const displayVal = val / Math.pow(10, format.decimalPlaces || 2);

    if (this.isContentEditable) {
      this.updateContentEditableValue(displayVal);
    } else {
      this.updateInputValue(displayVal);
    }
  }

  private formatNumber(value: number, format: ReturnType<typeof getCurrencyFormat>): string {
    const isNegative = value < 0;
    const absoluteValue = Math.abs(value);

    // Format with decimal places
    let formattedValue = absoluteValue.toFixed(format.decimalPlaces);

    // Split into integer and decimal parts
    const parts = formattedValue.split('.');

    // Add thousand separators to integer part
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, format.thousandSeparator);

    // Join with correct decimal separator
    formattedValue = parts.join(format.decimalSeparator);

    // Add currency symbol
    if (format.symbolPosition === 'before') {
      formattedValue = format.symbol + (format.spaceBetweenSymbolAndValue ? ' ' : '') + formattedValue;
    } else {
      formattedValue = formattedValue + (format.spaceBetweenSymbolAndValue ? ' ' : '') + format.symbol;
    }

    // Add sign
    if (isNegative) {
      formattedValue = '-' + formattedValue;
    }

    return formattedValue;
  }

  private updateInputValue(value: number) {
    const element = this.el.nativeElement as HTMLInputElement;
    const format = this.currencyFormat();

    if (!this.isFocused) {
      // Format the value for display
      element.value = this.formatNumber(value, format);
    } else {
      // When focused, show raw number without currency symbol
      const isNegative = value < 0;
      const absoluteValue = Math.abs(value);
      let rawValue = absoluteValue.toFixed(format.decimalPlaces);

      // Add sign if negative
      if (isNegative) {
        rawValue = '-' + rawValue;
      }

      element.value = rawValue;
    }
  }

  private updateContentEditableValue(value: number) {
    const element = this.el.nativeElement as HTMLElement;
    const format = this.currencyFormat();

    if (!this.isFocused) {
      element.textContent = this.formatNumber(value, format);
    } else {
      // When focused, show raw number
      const isNegative = value < 0;
      const absoluteValue = Math.abs(value);
      let rawValue = absoluteValue.toFixed(format.decimalPlaces);

      if (isNegative) {
        rawValue = '-' + rawValue;
      }

      element.textContent = rawValue;
    }
  }

  @HostListener('input', ['$event'])
  onInput(event: Event) {
    const element = event.target as HTMLInputElement | HTMLElement;
    let rawValue: string;

    if (this.isContentEditable) {
      rawValue = element.textContent || '';
    } else {
      rawValue = (element as HTMLInputElement).value;
    }

    // Parse the value
    const parsedValue = this.parseValue(rawValue);

    if (parsedValue !== null) {
      this.value.set(parsedValue);
      this.onChange(parsedValue);
    }
  }

  @HostListener('focus')
  onFocus() {
    this.isFocused = true;

    // Show raw number when focused
    const format = this.currencyFormat();
    const val = this.value();
    const displayVal = val / Math.pow(10, format.decimalPlaces || 2);

    if (this.isContentEditable) {
      const element = this.el.nativeElement as HTMLElement;
      const isNegative = displayVal < 0;
      const absoluteValue = Math.abs(displayVal);
      element.textContent = (isNegative ? '-' : '') + absoluteValue.toFixed(format.decimalPlaces);

      // Select all content
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      const element = this.el.nativeElement as HTMLInputElement;
      const isNegative = displayVal < 0;
      const absoluteValue = Math.abs(displayVal);
      element.value = (isNegative ? '-' : '') + absoluteValue.toFixed(format.decimalPlaces);
      element.select();
    }
  }

  @HostListener('blur')
  onBlur() {
    this.isFocused = false;
    this.onTouched();
    this.updateDisplay();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    // Allow special keys
    const allowedKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'Home', 'End', 'ArrowLeft', 'ArrowRight'];
    if (allowedKeys.includes(event.key)) {
      return;
    }

    // Allow Ctrl/Cmd combinations
    if (event.ctrlKey || event.metaKey) {
      return;
    }

    // Allow numbers, decimal separator, and minus sign
    const format = this.currencyFormat();
    const char = event.key;

    // Allow digits
    if (/\d/.test(char)) {
      return;
    }

    // Allow minus sign at the beginning
    if (char === '-') {
      const element = this.isContentEditable
        ? (this.el.nativeElement as HTMLElement)
        : (this.el.nativeElement as HTMLInputElement);
      const currentValue = this.isContentEditable ? (element.textContent ?? '') : (element as HTMLInputElement).value;
      const selectionStart = this.isContentEditable ? 0 : ((element as HTMLInputElement).selectionStart ?? 0);

      if (selectionStart === 0 && !currentValue.includes('-')) {
        return;
      }
    }

    // Allow decimal separator if decimals are allowed
    if (format.decimalPlaces > 0 && (char === '.' || char === format.decimalSeparator)) {
      const element = this.isContentEditable
        ? (this.el.nativeElement as HTMLElement)
        : (this.el.nativeElement as HTMLInputElement);
      const currentValue = this.isContentEditable ? (element.textContent ?? '') : (element as HTMLInputElement).value;

      if (!currentValue.includes('.') && !currentValue.includes(format.decimalSeparator)) {
        return;
      }
    }

    // Prevent all other characters
    event.preventDefault();
  }

  private parseValue(rawValue: string): number | null {
    const format = this.currencyFormat();

    // Remove currency symbol and spaces
    let cleanValue = rawValue.replace(new RegExp(`\\${format.symbol}`, 'g'), '').trim();

    // Remove thousand separators
    cleanValue = cleanValue.replace(new RegExp(`\\${format.thousandSeparator}`, 'g'), '');

    // Replace decimal separator with dot
    cleanValue = cleanValue.replace(format.decimalSeparator, '.');

    // Remove any remaining non-numeric characters except dot and minus
    cleanValue = cleanValue.replace(/[^0-9.-]/g, '');

    const parsed = parseFloat(cleanValue);
    if (isNaN(parsed)) {
      return null;
    }

    // Convert to base units (e.g., cents)
    return Math.round(parsed * Math.pow(10, format.decimalPlaces || 2));
  }

  // ControlValueAccessor implementation
  writeValue(value: number): void {
    this.value.set(value || 0);
    this.updateDisplay();
  }

  registerOnChange(fn: (value: number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    const element = this.el.nativeElement as HTMLElement;
    if (isDisabled) {
      this.renderer.setAttribute(element, 'disabled', 'true');
      if (this.isContentEditable) {
        this.renderer.setAttribute(element, 'contenteditable', 'false');
      }
    } else {
      this.renderer.removeAttribute(element, 'disabled');
      if (this.isContentEditable) {
        this.renderer.setAttribute(element, 'contenteditable', 'true');
      }
    }
  }
}
